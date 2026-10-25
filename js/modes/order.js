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
//
// 句型转换（teacher-next 4.2，文件后半部分）：连词成句的下一步。给一句陈述句和新句子的中文，她用词块拼成一般疑问句、否定句、
// 对划线部分提问（What / Where / How many）、主语换成第三人称单数。词块里有干扰块（is 和 are、do 和 does、like 和 likes、my 和 her），
// 用不完。拼错了按错法给提示（diagnose）：问句忘了把 is 提前，“问句要把 is 放到最前面”；否定漏了 not，“否定句在 is 后面加 not，
// 可以缩成 isn't”；三单忘了 -s，指出动词；do / does 用错，讲 he / she / it 用 does。提示阶梯、“现在你来”、1/3/7 天复习都和连词成句一样。
// 句子在 curriculum/transform.json（33 句，每类 8 句以上，覆盖 be、there be、can、一般现在时、物主代词）。
//   T_FILE、T_KV_KEY = 'transform.state'（新键，形状和 order.state 一样）、T_MODE = 'transform'、T_WRITE_N = 3、T_SECONDS = 50、T_KINDS
//   loadTransform({ fetchJSON })；setTransformContent(data)；transformContent()；createTransformContent(data)
//     TItem = { id, kind: 'yn_q' | 'neg' | 'wh_q' | 'third', pattern（= kind）, op: 'be' | 'there' | 'can' | 'do', point, card, en, zh, to, toZh,
//               mark?, was?, who, verb?, answer: [词块], answers: [[词块]]（第一种 + also）, extra: [干扰块], traps: { 干扰块: 话 }, why, end, n }
//   makeTransform(item | id, { rng, swaps, content }) -> Q = { ...TItem, item: 't:<id>', task, rule, frame, bank: [{ id, text }] }
//   diagnose(q, texts) -> null（对了）| { error, tag, text, errors: [{ error, tag, text }] }   tag 是 tags.json 的误解标签
//   createTransformAttempt(q, { now }) -> 和 createOrderAttempt 一样的 tap / undo / check / hint / reveal / result；check 多给 diag
//   renderTransform(container, q, { onAnswer, onHint, onEnd, onDone, onFlag, say, title, variantOf, autoNextMs }) -> { el, attempt, check, hint, next, onKey, stop }
//     画一道。onAnswer(ev) 每次“检查”一次（她点第 4 级提示看答案时另记一条 revealed），onHint(ev) 每级提示一次，sid、step 由调用的人补；
//     onEnd(res) 这句结束时（返回字符串就当“下一句”按钮的字），onDone(res) 她点下一句时。res = { grade, passed, clean, correct, revealed, event }
//   renderTransforms(container, ctx, { items, sid, step, onDone, title, swaps, rng }) -> { el, onKey, stop, next }   一串句子，和 renderOrder 同一个叫法
//     （ctx.kv 存 'transform.state'，ctx.events.log 记事件，错了自动换同一类的一句“现在你来”）
//   transformItems(stateOrKv, now, { content, grammar, n, skip }) -> [id]   “写几个词”那天的 3 句（到期的复习先，再一类一句没见过的）
//   tVariantFor(item, { content, exclude })；transformSummary(stateOrKv, now, { content })（家长区，形状同 orderSummary）
//   readTransformState(kv)；renameTransform(item, swaps)
// 事件
//   answer { item: 't:<id>', mode: 'transform', step, sid, pattern（kind）, op, point, card, choice, correct, first_try, ms, hint_level,
//            misconception（错了时是 tags.json 的标签）, error（错法：aux_front、not_missing、third_s、do_does……）, errors, done?, passed?, grade?, variant?, of?, revealed? }
//   hint   { item, mode: 'transform', level, hint_level, auto, error? }；flag { item, mode: 'transform' }
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

// ================================================================ 句型转换 (teacher-next 4.2)

export const T_FILE = 'curriculum/transform.json';
export const T_KV_KEY = 'transform.state';
export const T_MODE = 'transform';
export const T_WRITE_N = 3;
export const T_SECONDS = 50;
export const T_KINDS = ['yn_q', 'neg', 'wh_q', 'third'];

const T_TASK = { yn_q: '变成一般疑问句', neg: '变成否定句', wh_q: '对划线部分提问' };
// the error -> the misconception tag (tags.json; the five 句型转换 tags were merged into it in 0.5.0)
export const T_ERROR_TAG = {
  aux_front: 'q_order', aux_missing: 'q_order', not_missing: 'not_missing', not_order: 'not_order', be_agree: 'be_agree', there_agree: 'there_be_agree',
  do_does: 'do_does', does_verb_s: 'does_verb_s', modal_s: 'modal_s', modal_do: 'modal_do', be_do_mix: 'be_do_mix', be_extra: 'be_plus_verb',
  third_s: 'third_s_missing', third_s_extra: 'third_s_extra', poss_person: 'poss_person', some_any: 'some_any', plural: 'plural_missing',
  wh_word: 'wh_word', wh_keep: 'wh_keep', wh_order: 'wh_order', extra: 'word_order', missing: 'word_order', order: 'word_order',
};

let tCached = null;

export function createTransformContent(data) {
  const d = data && typeof data === 'object' ? data : {};
  const kinds = {};
  for (const [id, k] of Object.entries(d.kinds || {})) {
    kinds[id] = { id, name: str(k && k.name), task: str(k && k.task), frame: str(k && k.frame), rules: { ...((k && k.rules) || {}) } };
  }
  // the kinds dressed as order.js patterns, so writeItems / orderSummary work on them unchanged
  const patterns = {};
  for (const k of Object.values(kinds)) patterns[k.id] = { id: k.id, name: k.name, card: null, point: '', tag: 'word_order', rule: Object.values(k.rules)[0] || '', frame: k.frame, first: '' };
  const items = [];
  for (const raw of Array.isArray(d.items) ? d.items : []) {
    if (!raw || !raw.id || !kinds[raw.kind] || !Array.isArray(raw.answer) || raw.answer.length < 2) continue;
    const answer = raw.answer.map(str);
    const answers = [answer, ...(Array.isArray(raw.also) ? raw.also : []).filter(a => Array.isArray(a) && a.length >= 2).map(a => a.map(str))];
    const to = str(raw.to).trim();
    const end = /[.?!]$/.test(to) ? to.slice(-1) : raw.kind === 'yn_q' || raw.kind === 'wh_q' ? '?' : '.';
    items.push({
      id: str(raw.id), kind: raw.kind, pattern: raw.kind, op: str(raw.op) || 'be', point: str(raw.point), card: raw.card || null,
      en: str(raw.en).trim(), zh: str(raw.zh), to, toZh: str(raw.to_zh), mark: str(raw.mark), was: str(raw.was), who: str(raw.who), verb: str(raw.verb),
      answer, answers, tiles: answer, extra: (Array.isArray(raw.extra) ? raw.extra : []).map(str),
      traps: raw.traps && typeof raw.traps === 'object' ? { ...raw.traps } : {}, why: str(raw.why), end, n: answer.length,
    });
  }
  const byId = new Map(items.map(it => [it.id, it]));
  return {
    version: d.version || 1,
    kinds, patterns, items, tags: { ...(d.tags || {}) },
    item: id => byId.get(str(id).replace(/^t:/, '')) || null,
    kind: id => kinds[id] || null,
    pattern: id => patterns[id] || null,
    byPattern: id => items.filter(it => it.kind === id),
  };
}
export function setTransformContent(data) { tCached = data ? createTransformContent(data) : null; return tCached; }
export function transformContent() { return tCached; }
export async function loadTransform({ fetchJSON } = {}) {
  if (tCached) return tCached;
  if (typeof fetchJSON !== 'function') throw new Error('transform: no fetchJSON');
  return setTransformContent(await fetchJSON(T_FILE));
}

export function readTransformState(kv) {
  try { return normState(kv && typeof kv.peek === 'function' ? kv.peek(T_KV_KEY, null) : null); } catch (e) { return emptyState(); }
}
const tStateOf = x => (x && typeof x.peek === 'function' ? readTransformState(x) : normState(x));

// which sentences on a 句型转换 day: due reviews first, then one unseen sentence of each kind (the kind turning day by day)
export function transformItems(stateOrKv, now = new Date(), { content: c = tCached, grammar = null, n = T_WRITE_N, skip = [] } = {}) {
  return c ? writeItems(tStateOf(stateOrKv), now, { content: c, grammar, n, skip }) : [];
}
export function transformSummary(stateOrKv, now = new Date(), { content: c = tCached } = {}) {
  return orderSummary(tStateOf(stateOrKv), now, { content: c });
}
// 现在你来: the same kind, the same rule (be / there / can / do) when there is one
export function tVariantFor(item, { content: c = tCached, exclude = [] } = {}) {
  if (!item || !c) return null;
  const same = c.byPattern(item.kind).filter(it => it.id !== item.id && !exclude.includes(it.id));
  if (!same.length) return null;
  return same.slice().sort((a, b) => (a.op === item.op ? 0 : 1) - (b.op === item.op ? 0 : 1) || c.items.indexOf(a) - c.items.indexOf(b))[0];
}

export function renameTransform(item, swaps = []) {
  if (!item || !swaps.length) return item;
  const res = swaps.map(([from, to]) => [new RegExp(`(?<![A-Za-z])${esc(from)}(?![A-Za-z])`, 'g'), to]);
  const sw = s => res.reduce((x, [re, to]) => x.replace(re, to), str(s));
  const traps = {};
  for (const [k, v] of Object.entries(item.traps || {})) traps[k] = sw(v);
  const answers = item.answers.map(a => a.map(sw));
  return { ...item, en: sw(item.en), zh: sw(item.zh), to: sw(item.to), toZh: sw(item.toZh), mark: sw(item.mark), was: sw(item.was), who: sw(item.who),
    why: sw(item.why), answer: answers[0], answers, tiles: answers[0], extra: item.extra.map(sw), traps };
}

// ---------------------------------------------------------------- the question

export function makeTransform(itemOrId, { rng = Math.random, swaps = [], content: c = tCached } = {}) {
  const base = typeof itemOrId === 'string' ? (c ? c.item(itemOrId) : null) : itemOrId;
  if (!base || !Array.isArray(base.answers)) return null;
  const it = renameTransform(base, swaps);
  const kind = (c && c.kind(it.kind)) || { rules: {}, frame: '', task: '' };
  // the bank: every tile some right sentence needs (once each), then the distractors
  const need = [];
  for (const a of it.answers) {
    const want = new Map();
    for (const t of a) want.set(low(t), (want.get(low(t)) || 0) + 1);
    for (const [k, n] of want) { const have = need.filter(x => low(x) === k).length; for (let i = have; i < n; i++) need.push(a.find(t => low(t) === k)); }
  }
  for (const t of it.extra) if (!need.some(x => low(x) === low(t))) need.push(t);
  const tiles = need.map((text, i) => ({ id: 't' + i, text }));
  let bank = tiles.slice();
  for (let tries = 0; tries < 30; tries++) {
    const t = tiles.slice();
    for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    bank = t;
    // never the answer already lying in order at the start of the bank
    if (!it.answers.some(a => a.every((x, i) => t[i] && low(t[i].text) === low(x)))) break;
  }
  const task = it.kind === 'third' ? `把主语 ${it.was || '它'} 换成 ${it.who}` : T_TASK[it.kind] || kind.task || '';
  return { ...it, item: 't:' + it.id, task, rule: kind.rules[it.op] || Object.values(kind.rules)[0] || '', frame: kind.frame || '', bank };
}

export const isTransformRight = (q, texts) => q.answers.some(a => same(a, texts));
const tSentence = (q, texts) => capFirst(texts.join(' ')) + q.end;
const prefixLen = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
export function tKeptOf(q, texts) {
  const her = texts.map(low);
  return Math.max(0, ...q.answers.map(a => prefixLen(her, a.map(low))));
}

// ---------------------------------------------------------------- what went wrong (her line against the closest right sentence)

const BE = ['am', 'is', 'are'], BE_N = ["isn't", "aren't"], DO = ['do', 'does'], DO_N = ["don't", "doesn't"], CAN = ['can', "can't"];
const NEG = ['not', "isn't", "aren't", "don't", "doesn't", "can't"];
const WH = ['what', 'where', 'how many', 'what colour'];
const WH_ZH = { what: '问的是“什么”', where: '问的是“在哪儿”', 'how many': '问的是“有几个”', 'what colour': '问的是“什么颜色”' };
const POSS = { my: '我的', your: '你的', his: '他的', her: '她的', its: '它的', our: '我们的', their: '他们的' };
const PRON = ['i', 'you', 'he', 'she', 'it', 'we', 'they'];
const isBe = t => BE.includes(t) || BE_N.includes(t);
const isDo = t => DO.includes(t) || DO_N.includes(t);
const sForm = v => {
  const w = low(v);
  if (w === 'have') return 'has';
  if (w === 'do') return 'does';
  if (/(s|sh|ch|x|z|o)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
};
// a plain verb or noun (likes / like, cats / cat), never is / do / can / a pronoun / not (is is not i + s)
const NOT_PLAIN = new Set([...BE, ...BE_N, ...DO, ...DO_N, ...CAN, ...PRON, 'not', 'its', 'his', 'her', 'my', 'your', 'our', 'their', 'this', 'these']);
const plain = t => /^[a-z]+$/.test(t) && !NOT_PLAIN.has(t);
const minus = (a, b) => { const left = b.slice(); const out = []; for (const t of a) { const i = left.indexOf(t); if (i >= 0) left.splice(i, 1); else out.push(t); } return out; };
const subjOf = q => (PRON.includes(low(q.who)) ? `主语是 ${q.who}` : `主语是 ${q.who}（he / she / it 这一类）`);
const beBase = t => (t === "isn't" ? 'is' : t === "aren't" ? 'are' : t);

export function diagnose(q, texts) {
  if (!q || isTransformRight(q, texts)) return null;
  const her = texts.map(low);
  // the right sentence she is closest to: fewest tiles off, then the longest right beginning
  let A = q.answers[0].map(low), best = Infinity, pre = -1;
  for (const ans of q.answers) {
    const a = ans.map(low);
    const dist = minus(her, a).length + minus(a, her).length;
    const p = prefixLen(her, a);
    if (dist < best || (dist === best && p > pre)) { A = a; best = dist; pre = p; }
  }
  let extra = minus(her, A), missing = minus(A, her);
  const errs = [];
  const add = (error, text) => { if (!errs.some(e => e.error === error)) errs.push({ error, tag: T_ERROR_TAG[error], text }); };
  const sentenceWord = q.kind === 'neg' ? '否定' : '问句';
  const mark = low(q.mark);

  // 1 a question about the underlined part: the question word, the underlined part gone, the question word first
  if (q.kind === 'wh_q') {
    const herWh = her.filter(t => WH.includes(t));
    if (herWh.length && !herWh.includes(A[0])) add('wh_word', `划线部分是“${q.mark}”，${WH_ZH[A[0]] || ''}，用 ${capFirst(A[0])}。`);
    if (mark && her.includes(mark) && !A.includes(mark)) add('wh_keep', `划线部分“${q.mark}”就是要问的，问句里不再说它。`);
    if (!errs.length && her[0] !== A[0]) add('wh_order', `问词放在最前面：${capFirst(A[0])} 开头。`);
  }
  // 2 a negative without not
  if (q.kind === 'neg' && A.some(t => NEG.includes(t)) && !her.some(t => NEG.includes(t))) {
    const n = A.find(t => NEG.includes(t));
    const b = n === 'not' ? A[A.indexOf('not') - 1] : beBase(n);
    if (q.op === 'do') add('not_missing', `说“不做”，在动词前面加 ${n}，后面的动词用原形 ${q.verb}。`);
    else if (q.op === 'can') add('not_missing', '否定句在 can 后面加 not，写成 can\'t。');
    else if (b === 'am') add('not_missing', '否定句在 am 后面加 not：am not。');
    else add('not_missing', `否定句在 ${b} 后面加 not，可以缩成 ${b}n't。`);
  }
  // 3 a do / does question with no do or does at all (and nothing standing in for it)
  if ((q.kind === 'yn_q' || q.kind === 'wh_q') && q.op === 'do' && !her.some(isDo) && !her.some(t => isBe(t) || CAN.includes(t))) {
    const D = A.find(isDo);
    add('aux_missing', q.kind === 'yn_q' ? `这句的动词是 ${q.verb}，问句要在最前面加 ${D}，后面的动词用原形。` : `这句的动词是 ${q.verb}，问词后面要加 ${D}，后面的动词用原形。`);
  }
  // 4 a yes / no question that still starts like the statement
  if (q.kind === 'yn_q' && her[0] !== A[0]) {
    const auxFirst = isBe(her[0]) || isDo(her[0]) || CAN.includes(her[0]);
    if (her.includes(A[0]) || !auxFirst) add('aux_front', `问句要把 ${A[0]} 放到最前面。`);
  }
  // 5 not in the wrong place: it has to come right after am / is / are (I is not tired is a be mistake, not this one)
  if (q.kind === 'neg' && A.includes('not') && her.includes('not')) {
    const before = A[A.indexOf('not') - 1];
    const prev = her[her.indexOf('not') - 1];
    if (!(isBe(prev) || isDo(prev) || CAN.includes(prev))) add('not_order', `not 放在 ${before} 的后面：${before} not。`);
  }
  // 6 a tile in place of the right one
  const rels = [
    (x, y) => (isBe(x) && isDo(y) ? ['be_do_mix', `这句的动词是 ${q.verb}，${sentenceWord}借 ${y}，不用 ${x}。`] : null),
    (x, y) => {
      if (!(isDo(x) && isBe(y))) return null;
      const b = beBase(y);
      const how = q.kind === 'neg' ? `否定直接在 ${b} 后面加 not` : q.kind === 'wh_q' ? `问词后面直接接 ${b}` : `问句直接把 ${b} 放到最前面`;
      return ['be_do_mix', `这句有 ${b}，${how}，不借 ${x}。`];
    },
    (x, y) => (isDo(x) && CAN.includes(y) ? ['modal_do', q.kind === 'neg' ? `原句有 can，否定直接写 can't，不借 ${x}。` : `原句有 can，问句直接把 can 放到最前面，不借 ${x}。`] : null),
    (x, y) => {
      if (!((DO.includes(x) && DO.includes(y)) || (DO_N.includes(x) && DO_N.includes(y)))) return null;
      return ['do_does', /^does/.test(y) ? `${subjOf(q)}，用 ${y}，不用 ${x}。` : `${subjOf(q)}，用 ${y}；${x} 只给 he / she / it 用。`];
    },
    (x, y) => {
      if (!((BE.includes(x) && BE.includes(y)) || (BE_N.includes(x) && BE_N.includes(y)))) return null;
      if (q.op === 'there') return ['there_agree', `There be 看后面的东西：${q.who} 是${/^is/.test(y) ? '一个' : '两个以上'}，用 ${y}，不用 ${x}。`];
      if (y === 'am') return ['be_agree', `主语是 I，用 am，不用 ${x}。`];
      return ['be_agree', `${subjOf(q)}，用 ${y}，不用 ${x}。`];
    },
    (x, y) => (x === 'some' && y === 'any' ? ['some_any', `${q.kind === 'neg' ? '否定句' : '问句'}里“一些”用 any，不用 some。`] : null),
    (x, y) => (A.includes('how many') && A.indexOf(y) === A.indexOf('how many') + 1 && (y === x + 's' || y === x + 'es') ? ['plural', `How many 后面跟名词复数：${y}，不用 ${x}。`] : null),
    (x, y) => (x === 'cans' && y === 'can' ? ['modal_s', 'can 不加 -s，谁后面都用 can。'] : null),
    (x, y) => {
      if (!plain(x) || !plain(y) || x !== sForm(y)) return null;
      const D = A.find(isDo);
      if (D) return ['does_verb_s', `${D} 后面的动词用原形：${y}，不用 ${x}。${/^does/.test(D) ? '-s 已经加在 does 上了。' : ''}`];
      const C = A.find(t => CAN.includes(t));
      if (C) return ['modal_s', `${C} 后面的动词用原形：${y}，不用 ${x}。`];
      return ['third_s_extra', `${subjOf(q)}，动词不加 -s：${y}。`];
    },
    (x, y) => {
      if (!plain(x) || !plain(y) || y !== sForm(x)) return null;
      if (y === 'has') return ['third_s', `${subjOf(q)}，have 要变成 has。`];
      return ['third_s', `${subjOf(q)}，动词要加 ${/es$/.test(y) && !/e$/.test(x) ? '-es' : '-s'}：${y}。`];
    },
    (x, y) => (POSS[x] && POSS[y] ? ['poss_person', q.traps[x] || `这里要用 ${y}（${POSS[y]}），不用 ${x}（${POSS[x]}）。`] : null),
  ];
  for (const rel of rels) {
    let hit = null;
    for (const x of extra) { for (const y of missing) { const r = rel(x, y); if (r) { hit = [x, y, r]; break; } } if (hit) break; }
    if (hit) { add(hit[2][0], hit[2][1]); extra = minus(extra, [hit[0]]); missing = minus(missing, [hit[1]]); }
  }
  // 7 a tile left over: be added to a sentence that has a verb, a trap the item names, or just not wanted
  for (const x of extra) {
    if (BE.includes(x) && !A.some(isBe) && q.verb) {
      const v = A.find(t => t === low(q.verb) || t === sForm(q.verb)) || q.verb;
      add('be_extra', `这句已经有动词 ${v}，不用再加 ${x}。`);
    } else if (q.traps[x]) add(POSS[x] ? 'poss_person' : 'extra', q.traps[x]);
    else if (!((x === mark && errs.some(e => e.error === 'wh_keep')) || (WH.includes(x) && errs.some(e => e.error === 'wh_word')))) add('extra', `“${x}”这块用不上，这句不要它。`);
  }
  // 8 a word question in the wrong order after its question word
  if (q.kind === 'wh_q' && her[0] === A[0] && !errs.length) {
    if (q.op === 'there') add('wh_order', `${capFirst(A[0])} ${A[1]} 后面接 ${A[2]} there：${A[2]} 放在 there 前面。`);
    else add('wh_order', q.op === 'do' ? `问词后面紧跟 ${A[1]}，再说“谁”，最后是动词原形。` : `问词后面紧跟 ${A[1]}，再说“谁”。`);
  }
  if (missing.length && !errs.length) add('missing', '还少了词，再看看下面的词块。');
  if (!errs.length) add('order', `词都对了，顺序再排一排：${q.frame || '谁 + 做什么 + 其他'}。`);
  return { ...errs[0], errors: errs };
}

// ---------------------------------------------------------------- one question as plain state (like createOrderAttempt)

export function createTransformAttempt(q, { now = () => Date.now() } = {}) {
  const bank = q.bank;
  const t0 = now();
  let placed = [];
  let locked = 0, level = 0, checks = 0;
  let done = false, correct = false, revealed = false;
  const byId = id => bank.find(t => t.id === id);
  const texts = () => placed.map(t => t.text);
  const answerText = () => `整句是：${q.to}${q.why ? ' ' + q.why : ''}`;
  const hintText = (n, diag) => {
    if (n >= HINT_MAX) return answerText();
    if (diag) return diag.text + (n === 2 ? ' 老师放好了第一块。' : n === 3 ? ' 老师放好了前一半。' : '');
    if (n === 1) return q.rule || '想一想这类句子怎么变。';
    if (n === 2) return `第一块是“${capFirst(q.answer[0])}”。`;
    return '前一半放好了，接着排。';
  };
  // the teacher puts the first k tiles of the right sentence her line is closest to; what she placed after them goes back
  function lockTo(k) {
    const her = texts().map(low);
    let best = q.answers[0], m = 0;
    for (const acc of q.answers) { const j = prefixLen(her, acc.map(low)); if (j > m) { m = j; best = acc; } }
    k = Math.min(Math.max(k, locked), best.length - 1);
    const n = Math.min(Math.max(k, m), best.length - 1);
    const left = bank.slice();
    placed = best.slice(0, n).map(text => { const i = left.findIndex(t => low(t.text) === low(text)); return left.splice(i, 1)[0]; }).filter(Boolean);
    locked = Math.min(k, placed.length);
  }
  function raise(n, auto, diag) {
    level = Math.max(level, Math.min(HINT_MAX, n));
    if (level === 2) lockTo(Math.max(1, locked));
    if (level === 3) lockTo(Math.max(Math.ceil(q.answer.length / 2), locked));
    return { level, text: hintText(level, diag), auto, error: diag ? diag.error : undefined };
  }
  const api = {
    q, bank,
    get placed() { return placed.slice(); },
    get texts() { return texts(); },
    get locked() { return locked; },
    get level() { return level; },
    get done() { return done; },
    get correct() { return correct; },
    get revealed() { return revealed; },
    get ready() { return placed.length >= 2; },
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
      return raise(level + 1, false, null);
    },
    check() {
      if (done || !api.ready) return null;
      checks++;
      const her = texts();
      const ok = isTransformRight(q, her);
      const diag = ok ? null : diagnose(q, her);
      const ev = { choice: tSentence(q, her), correct: ok, first_try: checks === 1, ms: now() - t0, hint_level: level,
        misconception: diag ? diag.tag : null, error: diag ? diag.error : null, errors: diag ? diag.errors.map(e => e.error) : [] };
      if (ok) {
        done = true; correct = true;
        return { correct: true, done: true, kept: her.length, level, event: { ...ev, ...api.result() } };
      }
      const kept = tKeptOf(q, her);
      placed = placed.slice(0, Math.max(locked, kept));
      if (level + 1 >= HINT_MAX) {
        level = HINT_MAX; done = true; revealed = true;
        return { correct: false, done: true, kept, level, diag, auto: { level, text: answerText(), auto: true, error: diag.error }, event: { ...ev, ...api.result() } };
      }
      const auto = raise(level + 1, true, diag);
      return { correct: false, done: false, kept, locked, level, diag, auto, event: ev };
    },
    reveal() {
      if (done) return null;
      level = HINT_MAX; done = true; revealed = true;
      return { level, text: answerText(), auto: false, revealed: true };
    },
    result() {
      const clean = correct && level === 0 && checks === 1;
      return { done: true, passed: correct, grade: correct ? (clean ? 3 : 2) : 1, clean };
    },
  };
  return api;
}

// ---------------------------------------------------------------- the screen: one question

function fromLine(q, speak) {
  const parts = [];
  const i = q.mark ? q.en.indexOf(q.mark) : -1;
  if (i >= 0) parts.push(q.en.slice(0, i), h('u', { className: 'ord-mark', text: q.mark }), q.en.slice(i + q.mark.length));
  else parts.push(q.en);
  return h('p', { className: 'ord-from', lang: 'en' }, ...parts,
    h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => speak(q.en, ev.currentTarget) } }, icon('speak')));
}

export function renderTransform(container, q, opts = {}) {
  const { onAnswer, onHint, onEnd, onDone, onFlag, say, title = '', variantOf = false, autoNextMs = 1400, now } = opts;
  const el = container;
  const a = createTransformAttempt(q, now ? { now } : {});
  let left = false, timer = 0, shown = [];
  const speak = (text, btn) => { try { if (text && typeof say === 'function') say(text, btn || null); } catch (e) { /* sound is optional */ } };
  const report = (fn, ev) => { if (typeof fn === 'function') { try { return fn(ev); } catch (e) { /* bookkeeping never blocks her */ } } return undefined; };
  const base = { item: q.item, mode: T_MODE, pattern: q.kind, op: q.op, point: q.point || undefined, card: q.card || undefined };

  const ask = h('p', { className: 'ord-ask small', text: '用词块拼出新句子，有几块用不上。放错了，点它拿回来。' });
  const head = h('div', { className: 'ord-q' },
    variantOf ? h('p', { className: 'ord-now', text: '现在你来，换一句一样的' }) : (title ? h('p', { className: 'ord-title small', text: title }) : null),
    fromLine(q, speak),
    h('p', { className: 'ord-from-zh small', lang: 'zh-CN', text: q.zh }),
    h('p', { className: 'ord-task', text: q.task }),
    h('p', { className: 'ord-zh', lang: 'zh-CN', text: q.toZh }),
    ask);
  const line = h('div', { className: 'ord-line', role: 'group', 'aria-label': '你拼的句子' });
  const bankEl = h('div', { className: 'ord-bank', role: 'group', 'aria-label': '词块' });
  const hints = h('ol', { className: 'ord-hints', hidden: true });
  const feedback = h('p', { className: 'ord-feedback', role: 'status', 'aria-live': 'polite' });
  const hintBtn = h('button', { type: 'button', className: 'text-btn accent ord-more', text: '给个提示', on: { click: () => askHint() } });
  const checkBtn = h('button', { type: 'button', className: 'btn ord-check', text: '检查', disabled: true, on: { click: () => check() } });
  const nextBtn = h('button', { type: 'button', className: 'btn ord-next', text: '下一句', hidden: true, on: { click: () => next() } });
  const flagBtn = onFlag ? h('button', { type: 'button', className: 'text-btn ord-flag', text: '这题有问题', on: { click: () => flag() } }) : null;
  const bankBtns = new Map(a.bank.map(t => [t.id, h('button', { type: 'button', className: 'ord-tile', lang: 'en', text: t.text, on: { click: () => tap(t.id) } })]));

  function draw() {
    const placed = a.placed;
    const cells = placed.map((t, i) => h('button', {
      type: 'button', className: 'ord-tile ord-placed' + (i < a.locked ? ' locked' : ''), lang: 'en',
      text: i === 0 ? capWord(t.text) : t.text,
      'aria-label': i < a.locked ? t.text : '拿回 ' + t.text, disabled: a.done || i < a.locked, on: { click: () => tap(t.id) },
    }));
    if (!a.done) cells.push(h('span', { className: 'ord-slot', 'aria-hidden': 'true' }));
    cells.push(h('span', { className: 'ord-end', lang: 'en', text: q.end }));
    line.replaceChildren(...cells);
    for (const [id, b] of bankBtns) {
      const used = a.used(id);
      if (used) b.classList.add('used'); else b.classList.remove('used');
      b.disabled = used || a.done;
      b.setAttribute('aria-hidden', used ? 'true' : 'false');
    }
    checkBtn.disabled = !a.ready || a.done;
  }
  function showHint(hn) {
    if (!hn) return;
    shown = shown.filter(x => x.level < hn.level).concat(hn);
    hints.replaceChildren(...shown.map(x => h('li', { className: 'ord-hint' }, h('span', { className: 'ord-n', text: String(x.level) }), h('p', { text: x.text }))));
    hints.hidden = false;
    hintBtn.textContent = '再给个提示';
    report(onHint, { ...base, level: hn.level, hint_level: hn.level, auto: !!hn.auto, ...(hn.error ? { error: hn.error } : {}) });
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
    report(onAnswer, { ...base, ...r.event });
    if (r.correct) { end(false); return; }
    el.classList.add('is-wrong');
    feedback.textContent = r.done ? '' : r.kept ? `前 ${r.kept} 块对了，后面的再拼一拼。` : r.locked ? '老师先放好了开头，你接着拼。' : '还不对，看看老师的提示。';
    if (r.auto) showHint(r.auto);
    draw();
    if (r.done) end(false);
  }
  // the question is over: right, or the answer shown
  let res = null;
  function end(byHint) {
    const out = a.result();
    clearTimeout(timer);
    el.classList.remove('is-wrong');
    el.classList.add(a.correct ? 'is-right' : 'is-revealed');
    // right: the sentence she made (another right order counts); shown: the first right sentence
    const shownTiles = a.correct ? a.texts : q.answer;
    line.replaceChildren(...shownTiles.map((t, i) => h('span', { className: 'ord-tile ord-placed ' + (a.correct ? 'right' : 'reveal'), lang: 'en', text: i === 0 ? capWord(t) : t })),
      h('span', { className: 'ord-end', lang: 'en', text: q.end }));
    bankEl.hidden = true;
    let event = null;
    if (byHint) {
      event = { ...base, choice: '', correct: false, first_try: a.checks === 0, ms: 0, hint_level: HINT_MAX, misconception: null, error: null, errors: [], revealed: true, ...out };
      report(onAnswer, event);
    }
    const made = a.correct ? tSentence(q, a.texts) : q.to;
    const said = a.correct ? (out.clean ? '对了。' : '对了。这一步记住它。') : '';
    const why = q.why || (shown.some(x => x.level === 1 && !x.auto) ? '' : q.rule);
    feedback.replaceChildren(said ? h('b', { text: said + (why ? ' ' : '') }) : '', why ? h('span', { className: 'ord-why', text: why }) : '');
    speak(made);
    hintBtn.hidden = true;
    checkBtn.hidden = true;
    if (flagBtn) flagBtn.hidden = true;
    ask.replaceChildren(h('span', { className: 'ord-en', lang: 'en', text: made }),
      h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => speak(made, ev.currentTarget) } }, icon('speak')));
    res = { ...out, correct: a.correct, revealed: a.revealed, event };
    const label = report(onEnd, res);
    nextBtn.textContent = typeof label === 'string' && label ? label : '下一句';
    nextBtn.hidden = false;
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
    if (a.correct && out.clean && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
  }
  function next() {
    if (left || !a.done) return;
    left = true;
    clearTimeout(timer);
    report(onDone, res);
  }
  function flag() {
    if (left) return;
    left = true;
    clearTimeout(timer);
    report(onFlag, { ...base });
  }
  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (a.done) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); next(); } return; }
    if (ev.key === 'Backspace') { ev.preventDefault(); if (a.undo()) draw(); return; }
    if (ev.key === 'Enter') { if (a.ready) { ev.preventDefault(); check(); } return; }
    const n = Number(ev.key);
    if (n >= 1 && n <= a.bank.length) {
      const t = a.bank.filter(x => !a.used(x.id))[n - 1];
      if (t) { ev.preventDefault(); tap(t.id); }
    }
  }
  el.classList.remove('is-right', 'is-revealed', 'is-wrong');
  el.classList.add('ord', 'ord-transform');
  bankEl.replaceChildren(...bankBtns.values());
  el.replaceChildren(head, line, bankEl, hints, feedback,
    h('div', { className: 'btn-row ord-actions' }, hintBtn, checkBtn, nextBtn),
    flagBtn ? h('div', { className: 'ord-tools' }, flagBtn) : '');
  draw();
  return { el, attempt: a, check, hint: askHint, next, onKey, stop: () => { left = true; clearTimeout(timer); } };
}

// ---------------------------------------------------------------- the screen: a row of them (what ui-lesson calls)

export function renderTransforms(container, ctx = {}, opts = {}) {
  const { items = [], sid = '', step = 'write', onDone = () => {}, title = '', swaps = [], rng = Math.random, autoNextMs = 1400 } = opts;
  let stopped = false;
  let c = null;
  let view = null;
  let queue = [];
  let pendingOf = null;        // { base, res }: a sentence she did not get, waiting for its 现在你来
  let nextAction = null;
  const results = [];
  const seenNow = new Set();
  const ctl = {
    el: container,
    onKey: ev => { if (view && !stopped) view.onKey(ev); },
    stop: () => { stopped = true; if (view) view.stop(); view = null; },
    next: () => { if (view && !stopped) view.next(); },
  };
  const log = ev => { try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, mode: T_MODE, ...ev }) : null; } catch (e) { return null; } };
  const save = r => {
    try {
      const nextState = applyResult(readTransformState(ctx.kv), { ...r, now: new Date() });
      const p = ctx.kv && typeof ctx.kv.set === 'function' ? ctx.kv.set(T_KV_KEY, nextState) : null;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* keep going */ }
  };
  const finish = () => {
    view = null;
    if (stopped) return;
    onDone({ done: results.length > 0, results: results.slice(), right: results.filter(r => r.clean).length });
  };
  const begin = got => {
    if (stopped) return;
    c = got;
    queue = (items || []).map(id => c && c.item(id)).filter(Boolean);
    if (!queue.length) { finish(); return; }
    draw(queue.shift(), null);
  };
  const have = transformContent();
  if (have) begin(have);
  else loadTransform({ fetchJSON: ctx.fetchJSON }).then(begin, () => { if (!stopped) finish(); });
  return ctl;

  function draw(baseItem, of) {
    if (stopped) return;
    const q = makeTransform(baseItem, { rng, swaps, content: c });
    seenNow.add(baseItem.id);
    const extra = of ? { variant: true, of: 't:' + of.id } : {};
    view = renderTransform(container, q, {
      say: ctx.say, autoNextMs, title: of ? '' : title, variantOf: !!of,
      onAnswer: ev => log({ type: 'answer', ...ev, ...extra }),
      onHint: ev => log({ type: 'hint', ...ev, ...extra }),
      onEnd: res => {
        const variant = !res.correct && !of ? tVariantFor(baseItem, { content: c, exclude: [...seenNow] }) : null;
        const mine = { id: baseItem.id, done: true, passed: res.passed, grade: res.grade, clean: res.clean };
        if (!of) {
          if (variant) pendingOf = { base: baseItem, res: mine };
          else { results.push({ ...mine, item: 't:' + baseItem.id }); save(mine); }
        } else {
          // 现在你来 decides the first sentence: right is passed (fuzzy), wrong is not passed
          const orig = pendingOf;
          pendingOf = null;
          const final = { done: true, passed: res.correct, grade: res.correct ? 2 : 1, clean: false };
          if (orig) { results.push({ id: orig.base.id, item: 't:' + orig.base.id, ...final, variant: baseItem.id }); save({ id: orig.base.id, ...final }); }
          save(mine);
        }
        nextAction = variant ? () => draw(variant, baseItem) : queue.length ? () => draw(queue.shift(), null) : finish;
        return variant ? '现在你来' : queue.length ? '下一句' : '好了';
      },
      onDone: () => { if (!stopped && nextAction) { const go = nextAction; nextAction = null; go(); } },
      onFlag: ev => {
        log({ type: 'flag', ...ev, ...extra });
        // skipped, not graded (DESIGN 8.3); a 现在你来 that is flagged leaves the first sentence as it was
        if (of && pendingOf) { const orig = pendingOf; pendingOf = null; results.push({ ...orig.res, item: 't:' + orig.base.id }); save(orig.res); }
        if (queue.length) draw(queue.shift(), null); else finish();
      },
    });
  }
}
