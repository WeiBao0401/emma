// 连词成句（第 2 批，PLAN-tonight 第 6 项）：把打乱的词块排成一句英语。Emma 语法弱，最常错的是“顺序”：
// 问句不把 Is / Do / Can 提前、not 放错、形容词放到名词后面、地点时间插在中间、频度副词放错。这是写作的第一步。
// 老师的做法：给中文意思，她点词块排句子；排错了，对的开头留着，后面的退回去，同时自动出第 1 级提示（这类句子的顺序规则）；
// 再错一次，自动多给一级：第 2 级替她放好第一块（说为什么从它开始），第 3 级放好前一半，第 4 级整句给出来、讲为什么，
// 马上换一句同类的“现在你来”，自己排对才算这一类过关。排对以后整句读一遍、显示中文和“为什么这样排”。
// 句子在 curriculum/order.json（预写、逐词核过，只用她认识的词），按语法卡分组；还没开始的“下个单元”的卡（频度副词）先不出。
// 负责：接线 agent（第 2 批，连词成句那个 agent 断线没写成）。样式 css/order.css（类名 ord-），测试 tests/order.test.mjs。
//
// 导出
//   FILE、KV_KEY = 'order.state'、MODE = 'order'、HINT_MAX = 4、WRITE_N = 3、REVIEW_DAYS = [1, 3, 7]、SECONDS = 45
//   loadOrder({ fetchJSON }) -> Promise<Content>；setContent(data)；content()
//   createContent(data) -> Content = { patterns: { id: Pattern }, items: [Item], item(id), pattern(id), byPattern(id) -> [Item] }
//     Pattern = { id, name, card, point, tag, rule, frame, first }
//     Item = { id, pattern, card, point, tag, en, zh, tiles: [text]（正确顺序）, alts: [[下标]], why, from, end（句末标点）, n（几块） }
//   readState(kv) / normState(raw) / emptyState()   kv 'order.state'（新键）：
//     { v: 1, items: { id: { n, last: 'YYYY-MM-DD', grade, passed, clean, step: 0..3, due: 'YYYY-MM-DD' | null } }, updated }
//   allowedItem(item, grammar) -> bool   grammar = grammar.js grammarState(kv)（或它的 cards）：ahead 的卡（频度副词）开了头才出
//   writeItems(stateOrKv, now, { content, grammar, n }) -> [id]   “写几个词”那天的 3 句：先出到期的复习，再出没见过的
//                                                                 （一句一类，按天轮换先后），都见过了出最久没见的；同一天结果一样
//   warmItem(stateOrKv, now, { content, grammar, skip }) -> [id]   热身偶尔混 1 句：有到期的复习就出它，否则隔一天出一句
//   variantFor(item, { content, grammar, exclude }) -> Item | null   同一类里换一句
//   orderSummary(stateOrKv, now, { content }) -> { tried, clean, fuzzy, failed, due, kinds }   家长区“学得怎么样”用
//   accepted(item) -> [[text]]；sentenceOf(item, texts?) -> 带大写和标点的整句；keptOf(item, texts) -> 从头对了几块
//   isRight(item, texts) -> bool
//   shuffleTiles(item, rng) -> [{ id, text }]   打乱，保证不是任何一种对的顺序（只有一种排法的 2 块句子除外）
//   createOrderAttempt(item, { rng, now }) -> Attempt   一句的状态：tap / undo / check / hint / reveal（见函数注释）
//   applyResult(state, { id, grade, clean, passed, now }) -> State   作答结果写进进度（纯函数）
//   nameSwaps(list, picked) -> [[默认名, 她起的名]]；renameItem(item, swaps)   故事里她换过的名字，句子里跟着换
//   renderOrder(container, ctx, { items, sid, step, onDone, title, swaps, rng }) -> { el, onKey, stop, next }
//     一串句子画进 container。ctx 用到 kv（'order.state'）、events.log、say、content 没读到时的 fetchJSON；
//     onDone({ done, results: [{ id, item, grade, passed, clean }], right })。
//
// 事件（CONTRACTS 第 6 节）
//   answer { item: 'o:<id>', mode: 'order', step, sid, pattern, point, card, choice（她排的整句）, correct, first_try, ms, hint_level,
//            misconception（排错时是这一类的标签：q_order、not_order、adj_order、place_time、there_order、wh_order、adv_position、word_order）,
//            done?, passed?, grade?, variant?, of? }   每次“检查”记一条；done 那条是这句的结局
//   hint   { item, mode: 'order', step, sid, level, hint_level, auto }
//   flag   { item, mode: 'order', step, sid }   “这题有问题”：跳过、不记分
import { h, icon } from '../ui-dom.js';

export const FILE = 'curriculum/order.json';
export const KV_KEY = 'order.state';
export const MODE = 'order';
export const HINT_MAX = 4;
export const WRITE_N = 3;
export const REVIEW_DAYS = [1, 3, 7];
export const SECONDS = 45;

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); };
const dayNum = day => { const [y, m, d] = day.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const str = x => (x == null ? '' : String(x));
const low = s => str(s).toLowerCase();
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(str(s));

// ---------------------------------------------------------------- content

let cached = null;

export function createContent(data) {
  const d = data && typeof data === 'object' ? data : {};
  const patterns = {};
  for (const [id, p] of Object.entries(d.patterns || {})) {
    patterns[id] = { id, name: str(p.name), card: p.card || null, point: str(p.point), tag: str(p.tag) || 'word_order',
      rule: str(p.rule), frame: str(p.frame), first: str(p.first) };
  }
  const items = [];
  for (const raw of Array.isArray(d.items) ? d.items : []) {
    if (!raw || !raw.id || !Array.isArray(raw.tiles) || raw.tiles.length < 2 || !patterns[raw.pattern]) continue;
    const p = patterns[raw.pattern];
    const en = str(raw.en).trim();
    const end = /[.?!]$/.test(en) ? en.slice(-1) : '.';
    items.push({
      id: str(raw.id), pattern: p.id, card: raw.card !== undefined ? raw.card : p.card, point: p.point, tag: p.tag,
      en, zh: str(raw.zh), tiles: raw.tiles.map(str), alts: (Array.isArray(raw.alts) ? raw.alts : []).filter(a => Array.isArray(a) && a.length === raw.tiles.length),
      why: str(raw.why), from: str(raw.from), end, n: raw.tiles.length,
    });
  }
  const byId = new Map(items.map(it => [it.id, it]));
  return {
    version: d.version || 1,
    patterns, items,
    item: id => byId.get(str(id).replace(/^o:/, '')) || null,
    pattern: id => patterns[id] || null,
    byPattern: id => items.filter(it => it.pattern === id),
  };
}
export function setContent(data) { cached = data ? createContent(data) : null; return cached; }
export function content() { return cached; }
export async function loadOrder({ fetchJSON } = {}) {
  if (cached) return cached;
  if (typeof fetchJSON !== 'function') throw new Error('order: no fetchJSON');
  return setContent(await fetchJSON(FILE));
}

// ---------------------------------------------------------------- her progress (kv 'order.state')

export const emptyState = () => ({ v: 1, items: {}, updated: '' });
export function normState(raw) {
  const out = emptyState();
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, r] of Object.entries(raw.items && typeof raw.items === 'object' ? raw.items : {})) {
    if (!r || typeof r !== 'object') continue;
    out.items[id] = { n: Math.max(0, Number(r.n) || 0), last: isDay(r.last) ? r.last : '', grade: Number(r.grade) || 0, passed: !!r.passed,
      clean: !!r.clean, step: Math.max(0, Math.min(REVIEW_DAYS.length, Number(r.step) || 0)), due: isDay(r.due) ? r.due : null };
  }
  out.updated = str(raw.updated);
  return out;
}
export function readState(kv) {
  try { return normState(kv && typeof kv.peek === 'function' ? kv.peek(KV_KEY, null) : null); } catch (e) { return emptyState(); }
}
const stateOf = x => (x && typeof x.peek === 'function' ? readState(x) : normState(x));

// after one sentence: a clean first try moves the review ladder on (1, 3, 7 days from the miss); anything else starts it again
export function applyResult(state, { id, grade = 1, clean = false, passed = false, now = new Date() } = {}) {
  const s = normState(state);
  const today = dayOf(now);
  const prev = s.items[id] || { n: 0, step: 0, due: null };
  const rec = { n: prev.n + 1, last: today, grade, passed: !!passed, clean: !!clean, step: 0, due: null };
  if (!clean) rec.due = addDays(today, REVIEW_DAYS[0]);
  else if (prev.due) {
    rec.step = Math.min(REVIEW_DAYS.length, (prev.step || 0) + 1);
    rec.due = rec.step < REVIEW_DAYS.length ? addDays(today, REVIEW_DAYS[rec.step] - REVIEW_DAYS[rec.step - 1]) : null;
  }
  s.items[id] = rec;
  s.updated = now.toISOString();
  return s;
}

// ---------------------------------------------------------------- which sentences

// a "下个单元" card (ahead: the frequency adverbs) waits until its card has been started; everything else is hers already
const AHEAD = new Set(['freq_adverb']);
export function allowedItem(item, grammar = null) {
  if (!item) return false;
  if (!AHEAD.has(item.card)) return true;
  const cards = grammar && grammar.cards ? grammar.cards : grammar || {};
  const g = cards[item.card];
  return !!(g && g.parts && Object.values(g.parts).some(p => p && p.started));
}

// patterns whose grammar card she is working on come first (what she practises in the card, she orders here)
function workingCards(grammar) {
  const cards = grammar && grammar.cards ? grammar.cards : grammar || {};
  const out = new Set();
  for (const [id, g] of Object.entries(cards)) if (g && g.parts && Object.values(g.parts).some(p => p && p.started)) out.add(id);
  return out;
}

function pool(c, grammar) { return c ? c.items.filter(it => allowedItem(it, grammar)) : []; }

export function writeItems(stateOrKv, now = new Date(), { content: c = cached, grammar = null, n = WRITE_N, skip = [] } = {}) {
  const s = stateOf(stateOrKv);
  const today = dayOf(now);
  const list = pool(c, grammar).filter(it => !skip.includes(it.id));
  if (!list.length) return [];
  const out = [];
  const used = new Set();
  const add = it => { if (it && !out.includes(it.id) && out.length < n) { out.push(it.id); used.add(it.pattern); } };
  // 1 the reviews that are due, oldest first
  list.filter(it => s.items[it.id] && s.items[it.id].due && s.items[it.id].due <= today)
    .sort((a, b) => s.items[a.id].due.localeCompare(s.items[b.id].due) || a.n - b.n).forEach(add);
  if (out.length >= n) return out;
  // 2 sentences she has not met: one per kind, the kinds of her grammar cards first, the starting kind turning day by day
  const working = workingCards(grammar);
  const kinds = [...new Set(list.map(it => it.pattern))];
  const turn = dayNum(today) % Math.max(1, kinds.length);
  const rotated = [...kinds.slice(turn), ...kinds.slice(0, turn)];
  const firstOf = k => c.pattern(k) && working.has(c.pattern(k).card) ? 0 : 1;
  const ordered = rotated.map((k, i) => [k, i]).sort((a, b) => firstOf(a[0]) - firstOf(b[0]) || a[1] - b[1]).map(x => x[0]);
  const unseen = k => list.filter(it => it.pattern === k && !s.items[it.id]).sort((a, b) => a.n - b.n || list.indexOf(a) - list.indexOf(b));
  for (const k of ordered) { if (out.length >= n) break; if (!used.has(k)) add(unseen(k)[0]); }
  for (const k of ordered) { if (out.length >= n) break; add(unseen(k)[0]); }
  // 3 all met: the ones she saw longest ago (a sentence not passed before the clean ones)
  if (out.length < n) {
    list.filter(it => s.items[it.id] && !out.includes(it.id) && s.items[it.id].last !== today)
      .sort((a, b) => (s.items[a.id].last || '').localeCompare(s.items[b.id].last || '') || (s.items[a.id].clean ? 1 : 0) - (s.items[b.id].clean ? 1 : 0) || list.indexOf(a) - list.indexOf(b))
      .forEach(add);
  }
  return out;
}

// the warm-up now and then (every other day, or a review that is due): one sentence, never one of today's write sentences
export function warmItem(stateOrKv, now = new Date(), { content: c = cached, grammar = null, skip = [] } = {}) {
  const s = stateOf(stateOrKv);
  const today = dayOf(now);
  const list = pool(c, grammar).filter(it => !skip.includes(it.id) && !(s.items[it.id] && s.items[it.id].last === today));
  if (!list.length) return [];
  const due = list.filter(it => s.items[it.id] && s.items[it.id].due && s.items[it.id].due <= today)
    .sort((a, b) => s.items[a.id].due.localeCompare(s.items[b.id].due));
  if (due.length) return [due[0].id];
  if (dayNum(today) % 2) return [];
  const pick = writeItems(s, now, { content: c, grammar, n: 1, skip });
  return pick.length && list.some(it => it.id === pick[0]) ? pick : [];
}

export function variantFor(item, { content: c = cached, grammar = null, exclude = [] } = {}) {
  if (!item || !c) return null;
  const same = c.byPattern(item.pattern).filter(it => it.id !== item.id && !exclude.includes(it.id) && allowedItem(it, grammar));
  if (!same.length) return null;
  // the one closest in length, so the variant is about the same size
  return same.slice().sort((a, b) => Math.abs(a.n - item.n) - Math.abs(b.n - item.n) || c.items.indexOf(a) - c.items.indexOf(b))[0];
}

// for the parent page: how many she has ordered, and which kinds of sentence still go wrong
//   -> { tried, clean, fuzzy, failed, due, kinds: [{ id, name, n, clean, missed }]（错得多的在前，只列错过的）}
export function orderSummary(stateOrKv, now = new Date(), { content: c = cached } = {}) {
  const s = stateOf(stateOrKv);
  const today = dayOf(now);
  const out = { tried: 0, clean: 0, fuzzy: 0, failed: 0, due: 0, kinds: [] };
  const by = {};
  for (const [id, r] of Object.entries(s.items)) {
    const it = c ? c.item(id) : null;
    out.tried++;
    if (r.clean) out.clean++; else if (r.passed) out.fuzzy++; else out.failed++;
    if (r.due && r.due <= today) out.due++;
    if (!it) continue;
    const k = by[it.pattern] || (by[it.pattern] = { id: it.pattern, name: (c.pattern(it.pattern) || {}).name || it.pattern, n: 0, clean: 0, missed: 0 });
    k.n++;
    if (r.clean) k.clean++; else k.missed++;
  }
  out.kinds = Object.values(by).filter(k => k.missed).sort((a, b) => b.missed - a.missed || a.clean - b.clean);
  return out;
}

// ---------------------------------------------------------------- the answer

export const accepted = item => [item.tiles.slice(), ...item.alts.map(a => a.map(i => item.tiles[i]))];
const capFirst = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const sentenceOf = (item, texts = item.tiles) => capFirst(texts.join(' ')) + item.end;
const same = (a, b) => a.length === b.length && a.every((t, i) => low(t) === low(b[i]));
export const isRight = (item, texts) => accepted(item).some(a => same(a, texts));
// how many tiles from the start match some right order
export function keptOf(item, texts) {
  let best = 0;
  for (const a of accepted(item)) {
    let k = 0;
    while (k < texts.length && k < a.length && low(texts[k]) === low(a[k])) k++;
    best = Math.max(best, k);
  }
  return best;
}

export function shuffleTiles(item, rng = Math.random) {
  const tiles = item.tiles.map((text, i) => ({ id: 't' + i, text }));
  const rights = accepted(item);
  for (let tries = 0; tries < 30; tries++) {
    const t = tiles.slice();
    for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    if (!rights.some(a => same(a, t.map(x => x.text)))) return t;
  }
  // a rng that keeps landing on the answer: turn it round
  return tiles.slice().reverse();
}

// One sentence as plain state.
//   tap(id) puts a tile at the end of her line (or takes a placed one back, with the ones after it);
//   undo() takes the last one back (never a tile the teacher placed); check() when every tile is down ->
//   { correct, done, kept, level, auto?: { level, text }, event }; hint() -> { level, text } | null; reveal() -> { event }.
//   level: the hints she has seen. Wrong once: level 1 comes by itself; each later miss adds one; level 4 is the answer.
//   locked: tiles the teacher placed (hint 2: the first tile, hint 3: the first half), they stay put.
export function createOrderAttempt(item, { rng = Math.random, now = () => Date.now(), pattern = null } = {}) {
  const bank = shuffleTiles(item, rng);
  const t0 = now();
  let placed = [];
  let locked = 0;
  let level = 0;
  let checks = 0;
  let done = false, correct = false, revealed = false;
  const byId = id => bank.find(t => t.id === id);
  const texts = () => placed.map(t => t.text);
  const hintText = n => {
    const p = pattern || {};
    if (n === 1) return p.rule || '想一想英语句子的顺序。';
    if (n === 2) return `${p.first || ''}第一块是“${sentenceOf(item, [item.tiles[0]]).replace(/[.?!]$/, '')}”。`;
    if (n === 3) return `前一半放好了。顺序是：${p.frame || '谁 + 做什么 + 其他'}。`;
    return `整句是：${sentenceOf(item)}${item.why ? ' ' + item.why : ''}`;
  };
  // the teacher puts the first k tiles of a right order down (the one her line is closest to, so a right beginning of hers
  // stays); tiles she placed after them go back to the bank: the next tile is hers to find
  function lockTo(k) {
    const her = texts();
    let best = accepted(item)[0], m = 0;
    for (const acc of accepted(item)) {
      let j = 0;
      while (j < her.length && j < acc.length && low(her[j]) === low(acc[j])) j++;
      if (j > m) { m = j; best = acc; }
    }
    k = Math.min(Math.max(k, locked), item.tiles.length - 1);
    const n = Math.min(Math.max(k, m), item.tiles.length - 1);
    const left = bank.slice();
    placed = best.slice(0, n).map(text => { const i = left.findIndex(t => low(t.text) === low(text)); return left.splice(i, 1)[0]; });
    locked = k;
  }
  function raise(n, auto) {
    level = Math.max(level, Math.min(HINT_MAX, n));
    if (level === 2) lockTo(Math.max(1, locked));
    if (level === 3) lockTo(Math.max(Math.ceil(item.tiles.length / 2), locked));
    return { level, text: hintText(level), auto };
  }
  const api = {
    item, bank,
    get placed() { return placed.slice(); },
    get texts() { return texts(); },
    get locked() { return locked; },
    get level() { return level; },
    get done() { return done; },
    get correct() { return correct; },
    get revealed() { return revealed; },
    get full() { return placed.length === bank.length; },
    get checks() { return checks; },
    used: id => placed.some(t => t.id === id),
    tap(id) {
      if (done) return false;
      const i = placed.findIndex(t => t.id === id);
      if (i >= 0) { if (i < locked) return false; placed = placed.slice(0, i); return true; }
      const t = byId(id);
      if (!t) return false;
      placed = [...placed, t];
      return true;
    },
    undo() { if (done || placed.length <= locked) return false; placed = placed.slice(0, -1); return true; },
    hint() {
      if (done || level >= HINT_MAX) return null;
      if (level + 1 >= HINT_MAX) return api.reveal();
      return raise(level + 1, false);
    },
    check() {
      if (done || !api.full) return null;
      checks++;
      const her = texts();
      const ok = isRight(item, her);
      const ev = { choice: sentenceOf(item, her), correct: ok, first_try: checks === 1, ms: now() - t0, hint_level: level,
        misconception: ok ? null : item.tag || 'word_order' };
      if (ok) {
        done = true; correct = true;
        return { correct: true, done: true, kept: her.length, level, event: { ...ev, ...api.result() } };
      }
      const kept = Math.max(locked, keptOf(item, her));
      placed = placed.slice(0, kept);
      // a miss: the next level comes by itself; past level 3 the answer is shown
      if (level + 1 >= HINT_MAX) {
        level = HINT_MAX; done = true; revealed = true;
        return { correct: false, done: true, kept, level, auto: { level, text: hintText(level), auto: true }, event: { ...ev, ...api.result() } };
      }
      const auto = raise(level + 1, true);
      // kept: how many of hers were right from the start (the teacher's own tiles are not hers)
      return { correct: false, done: false, kept: keptOf(item, her), locked, level, auto, event: ev };
    },
    reveal() {
      if (done) return null;
      level = HINT_MAX; done = true; revealed = true;
      return { level, text: hintText(HINT_MAX), auto: false, revealed: true };
    },
    result() {
      const clean = correct && level === 0 && checks === 1;
      return { done: true, passed: correct, grade: correct ? (clean ? 3 : 2) : 1, clean };
    },
  };
  return api;
}

// ---------------------------------------------------------------- her names from the story

export function nameSwaps(list = [], picked = {}) {
  const out = [];
  for (const n of Array.isArray(list) ? list : []) {
    const to = picked && picked[n.key];
    if (n && n.replaceable !== false && n.name && to && to !== n.name) out.push([n.name, to]);
  }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function renameItem(item, swaps = []) {
  if (!item || !swaps.length) return item;
  const res = swaps.map(([from, to]) => [new RegExp(`(?<![A-Za-z])${esc(from)}(?![A-Za-z])`, 'g'), to]);
  const sw = s => res.reduce((x, [re, to]) => x.replace(re, to), s);
  return { ...item, en: sw(item.en), zh: sw(item.zh), why: sw(item.why), tiles: item.tiles.map(sw) };
}

// ---------------------------------------------------------------- the screen

const capWord = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function renderOrder(container, ctx = {}, opts = {}) {
  const { items = [], sid = '', step = 'write', onDone = () => {}, title = '', swaps = [], rng = Math.random, autoNextMs = 1400 } = opts;
  const el = container;
  let stopped = false;
  let keyFn = null;
  let timer = 0;
  let c = null;
  let queue = [];
  let pendingOf = null;        // { base, res }: a sentence she did not get, waiting for its 现在你来
  const results = [];
  const seenNow = new Set();
  const ctl = { el, onKey: ev => { if (keyFn) keyFn(ev); }, stop: () => { stopped = true; clearTimeout(timer); keyFn = null; }, next: () => {} };
  const log = ev => { try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, mode: MODE, ...ev }) : null; } catch (e) { return null; } };
  const speak = (text, btn) => { try { if (text && typeof ctx.say === 'function') ctx.say(text, btn || null); } catch (e) { /* sound is optional */ } };
  const grammar = () => { try { return typeof ctx.grammarState === 'function' ? ctx.grammarState() : null; } catch (e) { return null; } };
  const save = r => {
    try {
      const nextState = applyResult(readState(ctx.kv), { ...r, now: new Date() });
      const p = ctx.kv && typeof ctx.kv.set === 'function' ? ctx.kv.set(KV_KEY, nextState) : null;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* keep going */ }
  };
  const begin = got => {
    if (stopped) return;
    c = got;
    queue = (items || []).map(id => c && c.item(id)).filter(Boolean);
    if (!queue.length) { finish(); return; }
    drawItem(queue.shift(), null);
  };
  const finish = () => {
    keyFn = null;
    if (stopped) return;
    onDone({ done: results.length > 0, results: results.slice(), right: results.filter(r => r.clean).length });
  };
  const have = content();
  if (have) begin(have);
  else loadOrder({ fetchJSON: ctx.fetchJSON }).then(begin, () => { if (!stopped) finish(); });
  return ctl;

  // one sentence; of = the sentence it stands in for (现在你来)
  function drawItem(base, of) {
    const item = renameItem(base, swaps);
    const p = c.pattern(item.pattern) || {};
    const a = createOrderAttempt(item, { rng, pattern: p });
    seenNow.add(base.id);
    const itemId = 'o:' + base.id;
    const extra = { pattern: item.pattern, point: item.point || undefined, card: item.card || undefined, ...(of ? { variant: true, of: 'o:' + of.id } : {}) };
    const ask = h('p', { className: 'ord-ask small', text: '把词块排成这句话的英语。放错了，点它拿回来。' });
    const head = h('div', { className: 'ord-q' },
      of ? h('p', { className: 'ord-now', text: '现在你来，换一句一样的' }) : (title ? h('p', { className: 'ord-title small', text: title }) : null),
      h('p', { className: 'ord-zh', lang: 'zh-CN', text: item.zh }),
      ask);
    const line = h('div', { className: 'ord-line', role: 'group', 'aria-label': '你排的句子' });
    const bankEl = h('div', { className: 'ord-bank', role: 'group', 'aria-label': '词块' });
    const hints = h('ol', { className: 'ord-hints', hidden: true });
    const feedback = h('p', { className: 'ord-feedback', role: 'status', 'aria-live': 'polite' });
    const hintBtn = h('button', { type: 'button', className: 'text-btn accent ord-more', text: '给个提示', on: { click: () => askHint() } });
    const checkBtn = h('button', { type: 'button', className: 'btn ord-check', text: '检查', disabled: true, on: { click: () => check() } });
    const nextBtn = h('button', { type: 'button', className: 'btn ord-next', text: '下一句', hidden: true, on: { click: () => next() } });
    const flagBtn = h('button', { type: 'button', className: 'text-btn ord-flag', text: '这题有问题', on: { click: () => flag() } });
    const bankBtns = new Map(a.bank.map(t => [t.id, h('button', { type: 'button', className: 'ord-tile', lang: 'en', text: t.text, on: { click: () => tap(t.id) } })]));
    let shown = [];
    let left = false;
    let nextAction = null;

    function draw() {
      const placed = a.placed;
      const cells = placed.map((t, i) => h('button', {
        type: 'button', className: 'ord-tile ord-placed' + (i < a.locked ? ' locked' : ''), lang: 'en',
        text: i === 0 ? capWord(t.text) : t.text,
        'aria-label': i < a.locked ? t.text : '拿回 ' + t.text, disabled: a.done || i < a.locked, on: { click: () => tap(t.id) },
      }));
      for (let i = placed.length; i < a.bank.length; i++) cells.push(h('span', { className: 'ord-slot', 'aria-hidden': 'true' }));
      cells.push(h('span', { className: 'ord-end', lang: 'en', text: item.end }));
      line.replaceChildren(...cells);
      for (const [id, b] of bankBtns) {
        const used = a.used(id);
        if (used) b.classList.add('used'); else b.classList.remove('used');
        b.disabled = used || a.done;
        b.setAttribute('aria-hidden', used ? 'true' : 'false');
      }
      checkBtn.disabled = !a.full || a.done;
    }
    function showHint(hn) {
      if (!hn) return;
      shown = shown.filter(x => x.level < hn.level).concat(hn);
      hints.replaceChildren(...shown.map(x => h('li', { className: 'ord-hint' }, h('span', { className: 'ord-n', text: String(x.level) }), h('p', { text: x.text }))));
      hints.hidden = false;
      hintBtn.textContent = '再给个提示';
      log({ type: 'hint', item: itemId, level: hn.level, hint_level: hn.level, auto: !!hn.auto, ...extra });
    }
    function tap(id) {
      if (left || a.done) return;
      if (a.tap(id)) { el.classList.remove('is-wrong'); feedback.textContent = ''; draw(); }
    }
    function askHint() {
      if (left || a.done) return;
      const hn = a.hint();
      if (!hn) return;
      showHint(hn);
      if (hn.revealed) { end(true); return; }
      draw();
    }
    function check() {
      if (left) return;
      const r = a.check();
      if (!r) return;
      log({ type: 'answer', item: itemId, ...extra, ...r.event });
      if (r.correct) { end(false); return; }
      el.classList.add('is-wrong');
      feedback.textContent = r.kept ? `前 ${r.kept} 块对了，后面的再排一排。` : r.locked ? '顺序还不对。老师先放好了开头，你接着排。' : '顺序还不对，再排一排。';
      if (r.auto) showHint(r.auto);
      draw();
      if (r.done) end(false);
    }
    // the sentence is over: right, or the answer shown (by her fourth hint, or the miss after the third)
    function end(byHint) {
      const res = a.result();
      clearTimeout(timer);
      el.classList.remove('is-wrong');
      el.classList.add(a.correct ? 'is-right' : 'is-revealed');
      line.replaceChildren(...item.tiles.map((t, i) => h('span', { className: 'ord-tile ord-placed ' + (a.correct ? 'right' : 'reveal'), lang: 'en', text: i === 0 ? capWord(t) : t })),
        h('span', { className: 'ord-end', lang: 'en', text: item.end }));
      bankEl.hidden = true;
      // the answer shown by her own 第 4 级 hint is the last word on this sentence: one closing answer event
      if (byHint) {
        log({ type: 'answer', item: itemId, ...extra, choice: '', correct: false, first_try: a.checks === 0, ms: 0, hint_level: HINT_MAX,
          misconception: null, revealed: true, ...res });
      }
      const said = a.correct ? (res.clean ? '排对了。' : '对了。这一步记住它。') : '';
      // why it goes this way: the sentence's own note, else the rule (unless the first hint already said it)
      const why = item.why || (shown.some(x => x.level === 1) ? '' : p.rule || '');
      feedback.replaceChildren(said ? h('b', { text: said + (why ? ' ' : '') }) : '', why ? h('span', { className: 'ord-why', text: why }) : '');
      speak(item.en);
      hintBtn.hidden = true;
      checkBtn.hidden = true;
      ask.replaceChildren(h('span', { className: 'ord-en', lang: 'en', text: item.en }),
        h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => speak(item.en, ev.currentTarget) } }, icon('speak')));
      const variant = !a.correct && !of ? variantFor(base, { content: c, grammar: grammar(), exclude: [...seenNow] }) : null;
      if (!of) {
        if (variant) pendingOf = { base, res };
        else { results.push({ id: base.id, item: itemId, ...res }); save({ id: base.id, ...res }); }
      } else {
        // 现在你来 decides the first sentence: right is passed (fuzzy), wrong is not passed
        const orig = pendingOf;
        pendingOf = null;
        const final = { done: true, passed: a.correct, grade: a.correct ? 2 : 1, clean: false };
        if (orig) { results.push({ id: orig.base.id, item: 'o:' + orig.base.id, ...final, variant: base.id }); save({ id: orig.base.id, ...final }); }
        save({ id: base.id, ...res });
      }
      nextBtn.textContent = variant ? '现在你来' : queue.length ? '下一句' : '好了';
      nextBtn.hidden = false;
      nextAction = () => (variant ? drawItem(variant, base) : queue.length ? drawItem(queue.shift(), null) : finish());
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
      if (a.correct && res.clean && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
    }
    function next() {
      if (left || !a.done || !nextAction) return;
      left = true;
      clearTimeout(timer);
      nextAction();
    }
    function flag() {
      if (left) return;
      left = true;
      clearTimeout(timer);
      log({ type: 'flag', item: itemId, ...extra });
      // skipped, not graded (DESIGN 8.3); a 现在你来 that is flagged leaves the first sentence as it was
      if (of && pendingOf) { const orig = pendingOf; pendingOf = null; results.push({ id: orig.base.id, item: 'o:' + orig.base.id, ...orig.res }); save({ id: orig.base.id, ...orig.res }); }
      if (queue.length) drawItem(queue.shift(), null); else finish();
    }
    ctl.next = next;
    keyFn = ev => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (a.done) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); next(); } return; }
      if (ev.key === 'Backspace') { ev.preventDefault(); if (a.undo()) draw(); return; }
      if (ev.key === 'Enter') { if (a.full) { ev.preventDefault(); check(); } return; }
      const n = Number(ev.key);
      if (n >= 1 && n <= a.bank.length) {
        const t = a.bank.filter(x => !a.used(x.id))[n - 1];
        if (t) { ev.preventDefault(); tap(t.id); }
      }
    };
    el.classList.remove('is-right', 'is-revealed', 'is-wrong');
    el.classList.add('ord');
    bankEl.replaceChildren(...bankBtns.values());
    el.replaceChildren(head, line, bankEl, hints, feedback,
      h('div', { className: 'btn-row ord-actions' }, hintBtn, checkBtn, nextBtn),
      h('div', { className: 'ord-tools' }, flagBtn));
    draw();
  }
}
