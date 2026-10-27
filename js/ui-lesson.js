// 上课（DESIGN 2.0-2.3、6.4）：按 plan 的四格走，热身 → 读一段 → 写几个词 → 收尾。课的样子永远是这四格，
// 后上线的功能只往格子里填；还没开的格子在顶上的四格条里显示“下周开播”，不占时间。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/lesson.css）。
//
// v1（期中季）接进来的东西，都是按需加载（loadV1），哪个模块没有或者出错，这节课照样按 v0 上完：
//   热身   按 plan 给的卡片类型出：四选一（modes/choice.js）、听音选词（modes/listen.js 的 listenMode）、
//          字母块拼写（modes/spell.js 的 spellMode），中间按 plan 混 1-2 道语法题（grammar.js 的热身题）。
//          凑不齐干扰项（question: null）一路退：拼写 / 听音 → 四选一 → 闪卡（ui-review.js）。
//          这节课答错过又出来的词，换成四选一（DESIGN 5.1 第 4 条：换一种更容易的形式）。
//   读一段  0.4.0：plan 的 read 格 ready 时，ui-reader.js 的 renderEpisode 画一集期中番外（先听后读、看不懂、4 道题、提示阶梯），
//          阅读器自己记 answer / hint / read_help / read_time / lookup / flag / feel（带这节课的 sid 和 step 'read'）；轻松版 short 只做 2 道题。
//          读完点“接着上课”进写几个词；离开上课页时调它的 stop()（停掉朗读）。
//   写几个词  按 cell.mode：'tiles' 字母块拼写（只记事件，不再给 FSRS 评分，热身已经评过）、
//          'grammar' 语法卡（ui-grammar.js 的 renderGrammarCard）、'phonics' 语音小卡（ui-phonics.js 的 renderPhonicsCard）、
//          'order' 连词成句（modes/order.js 的 renderOrder，0.4.0）。热身格的 order 是偶尔混的 1 句，放在热身最后。
//   0.5.0（第 3 批）：热身里多三样，都由 plan 的热身格给：地基探针（cell.probe，ui-screen.js renderProbe，和语法题一起铺开）、
//          505 摸底（cell.screen，ui-screen.js renderScreen，单词卡后面一整批；她自己说的“认识 / 没学过”不算对错）、
//          找动词（cell.verb，modes/verb.js renderVerb，摸底后面）；问老师讲过的词（cell.asked）和语法点（grammar 里带 asked 的）上方写“我问过的”。
//          写几个词多 'transform' 句型转换（modes/order.js renderTransforms）。小卷日读一段格是期中阅读小篇（mode 'passage'，
//          ui-reader.js renderPassage，只做题、原文一直开着；做完写 kv 'exam.reading'）。开课后在后台调 teacher.js maybeThinkWeek
//          （每周第一次开课时想上一周），收尾调 syncAsked（对账“我问过的”），讲过又错了的点给一行“老师想换个讲法再说一遍”。
//   0.6.0（第 4 批）：热身的单词卡多一种 mode 'cloze' 句子里回想（modes/cloze.js clozeMode，找不到句子退回字母块、四选一、闪卡；
//          设置 spellMode 'keys' 用键盘），算“写对了”；热身格的 forms（变形配对，modes/forms.js renderForms，找动词后面、连词成句前面）
//          和 contrast（对比小卡，ui-grammar.js renderContrast，和语法题一起铺开、排在最后）。语法卡的换个讲法（kind 'alt'、intro）
//          由 renderGrammarItem 自己画。
//   0.9.0（Wei 10-26：会写、知道词性、巧记）：热身格的 pos（词性题，pos.js renderPos，变形配对后面）；小卷的 quiz.pos 画在拼写后面；
//          字母块卡用 pos.js posSpellMode（题面多一行“n. 名词”，事件多 pos）。新词第一次出现、答错的词给一屏巧记
//          （word-notes.js noteFor 的离线小本，没有就用词条上模型给的 mem、旧的 mnemonic；四选一、听音选词答错时直接挂在题下面），
//          点“记住了”再往下走；一节课里一个词只出一次。收尾多“认对了 N 个词的词性”。
//   0.9.4（Wei 10-27：先讲再考）：课本新词（还是新卡、有单元）在这节课第一张卡之前先出巧记一屏（词、读音、词性、中文、巧记、容易错），
//          点“记住了，考我”才出题；第一节课也这样，一节课最多 MEMO_NEW_MAX 个，没有巧记的词直接出题（teachFirst）。
//          先讲过的词答对以后不再出巧记屏，答错照旧挂巧记（memoAfter）；她自己的新词（没有单元）还是答对以后给，和以前一样。
//          收尾“回到今天”旁边是“分享给妈妈”（动态 import('./share.js') 的 shareButton(ctx, { scope: 'today' })，没有或出错就不显示）。
//   收尾   老师夸一句（lines 'praise'，填今天写对的一个具体的词，带 spelled；没写对的就填认出的），
//          “今天写对了 N 个”加最多 3 个词（DESIGN 2.2），再见用 'close'，期中季用 'exam'（没有就退回 'close'）。
//          轻松版开头老师先说一句 'easy' 场景的话。考前一天加一句“今天早点睡。”
//   考前小卷  小卷日（plan.quizDay）plan.js 自己摆：5 道语法选择在热身格（cell.grammar），10 个词在写几个词格
//          （mode 'spell'，带 cell.quiz）。她自己点了考前小卷（params.sprint）而 plan 没出卷时，用 sprint.js 的
//          buildQuiz(state, now, { force: true }) 出一份，整份放进写几个词格（mode 'quiz'：先拼写、再语法），热身这天不做。
//          一样的四格外壳、一样的收尾，不打分、不出“x / 10”。session_start 的 kind 记 'sprint'。
// 每张出题前算一次“做对的把握”记 events 'predict'（teacher-memory 10），作答记 'answer'（用时、选了什么、是不是第一次），
// 热身的词评分后记 'review'；“有点难”记 'feel'，“这题有问题”记 'flag' 并跳过、不记分；语法题每看一级提示记 'hint'。
// 单次超过 25 分钟提示“今天够了”。
//
// 导出
//   createLessonView(ctx) -> { show(params), inSession(), onChange() }
//     渲染进 #tab-lesson。params：{ light, standard?（回归日她点了“标准版”）, again?（今天做完了再练一会儿）,
//     first?（第一次打开直接进来）, sprint?（考前小卷） }。全屏，左上角“结束”回到今天。
//   ENOUGH_MIN = 25                         单次超过这么多分钟提示“今天够了”（DESIGN 2.3）
//   ASK_KEY = 'ask.answers'                 kv：第一周按钮问题的回答 { qid: { answer, skipped, at, day, who } }
//   V1_MODULES、loadV1(importer?)           v1 模块的路径表和按需加载（每个都可以没有，没有的是 null）
//   以下是纯函数（Node 测试用）：
//   predictCorrect(entry, now, { mode }) -> 0..1   FSRS 记得的概率，四选一和听音选词按 1/4 蒙对抬一点；新词 0.5
//   praiseWord(results) -> slug | null      第一次就答对的词里把握最小的那个
//   praisePick(results, spelled) -> { slug, spelled } | null   先挑写对的（spelled），没有再挑认出的
//   cardModeOf(cell, slug, i) -> 'mc4' | 'listen' | 'tiles' | 'card'   plan 给这张卡的题型
//   grammarRefs(cell) -> [ref] | null | number      plan 在热身里放的语法题（没说是 null）
//   grammarSlots(nCards, k) -> [n]          k 道语法题插在第几张词卡之后（不放第一张前面，均匀铺开）
//   normalizeGrammarQ(q) -> GQ | null       grammar.js 的题统一成 { id, point, item, stem, zh, options: [{ text, correct, tag }],
//                                            answer, hints: [4 级], explain, variant, unit }
//   writeKind(cell, mods) -> 'tiles' | 'grammar' | 'phonics' | 'quiz' | 'order' | null   写几个词格今天能不能做、做哪种
//   readKind(cell, mods) -> 'story' | null   读一段格今天能不能读（ready、有 episodeId、ui-reader.js 读到了）
//   orderRefs(cell) -> [句子 id]           热身格里偶尔混的连词成句
//   quizItems(quiz) -> [{ kind: 'spell', slug } | { kind: 'grammar', q: GQ }]   小卷在写几个词格里的顺序：先拼写，再语法
//   sprintCells(cells, quiz, { forced }) -> [Cell × 4] | null   把小卷放进写几个词格（forced：热身这天不做）
//   eventModeOf(view, asked) -> 'mc4' | 'listen' | 'tiles' | 'card'   题型画出来的到底是哪种（spellMode 退回四选一时是 mc4）
//   grammarPrior(q) -> 0..1                 没记录的语法题做对的把握：0.5 加上蒙对的那一份
//   grammarCardId(card, grammar?) -> 'pronoun' | 'there_be' | 'possessive_s' | ...   plan 给的卡名换成 grammar.json 的卡 id
//   shuffleOptions(q, rng?) -> q             选项换个顺序（预写的题常把答案放第一个）
//   examInfo(progress, now) -> { season, eve, days }   期中季（考前 14 天内）、考前一天
//   closeScene({ season }) -> 'exam' | 'close'
//   teachFirst({ isNew, textbook, hasMemo, taught, count, max }) -> bool   这张卡之前先讲巧记吗（0.9.4）
//   memoAfter(g, { isNew, textbook, hasMemo, seen, first, count, max }) -> bool   答完以后出巧记吗（0.9.4）
//
// 记的事件（CONTRACTS.md 第 6 节）：session_start { kind, hour }（kind 多一个 'sprint'）、
// predict { item, slug?, mode, p_base, p_teacher }、answer（题型给的字段加 sid、step、unit）、
// review { slug, rating, line: 'recognize' | 'write', p_fsrs, mode }、hint { item, hint_level }、feel、flag、
// exit { step, after_item, wrong_streak }、session_end { min, steps_done, completed }、ask { qid, who: 'emma', answer }。
// 写 kv 'day:<YYYY-MM-DD>' { cells, minutes, light }。
import { h, icon, toast } from './ui-dom.js';
import { createSession } from './session.js';
import { endOfDay, retrievability, State, daysBetween, localMidnight } from './fsrs.js';
import * as Choice from './modes/choice.js';
import { flashcard } from './ui-review.js';
import { dayOf, CELL_LABELS as PLAN_LABELS, MEMO_NEW_MAX } from './plan.js';
import { lessonDays, dayNumber, dictationToday, talkCtx, learnBlock } from './ui-home.js';
import { isoLocal } from './events.js';
// 0.7.0: 今天想先练什么 at the start, 太简单 / 正好 / 太难 after each part (kid-me.js, ui-kid-me.js)
import * as KM from './kid-me.js';
import { renderFeedback, renderTodayAsk } from './ui-kid-me.js';
// 0.9.0: the memory tricks (the offline notes and the entry's own), drawn like the word page's 巧记 block
import { memoryBlock, noteOf, ensureNotes, headwordNode, sayBtn } from './ui-entry.js';
import { memoryOf } from './word-notes.js';

export const ENOUGH_MIN = 25;
export const ASK_KEY = 'ask.answers';
export const EXAM_SEASON_DAYS = 14;   // DESIGN 6.4：离考试 14 天以内是期中季
const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
const LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾', ...(PLAN_LABELS || {}) };
const round2 = x => Math.round(x * 100) / 100;
const GUESS = { mc4: 0.25, listen: 0.25 };
// 没有记录的语法题：0.5 加上蒙对的那一份（四个选项 0.63，三个 0.67）。GRAMMAR_PRIOR 是不知道几个选项时的值
const GRAMMAR_PRIOR = 0.63;
// 对比小卡 (0.6.0): each quick judgment has two options, 0.5 + 0.25
const CONTRAST_PRIOR = 0.75;
// 0.5 plus the share she could guess: 3 options 0.67, 4 options 0.63
export const grammarPrior = q => round2(0.5 + 0.5 / Math.max(2, (q && q.options && q.options.length) || 4));

// ---------------------------------------------------------------- v1 modules, loaded on demand

export const V1_MODULES = {
  listen: './modes/listen.js',
  spell: './modes/spell.js',
  grammar: './grammar.js',
  grammarUI: './ui-grammar.js',
  phonics: './ui-phonics.js',
  sprint: './sprint.js',
  // 0.4.0: 读一段 (the episode screen and its logic) and 连词成句 (0.5.0: 句型转换 too)
  reader: './ui-reader.js',
  story: './reader.js',
  order: './modes/order.js',
  // 0.5.0: 地基探针 and 505 摸底 (logic, screens), 找动词, the teacher's notebook (我问过的, 每周想一次)
  screen: './screen.js',
  screenUI: './ui-screen.js',
  verb: './modes/verb.js',
  teacher: './teacher.js',
  // 0.6.0: 句子里回想 and 变形配对 (单词从认得到会用)
  cloze: './modes/cloze.js',
  forms: './modes/forms.js',
  // 0.7.0: 错题 due again today, in the warm-up after 变形配对
  mistakesUI: './ui-mistakes.js',
  // 0.8.0 (第 6 批): 读出来 after the reading, 每日阅读 once the six episodes are done, 周末课
  readaloud: './ui-readaloud.js',
  dailyUI: './ui-daily-read.js',
  weekend: './weekend.js',
  // 0.9.0: 词性 (the warm-up's 词性题, the quiz's, and the spelling tiles with the part of speech on top)
  pos: './pos.js',
};
// loadV1() -> Promise<{ listen, spell, grammar, grammarUI, phonics, sprint }>; a module that is missing or throws is null.
// The browser's import is cached for the page's life; tests pass their own importer and get a fresh load.
let v1Loading = null;
function loadAll(importer) {
  return Promise.all(Object.entries(V1_MODULES).map(([k, path]) =>
    Promise.resolve().then(() => importer(path)).then(m => [k, m || null], err => {
      console.warn('lesson: ' + path + ' not loaded:', (err && err.message) || err);
      return [k, null];
    }))).then(Object.fromEntries);
}
export function loadV1(importer) {
  if (importer) return loadAll(importer);
  return v1Loading || (v1Loading = loadAll(p => import(p)));
}

// a "mode" object (render(entry, ctx)) out of a module, whatever it is exported as
const modeOf = (mod, ...names) => {
  if (!mod) return null;
  for (const n of names) if (mod[n] && typeof mod[n].render === 'function') return mod[n];
  if (mod.default && typeof mod.default.render === 'function') return mod.default;
  return typeof mod.render === 'function' ? mod : null;
};
const listenModeOf = mods => modeOf(mods && mods.listen, 'listenMode', 'mode');
// 0.9.0: with pos.js there, the tiles show the part of speech on top (posSpellMode, same interface as spellMode)
const spellModeOf = mods => (mods && mods.spell && mods.pos && mods.pos.posSpellMode && typeof mods.pos.posSpellMode.render === 'function'
  ? mods.pos.posSpellMode : modeOf(mods && mods.spell, 'spellMode', 'tilesMode', 'mode'));
const clozeModeOf = mods => modeOf(mods && mods.cloze, 'clozeMode');
const fnOf = (mod, ...names) => { if (!mod) return null; for (const n of names) if (typeof mod[n] === 'function') return mod[n]; return null; };
// the events name of what a mode drew: spellMode says modeId 'spell' / eventMode 'tiles', or 'mc4' when it fell back
const EVENT_MODE = { spell: 'tiles', tiles: 'tiles', listen: 'listen', mc4: 'mc4', card: 'card', keys: 'keys', cloze: 'cloze' };
// the modes that count as writing the word (the praise's “spelled”, the review's line 'write')
const WRITE_MODES = new Set(['tiles', 'cloze']);
export function eventModeOf(v, asked) {
  const id = v && (v.eventMode && v.modeId !== 'mc4' ? v.eventMode : v.modeId);
  return EVENT_MODE[id] || EVENT_MODE[asked] || 'mc4';
}

// ---------------------------------------------------------------- pure helpers

export function predictCorrect(entry, now = new Date(), { mode = 'mc4' } = {}) {
  const guess = GUESS[mode] || 0;
  const card = entry && entry.fsrs;
  const r = !card || card.state === State.New || !card.last_review ? 0.5 : retrievability(card, now);
  return round2(guess + (1 - guess) * Math.max(0, Math.min(1, r)));
}

// 0.9.4 先讲再考 (Wei 10-27): a textbook word still new meets its 巧记 screen before its first card in the lesson,
// the first lesson too, at most max a lesson; a word without 巧记 goes straight to its card
export function teachFirst({ isNew = false, textbook = false, hasMemo = false, taught = false, count = 0, max = MEMO_NEW_MAX } = {}) {
  return !!(isNew && textbook && hasMemo && !taught && count < max);
}
// after her answer (g = the rating, 1 = wrong): a wrong one gets its 巧记 (once a lesson); a right one only for her own
// new word (no unit: a textbook word was taught before its card), not on the first lesson, within the same max
export function memoAfter(g, { isNew = false, textbook = false, hasMemo = false, seen = false, first = false, count = 0, max = MEMO_NEW_MAX } = {}) {
  if (seen || !hasMemo) return false;
  if (g === 1) return true;
  return !!(isNew && !textbook && !first && count < max);
}

// results: Map slug -> { first: bool (first answer right), p }
export function praiseWord(results) {
  let best = null;
  for (const [slug, r] of results) if (r.first && (!best || r.p < best.p)) best = { slug, p: r.p };
  return best ? best.slug : null;
}

// DESIGN 2.5: “You spelled ‘strict’ right today!” The word she spelled is the one to praise; else one she recognised.
// Gives the keys lines.js praise lines ask for: spelled, heard (listening), firstTry, hard (she was not sure of it)
export function praisePick(results, spelled = new Map()) {
  const s = spelled && spelled.size ? praiseWord(spelled) : null;
  const r = !s && results ? praiseWord(results) : null;
  const slug = s || r;
  if (!slug) return null;
  const rec = (s ? spelled : results).get(slug) || {};
  return { slug, spelled: !!s, heard: !s && rec.mode === 'listen', firstTry: true, hard: Number.isFinite(rec.p) && rec.p < 0.5 };
}

const MODE_ALIAS = { mc4: 'mc4', choice: 'mc4', listen: 'listen', tiles: 'tiles', tile: 'tiles', spell: 'tiles', card: 'card', flashcard: 'card', cloze: 'cloze' };
export function cardModeOf(cell, slug, i = -1) {
  if (!cell) return 'mc4';
  let m = null;
  const modes = cell.modes;
  if (modes && typeof modes === 'object' && !Array.isArray(modes)) m = modes[slug];
  if (!m && Array.isArray(modes) && i >= 0) m = modes[i];
  if (!m && Array.isArray(cell.cards)) {
    const c = cell.cards.find(x => x && x.slug === slug);
    m = c && (c.mode || c.type);
  }
  if (!m && typeof cell.mode === 'string') m = cell.mode;
  return MODE_ALIAS[m] || 'mc4';
}

// 0.7.1: how far the distractors sit for this word card (plan's warm-up card distractor, from her 热身 difficulty)
export function distractorOf(cell, slug) {
  const c = cell && Array.isArray(cell.cards) ? cell.cards.find(x => x && x.slug === slug && x.distractor) : null;
  const d = (c && c.distractor) || (cell && cell.distractor) || 'normal';
  return d === 'far' || d === 'near' ? d : 'normal';
}

const isGrammarRef = x => !!x && typeof x === 'object' && (x.kind === 'grammar' || x.type === 'grammar' || x.mode === 'grammar' || Array.isArray(x.options));
// what the plan put in the warm-up for grammar: an array of refs or questions, a count, or null (it said nothing)
export function grammarRefs(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.grammar)) return cell.grammar.filter(Boolean);
  if (Number.isFinite(cell.grammar)) return Math.max(0, Math.floor(cell.grammar));
  if (Array.isArray(cell.cards)) {
    const g = cell.cards.filter(isGrammarRef);
    return g.length ? g : null;
  }
  return null;
}

// after which word card each of k grammar questions goes: never before the first card, spread through the round
export function grammarSlots(nCards, k) {
  const n = Math.max(0, Math.floor(nCards || 0));
  const out = [];
  for (let i = 0; i < k; i++) out.push(n ? Math.max(1, Math.min(n, Math.round(((i + 1) * n) / (k + 1)))) : 0);
  return out;
}

const textOf = x => (x == null ? '' : typeof x === 'string' ? x : String(x.text ?? x.zh ?? x.en ?? ''));
export function normalizeGrammarQ(q, depth = 0) {
  if (!q || typeof q !== 'object') return null;
  const src = !Array.isArray(q.options) && q.q && typeof q.q === 'object' ? q.q : q;
  const raw = src.options || src.choices;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const ans = src.answer ?? src.correct ?? src.right;
  const tags = src.tags && typeof src.tags === 'object' && !Array.isArray(src.tags) ? src.tags : {};
  const options = raw.map((o, i) => {
    const text = typeof o === 'string' ? o : String((o && (o.text ?? o.en ?? o.label)) ?? '');
    let correct = o && typeof o === 'object' && typeof o.correct === 'boolean' ? o.correct : null;
    if (correct === null) correct = typeof ans === 'number' ? i === ans : ans != null && String(ans).trim() === text.trim();
    const tag = (o && typeof o === 'object' ? (o.tag ?? o.misconception ?? null) : null) ?? tags[text] ?? null;
    return { text, correct, tag: correct ? null : tag };
  });
  const answer = options.findIndex(o => o.correct);
  if (answer < 0 || options.filter(o => o.correct).length !== 1 || !options.every(o => o.text)) return null;
  // sprint.js / grammar.js GrammarItem: id is the whole item 'g:<point>:<q>', q is the sentence, cn its Chinese, why the reason
  const fullId = /^g:[^:]+:.+/.test(String(src.id || '')) ? String(src.id) : '';
  const itemParts = String(src.item || fullId || '').split(':');
  let point = src.point || src.g || (typeof src.grammar === 'string' ? src.grammar : '') || (itemParts[0] === 'g' && itemParts[1] ? 'g:' + itemParts[1] : '');
  if (point && !String(point).startsWith('g:')) point = 'g:' + point;
  const id = fullId ? itemParts.slice(2).join(':') : String(src.id ?? (itemParts.length > 2 ? itemParts.slice(2).join(':') : '') ?? '');
  const item = src.item || fullId || (point ? `${point}:${id || 'q'}` : `g:${id || 'q'}`);
  const stem = textOf(src.stem ?? src.prompt ?? (typeof src.q === 'string' ? src.q : null) ?? src.text ?? src.en ?? src.question);
  if (!stem) return null;
  const hints = (Array.isArray(src.hints) ? src.hints : Array.isArray(src.ladder) ? src.ladder : []).map(textOf).filter(Boolean).slice(0, 4);
  return {
    id, point, item, stem,
    zh: textOf(src.zh ?? src.cn) || '',
    say: src.say || '',
    options, answer, hints,
    explain: textOf(src.explain ?? src.why) || '',
    variant: depth ? null : normalizeGrammarQ(src.variant || null, depth + 1),
    unit: src.unit || undefined,
    raw: q,
  };
}

// 考前小卷（sprint.js 的 Quiz：spell [{ slug }] 或 items [slug]，grammar [GrammarItem]）-> 写几个词格要做的一串：
// 先拼写，再语法选择（DESIGN 6.4：10 个词拼写、5 道语法选择）
export function quizItems(quiz) {
  if (!quiz || typeof quiz !== 'object') return [];
  const raw = Array.isArray(quiz.spell) && quiz.spell.length ? quiz.spell : Array.isArray(quiz.items) ? quiz.items : Array.isArray(quiz.words) ? quiz.words : [];
  const slugs = [...new Set(raw.filter(x => !isGrammarRef(x)).map(x => (typeof x === 'string' ? x : x && (x.slug || x.w || x.word))).filter(Boolean))];
  const grammar = [].concat(Array.isArray(quiz.grammar) ? quiz.grammar : [], Array.isArray(quiz.items) ? quiz.items.filter(isGrammarRef) : [])
    .map(g => normalizeGrammarQ(g)).filter(Boolean);
  const seen = new Set();
  return [...slugs.map(slug => ({ kind: 'spell', slug })), ...grammar.filter(q => !seen.has(q.item) && seen.add(q.item)).map(q => ({ kind: 'grammar', q }))];
}

const WRITE_ALIAS = { tiles: 'tiles', tile: 'tiles', spell: 'tiles', grammar: 'grammar', 'grammar-card': 'grammar', phonics: 'phonics', sound: 'phonics', quiz: 'quiz', sprint: 'quiz', order: 'order', transform: 'transform' };
export function writeKind(cell, mods = {}) {
  if (!cell || cell.status !== 'ready') return null;
  const k = WRITE_ALIAS[cell.mode] || null;
  if (k === 'tiles') return spellModeOf(mods) && Array.isArray(cell.items) && cell.items.length ? 'tiles' : null;
  if (k === 'grammar') return fnOf(mods.grammarUI, 'renderGrammarCard') && (cell.card ?? cell.point) != null ? 'grammar' : null;
  if (k === 'phonics') return fnOf(mods.phonics, 'renderPhonicsCard') ? 'phonics' : null;
  if (k === 'order') return fnOf(mods.order, 'renderOrder') && Array.isArray(cell.items) && cell.items.length ? 'order' : null;
  if (k === 'transform') return fnOf(mods.order, 'renderTransforms') && Array.isArray(cell.items) && cell.items.length ? 'transform' : null;
  if (k === 'quiz') {
    // the quiz runs if one of its halves can: spelling needs spell.js, grammar questions draw here
    const items = quizItems(cell.quiz || { items: cell.items });
    return items.some(x => x.kind === 'grammar') || (spellModeOf(mods) && items.some(x => x.kind === 'spell')) ? 'quiz' : null;
  }
  return null;
}

// 读一段 today: the plan opened it (an episode to read) and the episode screen loaded; on a quiz day the 期中阅读小篇
// (mode 'passage', 0.5.0) needs renderPassage and reader.js loadPassages
export function readKind(cell, mods = {}) {
  if (!cell || cell.status !== 'ready') return null;
  if (cell.mode === 'passage') return cell.passageId && fnOf(mods.reader, 'renderPassage') && fnOf(mods.story, 'loadPassages') ? 'passage' : null;
  if (!cell.episodeId) return null;
  return fnOf(mods.reader, 'renderEpisode') ? 'story' : null;
}
// the warm-up's 0.5.0 extras the plan put in: probes, 505 words, 找动词 sentences, the words 问老师 explained
// 0.6.0: the 变形配对 group ({ kind, items }) and the 对比小卡 (ContrastItem), from cell.forms / cell.contrast or the cards
export function warmExtras(cell) {
  const list = k => (cell && Array.isArray(cell[k]) ? cell[k].filter(Boolean) : []);
  const cards = t => (cell && Array.isArray(cell.cards) ? cell.cards.filter(c => c && c.type === t) : []);
  const forms = (list('forms').length ? list('forms') : cards('forms')).filter(f => Array.isArray(f.items) && f.items.length)
    .map(f => ({ kind: f.kind === 'mc4' ? 'mc4' : 'match', items: f.items.slice() })).slice(0, 1);
  const contrast = (list('contrast').length ? list('contrast') : cards('contrast')).filter(x => x && x.id).slice(0, 1);
  return { probe: list('probe'), screen: list('screen'), verb: list('verb').filter(x => typeof x === 'string'), asked: list('asked'), forms, contrast };
}
// 0.9.0: the 词性题 the plan put in (warm-up cell.pos, or one { type: 'pos', items } card; the quiz's quiz.pos)
export function posRefs(cell) {
  if (!cell) return [];
  const ok = x => x && typeof x === 'object' && (x.kind === 'word' || x.kind === 'sentence' || x.kind === 'write') && (x.item || x.slug || x.sid);
  if (Array.isArray(cell.pos)) return cell.pos.filter(ok);
  const card = Array.isArray(cell.cards) ? cell.cards.find(c => c && c.type === 'pos' && Array.isArray(c.items)) : null;
  return card ? card.items.filter(ok) : [];
}
// the 连词成句 sentence the plan put at the end of the warm-up (cell.order, or { type: 'order' } cards)
export function orderRefs(cell) {
  if (!cell) return [];
  if (Array.isArray(cell.order)) return cell.order.filter(x => typeof x === 'string' && x);
  if (Array.isArray(cell.cards)) return cell.cards.filter(c => c && c.type === 'order' && c.id).map(c => c.id);
  return [];
}

// plan.js / sprint.js name the card { id: 'g:there_be', part } (or grammar.js todayCard's { cardId, part }); grammar.json's
// cards are 'pronoun', 'there_be', 'possessive_s'. Both personal and possessive pronouns are the one Unit 1 card.
const CARD_ALIAS = { personal_pronoun: 'pronoun', possessive_pronoun: 'pronoun', subject_pronoun: 'pronoun' };
export function grammarCardId(card, G = null) {
  const raw = String((card && typeof card === 'object' ? card.cardId || card.id : card) || '').trim();
  if (!raw) return '';
  const bare = raw.replace(/^g:/, '').split(':')[0];
  const cands = [raw, bare, CARD_ALIAS[bare]].filter(Boolean);
  try {
    const c = G && typeof G.content === 'function' ? G.content() : null;
    if (c && typeof c.card === 'function') { const hit = cands.find(id => c.card(id)); if (hit) return hit; }
  } catch (err) { /* fall through */ }
  return CARD_ALIAS[bare] || bare;
}

// 考前小卷 as a lesson: the same four cells, the quiz in 写几个词. forced (she tapped 考前小卷 on a day the plan did not
// make one) puts the warm-up off, so the lesson stays 10-15 minutes (DESIGN 2.2: the quiz takes the standard lesson's place)
export function sprintCells(cells, quiz, { forced = false } = {}) {
  if (!quiz || typeof quiz !== 'object' || !quizItems(quiz).length) return null;
  const base = CELL_IDS.map(id => (Array.isArray(cells) && cells.find(c => c && c.id === id)) || { id, label: LABELS[id], status: id === 'wrap' ? 'ready' : id === 'read' ? 'soon' : 'skip', items: [] });
  const ps = quiz.passage && quiz.passage.id ? quiz.passage : null;
  return base.map(c => {
    // 0.5.0: the quiz's 期中阅读小篇 takes the 读一段 cell
    if (c.id === 'read' && ps && c.status !== 'done') return { ...c, label: c.label || LABELS.read, status: 'ready', mode: 'passage', passageId: ps.id, items: [], minutes: ps.minutes || c.minutes, note: ps.label || '期中阅读' };
    if (c.id === 'write') return { ...c, label: c.label || LABELS.write, status: 'ready', mode: 'quiz', quiz, items: quizItems(quiz).filter(x => x.kind === 'spell').map(x => x.slug), minutes: quiz.minutes || c.minutes, note: quiz.title || '考前小卷' };
    if (c.id === 'warmup' && forced) return { ...c, status: 'skip', items: [], note: '今天做小卷' };
    return { ...c };
  });
}

// phase as lines.js names it: 4-14 days 'season', 2-3 'quiz', 1 'eve', 0 'day', 1-3 days after 'done', else ''
export function examInfo(progress, now = new Date()) {
  const p = progress || {};
  if (!p.examDate) return { season: false, eve: false, days: null, phase: '' };
  const days = daysBetween(now, localMidnight(p.examDate));
  const phase = days < 0 ? (days >= -3 ? 'done' : '') : days === 0 ? 'day' : days === 1 ? 'eve' : days <= 3 ? 'quiz' : days <= EXAM_SEASON_DAYS ? 'season' : '';
  return { season: days >= 0 && days <= EXAM_SEASON_DAYS, eve: days === 1, days, phase };
}

// the teacher's first line in the lesson: a light lesson says why it is short (lines 'easy', by reason); in the exam
// season she says what today is (lines 'exam': review / the quiz / the test is over). Other days the home page has said hi.
export function openScene({ light = false, phase = '' } = {}) {
  if (light) return 'easy';
  return ['season', 'quiz', 'day', 'done'].includes(phase) ? 'exam' : null;
}
// the goodbye: the night before the exam it is “go to bed early” (lines 'exam' eve), otherwise 'close'
export const closeScene = ({ phase = '' } = {}) => (phase === 'eve' ? 'exam' : 'close');

// options in a new order each time (pre-written items often list the answer first); the answer index follows
export function shuffleOptions(q, rng = Math.random) {
  if (!q || !Array.isArray(q.options)) return q;
  const options = q.options.slice();
  for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { ...q, options, answer: options.findIndex(o => o.correct), variant: q.variant ? shuffleOptions(q.variant, rng) : null };
}

export const praiseHasWord = (line, word) => !!line && !!word && String(line.en || '').toLowerCase().includes(String(word).toLowerCase());

// ---------------------------------------------------------------- a grammar question (warm-up and the quiz)
// DESIGN 5.5：答错第 1 级提示自动出现，“再给个提示”往上走；最后一级讲清楚答案；第一次没答对，再来一道变式题。
// ui-grammar.js 如果导出 renderGrammarQuestion(container, q, opts)，用它的；这里是没有它时的版本，样子和四选一一样。
export function renderGrammarQ(container, q, { onAnswer, onHint, onDone, title = '', autoNextMs = 900 } = {}) {
  const el = container;
  const t0 = Date.now();
  let tries = 0, level = 0, done = false, firstRight = null, left = false, timer = 0;
  const hints = q.hints || [];
  const hintList = h('ol', { className: 'lesson-gq-hints', hidden: true });
  const feedback = h('p', { className: 'mc4-feedback', role: 'status', 'aria-live': 'polite' });
  const buttons = q.options.map((o, i) => h('button', { type: 'button', className: 'mc4-opt', lang: 'en', dataset: { i: String(i) }, text: o.text, on: { click: () => pick(i) } }));
  const moreBtn = h('button', { type: 'button', className: 'text-btn accent lesson-gq-more', text: '再给个提示', hidden: true, on: { click: () => showHint(level + 1) } });
  const nextBtn = h('button', { type: 'button', className: 'btn mc4-next', text: '下一个', hidden: true, on: { click: () => next() } });

  function finishEvent() { return { correct: !!firstRight, firstTry: true, hintLevel: level, grade: firstRight ? 3 : level ? 2 : 1 }; }
  function next() {
    if (!done || left) return;
    clearTimeout(timer);
    if (!firstRight && q.variant) {
      // 现在你来：the variant must be done right once (DESIGN 5.5)
      left = true;
      const box = h('div', { className: 'lesson-gq-variant' });
      el.replaceChildren(h('p', { className: 'lesson-gq-now', text: '现在你来' }), box);
      const v = renderGrammarQ(box, { ...q.variant, variant: null }, { onAnswer, onHint, title, autoNextMs,
        onDone: () => { if (onDone) onDone(finishEvent()); } });
      api.onKey = v.onKey;
      return;
    }
    left = true;
    if (onDone) onDone(finishEvent());
  }
  function showHint(n) {
    if (done || !hints.length) return;
    level = Math.min(n, hints.length);
    hintList.replaceChildren(...hints.slice(0, level).map((t, i) => h('li', { className: 'mc4-hint', dataset: { n: String(i + 1) } },
      h('span', { className: 'lesson-gq-n', text: String(i + 1) }), h('p', { className: 'mc4-hint-text', text: t }))));
    hintList.hidden = false;
    if (onHint) { try { onHint({ item: q.item, hint_level: level }); } catch (e) { /* bookkeeping only */ } }
    if (level >= hints.length) reveal(); else moreBtn.hidden = false;
  }
  function reveal() {
    done = true;
    buttons.forEach((b, k) => { b.disabled = true; if (k === q.answer && !b.classList.contains('right')) b.classList.add('reveal'); });
    moreBtn.hidden = true;
    feedback.textContent = q.explain || (hints.length ? '' : `答案是 ${q.options[q.answer].text}。`);
    nextBtn.textContent = !firstRight && q.variant ? '现在你来' : '下一个';
    nextBtn.hidden = false;
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
  }
  function pick(i) {
    if (done || buttons[i].disabled) return;
    tries++;
    const o = q.options[i];
    if (tries === 1) firstRight = !!o.correct;
    if (onAnswer) {
      try {
        onAnswer({ item: q.item, mode: 'mc4', choice: o.text, correct: !!o.correct, first_try: tries === 1, ms: Date.now() - t0,
          hint_level: level, misconception: o.correct ? null : (o.tag || null), point: q.point || undefined });
      } catch (e) { /* bookkeeping never blocks the answer */ }
    }
    if (o.correct) {
      buttons[i].classList.add('right');
      buttons.forEach(b => { b.disabled = true; });
      done = true;
      moreBtn.hidden = true;
      feedback.textContent = level ? '对了。这一步记住它。' : '对了。';
      el.classList.add('is-right');
      if (!level && tries === 1) timer = setTimeout(next, autoNextMs);
      else { nextBtn.textContent = q.variant ? '现在你来' : '下一个'; nextBtn.hidden = false; }
      return;
    }
    buttons[i].classList.add('wrong');
    buttons[i].disabled = true;
    feedback.textContent = '';
    if (!hints.length) { reveal(); return; }
    if (level === 0) showHint(1);
    else if (buttons.filter(b => !b.disabled).length <= 1) showHint(hints.length);
  }

  el.classList.add('mc4', 'lesson-gq');
  el.replaceChildren(
    h('div', { className: 'mc4-q' },
      title ? h('p', { className: 'lesson-gq-title small', text: title }) : null,
      h('p', { className: 'mc4-prompt lesson-gq-stem', lang: 'en', text: q.stem }),
      q.zh ? h('p', { className: 'mc4-ask small', lang: 'zh-CN', text: q.zh }) : h('p', { className: 'mc4-ask small', text: '选一个填进去' })),
    h('div', { className: 'mc4-options', role: 'group', 'aria-label': '选一个' }, buttons),
    hintList, feedback,
    h('div', { className: 'btn-row mc4-actions' }, moreBtn, nextBtn));

  const api = {
    el,
    pick, next,
    onKey(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const n = Number(ev.key);
      if (!done && n >= 1 && n <= q.options.length) { ev.preventDefault(); pick(n - 1); return; }
      if (done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); }
    },
  };
  return api;
}

// ---------------------------------------------------------------- the view

export function createLessonView(ctx) {
  const root = document.getElementById('tab-lesson');
  root.replaceChildren();
  const stage = h('div', { className: 'lesson' });
  root.append(stage);

  let mods = {};
  let plan = null;
  let cells = [];
  let sid = '';
  let light = false;
  let kind = 'standard';
  let sprint = false;
  let weekendFull = false;   // 0.8.0: today's lesson gets the weekend extras (weekend.js fullDay)
  let readAloudN = 0;        // 0.8.0: sentences read aloud and recorded this lesson
  let pQueue = [];           // 0.9.0: the warm-up's 词性题 (cell.pos), after 变形配对
  let posRight = 0;          // 词性题 right first time
  let memoSeen = new Set();  // 0.9.0: words whose 巧记 she has seen in this lesson (once a word)
  let memoNew = 0;           // new words given a 巧记 screen: taught before the card, or her own answered right (plan.js MEMO_NEW_MAX)
  let taught = new Set();    // 0.9.4: textbook words whose 巧记 came before their first card (a wrong answer still gets it again)
  let exam = { season: false, eve: false, days: null };
  let t0 = 0;
  let step = null;          // 'warmup' | 'read' | 'write' | 'wrap' while this lesson runs
  let running = false;      // ctx.busy held
  let session = null;       // the warm-up's word round (session.js)
  let gQueue = [];          // grammar questions still to come in the warm-up: [{ q, at }]
  let oQueue = [];          // 连词成句 sentences at the end of the warm-up: [id]
  let reading = null;       // the episode on screen (ui-reader.js Controller: { onKey, stop })
  let readRes = null;       // what 读一段 gave back: { n, done, results, passedWords, ... }
  let orderRight = 0;       // 连词成句 sentences right first time, for the wrap
  let transformRight = 0;   // 句型转换 sentences right first time (0.5.0)
  let verbRight = 0;        // 找动词 sentences found first time (0.5.0)
  let sQueue = [];          // the warm-up's 505 words, one batch after the word cards (0.5.0)
  let vQueue = [];          // 找动词 sentence ids, after the 505 words (0.5.0)
  let fQueue = [];          // the 变形配对 group, after 找动词 (0.6.0): [{ kind, items }]
  let formsRight = 0;       // 变形配对 pairs matched first time (0.6.0)
  let askedSet = new Set(); // word slugs 问老师 explained, in today's warm-up (0.5.0)
  let examCache = null;     // reader.js loadPassages, once per page
  let wq = null;            // 写几个词 spelling / quiz: { queue: [{ kind, slug | q }], retried: Set, done, total }
  let writeK = '';          // what 写几个词 is today: 'tiles' | 'grammar' | 'phonics' | 'quiz'
  let lastGrade = 0;
  let cur = null;           // { kind: 'word' | 'grammar', slug?, item, mode, p, pf, t, answered }
  let view = null;          // what is on screen: { onKey }
  let pool = [];
  let results = new Map();  // slug -> { first, p, mode }   word cards (warm-up)
  let spelled = new Map();  // slug -> { first, p }          spelled with tiles (warm-up or 写几个词)
  let gResults = new Map(); // item -> { first }             grammar questions
  let modeBySlug = new Map();
  let wrongStreak = 0;
  let skipped = new Set();
  let stepsDone = [];
  let enoughOff = false;
  let enoughTimer = 0;
  let noteSlot = null;
  let opener = null;        // the easy scene's line, shown above the first card of a light lesson
  let hiddenAt = 0;
  let wrapped = false;
  let token = 0;            // bumps on each start, so a late module load never draws over a newer lesson
  let pendingFb = null;     // 0.7.0: the part just done; the next screen shows 太简单 / 正好 / 太难 on top (never in the way)
  let mQueue = [];          // 0.7.0: 错题 due again today (plan cell.mistakes)
  let mistakesRight = 0;

  const minutesIn = () => Math.round((Date.now() - t0) / 60000);
  const name = () => ((ctx.kv.peek('profile', {}) || {}).name || 'Emma');
  const unitOf = e => { try { return (e && (e.unit || ctx.curriculum.unitOf(e.headword))) || undefined; } catch (err) { return undefined; } };
  const log = ev => { try { ctx.events.log({ sid, ...ev }); } catch (err) { /* recording never blocks an answer */ } };
  const say = (text, btn) => ctx.say(text, btn);
  const predict = (e, mode) => {
    try { if (ctx.events && typeof ctx.events.predict === 'function') { const p = ctx.events.predict(e, { mode }); if (Number.isFinite(p)) return round2(p); } } catch (err) { /* fall back */ }
    return typeof Choice.predictCorrect === 'function' ? Choice.predictCorrect(e, new Date(), { mode }) : predictCorrect(e, new Date(), { mode });
  };
  const cellOf = id => cells.find(c => c.id === id) || null;
  const gName = point => { try { return point ? ctx.curriculum.grammarName(point) : ''; } catch (err) { return ''; } };

  function hold(on) {
    if (on && !running) { running = true; ctx.busy(+1); }
    if (!on && running) { running = false; ctx.busy(-1); }
  }

  function header(title) {
    return h('header', { className: 'runhead session' },
      h('button', { type: 'button', className: 'text-btn', text: wrapped ? '回到今天' : '结束', on: { click: quit } }),
      h('span', { className: 'runhead-title', text: title }),
      h('span', { className: 'lesson-kind', text: sprint ? '考前小卷' : light ? '轻松版' : '' }));
  }

  // the four cells, always the same (DESIGN 2.0); not-yet-open ones say 下周开播 and take no time
  function cellStrip(now) {
    const list = cells.length ? cells : CELL_IDS.map(id => ({ id, status: id === 'read' || id === 'write' ? 'soon' : 'ready' }));
    return h('ol', { className: 'lesson-cells', 'aria-label': '今天的四格' }, CELL_IDS.map(id => {
      const c = list.find(x => x.id === id) || { id, status: 'skip' };
      const done = stepsDone.includes(id) && id !== now;
      const st = id === now ? 'now' : done ? 'done' : c.status;
      const note = st === 'now' ? '正在做' : st === 'done' ? '做完了' : st === 'soon' ? (c.note || '下周开播') : st === 'skip' ? (c.note || '') : '';
      return h('li', { className: 'lesson-cell ' + st, 'aria-current': st === 'now' ? 'step' : null },
        h('b', { text: c.label || LABELS[id] }), h('span', { className: 'st' }, st === 'done' ? icon('check') : null, note));
    }));
  }

  function tools(onFeel, onFlag) {
    return h('div', { className: 'lesson-tools' },
      h('button', { type: 'button', className: 'text-btn', text: '有点难', on: { click: ev => onFeel(ev.currentTarget) } }),
      h('button', { type: 'button', className: 'text-btn', text: '这题有问题', on: { click: onFlag } }));
  }

  function paint(title, nowCell, ...body) {
    noteSlot = h('div', { className: 'lesson-note-slot' });
    const top = opener ? lineBlock(opener, 'lesson-line lesson-opener') : null;
    opener = null;
    // replaceChildren would print a null as the text “null”
    stage.replaceChildren(...[header(title), cellStrip(nowCell), top, noteSlot, fbBox(), ...body.flat()].filter(Boolean));
    if (minutesIn() >= ENOUGH_MIN) showEnough();
  }

  // 0.7.0: one quiet line about the part she just finished; she can tap it or just go on
  function fbBox() {
    const fb = pendingFb;
    pendingFb = null;
    if (!fb) return null;
    const box = h('div', { className: 'lesson-fb' });
    try { renderFeedback(box, ctx, { sid, ...fb }); } catch (err) { console.warn('lesson: feedback:', (err && err.message) || err); return null; }
    return box;
  }

  // ---------------------------------------------------------------- start

  async function start({ light: l = false, standard = false, again = false, first = false, sprint: wantSprint = false } = {}) {
    const my = ++token;
    clearTimeout(enoughTimer);
    try { mods = await loadV1(); } catch (err) { mods = {}; }
    if (my !== token) return;
    const extra = { light: !!l, lessonDays: lessonDays(ctx.kv) };
    // straight from the first open (ui-onboard): the first lesson, whatever kv 'day:' says
    if (first) extra.firstLesson = true;
    if (dictationToday(ctx.kv)) extra.dictationTonight = true;
    if (standard) extra.standard = true;
    if (again) extra.doneToday = {};
    plan = ctx.todayPlan(extra);
    const now = new Date();
    // 0.7.0: the teacher asks what she wants to practise first (not the first lesson, a quiz day or 再练一会儿); her pick
    // is saved in kv 'kid.today', so the lesson starts again with it and does not ask twice
    let ask = false;
    try { ask = !again && KM.needsTodayAsk(ctx.kv, now, { first: !!(first || plan.first), quizDay: !!plan.quizDay || !!wantSprint }); } catch (err) { ask = false; }
    if (ask) {
      const box = h('div', { className: 'lesson-module lesson-today-ask' });
      stage.replaceChildren(header('今天的课'), box);
      let again2 = false;
      try {
        renderTodayAsk(box, ctx, { onPick: () => {
          if (again2) return;
          again2 = true;
          setTimeout(() => { if (my === token) start({ light: l, standard, again, first, sprint: wantSprint }).catch(err => console.warn('lesson: start:', (err && err.message) || err)); }, 500);
        } });
        return;
      } catch (err) { console.warn('lesson: today ask:', (err && err.message) || err); }
    }
    light = !!(plan.light || l);
    exam = examInfo(ctx.kv.peek('progress', {}) || {}, now);
    if (plan.examSeason === true || (plan.season && plan.season.on === true)) exam.season = true;
    cells = (plan.cells || []).map(c => ({ ...c }));
    // 考前小卷: plan.js puts it in 写几个词 (mode 'quiz'); she can also ask for it (params.sprint) on a day it did not
    // 考前小卷 (plan.quizDay): plan.js lays it out itself, its 5 grammar questions in the warm-up and its 10 words in
    // 写几个词 (mode 'spell', cell.quiz). She can also ask for one (params.sprint) on a day the plan did not make it:
    // then the whole quiz goes into 写几个词 (mode 'quiz') and the warm-up waits for tomorrow.
    const w0 = cellOf('write');
    if (w0 && w0.mode === 'quiz' && !w0.quiz && plan.quiz) w0.quiz = plan.quiz;
    if (!light && !first && wantSprint && !plan.quizDay && !(w0 && w0.quiz)) {
      const sc = sprintCells(cells, buildSprint(now, true), { forced: true });
      if (sc && writeKind(sc.find(c => c.id === 'write'), mods)) cells = sc;
    }
    const wq0 = cellOf('write');
    sprint = !!(plan.quizDay || (wq0 && wq0.quiz && wq0.status === 'ready' && writeKind(wq0, mods)));
    kind = sprint ? 'sprint' : plan.kind || (light ? 'easy' : (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'standard');
    // 0.8.0 周末课 (weekend.js): the first weekend lesson that is not 句型转换 does 本周语法 10 题 in 写几个词; the wrap
    // offers 本周 10 词纸上写 and asks what to practise next week
    weekendFull = false;
    try {
      const WK = mods.weekend;
      if (!sprint && !again && WK) {
        weekendFull = WK.fullDay(plan, now);
        const wc = cellOf('write');
        const cq = fnOf(mods.sprint, 'cardQuizItems');
        if (cq && wc && wc.status !== 'done' && WK.wantsGrammar(plan, ctx.kv, now)) {
          const items = cq(ctx.planState({ light: false }), now, WK.GRAMMAR_N);
          const cell = WK.weekGrammarCell(wc, items);
          if (cell !== wc && writeKind(cell, mods)) cells = cells.map(c => (c.id === 'write' ? cell : c));
        }
      }
    } catch (err) { console.warn('lesson: weekend:', (err && err.message) || err); }
    sid = ctx.events.sessionId();
    t0 = Date.now();
    results = new Map();
    spelled = new Map();
    gResults = new Map();
    wrongStreak = 0;
    skipped = new Set();
    stepsDone = [];
    enoughOff = false;
    wrapped = false;
    session = null;
    gQueue = [];
    oQueue = [];
    sQueue = [];
    vQueue = [];
    stopReading();
    readRes = null;
    orderRight = 0;
    transformRight = 0;
    verbRight = 0;
    formsRight = 0;
    fQueue = [];
    mQueue = [];
    mistakesRight = 0;
    readAloudN = 0;
    pQueue = [];
    posRight = 0;
    memoSeen = new Set();
    memoNew = 0;
    taught = new Set();
    ensureNotes(ctx);
    pendingFb = null;
    wq = null;
    writeK = '';
    view = null;
    log({ type: 'session_start', kind, hour: now.getHours(), light, again: again || undefined, season: exam.season || undefined });
    // 每周想一次 (teacher.js): the first lesson of a week thinks about the last one in the background, never in the way
    const think = fnOf(mods.teacher, 'maybeThinkWeek');
    if (think) { try { Promise.resolve(think(ctx)).catch(() => {}); } catch (err) { /* never blocks the lesson */ } }
    // one line from the teacher above the first card (DESIGN 2.5): why today is short, or what the exam season brings
    const os = first ? null : openScene({ light, phase: exam.phase });
    opener = os ? pickLine(os, { name: name(), minutes: plan.minutes || undefined, reason: plan.lightReason || undefined, exam: exam.phase || undefined }) : null;
    // 写几个词 that cannot run today (module missing, nothing to spell) shows as not today
    const w = cellOf('write');
    if (w && w.status === 'ready' && !writeKind(w, mods)) { w.status = 'skip'; w.note = ''; }
    // 读一段 that cannot open today (the episode screen did not load) shows as not today
    const r = cellOf('read');
    if (r && r.status === 'ready' && !readKind(r, mods)) { r.status = 'skip'; r.note = ''; }
    hold(true);
    enoughTimer = setTimeout(showEnough, ENOUGH_MIN * 60000 + 500);
    startWarmup();
  }

  // sprint.js buildQuiz(state, now, { force }): state is the plan's state plus the plan already shown (same quiz, no second draw)
  function buildSprint(now, force = false) {
    if (plan.quiz && plan.quiz.kind === 'quiz') return plan.quiz;
    const build = fnOf(mods.sprint, 'buildQuiz');
    if (!build) return null;
    try {
      const state = typeof ctx.planState === 'function' ? ctx.planState({ light: false }) : {};
      return build({ ...state, plan, grammar: state.grammar || mods.grammar || undefined }, now, { force });
    } catch (err) { console.warn('lesson: quiz:', (err && err.message) || err); return null; }
  }

  function pickLine(scene, c) {
    try { return ctx.lines.pick(scene, c) || null; } catch (err) { return null; }
  }

  // the tone the parent's form asked for (intake.js praise.tone: 'fact' for a child who dislikes praise), else specific
  function praiseTone() {
    try { const t = ctx.intake && ctx.intake().praise.tone; if (t && [].concat(t).length) return t; } catch (err) { /* default */ }
    return 'specific';
  }

  // weekly.js settleLesson: this lesson's numbers for the weekly page (loaded on demand; the page catches up without it)
  function settle(end) {
    const id = sid;
    import('./weekly.js').then(W => W.settleLesson(ctx, { sid: id, end: { ...end, sid: id, at: isoLocal(new Date()) } }))
      .catch(err => console.warn('lesson: settle:', (err && err.message) || err));
  }

  // the praise names the word (DESIGN 2.5: “You spelled ‘strict’ right today!”); a line without it is passed over
  function praiseLine(word, pk, dayN) {
    const recent = [];
    let l = null;
    for (let i = 0; i < 4; i++) {
      l = pickLine('praise', { name: name(), word, spelled: pk.spelled || undefined, heard: pk.heard || undefined,
        firstTry: pk.firstTry || undefined, hard: pk.hard || undefined, tone: praiseTone(), day: dayN, recent });
      if (!l || praiseHasWord(l, word)) return l;
      recent.push(l.id);
    }
    return l;
  }

  // ---------------------------------------------------------------- warm-up

  // grammar questions for the warm-up, from the plan's refs (or a count) through grammar.js
  // Each one is { q } (a question with its options: sprint.js's pre-written ones, drawn here) or { ref } (a grammar.js
  // WarmItem { item, card, qid, kind }: ui-grammar.js renderGrammarItem draws it with the card's hint ladder and variant).
  function warmupGrammar(cell, nCards) {
    const G = mods.grammar;
    const refs = grammarRefs(cell);
    const canRef = !!fnOf(mods.grammarUI, 'renderGrammarItem');
    const resolve = fnOf(G, 'resolveWarmItem');
    const many = fnOf(G, 'grammarWarmItems');
    let list = [];
    const add = r => {
      const q = normalizeGrammarQ(r);
      if (q) { list.push({ q, item: q.item }); return; }
      const item = typeof r === 'string' ? r : r && r.item;
      // a grammar.js item: only when its card is there to draw it (resolveWarmItem null = content not loaded yet, try anyway)
      if (canRef && item && /^g:/.test(item)) { try { if (resolve && G.content && G.content() && !resolve(item)) return; } catch (err) { /* draw it */ } list.push({ ref: typeof r === 'string' ? { item: r, kind: 'practice' } : r, item }); }
    };
    try {
      if (Array.isArray(refs)) refs.forEach(add);
      else if (Number.isFinite(refs) && refs > 0 && many) [].concat(many(G.grammarState ? G.grammarState(ctx.kv) : {}, new Date(), { max: refs }) || []).slice(0, refs).forEach(add);
    } catch (err) { console.warn('lesson: grammar warm-up:', (err && err.message) || err); }
    const seen = new Set();
    list = list.filter(x => !seen.has(x.item) && seen.add(x.item));
    // 0.5.0: the foundation probes spread through the round with the grammar questions (after them)
    if (fnOf(mods.screenUI, 'renderProbe')) for (const p of warmExtras(cell).probe) if (p && p.item && !seen.has(p.item)) { seen.add(p.item); list.push({ probe: p, item: p.item }); }
    // 0.6.0: the 对比小卡 after them all
    if (fnOf(mods.grammarUI, 'renderContrast')) for (const x of warmExtras(cell).contrast) { const item = x.item || 'gc:' + x.id; if (!seen.has(item)) { seen.add(item); list.push({ contrast: x, item }); } }
    const at = grammarSlots(nCards, list.length);
    return list.map((x, i) => ({ ...x, at: at[i] }));
  }

  function startWarmup() {
    step = 'warmup';
    const warm = cellOf('warmup');
    const ready = warm && warm.status === 'ready';
    const items = ready ? (warm.items || []) : [];
    const queue = items.filter(s => ctx.words.get(s));
    modeBySlug = new Map(items.map((s, i) => [s, cardModeOf(warm, s, i)]));
    gQueue = ready ? warmupGrammar(warm, queue.length) : [];
    oQueue = ready && fnOf(mods.order, 'renderOrder') ? orderRefs(warm).slice(0, 1) : [];
    const ex = warmExtras(ready ? warm : null);
    sQueue = fnOf(mods.screenUI, 'renderScreen') ? ex.screen : [];
    vQueue = fnOf(mods.verb, 'renderVerb') ? ex.verb : [];
    fQueue = fnOf(mods.forms, 'renderForms') ? ex.forms : [];
    mQueue = ready && fnOf(mods.mistakesUI, 'renderMistakeReview') && Array.isArray(warm.mistakes) ? warm.mistakes.filter(x => x && x.id) : [];
    pQueue = ready && fnOf(mods.pos, 'renderPos') ? posRefs(warm) : [];
    askedSet = new Set(ex.asked);
    if (!queue.length && !gQueue.length && !oQueue.length && !sQueue.length && !vQueue.length && !fQueue.length && !mQueue.length && !pQueue.length) { afterWarmup(); return; }
    pool = buildPool(queue);
    session = queue.length ? createSession({
      queue,
      mode: 'mc4',
      review: (slug, g, m) => ctx.words.review(slug, g, m),
      // DESIGN 5.1: right once in this lesson is enough; a wrong one comes back about 4 cards later (session.js)
      isToday: due => lastGrade === 1 && new Date(due) <= endOfDay(new Date()),
      isActive: slug => { if (skipped.has(slug)) return false; const e = ctx.words.get(slug); return !!(e && e.favorited); },
    }) : null;
    drawWarm();
  }

  // distractors: this lesson's words first, then the word book; choice.js tops up from the unit and the word lists
  function buildPool(queue) {
    const seen = new Set();
    const out = [];
    const add = e => { if (e && e.slug && !seen.has(e.slug) && Choice.meaningOf(e)) { seen.add(e.slug); out.push(e); } };
    for (const s of queue) add(ctx.words.get(s));
    for (const e of ctx.words.favorites()) add(e);
    return out;
  }

  function drawWarm() {
    if (step !== 'warmup') return;
    const s = session;
    const slug = s && s.current();
    const doneN = s ? s.done : 0;
    if (gQueue.length && (!slug || doneN >= gQueue[0].at)) { if (gQueue[0].probe) drawProbe(gQueue[0]); else if (gQueue[0].contrast) drawContrast(gQueue[0]); else drawGrammar(gQueue[0]); return; }
    // after the words and the grammar: the 505 words in one batch, then 找动词, then 变形配对, then the one 连词成句 sentence
    if (!slug && sQueue.length) { drawScreen(sQueue.splice(0)); return; }
    if (!slug && vQueue.length) { drawVerb(vQueue.splice(0)); return; }
    if (!slug && fQueue.length) { drawForms(fQueue.splice(0, 1)[0]); return; }
    if (!slug && pQueue.length) { drawPos(pQueue.splice(0), 'warmup'); return; }
    if (!slug && mQueue.length) { drawMistakes(mQueue.splice(0)); return; }
    if (!slug && oQueue.length) { drawOrder(oQueue.splice(0, 1), 'warmup'); return; }
    if (!slug) { endWarmup(); return; }
    drawWord(slug);
  }

  // one word card in the mode the plan asked for, falling back to an easier one when it cannot be made
  function renderWord(e, want, base) {
    const tries = want === 'cloze' ? ['cloze', 'tiles', 'mc4', 'card'] : want === 'tiles' ? ['tiles', 'mc4', 'card'] : want === 'listen' ? ['listen', 'mc4', 'card'] : want === 'card' ? ['card'] : ['mc4', 'card'];
    for (const m of tries) {
      let v = null;
      try {
        if (m === 'card') {
          v = flashcard.render(e, { ...base,
            openFull: () => ctx.openSheet(e.slug, { back: '回到上课' }),
            isTall: () => document.documentElement.scrollHeight > window.innerHeight + 4,
            busy: () => !!(session && session.busy) });
        } else {
          const mode = m === 'mc4' ? Choice.choiceMode : m === 'listen' ? listenModeOf(mods) : m === 'cloze' ? clozeModeOf(mods) : spellModeOf(mods);
          if (!mode) continue;
          v = mode.render(e, base);
        }
      } catch (err) { console.warn('lesson: ' + m + ' card:', (err && err.message) || err); v = null; }
      // spellMode hands back a four-choice card for a word it cannot tile (modeId 'mc4'): record what she really saw
      if (v && v.el && v.question !== null) return { v, mode: m === 'card' ? 'card' : eventModeOf(v, m) };
    }
    return null;
  }

  function drawWord(slug) {
    const s = session;
    const e = ctx.words.get(slug);
    const now = new Date();
    const isNew = !e.fsrs || e.fsrs.state === State.New;
    const textbook = isNew && !!unitOf(e);
    // 0.9.4 先讲再考: a textbook word still new meets its 巧记 first (once a lesson, at most MEMO_NEW_MAX), then its card
    const tm = textbook && !taught.has(slug) && memoNew < MEMO_NEW_MAX ? memoOf(e) : null;
    if (teachFirst({ isNew, textbook, hasMemo: !!tm, taught: taught.has(slug), count: memoNew })) { teach(slug); return; }
    const pf = e.fsrs && e.fsrs.state !== State.New ? round2(retrievability(e.fsrs, now)) : null;
    // a word she got wrong earlier in this lesson comes back as four-choice (DESIGN 5.1 rule 4)
    const want = results.has(slug) ? 'mc4' : (modeBySlug.get(slug) || 'mc4');
    const position = { n: s.done + 1, total: s.total, isNew };
    cur = { kind: 'word', slug, item: 'w:' + slug, mode: want, p: 0.5, pf, t: Date.now(), answered: false, isNew: position.isNew, textbook };
    const base = { app: ctx, pool, say, position, rate: g => rate(g), onAnswer: ev => onAnswer(e, ev), distractor: distractorOf(cellOf('warmup'), slug) };
    const r = renderWord(e, want, base);
    if (!r) { skipped.add(slug); drawWarm(); return; }
    view = r.v;
    cur.mode = r.mode;
    // the teacher's bet before she answers (teacher-memory 10.1); v1 still has no notebook, so p_teacher = p_base
    cur.p = predict(e, cur.mode);
    log({ type: 'predict', step: 'warmup', item: cur.item, slug, mode: cur.mode, unit: unitOf(e), p_base: cur.p, p_teacher: cur.p });
    paint(LABELS.warmup, 'warmup', askedSet.has(slug) ? askedTag() : null, tools(feel, flag), view.el, [].concat(view.footer || []));
  }

  // a word or a grammar point 问老师 explained a few days ago, back to see if it stuck (teacher.js 我问过的)
  const askedTag = () => h('p', { className: 'small lesson-asked-tag', text: '我问过的' });

  function onAnswer(e, ev) {
    const stepNow = step || 'warmup';
    log({ type: 'answer', step: stepNow, unit: unitOf(e), ...ev });
    if (!cur || cur.slug !== ev.slug) return;
    if (!cur.answered) {
      cur.answered = true;
      wrongStreak = ev.correct ? 0 : wrongStreak + 1;
      if (stepNow === 'warmup' && !results.has(ev.slug)) results.set(ev.slug, { first: !!ev.correct, p: cur.p, mode: cur.mode });
      // 句子里回想: an answer after 提示 (the sentence's Chinese was shown and read aloud) is not a clean first try
      if (WRITE_MODES.has(cur.mode) && !spelled.has(ev.slug)) spelled.set(ev.slug, { first: !!ev.correct && ev.first_try !== false && !(ev.hint_level > 0), p: cur.p });
      // 0.9.0: a wrong four-choice or listening answer shows the right one already: its 巧记 goes right under it
      if (!ev.correct && (cur.mode === 'mc4' || cur.mode === 'listen')) memoInline(e);
    }
  }

  // ---- 0.9.0 巧记 (Wei 10-26): a new word the first time it shows up, and a word she just got wrong, get their memory
  // tricks: the offline notes (word-notes.js noteFor), else the entry's own (the model's mem, the old one-line mnemonic).
  // Once a word in a lesson. Never while she still has to recall the word: a spelling card shows them after it is done.
  function memoOf(e) {
    if (!e || !e.headword) return null;
    try { const m = memoryOf(e, noteOf(ctx, e.headword)); return m && (m.mem.length || m.trap || m.use) ? m : null; } catch (err) { return null; }
  }
  function memoInline(e) {
    if (!e || memoSeen.has(e.slug) || !view || !view.el) return;
    const m = memoOf(e);
    if (!m) return;
    try {
      const box = memoryBlock(ctx, m, { word: e.headword });
      if (!box) return;
      memoSeen.add(e.slug);
      box.classList.add('lesson-memo-inline');
      view.el.append(box);
    } catch (err) { /* the card works without it */ }
  }
  // one screen: the word, its part of speech and meaning, the 巧记 block, “记住了”
  // a wrong one always; her own new word answered right not on the first lesson (it ends on right answers, quickly), at
  // most MEMO_NEW_MAX a lesson. A textbook word was taught before its card (0.9.4), so a right answer goes straight on.
  function memoWanted(c, g) {
    if (!c || !c.slug || memoSeen.has(c.slug)) return false;
    if (!memoAfter(g, { isNew: !!c.isNew, textbook: !!c.textbook, hasMemo: true, first: !!(plan && plan.first), count: memoNew })) return false;
    return !!memoOf(ctx.words.get(c.slug));
  }
  // 0.9.4 先讲再考: the 巧记 screen before the word's first card; “记住了，考我” draws the card
  function teach(slug) {
    const s = session;
    showMemo({ slug }, 0, () => {
      if (step !== 'warmup' || session !== s) return;
      if (s && s.current() === slug) drawWord(slug); else drawWarm();
    }, { teach: true });
  }
  function showMemo(c, g, then, { teach: pre = false } = {}) {
    const e = ctx.words.get(c.slug);
    const m = memoOf(e);
    // taught before its card: marked even without 巧记, so its card never waits for it twice
    if (pre) taught.add(c.slug);
    if (!m) { then(); return; }
    // a word taught first can still get its 巧记 once after a wrong answer (memoSeen is for that one)
    if (!pre) memoSeen.add(c.slug);
    if (pre || g !== 1) memoNew++;
    let gone = false;
    const go = () => { if (gone) return; gone = true; then(); };
    let pl = null;
    try { const fn = fnOf(mods.pos, 'posLine'); pl = fn ? fn(e, { curriculum: ctx.curriculum }) : null; } catch (err) { pl = null; }
    const cn = Choice.meaningOf(e) || m.cn || '';
    const box = h('article', { className: 'lesson-module lesson-memo' + (pre ? ' lesson-memo-teach' : '') },
      h('p', { className: 'small lesson-memo-why', text: pre ? '新词，先认识一下。' : g === 1 ? '没关系，记一记，下次就对了。' : '新词，先记一记。' }),
      h('div', { className: 'lesson-memo-head' }, headwordNode({ headword: e.headword }, { tag: 'p', syl: false }), sayBtn(ctx, e.headword, '听一遍')),
      h('p', { className: 'lesson-memo-cn' },
        pl && pl.abbr ? h('i', { className: 'pos', lang: 'en', text: pl.abbr }) : null,
        pl && pl.zh ? h('span', { className: 'pos-zh', text: pl.zh }) : null,
        cn ? h('span', { className: 'lesson-memo-mean', text: cn }) : null),
      memoryBlock(ctx, m, { word: e.headword }),
      h('div', { className: 'btn-row lesson-memo-go' }, h('button', { type: 'button', className: 'btn', text: pre ? '记住了，考我' : '记住了', on: { click: go } })));
    const v = { onKey: ev => { if (ev.metaKey || ev.ctrlKey || ev.altKey) return; if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } } };
    view = v;
    paint(step === 'write' ? writeTitle() : LABELS.warmup, step || 'warmup', box);
    // the first time she meets the word she hears it once (the four-choice card does the same; a blocked one waits for 听一遍)
    if (pre) setTimeout(() => { if (view === v && !gone) { try { say(e.headword, null); } catch (err) { /* she can tap 听一遍 */ } } }, 0);
  }

  async function rate(g) {
    if (step === 'write') { writeRate(g); return; }
    const s = session;
    if (!s || s.busy || !cur || cur.kind !== 'word') return;
    const c = cur;
    if (c.mode === 'card' && !c.answered) {
      // the flashcard has no options: her own rating is the answer (模糊 and up count as remembered)
      const e = ctx.words.get(c.slug);
      c.answered = true;
      log({ type: 'answer', step: 'warmup', item: c.item, slug: c.slug, unit: unitOf(e), mode: 'card', choice: String(g),
        correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
      wrongStreak = g >= 2 ? 0 : wrongStreak + 1;
      if (!results.has(c.slug)) results.set(c.slug, { first: g >= 2, p: c.p, mode: 'card' });
    } else if (!c.answered) {
      // a mode that rates without calling onAnswer: count the rating as her answer
      c.answered = true;
      wrongStreak = g >= 2 ? 0 : wrongStreak + 1;
      if (!results.has(c.slug)) results.set(c.slug, { first: g >= 3, p: c.p, mode: c.mode });
      if (WRITE_MODES.has(c.mode) && !spelled.has(c.slug)) spelled.set(c.slug, { first: g >= 3, p: c.p });
    }
    // 0.9.0: a new word the first time, or a word she got wrong: its 巧记 first, then on
    if (!c.memo && memoWanted(c, g)) { c.memo = true; showMemo(c, g, () => { if (cur === c) rate(g); }); return; }
    lastGrade = g;
    let r = null;
    try { r = await s.rate(g, { modeId: c.mode }); } catch (err) { toast('这一下没记上，再点一次。'); return; }
    if (!r) return;
    log({ type: 'review', step: 'warmup', slug: c.slug, rating: g, line: WRITE_MODES.has(c.mode) ? 'write' : 'recognize', p_fsrs: c.pf, mode: c.mode });
    if (session !== s) return;
    drawWarm();
  }

  // ---- grammar questions (warm-up)

  // g = { q } or { ref } (see warmupGrammar). One grammar question in the warm-up or the quiz.
  function drawGrammar(g) {
    const q = g.q || null;
    const item = g.item || (q && q.item) || (g.ref && g.ref.item);
    cur = { kind: 'grammar', item, mode: q ? 'mc4' : 'grammar', p: q ? grammarPrior(q) : GRAMMAR_PRIOR, t: Date.now(), answered: false, g };
    log({ type: 'predict', step, item, mode: cur.mode, unit: (q && q.unit) || (g.ref && g.ref.unit) || undefined, p_base: cur.p, p_teacher: cur.p });
    const box = h('article', { className: 'lesson-gq-box' });
    let v = null;
    const draw = fnOf(mods.grammarUI, 'renderGrammarItem');
    if (g.ref && draw) {
      // ui-grammar logs its own answer / hint / flag events (with our sid and step); we only watch them
      try { v = draw(box, watchCtx(), { item: g.ref, sid, step, onDone: res => afterGrammar(g, res) }); }
      catch (err) { console.warn('lesson: grammar item:', (err && err.message) || err); v = null; }
      if (!v) { afterGrammar(g, null); return; }
    } else if (q) {
      v = renderGrammarQ(box, shuffleOptions(q), {
        title: '语法' + (gName(q.point) ? ' · ' + gName(q.point) : ''),
        onAnswer: ev => { log({ type: 'answer', step, unit: q.unit, mode: 'mc4', ...ev, item: (ev && ev.item) || q.item }); noteGrammar(ev); },
        onHint: ev => log({ type: 'hint', step, item: (ev && ev.item) || q.item, hint_level: ev && ev.hint_level, mode: 'mc4' }),
        onDone: res => afterGrammar(g, res),
      });
    } else { afterGrammar(g, null); return; }
    view = v;
    paint(step === 'write' ? writeTitle() : LABELS.warmup, step, g.ref && g.ref.asked ? askedTag() : null, g.ref ? null : tools(feel, flag), box);
  }

  // ---- 0.5.0: a foundation probe (ui-screen.js renderProbe draws it and logs its answers; we watch them like grammar)
  function drawProbe(g) {
    const fn = fnOf(mods.screenUI, 'renderProbe');
    const item = g.item;
    cur = { kind: 'grammar', item, mode: 'grammar', p: GRAMMAR_PRIOR, t: Date.now(), answered: false, g };
    if (!fn) { afterGrammar(g, null); return; }
    log({ type: 'predict', step, item, mode: 'grammar', p_base: GRAMMAR_PRIOR, p_teacher: GRAMMAR_PRIOR });
    const box = h('article', { className: 'lesson-gq-box' });
    let v = null;
    try { v = fn(box, watchCtx(), { items: [g.probe], sid, step: 'warmup', onDone: res => afterGrammar(g, res) }); }
    catch (err) { console.warn('lesson: probe:', (err && err.message) || err); v = null; }
    if (!v) { afterGrammar(g, null); return; }
    view = v;
    paint(LABELS.warmup, 'warmup', box);
  }

  // ---- 0.5.0: the 505 words (“认几个小学的老朋友”): what she says she knows is not right or wrong, so it is not counted
  function drawScreen(items) {
    const fn = fnOf(mods.screenUI, 'renderScreen');
    const box = h('article', { className: 'lesson-module lesson-module-screen' });
    cur = { kind: 'screen', item: '', mode: 'screen', t: Date.now(), answered: false };
    view = null;
    paint(LABELS.warmup, 'warmup', box);
    let finished = false;
    const done = () => { if (finished) return; finished = true; cur = null; if (step === 'warmup') drawWarm(); };
    if (!fn) { done(); return; }
    try {
      const r = fn(box, ctx, { items, sid, step: 'warmup', onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey };
    } catch (err) { console.warn('lesson: screen:', (err && err.message) || err); done(); }
  }

  // ---- 0.5.0: 找动词 (modes/verb.js): one sentence from the episodes, tap its verb
  function drawVerb(ids) {
    const fn = fnOf(mods.verb, 'renderVerb');
    const box = h('article', { className: 'lesson-module lesson-module-verb' });
    cur = { kind: 'verb', item: '', mode: 'verb', t: Date.now(), answered: false };
    view = null;
    paint(LABELS.warmup, 'warmup', box);
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      for (const r of (res && res.results) || []) {
        if (!gResults.has(r.item)) gResults.set(r.item, { first: !!r.clean });
        if (r.clean) verbRight++;
        wrongStreak = r.clean ? 0 : wrongStreak + 1;
      }
      if (step === 'warmup') drawWarm();
    };
    if (!fn) { done(null); return; }
    try {
      const r = fn(box, watchCtx('warmup'), { items: ids, sid, step: 'warmup', onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey };
    } catch (err) { console.warn('lesson: verb:', (err && err.message) || err); done(null); }
  }

  // ---- 0.6.0: 变形配对 (modes/forms.js): one group, 连线 or 四选一. Each pair's answers get a predict from watchCtx (0.5)
  function drawForms(spec) {
    const fn = fnOf(mods.forms, 'renderForms');
    const box = h('article', { className: 'lesson-module lesson-module-forms' });
    cur = { kind: 'forms', item: 'forms', mode: 'forms', t: Date.now(), answered: false };
    view = null;
    paint(LABELS.warmup, 'warmup', box);
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      for (const r of (res && res.results) || []) {
        const item = r.item || ('f:' + r.id);
        if (!gResults.has(item)) gResults.set(item, { first: !!r.clean });
        if (r.clean) formsRight++;
        wrongStreak = r.clean ? 0 : wrongStreak + 1;
      }
      if (step === 'warmup') drawWarm();
    };
    if (!fn || !spec) { done(null); return; }
    try {
      const r = fn(box, watchCtx('warmup'), { items: { kind: spec.kind, items: spec.items }, sid, step: 'warmup', onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey, stop: r.stop };
      if (!r) done(null);
    } catch (err) { console.warn('lesson: forms:', (err && err.message) || err); done(null); }
  }

  // ---- 0.9.0: 词性题 (pos.js renderPos): a word or an underlined word in a sentence, which part of speech. It logs its own
  // answer / hint events (mode 'pos', no slug); watchCtx gives each its predict (four options, 0.63)
  function drawPos(items, where, after = null) {
    const fn = fnOf(mods.pos, 'renderPos');
    const box = h('article', { className: 'lesson-module lesson-module-pos' });
    cur = { kind: 'pos', item: 'pos', mode: 'pos', t: Date.now(), answered: false };
    view = null;
    paint(where === 'write' ? writeTitle() : LABELS.warmup, where, box);
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      view = null;
      for (const r of (res && res.results) || []) {
        if (r.item && !gResults.has(r.item)) gResults.set(r.item, { first: !!r.clean });
        if (r.clean) posRight++;
        wrongStreak = r.clean ? 0 : wrongStreak + 1;
      }
      if (after) { after(); return; }
      if (step === 'warmup') drawWarm();
    };
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!fn || !list.length) { done(null); return; }
    try {
      const r = fn(box, watchCtx(where), { items: list, sid, step: where, onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey, stop: r.stop };
      if (!r) done(null);
    } catch (err) { console.warn('lesson: pos:', (err && err.message) || err); done(null); }
  }

  // ---- 0.7.0: 错题再考 (ui-mistakes.js renderMistakeReview writes kv 'mistake:<id>' and its own answer events)
  function drawMistakes(items) {
    const fn = fnOf(mods.mistakesUI, 'renderMistakeReview');
    const box = h('article', { className: 'lesson-module lesson-module-mistakes' });
    cur = { kind: 'mistake', item: '', mode: 'mistake', t: Date.now(), answered: false };
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      view = null;
      const right = res && Number.isFinite(res.right) ? res.right : 0;
      mistakesRight += right;
      for (const x of items) if (!gResults.has(x.item || 'mx:' + x.id)) gResults.set(x.item || 'mx:' + x.id, { first: right > 0 });
      if (step === 'warmup') drawWarm();
    };
    if (!fn || !items.length) { done(null); return; }
    paint(LABELS.warmup, 'warmup', h('p', { className: 'small lesson-mx-head', text: '错题再考：上次错的，换一道同样的题。' }), box);
    try {
      const r = fn(box, ctx, { items, sid, step: 'warmup', onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey, stop: r.stop };
      if (!r) done(null);
    } catch (err) { console.warn('lesson: mistakes:', (err && err.message) || err); done(null); }
  }

  // ---- 0.6.0: 对比小卡 (ui-grammar.js renderContrast): one screen, two columns, 3 quick judgments (answers 'gc:<id>:<q>')
  function drawContrast(g) {
    const fn = fnOf(mods.grammarUI, 'renderContrast');
    const item = g.item;
    cur = { kind: 'grammar', item, mode: 'grammar', p: CONTRAST_PRIOR, t: Date.now(), answered: false, g };
    if (!fn) { afterGrammar(g, null); return; }
    const box = h('article', { className: 'lesson-gq-box lesson-contrast-box' });
    let v = null;
    const onDone = res => {
      for (const r of (res && res.results) || []) {
        const k = r.item || (item + ':' + r.qid);
        if (!gResults.has(k)) gResults.set(k, { first: !!r.correct });
        wrongStreak = r.correct ? 0 : wrongStreak + 1;
      }
      afterGrammar(g, res);
    };
    try { v = fn(box, watchCtx('warmup'), { item: g.contrast, sid, step: 'warmup', onDone }); }
    catch (err) { console.warn('lesson: contrast:', (err && err.message) || err); v = null; }
    if (!v) { afterGrammar(g, null); return; }
    view = v;
    paint(LABELS.warmup, 'warmup', box);
  }

  // first answer per grammar item: for the wrap's count and the wrong streak
  function noteGrammar(ev) {
    const item = ev && ev.item;
    if (!item || gResults.has(item)) return;
    gResults.set(item, { first: !!ev.correct });
    wrongStreak = ev.correct ? 0 : wrongStreak + 1;
  }

  // ctx for ui-grammar / ui-phonics: same as ours, but every event they log passes by here first. A question we did not
  // announce gets its 'predict' just before its first answer (teacher-memory 10.1), and we see what she got right.
  function watchCtx(stepName) {
    const announced = new Set(cur && cur.item ? [cur.item] : []);
    const base = ctx.events;
    const events = Object.assign(Object.create(base), {
      log(ev) {
        try {
          if (ev && ev.type === 'answer' && ev.item) {
            if (!announced.has(ev.item)) {
              announced.add(ev.item);
              // 连词成句, 句型转换 and 找动词 cannot be guessed (0.5); a reading question has four options (0.63, like grammar)
              // 0.6.0: 变形配对 0.5 (a match cannot be guessed well), a 对比小卡 judgment has two options (0.75)
              const p = ev.mode === 'order' || ev.mode === 'transform' || ev.mode === 'verb' || ev.mode === 'forms' ? 0.5
                : ev.kind === 'contrast' || /^gc:/.test(String(ev.item)) ? CONTRAST_PRIOR : GRAMMAR_PRIOR;
              base.log({ type: 'predict', sid, step: ev.step || stepName || step, item: ev.item, mode: ev.mode, p_base: p, p_teacher: p });
            }
            if (/^g:/.test(ev.item)) noteGrammar(ev);
          }
        } catch (err) { /* bookkeeping only */ }
        return base.log(ev);
      },
      sessionId: () => sid,
    });
    return Object.assign(Object.create(ctx), { events, sid });
  }

  function afterGrammar(g, res) {
    if (!cur || cur.g !== g) return;
    cur = null;
    if (step === 'warmup') { gQueue = gQueue.filter(x => x !== g); drawWarm(); }
    else if (step === 'write' && wq) { wq.queue.shift(); wq.done++; drawWrite(); }
  }

  // ---- 有点难 / 这题有问题

  function feel(btn) {
    if (!cur) return;
    log({ type: 'feel', step, item: cur.item, slug: cur.slug, mode: cur.mode });
    btn.disabled = true;
    btn.textContent = '老师记下了';
  }

  function flag() {
    if (!cur) return;
    if (cur.kind === 'word' && step === 'warmup' && (!session || session.busy)) return;
    log({ type: 'flag', step, item: cur.item, slug: cur.slug, mode: cur.mode });
    toast('这题先跳过，老师记下了。', 1600);
    // skipped, not graded (DESIGN 8.3)
    if (cur.kind === 'grammar') {
      const g = cur.g;
      cur = null;
      if (step === 'warmup') { gQueue = gQueue.filter(x => x !== g); drawWarm(); }
      else if (wq) { wq.queue = wq.queue.filter(x => x !== g); drawWrite(); }
      return;
    }
    const slug = cur.slug;
    skipped.add(slug);   // isActive drops it from the warm-up queue
    if (step === 'write' && wq) { wq.queue = wq.queue.filter(x => x.slug !== slug); drawWrite(); return; }
    drawWarm();
  }

  function showEnough() {
    if (enoughOff || !noteSlot || (step !== 'warmup' && step !== 'write') || ctx.currentRoute() !== 'lesson') return;
    noteSlot.replaceChildren(h('div', { className: 'lesson-note', role: 'status' },
      h('p', { text: '今天够了。剩下的明天接着来。' }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '去收尾', on: { click: enough } }),
        h('button', { type: 'button', className: 'text-btn', text: '再做几张', on: { click: () => { enoughOff = true; noteSlot.replaceChildren(); } } }))));
  }

  // 今天够了 → 去收尾: whatever is left waits for tomorrow
  function enough() {
    if (step === 'warmup') endWarmup(true);
    else if (step === 'write') endWrite();
    else wrap();
  }

  function endWarmup(stop = false) {
    if (session) { session.end(); session = null; }
    gQueue = [];
    if ((results.size || gResults.size) && !stepsDone.includes('warmup')) stepsDone.push('warmup');
    if (!stop && (results.size || gResults.size)) pendingFb = { part: 'warmup' };
    if (stop) wrap(); else afterWarmup();
  }

  function afterWarmup() {
    const r = cellOf('read');
    const rk = readKind(r, mods);
    if (rk === 'passage') { startPassage(r); return; }
    if (rk) { startRead(r); return; }
    afterRead();
  }
  // 0.8.0 读出来 (ui-readaloud.js): after the episode or today's reading, two sentences with its target words, heard,
  // read aloud and played back. Not on a light lesson, after 21:00, or for the quiz's 期中阅读小篇.
  function readAloudThen(res, cell) {
    const list = res && res.done && Array.isArray(res.readAloud) ? res.readAloud.filter(x => x && x.en) : [];
    const fn = fnOf(mods.readaloud, 'renderReadAloud');
    if (!fn || !list.length || light || (cell && cell.short) || new Date().getHours() >= 21) { afterRead(); return; }
    step = 'read';
    cur = null;
    view = null;
    const box = h('div', { className: 'lesson-module lesson-module-readaloud' });
    paint('读出来', 'read', box);
    let finished = false;
    try {
      reading = fn(box, watchCtx('read'), { sentences: list, sid, step: 'read', label: '读出来', doneLabel: '接着上课',
        onDone: r => { if (finished || step !== 'read') return; finished = true; reading = null; readAloudN += (r && r.recorded) || 0; afterRead(); } });
      if (reading && typeof reading.onKey === 'function') view = { onKey: reading.onKey, stop: reading.stop };
    } catch (err) { console.warn('lesson: read aloud:', (err && err.message) || err); reading = null; afterRead(); }
  }
  function afterRead() {
    const w = cellOf('write');
    const k = writeKind(w, mods);
    if (k) startWrite(w, k); else wrap();
  }

  // ---------------------------------------------------------------- 读一段

  // the names she gave the girl and the cat (kv 'story:names'), for the 连词成句 sentences taken from the story
  function storySwaps() {
    const R = mods.story;
    const O = mods.order;
    try {
      if (!R || !O || typeof R.nameList !== 'function' || typeof O.nameSwaps !== 'function') return [];
      const picked = R.cleanNames ? R.cleanNames(ctx.kv.peek(R.NAMES_KEY || 'story:names', null)) : {};
      return O.nameSwaps(R.nameList(), picked);
    } catch (err) { return []; }
  }

  function stopReading() {
    if (reading && typeof reading.stop === 'function') { try { reading.stop(); } catch (err) { /* ignore */ } }
    reading = null;
  }

  // one episode: ui-reader draws it all and logs its own events (sid, step 'read'); we only learn when it is over
  function startRead(cell) {
    // 0.8.0: all six episodes read (readCell again): today's reading (每日阅读, a bit harder) instead of one read again
    if (cell.again && fnOf(mods.dailyUI, 'renderDailyRead')) { startDaily(cell); return; }
    step = 'read';
    cur = null;
    view = null;
    const box = h('div', { className: 'lesson-module lesson-module-read' });
    paint(cellLabel('read') + (cell.n ? ` · 第 ${cell.n} 集` : ''), 'read', box);
    let finished = false;
    const done = res => {
      if (finished || step !== 'read') return;
      finished = true;
      reading = null;
      readRes = res || null;
      if (res && res.done && !stepsDone.includes('read')) stepsDone.push('read');
      if (res) pendingFb = { part: 'read', item: 'ep:' + cell.episodeId, mode: 'read' };
      readAloudThen(res, cell);
    };
    try {
      reading = fnOf(mods.reader, 'renderEpisode')(box, watchCtx('read'), {
        episodeId: cell.episodeId, short: !!cell.short, again: cell.again ? true : null, sid, step: 'read', doneLabel: '接着上课', onDone: done,
        challenge: Number(cell.challenge) || 0, autoTrunk: !!cell.autoTrunk, selfFirst: !!cell.selfFirst,
      });
      if (reading && typeof reading.onKey === 'function') view = { onKey: reading.onKey };
    } catch (err) {
      console.warn('lesson: reading:', (err && err.message) || err);
      reading = null;
      done(null);
    }
  }

  function startDaily(cell) {
    step = 'read';
    cur = null;
    view = null;
    const box = h('div', { className: 'lesson-module lesson-module-read' });
    paint('今天的阅读', 'read', box);
    let finished = false;
    const done = res => {
      if (finished || step !== 'read') return;
      finished = true;
      reading = null;
      readRes = res && res.done ? { ...res, daily: true } : null;
      if (res && res.done && !stepsDone.includes('read')) stepsDone.push('read');
      readAloudThen(res, cell);
    };
    try {
      reading = fnOf(mods.dailyUI, 'renderDailyRead')(box, watchCtx('read'), { sid, step: 'read', doneLabel: '接着上课', onDone: done });
      if (reading && typeof reading.onKey === 'function') view = { onKey: reading.onKey };
    } catch (err) { console.warn('lesson: daily reading:', (err && err.message) || err); reading = null; done(null); }
  }

  // ---- 0.5.0: the quiz day's 期中阅读小篇 (reader.js loadPassages, ui-reader.js renderPassage): questions only, the text
  // stays open; done passages go into kv 'exam.reading' so the next quiz reads another one
  function loadExam() {
    if (!examCache) {
      const load = fnOf(mods.story, 'loadPassages');
      examCache = load ? Promise.resolve(load({ fetchJSON: ctx.fetchJSON })).catch(err => { examCache = null; throw err; }) : Promise.resolve([]);
    }
    return examCache;
  }
  async function markPassage(id) {
    try {
      const rec = (await ctx.kv.get('exam.reading', null)) || {};
      const out = { v: 1, done: { ...((rec && typeof rec.done === 'object' && rec.done) || {}), [id]: dayOf(new Date()) }, updated: new Date().toISOString() };
      await ctx.kv.set('exam.reading', out);
    } catch (err) { console.warn('lesson: exam reading:', (err && err.message) || err); }
  }
  function startPassage(cell) {
    step = 'read';
    cur = null;
    view = null;
    const box = h('div', { className: 'lesson-module lesson-module-read' });
    paint(cell.note || '期中阅读', 'read', box);
    let finished = false;
    const done = res => {
      if (finished || step !== 'read') return;
      finished = true;
      reading = null;
      readRes = res ? { ...res, passage: true } : null;
      if (res && res.done) { if (!stepsDone.includes('read')) stepsDone.push('read'); markPassage(cell.passageId); }
      if (res) pendingFb = { part: 'read', item: 'ep:' + cell.passageId, mode: 'read' };
      afterRead();
    };
    loadExam().then(list => {
      if (finished || step !== 'read') return;
      const ep = (list || []).find(p => p && p.id === cell.passageId);
      if (!ep) { done(null); return; }
      reading = fnOf(mods.reader, 'renderPassage')(box, watchCtx('read'), {
        passage: ep, mode: 'questions', label: cell.note || ep.label || '期中阅读', sid, step: 'read', doneLabel: '接着上课', onDone: done, challenge: Number(cell.challenge) || 0,
      });
      if (reading && typeof reading.onKey === 'function') view = { onKey: reading.onKey };
    }).catch(err => { console.warn('lesson: exam reading:', (err && err.message) || err); reading = null; done(null); });
  }

  // ---------------------------------------------------------------- 连词成句 (modes/order.js)

  // ids: the sentences; where: 'warmup' (the one at the end of the warm-up) or 'write' (连词成句 day)
  function drawOrder(ids, where) {
    const fn = fnOf(mods.order, 'renderOrder');
    const box = h('article', { className: 'lesson-module lesson-module-order' });
    // no item here: each sentence gets its 'predict' from watchCtx just before its first answer
    cur = { kind: 'order', item: '', mode: 'order', t: Date.now(), answered: false };
    view = null;
    paint(where === 'write' ? writeTitle() : LABELS.warmup, where, box);
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      const list = (res && res.results) || [];
      orderRight += list.filter(r => r.clean).length;
      for (const r of list) {
        if (!gResults.has(r.item)) gResults.set(r.item, { first: !!r.clean });
        wrongStreak = r.clean ? 0 : wrongStreak + 1;
      }
      if (where === 'warmup') { if (step === 'warmup') drawWarm(); }
      else if (step === 'write') endWrite(!!(res && res.done), !!(res && res.done));
    };
    if (!fn) { done(null); return; }
    try {
      const r = fn(box, Object.assign(watchCtx(where), { grammarState: () => (mods.grammar && mods.grammar.grammarState ? mods.grammar.grammarState(ctx.kv) : null) }), {
        items: ids, sid, step: where, swaps: storySwaps(), onDone: done,
        title: where === 'warmup' ? '连词成句' : '',
      });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey };
    } catch (err) {
      console.warn('lesson: order:', (err && err.message) || err);
      done(null);
    }
  }

  // ---- 0.5.0 句型转换 (modes/order.js renderTransforms): 写几个词 on its days, three sentences
  function drawTransform(ids) {
    const fn = fnOf(mods.order, 'renderTransforms');
    const box = h('article', { className: 'lesson-module lesson-module-order' });
    cur = { kind: 'order', item: '', mode: 'transform', t: Date.now(), answered: false };
    view = null;
    paint(writeTitle(), 'write', box);
    let finished = false;
    const done = res => {
      if (finished) return;
      finished = true;
      cur = null;
      const list = (res && res.results) || [];
      transformRight += list.filter(r => r.clean).length;
      for (const r of list) {
        if (!gResults.has(r.item)) gResults.set(r.item, { first: !!r.clean });
        wrongStreak = r.clean ? 0 : wrongStreak + 1;
      }
      if (step === 'write') endWrite(!!(res && res.done), !!(res && res.done));
    };
    if (!fn) { done(null); return; }
    try {
      const r = fn(box, watchCtx('write'), { items: ids, sid, step: 'write', swaps: storySwaps(), onDone: done });
      if (r && typeof r.onKey === 'function') view = { onKey: r.onKey };
    } catch (err) {
      console.warn('lesson: transform:', (err && err.message) || err);
      done(null);
    }
  }

  // ---------------------------------------------------------------- 写几个词

  // 拼写日: the plan's 2-3 words; 考前小卷: its words, then its grammar questions. Both are a queue of
  // { kind: 'spell', slug } / { kind: 'grammar', q }. A spelling she misses comes back once, two items later.
  function startWrite(cell, k) {
    step = 'write';
    writeK = k;
    cur = null;
    if (k === 'tiles' || k === 'quiz') {
      const all = k === 'quiz' ? quizItems(cell.quiz || { items: cell.items }) : [...new Set(cell.items || [])].map(slug => ({ kind: 'spell', slug }));
      const canSpell = !!spellModeOf(mods);
      const queue = all.filter(x => (x.kind === 'grammar' ? !!x.q : canSpell && !!ctx.words.get(x.slug)));
      // 0.9.0: the quiz's 词性题 come right after its spelling, before the grammar
      const qp = k === 'quiz' && fnOf(mods.pos, 'renderPos') ? posRefs(cell.quiz || {}) : [];
      if (qp.length) { const at = queue.filter(x => x.kind === 'spell').length; queue.splice(at, 0, { kind: 'pos', items: qp }); }
      if (!queue.length) { endWrite(false); return; }
      wq = { queue, retried: new Set(), done: 0, total: queue.length, quiz: k === 'quiz' };
      drawWrite();
      return;
    }
    if (k === 'order') { drawOrder((cell.items || []).slice(), 'write'); return; }
    if (k === 'transform') { drawTransform((cell.items || []).slice()); return; }
    drawModuleCard(cell, k);
  }

  function drawWrite() {
    if (step !== 'write' || !wq) return;
    const x = wq.queue[0];
    if (!x) { endWrite(); return; }
    if (x.kind === 'grammar') { if (!x.item) x.item = x.q.item; drawGrammar(x); return; }
    if (x.kind === 'pos') { drawPos(x.items, 'write', () => { if (step !== 'write' || !wq) return; wq.queue.shift(); wq.done++; drawWrite(); }); return; }
    const slug = x.slug;
    const e = ctx.words.get(slug);
    if (!e) { wq.queue.shift(); drawWrite(); return; }
    cur = { kind: 'word', slug, item: 'w:' + slug, mode: 'tiles', p: 0.5, pf: null, t: Date.now(), answered: false };
    const mode = spellModeOf(mods);
    let v = null;
    try {
      v = mode && mode.render(e, { app: ctx, pool, say, position: { n: wq.done + 1, total: Math.max(wq.total, wq.done + wq.queue.length), isNew: false },
        rate: g => rate(g), onAnswer: ev => onAnswer(e, ev), line: 'write' });
    } catch (err) { console.warn('lesson: spelling:', (err && err.message) || err); v = null; }
    // a phrase or a word it cannot tile (spellMode then hands back four-choice): 写几个词 is for spelling, so pass it
    if (!v || !v.el || v.question === null || eventModeOf(v, 'tiles') !== 'tiles') { wq.queue.shift(); drawWrite(); return; }
    view = v;
    cur.p = predict(e, 'tiles');
    log({ type: 'predict', step: 'write', item: cur.item, slug, mode: 'tiles', unit: unitOf(e), p_base: cur.p, p_teacher: cur.p });
    paint(writeTitle(), 'write', tools(feel, flag), view.el, [].concat(view.footer || []));
  }

  // spelling in 写几个词 only records (the warm-up already gave FSRS today's rating)
  function writeRate(g) {
    if (!wq || !cur || cur.kind !== 'word') return;
    const slug = cur.slug;
    const c = cur;
    if (!cur.answered) {
      cur.answered = true;
      wrongStreak = g >= 2 ? 0 : wrongStreak + 1;
      if (!spelled.has(slug)) spelled.set(slug, { first: g >= 3, p: cur.p });
    }
    // 0.9.0: spelled wrong: its 巧记 before the next word
    if (g === 1 && !c.memo && memoWanted(c, g)) { c.memo = true; showMemo(c, g, () => { if (cur === c) writeRate(g); }); return; }
    wq.queue.shift();
    wq.done++;
    if (g === 1 && !wq.retried.has(slug)) { wq.retried.add(slug); wq.queue.splice(Math.min(2, wq.queue.length), 0, { kind: 'spell', slug }); }
    drawWrite();
  }

  const cellLabel = id => ((cellOf(id) || {}).label || LABELS[id]);
  // the title over 写几个词 says what it is today
  const writeTitle = () => (writeK === 'quiz' && ((cellOf('write') || {}).quiz || {}).kind === 'weekend' ? '本周语法 10 题'
    : ({ grammar: '语法卡', phonics: '语音小卡', quiz: '考前小卷', order: '连词成句', transform: '句型转换' })[writeK] || cellLabel('write'));

  // 语法卡 / 语音小卡: the module draws the whole card, logs its own answers and says when it is done.
  //   ui-grammar.js renderGrammarCard(container, ctx, { cardId, part, onDone, sid, step, doneLabel })
  //   ui-phonics.js renderPhonicsCard(container, ruleId | null, { app, say, sid, step, onAnswer, onDone })
  function drawModuleCard(cell, k) {
    const box = h('div', { className: 'lesson-module lesson-module-' + k });
    let finished = false;
    // the card says it is finished (not skipped): 写几个词 is done today, whatever was answered in it
    const done = did => { if (!finished && step === 'write') { finished = true; endWrite(did, did); } };
    view = null;
    cur = { kind: 'card', item: '', mode: k, t: Date.now(), answered: false };
    paint(writeTitle(), 'write', box);
    let r = null;
    try {
      if (k === 'grammar') {
        const fn = fnOf(mods.grammarUI, 'renderGrammarCard');
        const card = cell.card ?? cell.point;
        const cardId = grammarCardId(card, mods.grammar);
        const part = Number((card && card.part) || cell.part) || 1;
        if (!fn || !cardId) { done(false); return; }
        r = fn(box, watchCtx('write'), { cardId, part, sid, step: 'write', doneLabel: '接着上课', why: (card && card.why) || '', onDone: res => done(!(res && res.done === false)) });
      } else {
        const fn = fnOf(mods.phonics, 'renderPhonicsCard');
        if (!fn) { done(false); return; }
        const card = cell.card ?? cell.rule ?? null;
        const ruleId = card && typeof card === 'object' ? (card.id || card.ruleId || null) : card;
        const announced = new Set();
        r = fn(box, ruleId || null, {
          app: ctx, say, sid, step: 'write',
          onAnswer: ev => {
            if (ev && ev.item && !announced.has(ev.item)) {
              announced.add(ev.item);
              const p = predictCorrect(null, new Date(), { mode: ev.mode });
              log({ type: 'predict', step: 'write', item: ev.item, mode: ev.mode, p_base: p, p_teacher: p });
            }
            log({ step: 'write', ...(ev || {}) });
            wrongStreak = ev && ev.correct ? 0 : wrongStreak + 1;
          },
          onDone: res => done(!(res && res.skipped)),
        });
      }
    } catch (err) {
      console.warn('lesson: ' + k + ' card:', (err && err.message) || err);
      done(false);
      return;
    }
    if (r && typeof r.onKey === 'function') view = { onKey: r.onKey };
  }

  function endWrite(did = true, whole = false) {
    const any = did && (whole || spelled.size || gResults.size || (wq && wq.done));   // gResults also holds 连词成句 sentences
    if (any && !stepsDone.includes('write')) stepsDone.push('write');
    if (any && writeK === 'quiz' && ((cellOf('write') || {}).quiz || {}).kind === 'weekend' && mods.weekend) mods.weekend.mark(ctx.kv, 'grammar').catch(() => {});
    if (any && writeK !== 'quiz') {
      const wc = cellOf('write');
      pendingFb = writeK === 'grammar' ? { part: 'grammar', item: 'g:' + ((wc && ((wc.card && typeof wc.card === 'object' ? wc.card.id : wc.card) || wc.point)) || ''), mode: 'grammar' } : { part: 'write', mode: writeK };
    }
    wq = null;
    wrap();
  }

  // ---------------------------------------------------------------- wrap

  async function markDay(list) {
    const key = 'day:' + dayOf(new Date());
    try {
      const rec = (await ctx.kv.get(key, {})) || {};
      rec.cells = { ...(rec.cells || {}), ...Object.fromEntries(list.map(c => [c, true])) };
      rec.minutes = (rec.minutes || 0) + minutesIn();
      if (light) rec.light = true;
      rec.updated = new Date().toISOString();
      await ctx.kv.set(key, rec);
    } catch (err) { console.warn('lesson: day record:', (err && err.message) || err); }
  }

  function lineBlock(l, cls = 'lesson-line') {
    if (!l) return null;
    ctx.lines.markSeen(l.id);
    const zh = l.zh ? h('p', { className: 'lesson-zh', lang: 'zh-CN', text: l.zh, hidden: !l.showZh }) : null;
    const more = l.showZh || !l.zh ? null : h('button', { type: 'button', className: 'text-btn lesson-zh-btn', text: '看中文',
      on: { click: ev => { zh.hidden = false; ev.currentTarget.remove(); (ctx.lines.tapZh || ctx.lines.markZhTapped || (() => {}))(l.id); } } });
    return h('div', { className: cls },
      h('p', { className: 'lesson-en', lang: 'en' }, l.en,
        h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say(l.en, ev.currentTarget) } }, icon('speak'))),
      zh, more);
  }

  // first week: one button question a day at the wrap (teacher-memory 7.2); from the second week one a week
  // (lines.weeklyQuestion, DESIGN 2.5 “这周哪集最好看”这类). Skipping is fine.
  function askBlock(dayN) {
    const answers = ctx.kv.peek(ASK_KEY, {}) || {};
    const today = dayOf(new Date());
    if (Object.values(answers).some(a => a && a.day === today)) return null;
    let q = null;
    try {
      if (dayN <= 5) q = ctx.lines.questionsForDay ? ctx.lines.questionsForDay(dayN) : null;
      else if (typeof ctx.lines.weeklyQuestion === 'function') q = ctx.lines.weeklyQuestion({ asked: answers, dayN, now: new Date(), features: featuresOn(), words: todayWords() });
    } catch (err) { q = null; }
    if (!q || answers[q.id] || !Array.isArray(q.options) || !q.options.length) return null;
    const box = h('section', { className: 'lesson-ask', 'aria-label': '老师问你' });
    const showZh = ctx.lines.shouldShowZh ? ctx.lines.shouldShowZh(q.id) : true;
    async function answer(opt) {
      const rec = (await ctx.kv.get(ASK_KEY, {})) || {};
      rec[q.id] = { answer: opt ? opt.id : null, skipped: !opt, at: new Date().toISOString(), day: today, n: dayN, who: 'emma' };
      ctx.kv.set(ASK_KEY, rec).catch(err => console.warn('lesson: ask:', (err && err.message) || err));
      // lines.answerEvent adds the option's about tag (teacher-memory 7.2)
      const ev = ctx.lines.answerEvent ? ctx.lines.answerEvent(q, opt ? opt.id : 'skip', { step: 'wrap' })
        : { type: 'ask', step: 'wrap', qid: q.id, who: 'emma', answer: opt ? opt.id : null };
      log({ ...ev, skipped: !opt || undefined });
      box.replaceChildren(h('p', { className: 'lesson-asked', text: opt ? '老师记下了。' : '好，下次再说。' }));
    }
    box.append(
      lineBlock({ id: q.id, en: q.en, zh: q.zh, showZh }, 'lesson-line lesson-q'),
      h('div', { className: 'lesson-opts', role: 'group', 'aria-label': '选一个' }, q.options.map(o =>
        h('button', { type: 'button', className: 'lesson-opt', on: { click: () => answer(o) } },
          h('b', { lang: 'en', text: o.en || o.zh || o.id }), o.en && o.zh ? h('span', { lang: 'zh-CN', text: o.zh }) : null))),
      h('button', { type: 'button', className: 'text-btn lesson-skip', text: (q.skip && q.skip.zh) || '跳过', on: { click: () => answer(null) } }));
    return box;
  }

  // what is switched on today, for questions that need a feature (lines.js FEATURES)
  function featuresOn() {
    const f = ['dictation'];
    if (listenModeOf(mods)) f.push('listen');
    if (spellModeOf(mods)) f.push('tiles');
    if (mods.grammar || mods.grammarUI) f.push('grammar');
    return f;
  }
  // this lesson's words, for a question whose buttons are her words ({ slug, w, cn })
  // the words a “这周” button question offers (lines.js options_from): the hard one from what she missed or was least
  // sure of today, the good one from what she got right first time
  function todayWords() {
    const item = slug => { const e = ctx.words.get(slug); return e ? { slug, w: e.headword || slug, cn: Choice.meaningOf(e) || '' } : null; };
    const all = new Map([...results, ...spelled]);
    const hard = [...all].sort((a, b) => (a[1].first ? 1 : 0) - (b[1].first ? 1 : 0) || (a[1].p ?? 0.5) - (b[1].p ?? 0.5)).map(([s]) => item(s)).filter(Boolean).slice(0, 3);
    const good = [...all].filter(([, r]) => r.first).map(([s]) => item(s)).filter(Boolean).slice(0, 3);
    return { hard_word: hard, good_word: good };
  }

  // 读一段 today: the sentence she needed the whole Chinese for (看不懂 three times) can go straight to 问老师, so the
  // teacher explains why it is said that way (the lesson is over by then, nothing is cut short)
  function askAboutReading() {
    const R = mods.story;
    if (!readRes || !readRes.done || !R || typeof R.readProgress !== 'function') return null;
    try {
      const named = (R.contentWith && R.contentWith(ctx.kv.peek(R.NAMES_KEY || 'story:names', null))) || R.content();
      const ep = named && named.episode(readRes.episodeId);
      const rec = R.readProgress(ctx.kv).episodes[readRes.episodeId];
      if (!ep || !rec) return null;
      const hard = Object.entries(rec.helps || {}).map(([i, lv]) => ({ s: ep.sentences[Number(i) - 1], lv: Number(lv) || 0 }))
        .filter(x => x.s && x.lv >= (R.HELP_MAX || 3)).sort((a, b) => a.s.i - b.s.i)[0];
      if (!hard) return null;
      const q = `故事里这句我看了中文才懂：“${hard.s.en}” 为什么这样说？`;
      // the teacher gets what the App already showed her (its Chinese), the sentence before and who says it, so its
      // translation matches the App's and she, it are the right ones (the names are the ones she picked)
      const s = hard.s;
      const prev = ep.sentences[s.i - 2];
      const nameOf = key => ((named.names || []).find(n => n.key === key) || {}).name || '';
      const hero = nameOf('hero'), cat = nameOf('cat');
      const bits = [s.zh ? `App 的中文：${s.zh.replace(/[。！？!?.]+$/, '')}` : '', prev ? `前一句：“${prev.en}”` : '', s.speaker ? `${s.speaker} 说的` : '旁白',
        hero && cat ? `主角是 ${hero}，她的小猫叫 ${cat}，故事里的 she 常指小猫` : ''].filter(Boolean);
      const full = `故事里这句我看了中文才懂：“${s.en}”（${bits.join('；')}）。为什么这样说？`;
      return h('section', { className: 'lesson-ask lesson-readask', 'aria-label': '读的时候卡住的一句' },
        h('p', { className: 'small', text: '读的时候，这一句看了中文才懂：' }),
        h('p', { className: 'lesson-en', lang: 'en', text: s.en }),
        h('button', { type: 'button', className: 'text-btn accent', text: '问老师这句为什么这样说', on: { click: () => ctx.go('chat', { ask: q, send: full }) } }));
    } catch (err) { return null; }
  }

  function tally(hw) {
    const firstOf = m => [...m].filter(([, r]) => r.first);
    const byP = list => list.sort((a, b) => (a[1].p ?? 0.5) - (b[1].p ?? 0.5)).map(([s]) => hw(s));
    const wrote = firstOf(spelled);
    const knew = firstOf(results).filter(([s]) => !spelled.has(s) || !spelled.get(s).first);
    const missed = [...results].filter(([, r]) => !r.first).length + [...spelled].filter(([, r]) => !r.first).length;
    const out = [];
    if (wrote.length) {
      // DESIGN 2.2: the teacher names up to three words she wrote right today
      out.push(h('p', { className: 'lede' }, '今天写对了 ', h('span', { className: 'n', text: String(wrote.length) }), ' 个'));
      out.push(h('p', { className: 'lesson-words', lang: 'en', text: byP(wrote).slice(0, 3).join('  ·  ') }));
      if (knew.length) out.push(h('p', { className: 'small', text: `还认出了 ${knew.length} 个。` }));
    } else if (knew.length) {
      out.push(h('p', { className: 'lede' }, '今天认出了 ', h('span', { className: 'n', text: String(knew.length) }), ' 个'));
      out.push(h('p', { className: 'lesson-words', lang: 'en', text: byP(knew).slice(0, 3).join('  ·  ') }));
    } else {
      out.push(h('p', { className: 'lede', text: sprint ? '小卷做完了' : results.size || spelled.size ? `今天练了 ${results.size || spelled.size} 个词` : '今天的课上完了' }));
    }
    const gOnly = firstOf(gResults).filter(([k]) => !/^([otvf]|pos):/.test(k)).length;
    if (gOnly) out.push(h('p', { className: 'small', text: `语法题做对了 ${gOnly} 道。` }));
    if (posRight) out.push(h('p', { className: 'small', text: `认对了 ${posRight} 个词的词性。` }));
    if (orderRight) out.push(h('p', { className: 'small', text: `自己排对了 ${orderRight} 个句子。` }));
    if (transformRight) out.push(h('p', { className: 'small', text: `自己转对了 ${transformRight} 个句子。` }));
    if (verbRight) out.push(h('p', { className: 'small', text: `一下就找到了 ${verbRight} 句话的动词。` }));
    if (formsRight) out.push(h('p', { className: 'small', text: `一下就配对了 ${formsRight} 对变形词。` }));
    if (readRes && readRes.done && readRes.daily) out.push(h('p', { className: 'small', text: '读完了今天的阅读。' }));
    else if (readRes && readRes.done && readRes.passage) out.push(h('p', { className: 'small', text: '做完了一篇期中阅读。' }));
    else if (readRes && readRes.done) {
      const n = readRes.n || ((cellOf('read') || {}).n);
      const got = Array.isArray(readRes.passedWords) ? readRes.passedWords : [];
      out.push(h('p', { className: 'small', text: `读完了第 ${n} 集。` + (got.length ? `故事里的 ${got.slice(0, 3).join('、')} 都认出来了。` : '') }));
    }
    if (readAloudN) out.push(h('p', { className: 'small', text: `读出声了 ${readAloudN} 句。` }));
    if (missed) out.push(h('p', { className: 'small', text: '没做对的几个，明天热身再见。' }));
    else if (plan && plan.first && knew.length) out.push(h('p', { className: 'small', text: '明天接着来。' }));
    return out;
  }

  function wrap() {
    if (session) { session.end(); session = null; }
    stopReading();
    gQueue = [];
    oQueue = [];
    sQueue = [];
    vQueue = [];
    fQueue = [];
    wq = null;
    cur = null;
    view = null;
    step = 'wrap';
    wrapped = true;
    clearTimeout(enoughTimer);
    stepsDone = [...new Set([...stepsDone, 'wrap'])];
    const now = new Date();
    // which day of using it: counted before today's record lands
    const dayN = dayNumber(lessonDays(ctx.kv), now);
    markDay(stepsDone).then(() => { /* 今天 redraws from kv when she goes back */ });
    const endEv = { type: 'session_end', step: 'wrap', kind, min: minutesIn(), steps_done: stepsDone, completed: true };
    log(endEv);
    settle(endEv);
    hold(false);
    const hw = s => ((ctx.words.get(s) || {}).headword || s);
    const pp = praisePick(results, spelled);
    const praise = pp ? praiseLine(hw(pp.slug), pp, dayN) : null;
    const lineCtx = { name: name(), day: dayN, hour: now.getHours(), exam: exam.phase || undefined };
    const scene = closeScene(exam);
    const eveLine = scene !== 'close' ? pickLine(scene, lineCtx) : null;
    // 0.8.0 “老师说 + 学一点” (lines.js talk) instead of the plain goodbye; the eve line stays as it is
    let talkT = null;
    if (!eveLine) { try { talkT = ctx.lines.talk ? ctx.lines.talk(scene, talkCtx(ctx, now)) : null; } catch (err) { talkT = null; } }
    if (talkT) { try { const r = ctx.events.log(ctx.lines.talkEvent(talkT, 'show', { step: 'wrap' })); if (r && r.catch) r.catch(() => {}); } catch (err) { /* fine */ } }
    const close = eveLine || talkT || pickLine('close', lineCtx);
    // the night before the exam (DESIGN 2.2): plan.js gives the wrap cell its line; the exam date says so too.
    // The teacher's eve line already says it (with its Chinese), so then it is not said twice.
    const wc = cellOf('wrap');
    const sleep = eveLine ? '' : (wc && wc.line) || plan.closing || (exam.eve ? '今天早点睡。' : '');
    // 我问过的 (teacher.js): settle today's answers against what 问老师 explained; a point she got wrong again gets a line
    const retellSlot = h('div', { className: 'lesson-retell-slot' });
    const T = mods.teacher;
    if (T && typeof T.syncAsked === 'function') {
      Promise.resolve(T.syncAsked(ctx)).then(() => {
        if (step !== 'wrap' || !retellSlot.isConnected) return;
        const e = typeof T.retellOffer === 'function' ? T.retellOffer(T.readAsked(ctx.kv), new Date()) : null;
        if (!e) return;
        retellSlot.replaceChildren(h('section', { className: 'lesson-ask lesson-readask', 'aria-label': '换个讲法' },
          h('p', { className: 'small', text: `上次讲的 ${e.label}，老师想换个讲法再说一遍。` }),
          h('button', { type: 'button', className: 'text-btn accent', text: '去听听', on: { click: () => ctx.go('chat', { retell: e.key }) } })));
      }).catch(err => console.warn('lesson: asked:', (err && err.message) || err));
    }
    stage.replaceChildren(header(LABELS.wrap), cellStrip('wrap'), ...[fbBox()].filter(Boolean),
      h('section', { className: 'lesson-wrap' },
        lineBlock(praise),
        h('div', { className: 'lesson-tally' }, tally(hw)),
        askAboutReading(),
        retellSlot,
        askBlock(dayN),
        weekendBlock(),
        lineBlock(close, 'lesson-line lesson-bye'),
        talkT ? learnBlock(ctx, talkT, { step: 'wrap', cls: 'lesson-learn' }) : null,
        sleep ? h('p', { className: 'lesson-sleep', text: sleep }) : null,
        shareRow(h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => ctx.go('home') } })),
        practiceSlot()));
  }

  // 0.9.4 分享给妈妈 next to 回到今天: share.js (loaded only here) makes the button; no module, or it throws, no button
  function shareRow(back) {
    const row = h('div', { className: 'btn-row lesson-wrap-go' }, back);
    const my = token;
    let p = null;
    try { p = import('./share.js'); } catch (err) { return row; }
    Promise.resolve(p).then(M => {
      const make = fnOf(M, 'shareButton');
      if (!make || my !== token || step !== 'wrap') return null;
      return make(ctx, { scope: 'today' });
    }).then(el => {
      if (el && el.nodeType === 1 && my === token && step === 'wrap' && row.isConnected) row.append(el);
    }).catch(err => console.warn('lesson: share:', (err && err.message) || err));
    return row;
  }

  // 0.8.0 接着练 (ui-practice.js) under the wrap: the teacher's next pick and the entries she can tap any time
  function practiceSlot() {
    const P = ctx.practice;
    if (!P || typeof P.mount !== 'function') return null;
    const slot = h('div', { className: 'lesson-practice' });
    try { P.mount(slot); } catch (err) { console.warn('lesson: practice:', (err && err.message) || err); return null; }
    return slot;
  }

  // 0.8.0 周末课 (weekend.js): 本周 10 词纸上写 (the paper dictation with this week's words) and 下周想练什么, once a week
  function weekendBlock() {
    const WK = mods.weekend;
    if (!WK || !weekendFull) return null;
    const now = new Date();
    const rec = WK.readWeekend(ctx.kv, now);
    const parts = [];
    if (!rec.paper) {
      const paperSlot = h('div', { className: 'lesson-weekend-paper' });
      parts.push(paperSlot);
      const since = new Date(now.getTime() - 7 * 864e5);
      Promise.resolve(ctx.events.query({ since, type: ['answer', 'review', 'spell', 'dictation'], limit: 20000 })).then(list => {
        const slugs = WK.weekWords(list, s => ctx.words.get(s), now);
        if (slugs.length < 4 || !paperSlot.isConnected) return;
        const words = slugs.map(slug => { const e = ctx.words.get(slug) || {}; return { slug, w: e.headword || slug, cn: (e.brief_cn || e.cn || '') }; });
        paperSlot.replaceChildren(h('p', { className: 'small', text: `周末把这周的 ${words.length} 个词在纸上写一遍：老师读中文，你写英文，写完自己打勾。` }),
          h('button', { type: 'button', className: 'text-btn accent', text: '本周 10 词纸上写', on: { click: () => { WK.mark(ctx.kv, 'paper').catch(() => {}); ctx.go('dictation', { week: true, words }); } } }));
      }).catch(() => {});
    }
    if (!rec.wish) {
      const note = h('p', { className: 'small' });
      const row = h('div', { className: 'lesson-opts', role: 'group', 'aria-label': '选一个' }, WK.WISH_OPTIONS.map(o => h('button', { type: 'button', className: 'lesson-opt', text: o.zh, on: { click: ev => {
        for (const b of row.children) b.disabled = true;
        ev.currentTarget.classList.add('on');
        WK.mark(ctx.kv, 'wish', o.id).catch(() => {});
        log({ ...WK.wishEvent(o.id), sid });
        note.textContent = '记下了，下周老师多排一点。';
      } } })));
      parts.push(h('section', { className: 'lesson-ask', 'aria-label': '下周想练什么' }, h('p', { className: 'small', text: '下周想多练什么？' }), row, note));
    }
    return parts.length ? h('div', { className: 'lesson-weekend' }, ...parts) : null;
  }

  // ---------------------------------------------------------------- leaving

  const afterItem = () => (step === 'write' && wq ? wq.done : session ? session.done : results.size + gResults.size);
  const live = () => step === 'warmup' || step === 'read' || step === 'write';

  function quit() {
    stopReading();
    if (live()) {
      log({ type: 'exit', step, after_item: afterItem(), wrong_streak: wrongStreak });
      const endEv = { type: 'session_end', kind, min: minutesIn(), steps_done: stepsDone, completed: false };
      log(endEv);
      settle(endEv);
      if (session) { session.end(); session = null; }
      clearTimeout(enoughTimer);
      if (results.size || spelled.size || gResults.size || stepsDone.length) markDay(stepsDone.filter(x => x !== 'wrap'));
    }
    token++;
    step = null;
    gQueue = [];
    oQueue = [];
    sQueue = [];
    vQueue = [];
    fQueue = [];
    wq = null;
    cur = null;
    view = null;
    hold(false);
    ctx.go('home');
  }

  // away from the app 60 seconds or more counts as leaving (teacher-memory 2.1); the lesson stays where it was
  document.addEventListener('visibilitychange', () => {
    if (!live()) return;
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= 60000) log({ type: 'exit', step, after_item: afterItem(), wrong_streak: wrongStreak, away_s: Math.round((Date.now() - hiddenAt) / 1000) });
    hiddenAt = 0;
  });
  // keyboard for desktop testing (1-4 picks an option or rates a flashcard)
  document.addEventListener('keydown', ev => {
    if (!live() || !view || !view.onKey || ctx.currentRoute() !== 'lesson') return;
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    view.onKey(ev);
  });

  return {
    show(params = {}) {
      if (session) { session.end(); session = null; }
      stopReading();
      hold(false);
      step = null;
      start(params).catch(err => {
        console.warn('lesson: start:', (err && err.message) || err);
        hold(false);
        toast('这节课没打开，回到今天再试一次。');
      });
    },
    inSession: () => running && step !== 'wrap',
    // leaving the lesson page (app.js showRoute): the story's voice stops
    hide() { if (reading && typeof reading.stop === 'function') { try { reading.stop(); } catch (err) { /* ignore */ } } },
    onChange() {},
  };
}
