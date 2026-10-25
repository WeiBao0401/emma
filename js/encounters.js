// “会写了”复查和遇见计数（roadmap-gaps 第 8 项；DESIGN 5.1、5.8）。纯逻辑，不碰 DOM，Node 里直接测。
// 负责：gaps-a agent（encounters.js、tests/gaps-a.test.mjs）。界面上的接线（词条、单词本、热身）写在 wip/b6/gaps-a-needs.md。
//
// ---------------------------------------------------------------- 1. “会写了”复查
// 一个词达到“会写了”（weekly.js metDays，或 kv 'weekly.tally'.written 记过）那天是 since。第 7 天、第 21 天各考一次拼写
// （热身里出成字母块；plan.js 读 recheckDue 的词）。考对：往下一档，第 21 天也对了就算“稳了”（steady）。考错：退回“在练”
// （back = 那天），单词本、词条不再显示“会写”。退回以后重新挣回来：在 back 那天以后，不同的两天各有一次干净的拼对
// （没看提示、没亮答案），第二次那天当新的 since，再走一遍 7、21 天。学校听写本拍回来打了叉的词（mistakes.js）也直接退回。
// 考没考、对没对，不靠界面回调：settleRecheck 看事件里到期那天以后她第一次拼这个词（answer 的 mode tiles / keys / cloze / paper，
// 或 dictation 事件）。所以 ui-lesson 照常记 answer 就行。
//
//   RECHECK_KEY = 'write.recheck'；RECHECK_DAYS = [7, 21]；REEARN_DAYS = 2；SPELL_MODES
//   normRecheck(raw) -> State；readRecheck(kv) -> State
//   writtenOf({ kv, events }) -> { slug: 'YYYY-MM-DD' }   和 wordbook.buildFacts 一样：tally.written 加 metDays，早的那天为准
//   syncRecheck(state, { written, events, now }) -> State   新会写的词排上第 7 天；退回的词挣回来了就重新排
//   settleRecheck(state, events, now) -> { state, results: [{ slug, ok, day, at }] }   到期以后她拼过了，记对错、往下排或退回
//   applyRecheck(state, slug, { ok, now }) -> State   直接记一次复查（测试和以后的界面用）
//   markBack(state, slug, { now, why }) -> State       直接退回“在练”（why：'recheck' | 'school'）
//   recheckDue(state, now, { max = 3, exclude }) -> [{ slug, item: 'w:<slug>', mode: 'tiles', kind: 'recheck', step, day: 7 | 21, due, since }]
//   backSlugs(state) -> Set   现在是“退回在练”的词
//   applyBack(written, state) -> { slug: day }   written 去掉退回的词（wordbook levelOf、weekly 用它就对了）
//   writeStatus(slug, written, state) -> 'steady' | 'write' | 'back' | ''
//   update(kv, { events, now, written? }) -> Promise<{ state, changed, results }>   一次做完：读、sync、settle、有变化才写 kv
//
//   kv 'write.recheck'（新键，随备份导出）= { v: 1, items: { slug: { since, step: 0 等第 7 天 | 1 等第 21 天 | 2 稳了, due: 'YYYY-MM-DD' | null,
//     steady: '' | 日子, back: '' | 日子, why: '' | 'recheck' | 'school', results: [{ day, ok, step, at }]（最近 10 条）, rounds（第几轮） } }, updated }
//
// ---------------------------------------------------------------- 2. 遇见计数（DESIGN 5.1：“遇见 7 次：故事 3 次，想出来 4 次”）
// 不另存：从已有的数据现算，所以老数据一样有数。一次算一个来源：
//   story   故事：kv 'story:progress'.words[slug].n（阅读器自己记的遇见次数）
//   read    阅读：课文陪读 kv 'textread:<id>' 每读完一遍（reads 里一条），句子里有这个词就算一次
//   chat    问老师：事件 ask（step 'chat'）的 words 里有它、lookup from 'chat'，一条算一次
//   recall  想出来（复习）：同一节课（sid）里这个词的 answer / review / dictation 事件算一次（热身、写几个词、单词本练一下、听写）
//   countAll({ kv, events, entries, lemma? }) -> Map<slug, Count>；Count = { slug, n, story, read, chat, recall }
//   countOf(slug, ctxArgs) -> Count
//   metLabel(count) -> '遇见 7 次：故事 3 次，想出来 4 次'（0 的来源不写；一次都没有返回 ''）
//   lowMet(counts, slugs, { min = MET_LOW }) -> [slug]   遇见不到 10 次的，少的在前（给下一集挑目标词）
//   MET_LOW = 10；SOURCE_ZH = { story: '故事', read: '阅读', chat: '问老师', recall: '想出来' }
import { metDays, TALLY_KEY } from './weekly.js';

export const RECHECK_KEY = 'write.recheck';
export const RECHECK_DAYS = [7, 21];
export const REEARN_DAYS = 2;
export const MET_LOW = 10;
export const SPELL_MODES = new Set(['tiles', 'keys', 'cloze', 'paper']);
export const SOURCE_ZH = { story: '故事', read: '阅读', chat: '问老师', recall: '想出来' };

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? '' : String(v));
const low = v => str(v).toLowerCase().trim();
const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function addDays(day, n) { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); }
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(str(s));
const isoLocal = x => {
  const d = toDate(x), off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const peek = (kv, k, d = null) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d; } catch (e) { return d; } };
const slugOfEvent = e => str(e.slug) || (str(e.item).startsWith('w:') ? str(e.item).slice(2) : '');

// ---------------------------------------------------------------- 1. recheck

function normItem(raw) {
  const r = obj(raw);
  if (!isDay(r.since)) return null;
  return {
    since: r.since, step: Math.max(0, Math.min(2, Number(r.step) || 0)), due: r.due === null ? null : isDay(r.due) ? r.due : null,
    steady: isDay(r.steady) ? r.steady : '', back: isDay(r.back) ? r.back : '', why: str(r.why),
    results: arr(r.results).filter(x => x && isDay(x.day)).map(x => ({ day: x.day, ok: !!x.ok, step: Number(x.step) || 0, at: str(x.at) })).slice(-10),
    rounds: Math.max(1, Number(r.rounds) || 1),
  };
}
export function normRecheck(raw) {
  const r = obj(raw);
  const items = {};
  for (const [slug, it] of Object.entries(obj(r.items))) { const n = normItem(it); if (slug && n) items[slug] = n; }
  return { v: 1, items, updated: str(r.updated) };
}
export const readRecheck = kv => normRecheck(peek(kv, RECHECK_KEY, null));

export function writtenOf({ kv = null, events = [] } = {}) {
  const out = {};
  for (const [slug, d] of Object.entries(obj(obj(peek(kv, TALLY_KEY, null)).written))) if (isDay(str(d).slice(0, 10))) out[slug] = str(d).slice(0, 10);
  let met = {};
  try { met = metDays(arr(events)) || {}; } catch (e) { met = {}; }
  for (const [slug, d] of Object.entries(met)) { const x = str(d).slice(0, 10); if (isDay(x) && (!out[slug] || x < out[slug])) out[slug] = x; }
  return out;
}

const fresh = (since, rounds = 1) => ({ since, step: 0, due: addDays(since, RECHECK_DAYS[0]), steady: '', back: '', why: '', results: [], rounds });

// a spelling try of this word: answer in a spelling mode, or a dictation mark
const isSpell = e => e && ((e.type === 'answer' && SPELL_MODES.has(e.mode)) || e.type === 'dictation');
const cleanRight = e => e.correct === true && !(Number(e.hint_level) > 0) && !e.revealed;

function spellsOf(events) {
  const by = new Map();
  for (const e of arr(events)) {
    if (!isSpell(e) || !e.at) continue;
    const s = slugOfEvent(e);
    if (!s) continue;
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(e);
  }
  for (const l of by.values()) l.sort((a, b) => str(a.at).localeCompare(str(b.at)));
  return by;
}

export function syncRecheck(state, { written = {}, events = [], now = new Date() } = {}) {
  const s = normRecheck(state);
  const today = dayOf(now);
  const spells = spellsOf(events);
  for (const [slug, d0] of Object.entries(obj(written))) {
    const d = str(d0).slice(0, 10);
    if (!isDay(d) || d > today) continue;
    const it = s.items[slug];
    if (!it) { s.items[slug] = fresh(d); continue; }
    if (!it.back) continue;
    // back to 在练: two clean spellings on two different days after the day it went back earn 会写了 again
    const days = [...new Set(arr(spells.get(slug)).filter(e => cleanRight(e) && dayOf(e.at) > it.back && dayOf(e.at) <= today).map(e => dayOf(e.at)))].sort();
    if (days.length >= REEARN_DAYS) s.items[slug] = { ...fresh(days[REEARN_DAYS - 1], it.rounds + 1), results: it.results };
  }
  // words that went back without ever being in written (school dictation) can earn it the same way
  for (const [slug, it] of Object.entries(s.items)) {
    if (!it.back || written[slug]) continue;
    const days = [...new Set(arr(spells.get(slug)).filter(e => cleanRight(e) && dayOf(e.at) > it.back && dayOf(e.at) <= today).map(e => dayOf(e.at)))].sort();
    if (days.length >= REEARN_DAYS) s.items[slug] = { ...fresh(days[REEARN_DAYS - 1], it.rounds + 1), results: it.results };
  }
  return s;
}

export function applyRecheck(state, slug, { ok = false, now = new Date() } = {}) {
  const s = normRecheck(state);
  const it = s.items[slug];
  if (!it || it.back || it.due === null) return s;
  const day = dayOf(now);
  const results = [...it.results, { day, ok: !!ok, step: it.step, at: isoLocal(now) }].slice(-10);
  if (!ok) { s.items[slug] = { ...it, results, back: day, why: 'recheck', due: null }; return s; }
  const step = it.step + 1;
  if (step >= RECHECK_DAYS.length) { s.items[slug] = { ...it, results, step: 2, due: null, steady: day }; return s; }
  const planned = addDays(it.since, RECHECK_DAYS[step]);
  const soonest = addDays(day, 1);
  s.items[slug] = { ...it, results, step, due: planned > soonest ? planned : soonest };
  return s;
}

export function markBack(state, slug, { now = new Date(), why = 'school' } = {}) {
  const s = normRecheck(state);
  if (!slug) return s;
  const day = dayOf(now);
  const it = s.items[slug] || { ...fresh(day), rounds: 1 };
  s.items[slug] = { ...it, back: day, why, due: null, steady: '' };
  return s;
}

export function settleRecheck(state, events = [], now = new Date()) {
  let s = normRecheck(state);
  const today = dayOf(now);
  const spells = spellsOf(events);
  const results = [];
  for (const [slug, it] of Object.entries(s.items)) {
    if (it.back || !it.due || it.due > today) continue;
    // the first spelling of this word on or after the day it was due (one try a day: the first of that day)
    const e = arr(spells.get(slug)).find(x => dayOf(x.at) >= it.due && dayOf(x.at) <= today && x.first_try !== false);
    if (!e) continue;
    const ok = cleanRight(e);
    s = applyRecheck(s, slug, { ok, now: toDate(e.at) });
    results.push({ slug, ok, day: dayOf(e.at), at: str(e.at) });
  }
  return { state: s, results };
}

export function recheckDue(state, now = new Date(), { max = 3, exclude = null } = {}) {
  const s = normRecheck(state);
  const today = dayOf(now);
  const skip = exclude instanceof Set ? exclude : new Set(arr(exclude));
  return Object.entries(s.items)
    .filter(([slug, it]) => !it.back && it.due && it.due <= today && !skip.has(slug))
    .sort((a, b) => a[1].due.localeCompare(b[1].due) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([slug, it]) => ({ slug, item: 'w:' + slug, mode: 'tiles', kind: 'recheck', step: it.step, day: RECHECK_DAYS[it.step], due: it.due, since: it.since }));
}

export function backSlugs(state) {
  const s = normRecheck(state);
  return new Set(Object.entries(s.items).filter(([, it]) => it.back).map(([slug]) => slug));
}
export function applyBack(written = {}, state = null) {
  const back = backSlugs(state);
  const out = {};
  for (const [slug, d] of Object.entries(obj(written))) if (!back.has(slug)) out[slug] = d;
  return out;
}
export function writeStatus(slug, written = {}, state = null) {
  const it = normRecheck(state).items[slug];
  if (it && it.back) return 'back';
  if (it && it.steady) return 'steady';
  return obj(written)[slug] || it ? 'write' : '';
}

export async function update(kv, { events = [], now = new Date(), written = null } = {}) {
  const before = peek(kv, RECHECK_KEY, null);
  const w = written || writtenOf({ kv, events });
  const synced = syncRecheck(before, { written: w, events, now });
  const { state, results } = settleRecheck(synced, events, now);
  const a = JSON.stringify(normRecheck(before).items), b = JSON.stringify(state.items);
  const changed = a !== b;
  if (changed && kv && typeof kv.set === 'function') {
    state.updated = isoLocal(now);
    try { await kv.set(RECHECK_KEY, state); } catch (e) { /* kv full: next time */ }
  }
  return { state, changed, results };
}

// ---------------------------------------------------------------- 2. encounters

// a word in a sentence: the headword itself, or its plain inflections (cats, watches, played, playing, Tom's)
function formsOf(hw) {
  const w = low(hw);
  if (!w || /\s/.test(w)) return new Set([w]);
  const out = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + "'s"]);
  if (/y$/.test(w)) { out.add(w.slice(0, -1) + 'ies'); out.add(w.slice(0, -1) + 'ied'); }
  if (/e$/.test(w)) out.add(w.slice(0, -1) + 'ing');
  return out;
}
const tokens = s => low(s).replace(/[’‘`]/g, "'").split(/[^a-z']+/).map(t => t.replace(/^'+|'+$/g, '')).filter(Boolean);

function wordIndex(entries, lemma) {
  const single = new Map();   // form -> slug
  const phrases = [];         // [{ text, slug }]
  for (const e of arr(entries)) {
    if (!e || !e.slug) continue;
    const hw = low(e.headword || e.slug.replace(/-/g, ' '));
    if (!hw) continue;
    if (/\s/.test(hw)) { phrases.push({ text: hw, slug: e.slug }); continue; }
    for (const f of formsOf(hw)) if (!single.has(f)) single.set(f, e.slug);
  }
  const find = t => single.get(t) || (lemma ? single.get(low(safeCall(lemma, t))) : null) || null;
  return {
    inText(text) {
      const found = new Set();
      for (const t of tokens(text)) { const s = find(t); if (s) found.add(s); }
      const l = ' ' + tokens(text).join(' ') + ' ';
      for (const p of phrases) if (l.includes(' ' + p.text + ' ')) found.add(p.slug);
      return found;
    },
    word(w) { const t = low(w); return single.get(t) || phrases.find(p => p.text === t)?.slug || (lemma ? single.get(low(safeCall(lemma, t))) : null) || null; },
  };
}
const safeCall = (f, x) => { try { return typeof f === 'function' ? f(x) : (f && typeof f.get === 'function' ? f.get(x) : '') || ''; } catch (e) { return ''; } };

const blank = slug => ({ slug, n: 0, story: 0, read: 0, chat: 0, recall: 0 });

export function countAll({ kv = null, events = [], entries = [], lemma = null } = {}) {
  const out = new Map();
  const bump = (slug, k, n = 1) => { if (!slug || !(n > 0)) return; if (!out.has(slug)) out.set(slug, blank(slug)); const c = out.get(slug); c[k] += n; c.n += n; };
  const idx = wordIndex(entries, lemma);
  const known = new Set(arr(entries).map(e => e && e.slug).filter(Boolean));
  const keep = slug => !known.size || known.has(slug);
  // story: the reader's own count
  for (const [slug, w] of Object.entries(obj(obj(peek(kv, 'story:progress', null)).words))) if (keep(slug)) bump(slug, 'story', Math.max(0, Number(obj(w).n) || 0));
  // 课文陪读: every finished read of a page meets the words in its sentences once
  let keys = [];
  try { keys = kv && typeof kv.keys === 'function' ? kv.keys('textread:') : []; } catch (e) { keys = []; }
  for (const k of keys) {
    const rec = obj(peek(kv, k, null));
    const reads = arr(rec.reads).filter(r => r && r.done).length || (arr(rec.reads).length ? 1 : 0);
    if (!reads) continue;
    const met = new Set();
    for (const s of arr(rec.sentences)) for (const slug of idx.inText(obj(s).en)) met.add(slug);
    for (const slug of met) bump(slug, 'read', reads);
  }
  // 问老师 and recall from the events
  const recall = new Set();
  for (const e of arr(events)) {
    if (!e) continue;
    if (e.type === 'ask' && e.step === 'chat') {
      const seen = new Set();
      for (const w of arr(e.words)) { const s = idx.word(typeof w === 'string' ? w : w && (w.slug || w.w || w.word)) || (w && w.slug) || ''; if (s && !seen.has(s)) { seen.add(s); bump(s, 'chat'); } }
    } else if (e.type === 'lookup' && e.from === 'chat') {
      const s = str(e.slug) || idx.word(e.query);
      if (s) bump(s, 'chat');
    } else if (e.type === 'answer' || e.type === 'review' || e.type === 'dictation') {
      const s = slugOfEvent(e);
      if (!s || !keep(s)) continue;
      const key = `${str(e.sid) || dayOf(e.at || Date.now())}|${s}`;
      if (recall.has(key)) continue;
      recall.add(key);
      bump(s, 'recall');
    }
  }
  return out;
}

export const countOf = (slug, args = {}) => countAll(args).get(slug) || blank(slug);

export function metLabel(c) {
  if (!c || !(c.n > 0)) return '';
  const parts = ['story', 'read', 'chat', 'recall'].filter(k => c[k] > 0).map(k => `${SOURCE_ZH[k]} ${c[k]} 次`);
  return `遇见 ${c.n} 次：${parts.join('，')}`;
}

export function lowMet(counts, slugs = [], { min = MET_LOW } = {}) {
  const m = counts instanceof Map ? counts : new Map();
  const n = s => (m.get(s) || { n: 0 }).n;
  return arr(slugs).filter(s => n(s) < min).map((s, i) => [s, i]).sort((a, b) => n(a[0]) - n(b[0]) || a[1] - b[1]).map(x => x[0]);
}
