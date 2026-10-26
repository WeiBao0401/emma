// 期中季（DESIGN 6.4、2.2）：家长区填了期中日期（kv 'progress'.examDate），离考试 14 天以内自动打开，考完回到常规。
// 复习提纲上的重点词（kv 'outline'，没有就用范围最后一个单元的必会词）在复习里前移、打开“写得出”线，每天拼约 10 个；
// 其余范围词只要求认得。考前 3 天的前两天每天一份小卷，考前一天只推轻松版（plan.js 管）。
// 热身的题型按卡换（四选一、听音选词、字母块拼写），混 1-2 道语法题；“写几个词”按星期轮换拼写、语法卡、语音小卡。
// 负责：今天的课 agent（plan.js、sprint.js）。
//
// 纯函数，不碰 DOM、不读数据库，Node 里直接测。plan.js 调用它；家长区、首页也可以直接用 sprintOf / weeklyGains。
// 孩子端不放倒计时、不放“x / 总数”：daysLeft 只给家长区用，孩子看到的只有 label 和增量（weeklyGains().line）。
//
// 导出
//   SPRINT_DAYS = 14        离考试几天以内算期中季
//   QUIZ_DAYS = 3           考前 3 天：第 3、2 天各一份小卷，第 1 天（考前一天）轻松版
//   SPELL_PER_DAY = 10      期中季每天拼约 10 个（热身里的字母块加“写几个词”）
//   WRITE_SPELL = 3         “写几个词”拼写日拼 2-3 个
//   PULL_MAX = 10           期中季热身有空位时，最多把几个还没到期的重点词提前拿来复习
//   QUIZ_SPELL = 10, QUIZ_GRAMMAR = 5
//   DEFAULT_RANGE = { from: 'S', to: 'U3' }   只填了日期没填范围时
//   MODE_SECONDS            每种卡大约几秒：mc4 / listen / card 15，tiles 25，grammar 25，order 45（连词成句，0.4.0）；
//                           0.5.0：probe 25（地基探针）、screen 5（505 摸底一个词，算上核对）、verb 20（找动词）、transform 50；
//                           0.6.0：cloze 30（句子里回想）、forms 45（变形配对一组）、contrast 60（对比小卡）、alt_intro 40（换个讲法那一屏）
//   WRITE_MINUTES           “写几个词”几分钟：spell 2，grammar 3，phonics 3，order 3
//   WRITE_ROTATION          [周日..周六] 的“写几个词”：一、二、六语法卡，三连词成句（0.4.0，原来是拼写），四语音小卡，日、五拼写
//   TRANSFORM_DAYS、writeModeOf(dow, season)   0.5.0：句型转换占轮换里的星期六（平时）、星期四和星期六（期中季）；
//                           writePlan 和兜底语法卡的计数都用 writeModeOf。state.transformItems（modes/order.js transformItems）
//                           没给或 state.noTransform 就跳过这一种
//   quizPassage(state, now) 0.5.0：小卷里的期中阅读小篇（state.examPassages、state.examReading）；有小篇时小卷拼 6 个、语法 4 道
//   UNIT_CARDS              v1 三张语法卡的 id（和 grammar.json 一样：pronoun、there_be、possessive_s）；
//                           grammar.js 给了 state.grammarCard（todayCard 的 { cardId, part }）就用它的，给了 null 就是今天没有卡
//   GRAMMAR_FALLBACK        兜底语法题（grammar.js 没给题的时候用），Unit 1 到 Unit 3 各 4-5 道
//   dayOf(date) / unitRank(id, ranks) / unitName(id)   plan.js 原样转出
//   examPhase(progress, now, ranks?) -> { phase, on, date, daysLeft, from, to, label }
//       phase：'none' 没填日期 | 'ahead' 还早（> 14 天）| 'season' 4-14 天 | 'quiz' 2-3 天 | 'eve' 明天考 | 'day' 今天考 | 'after' 考完了
//       on：season / quiz / eve 三种是期中季
//   outlineList(outline) -> [string]       kv 'outline' 认这几种写法：['hello', ...]、{ slugs: [...] }、{ words: [...] }，
//                                          元素可以是字符串或 { slug } / { w } / { headword }
//   keyWords(state, phase?) -> { slugs, source: 'outline' | 'unit' | '' }   重点词（只认单词本里有的词）
//   sprintOf(state, now) -> Sprint = examPhase(...) 加 { keys: [slug], keySource, spellPerDay }
//   tileable(word) -> bool                 能出字母块：单个词、只有字母、2-12 个
//   assignModes(cards, { first, tilesMax, eligible, minShare? }) -> { cards, modes }   热身每张卡的题型（第一张和新词四选一），
//                                          字母块和别的题型交错排。0.8.2 minShare（0 到 1，默认 0 = 照旧）：能拼的卡够的话，
//                                          字母块至少占这么多（tilesMax 跟着往上抬），每天热身写出来的不少于一半就传 WRITE_SHARE
//   0.8.2（Wei 10-26：会写、知道词性）
//   WRITE_SHARE = 0.5      日常热身写出来的（字母块、句子里回想）至少占几成
//   POS_WARM = { standard: 2, light: 1 }   热身里几道词性题（pos.js posItems / renderPos）
//   QUIZ_POS = 4、QUIZ_POS_WITH_READ = 3   考前小卷里几道词性题
//   writeEligible(w, { season, isKey, skip }) -> bool   这张卡能不能出拼写：她见过一次以上的必会词（reps ≥ 1，第二次见就拼），
//                                          “写得出”线开着的，期中季的重点词；新词、拼不了的（短语、带符号）、skip 里的不出
//   grammarWarm(state, now, n, sprint?) -> [GrammarItem | WarmItem]   热身里的语法题：state.grammarWarm（数组）
//                                          或 state.grammarWarmItems（grammar.js 的函数，按它的写法 fn(state, now, { max }) 调，
//                                          state.grammar 是 grammarState(kv)）给了就用，空的也算数；都没给或者出错才用兜底题
//   grammarQuiz(state, now, n, sprint?) -> [GrammarItem]   小卷的语法选择题：state.grammarQuiz / grammarQuizItems 给了带选项的整题就用，
//                                          否则用语法卡里的整题（0.7.2 cardQuizItems，错过的点优先，state.grammarContent 给内容），
//                                          不够再用兜底题补
//   cardQuizItems(state, now, n, sprint?) -> [GrammarItem]   0.7.2：见文件下面那一节；QUIZ_MISS_DAYS = 21、QUIZ_PER_FAMILY = 2
//   writePlan({ now, state, sprint, words, warm, light, first, quiz, isKey }) -> { status, mode, items, minutes, note, card?, week?, quiz? }
//       mode 'order'（连词成句）：items 是 state.orderItems（modes/order.js writeItems 给的句子 id），没给或 state.noOrder 就跳过这一种
//   wordsOf(state, now) -> words           state.words（plan 的形状）；没有就从 state.entries 或 words.js 实例（state.words.favorites()）
//                                          加 state.curriculum 现拼；state.progress / state.outline 没给时读 state.kv.peek
//   buildQuiz(state, now, { force?, sprint?, mode? }) -> Quiz | null   考前小卷；不是小卷日返回 null（force 为真照样出）。
//       state 是 plan 的 state，或 ui-lesson 手上的 { entries, words, curriculum, kv, grammar, plan, now }；
//       state.plan.quiz 有了就直接返回它（首页和上课看到的是同一份）
//       Quiz = { id: 'quiz:YYYY-MM-DD', date, kind: 'quiz', title, minutes, items: [slug], spell: [{ slug, headword, mode }],
//                grammar: [GrammarItem], note, passage?: { id, label, minutes }, pos: [PosItem] }   passage：0.5.0 期中阅读小篇（plan 放进读一段格）
//       0.8.2 pos：3 到 4 道词性题（pos.js posItems：小卷拼的词里词性定得下来的先，不够用 pos-guide.json 的句子题）。
//         state.posItems 给了数组就用它；词条从 state.entryOf(slug)、words.js 实例的 get、或 state.entries 找，都没有只出句子题
//   weeklyGains(events, now) -> { since, written, writtenSlugs, recognized, recognizedSlugs, line }
//       这周（周一起）第一次写对的词、第一次认出的词；line 是孩子看的一句：“这周又能写出 9 个词”，没有就是 ''
//
//   GrammarItem = { id: 'g:<语法点>:<题>', item（= id，事件里的 item）, point, unit, q, stem（= q）, cn, zh（= cn）, options: [string],
//                   answer, tags: { 选项: 误解标签 }, why, explain（= why）, source: 'plan' }   stem / zh / explain 是 ui-lesson 认的名字
//   WarmItem（grammar.js 给的）= { item: 'g:<卡>:<题>', card, qid, kind, ... }，没有题面，ui-lesson 用 grammar.js resolveWarmItem 取题
//       q 里的空用 ____（和 grammar.js 的 BLANK 一样）；tags 的标签在 curriculum/tags.json；answer 一定在 options 里（测试检查）
//
// 依赖：fsrs.js（daysBetween、localMidnight、retrievability、State）；0.8.2 pos.js（posItems，小卷的词性题）。

import { daysBetween, localMidnight, retrievability, State } from './fsrs.js';
import { posItems, SECONDS as POS_SECONDS } from './pos.js';

export const SPRINT_DAYS = 14;
export const QUIZ_DAYS = 3;
export const SPELL_PER_DAY = 10;
export const WRITE_SPELL = 3;
export const PULL_MAX = 10;
export const QUIZ_SPELL = 10;
export const QUIZ_GRAMMAR = 5;
export const DEFAULT_RANGE = { from: 'S', to: 'U3' };
export const MODE_SECONDS = { mc4: 15, listen: 15, card: 15, tiles: 25, keys: 25, grammar: 25, order: 45,
  // 0.5.0: 地基探针 (a grammar question), 505 摸底 (one tap a word, checks included), 找动词, 句型转换
  probe: 25, screen: 5, verb: 20, transform: 50,
  // 0.6.0: 句子里回想 (a spelling card in a sentence), 变形配对 (one group), 对比小卡 (one screen, 3 quick judgments), and the
  // 换个讲法 screen before the first alt question of a card (counted on top of that question's 25)
  cloze: 30, forms: 45, contrast: 60, alt_intro: 40,
  // 0.8.2: one 词性题 (a word or a sentence with one word underlined, four kinds to choose from)
  pos: 15 };
export const WRITE_MINUTES = { spell: 2, grammar: 3, phonics: 3, order: 3, transform: 3 };
export const WRITE_ROTATION = ['spell', 'grammar', 'grammar', 'order', 'phonics', 'spell', 'grammar'];   // 周日..周六
// 0.5.0 句型转换 takes some days of the rotation without making it longer: Saturday (a grammar day) all year, and in the
// exam season Thursday too (the phonics day). Monday and Tuesday stay grammar-card days.
export const TRANSFORM_DAYS = { regular: [6], season: [4, 6] };
export const writeModeOf = (dow, season = false) =>
  ((season ? TRANSFORM_DAYS.season : TRANSFORM_DAYS.regular).includes(dow) ? 'transform' : WRITE_ROTATION[dow]);
// 0.5.0: a quiz with a 期中阅读小篇 in it spells and asks a little less, so the whole quiz day stays near 15 minutes
export const QUIZ_SPELL_WITH_READ = 6;
export const QUIZ_GRAMMAR_WITH_READ = 4;
export const UNIT_CARDS = { U1: 'pronoun', U2: 'there_be', U3: 'possessive_s' };   // grammar.json 的卡 id
// 0.8.2 (Wei 10-26): the teacher wants the words written and their part of speech known, not just their meaning recognised
export const WRITE_SHARE = 0.5;
export const POS_WARM = { standard: 2, light: 1 };
export const QUIZ_POS = 4;
export const QUIZ_POS_WITH_READ = 3;

const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'S' / 'Starter' -> 0, 'U3' / 'Unit 3' -> 3; unknown units after the numbered ones; no unit -> Infinity
export function unitRank(id, ranks = null) {
  if (id == null || id === '') return Infinity;
  if (ranks && Object.prototype.hasOwnProperty.call(ranks, id)) return Number(ranks[id]);
  const s = String(id).trim();
  if (/^s(tarter)?$/i.test(s)) return 0;
  const m = s.match(/^u(?:nit)?\s*(\d+)$/i);
  return m ? Number(m[1]) : 1000;
}
export function unitName(id) {
  const s = String(id ?? '').trim();
  if (/^s(tarter)?$/i.test(s)) return 'Starter';
  const m = s.match(/^u(?:nit)?\s*(\d+)$/i);
  return m ? `Unit ${m[1]}` : s;
}

const isDay = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
const dayNumber = now => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
const rOf = w => (w && Number.isFinite(w.r) ? w.r : null);
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function mondayOf(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ---------------------------------------------------------------- inputs

// state.words is plan's shape (wordsForPlan). Also takes what ui-lesson has at hand: state.entries (raw entries) or the
// words.js instance as state.words, with state.curriculum; and state.kv for 'progress' / 'outline' when they are not given.
export function wordsOf(state = {}, now = new Date()) {
  state = state || {};
  if (Array.isArray(state.words)) return state.words.filter(w => w && w.slug);
  const raw = Array.isArray(state.entries) ? state.entries
    : state.words && typeof state.words.favorites === 'function' ? state.words.favorites() : [];
  const c = state.curriculum || {};
  return (raw || []).filter(e => e && e.slug && e.fsrs).map(e => ({
    slug: e.slug,
    headword: e.headword,
    unit: e.unit || (c.unitOf ? c.unitOf(e.headword) : null),
    tier: e.tier || (c.tierOf ? c.tierOf(e.headword) : 'extra'),
    due: e.fsrs.due || null,
    isNew: e.fsrs.state === State.New,
    reps: e.fsrs.reps || 0,
    lapses: e.fsrs.lapses || 0,
    write: !!e.write,
    r: retrievability(e.fsrs, now),
    last: e.fsrs.last_review || null,
    order: Number.isFinite(e.order) ? e.order : null,
  }));
}
const kvPeek = (state, key) => (state.kv && typeof state.kv.peek === 'function' ? state.kv.peek(key, null) : null);
const progressOf = state => state.progress || kvPeek(state, 'progress') || {};
const outlineOf = state => (state.outline !== undefined ? state.outline : kvPeek(state, 'outline'));

// ---------------------------------------------------------------- the season

export function examPhase(progress = {}, now = new Date(), ranks = null) {
  const p = progress || {};
  let from = p.examFrom || DEFAULT_RANGE.from, to = p.examTo || DEFAULT_RANGE.to;
  if (unitRank(from, ranks) > unitRank(to, ranks)) [from, to] = [to, from];
  const out = { phase: 'none', on: false, date: '', daysLeft: null, from, to, label: '' };
  if (!isDay(p.examDate)) return out;
  out.date = String(p.examDate).slice(0, 10);
  const gap = daysBetween(now, localMidnight(out.date));
  out.daysLeft = gap;   // 家长区用；孩子端不显示倒计时（DESIGN 6.4）
  out.phase = gap < 0 ? 'after' : gap === 0 ? 'day' : gap === 1 ? 'eve' : gap <= QUIZ_DAYS ? 'quiz' : gap <= SPRINT_DAYS ? 'season' : 'ahead';
  out.on = out.phase === 'season' || out.phase === 'quiz' || out.phase === 'eve';
  if (out.on) out.label = from === to ? `期中季 · ${unitName(from)}` : `期中季 · ${unitName(from)} 到 ${unitName(to)}`;
  return out;
}

export function outlineList(outline) {
  if (!outline) return [];
  const list = Array.isArray(outline) ? outline
    : Array.isArray(outline.slugs) ? outline.slugs
    : Array.isArray(outline.words) ? outline.words
    : Array.isArray(outline.items) ? outline.items : [];
  return list.map(x => (typeof x === 'string' ? x : x && (x.slug || x.w || x.headword || x.word)))
    .map(norm).filter(Boolean);
}

export function keyWords(state = {}, phase = null) {
  state = state || {};
  const words = wordsOf(state);
  const ranks = state.unitRanks || null;
  const rank = id => unitRank(id, ranks);
  const byBook = (a, b) => rank(a.unit) - rank(b.unit) || (Number.isFinite(a.order) ? a.order : 1e9) - (Number.isFinite(b.order) ? b.order : 1e9);
  const want = new Set(outlineList(outlineOf(state)));
  if (want.size) {
    const hit = w => want.has(norm(w.slug)) || want.has(norm(w.headword)) || want.has(norm(w.slug).replace(/-/g, ' '));
    const got = words.filter(hit).sort(byBook);
    if (got.length) return { slugs: got.map(w => w.slug), source: 'outline' };
  }
  // no outline: the last unit of the range (Unit 3 by default), its required words (DESIGN 6.4)
  const to = (phase && phase.to) || progressOf(state).examTo || DEFAULT_RANGE.to;
  const r = rank(to);
  const got = words.filter(w => w.tier === 'required' && w.unit && rank(w.unit) === r).sort(byBook);
  return { slugs: got.map(w => w.slug), source: got.length ? 'unit' : '' };
}

export function sprintOf(state = {}, now = new Date()) {
  state = state || {};
  const ph = examPhase(progressOf(state), now, state.unitRanks || null);
  const out = { ...ph, keys: [], keySource: '', spellPerDay: SPELL_PER_DAY };
  if (ph.on) { const k = keyWords(state, ph); out.keys = k.slugs; out.keySource = k.source; }
  return out;
}

// ---------------------------------------------------------------- card modes

export function tileable(w) {
  const s = String((w && (w.headword || w.slug)) || '').trim();
  return /^[a-z]{2,12}$/i.test(s);
}

// 0.8.2: a 必会词 is spelled from the second time she meets it (seen once: reps ≥ 1), not only once the 写得出 line is open
export function writeEligible(w, { season = false, isKey = () => false, skip = null } = {}) {
  if (!w || w.isNew || !tileable(w)) return false;
  if (skip && skip.has && skip.has(w.slug)) return false;
  if (w.write) return true;
  if (season && isKey(w)) return true;
  return w.tier === 'required' && (w.reps || 0) >= 1;
}

// cards come in plan order (the first one is the surest). Returns the cards re-ordered so spelling tiles alternate
// with the other kinds, and the mode of each. minShare (0.8.2) lifts tilesMax so the spelled cards are at least that share
// of the cards, as far as there are cards she can spell
export function assignModes(cards = [], { first = false, tilesMax = 0, eligible = () => false, minShare = 0 } = {}) {
  if (!cards.length) return { cards: [], modes: [] };
  if (first) return { cards: cards.slice(), modes: cards.map(() => 'mc4') };
  if (minShare > 0) tilesMax = Math.max(tilesMax, Math.ceil(Math.min(1, minShare) * cards.length));
  let tiles = 0;
  const kind = cards.map((w, i) => {
    if (i === 0 || w.isNew) return 'other';     // the first card and a new word: just recognise it first
    if (tiles < tilesMax && eligible(w) && tileable(w)) { tiles++; return 'tiles'; }
    return 'other';
  });
  const tileList = cards.filter((w, i) => kind[i] === 'tiles');
  const tileSet = new Set(tileList);
  const T = tileList.slice();
  const O = cards.filter((w, i) => kind[i] === 'other');
  const out = [O.shift()];
  while (O.length || T.length) { if (T.length) out.push(T.shift()); if (O.length) out.push(O.shift()); }
  let k = 0;
  const modes = out.map((w, i) => {
    if (tileSet.has(w)) return 'tiles';
    if (i === 0 || w.isNew) return 'mc4';
    k++;
    return k % 3 === 0 ? 'listen' : 'mc4';      // every third recognising card is heard, not read
  });
  return { cards: out, modes };
}

// ---------------------------------------------------------------- grammar

// item is the events id (CONTRACTS 6: g:<语法点>:<题>); stem / zh / explain are the names ui-lesson's normalizeGrammarQ reads
const F = (id, unit, q, cn, options, answer, tags, why) => ({
  id: 'g:' + id, item: 'g:' + id, point: 'g:' + id.split(':')[0], unit,
  q, stem: q, cn, zh: cn, options, answer, tags, why, explain: why, source: 'plan',
});

// Pre-written by Claude for the three v1 points (DESIGN 5.4). Words: primary 505 and Starter to Unit 3 only.
export const GRAMMAR_FALLBACK = [
  F('personal_pronoun:f1', 'U1', 'This is Lily. ____ is my friend.', '这是 Lily。她是我的朋友。',
    ['She', 'He', 'Her'], 'She', { He: 'he_she', Her: 'subj_obj' }, 'Lily 是女孩，放在句子开头做主语，用 She。'),
  F('personal_pronoun:f2', 'U1', 'Mr Li is our teacher. We like ____ very much.', '李老师是我们的老师。我们非常喜欢他。',
    ['him', 'he', 'his'], 'him', { he: 'subj_obj', his: 'obj_vs_poss' }, 'like 后面要用宾格，he 的宾格是 him。'),
  F('possessive_pronoun:f1', 'U1', 'Is this your book? Yes, it is ____.', '这是你的书吗？是的，它是我的。',
    ['mine', 'my', 'me'], 'mine', { my: 'poss_adj_vs_pron', me: 'obj_vs_poss' }, '后面没有名词了，用 mine。my 后面要跟名词，比如 my book。'),
  F('possessive_pronoun:f2', 'U1', 'Look at Amy. This is ____ bag.', '看看 Amy。这是她的书包。',
    ['her', 'hers', 'his'], 'her', { hers: 'poss_adj_vs_pron', his: 'he_she' }, '后面有名词 bag，用 her。Amy 是女孩，不用 his。'),
  F('there_be:f1', 'U2', 'There ____ a cat under the desk.', '桌子下面有一只猫。',
    ['is', 'are', 'has'], 'is', { are: 'there_be_agree', has: 'there_have' }, 'a cat 是一只，用 There is。“某处有”不用 has。'),
  F('there_be:f2', 'U2', 'There ____ two apples on the table.', '桌子上有两个苹果。',
    ['are', 'is', 'have'], 'are', { is: 'there_be_agree', have: 'there_have' }, 'two apples 是两个，用 There are。'),
  F('there_be:f3', 'U2', '____ a park near my home.', '我家附近有一个公园。',
    ['There is', 'There are', 'There has'], 'There is', { 'There are': 'there_be_agree', 'There has': 'there_have' }, '“某处有某物”用 there be。a park 是一个，用 There is。'),
  F('there_be:f4', 'U2', 'There ____ many students in the classroom.', '教室里有很多学生。',
    ['are', 'is', 'have'], 'are', { is: 'there_be_agree', have: 'there_have' }, 'many students 是很多个，用 There are。'),
  F('possessive_s:f1', 'U3', 'This is ____ bag.', '这是 Tom 的书包。',
    ["Tom's", 'Tom', 'Toms'], "Tom's", { Tom: 'poss_s_missing', Toms: 'poss_s_missing' }, "“谁的”就在名字后面加 's：Tom's。"),
  F('possessive_s:f2', 'U3', '____ name is Ben.', '我爸爸的名字叫 Ben。',
    ["My father's", 'My father', 'My fathers'], "My father's", { 'My father': 'poss_s_missing', 'My fathers': 'poss_s_missing' }, "“爸爸的”是 father's，别漏了 's。"),
  F('possessive_s:f3', 'U3', 'This is ____.', '这是我妈妈的手机。',
    ["my mother's phone", 'the phone of my mother', 'my mother phone'], "my mother's phone", { 'the phone of my mother': 'poss_of_overuse', 'my mother phone': 'poss_s_missing' }, "人的东西用 's：my mother's phone。"),
  F('possessive_s:f4', 'U3', '____ cat is white.', '我妹妹的猫是白色的。',
    ["My sister's", 'My sister', 'My sisters'], "My sister's", { 'My sister': 'poss_s_missing', 'My sisters': 'poss_s_missing' }, "“妹妹的”是 sister's，别漏了 's。"),
];

// grammar.js WarmItem is { item: 'g:<card>:<id>', card, qid, kind, ... } (no id); our fallback items have both
const validItems = r => (Array.isArray(r) ? r.filter(x => x && (x.id || x.item)) : []);

// What grammar.js says wins, an empty list too ("no card in practice yet"): a given array, or the function called the
// way grammar.js defines it, grammarWarmItems(state, now, { max }), where state.grammar is grammarState(kv).
// Only when nothing is given, or it throws, do the fallback questions come in.
function external(state, arrKey, fnKey, n, now, extra) {
  if (Array.isArray(state[arrKey])) return validItems(state[arrKey]);
  const fn = typeof state[fnKey] === 'function' ? state[fnKey]
    : state.grammar && typeof state.grammar[fnKey] === 'function' ? state.grammar[fnKey] : null;
  if (!fn) return null;
  try {
    const got = fn({ ...state, ...extra, n, max: n }, now, { max: n });
    return Array.isArray(got) ? validItems(got) : null;
  } catch (e) { return null; }
}

// which units' grammar is fair game: the exam range in the season, otherwise what she has learned
function grammarUnits(state, sprint) {
  const ranks = state.unitRanks || null;
  const rank = id => unitRank(id, ranks);
  const p = state.progress || {};
  if (sprint && sprint.on) { const lo = rank(sprint.from), hi = rank(sprint.to); return u => rank(u) >= lo && rank(u) <= hi; }
  if (!p.unit) return () => true;
  const cur = rank(p.unit);
  return u => rank(u) <= cur;
}

// n items, one point each where possible, a different set every day
function pickRotating(pool, n, seed) {
  if (!pool.length || n <= 0) return [];
  const start = ((seed % pool.length) + pool.length) % pool.length;
  const ring = [...pool.slice(start), ...pool.slice(0, start)];
  const byPoint = new Map();
  for (const it of ring) { if (!byPoint.has(it.point)) byPoint.set(it.point, []); byPoint.get(it.point).push(it); }
  const lists = [...byPoint.values()];
  const out = [];
  for (let i = 0; out.length < n && lists.some(l => l.length); i = (i + 1) % lists.length) if (lists[i].length) out.push(lists[i].shift());
  return out;
}

export function grammarWarm(state = {}, now = new Date(), n = 2, sprint = null) {
  state = state || {};
  if (n <= 0) return [];
  const ok = grammarUnits(state, sprint);
  const ext = external(state, 'grammarWarm', 'grammarWarmItems', n, now, { sprint, kind: 'warm' });
  if (ext) return ext.slice(0, n);
  return pickRotating(GRAMMAR_FALLBACK.filter(it => ok(it.unit)), n, dayNumber(now));
}

export function grammarQuiz(state = {}, now = new Date(), n = QUIZ_GRAMMAR, sprint = null) {
  state = state || {};
  if (n <= 0) return [];
  const ok = grammarUnits(state, sprint);
  const ext = external(state, 'grammarQuiz', 'grammarQuizItems', n, now, { sprint, kind: 'quiz' });
  // the quiz needs whole questions; grammar.js warm items (item refs only) are not enough here
  if (ext && ext.length && ext.every(x => Array.isArray(x.options))) return ext.slice(0, n);
  // 0.7.2 (roadmap-gaps 5): whole questions from the grammar cards, the points she got wrong first
  const fromCards = cardQuizItems(state, now, n, sprint);
  // the two quiz days get different questions where the pool allows
  const fallback = pickRotating(GRAMMAR_FALLBACK.filter(it => ok(it.unit)), n, dayNumber(now) * 3);
  if (!fromCards.length) return fallback;
  if (fromCards.length >= n) return fromCards.slice(0, n);
  const have = new Set(fromCards.map(x => x.point));
  return [...fromCards, ...fallback.filter(x => !have.has(x.point)), ...fallback.filter(x => have.has(x.point))].slice(0, n);
}

// ---------------------------------------------------------------- 0.7.2 the quiz from the grammar cards
//
// cardQuizItems(state, now, n, sprint?) -> [GrammarItem]   考前小卷的语法题用语法卡里的整题（curriculum/grammar.json），错过的点优先。
//   内容：state.grammarContent（grammar.js content() 的 Content，或 grammar.json 原样），或 state.grammar 是 grammar.js 模块时它的 content()。
//     没有内容返回 []，grammarQuiz 退回兜底题。
//   进度：state.grammar.cards[cardId]（grammarState），没有就读 state.kv.peek('grammar:<cardId>')。
//   错过的点（按卡和题的类 family 记分）：kv 里这题没一次做对（passed false，2 分）或用过提示（clean false，1 分）、待复习的（1 分）；
//     最近 21 天的事件（state.history / state.events）里第一次就错的语法题：item 是卡里的题就记那一类，只有 point（兜底题、错题本 mode
//     'mistake'）就记那张卡里这个点的第一类。分高的先，一类最多 2 道。
//   其余：期中范围里的卡（地基卡 unit 'S' 也在里面，ahead 的卡不出），开过头的卡先，每张卡轮着出一道。
//   每类先出她没做过的题（备用题也算），再出做过的；按日子轮换，两个小卷日尽量不一样。flagged 的题不出，第二讲法 alt 的题不出。
//   GrammarItem 比兜底题多：card、qid、family、kind（'fill' | 'pick'）、cue、hints（4 级）、variant（同形状，没有 null）、
//     missed（true = 因为她错过排进来的）、source: 'card'。options 第一个是答案（ui-lesson 的 shuffleOptions 会打乱）。
export const QUIZ_MISS_DAYS = 21;
export const QUIZ_PER_FAMILY = 2;

function grammarContentOf(state) {
  let c = state.grammarContent || null;
  if (!c && state.grammar && typeof state.grammar.content === 'function') { try { c = state.grammar.content(); } catch (e) { c = null; } }
  return c && Array.isArray(c.cards) ? c : null;
}
function cardStateOf(state, id) {
  const g = state.grammar && state.grammar.cards && typeof state.grammar.cards === 'object' ? state.grammar.cards[id] : null;
  const s = g || kvPeek(state, 'grammar:' + id) || {};
  return s && typeof s === 'object' ? s : {};
}
const qText = raw => (raw.kind === 'pick' ? String(raw.ask || '选出正确的句子。') : String(raw.stem || '') + (raw.cue ? `（${raw.cue}）` : ''));
function quizItemOf(card, raw, qid, point, missed) {
  const item = `g:${card.id}:${qid}`;
  const wrong = raw.wrong && typeof raw.wrong === 'object' ? raw.wrong : {};
  const answer = String(raw.answer ?? '');
  const options = [answer, ...Object.keys(wrong).filter(o => o && o !== answer)];
  const hints = Array.isArray(raw.hints) ? raw.hints.slice(0, 4) : [];
  const why = String(raw.explain || hints[hints.length - 1] || '');
  const q = qText(raw);
  const out = {
    id: item, item, card: card.id, qid, family: raw.family || '', point, unit: card.unit || null, kind: raw.kind === 'pick' ? 'pick' : 'fill',
    q, stem: q, cue: raw.cue || '', cn: raw.zh || '', zh: raw.zh || '', options, answer, tags: { ...wrong }, hints, why, explain: why,
    variant: null, missed: !!missed, source: 'card',
  };
  if (raw.variant && typeof raw.variant === 'object' && !raw.isVariant) {
    const v = quizItemOf(card, { ...raw.variant, family: raw.variant.family || raw.family }, qid + 'v', point, missed);
    v.variant = null;
    if (v.answer && v.options.length >= 2) out.variant = v;
  }
  return out;
}

export function cardQuizItems(state = {}, now = new Date(), n = QUIZ_GRAMMAR, sprint = null) {
  state = state || {};
  const c = grammarContentOf(state);
  if (!c || n <= 0) return [];
  const ok = grammarUnits(state, sprint);
  const seed = dayNumber(now) * 7 + (sprint && Number.isFinite(sprint.daysLeft) ? sprint.daysLeft : 0);
  const cards = c.cards.filter(card => card && card.id && !(card.ahead && sprint && sprint.on) && ok(card.unit || 'S'));
  if (!cards.length) return [];
  // every question we may ask, by card and family
  const fams = new Map();       // 'card|family' -> { card, family, point, qs: [{ raw, qid, seen }], score, order }
  const byItem = new Map();     // 'g:card:qid' -> fam key
  const famOfPoint = new Map(); // 'g:point' -> fam key (first family of the first card with it)
  cards.forEach((card, ci) => {
    const st = cardStateOf(state, card.id);
    const items = st.items && typeof st.items === 'object' ? st.items : {};
    const seenQ = st.seen && typeof st.seen === 'object' ? st.seen : {};
    const flagged = new Set(Array.isArray(st.flagged) ? st.flagged : []);
    const families = card.families || {};
    const pointOf = raw => raw.point || (families[raw.family] && families[raw.family].point) || (card.points || [])[0] || '';
    const add = (raw, qid) => {
      if (!raw || !qid || raw.alt || flagged.has(qid)) return;
      const answer = String(raw.answer ?? '');
      if (!answer || !Object.keys(raw.wrong || {}).some(o => o && o !== answer)) return;
      const key = card.id + '|' + (raw.family || '');
      if (!fams.has(key)) fams.set(key, { card, family: raw.family || '', point: pointOf(raw), qs: [], score: 0, order: ci });
      fams.get(key).qs.push({ raw, qid, seen: !!(items[qid] || seenQ[qid]) });
      byItem.set(`g:${card.id}:${qid}`, key);
      if (raw.variant) byItem.set(`g:${card.id}:${qid}v`, key);
      const p = pointOf(raw);
      if (p && !famOfPoint.has(p)) famOfPoint.set(p, key);
    };
    for (const raw of card.questions || []) add(raw, raw.id);
    for (const raw of card.spares || []) add(raw, raw.id);
    // her record on this card: questions never passed, passed with hints, reviews still waiting
    for (const [qid, rec] of Object.entries(items)) {
      if (!rec || typeof rec !== 'object') continue;
      const key = byItem.get(`g:${card.id}:${qid}`);
      if (!key) continue;
      if (rec.passed === false) fams.get(key).score += 2;
      else if (rec.clean === false) fams.get(key).score += 1;
    }
    for (const r of Array.isArray(st.reviews) ? st.reviews : []) {
      if (!r || (Number(r.step) || 0) >= 3) continue;
      const key = byItem.get(`g:${card.id}:${r.id}`) || (r.family && fams.has(card.id + '|' + r.family) ? card.id + '|' + r.family : '');
      if (key) fams.get(key).score += 1;
    }
  });
  // the last 21 days of events: a grammar question wrong at the first try (cards, fallback questions, 错题本)
  const events = Array.isArray(state.history) ? state.history : Array.isArray(state.events) ? state.events : [];
  const since = now.getTime() - QUIZ_MISS_DAYS * 864e5;
  for (const e of events) {
    if (!e || e.type !== 'answer' || e.correct !== false || e.first_try === false) continue;
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || t < since || t > now.getTime()) continue;
    const it = String(e.item || '');
    let key = byItem.get(it);
    if (!key) {
      const p = e.point ? (String(e.point).startsWith('g:') ? String(e.point) : 'g:' + e.point) : /^g:[^:]+:/.test(it) ? 'g:' + it.split(':')[1] : '';
      key = p ? famOfPoint.get(p) : '';
    }
    if (key && fams.has(key)) fams.get(key).score += 1;
  }
  const rot = (list, s) => { if (!list.length) return list; const k = ((s % list.length) + list.length) % list.length; return [...list.slice(k), ...list.slice(0, k)]; };
  const used = new Set();
  const take = (fam, missed) => {
    const fresh = fam.qs.filter(q => !used.has(q.qid) && !q.seen), old = fam.qs.filter(q => !used.has(q.qid) && q.seen);
    const pick = rot(fresh, seed + fam.order)[0] || rot(old, seed + fam.order)[0];
    if (!pick) return null;
    used.add(pick.qid);
    return quizItemOf(fam.card, pick.raw, pick.qid, fam.point, missed);
  };
  const out = [];
  // 1. the points she got wrong, most first; one question a family per round, at most QUIZ_PER_FAMILY
  const missed = [...fams.values()].filter(f => f.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  for (let round = 0; round < QUIZ_PER_FAMILY && out.length < n; round++) {
    for (const f of missed) { if (out.length >= n) break; const q = take(f, true); if (q) out.push(q); }
  }
  // 2. the rest of the range: cards she has started first, one question a card in turn
  if (out.length < n) {
    const started = card => { const st = cardStateOf(state, card.id); return !!(st.parts && Object.keys(st.parts).length) || !!(st.items && Object.keys(st.items).length); };
    const rank = card => (started(card) ? 0 : 1);
    const order = cards.slice().sort((a, b) => rank(a) - rank(b));
    const famsOf = card => rot([...fams.values()].filter(f => f.card === card), seed);
    const lists = order.map(famsOf);
    let guard = 0;
    while (out.length < n && lists.some(l => l.length) && guard++ < 200) {
      for (const l of lists) {
        if (out.length >= n) break;
        while (l.length) { const q = take(l.shift(), false); if (q) { out.push(q); break; } }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- “写几个词”

// state.grammarCard is grammar.js todayCard(): { cardId, part }, or null when no card part is due today
function grammarCard(state, sprint, now) {
  const gc = state.grammarCard;
  if (gc && (gc.id || gc.cardId)) return { ...gc, id: gc.id || gc.cardId, from: 'grammar' };
  if (gc === null) return null;
  const ranks = state.unitRanks || null;
  const rank = id => unitRank(id, ranks);
  const p = state.progress || {};
  const ids = Object.keys(UNIT_CARDS).sort((a, b) => rank(a) - rank(b));
  if (sprint && sprint.on) {
    // three cards, each split over two days (DESIGN 6.4): first part of each card in turn, then the second parts, so all
    // three come up in the few grammar days before the quiz days. grammar.js knows which part she really did
    const cards = ids.filter(u => rank(u) >= rank(sprint.from) && rank(u) <= rank(sprint.to)).map(u => UNIT_CARDS[u]);
    if (!cards.length) return null;
    const start = localMidnight(sprint.date); start.setDate(start.getDate() - SPRINT_DAYS);
    let k = 0;
    // the days 句型转换 took are not grammar days (only when there are 句型转换 sentences at all)
    const tOn = Array.isArray(state.transformItems) && state.transformItems.length > 0 && !state.noTransform;
    const isGrammarDay = dow => (tOn ? writeModeOf(dow, true) : WRITE_ROTATION[dow]) === 'grammar';
    for (let d = new Date(start); dayOf(d) < dayOf(now); d.setDate(d.getDate() + 1)) if (isGrammarDay(d.getDay())) k++;
    return { id: cards[k % cards.length], part: (Math.floor(k / cards.length) % 2) + 1, from: 'plan' };
  }
  const cur = p.unit ? rank(p.unit) : Infinity;
  const have = ids.filter(u => rank(u) <= cur);
  return have.length ? { id: UNIT_CARDS[have[have.length - 1]], part: null, from: 'plan' } : null;
}

function spellPick(words, { warm, sprint, isKey, state, n }) {
  const done = new Set(Array.isArray(state.spelledOk) ? state.spelledOk : state.spelledOk instanceof Set ? [...state.spelledOk] : []);
  const season = !!(sprint && sprint.on);
  const ok = w => w && !w.isNew && !warm.has(w.slug) && !done.has(w.slug) && tileable(w)
    && (season ? (isKey(w) || !!w.write) : !!w.write);
  return words.filter(ok)
    .sort((a, b) => (isKey(b) ? 1 : 0) - (isKey(a) ? 1 : 0) || (rOf(a) ?? 0) - (rOf(b) ?? 0) || (b.lapses || 0) - (a.lapses || 0))
    .slice(0, n);
}

export function writePlan({ now = new Date(), state = {}, sprint = null, words = [], warm = new Set(), light = false, first = false, quiz = null, isKey = () => false } = {}) {
  state = state || {};
  if (first) return { status: 'skip', mode: 'paper', items: [], minutes: 0, note: '明天开始' };
  if (light) return { status: 'skip', mode: 'paper', items: [], minutes: 0, note: '轻松版不做' };
  // 考前小卷: the spelling half sits here, its grammar half in the warm-up (as ui-lesson's sprintCells lays it out)
  if (quiz) return { status: 'ready', mode: 'spell', items: quiz.items.slice(), minutes: Math.max(1, Math.round((quiz.items.length * 45) / 60)), note: '考前小卷', quiz };
  const today = writeModeOf(now.getDay(), !!(sprint && sprint.on));
  // a 句型转换 day without sentences goes back to what the day was before (grammar on Saturday, phonics on Thursday)
  const base = WRITE_ROTATION[now.getDay()];
  // 0.7.0: state.writeFirst (her 今天想先练什么, plan.js) goes first; state.writeDelta (kid-me knobs) adds or drops a few
  const first0 = ['spell', 'grammar', 'order', 'transform', 'phonics'].includes(state.writeFirst) ? [state.writeFirst] : [];
  const order = [...new Set([...first0, today, base, 'spell', 'grammar', 'order', 'transform', 'phonics'])];
  const delta = Number.isFinite(state.writeDelta) ? state.writeDelta : 0;
  const sized = (list, lo, hi) => list.slice(0, Math.max(lo, Math.min(hi, list.length + Math.min(0, delta))));
  for (const mode of order) {
    if (mode === 'spell') {
      const n = Math.max(2, WRITE_SPELL + delta);
      const list = spellPick(words, { warm, sprint, isKey, state, n });
      if (list.length >= 2) return { status: 'ready', mode, items: list.map(w => w.slug), minutes: Math.max(1, Math.round(WRITE_MINUTES.spell * list.length / WRITE_SPELL)), note: '' };
    } else if (mode === 'grammar' && !state.noGrammar) {
      const card = grammarCard(state, sprint, now);
      if (card) return { status: 'ready', mode, items: [], minutes: WRITE_MINUTES.grammar, note: '', card };
    } else if (mode === 'order' && !state.noOrder) {
      const list = Array.isArray(state.orderItems) ? sized(state.orderItems.filter(Boolean), 1, 5) : [];
      if (list.length) return { status: 'ready', mode, items: list.slice(), minutes: WRITE_MINUTES.order, note: '' };
    } else if (mode === 'transform' && !state.noTransform) {
      const list = Array.isArray(state.transformItems) ? sized(state.transformItems.filter(Boolean), 1, 5) : [];
      if (list.length) return { status: 'ready', mode, items: list.slice(), minutes: WRITE_MINUTES.transform, note: '' };
    } else if (mode === 'phonics' && !state.noPhonics) {
      return { status: 'ready', mode, items: [], minutes: WRITE_MINUTES.phonics, note: '', card: state.phonicsCard || null, week: dayOf(mondayOf(now)) };
    }
  }
  return { status: 'skip', mode: 'paper', items: [], minutes: 0, note: '今天不做' };
}

// ---------------------------------------------------------------- the quiz

export function buildQuiz(state = {}, now = new Date(), opts = {}) {
  state = state || {};
  opts = opts || {};
  if (state.now) now = new Date(state.now);
  // ui-lesson passes the plan it already showed: the same quiz, not a second draw
  if (!opts.force && state.plan && state.plan.quiz && state.plan.quiz.kind === 'quiz') return state.plan.quiz;
  const entryOf = entryLookup(state);
  const words = wordsOf(state, now);
  state = { ...state, words, progress: progressOf(state), outline: outlineOf(state) };
  const sp = opts.sprint || sprintOf(state, now);
  if (!opts.force && sp.phase !== 'quiz') return null;
  const ranks = state.unitRanks || null;
  const rank = id => unitRank(id, ranks);
  const keys = new Set(sp.keys && sp.keys.length ? sp.keys : keyWords(state, sp).slugs);
  const lo = rank(sp.from), hi = rank(sp.to);
  const inRange = w => !!w.unit && rank(w.unit) >= lo && rank(w.unit) <= hi && w.tier === 'required';
  const mode = opts.mode || state.spellMode || 'tiles';
  const fits = w => (mode === 'paper' ? true : tileable(w));
  const met = w => !w.isNew && fits(w);
  const sure = (a, b) => (rOf(a) ?? 0) - (rOf(b) ?? 0) || (b.lapses || 0) - (a.lapses || 0) || rank(a.unit) - rank(b.unit);
  const key = words.filter(w => keys.has(w.slug) && met(w)).sort(sure);
  const rest = words.filter(w => !keys.has(w.slug) && inRange(w) && met(w)).sort(sure);
  const pool = [...key, ...rest];
  if (!pool.length) return null;
  // the second quiz day starts further down the list, so the two days spell different words when there are enough
  const k = sp.phase === 'quiz' && Number.isFinite(sp.daysLeft) ? QUIZ_DAYS - sp.daysLeft : 0;
  const passage = quizPassage(state, now);
  const nSpell = passage ? QUIZ_SPELL_WITH_READ : QUIZ_SPELL;
  const start = pool.length > nSpell ? (k * nSpell) % pool.length : 0;
  const spell = [];
  for (let i = 0; i < pool.length && spell.length < nSpell; i++) spell.push(pool[(start + i) % pool.length]);
  const grammar = grammarQuiz(state, now, passage ? QUIZ_GRAMMAR_WITH_READ : QUIZ_GRAMMAR, sp);
  // 0.8.2: 词性题, the quiz's own words first
  const nPos = passage ? QUIZ_POS_WITH_READ : QUIZ_POS;
  let pos = [];
  if (Array.isArray(state.posItems)) pos = state.posItems.filter(Boolean).slice(0, nPos);
  else {
    try {
      pos = posItems({ words: [...spell, ...pool], entryOf, curriculum: state.curriculum || null, n: nPos, seed: dayNumber(now) + k,
        events: Array.isArray(state.history) ? state.history : Array.isArray(state.events) ? state.events : [], now });
    } catch (e) { pos = []; }
  }
  const sec = spell.length * 45 + grammar.length * 30 + pos.reduce((a, it) => a + (it.kind === 'word' ? POS_SECONDS.word : POS_SECONDS.sentence), 0)
    + (passage ? passage.minutes * 60 : 0);
  const minutes = Math.min(15, Math.max(5, Math.round(sec / 60)));
  const date = dayOf(now);
  return {
    ...(passage ? { passage } : {}),
    id: 'quiz:' + date,
    date,
    kind: 'quiz',
    title: '考前小卷',
    minutes,
    items: spell.map(w => w.slug),
    spell: spell.map(w => ({ slug: w.slug, headword: w.headword || w.slug, mode })),
    grammar,
    pos,
    note: '写错的也没关系，明天热身再见。',
  };
}

// a slug -> entry lookup from what the caller has: state.entryOf, the words.js instance (its get), or raw state.entries
function entryLookup(state) {
  if (typeof state.entryOf === 'function') return state.entryOf;
  if (state.words && !Array.isArray(state.words) && typeof state.words.get === 'function') return s => { try { return state.words.get(s); } catch (e) { return null; } };
  if (Array.isArray(state.entries)) { const m = new Map(state.entries.filter(e => e && e.slug).map(e => [e.slug, e])); return s => m.get(s) || null; }
  return null;
}

// 0.5.0 期中阅读小篇 (curriculum/exam-reading.json, design/teacher-next.md 3.4): one passage in each quiz. state.examPassages
// is [{ id, label, minutes }] (app.js, from reader.js loadPassages); state.examReading is kv 'exam.reading'
// ({ done: { id: 'YYYY-MM-DD' } }). The one done today stays today's; otherwise the first not done yet, then the one done
// longest ago. -> { id, label, minutes } | null
export function quizPassage(state = {}, now = new Date()) {
  const list = Array.isArray(state && state.examPassages) ? state.examPassages.filter(p => p && p.id) : [];
  if (!list.length) return null;
  const done = (state.examReading && typeof state.examReading === 'object' && state.examReading.done && typeof state.examReading.done === 'object') ? state.examReading.done : {};
  const today = dayOf(now);
  const pick = list.find(p => done[p.id] === today) || list.find(p => !done[p.id])
    || list.slice().sort((a, b) => String(done[a.id]).localeCompare(String(done[b.id])))[0];
  return { id: pick.id, label: pick.label || '期中阅读', minutes: Math.max(3, Number(pick.minutes) || 6) };
}

// ---------------------------------------------------------------- this week's gains

const SPELL_MODES = new Set(['tiles', 'keys', 'cloze']);
const KNOW_MODES = new Set(['mc4', 'listen', 'card']);
const slugOf = e => e.slug || (typeof e.item === 'string' && e.item.startsWith('w:') ? e.item.slice(2) : '');
// 句子里回想: 提示 shows the sentence's Chinese and reads it aloud, so an answer after a hint is not a clean one (0.6.0)
const wroteIt = e => e.correct === true && (e.type === 'spell' || e.type === 'dictation' || (e.type === 'answer' && SPELL_MODES.has(e.mode)
  && !(e.mode === 'cloze' && e.hint_level > 0)));
const knewIt = e => e.type === 'answer' && e.correct === true && e.first_try !== false && KNOW_MODES.has(e.mode);

export function weeklyGains(events = [], now = new Date()) {
  const mon = mondayOf(now);
  const since = mon.getTime(), until = now.getTime();
  const before = { wrote: new Set(), knew: new Set() }, week = { wrote: new Set(), knew: new Set() };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !e.at) continue;
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || t > until) continue;
    const s = slugOf(e);
    if (!s) continue;
    const bin = t < since ? before : week;
    if (wroteIt(e)) bin.wrote.add(s);
    if (knewIt(e)) bin.knew.add(s);
  }
  const writtenSlugs = [...week.wrote].filter(s => !before.wrote.has(s));
  const recognizedSlugs = [...week.knew].filter(s => !before.knew.has(s));
  const line = writtenSlugs.length ? `这周又能写出 ${writtenSlugs.length} 个词`
    : recognizedSlugs.length ? `这周又认出了 ${recognizedSlugs.length} 个词` : '';
  return { since: dayOf(mon), written: writtenSlugs.length, writtenSlugs, recognized: recognizedSlugs.length, recognizedSlugs, line };
}
