// 记事件：每次作答、进出课、听写打勾、查词…… 写进 IndexedDB "emma" 的 events 表（DESIGN 3.1，teacher-memory 2.1）。
// 负责：记录与花费 agent（events.js、budget.js）。
// 状态：骨架。normalizeEvent 和 createEvents 的形状已定，别的 agent 按这个调用；内部实现（清理 180 天前的、
// 按天汇总）由负责的 agent 补。
//
// 导出
//   EVENT_TYPES                      事件类型清单（见下），新类型只增不改名
//   MODES                            作答题型：'mc4' 四选一、'listen' 听音选词、'tiles' 字母块、'keys' 键盘、'cloze'、'order'、'paper' 纸笔
//   normalizeEvent(ev, now) -> rec   纯函数：补 at、去掉 undefined、校验 type；不认识的 type 抛错
//   createEvents({ store, now }) -> { log, query, recent, count, sessionId, trim }
//     log(event) -> Promise<rec>     写一条；返回带 id 的记录。写失败只 console.warn，不抛（作答不能因为记录失败卡住）
//     query({ since, until, type, slug, unit, mode, limit }) -> Promise<rec[]>   按时间从旧到新
//         since / until：ISO 字符串或 Date，含两端；不给就不限。type 可以是字符串或数组
//     recent(n = 50) -> Promise<rec[]>   最近 n 条，新的在前
//     count() -> Promise<number>
//     sessionId() -> string           开一节课时调用一次，得到 'YYYY-MM-DD-HHMMSS'，之后这节课的事件都带 sid
//     trim(days = EVENTS_KEEP_DAYS) -> Promise<number>   删掉更早的原始事件（v0 可以先不调）
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
//
// 依赖：config.js（EVENTS_KEEP_DAYS）；store 是 db.js 的 idbStore（addEvent、eventsBetween、eventsBy、countEvents、
// deleteEventsBefore），Node 测试里换成内存假的。
import { EVENTS_KEEP_DAYS } from './config.js';

export const EVENT_TYPES = [
  'session_start', 'session_end', 'answer', 'skip', 'exit', 'feel', 'flag', 'review', 'dictation', 'lookup', 'ask',
  'parent_note', 'predict', 'hint', 'spell', 'line', 'onboard',
];
export const MODES = ['mc4', 'listen', 'tiles', 'keys', 'cloze', 'order', 'paper'];

const pad = n => String(n).padStart(2, '0');
// Local time with its offset, e.g. 2026-11-03T19:42:11+08:00 (teacher-memory 2.2)
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function normalizeEvent(ev, now = new Date()) {
  if (!ev || typeof ev !== 'object') throw new Error('event must be an object');
  if (!EVENT_TYPES.includes(ev.type)) throw new Error('unknown event type: ' + ev.type);
  const out = {};
  for (const [k, v] of Object.entries(ev)) if (v !== undefined && k !== 'id') out[k] = v;
  if (!out.at) out.at = isoLocal(now);
  return out;
}

const iso = x => (x instanceof Date ? isoLocal(x) : x ? String(x) : '');

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
    let list = await store.eventsBetween(lo, hi ? hi + '￿' : '', limit);
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
    const cut = new Date(now().getTime() - days * 864e5);
    await store.deleteEventsBefore(isoLocal(cut));
    return 0;
  }

  return { log, query, recent, count: () => store.countEvents(), sessionId, trim };
}
