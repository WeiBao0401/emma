// 我要复习考试（Wei 10-25）：她说“我明天要考 Unit 1 和 Unit 2，帮我复习一下”，App 马上给她一套针对这几个单元的复习。
// 负责：复习考试 agent（review.js、ui-review-request.js、css/review-request.css、tests/review-request.test.mjs）。
//
// 一套复习 = 每天一份，每份还是四格的样子：单词 → 语法 → 阅读 → 小测。
//   单词  这几个单元的必会词（单词本里有的）。她还不会写的在前：复习提纲上的、“写得出”线开着的、最近没拼对过的、
//         忘过的、记得最差的；问老师说的 focus 词最前。题型用现成的四种：四选一 mc4、听音选词 listen、字母块 tiles、
//         句子里回想 cloze。还不会写的轮流出字母块和句子里回想，会写的出四选一和听音；第一张和新词四选一。
//   语法  这几个单元的语法卡（grammar.json 的 unit），加上她最近错过的地基卡（卡的 fixes 对上她的误解）。出备用题（spares）：
//         到期的 1/3/7 天复习先，错过的那一类先，没做过的先，一类一道轮着来；题由 ui-grammar.js renderGrammarItem 画（WarmItem 的形状），
//         答错照常进 grammar.js 的 1、3、7 天复习。后面一张对比小卡（这几张卡相关的，她错得多的先）。
//   阅读  1 篇：期中阅读小篇（exam-reading.json）或番外的一集（stories.json），按这几个单元的词在文里出现了几个、
//         语法点对不对得上来挑；ui-reader.js renderPassage 画（不写番外进度）。
//   小测  最后一份 10 到 15 分钟：拼几个词（字母块）、几道语法题、1 篇阅读只做题（原文开着）。
// 按离考试几天排（date 是考试那天）：
//   今天考（0 天）   只看一眼：8 个词认一认、2 道语法，5 分钟左右，不做阅读和小测。
//   明天考（1 天）   一份，20 分钟以内：最要紧的词、3 道语法 + 1 张对比小卡、小测（含阅读）；阅读格并进小测。
//   还有 2 天以上    分 n = min(天数, 5) 天，每天一份：前 n-1 天学（单词、语法、阅读），最后一天（考前一天）是小测日
//                    （前几天错的词和题先练一下，再做小测）。每份 20 分钟以内。
// 前几天答错的词和语法题记进 plan.misses，后面几天和小测先出它们（dayFor）；单词同时照常进 FSRS 复习（ui 那边 words.review 评 1 分），
// 小测拼错的开“写得出”线（words.patch write，write_from 'review'）。
//
// kv 'review:plan'（新键，随备份走）：一次只存一套，再要一套就换掉。形状 = buildReview 的返回值，另加 misses、done：
//   { v: 1, id: 'review:<考试日>:<单元>', units: ['U1', 'U2'], date: 'YYYY-MM-DD' | '', made, gap, kind: 'today' | 'cram' | 'days',
//     title, names, days: [Day], misses: { words: { slug: { n, day, fixed? } }, grammar: { item: { card, family, n, day, fixed? } } },
//     done: { '<第几份>': { cells: { words: true, ... }, at } }, stats: { words, cantWrite, cards, readings }, focus, updated }
//   Day = { n, of, day: 'YYYY-MM-DD', kind: 'learn' | 'quiz' | 'cram' | 'today', title, minutes, cells: [Cell × 4] }
//   Cell = { id: 'words' | 'grammar' | 'read' | 'quiz', label, status: 'ready' | 'skip', minutes, note,
//            words:   items: [slug], modes: { slug: 'mc4' | 'listen' | 'tiles' | 'cloze' }
//            grammar: items: [WarmItem], contrast: ContrastItem | null
//            read:    passage: Reading | null
//            quiz:    spell: [slug], grammar: [WarmItem], passage: Reading | null }
//   WarmItem = { item: 'g:<卡>:<题>', card, qid, family, unit, mode: 'grammar', kind: 'practice' | 'review', of? }（grammar.js 的形状）
//   ContrastItem = { id, item: 'gc:<id>', mode: 'contrast', kind: 'contrast', title, tags, cards, why }
//   Reading = { id, source: 'exam' | 'story', label, title, mode: 'read' | 'questions', minutes, hits: [词] }
//
// 导出
//   REVIEW_KEY = 'review:plan'；MAX_DAYS = 5；DAY_MAX_MIN = 20；QUIZ_MIN = [10, 15]；SECONDS；BUDGET；CELL_LABELS
//   normUnit(x) -> 'S' | 'U1' ... | ''；unitName(id)；unitList(ids) -> 'Unit 1 和 Unit 2'
//   addDays(day, n)、gapDays(from, to)、dayOf(date)
//   loadReviewData(ctx) -> Promise<{ grammar, contrast, stories, passages, events }>   读语法卡、对比小卡、故事、期中阅读、最近 60 天的事件
//   buildReview(ctx, { units, date, focus?, now?, grammar?, contrast?, stories?, passages?, events?, entries? }) -> Review | null
//     ctx 用到 words（favorites）、curriculum（unitOf、unitWords、tierOf、isRequired）、kv（peek 'outline'、'exam.reading'、'grammar:*'、
//     'contrast.state'）。数据没给就用各模块已经缓存的（grammar.js content()、reader.js content()）。units 一个都认不出来返回 null。
//     focus：'words' | 'grammar' | 'reading'（多给这一块时间），或 { words: [词], cards: [卡 id] }（这些排最前）。
//   rankWords(ctx, units, { now, events, focus, outline, entries }) -> [RankedWord]   排好的词（导出给测试）
//   grammarPool(units, { content, gstate, now, focus }) -> { cards: [卡 id], queues: { 卡: [WarmItem] } }
//   contrastPool(cards, { contrast, gstate, now }) -> [ContrastItem]
//   readingPool(ctx, units, { stories, passages, cards, now }) -> [Reading]
//   todayIndex(plan, now) -> 第几份（0 起）| -1   今天该做哪一份：小测日当天做小测；不然先补错过的那份，再是今天的；
//                                                 今天的做完了可以提前做下一份；都做完了、考完了 -1
//   dayFor(plan, i, { content, now }) -> Day   第 i 份，把前面错的词和题排进去（单词格、小测、小测日的语法格）
//   noteResult(plan, { kind: 'word' | 'grammar', slug?, item?, card?, family?, correct, now }) -> plan   记对错（纯函数）
//   markCell(plan, i, cellId, now) -> plan；dayDone(plan, i) -> bool；isFinished(plan) -> bool
//   readPlan(kv) -> plan | null；activePlan(kv, now) -> plan | null（考试日还没过、还有没做完的）；savePlan(kv, plan) -> Promise
//   parseReviewText(text, { now, current?, progress? }) -> { units, date, exam? } | null
//     问老师识别“我要考 Unit 1 2”“帮我复习第三单元”“明天考一二单元”这类话。units 是 ['U1', 'U2']（认不出单元是 []），
//     date 是考试那天 'YYYY-MM-DD'（没说是 ''）。不是要复习考试（问词、问语法、考完了）返回 null。
//     current：现在学到的单元（“这个单元”）；progress：kv 'progress'（“期中”没说单元时用它的范围）。
//   reviewReply(parsed, { now }) -> { text, action: { label: '开始复习', route: 'revise', params: { units, date } } }
//     问老师识别到以后回的一句和一个按钮（接法见 wip/b5/review-needs.md）。
//   summaryLine(plan, i) -> 孩子看的一句：“今天是第 2 天，单词 12 个、语法 5 道、读一篇，大约 16 分钟。”
//
// 纯函数（ctx 只读），不碰 DOM；Node 里直接测。

import { wordsOf, tileable, unitRank, MODE_SECONDS, outlineList } from './sprint.js';
import * as G from './grammar.js';
import * as R from './reader.js';

export const REVIEW_KEY = 'review:plan';
export const MAX_DAYS = 5;
export const DAY_MAX_MIN = 20;
export const QUIZ_MIN = [10, 15];
export const SECONDS = {
  mc4: MODE_SECONDS.mc4, listen: MODE_SECONDS.listen, tiles: MODE_SECONDS.tiles, cloze: MODE_SECONDS.cloze,
  grammar: MODE_SECONDS.grammar, contrast: MODE_SECONDS.contrast, quizSpell: 45, quizGrammar: 30,
};
// seconds (words, grammar) and counts per kind of day
export const BUDGET = {
  today: { words: 150, grammar: 2, contrast: 0 },
  cram: { words: 300, grammar: 3, contrast: 1, spell: 6, quizGrammar: 3 },
  learn: { words: 420, grammar: 5, contrast: 1 },
  quiz: { words: 240, grammar: 2, contrast: 0, spell: 6, quizGrammar: 4 },
};
export const CELL_LABELS = { words: '单词', grammar: '语法', read: '阅读', quiz: '小测' };
const CELL_IDS = ['words', 'grammar', 'read', 'quiz'];

const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayNum = day => { const [y, m, d] = String(day).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export function addDays(day, n) { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); }
export const gapDays = (from, to) => dayNum(to) - dayNum(from);
const norm = s => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const arr = x => (Array.isArray(x) ? x : []);
const uniq = a => [...new Set(a)];

// ---------------------------------------------------------------- units

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNumber(s) {
  s = String(s || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (!s) return NaN;
  if (s === '十') return 10;
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  if (s.length === 1 && s in CN_DIGIT) return CN_DIGIT[s];
  return NaN;
}

// 'u1' / 'U1' / 'Unit 1' / 'unit1' / 1 / '1' / '第一单元' / 'S' / 'Starter' -> 'U1' / 'S'; anything else ''
export function normUnit(x) {
  if (x == null) return '';
  if (typeof x === 'number') return x >= 1 && x <= 12 ? 'U' + Math.floor(x) : x === 0 ? 'S' : '';
  const s = String(x).trim();
  if (/^(s|starter|starter unit|预备单元|入门单元)$/i.test(s)) return 'S';
  let m = s.match(/^(?:u|unit)\s*(\d{1,2})$/i) || s.match(/^(\d{1,2})$/);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= 12 ? 'U' + n : n === 0 ? 'S' : ''; }
  m = s.match(/^第?([一二三四五六七八九十\d]+)单元$/);
  if (m) { const n = cnNumber(m[1]); return n >= 1 && n <= 12 ? 'U' + n : ''; }
  return '';
}
export function unitName(id) {
  const u = normUnit(id) || String(id || '');
  if (u === 'S') return 'Starter';
  const m = u.match(/^U(\d+)$/);
  return m ? `Unit ${m[1]}` : u;
}
export function unitList(ids) {
  const names = arr(ids).map(unitName).filter(Boolean);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join('、') + ' 和 ' + names[names.length - 1];
}
const sortUnits = list => uniq(list.map(normUnit).filter(Boolean)).sort((a, b) => unitRank(a) - unitRank(b));

// ---------------------------------------------------------------- loading what the review needs

export async function loadReviewData(ctx) {
  const fetchJSON = ctx && ctx.fetchJSON;
  const safe = async f => { try { return await f(); } catch (e) { return null; } };
  const grammar = G.content() || await safe(() => G.loadGrammar({ fetchJSON }));
  const contrast = G.contrastContent() || await safe(() => G.loadContrast({ fetchJSON }));
  const stories = R.content() || await safe(() => R.loadStories({ fetchJSON }));
  const passages = await safe(() => R.loadPassages({ fetchJSON })) || [];
  let events = [];
  try {
    if (ctx && ctx.events && typeof ctx.events.query === 'function') {
      const since = new Date(Date.now() - 60 * 864e5).toISOString();
      events = (await ctx.events.query({ since, limit: 5000 })) || [];
    }
  } catch (e) { events = []; }
  return { grammar, contrast, stories, passages, events };
}

// ---------------------------------------------------------------- words

const WRITE_MODES = new Set(['tiles', 'keys', 'cloze', 'paper']);
const slugOfEvent = e => e.slug || (typeof e.item === 'string' && e.item.startsWith('w:') ? e.item.slice(2) : '');
// her last writing attempt of each word: spelled with tiles / keys / in a sentence, or written on paper (dictation).
// A clean one is right, first try, no hint (0.6.0: an answer after 提示 in 句子里回想 is not clean).
function lastWrites(events) {
  const out = new Map();
  for (const e of arr(events)) {
    if (!e) continue;
    const isWrite = (e.type === 'answer' && WRITE_MODES.has(e.mode)) || e.type === 'dictation' || e.type === 'spell';
    if (!isWrite) continue;
    const slug = slugOfEvent(e);
    if (!slug) continue;
    if (e.type === 'answer' && e.first_try === false) continue;   // only the first try of each card counts
    const ok = e.correct === true && !(e.hint_level > 0);
    const at = String(e.at || '');
    const prev = out.get(slug);
    if (!prev || at >= prev.at) out.set(slug, { ok, at });
  }
  return out;
}

// RankedWord = plan word (sprint.js wordsOf) + { score, cantWrite, key, focus, miss }
export function rankWords(ctx, units, { now = new Date(), events = [], focus = null, outline = undefined, entries = null, misses = null } = {}) {
  const c = (ctx && ctx.curriculum) || {};
  const raw = entries || (ctx && ctx.words && typeof ctx.words.favorites === 'function' ? ctx.words.favorites() : []);
  const want = new Set(sortUnits(units));
  const words = wordsOf({ entries: arr(raw).filter(e => e && e.favorited !== false), curriculum: c }, now)
    .map(w => ({ ...w, unit: normUnit(w.unit) || w.unit }))
    .filter(w => want.has(w.unit));
  const ol = outline !== undefined ? outline : (ctx && ctx.kv && ctx.kv.peek ? ctx.kv.peek('outline', null) : null);
  const keys = new Set(outlineList(ol));
  const focusWords = new Set(arr(focus && focus.words).map(norm));
  const writes = lastWrites(events);
  const missed = (misses && misses.words) || {};
  const out = [];
  for (const w of words) {
    const head = norm(w.headword || w.slug);
    if (w.tier !== 'required' && w.tier !== 'primary' && w.tier !== 'recognize') continue;
    const last = writes.get(w.slug);
    const spellable = w.tier !== 'recognize' && tileable(w);
    const cantWrite = spellable && (!!w.write || !last || !last.ok);
    const key = keys.has(head) || keys.has(norm(w.slug));
    const isFocus = focusWords.has(head) || focusWords.has(norm(w.slug));
    const miss = !!(missed[w.slug] && !missed[w.slug].fixed);
    const r = Number.isFinite(w.r) ? w.r : 0.5;
    // 小学词 she already knows well are not what a unit test is about; she still sees one she is shaky on
    if (w.tier === 'primary' && !w.write && !miss && !isFocus && r > 0.8 && (w.lapses || 0) === 0) continue;
    let score = 0;
    if (isFocus) score += 60;
    if (miss) score += 40;
    if (key) score += 50;
    if (w.write) score += 30;
    if (cantWrite) score += 20;
    if (w.tier === 'required') score += 10;
    if (w.tier === 'recognize') score -= 10;
    if (w.tier === 'primary') score -= 15;
    score += Math.min(4, w.lapses || 0) * 5 + Math.round((1 - r) * 20);
    out.push({ ...w, score, cantWrite, spellable, key, focus: isFocus, miss });
  }
  const rank = id => unitRank(id);
  out.sort((a, b) => b.score - a.score || rank(a.unit) - rank(b.unit) || (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.slug).localeCompare(String(b.slug)));
  return out;
}

// the mode of each card of one day: the first card and new words are recognised first; words she cannot write yet
// alternate 字母块 and 句子里回想; the rest alternate 四选一 and 听音选词
function assignWordModes(list) {
  const modes = {};
  let spell = 0, know = 0;
  list.forEach((w, i) => {
    if (i === 0 || w.isNew) { modes[w.slug] = 'mc4'; return; }
    if (w.cantWrite && w.spellable) { modes[w.slug] = spell++ % 2 === 0 ? 'tiles' : 'cloze'; return; }
    modes[w.slug] = know++ % 2 === 0 ? 'mc4' : 'listen';
  });
  return modes;
}
const wordSeconds = (list, modes) => list.reduce((a, w) => a + (SECONDS[modes[w.slug]] || SECONDS.mc4), 0);
// the surest word first (the lesson does the same), then the rest in rank order
function orderDay(list) {
  if (list.length < 2) return list.slice();
  let best = 0;
  list.forEach((w, i) => { if (!w.isNew && (w.r ?? 0) > (list[best].r ?? 0)) best = i; });
  return [list[best], ...list.filter((_, i) => i !== best)];
}
// fill one day's word cell up to `budget` seconds from the ranked list; `skip` holds slugs already used that day
function fillWords(ranked, budget, { skip = new Set(), recognizeOnly = false } = {}) {
  const pick = [];
  let sec = 0;
  for (const w of ranked) {
    if (skip.has(w.slug) || pick.some(x => x.slug === w.slug)) continue;
    const cost = recognizeOnly ? SECONDS.mc4 : (w.cantWrite && w.spellable ? SECONDS.cloze : SECONDS.mc4);
    if (sec + cost > budget && pick.length) break;
    pick.push(w);
    sec += cost;
  }
  return pick;
}
function wordCell(list, { recognizeOnly = false, note = '' } = {}) {
  const ordered = orderDay(list);
  const modes = recognizeOnly
    ? Object.fromEntries(ordered.map((w, i) => [w.slug, i % 3 === 2 ? 'listen' : 'mc4']))
    : assignWordModes(ordered);
  const sec = wordSeconds(ordered, modes);
  if (!ordered.length) return { id: 'words', label: CELL_LABELS.words, status: 'skip', minutes: 0, note: note || '没有要练的词', items: [], modes: {} };
  return { id: 'words', label: CELL_LABELS.words, status: 'ready', minutes: Math.max(1, Math.round(sec / 60)), note: `${ordered.length} 个词`, items: ordered.map(w => w.slug), modes, sec };
}

// ---------------------------------------------------------------- grammar

const cardsOf = c => (c && Array.isArray(c.cards) ? c.cards : []);
const stateOfCard = (gstate, id) => G.normState(gstate && gstate.cards ? gstate.cards[id] : null, id);

export function grammarPool(units, { content = null, gstate = null, now = new Date(), focus = null } = {}) {
  const ct = content || G.content();
  if (!ct || !cardsOf(ct).length) return { cards: [], queues: {} };
  const want = new Set(sortUnits(units));
  const day = dayOf(now);
  const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.index - b.index;
  const unitCards = cardsOf(ct).filter(c => want.has(normUnit(c.unit))).sort(byOrder);
  // the foundation cards these units stand on, only the ones her mistakes point at (the card's fixes)
  const hits = G.misconceptionHits(gstate || { cards: {} }, now, { content: ct });
  const needed = new Set(unitCards.flatMap(c => arr(c.foundations)));
  const found = cardsOf(ct).filter(c => c.foundation && !unitCards.includes(c) && arr(c.points).some(p => needed.has(p)))
    .map(c => ({ c, n: arr(c.fixes).reduce((a, t) => a + (hits[t] || 0), 0) }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n || byOrder(a.c, b.c)).slice(0, 2).map(x => x.c);
  const focusCards = new Set(arr(focus && focus.cards));
  const cards = [...unitCards, ...found].sort((a, b) => (focusCards.has(b.id) ? 1 : 0) - (focusCards.has(a.id) ? 1 : 0));
  const queues = {};
  for (const card of cards) {
    const s = stateOfCard(gstate, card.id);
    const flagged = new Set(arr(s.flagged));
    const spares = arr(card.spares).filter(q => !flagged.has(q.id));
    const items = s.items || {};
    const failedFam = new Set(Object.entries(items).filter(([, r]) => r && (r.passed === false || (r.grade || 3) <= 1)).map(([qid]) => {
      const q = ct.item(`g:${card.id}:${qid}`) || ct.item(`g:${card.id}:${qid.replace(/v$/, '')}`);
      return q && q.family;
    }).filter(Boolean));
    const out = [];
    const used = new Set();
    const mk = (q, extra = {}) => ({ item: q.item, card: card.id, qid: q.id, family: q.family, unit: card.unit, mode: G.MODE, kind: 'practice', ...extra });
    // 1 the 1/3/7-day reviews that are due: a new sentence of the same family (grammar.js moves the review on)
    for (const r of arr(s.reviews).filter(r => r && r.due && r.due <= day).sort((a, b) => String(a.due).localeCompare(String(b.due)))) {
      const q = spares.find(x => x.family === r.family && !used.has(x.id) && !arr(r.served).includes(x.id) && x.id !== r.id);
      if (q) { used.add(q.id); out.push(mk(q, { kind: 'review', of: r.id })); }
    }
    // 2 then the spares, one family at a time: families she got wrong before first, never-seen questions before seen ones
    const fresh = spares.filter(q => !used.has(q.id))
      .sort((a, b) => (failedFam.has(b.family) ? 1 : 0) - (failedFam.has(a.family) ? 1 : 0) || (items[a.id] ? 1 : 0) - (items[b.id] ? 1 : 0));
    const fams = uniq(fresh.map(q => q.family));
    const lists = fams.map(f => fresh.filter(q => q.family === f));
    for (let k = 0; lists.some(l => l.length); k = (k + 1) % lists.length) if (lists[k].length) { const q = lists[k].shift(); used.add(q.id); out.push(mk(q)); }
    queues[card.id] = out;
  }
  return { cards: cards.map(c => c.id), queues };
}
// n items round-robin over the cards' queues (takes them out of the queues)
function takeGrammar(pool, n) {
  const out = [];
  const ids = pool.cards.filter(id => (pool.queues[id] || []).length);
  for (let k = 0; out.length < n && ids.some(id => pool.queues[id].length); k = (k + 1) % ids.length) {
    const q = pool.queues[ids[k]];
    if (q.length) out.push(q.shift());
  }
  return out;
}

export function contrastPool(cards, { contrast = null, gstate = null, now = new Date() } = {}) {
  const cc = contrast || G.contrastContent();
  if (!cc || !arr(cc.contrasts).length || !arr(cards).length) return [];
  const set = new Set(cards);
  const hits = G.misconceptionHits(gstate || { cards: {} }, now, {});
  return cc.contrasts.filter(x => arr(x.quiz).length && arr(x.cards).some(id => set.has(id)))
    .map(x => ({ x, n: arr(x.tags).reduce((a, t) => a + (hits[t] || 0), 0), at: cards.indexOf(arr(x.cards).find(id => set.has(id))) }))
    .sort((a, b) => b.n - a.n || a.at - b.at || a.x.index - b.x.index)
    .map(({ x, n }) => {
      const sp = /[A-Za-z']$/.test(x.title) ? ' ' : '';
      return { id: x.id, item: x.item || 'gc:' + x.id, mode: 'contrast', kind: 'contrast', title: x.title, tags: arr(x.tags).slice(), cards: arr(x.cards).slice(), n,
        why: n > 0 ? `${x.title}${sp}你最近容易混，考前再看一眼。` : `${x.title}${sp}考试常考，考前看一眼。` };
    });
}
function grammarCell(items, contrast, { note = '' } = {}) {
  const sec = items.length * SECONDS.grammar + (contrast ? SECONDS.contrast : 0);
  if (!items.length && !contrast) return { id: 'grammar', label: CELL_LABELS.grammar, status: 'skip', minutes: 0, note: note || '没有要练的语法', items: [], contrast: null };
  const parts = [items.length ? `${items.length} 道题` : '', contrast ? '1 张对比小卡' : ''].filter(Boolean);
  return { id: 'grammar', label: CELL_LABELS.grammar, status: 'ready', minutes: Math.max(1, Math.round(sec / 60)), note: parts.join('、'), items, contrast: contrast || null, sec };
}

// ---------------------------------------------------------------- reading

// which tags of stories.json / exam-reading.json sentences go with which grammar card (textread.js TAG_CARD, the ones we need)
const CARD_TAGS = { pronoun: ['pronoun'], there_be: ['there_be'], possessive_s: ['poss_s'], be_verb: ['be_verb', 'be_adj'],
  plural: ['plural'], present_simple: ['third_s', 'do_q'], can: ['can'], freq_adverb: ['freq_adv'] };
const tokensOf = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z']+/).map(t => t.replace(/^'+|'+$/g, '').replace(/'s$/, '')).filter(Boolean);
function stems(t) {
  const out = [t];
  if (t.endsWith('ies')) out.push(t.slice(0, -3) + 'y');
  if (t.endsWith('es')) out.push(t.slice(0, -2));
  if (t.endsWith('s')) out.push(t.slice(0, -1));
  if (t.endsWith('ed')) out.push(t.slice(0, -2), t.slice(0, -1));
  if (t.endsWith('ing')) out.push(t.slice(0, -3), t.slice(0, -3) + 'e');
  return out;
}
// the words of these units: the textbook's unit lists, and the word book's entries of these units
function unitWordSet(ctx, units) {
  const c = (ctx && ctx.curriculum) || {};
  const set = new Set();
  for (const u of units) {
    try { for (const x of arr(c.unitWords ? c.unitWords(u) : [])) if (x && x.w && !/\s/.test(norm(x.w))) set.add(norm(x.w)); } catch (e) { /* no textbook */ }
  }
  try {
    const want = new Set(units);
    for (const e of arr(ctx && ctx.words && ctx.words.favorites ? ctx.words.favorites() : [])) {
      const u = normUnit(e.unit || (c.unitOf ? c.unitOf(e.headword) : ''));
      if (want.has(u) && e.headword && !/\s/.test(norm(e.headword))) set.add(norm(e.headword));
    }
  } catch (e) { /* nothing more */ }
  return set;
}
const qMinutes = ep => Math.max(3, Math.ceil(arr(ep.questions).length * 0.8));

export function readingPool(ctx, units, { stories = null, passages = [], cards = [], now = new Date() } = {}) {
  const words = unitWordSet(ctx, sortUnits(units));
  const tags = new Set(arr(cards).flatMap(id => CARD_TAGS[id] || []));
  const today = dayOf(now);
  const examDone = (ctx && ctx.kv && ctx.kv.peek ? (ctx.kv.peek('exam.reading', null) || {}).done : null) || {};
  const list = [];
  const add = (ep, source) => {
    if (!ep || !ep.id || !arr(ep.sentences).length || !arr(ep.questions).length) return;
    const hits = new Set();
    let tagHits = 0;
    for (const s of ep.sentences) {
      for (const t of tokensOf(s.en)) { const hit = stems(t).find(x => words.has(x)); if (hit) hits.add(hit); }
      if (arr(s.tags).some(t => tags.has(t))) tagHits++;
    }
    for (const t of arr(ep.targets)) if (t && words.has(norm(t.w))) hits.add(norm(t.w));
    const recent = source === 'exam' && isDay(examDone[ep.id]) && gapDays(examDone[ep.id], today) <= 2;
    const score = hits.size * 2 + Math.min(tagHits, 8) + (source === 'exam' ? 2 : 0) - (recent ? 6 : 0);
    let minutes = 6;
    try { minutes = R.estimateMinutes(ep) || 6; } catch (e) { /* 6 */ }
    list.push({ id: ep.id, source, label: ep.label || (source === 'exam' ? '期中阅读' : `第 ${ep.n} 集`), title: ep.title || ep.titleZh || '',
      minutes, qMinutes: qMinutes(ep), hits: [...hits].sort(), tagHits, score });
  };
  for (const p of arr(passages)) add(p, 'exam');
  for (const ep of arr(stories && stories.episodes)) add(ep, 'story');
  list.sort((a, b) => b.score - a.score || (a.source === 'exam' ? -1 : 1) - (b.source === 'exam' ? -1 : 1) || String(a.id).localeCompare(String(b.id)));
  return list;
}
const asReading = (r, mode) => (r ? { id: r.id, source: r.source, label: r.label, title: r.title, mode, minutes: mode === 'questions' ? r.qMinutes : r.minutes, hits: r.hits.slice(0, 12) } : null);
function readCell(r, { mode = 'read', note = '' } = {}) {
  if (!r) return { id: 'read', label: CELL_LABELS.read, status: 'skip', minutes: 0, note: note || '今天不读', passage: null };
  const p = asReading(r, mode);
  return { id: 'read', label: CELL_LABELS.read, status: 'ready', minutes: p.minutes, note: p.label, passage: p };
}

// ---------------------------------------------------------------- the quiz

function quizCell(spell, grammar, reading) {
  const passage = asReading(reading, 'questions');
  const sec = spell.length * SECONDS.quizSpell + grammar.length * SECONDS.quizGrammar + (passage ? passage.minutes * 60 : 0);
  if (!spell.length && !grammar.length && !passage) return { id: 'quiz', label: CELL_LABELS.quiz, status: 'skip', minutes: 0, note: '', spell: [], grammar: [], passage: null };
  return { id: 'quiz', label: CELL_LABELS.quiz, status: 'ready', minutes: Math.max(1, Math.round(sec / 60)), note: '词、语法、阅读', spell: spell.slice(), grammar: grammar.slice(), passage, sec };
}
const skipCell = (id, note) => ({ id, label: CELL_LABELS[id], status: 'skip', minutes: 0, note, items: [], ...(id === 'quiz' ? { spell: [], grammar: [], passage: null } : {}), ...(id === 'read' ? { passage: null } : {}), ...(id === 'grammar' ? { contrast: null } : {}) });
const dayMinutes = cells => cells.filter(c => c.status === 'ready').reduce((a, c) => a + (c.sec ? c.sec / 60 : c.minutes), 0);

// ---------------------------------------------------------------- the whole review

export function buildReview(ctx, opts = {}) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = dayOf(now);
  const units = sortUnits(arr(opts.units).length ? opts.units : [opts.units].filter(Boolean));
  if (!units.length) return null;
  const date = isDay(opts.date) ? opts.date : '';
  const gap = date ? gapDays(today, date) : 1;
  if (gap < 0) return null;
  const focus = typeof opts.focus === 'string' ? { part: opts.focus } : (opts.focus && typeof opts.focus === 'object' ? opts.focus : {});
  const kv = ctx && ctx.kv;
  const content = opts.grammar || G.content();
  const gstate = (() => { try { return kv && kv.peek ? G.grammarState(kv, content) : { cards: {} }; } catch (e) { return { cards: {} }; } })();
  const ranked = rankWords(ctx, units, { now, events: opts.events || [], focus, entries: opts.entries || null });
  const gpool = grammarPool(units, { content, gstate, now, focus });
  const cpool = contrastPool(gpool.cards, { contrast: opts.contrast || null, gstate, now });
  const passages = arr(opts.passages);
  const stories = opts.stories || R.content();
  const rpool = readingPool(ctx, units, { stories, passages, cards: gpool.cards, now });
  const wordsK = focus.part === 'words' ? 1.4 : focus.part === 'grammar' || focus.part === 'reading' ? 0.7 : 1;
  const gramK = focus.part === 'grammar' ? 1.6 : 1;
  const noWords = ranked.length ? '' : '这几个单元的词还没进单词本';
  const spellList = n => ranked.filter(w => w.spellable && w.tier !== 'recognize')
    .sort((a, b) => (b.cantWrite ? 1 : 0) - (a.cantWrite ? 1 : 0) || b.score - a.score).slice(0, n).map(w => w.slug);
  const exams = rpool.filter(r => r.source === 'exam');
  const days = [];
  let kind = 'days';

  if (gap === 0) {
    // 今天考：只看一眼
    kind = 'today';
    const B = BUDGET.today;
    const cells = [
      wordCell(fillWords(ranked, B.words * wordsK, { recognizeOnly: true }), { recognizeOnly: true, note: noWords }),
      grammarCell(takeGrammar(gpool, Math.round(B.grammar * gramK)), null),
      skipCell('read', '今天不读长文'),
      skipCell('quiz', '今天不做小测'),
    ];
    days.push({ n: 1, of: 1, day: today, kind: 'today', title: '考前看一眼', cells });
  } else if (gap === 1) {
    // 明天考：一份，20 分钟以内
    kind = 'cram';
    const B = BUDGET.cram;
    const contrast = cpool[0] || null;
    const gItems = takeGrammar(gpool, Math.round(B.grammar * gramK));
    const quizG = takeGrammar(gpool, B.quizGrammar);
    const quizR = focus.part === 'reading' ? rpool[0] : (exams[0] || rpool[0]);
    let wordsList = fillWords(ranked, B.words * wordsK);
    let cells = [wordCell(wordsList, { note: noWords }), grammarCell(gItems, contrast),
      skipCell('read', quizR ? '放进小测里' : '没有合适的文章'), quizCell(spellList(B.spell), quizG, quizR || null)];
    // stay inside 20 minutes: fewer word cards first, then the contrast card
    while (dayMinutes(cells) > DAY_MAX_MIN && wordsList.length > 4) { wordsList = wordsList.slice(0, -1); cells[0] = wordCell(wordsList, { note: noWords }); }
    if (dayMinutes(cells) > DAY_MAX_MIN && contrast) cells[1] = grammarCell(gItems, null);
    days.push({ n: 1, of: 1, day: today, kind: 'cram', title: '明天考，今天练最要紧的', cells });
  } else {
    // 还有几天：分几天，每天一份；最后一天（考前一天）是小测日
    const n = Math.min(gap, MAX_DAYS);
    const learnN = n - 1;
    const dates = [...Array.from({ length: learnN }, (_, i) => addDays(today, i)), addDays(date, -1)];
    const used = new Set();
    for (let i = 0; i < learnN; i++) {
      const B = BUDGET.learn;
      // go on down the list; once it has all been seen, the words she cannot write yet come round again
      let list = fillWords(ranked.filter(w => !used.has(w.slug)), B.words * wordsK);
      if (list.length < 4) {
        const again = ranked.filter(w => (w.cantWrite || w.write || w.miss || w.key) && !list.some(x => x.slug === w.slug));
        const sec = list.reduce((a, w) => a + (w.cantWrite && w.spellable ? SECONDS.cloze : SECONDS.mc4), 0);
        list = [...list, ...fillWords(again, B.words * wordsK - sec)];
      }
      list.forEach(w => used.add(w.slug));
      const gItems = takeGrammar(gpool, Math.round(B.grammar * gramK));
      const contrast = cpool.length ? cpool[i % cpool.length] : null;
      const r = rpool.length ? rpool[i % rpool.length] : null;
      const cells = [wordCell(list, { note: noWords }), grammarCell(gItems, contrast), readCell(r, { mode: 'read', note: '没有合适的文章' }), skipCell('quiz', '最后一天做')];
      days.push({ n: i + 1, of: n, day: dates[i], kind: 'learn', title: `复习第 ${i + 1} 天`, cells });
    }
    // the quiz day: the weak words once more (the ones she gets wrong before then go first, see dayFor), then the quiz
    const B = BUDGET.quiz;
    const lastLearn = new Set(days.length ? days[days.length - 1].cells[0].items : []);
    const weak = ranked.filter(w => (w.cantWrite || w.write || w.key || (w.r ?? 1) < 0.7) && !lastLearn.has(w.slug));
    const qWords = fillWords(weak.length ? weak : ranked, B.words * wordsK);
    const gItems = takeGrammar(gpool, B.grammar);
    const quizG = takeGrammar(gpool, B.quizGrammar);
    const readIds = new Set(days.map(d => d.cells[2].passage && d.cells[2].passage.id).filter(Boolean));
    const quizR = exams.find(r => !readIds.has(r.id)) || rpool.find(r => !readIds.has(r.id)) || exams[0] || rpool[0] || null;
    const cells = [wordCell(qWords, { note: noWords }), grammarCell(gItems, null), skipCell('read', quizR ? '放进小测里' : '没有合适的文章'), quizCell(spellList(B.spell), quizG, quizR)];
    days.push({ n, of: n, day: dates[learnN], kind: 'quiz', title: '考前小测', cells });
  }
  for (const d of days) d.minutes = Math.round(dayMinutes(d.cells));
  const names = unitList(units);
  return {
    v: 1,
    id: `review:${date || today}:${units.join('-')}`,
    units, names, date, made: today, gap, kind,
    title: `复习 ${names}`,
    focus: opts.focus || null,
    days,
    misses: { words: {}, grammar: {} },
    done: {},
    stats: { words: ranked.length, cantWrite: ranked.filter(w => w.cantWrite).length, cards: gpool.cards.slice(), readings: rpool.length },
    updated: now.toISOString(),
  };
}

// ---------------------------------------------------------------- running it, day by day

export const dayDone = (plan, i) => {
  const d = plan && plan.days && plan.days[i];
  if (!d) return false;
  const rec = (plan.done && plan.done[String(i)]) || {};
  return d.cells.filter(c => c.status === 'ready').every(c => rec.cells && rec.cells[c.id]);
};
export const isFinished = plan => !!plan && arr(plan.days).every((_, i) => dayDone(plan, i));

// today's: the quiz day on its day; else the first one not done that is due already (a missed day first); else the next one
// not done (she may go ahead)
export function todayIndex(plan, now = new Date()) {
  if (!plan || !arr(plan.days).length) return -1;
  const today = dayOf(now);
  if (plan.date && today > plan.date) return -1;
  // the quiz day keeps its day (the day before the exam); before it, a day she missed comes first
  const last = plan.days.length - 1;
  if (plan.days[last].day === today && !dayDone(plan, last)) return last;
  const due = plan.days.findIndex((d, k) => d.day <= today && !dayDone(plan, k));
  if (due >= 0) return due;
  const next = plan.days.findIndex((d, k) => !dayDone(plan, k));
  return next;
}

const openWordMisses = plan => Object.entries((plan && plan.misses && plan.misses.words) || {}).filter(([, r]) => r && !r.fixed).sort((a, b) => (b[1].n || 0) - (a[1].n || 0)).map(([slug]) => slug);
const openGrammarMisses = plan => Object.entries((plan && plan.misses && plan.misses.grammar) || {}).filter(([, r]) => r && !r.fixed).map(([item, r]) => ({ item, ...r }));

// the i-th day with what she got wrong on the days before it put first: missed words lead the word cell (as spelling when
// they can be spelled) and the quiz's spelling; on the quiz day, missed grammar families get a new sentence each
export function dayFor(plan, i, { content = null, now = new Date() } = {}) {
  const d0 = plan && plan.days && plan.days[i];
  if (!d0) return null;
  const d = JSON.parse(JSON.stringify(d0));
  const misses = openWordMisses(plan).filter(slug => {
    const r = plan.misses.words[slug];
    return r.day !== dayOf(now);   // wrong today: tomorrow, not again right now
  });
  if (misses.length && d.kind !== 'today') {
    const w = d.cells.find(c => c.id === 'words');
    if (w) {
      const rest = arr(w.items).filter(s => !misses.includes(s));
      const keep = Math.max(arr(w.items).length, Math.min(misses.length, 8));
      w.items = [...misses.slice(0, 8), ...rest].slice(0, keep);
      w.modes = { ...(w.modes || {}) };
      misses.forEach((s, k) => { if (!w.modes[s] || w.modes[s] === 'mc4' || w.modes[s] === 'listen') w.modes[s] = k === 0 && !rest.length ? 'mc4' : 'tiles'; });
      if (w.items.length) { w.status = 'ready'; w.note = `${w.items.length} 个词`; }
    }
    const q = d.cells.find(c => c.id === 'quiz');
    if (q && q.status === 'ready') {
      const n = Math.max(arr(q.spell).length, 1);
      q.spell = uniq([...misses, ...arr(q.spell)]).slice(0, n);
    }
  }
  const gm = openGrammarMisses(plan).filter(m => m.day !== dayOf(now));
  const ct = content || G.content();
  if (gm.length && ct && (d.kind === 'quiz' || d.kind === 'learn')) {
    const g = d.cells.find(c => c.id === 'grammar');
    const inPlan = new Set(plan.days.flatMap(x => x.cells.flatMap(c => [...arr(c.items), ...arr(c.grammar)].map(it => it && it.item).filter(Boolean))));
    const extra = [];
    for (const m of gm.slice(0, 2)) {
      const card = ct.card(m.card);
      if (!card) continue;
      const q = arr(card.spares).find(x => x.family === m.family && !inPlan.has(x.item) && !extra.some(e => e.item === x.item));
      if (q) extra.push({ item: q.item, card: card.id, qid: q.id, family: q.family, unit: card.unit, mode: G.MODE, kind: 'practice', again: m.item });
    }
    if (g && extra.length) {
      g.items = [...extra, ...arr(g.items).filter(x => !extra.some(e => e.item === x.item))].slice(0, Math.max(arr(g.items).length, extra.length));
      g.status = 'ready';
      g.note = [`${g.items.length} 道题`, g.contrast ? '1 张对比小卡' : ''].filter(Boolean).join('、');
    }
  }
  return d;
}

export function noteResult(plan, { kind = 'word', slug = '', item = '', card = '', family = '', correct = false, now = new Date() } = {}) {
  if (!plan) return plan;
  const p = { ...plan, misses: { words: { ...((plan.misses && plan.misses.words) || {}) }, grammar: { ...((plan.misses && plan.misses.grammar) || {}) } } };
  const day = dayOf(now);
  if (kind === 'word' && slug) {
    const r = p.misses.words[slug];
    if (!correct) p.misses.words[slug] = { n: ((r && r.n) || 0) + 1, day };
    else if (r && !r.fixed && r.day !== day) p.misses.words[slug] = { ...r, fixed: day };
  } else if (kind === 'grammar' && item) {
    const r = p.misses.grammar[item];
    if (!correct) p.misses.grammar[item] = { card: card || (r && r.card) || '', family: family || (r && r.family) || '', n: ((r && r.n) || 0) + 1, day };
    else if (r && !r.fixed && r.day !== day) p.misses.grammar[item] = { ...r, fixed: day };
    // a new sentence of a family she missed, right on a later day: that family is fixed
    if (correct) for (const [k, m] of Object.entries(p.misses.grammar)) if (m && !m.fixed && m.card === card && m.family === family && m.day !== day) p.misses.grammar[k] = { ...m, fixed: day };
  }
  p.updated = new Date(now).toISOString();
  return p;
}

export function markCell(plan, i, cellId, now = new Date()) {
  if (!plan) return plan;
  const key = String(i);
  const prev = (plan.done && plan.done[key]) || { cells: {} };
  return { ...plan, done: { ...(plan.done || {}), [key]: { cells: { ...(prev.cells || {}), [cellId]: true }, at: new Date(now).toISOString() } }, updated: new Date(now).toISOString() };
}

export function readPlan(kv) {
  try {
    const p = kv && kv.peek ? kv.peek(REVIEW_KEY, null) : null;
    return p && p.v === 1 && Array.isArray(p.days) && Array.isArray(p.units) ? p : null;
  } catch (e) { return null; }
}
export function activePlan(kv, now = new Date()) {
  const p = readPlan(kv);
  if (!p) return null;
  const today = dayOf(now);
  if (p.date && today > p.date) return null;
  if (!p.date && p.made !== today) return null;
  return isFinished(p) ? null : p;
}
export const savePlan = (kv, plan) => (kv && typeof kv.set === 'function' ? kv.set(REVIEW_KEY, plan) : Promise.resolve());

export function summaryLine(plan, i) {
  const d = plan && plan.days && plan.days[i];
  if (!d) return '';
  const parts = [];
  for (const c of d.cells) {
    if (c.status !== 'ready') continue;
    if (c.id === 'words') parts.push(`单词 ${c.items.length} 个`);
    if (c.id === 'grammar') parts.push(c.items.length ? `语法 ${c.items.length} 道` : '一张对比小卡');
    if (c.id === 'read') parts.push('读一篇');
    if (c.id === 'quiz') parts.push('一份小测');
  }
  const head = d.kind === 'today' ? '考前看一眼' : d.kind === 'cram' ? '今天一份' : d.kind === 'quiz' ? `第 ${d.n} 天，考前小测` : `今天是第 ${d.n} 天`;
  return `${head}：${parts.join('、') || '没有要练的'}，大约 ${Math.max(1, d.minutes)} 分钟。`;
}

// ---------------------------------------------------------------- 问老师: “我要考 Unit 1 2”

const WEEK = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
// the exam day said in words -> 'YYYY-MM-DD'; returns { date, rest } (rest is the text with the date taken out)
function parseDate(text, now) {
  const today = dayOf(now);
  let t = text;
  let date = '';
  const take = (re, f) => { if (date) return; const m = t.match(re); if (!m) return; const d = f(m); if (d) { date = d; t = t.replace(m[0], ' '); } };
  take(/大后天/, () => addDays(today, 3));
  take(/后天/, () => addDays(today, 2));
  take(/明天|明儿|明早|明日/, () => addDays(today, 1));
  take(/今天|今儿|今日|今早|待会儿?|一会儿/, () => today);
  take(/(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:以?后|之后)/, m => { const n = cnNumber(m[1]); return n >= 0 && n < 60 ? addDays(today, n) : ''; });
  take(/(下下|下个?|这个?|本)?\s*(?:周|星期|礼拜)\s*([日天一二三四五六])/, m => {
    const want = WEEK[m[2]];
    const dow = now.getDay();
    const mondayGap = (dow + 6) % 7;   // days since this Monday
    const offMon = (want + 6) % 7;      // Monday-based day of the week asked for
    if (m[1] && m[1].startsWith('下下')) return addDays(today, 14 - mondayGap + offMon);
    if (m[1] && m[1].startsWith('下')) return addDays(today, 7 - mondayGap + offMon);
    let g = offMon - mondayGap;
    if (g < 0 && !m[1]) g += 7;   // “周一考” on a Wednesday is next Monday
    return g < 0 ? '' : addDays(today, g);
  });
  take(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/, m => {
    const y = now.getFullYear();
    let d = dayOf(new Date(y, Number(m[1]) - 1, Number(m[2]), 12));
    if (Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) return '';
    if (d < today) d = dayOf(new Date(y + 1, Number(m[1]) - 1, Number(m[2]), 12));
    return d;
  });
  take(/(?:^|[^\d.])(\d{1,2})\s*(?:号|日)/, m => {
    const n = Number(m[1]);
    if (n < 1 || n > 31) return '';
    let d = dayOf(new Date(now.getFullYear(), now.getMonth(), n, 12));
    if (d < today) d = dayOf(new Date(now.getFullYear(), now.getMonth() + 1, n, 12));
    return d;
  });
  return { date, rest: t };
}

const SEP = '(?:\\s*(?:[,，、和与跟及&+/]|and|以及|还有)\\s*|\\s+)';
const RANGE = '\\s*(?:到|至|-|~|～|\u2014)\\s*';
// a run of unit numbers like “1 2”, “1、2”, “1-3”, “1 到 3”, “一二”, “一到三” -> [numbers]
function numberRun(s) {
  const out = [];
  const parts = String(s).split(new RegExp(`(${RANGE})`));
  let prev = null, range = false;
  for (const p of parts) {
    if (new RegExp(`^${RANGE}$`).test(p)) { range = true; continue; }
    const nums = [];
    for (const tok of p.split(new RegExp(SEP)).map(x => x.replace(/^(?:第|unit|u)\s*/i, '').trim()).filter(Boolean)) {
      if (/^\d+$/.test(tok)) nums.push(Number(tok));
      else if (/十/.test(tok)) { const n = cnNumber(tok); if (Number.isFinite(n)) nums.push(n); }
      else for (const ch of tok) { const n = cnNumber(ch); if (Number.isFinite(n)) nums.push(n); }
    }
    if (range && prev != null && nums.length) {
      const to = nums.shift();
      for (let k = Math.min(prev, to); k <= Math.max(prev, to); k++) out.push(k);
    }
    out.push(...nums);
    if (out.length) prev = out[out.length - 1];
    range = false;
  }
  return out.filter(n => n >= 1 && n <= 12);
}

function parseUnits(text, { current = '', progress = null } = {}) {
  const t = String(text);
  const out = [];
  if (/starter|预备单元|入门单元|开学单元|\bS\s*单元/i.test(t)) out.push('S');
  const NUM = '(?:\\d{1,2}|[一二两三四五六七八九十]+)';
  // Unit 1 2 / U1、U2 / unit 1-3 / Unit 1 和 Unit 2
  const en = new RegExp(`\\b(?:unit|u)\\s*${NUM}(?:(?:${SEP}|${RANGE})(?:(?:unit|u)\\s*)?${NUM}(?![\\d号日月天点]))*`, 'gi');
  for (const m of t.matchAll(en)) out.push(...numberRun(m[0]).map(n => 'U' + n));
  // 第三单元 / 第一二单元 / 第1、2单元 / 一到三单元 / 第一和第二单元 / 1-3 单元
  const cn = new RegExp(`(?:第\\s*)?${NUM}(?:(?:${SEP}|${RANGE})(?:第\\s*)?${NUM})*\\s*(?:个)?\\s*单元`, 'g');
  for (const m of t.matchAll(cn)) {
    if (/^(?:\d+|两|[二三四五六七八九十])\s*个\s*单元$/.test(m[0].trim())) continue;   // “两个单元” says how many, not which
    out.push(...numberRun(m[0].replace(/(?:个)?\s*单元$/, '')).map(n => 'U' + n));
  }
  if (/这个单元|本单元|这单元|这一单元|现在这个单元/.test(t) && normUnit(current)) out.push(normUnit(current));
  if (!out.length && /期中/.test(t) && progress) {
    const from = normUnit(progress.examFrom) || 'S', to = normUnit(progress.examTo) || 'U3';
    const lo = unitRank(from), hi = unitRank(to);
    for (let k = lo; k <= hi; k++) out.push(k === 0 ? 'S' : 'U' + k);
  }
  return sortUnits(out);
}

export function parseReviewText(text, { now = new Date(), current = '', progress = null } = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return null;
  const s = raw.replace(/\s+/g, ' ');
  const review = /复习|温习|准备一下|备考/.test(s);
  // 思考、参考、考虑 are not exams
  const exam = /考试?|测验|测试|小测|月考|期中|期末|单元测/.test(s.replace(/思考|参考|考虑|考察|考拉/g, ''));
  if (!review && !exam) return null;
  // already over, or a question about the word 考 itself
  if (!review && /考完|考了|考得|考砸|考过了|考的怎么样|考得怎么样|考试成绩|分数/.test(s)) return null;
  if (/听写/.test(s) && !review && !/考/.test(s.replace(/听写/g, ''))) return null;
  const { date, rest } = parseDate(s, now);
  const units = parseUnits(rest, { current, progress });
  if (!units.length) {
    // without a unit only a clear exam with a day counts (“明天要考试，帮我复习”); “帮我复习一下 like 的用法” is a grammar question
    if (/什么意思|怎么说|怎么读|怎么用|用法|区别|怎么写|翻译/.test(s)) return null;
    if (!(date && exam)) return null;
  }
  const out = { units, date };
  if (/期中/.test(s)) out.exam = 'midterm';
  else if (/期末/.test(s)) out.exam = 'final';
  return out;
}

const monthDay = day => { const [, m, d] = String(day).split('-').map(Number); return `${m} 月 ${d} 日`; };
function whenText(date, now) {
  if (!date) return '';
  const g = gapDays(dayOf(now), date);
  if (g === 0) return '今天考';
  if (g === 1) return '明天考';
  if (g === 2) return '后天考';
  return `${monthDay(date)}考，还有 ${g} 天`;
}
export function reviewReply(parsed, { now = new Date() } = {}) {
  const units = arr(parsed && parsed.units);
  const date = parsed && isDay(parsed.date) ? parsed.date : '';
  const action = { label: '开始复习', route: 'revise', params: { units: units.slice(), date } };
  const names = unitList(units);
  let text;
  if (!units.length) text = `好，${whenText(date, now) || '要考试'}。要复习哪几个单元？点下面选一下。`;
  else if (!date) text = `好，复习 ${names}。哪天考？点下面选一下日子。`;
  else {
    const g = gapDays(dayOf(now), date);
    if (g < 0) text = `${monthDay(date)}已经过去了。是哪天考？点下面再选一下。`;
    else if (g === 0) text = `好，${names}，今天考。我挑几个最要紧的，几分钟看一眼。`;
    else if (g === 1) text = `好，${names}，明天考。我给你排一份 20 分钟以内的复习，点下面开始。`;
    else text = `好，${names}，${whenText(date, now)}。我分 ${Math.min(g, MAX_DAYS)} 天排，每天一小份。`;
  }
  return { text, action };
}
