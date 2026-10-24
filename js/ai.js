// OpenAI-compatible calls to Bailian (DashScope) or Poe through the relay: retries, truncation, tolerant JSON,
// mock mode, the model speed test. v0 runs on Bailian only (config POE_ENABLED).
// Emma (CONTRACTS.md "ai"): createAI({ getSettings, budget }) checks budget.canSpend(kind) before a call
// (AIError 'budget-day' over the in-app daily cap), records budget.record(usage, kind, model) after one, and never
// retries Bailian's "budget used up" 429 (AIError 'budget'). Messages here are for the parent area; what Emma sees
// comes from kid-errors.js by err.code.
// To come (teacher-memory 11): a task table and route(task, s) choosing provider + model per task, with a fallback.
import { API_URL, RETRY_DELAYS, TIMEOUT_MS, MODEL_CHOICES, SPEED_WORD, SPEED_TIMEOUT_MS,
  POE_DIRECT_URL, POE_DEFAULT_MODELS, POE_MODEL_CHOICES, POE_BUDGET, POE_MAX_BUDGET } from './config.js';
import { SYSTEM, userMsg } from './prompts.js';
import { isBudgetExhausted, budgetKindOf } from './budget.js';

export class AIError extends Error {
  constructor(message, code = 'error') { super(message); this.name = 'AIError'; this.code = code; }
}
class Truncated extends Error {}
class Retryable extends Error {}
const BUDGET_MSG = '百炼返回 429：这个 Key 的月预算用完了（“预算管理”达到即停）。到百炼控制台调预算，或者等下个月。';
const DAY_CAP_MSG = '今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。';

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const NETWORK_MSG = '连不上百炼：网络不通，或者请求被拦截了（开着 VPN 可以关掉再试）。';
const RELAY_NETWORK_MSG = '连不上中转站：网络不通，或者中转站地址不对。';
const POE_NETWORK_MSG = '连不上 Poe：在国内直连 api.poe.com 要开 VPN，或者改填中转站地址。';

// What Wei pastes as the relay address -> https://host/secret/v1 (same rules as server.py normalize_base_url).
// '' stays ''; null = not an address we accept (https only: the app itself is served over https).
export function normalizePoeUrl(raw) {
  let u = String(raw ?? '').replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '');
  if (!u) return '';
  u = u.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~-]+)*$/.test(u)) return null;
  return u.endsWith('/v1') ? u : u + '/v1';
}
// The relay's domain without its secret, safe to show on screen
export function poeHost(url) {
  if (!url) return '';
  if (url === POE_DIRECT_URL) return 'api.poe.com（直连）';
  try { return new URL(url).host; } catch (e) { return ''; }
}

// Who answers lookups (SPEC 5.2). Bailian unless Poe is switched on in 我; Bailian's key stays the voice key either way.
export function providerOf(s) {
  if (s && s.provider === 'poe') {
    const base = s.poeUrl || '';
    return { id: 'poe', name: 'Poe', url: base ? base + '/chat/completions' : '', key: s.poeKey || '',
      models: { ...POE_DEFAULT_MODELS, ...(s.poeModels || {}) }, choices: POE_MODEL_CHOICES,
      networkMsg: base === POE_DIRECT_URL ? POE_NETWORK_MSG : RELAY_NETWORK_MSG, relay: !!base && base !== POE_DIRECT_URL };
  }
  return { id: 'bailian', name: '百炼', url: API_URL, key: (s && s.apiKey) || '', models: (s && s.models) || {},
    choices: MODEL_CHOICES, networkMsg: NETWORK_MSG, relay: false };
}

// Same tolerance as server.py parse_json: strip fences, else take the first "{" .. last "}".
export function parseJSON(text) {
  let t = String(text ?? '').trim();
  t = t.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch (e) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw e;
  }
}

const modelFor = (kind, models) => (kind === 'core' ? models.core : kind === 'zh' ? models.zh : models.extras);

// Every Bailian call sends this body. Thinking off (all current models think by default), json mode on, and no
// max_tokens (the Bailian json-mode doc says not to set it with structured output). Poe (maxTokens given) takes json
// mode too (checked 10-24 on the six models in POE_MODEL_CHOICES) but has no enable_thinking and needs a budget.
export function requestBody(model, system, user, maxTokens = 0) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
  };
  if (maxTokens) body.max_tokens = maxTokens;
  else body.enable_thinking = false;
  return body;
}
const keyOk = k => /^[\x21-\x7e]+$/.test(k);

function errorDetail(data) {
  if (!data || typeof data !== 'object') return { code: '', message: '' };
  const e = data.error && typeof data.error === 'object' ? data.error : data;
  return { code: String(e.code || e.type || ''), message: String(e.message || '').slice(0, 200) };
}

const modelMissing = blob => blob.includes('model_not_found') || blob.includes('model not exist') || blob.includes('does not exist')
  || blob.includes('not_found_error') || blob.includes('not found or unavailable');
// The relay answers a wrong secret with an empty 404; Poe's own 404s (an unknown model) carry an error body.
const relaySecretWrong = (status, data, p) => p.relay && status === 404 && !errorDetail(data).message;

function httpError(status, data, model, p = providerOf(null)) {
  const { code, message } = errorDetail(data);
  const blob = (code + ' ' + message).toLowerCase();
  const n = p.name;
  if (relaySecretWrong(status, data, p)) return new AIError('中转站返回 404：地址里的暗号不对，到“单词 → 家长 → Poe”里重新粘贴。', 'badkey');
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalidapikey')) {
    return new AIError(`${n} API Key 不对或已失效：到“单词 → 家长”里重新填。`, 'badkey');
  }
  if (blob.includes('arrearage') || blob.includes('overdue') || blob.includes('good standing')) {
    return new AIError('百炼账户欠费或预算用完了，去百炼控制台看一下。', 'billing');
  }
  if (p.id === 'poe' && (status === 402 || blob.includes('insufficient') || blob.includes('points'))) {
    return new AIError('Poe 积分用完了，到 poe.com 看一下。', 'billing');
  }
  if (modelMissing(blob)) {
    return new AIError(`模型“${model}”用不了：到“单词 → 家长”里换一个。`, 'model');
  }
  if (blob.includes('data_inspection') || blob.includes('datainspection')) {
    return new AIError('内容没通过百炼的安全检查，换个说法试试。', 'inspection');
  }
  if (status === 403) {
    return new AIError(`${n}拒绝了请求（403）：${message || code || '没有权限'}。` + (p.id === 'poe' ? '' : '检查 Key 的模型权限和预算上限。'), 'forbidden');
  }
  return new AIError(`${n}返回 ${status}：${message || code || '没有详情'}`, 'http');
}

const clockMs = () => (globalThis.performance ? performance.now() : Date.now());

// budget (optional): budget.js createBudget(); without it nothing is checked or recorded (the dictionary's tests).
export function createAI({ getSettings, fetchImpl, sleep = sleepMs, random = Math.random, timeouts = TIMEOUT_MS, now = clockMs, budget = null } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function callOnce({ p, model, system, user, signal, timeoutMs, maxTokens, kind = 'other' }) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    let res, data;
    try {
      res = await doFetch(p.url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(model, system, user, maxTokens)),
        signal: ctrl.signal,
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
      if (timedOut) throw new Retryable('timeout');
      throw new Retryable('network');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (!res.ok) {
      // the key's monthly budget is used up: retrying only adds requests (research 05 F1)
      if (res.status === 429 && isBudgetExhausted(429, data)) throw new AIError(BUDGET_MSG, 'budget');
      if (res.status === 429) throw new Retryable('429');
      if (res.status >= 500) throw new Retryable('5xx:' + res.status);
      throw httpError(res.status, data, model, p);
    }
    const choice = data && data.choices && data.choices[0];
    const content = String((choice && choice.message && choice.message.content) || '').trim();
    if (choice && choice.finish_reason === 'length') throw new Truncated('输出被截断');
    if (budget && data && data.usage) {
      try { budget.record(data.usage, budgetKindOf(kind), model); } catch (e) { /* a bookkeeping slip never fails a call */ }
    }
    const used = (data.usage && data.usage.completion_tokens) || 0;
    if (maxTokens && used >= maxTokens) throw new Truncated('输出被截断');
    if (!content) throw new Retryable('empty');
    return content;
  }

  // A failed fetch while the phone says it is offline (airplane mode) is not retried: the dictionary
  // fallback shows at once. Neither is a timeout on a call the screen waits for (core, zh): one 40 s
  // wait is long enough, three would be two minutes on a connection that hangs.
  async function callWithRetry(args) {
    let last;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try { return await callOnce(args); } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        last = e;
        if (e.message === 'network' && globalThis.navigator && navigator.onLine === false) break;
        if (e.message === 'timeout' && !args.retryTimeout) break;
        if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
        if (args.signal && args.signal.aborted) throw new AIError('已取消', 'abort');
      }
    }
    const m = last.message, n = args.p.name;
    if (m === '429') throw new AIError(`${n}限流了（请求太频繁或额度用完），稍等一会儿再试。`, 'ratelimit');
    if (m.startsWith('5xx:')) throw new AIError(`${n}服务出错（${m.slice(4)}），稍后再试。`, 'server');
    if (m === 'empty') throw new AIError(`${n}返回了空内容，再试一次。`, 'empty');
    if (m === 'timeout') throw new AIError(`${n}响应超时，网络可能太慢，再试一次。`, 'timeout');
    throw new AIError(args.p.networkMsg, 'network');
  }

  // kind: core | lexicon | practice | zh | story
  async function askJSON(kind, user, { signal } = {}) {
    const s = getSettings();
    const mock = !!s.mock;
    const p = providerOf(s);
    if (!mock) keyCheck(p, 'lookup');
    if (!mock && budget && !budget.canSpend(budgetKindOf(kind))) throw new AIError(DAY_CAP_MSG, 'budget-day');
    // test hook (?mock=offline): every call fails the way a dropped connection does
    if (mock && s.mockFail === 'network') {
      await sleep(300);
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
      throw new AIError(p.networkMsg, 'network');
    }
    const model = modelFor(kind, p.models);
    let maxTokens = p.id === 'poe' ? POE_BUDGET[kind] || POE_BUDGET.lexicon : 0;
    // up to 3 requests: a reply that does not parse is asked for again; a cut-off reply only once more (same request,
    // there is no budget to raise), since a model that runs past its own output limit twice will do it again
    let lastErr = null;
    let cuts = 0;
    for (let i = 0; i < 3; i++) {
      let text;
      try {
        text = mock
          ? await mockReply(kind, user, { sleep, random, signal })
          : await callWithRetry({ p, model, system: SYSTEM[kind], user, signal, timeoutMs: timeouts[kind] || 60000, maxTokens, kind,
            retryTimeout: kind !== 'core' && kind !== 'zh' });
      } catch (e) {
        if (e instanceof Truncated) {
          if (++cuts >= 2) throw new AIError(`模型“${model}”的回答太长，两次都被截断了：再试一次，或者到“单词 → 家长”里换个模型。`, 'truncated');
          if (maxTokens) maxTokens = Math.min(POE_MAX_BUDGET, maxTokens * 2);   // Poe: the budget can grow
          continue;
        }
        throw e;
      }
      try {
        const obj = parseJSON(text);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        lastErr = new Error('不是 JSON 对象');
      } catch (e) { lastErr = e; }
    }
    throw new AIError(`模型返回的内容不完整：${lastErr ? lastErr.message : '未知原因'}`, 'incomplete');
  }

  // Missing or broken key / address, before any request (ctx: 'lookup' or 'speed'). An invisible character in the
  // key makes fetch throw, which would look like a network problem.
  function keyCheck(p, ctx) {
    const speed = ctx === 'speed';
    if (p.id === 'poe') {
      if (!p.url) throw new AIError(speed ? '还没填中转站地址：先在上面填好，再来测。' : '还没填中转站地址：到“单词 → 家长 → Poe”里填上。', 'nokey');
      if (!p.key) throw new AIError(speed ? '还没填 Poe API Key：先在上面填好，再来测。' : '还没填 Poe API Key：到“单词 → 家长 → Poe”里填上。', 'nokey');
      if (!keyOk(p.key)) throw new AIError(speed ? 'Poe API Key 格式不对：在上面重新粘贴一次。' : 'Poe API Key 格式不对：到“单词 → 家长 → Poe”里重新粘贴。', 'badkey');
      return;
    }
    if (!p.key) throw new AIError(speed ? '还没填百炼 API Key：先在上面的“Key”里填好，再来测。' : '还没填百炼 API Key：到“单词 → 家长”里填上，或者先打开模拟模式。', 'nokey');
    if (!keyOk(p.key)) throw new AIError(speed ? '百炼 API Key 格式不对：在上面重新粘贴一次。' : '百炼 API Key 格式不对：到“单词 → 家长”里重新粘贴。', 'badkey');
  }

  // ---------------------------------------------------------------- speed test (我的 → 模型, SPEC 2.4)
  // The real core prompt for SPEED_WORD, once per model, one after another, with the saved key. No retries (each
  // result is one request's time) and nothing is stored: results only go to the caller, never to words.js or the log.
  async function speedTest({ choices = null, word = SPEED_WORD, timeoutMs = SPEED_TIMEOUT_MS, onResult } = {}) {
    const s = getSettings();
    const mock = !!s.mock;
    const p = providerOf(s);
    if (!mock) keyCheck(p, 'speed');
    const results = [];
    for (const c of choices || p.choices) {
      const t0 = now();
      const out = mock ? await mockSpeed(c.id, s, word) : await speedOnce(c.id, p, word, timeoutMs);
      const r = { id: c.id, ms: Math.max(0, Math.round(now() - t0)), ok: false, json: false, error: '', ...out };
      results.push(r);
      if (onResult) onResult(r, results.length - 1);
    }
    return results;
  }

  async function speedOnce(model, p, word, timeoutMs) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const maxTokens = p.id === 'poe' ? POE_BUDGET.core : 0;
    let res, data;
    try {
      res = await doFetch(p.url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(model, SYSTEM.core, userMsg(word), maxTokens)),
        signal: ctrl.signal,
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      return { error: timedOut ? `超过 ${Math.round(timeoutMs / 1000)} 秒没回` : '连不上：网络不通，或者请求被拦截了' };
    } finally { clearTimeout(timer); }
    if (timedOut) return { error: `超过 ${Math.round(timeoutMs / 1000)} 秒没回` };
    if (!res.ok) return { status: res.status, error: speedError(res.status, data, p) };
    const choice = data && data.choices && data.choices[0];
    const content = String((choice && choice.message && choice.message.content) || '').trim();
    const used = (data.usage && data.usage.completion_tokens) || 0;
    if ((choice && choice.finish_reason === 'length') || (maxTokens && used >= maxTokens)) return { ok: true, error: '回答被截断了' };
    if (!content) return { ok: true, error: '返回了空内容' };
    try {
      const obj = parseJSON(content);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return { ok: true, json: true };
    } catch (e) { /* reported below */ }
    return { ok: true, error: '返回的不是 JSON' };
  }

  // mock mode: varied timings, and one model that the key "has not enabled", so every row type shows up
  async function mockSpeed(model, s, word) {
    if (s.mockFail === 'network') { await sleep(300); return { error: '连不上：网络不通，或者请求被拦截了' }; }
    await sleep((MOCK_SPEED_MS[model] || 900) + Math.floor(random() * 300));
    if (model === 'deepseek-v4-pro') return { status: 403, error: '403：这个 Key 没开通这个模型（模拟）' };
    const obj = parseJSON(await mockReply('core', userMsg(word), { sleep: async () => {}, random }));
    return { ok: true, json: !!(obj && obj.headword) };
  }

  return { askJSON, speedTest };
}

const MOCK_SPEED_MS = { 'qwen3.8-flash': 600, 'qwen3.7-flash': 450, 'qwen3.7-plus': 1000, 'qwen3.8-max': 1500, 'deepseek-v4-pro': 350, 'qwen-plus': 800 };

// Short reasons for the speed test list (the lookup errors above are full sentences with what to do next).
export function speedError(status, data, p = providerOf(null)) {
  const { code, message } = errorDetail(data);
  const blob = (code + ' ' + message).toLowerCase();
  if (relaySecretWrong(status, data, p)) return '中转站返回 404：暗号不对';
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalidapikey')) return 'Key 不对或已失效（401）';
  if (blob.includes('arrearage') || blob.includes('overdue') || blob.includes('good standing')) return '账户欠费或预算用完了';
  if (p.id === 'poe' && (status === 402 || blob.includes('insufficient') || blob.includes('points'))) return 'Poe 积分用完了';
  if (status === 403) return p.id === 'poe' ? `403：${message || '没有权限'}` : '403：这个 Key 没开通这个模型';
  if (modelMissing(blob)) return `没有这个模型，或者这个 Key 用不了（${status}）`;
  if (status === 429) return '限流了（429），过一会儿再测';
  if (status >= 500) return `${p.name}服务出错（${status}）`;
  return `${p.name}返回 ${status}：${message || code || '没有详情'}`;
}

// ---------------------------------------------------------------- mock (port of server.py mock_reply)

const MOCK_TYPO = { teh: ['the'], recieve: ['receive'], definately: ['definitely'] };

export async function mockReply(kind, user, { sleep = sleepMs, random = Math.random, signal } = {}) {
  // 0.5-1.5 s; core comes back first so the three tiers fill in visibly, like the real thing
  const [lo, span] = kind === 'core' ? [500, 400] : kind === 'zh' ? [700, 600] : [900, 600];
  await sleep(lo + Math.floor(random() * span));
  if (signal && signal.aborted) throw new AIError('已取消', 'abort');
  if (kind === 'story' || user.includes('Target words:')) {
    const ws = user.split(':').slice(1).join(':').split(',');
    return JSON.stringify({ title: 'A Busy Monday', text: ws.map(w => `We had to **${w.trim()}** today.`).join(' '),
      cn: '（模拟翻译）', questions: [{ q: 'What happened?', a: 'A lot.' }, { q: 'Who?', a: 'We.' }] });
  }
  if (kind === 'zh') {
    const q = user.split('\n')[0].replace('Chinese input: ', '');
    return JSON.stringify({ status: 'ok', query: q, translation: '', explain: '英文里常用 meticulous 或 thorough，前者更强调细节。',
      options: [
        { en: 'meticulous', pos: 'adj.', cn: '一丝不苟的', nuance: '最贴切，偏正式，强调细节', example: 'She is meticulous about data.', example_cn: '她对数据一丝不苟。', level: 'C1' },
        { en: 'thorough', pos: 'adj.', cn: '彻底的', nuance: '强调全面不遗漏，更常用', example: 'We did a thorough check.', example_cn: '我们做了彻底检查。', level: 'B2' },
        { en: 'painstaking', pos: 'adj.', cn: '煞费苦心的', nuance: '强调花了很大功夫', example: 'It took painstaking work.', example_cn: '这花了很大功夫。', level: 'C1' },
      ], best: 0 });
  }
  const q = user.split('\n')[0].replace('Input: ', '').trim();
  const lq = q.toLowerCase();
  if (lq in MOCK_TYPO || lq === 'asdfgh' || !/[aeiou]/.test(lq)) {
    if (kind === 'core') return JSON.stringify({ status: lq in MOCK_TYPO ? 'typo' : 'invalid', headword: q, suggestions: MOCK_TYPO[lq] || [] });
    return JSON.stringify({ invalid: true });
  }
  if (kind === 'core') {
    return JSON.stringify({
      status: 'ok', headword: lq, suggestions: [], kind: 'word', level: 'C1',
      phonetic: '/məˈtɪkjələs/', syllables: (lq.match(/.{1,3}/g) || [lq]).join('·'),
      brief_cn: '模拟释义·' + q.slice(0, 4),
      senses: [
        { pos: 'adj.', cn: '一丝不苟的；极其细致的', en: 'showing great attention to detail', example: `She kept ${q} notes of every customer call.`, example_cn: '她把每次客户通话都记得非常仔细。' },
        { pos: 'adj.', cn: '过分讲究的', en: 'overly careful', example: `He is ${q} about formatting.`, example_cn: '他对格式过分讲究。' },
      ],
      context_note: user.includes('Context') ? '这里形容评审做得非常细，连小错都不放过。' : '',
      mnemonic: '拆成 me + tick：我（me）对着清单一项项打勾（tick），一个都不漏。',
    });
  }
  if (kind === 'lexicon') {
    return JSON.stringify({
      collocations: [{ phrase: `${q} attention to detail`, cn: '对细节一丝不苟' }, { phrase: `${q} planning`, cn: '周密的计划' }, { phrase: `${q} records`, cn: '详尽的记录' }],
      synonyms: [{ word: 'thorough', diff: '强调全面、不遗漏，中性' }, { word: 'painstaking', diff: '强调费力、花大量功夫' }, { word: 'scrupulous', diff: '带道德意味：一丝不苟且诚实' }],
      antonyms: [{ word: 'careless', cn: '粗心的' }, { word: 'sloppy', cn: '马虎的' }],
      word_family: [{ word: q + 'ly', pos: 'adv.', cn: '一丝不苟地' }, { word: q + 'ness', pos: 'n.', cn: '细致' }],
      roots: { breakdown: 'metus(恐惧) + -ulous(充满…的)', explain: '原意是“怕出错的”，后来引申为极其小心细致。', same_root: [{ word: 'meticulously', cn: '细致地' }] },
      confusables: [{ word: 'meretricious', diff: '华而不实的，拼写相近，意思完全不同' }],
      usage_tip: '多用于正面评价工作质量；形容人时有时暗示过分挑剔。',
    });
  }
  return JSON.stringify({
    reading: { title: 'The Release Checklist', text: `Before every release, Mia does a ${q} review of the notes. Her ${q} habit has saved the team twice this quarter.`, cn: '每次发版前，Mia 都会仔细审一遍说明。她的这个习惯这个季度已经救了团队两次。' },
    quiz: [
      { type: 'choice', question: `In “a ${q} review”, ${q} means:`, options: ['very careful', 'very fast', 'very short', 'very late'], answer: 0, explain: '形容评审做得细' },
      { type: 'choice', question: 'Fill: She is ___ about data quality.', options: ['sloppy', q, 'random', 'loud'], answer: 1, explain: 'be meticulous about sth.' },
      { type: 'choice', question: 'Closest synonym?', options: ['careless', 'quick', 'thorough', 'rough'], answer: 2, explain: 'thorough 最接近' },
    ],
  });
}
