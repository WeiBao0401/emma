// 花费：按返回的用量估算花了多少钱，App 内每天封顶（DESIGN 10.7），认出百炼“预算用完”的 429（不重试）。
// 负责：记录与花费 agent（events.js、budget.js）。
// 状态：骨架，能用。isBudgetExhausted 已按百炼的固定文案实现（ai.js 靠它决定不重试）；价格、分类限额、
// 持久化的细节由负责的 agent 调整。
//
// 导出
//   KINDS                                  花费类别：'lookup' 查词、'tts' 朗读、'hint' 提示讲解、'story' 写故事、
//                                          'reflect' 每周反思、'photo' 拍照识别、'other'
//   PRICES                                 { model: [输入元/百万 token, 输出元/百万 token] }，TTS 是 { 'qwen3-tts-flash': 元/万字符 }
//   budgetKindOf(aiKind) -> kind           ai.js 的任务名（core / lexicon / practice / zh / story / hint ...）到花费类别
//   costOf(usage, kind, model) -> 元       纯函数。usage 是接口返回的 usage：chat 用 {prompt_tokens, completion_tokens}，
//                                          TTS 用 {characters}；认不出的返回 0
//   isBudgetExhausted(status, data) -> bool   纯函数：百炼“预算管理达到即停”返回的 429（中英文两句固定文案）
//   createBudget({ kv, now, getCap }) -> { load, record, canSpend, today, month, reset }
//     load() -> Promise                    启动时读 kv 'budget'
//     record(usage, kind, model?) -> 元     记一笔（同步更新内存，异步写 kv），返回这笔估算的钱
//     canSpend(kind) -> bool               今天的总花费还没到上限（getCap() 元，默认 settings.dailyCapYuan = 1.5）
//     today() -> { date, total, byKind, cap, left }
//     month() -> { month: 'YYYY-MM', total, byKind }
//   wrapFetch(fetchImpl, budget, { ttsUrl }) -> fetch   给 tts.js 用的 fetch：超额时直接回一个 429，成功时按 usage.characters 记账
//
// 依赖：kv 是 app.js 传来的 { get(key), set(key, value) }（异步）；config.js 的 TTS_URL、TTS_MODEL。
import { TTS_URL, TTS_MODEL } from './config.js';

export const KINDS = ['lookup', 'tts', 'hint', 'story', 'reflect', 'photo', 'other'];

// CNY, 2026-10-24 Bailian Beijing list prices (DESIGN 10.6)
export const PRICES = {
  'qwen3.8-flash': [0.8, 2.7],
  'qwen3.7-flash': [0.2, 0.8],
  'qwen3.7-plus': [2, 8],
  'qwen3.8-max': [12, 36],
  'qwen-plus': [0.8, 2],
  [TTS_MODEL]: 0.8,   // per 10,000 characters
};

const AI_KIND = { core: 'lookup', lexicon: 'lookup', practice: 'lookup', zh: 'lookup', story: 'story', hint: 'hint', reflect: 'reflect', photo: 'photo' };
export const budgetKindOf = aiKind => AI_KIND[aiKind] || (KINDS.includes(aiKind) ? aiKind : 'other');

export function costOf(usage, kind, model = '') {
  if (!usage || typeof usage !== 'object') return 0;
  if (kind === 'tts' || usage.characters != null) {
    const per = typeof PRICES[TTS_MODEL] === 'number' ? PRICES[TTS_MODEL] : 0.8;
    return (Number(usage.characters) || 0) / 10000 * per;
  }
  const p = Array.isArray(PRICES[model]) ? PRICES[model] : PRICES['qwen3.7-plus'];
  const inT = Number(usage.prompt_tokens || usage.input_tokens) || 0;
  const outT = Number(usage.completion_tokens || usage.output_tokens) || 0;
  return (inT * p[0] + outT * p[1]) / 1e6;
}

// DESIGN 10.7 / research 05 F1: the two fixed sentences Bailian sends when the key's monthly budget stops calls
const EXHAUSTED = ['预算额度已用尽', 'budget configured in budget management has been exhausted'];
export function isBudgetExhausted(status, data) {
  if (status !== 429) return false;
  const e = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error : data) : {};
  const text = (String(e.message || '') + ' ' + String(e.code || '') + ' ' + (typeof data === 'string' ? data : '')).toLowerCase();
  return EXHAUSTED.some(s => text.includes(s));
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KEEP_DAYS = 62;

export function createBudget({ kv, now = () => new Date(), getCap = () => 1.5 } = {}) {
  let days = {};   // { 'YYYY-MM-DD': { kind: yuan } }
  let saving = Promise.resolve();

  async function load() {
    try { const v = await kv.get('budget'); days = (v && v.days) || {}; } catch (e) { days = {}; }
  }
  function persist() {
    const keys = Object.keys(days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
    saving = saving.then(() => kv.set('budget', { days })).catch(e => console.warn('budget:', (e && e.message) || e));
  }
  const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

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
    const cap = Number(getCap()) || 0;
    return { date: d, total, byKind, cap, left: Math.max(0, cap - total) };
  }
  // v0: one cap for everything. The responsible agent may add per-kind caps (DESIGN 10.7 “分类日限额”).
  const canSpend = () => { const t = today(); return !t.cap || t.total < t.cap; };

  function month() {
    const m = ymd(now()).slice(0, 7);
    const byKind = {};
    for (const [d, o] of Object.entries(days)) if (d.startsWith(m)) for (const [k, v] of Object.entries(o)) byKind[k] = (byKind[k] || 0) + v;
    return { month: m, total: sum(byKind), byKind };
  }

  return { load, record, canSpend, today, month, reset: () => { days = {}; persist(); }, saved: () => saving };
}

// tts.js takes a fetchImpl: this one stops paid synthesis over the cap and records the characters it used.
// Only POSTs to the TTS endpoint are touched; the audio download and everything else pass straight through.
export function wrapFetch(fetchImpl, budget, { ttsUrl = TTS_URL } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  return async (url, opts = {}) => {
    const isTTS = String(url) === ttsUrl && (opts.method || 'GET').toUpperCase() === 'POST';
    if (!isTTS || !budget) return f(url, opts);
    if (!budget.canSpend('tts')) {
      return new Response(JSON.stringify({ code: 'AppDailyCap', message: 'daily cap reached in app' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    const res = await f(url, opts);
    try {
      const data = await res.clone().json();
      if (res.ok && data && data.usage) budget.record(data.usage, 'tts', TTS_MODEL);
    } catch (e) { /* not JSON: nothing to record */ }
    return res;
  };
}
