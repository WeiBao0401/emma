// 语法卡（DESIGN 5.4、5.5、8.2）：v1 三张卡，人称代词和物主代词（Unit 1）、there be（Unit 2）、名词所有格 's（Unit 3）；
// 10-25 加了四张打地基的卡（be 动词、名词复数、一般现在时和三单、can，foundation: true）和 Unit 4 的频度副词（ahead: true）。
// 内容全部预写在 curriculum/grammar.json，运行时不让模型讲规则。
// 负责：语法卡 agent（grammar.js、ui-grammar.js、css/grammar.css、curriculum/grammar.json、tests/grammar.test.mjs）。
//
// 先上哪张卡（nextCard，todayCard 用它）：一天一份 5 道；同一张卡的第二天要等到第一天以后。按这个先后：
//   1 接着做：上次开了头、没做完的那一份
//   2 补地基：她最近 21 天选错的干扰项里，有 2 次以上的误解属于某张地基卡（卡的 fixes，比如常错 is / are 就是 be 动词卡），
//     或者家长问卷说了这个语法点（state.grammarFocus），这张地基卡提前；错得多的先
//   3 跟单元：期中季以外，眼下的单元（课本进度；期中考完了就是下一个单元；家长给了 progress.nextFrom 就从开课前 7 天起算下一个单元）
//     的卡和它要用到的卡（foundations 对上卡的 points）
//   4 其余按卡的 order：be 动词、名词复数、代词、there be、所有格、一般现在时、can、频度副词；同一张卡先做完两天再换下一张
//   期中季（离考试 14 天以内，sprint.js examPhase）：只排期中范围的卡和它们要用到的地基卡，先把每张的第一天都做到，再做第二天；
//   范围以外的卡（一般现在时、can、频度副词）考完再上。
// 能排到的卡：地基卡一直能排；单元卡排到课本进度为止；ahead 的卡（频度副词）可以提前一个单元，期中季不提前。
//
// 这个文件是纯逻辑（不碰 DOM、不读数据库），Node 里直接测。画界面在 ui-grammar.js。
//
// 一张卡：中文规则 3-4 句、5-8 个例句、10 道题分两天（part 1 = 前 5 道，part 2 = 后 5 道），每题四级提示和一道变式题，
// 另有备用题（spares）。
// 一道题怎么走（DESIGN 5.5）：
//   答对（没看提示）→ 过关，grade 3。
//   答错 → 第 1 级提示自动出现；可以再选，也可以点“再给个提示”。每再答错一次，自动多给一级。
//   答错以后改对 → 过关，用了提示记“模糊”，grade 2（teacher-memory 的 fixed_after = 改对时看到第几级）。
//   到第 4 级（讲清楚，正确答案亮出来）→ 马上出变式题：做对才算这题过关（grade 2）；做错 grade 1，不算过。
//   没答就点了“给个提示”再答对：过关但记“模糊”（grade 2），不进 1、3、7 天的复习。
// 错过的题（第一次就选错了）在 1、3、7 天后用新句子再出：从同一张卡、同一类（family）的备用题里挑没出过的。
// 复习题第一次就答对，走到下一档（3 天、7 天，算法从错的那天起数）；又错了，从那天起重新数 1、3、7。
// “在练”的卡（第一天做完了，还没练稳）每天混 1-2 道进热身：先出到期的复习，再出备用题（grammarWarmItems）。
// 练稳 = 两天都做完、没有待复习的、热身和复习里连着答对 STEADY_STREAK 道。
//
// 导出
//   FILE = 'curriculum/grammar.json'；KV_PREFIX = 'grammar:'；MODE = 'grammar'；STEP = 'grammar'；BLANK = '____'
//   PART_SIZE = 5；HINT_MAX = 4；REVIEW_DAYS = [1, 3, 7]；WARM_MAX = 2；STEADY_STREAK = 3
//   FIX_MIN = 2；FIX_DAYS = 21（误解 21 天里出现 2 次就补地基）；AHEAD_DAYS = 7（下个单元开课前一周开始练）
//   loadGrammar({ fetchJSON }) -> Promise<Content>   读 grammar.json 并缓存（app.js 启动时调一次）；读不到抛错
//   setContent(data) -> Content | null；content() -> 缓存的 Content 或 null
//   createContent(data) -> Content
//     Content = { version, cards: [Card], card(id), item(itemId) -> Question | null, part(cardId, n) -> [Question],
//                 tags: { tag: { zh, kind } }（grammar.json 里还没合进 tags.json 的新标签）, tagName(tag, extra?) }
//     Card = { id, unit, order, foundation?, ahead?, label?, title, points, foundations, fixes?: [误解标签], rule: [句], table?,
//              examples: [{ en, zh, mark }], families: { id: { name, point } }, questions: [Question × 10], spares: [Question], index }
//     （地基卡的 unit 是 'S'，label '打地基'；没有 order 的卡排在有 order 的后面，按文件里的顺序）
//     names: { 'g:can': 中文名 }（grammar.json 里还没并进 prereq.json 的语法点）
//     Question = { id: 'q01' | 'q01v' | 's03', item: 'g:<card>:<id>', card, unit, part?, family, familyName, point, kind: 'fill' | 'pick',
//                  stem?, cue?, ask, answer, wrong: { 选项: 误解标签 }, zh, hints: [4 句] | [], explain, variant: Question | null,
//                  spare: bool, isVariant: bool }
//   kvKey(cardId) -> 'grammar:<cardId>'
//   emptyState(cardId) / normState(raw, cardId)   一张卡的进度（kv 'grammar:<cardId>'，形状见下）；normState 兼容缺字段的老数据
//   grammarState(kv, c?) -> { cards: { cardId: State }, progress? }   从 kv 读（kv.peek 同步）。ctx.planState() 用它填 state.grammar。
//       progress 是 kv 'progress'（只读），nextCard 拿它看课本进度和期中日期
//   optionsOf(q) -> [{ text, correct, tag }]   选项顺序按题目 id 固定打乱（同一题每次一样）
//   sentenceOf(q) -> string   答完以后显示和朗读的完整英文（填空把答案填进去；选择题就是答案）
//   createAttempt(q, { variant, now }) -> Attempt   一道题的状态（见下）
//   applyResult(state, { q, kind, of, result, now, step }) -> State   作答结果写进进度（纯函数，返回新对象）
//   startPart / markPart(state, part, { now }) -> State；partQuestions(c, state, cardId, part) -> [还没做的题]
//   flagQuestion(state, qid) -> State   “这题有问题”：以后不再出
//   cardStatus(state, now) -> 'new' | 'learning' | 'practicing' | 'steady'
//   nextCard(state, now, { content, upTo }) -> NextCard | null   今天做哪张卡的哪一天（规则见上面“先上哪张卡”）
//       state：grammarState 的返回值，或 planState 拼好的整份（读 state.grammar、state.progress）；另认 state.history / state.events
//       （事件数组：grammar.js 以外的语法题，比如 sprint.js 的兜底题，选错的误解也算）、state.grammarFocus（家长说的语法点 id）。
//       upTo 给了就当课本进度（覆盖 progress.unit）。null = 今天没有卡（做过一份了，或者能排的都做完了）
//       NextCard = { cardId, part: 1 | 2, reason: 'continue' | 'fix' | 'ahead' | 'unit' | 'exam' | 'order', why: 孩子能看的一句, tags?: [补地基的误解] }
//   todayCard(gstate, now, { content, upTo }) -> NextCard | null   就是 nextCard（app.js 一直调它）
//   misconceptionHits(state, now, { content, days }) -> { 误解标签: 次数 }   最近 days 天（默认 21）选错的干扰项；kv 里每道题算一次
//   grammarWarmItems(state, now, { content, max }) -> [WarmItem]   给 plan.js：今天热身混哪 1-2 道语法题
//       state 可以是 planState 拼好的整份（读 state.grammar）或 grammarState 的返回值。没内容、没在练的卡时返回 []。
//       先出到期的复习（到期早的先，同一天按卡的 order）；再从在练的卡里出备用题，最久没在热身里练过的卡先，一样久按 order，
//       这样在练的卡多了也轮得到每一张。
//       WarmItem = { item: 'g:<card>:<id>', card, qid, kind: 'review' | 'practice', of?: 原来错的那题 id, family, unit, mode: 'grammar' }
//       同一天、同样的进度，返回的一样（不随机）。今天热身已经做了几道，就少给几道。
//   resolveWarmItem(item, c?) -> Question | null
//   variantFor(c, q, state) -> Question | null   第 4 级以后出的变式题：主题有自己的；备用题从同类里挑一道没出过的
//   summary(gstate, now, { content, tags }) -> [每张卡的统计]   给家长区、周小结：状态、做了几道、对 / 模糊 / 没过、待复习、常见误解
//   createRun({ content, cardId, part, items, state, now, log, save, sid, step }) -> Run
//       界面用的一次“做题”：part 给了是一张卡的一天（5 道，跳过已经做过的）；items 给了是热身里的 1-2 道。
//       Run = { questions, index, total, current(), attempt, variant, pick(i), hint(), pickVariant(i), flag(), next() -> 下一题或 null,
//               finished, stats: { right, fuzzy, failed, flagged }, results: [{ item, kind, grade, passed, clean }], state, states() }
//       每次选择记一条 events 'answer'，每级提示记一条 'hint'，“这题有问题”记 'flag'（log 由调用方给，通常是 ctx.events.log）。
//       每题做完 save(cardId, state)（通常写 kv 'grammar:<cardId>'）。
//
// Attempt（纯状态）
//   { options, phase: 'ask' | 'retry' | 'variant' | 'done', level, wrongs, picked: Set<i>, vOptions, passed, grade, clean,
//     pick(i) -> Pick | null, hint() -> { level, text, auto: false } | null, pickVariant(i) -> Pick | null, result() }
//   Pick = { correct, text, tag, level（选的时候看到第几级）, first（这题第一次选）, hintShown?: { level, text, auto: true },
//            done（这题结束了）, event }   event 是 events 'answer' 的字段（sid、step 由 Run 补）
//   result() = { item, qid, passed, grade, clean（第一次就对，没看提示）, firstTry（第一次选就对）, hintLevel, wrongs, tags, variantCorrect }
//
// kv 'grammar:<cardId>'（新加的键，CONTRACTS 第 5 节；备份照常带上）
//   { v: 1, card, parts: { '1': { started, done?, answered: [qid], right, fuzzy, failed }, '2': {...} },
//     items: { qid: { n, last, grade, passed, clean, hint, tags } },
//     reviews: [{ id: 错的那题, family, miss: 'YYYY-MM-DD', step: 0..2, due: 'YYYY-MM-DD', served: [qid] }],
//     flagged: [qid], warm: { day, n } | null, streak, updated }
//
// 事件（CONTRACTS 第 6 节的字段，加了几个）
//   answer { item, mode: 'grammar', step, sid, unit, card, point, family, kind: 'card' | 'review' | 'practice', part?, variant?,
//            choice, correct, first_try, ms, hint_level, misconception（选错的那个干扰项的标签，答对 null）,
//            done?, passed?, grade?, fixed_after? }   done 那条是这题的结局
//   hint { item, mode: 'grammar', step, sid, unit, card, level, auto }   auto：答错自动出现的
//   flag { item, mode: 'grammar', step, sid, unit, card }

import { examPhase } from './sprint.js';   // the exam season (14 days before kv 'progress'.examDate), the same rule plan.js uses

export const FILE = 'curriculum/grammar.json';
export const KV_PREFIX = 'grammar:';
export const MODE = 'grammar';
export const STEP = 'grammar';
export const BLANK = '____';
export const PART_SIZE = 5;
export const HINT_MAX = 4;
export const REVIEW_DAYS = [1, 3, 7];
export const WARM_MAX = 2;
export const STEADY_STREAK = 3;
export const FIX_MIN = 2;
export const FIX_DAYS = 21;
export const AHEAD_DAYS = 7;

// ---------------------------------------------------------------- dates (local days, like plan.js)

const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : typeof x === 'function' ? toDate(x()) : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12));
}
const isoLocal = d => {
  const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const unitRank = id => { const s = String(id ?? '').trim(); if (/^s(tarter)?$/i.test(s)) return 0; const m = s.match(/^u(?:nit)?\s*(\d+)$/i); return m ? Number(m[1]) : 1000; };
const isDay = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
// the order cards are taught in (grammar.json "order"); cards without one come after, in file order
const orderOf = card => (card && Number.isFinite(card.order) ? card.order : 100 + ((card && card.index) || 0));
const byOrder = (a, b) => orderOf(a) - orderOf(b);

// ---------------------------------------------------------------- content

let cached = null;
export function setContent(data) { cached = data ? createContent(data) : null; return cached; }
export function content() { return cached; }
export async function loadGrammar({ fetchJSON } = {}) {
  const get = fetchJSON || (async p => { const r = await fetch(p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
  return setContent(await get(FILE));
}

function normQuestion(raw, card, extra) {
  const fam = (card.families || {})[raw.family] || {};
  const q = {
    id: raw.id, item: `g:${card.id}:${raw.id}`, card: card.id, unit: card.unit, part: raw.part || null,
    family: raw.family || '', familyName: fam.name || '', point: raw.point || fam.point || (card.points || [])[0] || '',
    kind: raw.kind === 'pick' ? 'pick' : 'fill', stem: raw.stem || '', cue: raw.cue || '',
    ask: raw.ask || (raw.kind === 'pick' ? '选出正确的句子。' : '选出填进空里的词。'),
    answer: String(raw.answer), wrong: { ...(raw.wrong || {}) }, zh: raw.zh || '',
    hints: Array.isArray(raw.hints) ? raw.hints.slice(0, HINT_MAX) : [],
    explain: raw.explain || (Array.isArray(raw.hints) ? raw.hints[HINT_MAX - 1] || '' : ''),
    variant: null, spare: false, isVariant: false, ...extra,
  };
  return q;
}

export function createContent(data) {
  const cards = [];
  const items = new Map();
  for (const [index, c] of ((data && data.cards) || []).entries()) {
    const card = { ...c, index, families: c.families || {}, rule: c.rule || [], examples: c.examples || [], questions: [], spares: [] };
    for (const raw of c.questions || []) {
      const q = normQuestion(raw, card, {});
      if (raw.variant) {
        q.variant = normQuestion({ ...raw.variant, id: raw.id + 'v', family: raw.variant.family || raw.family, part: raw.part }, card, { isVariant: true, of: raw.id });
        items.set(q.variant.item, q.variant);
      }
      card.questions.push(q);
      items.set(q.item, q);
    }
    for (const raw of c.spares || []) {
      const q = normQuestion(raw, card, { spare: true });
      card.spares.push(q);
      items.set(q.item, q);
    }
    cards.push(card);
  }
  const byId = new Map(cards.map(c => [c.id, c]));
  const tags = { ...((data && data.tags) || {}) };
  return {
    version: (data && data.version) || 1,
    cards,
    tags,
    names: { ...((data && data.names) || {}) },
    card: id => byId.get(id) || null,
    item: itemId => items.get(itemId) || null,
    part: (cardId, n) => { const c = byId.get(cardId); return c ? c.questions.filter(q => Number(q.part) === Number(n)) : []; },
    tagName: (tag, extra = null) => {
      const t = (extra && (extra.tags || extra)[tag]) || tags[tag];
      return (t && t.zh) || String(tag || '');
    },
  };
}

// ---------------------------------------------------------------- questions

// small stable hash (FNV-1a) so the same question always shows its options in the same order
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }
export function optionsOf(q) {
  const list = [{ text: q.answer, correct: true, tag: null }, ...Object.entries(q.wrong || {}).map(([text, tag]) => ({ text, correct: false, tag: tag || null }))];
  let seed = hash(q.item || q.id) || 1;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
export function sentenceOf(q) {
  if (!q) return '';
  if (q.kind === 'fill' && q.stem.includes(BLANK)) return q.stem.replace(BLANK, q.answer);
  return q.answer;
}

export function createAttempt(q, { variant = null, now = () => Date.now() } = {}) {
  const clock = typeof now === 'function' ? now : () => +toDate(now);
  const options = optionsOf(q);
  const vOptions = variant ? optionsOf(variant) : null;
  const picked = new Set();
  const tags = [];
  let phase = 'ask', level = 0, wrongs = 0, passed = null, clean = false, firstTry = null, variantCorrect = null;
  let t0 = clock(), vT0 = 0, hintBeforeAnswer = false;
  const a = {
    q, variant, options, vOptions, picked,
    get phase() { return phase; }, get level() { return level; }, get wrongs() { return wrongs; }, get passed() { return passed; },
    get clean() { return clean; }, get done() { return phase === 'done'; },
    get grade() { return passed === null ? null : passed ? (clean ? 3 : 2) : 1; },
  };
  function reveal() {
    if (variant) { phase = 'variant'; vT0 = clock(); } else { phase = 'done'; passed = false; }
  }
  function baseEvent(question, opt, ms, extra) {
    return { item: question.item, mode: MODE, unit: question.unit, card: question.card, point: question.point, family: question.family,
      choice: opt.text, correct: !!opt.correct, ms: Math.max(0, Math.round(ms)), misconception: opt.correct ? null : opt.tag || null, ...extra };
  }
  a.hint = () => {
    if (phase !== 'ask' && phase !== 'retry') return null;
    if (level >= HINT_MAX) return null;
    if (!wrongs) hintBeforeAnswer = true;
    level++;
    const out = { level, text: q.hints[level - 1] || '', auto: false };
    if (level >= HINT_MAX) reveal();
    return out;
  };
  a.pick = i => {
    if (phase !== 'ask' && phase !== 'retry') return null;
    const opt = options[i];
    if (!opt || picked.has(i)) return null;
    picked.add(i);
    const first = firstTry === null;
    if (first) firstTry = !!opt.correct;
    const seen = level;
    const ms = clock() - t0;
    const out = { correct: !!opt.correct, text: opt.text, tag: opt.correct ? null : opt.tag, level: seen, first, done: false, hintShown: null };
    if (opt.correct) {
      phase = 'done'; passed = true; clean = first && !hintBeforeAnswer && level === 0;
      out.done = true;
      out.event = baseEvent(q, opt, ms, { first_try: first, hint_level: seen, done: true, passed: true, grade: clean ? 3 : 2,
        ...(wrongs ? { fixed_after: seen } : {}) });
      return out;
    }
    wrongs++;
    if (opt.tag) tags.push(opt.tag);
    phase = 'retry';
    if (level < HINT_MAX) {
      level++;
      out.hintShown = { level, text: q.hints[level - 1] || '', auto: true };
      if (level >= HINT_MAX) reveal();
    }
    out.done = phase === 'done';
    out.event = baseEvent(q, opt, ms, { first_try: first, hint_level: seen, ...(out.done ? { done: true, passed: false, grade: 1 } : {}) });
    return out;
  };
  a.pickVariant = i => {
    if (phase !== 'variant' || !variant) return null;
    const opt = vOptions[i];
    if (!opt) return null;
    phase = 'done';
    variantCorrect = !!opt.correct;
    passed = variantCorrect;
    const out = { correct: !!opt.correct, text: opt.text, tag: opt.correct ? null : opt.tag, level: HINT_MAX, first: true, done: true, hintShown: null };
    out.event = baseEvent(variant, opt, clock() - vT0, { first_try: true, hint_level: 0, variant: true, of: q.item,
      done: true, passed, grade: passed ? 2 : 1 });
    return out;
  };
  a.result = () => ({ item: q.item, qid: q.id, passed: !!passed, grade: a.grade || 1, clean, firstTry: firstTry === true,
    hintLevel: level, wrongs, tags: tags.slice(), variantCorrect });
  return a;
}

// ---------------------------------------------------------------- progress (kv 'grammar:<cardId>')

export const kvKey = cardId => KV_PREFIX + cardId;
export function emptyState(cardId) {
  return { v: 1, card: cardId, parts: {}, items: {}, seen: {}, reviews: [], flagged: [], warm: null, streak: 0, updated: null };
}
export function normState(raw, cardId) {
  const s = raw && typeof raw === 'object' ? clone(raw) : {};
  const e = emptyState(cardId || s.card);
  return {
    ...e, ...s,
    card: s.card || cardId,
    parts: s.parts && typeof s.parts === 'object' ? s.parts : {},
    items: s.items && typeof s.items === 'object' ? s.items : {},
    seen: s.seen && typeof s.seen === 'object' ? s.seen : {},
    reviews: Array.isArray(s.reviews) ? s.reviews.filter(r => r && r.id) : [],
    flagged: Array.isArray(s.flagged) ? s.flagged : [],
    streak: Number(s.streak) || 0,
  };
}
export function grammarState(kv, c = cached) {
  const cards = {};
  const ids = c ? c.cards.map(x => x.id) : [];
  if (kv && typeof kv.keys === 'function') for (const k of kv.keys(KV_PREFIX)) { const id = k.slice(KV_PREFIX.length); if (id && !ids.includes(id)) ids.push(id); }
  for (const id of ids) cards[id] = normState(kv && typeof kv.peek === 'function' ? kv.peek(kvKey(id), null) : null, id);
  const out = { cards };
  // the textbook unit and the exam date decide which card comes next (nextCard); read only
  const progress = kv && typeof kv.peek === 'function' ? kv.peek('progress', null) : null;
  if (progress && typeof progress === 'object') out.progress = progress;
  return out;
}
const stateOf = (g, id) => normState(g && g.cards && g.cards[id], id);

function partRec(s, part) {
  const k = String(part);
  if (!s.parts[k]) s.parts[k] = { started: null, answered: [], right: 0, fuzzy: 0, failed: 0 };
  const p = s.parts[k];
  if (!Array.isArray(p.answered)) p.answered = [];
  return p;
}
export function startPart(state, part, { now = new Date() } = {}) {
  const s = normState(state);
  const p = partRec(s, part);
  if (!p.started) p.started = dayOf(now);
  s.updated = isoLocal(toDate(now));
  return s;
}
export function markPart(state, part, { now = new Date() } = {}) {
  const s = normState(state);
  const p = partRec(s, part);
  if (!p.started) p.started = dayOf(now);
  if (!p.done) p.done = dayOf(now);
  s.updated = isoLocal(toDate(now));
  return s;
}
export function flagQuestion(state, qid) {
  const s = normState(state);
  if (!s.flagged.includes(qid)) s.flagged.push(qid);
  return s;
}
export function partQuestions(c, state, cardId, part) {
  const s = normState(state, cardId);
  const p = s.parts[String(part)] || { answered: [] };
  return (c || cached).part(cardId, part).filter(q => !s.flagged.includes(q.id) && !(p.answered || []).includes(q.id));
}

// result: Attempt.result(); kind: 'card' | 'review' | 'practice'; of: the review chain id (the question she got wrong)
export function applyResult(state, { q, kind = 'card', of = null, result, now = new Date(), step = '' } = {}) {
  const s = normState(state, q && q.card);
  if (!q || !result) return s;
  const day = dayOf(now);
  const prev = s.items[q.id] || {};
  s.items[q.id] = { n: (prev.n || 0) + 1, last: day, grade: result.grade, passed: !!result.passed, clean: !!result.clean,
    hint: result.hintLevel || 0, tags: (result.tags || []).slice(0, 4) };
  if (kind === 'card' && q.part) {
    const p = partRec(s, q.part);
    if (!p.started) p.started = day;
    if (!p.answered.includes(q.id)) p.answered.push(q.id);
    if (result.clean) p.right = (p.right || 0) + 1;
    else if (result.passed) p.fuzzy = (p.fuzzy || 0) + 1;
    else p.failed = (p.failed || 0) + 1;
  }
  const missed = result.wrongs > 0 || !result.passed || (result.hintLevel || 0) >= HINT_MAX;
  if (kind === 'review' && of) {
    const r = s.reviews.find(x => x.id === of);
    if (r) {
      r.served = [...new Set([...(r.served || []), q.id])];
      if (result.clean) {
        r.step = (r.step || 0) + 1;
        if (r.step >= REVIEW_DAYS.length) s.reviews = s.reviews.filter(x => x !== r);
        else { const d = addDays(r.miss, REVIEW_DAYS[r.step]); r.due = d > day ? d : addDays(day, 1); }
      } else { r.miss = day; r.step = 0; r.due = addDays(day, REVIEW_DAYS[0]); }
    }
  } else if (missed) {
    const id = q.isVariant ? q.of : q.id;
    const r = s.reviews.find(x => x.id === id);
    const rec = { id, family: q.family, miss: day, step: 0, due: addDays(day, REVIEW_DAYS[0]), served: r ? r.served || [] : [] };
    s.reviews = [...s.reviews.filter(x => x.id !== id), rec];
  }
  if (kind !== 'card') {
    s.streak = result.clean ? (s.streak || 0) + 1 : 0;
    if (step === 'warmup' || kind === 'practice' || kind === 'review') {
      const n = s.warm && s.warm.day === day ? s.warm.n || 0 : 0;
      s.warm = { day, n: n + 1 };
    }
  }
  s.updated = isoLocal(toDate(now));
  return s;
}

export function cardStatus(state, now = new Date()) {
  const s = normState(state);
  const p1 = s.parts['1'] || {}, p2 = s.parts['2'] || {};
  if (!p1.started && !(p1.answered || []).length && !p1.done) return 'new';
  if (!p1.done) return 'learning';
  if (p2.done && !s.reviews.length && s.streak >= STEADY_STREAK) return 'steady';
  return 'practicing';
}

// ---------------------------------------------------------------- which card next

// state.grammar (planState), or grammarState's return value itself
const gOf = state => (state && state.grammar && state.grammar.cards ? state.grammar : state && state.cards ? state : null);

// The misconceptions she picked in the last `days` days: every grammar question in kv (card days and warm-up) counts each
// tag once; events (state.history / state.events) add the grammar questions kv does not keep, like sprint.js's fallback ones.
export function misconceptionHits(state, now = new Date(), { content: c = null, days = FIX_DAYS } = {}) {
  const ct = c || cached;
  const g = gOf(state);
  const from = addDays(dayOf(now), -days);   // later than this day counts
  const hits = {};
  const add = t => { if (t) hits[t] = (hits[t] || 0) + 1; };
  for (const raw of Object.values((g && g.cards) || {})) {
    const s = normState(raw);
    for (const it of Object.values(s.items)) {
      if (!it || !it.last || String(it.last) <= from) continue;
      for (const t of new Set(Array.isArray(it.tags) ? it.tags : [])) add(t);
    }
  }
  const evs = state && (Array.isArray(state.history) ? state.history : Array.isArray(state.events) ? state.events : null);
  for (const e of evs || []) {
    if (!e || e.type !== 'answer' || e.correct !== false || !e.misconception) continue;
    if (String(e.at || '').slice(0, 10) <= from) continue;
    if (ct && e.item && ct.item(e.item)) continue;   // a grammar.js question: already counted from kv
    add(e.misconception);
  }
  return hits;
}

const nameOf = card => String(card.title || card.id).split('：')[0];
// a space between Chinese and an English word: 练 be 动词，所有格 's 练一练
const spL = s => (/^[A-Za-z']/.test(s) ? ' ' : '') + s;
const spLR = s => spL(s) + (/[A-Za-z']$/.test(s) ? ' ' : '');
function whyOf(card, reason, lead) {
  const name = nameOf(card);
  switch (reason) {
    case 'continue': return `上次的${spLR(name)}还没做完，接着做。`;
    case 'fix': return `这几天有几处错和${spLR(name)}有关，今天先把它补牢。`;
    case 'ahead': return lead ? `下个单元要学${spL(name)}，提前练一练。` : `下个单元要用到${spL(name)}，先练它。`;
    case 'unit': return lead ? `课本这个单元学${spL(name)}，跟上课本。` : `这个单元要用到${spL(name)}，先练它。`;
    case 'exam': return `期中前把${spLR(name)}练一练。`;
    default: return card.foundation ? `先把地基打牢：今天练${spL(name)}。` : `今天学${spL(name)}。`;
  }
}

export function nextCard(state, now = new Date(), { content: c = null, upTo = null } = {}) {
  const ct = c || cached;
  if (!ct) return null;
  const g = gOf(state) || { cards: {} };
  const progress = (state && state.progress) || g.progress || {};
  const day = dayOf(now);
  const states = new Map(ct.cards.map(card => [card.id, stateOf(g, card.id)]));
  if ([...states.values()].some(s => Object.values(s.parts).some(p => p && p.done === day))) return null;   // one part a day

  const cur = upTo != null && upTo !== '' ? upTo : progress.unit || '';
  const curRank = cur ? unitRank(cur) : Infinity;   // no textbook unit set: every unit counts as learned
  const ex = examPhase(progress, toDate(now));
  const season = ex.on || ex.phase === 'day';
  const lo = unitRank(ex.from), hi = unitRank(ex.to);
  const rank = card => unitRank(card.unit);
  // the unit in focus outside the season: the one after the exam range once the exam is over, the next one from 7 days
  // before the parent's start date (progress.nextFrom), otherwise the textbook unit she is on
  let focus = null;
  if (!season) {
    if (ex.phase === 'after' && (!Number.isFinite(curRank) || curRank <= hi)) focus = hi + 1;
    else if (Number.isFinite(curRank) && isDay(progress.nextFrom) && day >= addDays(String(progress.nextFrom).slice(0, 10), -AHEAD_DAYS)) focus = curRank + 1;
    else if (Number.isFinite(curRank)) focus = curRank;
  }
  const reach = card => !!card.foundation || rank(card) <= curRank || (focus !== null && rank(card) === focus)
    || (!!card.ahead && !season && rank(card) === curRank + 1);
  // the exam: the unit cards in its range and the cards they lean on
  const inRange = card => !card.foundation && rank(card) >= lo && rank(card) <= hi && reach(card);
  const leansOn = list => new Set(list.flatMap(x => x.foundations || []));
  const examNeeds = leansOn(ct.cards.filter(inRange));
  const examCard = card => inRange(card) || (card.points || []).some(p => examNeeds.has(p));
  // the unit in focus: its cards and the cards they lean on
  const focusCards = focus === null ? [] : ct.cards.filter(card => !card.foundation && rank(card) === focus && reach(card));
  const focusNeeds = leansOn(focusCards);
  const inFocus = card => focusCards.includes(card) || (card.points || []).some(p => focusNeeds.has(p));
  const focusReason = Number.isFinite(curRank) && focus > curRank ? 'ahead' : 'unit';

  const hits = misconceptionHits(state, now, { content: ct });
  const focusPoints = new Set(Array.isArray(state && state.grammarFocus) ? state.grammarFocus : []);
  const list = [];
  for (const card of ct.cards) {
    if (!reach(card) || (season && !examCard(card))) continue;
    const s = states.get(card.id);
    const p1 = s.parts['1'] || {}, p2 = s.parts['2'] || {};
    const part = !p1.done ? 1 : !p2.done && p1.done < day ? 2 : 0;
    if (!part) continue;
    const p = part === 1 ? p1 : p2;
    const started = !!(p.started || (Array.isArray(p.answered) && p.answered.length));
    const tags = card.foundation ? (card.fixes || []).filter(t => hits[t]).sort((a, b) => hits[b] - hits[a]) : [];
    const n = tags.reduce((a, t) => a + hits[t], 0) + ((card.points || []).some(x => focusPoints.has(x)) ? FIX_MIN : 0);
    let tier, reason;
    if (started) { tier = 0; reason = 'continue'; }
    else if (card.foundation && n >= FIX_MIN) { tier = 1; reason = 'fix'; }
    else if (!season && inFocus(card)) { tier = 2; reason = focusReason; }
    else { tier = 3; reason = season ? 'exam' : 'order'; }
    list.push({ card, part, tier, reason, n, tags, lead: focusCards.includes(card) });
  }
  // the season goes wide (the first day of every card before any second day); otherwise one card's two days, then the next
  list.sort((a, b) => a.tier - b.tier || (a.tier === 1 ? b.n - a.n : 0) || (season ? a.part - b.part : 0)
    || byOrder(a.card, b.card) || a.part - b.part);
  const best = list[0];
  if (!best) return null;
  return { cardId: best.card.id, part: best.part, reason: best.reason, why: whyOf(best.card, best.reason, best.lead),
    ...(best.reason === 'fix' && best.tags.length ? { tags: best.tags } : {}) };
}

// app.js asks for today's card this way: grammarState(kv) carries kv 'progress', upTo is the textbook unit
export function todayCard(gstate, now = new Date(), { content: c = null, upTo = null } = {}) {
  return nextCard(gstate, now, { content: c, upTo });
}

// ---------------------------------------------------------------- new sentences for reviews and the warm-up

// A new sentence from the card's spares. With a family (a review): the same kind of question first, even one she has
// seen before, because the review is about that point; without (warm-up practice): families she missed first, then any.
// Main questions' variants she never saw are the last fresh ones; when everything has been seen, the one seen longest ago.
function sparePick(card, s, family, exclude = []) {
  const skip = new Set([...exclude, ...s.flagged]);
  const last = q => (s.items[q.id] && s.items[q.id].last) || s.seen[q.id] || '';
  const seen = q => !!last(q);
  const pool = card.spares.filter(q => !skip.has(q.id));
  const variants = card.questions.map(q => q.variant).filter(v => v && !skip.has(v.id));
  const fresh = list => list.find(q => !seen(q)) || null;
  const oldest = list => list.filter(seen).sort((a, b) => String(last(a)).localeCompare(String(last(b))))[0] || null;
  const fam = list => list.filter(q => q.family === family);
  if (family) return fresh(fam(pool)) || fresh(fam(variants)) || oldest(fam(pool)) || fresh(pool) || fresh(variants) || oldest(pool) || null;
  const missed = new Set(s.reviews.map(r => r.family));
  return fresh(pool.filter(q => missed.has(q.family))) || fresh(pool) || fresh(variants) || oldest(pool) || null;
}

export function variantFor(c, q, state) {
  if (!q) return null;
  if (q.variant) return q.variant;
  const card = (c || cached) && (c || cached).card(q.card);
  if (!card) return null;
  const s = normState(state, q.card);
  return sparePick(card, s, q.family, [q.id]);
}

export function resolveWarmItem(item, c = cached) {
  if (!c || !item) return null;
  return c.item(typeof item === 'string' ? item : item.item) || null;
}

export function grammarWarmItems(state, now = new Date(), { content: c = null, max = WARM_MAX } = {}) {
  const g = state && (state.grammar || (state.cards ? state : null));
  const ct = c || (g && g.content) || cached;
  if (!g || !ct) return [];
  const day = dayOf(now);
  const states = ct.cards.map(card => [card, stateOf(g, card.id)]);
  const used = states.reduce((n, [, s]) => n + (s.warm && s.warm.day === day ? s.warm.n || 0 : 0), 0);
  const room = Math.max(0, Math.min(max, WARM_MAX) - used);
  if (!room) return [];
  const due = [];
  for (const [card, s] of states) for (const r of s.reviews) if (r.due && r.due <= day) due.push([card, s, r]);
  due.sort((a, b) => String(a[2].due).localeCompare(String(b[2].due)) || byOrder(a[0], b[0]));
  // the card practised longest ago in the warm-up first, so with many cards in practice each one gets its turn
  const lastWarm = s => (s.warm && s.warm.day) || '';
  const practicing = states.filter(([, s]) => cardStatus(s, now) === 'practicing'
    && !Object.values(s.parts).some(p => p && p.done === day))   // she did this card's five questions today already
    .sort((a, b) => String(lastWarm(a[1])).localeCompare(String(lastWarm(b[1]))) || byOrder(a[0], b[0]));
  const want = Math.min(room, due.length + practicing.length >= 2 ? 2 : due.length + practicing.length);
  const out = [];
  const taken = new Map();   // cardId -> qids already chosen today
  const take = (card, q, extra) => {
    out.push({ item: q.item, card: card.id, qid: q.id, family: q.family, unit: card.unit, mode: MODE, ...extra });
    taken.set(card.id, [...(taken.get(card.id) || []), q.id]);
  };
  for (const [card, s, r] of due) {
    if (out.length >= want) break;
    const q = sparePick(card, s, r.family, [r.id, ...(r.served || []), ...(taken.get(card.id) || [])]);
    if (q) take(card, q, { kind: 'review', of: r.id });
  }
  for (let round = 0; out.length < want && round < 2; round++) {
    for (const [card, s] of practicing) {
      if (out.length >= want) break;
      if (round === 0 && taken.has(card.id)) continue;
      const q = sparePick(card, s, '', taken.get(card.id) || []);
      if (q && !out.some(x => x.item === q.item)) take(card, q, { kind: 'practice' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- parent / weekly summary

export function summary(gstate, now = new Date(), { content: c = cached, tags = null } = {}) {
  if (!c) return [];
  const day = dayOf(now);
  return c.cards.slice().sort(byOrder).map(card => {   // in teaching order: the foundations first
    const s = stateOf(gstate, card.id);
    const vals = Object.entries(s.items);
    const count = { right: 0, fuzzy: 0, failed: 0 };
    const tagN = {};
    for (const [, it] of vals) {
      if (it.clean) count.right++; else if (it.passed) count.fuzzy++; else count.failed++;
      for (const t of it.tags || []) tagN[t] = (tagN[t] || 0) + 1;
    }
    return {
      id: card.id, title: card.title, unit: card.unit, label: card.label || '', foundation: !!card.foundation, status: cardStatus(s, now),
      parts: { 1: !!(s.parts['1'] && s.parts['1'].done), 2: !!(s.parts['2'] && s.parts['2'].done) },
      answered: vals.length, ...count,
      reviewsDue: s.reviews.filter(r => r.due <= day).length, reviewsPending: s.reviews.length,
      tags: Object.entries(tagN).sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n, zh: c.tagName(tag, tags) })),
    };
  });
}

// ---------------------------------------------------------------- a run: one card part, or the warm-up items

export function createRun({ content: c = cached, cardId = '', part = 0, items = null, state = null, states = null,
  now = () => new Date(), log = () => {}, save = () => {}, sid = '', step = STEP } = {}) {
  const ct = c;
  const clock = typeof now === 'function' ? now : () => toDate(now);
  const cur = {};   // cardId -> state
  const getState = id => (cur[id] || (cur[id] = normState((states && states[id]) || (id === cardId ? state : null), id)));
  const list = [];
  const isCardRun = !(items && items.length) && !!(cardId && part);
  if (items && items.length) {
    for (const it of items) { const q = resolveWarmItem(it, ct); if (q) list.push({ q, kind: it.kind || 'practice', of: it.of || null }); }
  } else if (cardId && part) {
    let s = getState(cardId);
    for (const q of partQuestions(ct, s, cardId, part)) list.push({ q, kind: 'card', of: null });
    cur[cardId] = startPart(s, part, { now: clock() });
  }
  const stats = { right: 0, fuzzy: 0, failed: 0, flagged: 0 };
  const results = [];   // one per finished question: { item, kind, grade, passed, clean }
  let index = 0, attempt = null, finished = !list.length;
  const emit = ev => { try { const r = log({ sid: sid || undefined, step, ...ev }); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { /* recording never blocks an answer */ } };
  const meta = x => ({ kind: x.kind, ...(x.kind === 'card' && x.q.part ? { part: x.q.part } : {}), ...(x.of ? { review_of: x.of } : {}) });
  function open() {
    if (index >= list.length) { attempt = null; return null; }
    const x = list[index];
    attempt = createAttempt(x.q, { variant: variantFor(ct, x.q, getState(x.q.card)), now: () => +clock() });
    return x;
  }
  async function finishQuestion() {
    const x = list[index];
    const r = attempt.result();
    if (r.grade === 3) stats.right++; else if (r.passed) stats.fuzzy++; else stats.failed++;
    results.push({ item: x.q.item, kind: x.kind, grade: r.grade, passed: r.passed, clean: r.clean });
    const id = x.q.card;
    cur[id] = applyResult(getState(id), { q: x.q, kind: x.kind, of: x.of, result: r, now: clock(), step });
    // a variant she was shown counts as seen, so it is not served again as a "new sentence" later
    if (r.variantCorrect !== null && attempt.variant) cur[id].seen = { ...cur[id].seen, [attempt.variant.id]: dayOf(clock()) };
    if (isCardRun && index + 1 >= list.length) cur[cardId] = markPart(getState(cardId), part, { now: clock() });
    await persist(id);
  }
  async function persist(id) { try { await save(id, cur[id]); } catch (e) { /* kv write failed: progress stays in memory */ } }
  function endIfLast() { if (index + 1 >= list.length) finished = true; }
  // every question of this part was answered last time but the part was never closed (she left on the last one)
  if (isCardRun && !list.length) { cur[cardId] = markPart(getState(cardId), part, { now: clock() }); persist(cardId); }
  open();
  const run = {
    get questions() { return list.map(x => x.q); },
    get index() { return index; },
    get total() { return list.length; },
    get attempt() { return attempt; },
    get variant() { return attempt && attempt.variant; },
    get finished() { return finished; },
    get stats() { return { ...stats }; },
    get results() { return results.slice(); },
    get state() { return cardId ? getState(cardId) : null; },
    states: () => ({ ...cur }),
    current: () => (index < list.length ? list[index] : null),
    pick(i) {
      if (!attempt) return null;
      const x = list[index];
      const p = attempt.pick(i);
      if (!p) return null;
      emit({ type: 'answer', ...p.event, ...meta(x) });
      if (p.hintShown) emit({ type: 'hint', item: x.q.item, mode: MODE, unit: x.q.unit, card: x.q.card, level: p.hintShown.level, auto: true });
      if (attempt.done) p.saved = finishQuestion();
      return p;
    },
    hint() {
      if (!attempt) return null;
      const x = list[index];
      const hh = attempt.hint();
      if (!hh) return null;
      emit({ type: 'hint', item: x.q.item, mode: MODE, unit: x.q.unit, card: x.q.card, level: hh.level, auto: false });
      if (attempt.done) hh.saved = finishQuestion();
      return hh;
    },
    pickVariant(i) {
      if (!attempt) return null;
      const x = list[index];
      const p = attempt.pickVariant(i);
      if (!p) return null;
      emit({ type: 'answer', ...p.event, ...meta(x) });
      p.saved = finishQuestion();
      return p;
    },
    async flag() {
      const x = list[index];
      if (!x) return null;
      emit({ type: 'flag', item: x.q.item, mode: MODE, unit: x.q.unit, card: x.q.card });
      stats.flagged++;
      const id = x.q.card;
      cur[id] = flagQuestion(getState(id), x.q.id);
      if (isCardRun && index + 1 >= list.length) cur[cardId] = markPart(getState(cardId), part, { now: clock() });
      await persist(id);
      return run.next(true);
    },
    // move on after a question is done (or flagged); returns the next { q, kind } or null when the run is over
    async next(force = false) {
      if (!force && attempt && !attempt.done) return list[index];
      endIfLast();
      index++;
      return open();
    },
  };
  return run;
}
