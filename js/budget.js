// 花费：按返回的用量估算花了多少钱，App 内每天封顶（DESIGN 10.6、10.7），认出百炼“预算用完”的 429（不重试）。
// 负责：记录与花费 agent（events.js、budget.js）；AI 层 agent 补了按类别上限、预算用完的标记、Poe 单价。
//
// 导出
//   KINDS                                  花费类别：'lookup' 查词、'tts' 朗读、'hint' 提示讲解、'story' 写故事、
//                                          'reflect' 每周反思、'photo' 拍照识别、'chat' 问老师、'asr' 语音输入（0.3.0）、'other'
//   USD_CNY                                Poe 的美元价换成元用的汇率
//   PRICES                                 { model: [输入元/百万 token, 输出元/百万 token] }，从 config.js 的 MODEL_CHOICES、
//                                          POE_MODEL_CHOICES 的 note 读出来；TTS 是 { 'qwen3-tts-flash': 元/万字符 }
//   FALLBACK_PRICE                         不认识的模型按这个算（往贵了算，宁可早停）
//   budgetKindOf(aiKind) -> kind           ai.js 的任务名（core / lexicon / practice / zh / story / hint / tts ...）到花费类别
//   costOf(usage, kind, model) -> 元       纯函数。usage 是接口返回的 usage：chat 用 {prompt_tokens, completion_tokens}
//                                          （或 input_tokens / output_tokens），TTS 用 {characters}，语音识别用 {seconds}；认不出的返回 0
//   isBudgetExhausted(status, data) -> bool   纯函数：百炼“预算管理达到即停”返回的 429（中英文两句固定文案，research 05 F1）
//   BUDGET_ERROR                           那个 429 在 App 里的固定错误码 'budget'（ai.js 抛 AIError('budget')）
//   createBudget({ kv, now, getCap, getKindCaps }) -> {
//     load() -> Promise                    启动时读 kv 'budget'
//     record(usage, kind, model?) -> 元     记一笔（同步更新内存，异步写 kv），返回这笔估算的钱
//     canSpend(kind) -> bool               今天还能花：总数没到 getCap()（默认 settings.dailyCapYuan = 1.5），
//                                          这个类别没到 getKindCaps()[kind]（可选），今天也没收到过百炼的“预算用完”
//     blockReason(kind) -> '' | 'day' | 'kind' | 'month'   为什么不能花；'month' = 今天收到过百炼的“预算用完”
//     markExhausted()                      收到百炼“预算用完”的 429 时 ai.js 调：当天不再发请求（第二天再试一次）
//     clearExhausted()                     家长在百炼控制台调了预算以后，在家长区点“再试”时调
//     today() -> { date, total, byKind, cap, left }
//     month() -> { month: 'YYYY-MM', total, byKind }
//     reset()
//   }
//   wrapFetch(fetchImpl, budget, { ttsUrl }) -> fetch   给 tts.js 用的 fetch：超额时直接回一个 429，成功时按 usage.characters 记账
//
// kv 'budget' 的形状：{ days: { 'YYYY-MM-DD': { kind: 元 } }, exhausted?: 'YYYY-MM-DD' }，days 留 62 天。
// 依赖：kv 是 app.js 传来的 { get(key), set(key, value) }（异步）；config.js 的单价和 TTS 设置。
import { TTS_URL, TTS_MODEL, TTS_SPEECH_URL, TTS_SPEECH_MODEL, MODEL_CHOICES, POE_MODEL_CHOICES } from './config.js';

export const KINDS = ['lookup', 'tts', 'hint', 'story', 'reflect', 'photo', 'chat', 'asr', 'other'];
export const BUDGET_ERROR = 'budget';
export const USD_CNY = 7.2;

// "0.8 / 2.7 元" -> [0.8, 2.7]; "2 / 10 美元" -> in yuan
function priceOfNote(note) {
  const m = String(note || '').match(/([\d.]+)\s*\/\s*([\d.]+)\s*(美元|元)/);
  if (!m) return null;
  const k = m[3] === '美元' ? USD_CNY : 1;
  return [Number(m[1]) * k, Number(m[2]) * k];
}
const fromChoices = list => Object.fromEntries((list || []).map(c => [c.id, priceOfNote(c.note)]).filter(([, p]) => p));

// 语音输入 (voice-input.js): Bailian's sync speech recognition, priced by the second
export const ASR_MODEL = 'qwen-audio-3.0-asr-flash';
export const ASR_PER_SEC = 0.00022;

// CNY. Bailian Beijing list prices of 2026-10-24 (DESIGN 10.6), read from config.js; Poe in USD converted.
export const PRICES = {
  ...fromChoices(POE_MODEL_CHOICES),
  ...fromChoices(MODEL_CHOICES),
  [TTS_MODEL]: 0.8,   // per 10,000 characters
  [TTS_SPEECH_MODEL]: [1.5, 12],   // per 1M tokens, input / output (research/08; about 0.13 元 per 10,000 characters)
  [ASR_MODEL]: ASR_PER_SEC,        // per second of audio (research/05 B: qwen-audio-3.0-asr-flash)
};
export const FALLBACK_PRICE = [12, 36];


const AI_KIND = { core: 'lookup', lexicon: 'lookup', practice: 'lookup', zh: 'lookup', story: 'story', hint: 'hint',
  reflect: 'reflect', photo: 'photo', tts: 'tts', chat: 'chat', asr: 'asr' };
export const budgetKindOf = aiKind => AI_KIND[aiKind] || (KINDS.includes(aiKind) ? aiKind : 'other');

export function costOf(usage, kind, model = '') {
  if (!usage || typeof usage !== 'object') return 0;
  if (model === TTS_SPEECH_MODEL && (usage.input_tokens != null || usage.output_tokens != null)) {
    const p = PRICES[TTS_SPEECH_MODEL];
    return (Math.max(0, Number(usage.input_tokens) || 0) * p[0] + Math.max(0, Number(usage.output_tokens) || 0) * p[1]) / 1e6;
  }
  if (kind === 'asr' || usage.seconds != null) {
    const per = typeof PRICES[model] === 'number' ? PRICES[model] : ASR_PER_SEC;
    return Math.max(0, Number(usage.seconds) || 0) * per;
  }
  if (kind === 'tts' || usage.characters != null) {
    const per = typeof PRICES[TTS_MODEL] === 'number' ? PRICES[TTS_MODEL] : 0.8;
    return Math.max(0, Number(usage.characters) || 0) / 10000 * per;
  }
  const p = Array.isArray(PRICES[model]) ? PRICES[model] : FALLBACK_PRICE;
  const inT = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens) || 0);
  const outT = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens) || 0);
  return (inT * p[0] + outT * p[1]) / 1e6;
}

// research 05 F1: with “达到预算后立即停止” on, Bailian answers 429 with one of these two fixed sentences:
//   您在「预算管理」中设置的预算额度已用尽。在提高或重置预算额度前，您将无法继续调用 API。
//   The budget configured in Budget Management has been exhausted.
// Plain rate limiting (also 429) says something else and is retried as before.
const EXHAUSTED = ['预算额度已用尽', 'budget configured in budget management has been exhausted'];
export function isBudgetExhausted(status, data) {
  if (Number(status) !== 429) return false;
  const e = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error : data) : {};
  const text = (String(e.message || '') + ' ' + String(e.code || '') + ' ' + (typeof data === 'string' ? data : '')).toLowerCase();
  return EXHAUSTED.some(s => text.includes(s));
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KEEP_DAYS = 62;

export function createBudget({ kv, now = () => new Date(), getCap = () => 1.5, getKindCaps = () => ({}) } = {}) {
  let days = {};          // { 'YYYY-MM-DD': { kind: yuan } }
  let exhausted = '';     // the day Bailian last said the key's budget is used up
  let saving = Promise.resolve();

  async function load() {
    try {
      const v = await kv.get('budget');
      days = (v && v.days && typeof v.days === 'object') ? v.days : {};
      exhausted = (v && typeof v.exhausted === 'string') ? v.exhausted : '';
    } catch (e) { days = {}; exhausted = ''; }
  }
  function persist() {
    const keys = Object.keys(days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
    const value = exhausted ? { days, exhausted } : { days };
    saving = saving.then(() => kv.set('budget', value)).catch(e => console.warn('budget:', (e && e.message) || e));
  }
  const sum = o => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const capOf = () => { const c = Number(getCap()); return Number.isFinite(c) && c >= 0 ? c : 1.5; };

  function record(usage, kind = 'other', model = '') {
    const k = KINDS.includes(kind) ? kind : 'other';
    const yuan = costOf(usage, k, model);
    if (!yuan) return 0;
    const d = ymd(now());
    const day = days[d] || (days[d] = {});
    day[k] = (day[k] || 0) + yuan;
    persist();
    return yuan;
  }

  function today() {
    const d = ymd(now());
    const byKind = { ...(days[d] || {}) };
    const total = sum(byKind);
    const cap = capOf();
    return { date: d, total, byKind, cap, left: Math.max(0, cap - total) };
  }

  // 0 as the cap means no daily cap (the parent area may allow it); a per-kind cap only counts when set above 0
  function blockReason(kind = 'other') {
    const t = today();
    if (exhausted && exhausted === t.date) return 'month';
    if (t.cap && t.total >= t.cap) return 'day';
    const k = KINDS.includes(kind) ? kind : 'other';
    let caps = {};
    try { caps = getKindCaps() || {}; } catch (e) { caps = {}; }
    const kc = Number(caps[k]);
    if (kc > 0 && (t.byKind[k] || 0) >= kc) return 'kind';
    return '';
  }
  const canSpend = kind => !blockReason(kind);

  function month() {
    const m = ymd(now()).slice(0, 7);
    const byKind = {};
    for (const [d, o] of Object.entries(days)) if (d.startsWith(m)) for (const [k, v] of Object.entries(o)) byKind[k] = (byKind[k] || 0) + v;
    return { month: m, total: sum(byKind), byKind };
  }

  return {
    load, record, canSpend, blockReason, today, month,
    markExhausted: () => { exhausted = ymd(now()); persist(); },
    clearExhausted: () => { if (exhausted) { exhausted = ''; persist(); } },
    exhausted: () => !!exhausted && exhausted === ymd(now()),
    reset: () => { days = {}; exhausted = ''; persist(); },
    saved: () => saving,
  };
}

// tts.js takes a fetchImpl: this one stops paid synthesis over the cap and records the characters it used.
// Only POSTs to the TTS endpoint are touched; the audio download and everything else pass straight through.
export function wrapFetch(fetchImpl, budget, { ttsUrl = TTS_URL } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  return async (url, opts = {}) => {
    const isTTS = (String(url) === ttsUrl || String(url) === TTS_SPEECH_URL) && (opts.method || 'GET').toUpperCase() === 'POST';
    let ttsModel = TTS_MODEL;
    try { ttsModel = JSON.parse(opts.body).model || TTS_MODEL; } catch (e) { /* not JSON: the older model */ }
    if (!isTTS || !budget) return f(url, opts);
    if (!budget.canSpend('tts')) {
      return new Response(JSON.stringify({ code: 'AppDailyCap', message: 'daily cap reached in app' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    const res = await f(url, opts);
    try {
      const data = await res.clone().json();
      if (res.ok && data && data.usage) budget.record(data.usage, 'tts', ttsModel);
      else if (res.status === 429 && isBudgetExhausted(429, data) && budget.markExhausted) budget.markExhausted();
    } catch (e) { /* not JSON: nothing to record */ }
    return res;
  };
}
