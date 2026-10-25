// 记事件：每次作答、进出课、听写打勾、查词…… 写进 IndexedDB "emma" 的 events 表（DESIGN 3.1，teacher-memory 2.1）。
// 负责：记录与花费 agent（events.js、budget.js）。
// 状态：v0 做完：事件日志、按条件查、180 天清理、简单统计（每题型首答正确率、用时、本周做了几天）、
// 词的预测（FSRS 记得概率，teacher-memory 10.1）和预测记分（命中率、Brier、校准）。按天汇总留给 v1。
//
// 导出
//   EVENT_TYPES                      事件类型清单（见下），新类型只增不改名
//   MODES                            作答题型：'mc4' 四选一、'listen' 听音选词、'tiles' 字母块、'keys' 键盘、'cloze'、'order' 连词成句、'paper' 纸笔、
//                                    'card' 闪卡、'grammar' 语法题、'read' 读后题（0.4.0）、'transform' 句型转换、'verb' 找动词（0.5.0）、
//                                    'forms' 变形配对（0.6.0；'cloze' 是句子里回想）、'mistake' 错题再考（0.7.0）
//   normalizeEvent(ev, now) -> rec   纯函数：补 at、去掉 undefined、校验 type；不认识的 type 抛错
//   isoLocal(date) -> '2026-11-03T19:42:11+08:00'
//   predictCorrect(entry, now, { mode }) -> 0..1   纯函数：这个词这次做对的概率（见“词的预测”）
//   summarize(events, now) -> Stats  纯函数：见 stats()
//   scorePredictions(events) -> PredStats   纯函数：见 predictionStats()
//   pairPredictions(events) -> predict[]    纯函数：带结果的 predict；出题前记的（没有 correct）配上同一节课（sid）
//                                            同一题（item，没有就 'w:'+slug）的下一条 'answer'
//   weekDaysOf(events, now) -> number        纯函数：这周（周一起）做完课的天数
//   lessonDaysOf(events) -> ['YYYY-MM-DD']   纯函数：做完过课的日子（有 session_end 且 completed 不是 false）
//   createEvents({ store, now }) -> { log, query, recent, count, sessionId, trim,
//                                     predict, logPrediction, stats, predictionStats, weekDays, lessonDays }
//     log(event) -> Promise<rec>     写一条；返回带 id 的记录。写失败只 console.warn，返回 null，不抛（作答不能因为记录失败卡住）
//     query({ since, until, type, slug, unit, mode, limit }) -> Promise<rec[]>   按时间从旧到新
//         since / until：ISO 字符串或 Date，含两端（只写日期 'YYYY-MM-DD' 也行）；不给就不限。type 可以是字符串或数组
//     recent(n = 50) -> Promise<rec[]>   最近 n 条，新的在前
//     count() -> Promise<number>
//     sessionId() -> string           开一节课时调用一次，得到 'YYYY-MM-DD-HHMMSS'，之后这节课的事件都带 sid
//     trim(days = EVENTS_KEEP_DAYS) -> Promise<number>   删掉更早的原始事件，返回删了几条
//     predict(entry, { mode }) -> number        出题前调用（评分之前，卡片还没变），= predictCorrect(entry, now())
//     logPrediction({ entry?, p?, correct, slug?, mode?, sid?, step?, item? }) -> Promise<rec|null>
//         作答后记一条 'predict' 事件：{ item, slug, mode, p_base, p_teacher, correct }。p 不给就用 entry 现算
//         （那时卡片可能已经评过分，所以最好出题前先 predict 存下来）。v0 老师和对照一样：p_teacher = p_base
//     stats({ since, until }) -> Promise<Stats>   默认看最近 28 天
//         Stats = { byMode: { mc4: { n, right, rate, avgMs, medianMs } }, all: { n, right, rate, avgMs, medianMs },
//                   weekDays, predictions: PredStats }
//         只算 'answer' 里 first_try 不是 false 的（首答）；rate 是首答正确率；用时超过 60 秒的按 60 秒算
//     predictionStats({ since, until }) -> Promise<PredStats>
//         PredStats = { n, hits, hitRate, brier, teacherHitRate, teacherBrier, gain, calibration: [{ lo, hi, n, p, rate }] }
//         命中：概率 ≥ 0.5 当作“会做对”，和结果一致；gain = 老师命中率减对照命中率（v0 恒为 0）
//     weekDays() -> Promise<number>       本周做了几天（周一起）
//     lessonDays({ since }) -> Promise<['YYYY-MM-DD']>   给 plan 的 state.lessonDays 用（第一节课、回归日）
//
// 词的预测（teacher-memory 10.1，v0 只做词）
//   r = FSRS 记得概率（fsrs.retrievability）；新卡还没有记录，按 NEW_CARD_PRIOR 算（课本词课上都见过）。
//   题型能蒙对的那部分加上去：p = r + (1 - r) × GUESS[mode]（四选一、听音选词 1/4，拼写和纸笔 0）。
//   以后按她这类题型的首答正确率校正、再加笔记本的判断（p_teacher），v0 两个一样。
//
// 一条事件（字段名是约定，别改）：
//   { id, type, at, sid?, step?, item?, slug?, unit?, mode?, choice?, correct?, first_try?, ms?, hint_level?,
//     misconception?, ...type 自己的字段 }
//   type          见 EVENT_TYPES
//   at            ISO 时间（本地时区偏移，normalizeEvent 补）
//   sid           这节课的编号（sessionId 返回值）；课外的事件（查词）没有
//   step          'warmup' | 'read' | 'write' | 'wrap' | 'dictation' | 'onboard' | 'look'
//   item          题目编号：'w:<slug>' 单词题、'g:<语法点>:<题>'、'ep:<集>:<题>'、'line:<句子 id>'
//   slug          单词（words.js 的 slug）
//   unit          课本单元 id（curriculum.unitOf 的返回值），不知道就不写
//   mode          MODES 之一
//   choice        她选的那个选项（文字或 id）
//   correct       true / false
//   first_try     是不是这道题第一次作答
//   ms            从出题到作答的毫秒数
//   hint_level    看到第几级提示（0 = 没看提示）
//   misconception 她选的那个干扰项的误解标签（curriculum/tags.json；单词题用 form / category / meaning / sound），答对为 null
//   'predict' 自己的字段：p_base、p_teacher（0..1，三位小数）
//
// 依赖：config.js（EVENTS_KEEP_DAYS）、fsrs.js（retrievability、State）；store 是 db.js 的 idbStore（addEvent、
// eventsBetween、eventsBy、countEvents、deleteEventsBefore），Node 测试里换成内存假的（tests/lib.mjs memStore）。
import { EVENTS_KEEP_DAYS } from './config.js';
import { retrievability, State } from './fsrs.js';

export const EVENT_TYPES = [
  'session_start', 'session_end', 'answer', 'skip', 'exit', 'feel', 'flag', 'review', 'dictation', 'lookup', 'ask',
  'parent_note', 'predict', 'hint', 'spell', 'line', 'onboard',
  // v1: “这不对” on the weekly page (weekly.js dispute: line_id, choice, about; step 'weekly')
  'dispute',
  // 0.4.0 读一段 (reader.js): a “看不懂” tap on a sentence (level 1 断句, 2 关键词, 3 整句中文) and the time one reading took
  'read_help', 'read_time',
  // 0.7.0 难度反馈 (kid-me.js recordFeedback): step, part, choice easy|ok|hard, level, prev, changed, from button|chat,
  // sid?, item?, mode?, text?
  'feedback',
  // 0.8.0 读出来 (ui-readaloud.js): item 'ep:<集>:s<句>', mode 'read', step, sid, sentence, recorded, ms, plays, compared,
  // checked, missed?
  'read_aloud',
];
// card: the flashcard the warm-up falls back to when four choices cannot be built (ui-lesson.js)
// grammar: a grammar card or warm-up grammar question (grammar.js, ui-grammar.js; v1)
// read: a question after a story episode (reader.js, 0.4.0); order: 连词成句 (modes/order.js, 0.4.0)
export const MODES = ['mc4', 'listen', 'tiles', 'keys', 'cloze', 'order', 'paper', 'card', 'grammar', 'read', 'transform', 'verb', 'forms', 'mistake'];

export const NEW_CARD_PRIOR = 0.5;                               // a card never reviewed here: met in class, not yet checked
export const GUESS = { mc4: 0.25, listen: 0.25, cloze: 0, tiles: 0, keys: 0, order: 0, paper: 0, card: 0, read: 0.25, forms: 0.25 };
export const MS_CAP = 60000;                                     // answers slower than this count as 60 s in the averages
export const STATS_DAYS = 28;

const pad = n => String(n).padStart(2, '0');
// Local time with its offset, e.g. 2026-11-03T19:42:11+08:00 (teacher-memory 2.2)
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function normalizeEvent(ev, now = new Date()) {
  if (!ev || typeof ev !== 'object') throw new Error('event must be an object');
  if (!EVENT_TYPES.includes(ev.type)) throw new Error('unknown event type: ' + ev.type);
  const out = {};
  for (const [k, v] of Object.entries(ev)) if (v !== undefined && k !== 'id') out[k] = v;
  if (!out.at) out.at = isoLocal(now);
  return out;
}

const iso = x => (x instanceof Date ? isoLocal(x) : x ? String(x) : '');
const round3 = x => Math.round(x * 1000) / 1000;

// ---- word predictions (teacher-memory 10.1)
export function predictCorrect(entry, now = new Date(), { mode = 'mc4' } = {}) {
  const card = entry && (entry.fsrs || (entry.state !== undefined && entry.stability !== undefined ? entry : null));
  const r = !card || card.state === State.New || !card.last_review ? NEW_CARD_PRIOR : retrievability(card, now);
  const g = GUESS[mode] ?? 0;
  return round3(Math.min(1, Math.max(0, r + (1 - r) * g)));
}

// A predict event either carries its outcome (logPrediction, after the answer) or was written before the question
// (ui-lesson): then it is paired with the next 'answer' for the same item in the same lesson (sid).
export function pairPredictions(events = []) {
  const out = [], pending = new Map();
  const key = e => (e.sid || '') + '|' + (e.item || (e.slug ? 'w:' + e.slug : ''));
  const sorted = events.filter(Boolean).map((e, i) => [e, i])
    .sort((a, b) => String(a[0].at || '').localeCompare(String(b[0].at || '')) || (a[0].id ?? a[1]) - (b[0].id ?? b[1])).map(x => x[0]);
  for (const e of sorted) {
    if (e.type === 'predict' && Number.isFinite(e.p_base)) {
      if (typeof e.correct === 'boolean') out.push(e); else pending.set(key(e), e);
    } else if (e.type === 'answer' && typeof e.correct === 'boolean' && pending.has(key(e))) {
      out.push({ ...pending.get(key(e)), correct: e.correct });
      pending.delete(key(e));
    }
  }
  return out;
}

export function scorePredictions(events = []) {
  const list = pairPredictions(events);
  const n = list.length;
  const score = key => {
    let hits = 0, sq = 0;
    for (const e of list) {
      const p = Number.isFinite(e[key]) ? e[key] : e.p_base;
      if ((p >= 0.5) === e.correct) hits++;
      sq += (p - (e.correct ? 1 : 0)) ** 2;
    }
    return { hits, hitRate: n ? round3(hits / n) : null, brier: n ? round3(sq / n) : null };
  };
  const base = score('p_base'), teacher = score('p_teacher');
  const calibration = [];
  for (let i = 0; i < 5; i++) {
    const lo = i / 5, hi = (i + 1) / 5;
    const inBin = list.filter(e => e.p_base >= lo && (i === 4 ? e.p_base <= hi : e.p_base < hi));
    if (!inBin.length) continue;
    calibration.push({ lo, hi, n: inBin.length,
      p: round3(inBin.reduce((a, e) => a + e.p_base, 0) / inBin.length),
      rate: round3(inBin.filter(e => e.correct).length / inBin.length) });
  }
  return { n, hits: base.hits, hitRate: base.hitRate, brier: base.brier, teacherHitRate: teacher.hitRate, teacherBrier: teacher.brier,
    gain: n ? round3(teacher.hitRate - base.hitRate) : null, calibration };
}

// ---- simple stats (DESIGN 3.1 学习基础 / 习惯)
function msStats(ms) {
  if (!ms.length) return { avgMs: null, medianMs: null };
  const s = ms.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return { avgMs: Math.round(s.reduce((a, x) => a + x, 0) / s.length), medianMs: s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2) };
}
function rateOf(list) {
  const right = list.filter(e => e.correct === true).length;
  const ms = list.map(e => e.ms).filter(x => Number.isFinite(x) && x > 0).map(x => Math.min(x, MS_CAP));
  return { n: list.length, right, rate: list.length ? round3(right / list.length) : null, ...msStats(ms) };
}

export function lessonDaysOf(events = []) {
  const days = new Set();
  for (const e of events) if (e && e.type === 'session_end' && e.completed !== false && e.at) days.add(String(e.at).slice(0, 10));
  return [...days].sort();
}
function mondayOf(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export function weekDaysOf(events = [], now = new Date()) {
  const lo = dayOf(mondayOf(now)), hi = dayOf(now);
  return lessonDaysOf(events).filter(d => d >= lo && d <= hi).length;
}

export function summarize(events = [], now = new Date()) {
  const answers = events.filter(e => e && e.type === 'answer' && typeof e.correct === 'boolean' && e.first_try !== false);
  const byMode = {};
  for (const m of new Set(answers.map(e => e.mode || 'other'))) byMode[m] = rateOf(answers.filter(e => (e.mode || 'other') === m));
  return { byMode, all: rateOf(answers), weekDays: weekDaysOf(events, now), predictions: scorePredictions(events) };
}

export function createEvents({ store, now = () => new Date() } = {}) {
  async function log(event) {
    let rec;
    try { rec = normalizeEvent(event, now()); } catch (e) { console.warn('events:', e.message); return null; }
    try {
      const id = await store.addEvent(rec);
      return { ...rec, id };
    } catch (e) {
      console.warn('events: not saved:', (e && e.message) || e);
      return null;
    }
  }

  async function query({ since = '', until = '', type = null, slug = '', unit = '', mode = '', limit = 5000 } = {}) {
    const lo = iso(since), hi = iso(until);
    let list;
    try { list = await store.eventsBetween(lo, hi ? hi + '￿' : '', limit); }
    catch (e) { console.warn('events: query failed:', (e && e.message) || e); return []; }
    const types = type ? [].concat(type) : null;
    if (types) list = list.filter(e => types.includes(e.type));
    if (slug) list = list.filter(e => e.slug === slug);
    if (unit) list = list.filter(e => e.unit === unit);
    if (mode) list = list.filter(e => e.mode === mode);
    return list;
  }

  async function recent(n = 50) {
    const list = await store.eventsBetween('', '', 100000);
    return list.slice(-n).reverse();
  }

  // unique across reloads without a counter: the start time to the second
  const sessionId = () => isoLocal(now()).slice(0, 19).replace('T', '-').replace(/:/g, '');

  async function trim(days = EVENTS_KEEP_DAYS) {
    try {
      const cut = new Date(now().getTime() - days * 864e5);
      const before = await store.countEvents();
      await store.deleteEventsBefore(isoLocal(cut));
      return Math.max(0, before - (await store.countEvents()));
    } catch (e) {
      console.warn('events: trim failed:', (e && e.message) || e);
      return 0;
    }
  }

  const predict = (entry, { mode = 'mc4' } = {}) => predictCorrect(entry, now(), { mode });

  async function logPrediction({ entry = null, p = undefined, correct, slug = '', mode = 'mc4', sid, step, item } = {}) {
    if (typeof correct !== 'boolean') return null;
    const s = slug || (entry && entry.slug) || '';
    const pb = Number.isFinite(p) ? round3(p) : predictCorrect(entry, now(), { mode });
    return log({ type: 'predict', sid, step, item: item || (s ? 'w:' + s : undefined), slug: s || undefined, mode,
      p_base: pb, p_teacher: pb, correct });
  }

  const defaultSince = () => new Date(now().getTime() - STATS_DAYS * 864e5);

  async function stats({ since = defaultSince(), until = '' } = {}) {
    const t = now();
    const list = await query({ since, until, limit: 100000 });
    // the week can start before `since`; count its lesson days on their own
    const week = await query({ since: mondayOf(t), type: 'session_end', limit: 100000 });
    return { ...summarize(list, t), weekDays: weekDaysOf(week, t) };
  }

  async function predictionStats({ since = defaultSince(), until = '' } = {}) {
    return scorePredictions(await query({ since, until, type: ['predict', 'answer'], limit: 100000 }));
  }

  async function weekDays() {
    const t = now();
    return weekDaysOf(await query({ since: mondayOf(t), type: 'session_end', limit: 100000 }), t);
  }

  async function lessonDays({ since = '' } = {}) {
    return lessonDaysOf(await query({ since, type: 'session_end', limit: 100000 }));
  }

  return { log, query, recent, count: () => store.countEvents(), sessionId, trim,
    predict, logPrediction, stats, predictionStats, weekDays, lessonDays };
}
