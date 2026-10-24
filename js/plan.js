// 今天的课（DESIGN 2.0-2.3、5.1、6.4）：每天四格，热身 → 读一段 → 写几个词 → 收尾。决定热身出哪些卡（按优先级、
// 张数封顶）、每张卡出什么题型、今天开几个新词、“写几个词”做什么、轻松版、21:00 以后只推轻松版、首页那句“今天先练……因为……”。
// 负责：今天的课 agent（plan.js、sprint.js）。
// 状态：v0 规则已做完：容量封顶、四档优先级、课本词每天约 15 个混进热身、超了先减新词再顺延最后一档、
// 第一节课、轻松版（自己选 / 21:00 以后 / 有听写的晚上 / 漏了一天回来 / 考试前一天）、周末 30 张、reason。
// v1（期中季，sprint.js）：离考试 14 天以内自动进期中季，重点词（kv 'outline'，没有就用 Unit 3 必会词）排最前、
// 有空位时提前拿来复习、打开“写得出”线，每天拼约 10 个；热身按卡换题型（四选一、听音选词、字母块拼写）并混 1-2 道语法题；
// “写几个词”开放，按星期轮换拼写 2-3 个词、语法卡、语音小卡；考前第 3、2 天各一份小卷；考前一天轻松版，收尾“今天早点睡。”；
// 时长守住：上学日约 13 分钟以内（超了先把字母块换回四选一，再减语法题）。
// 护栏（teacher-memory 6.3）写死在这里，模型碰不到。孩子端不放倒计时、不放“x / 总数”（season.daysLeft 只给家长区）。
//
// 纯函数，不碰 DOM、不读数据库，Node 里直接测。app.js / ui-home.js 拼好 state 再调用。
//
// planToday(state, now = new Date()) -> Plan
//   state = {
//     words: [{ slug, headword, unit, tier, due, isNew, reps, lapses, write, scope, r?, last?, order?, source? }],
//         unit   课本单元 id 或 null（curriculum.unitOf）
//         tier   'primary' | 'required' | 'recognize' | 'extra'（curriculum.tierOf）
//         due    FSRS 下次到期时间 ISO，没卡为 null
//         isNew  还没学过的新卡
//         reps / lapses   FSRS 的复习次数 / 忘记次数
//         write  “写得出”线开着没有（听写写错的词由 dictation.js 打开）
//         scope  在期中范围或当前单元里
//         r      可选：FSRS 记得概率（wordsForPlan 第三个参数给了 now 才有），用来排“最有把握的”和顺延
//         last   可选：上次复习时间 ISO。今天已经复习过的卡不再进热身（见下“今天已复习”）
//         order  可选：在单元里的顺序（课本导入写的）
//     newPerDay,          每天新词上限（settings.newPerDay），护栏封顶 4
//     newDoneToday,       今天已经开过几个新词（words.newDoneToday()）
//     introDoneToday?,    今天已经混进热身的课本词个数；不给就用 newDoneToday
//     textbookPerDay?,    课本词每天混进热身几个，默认 15
//     doneToday: { warmup?, read?, write?, wrap? }   今天哪几格做完了（kv 'day:<YYYY-MM-DD>'.cells）
//     light,              她点了“轻松版”
//     standard?,          她在“回归日”明确点了标准版（只能推翻回归日的默认，推翻不了 21:00、听写夜、考前一天）
//     dictationTonight,   今晚有听写（kv 'dictation:<YYYY-MM-DD>' 存在：第一轮对完才写，所以存在就是写过了）
//     progress: { unit, examFrom, examTo, examDate }   家长区填的进度（kv 'progress'）；只填了日期时范围按 Starter 到 Unit 3
//     weekDays, weekGoal  这周做了几天 / 她定的目标
//     lessonDays?,        做完过课的日子 ['YYYY-MM-DD', ...]（kv 'day:' 里有格子做完的那些天）。
//                         给了且为空 = 第一节课；最后一天早于昨天 = 回归日；也用来算 weekDays
//     firstLesson?,       直接指定是不是第一节课（不给就看 lessonDays）
//     unitRanks?,         { unitId: order }（curriculum.units()），不给就按 'S' = 0、'U3' = 3 算
//     // v1 加的（都可以不给）
//     outline?,           kv 'outline'：复习提纲和听写本上的重点词（sprint.js outlineList 认的几种写法）
//     grammar?,           grammar.js 的 grammarState(kv)（语法卡进度），grammarWarmItems 要读它
//     grammarWarm? / grammarWarmItems?   热身语法题：数组，或 grammar.js 的 grammarWarmItems（plan 按 fn(state, now, { max }) 调）；
//                         给了就听它的（空的就不混）；没给或者出错用 sprint.js 的兜底题
//     grammarQuiz? / grammarQuizItems?   小卷的语法选择题（带选项的整题）；没给用兜底题
//     grammarCard?,       今天的语法卡：grammar.js todayCard 的 { cardId, part }，null 是今天没有卡（轮到语法卡的日子换别的）；
//                         不给（undefined）按期中季的日子推一个
//     phonicsCard?,       今天的语音小卡（不给就是 null，界面自己挑本周那张）
//     spelledOk?,         最近已经写对的词 [slug]，“写几个词”不再挑它们
//     spellMode?,         小卷拼写用 'tiles'（默认）或 'keys' / 'paper'
//     noGrammar? / noPhonics?   语法卡 / 语音小卡还没有，轮换时跳过
//     busyDay?,           家长问卷说今天作业多（intake.js isBusyDay）：默认轻松版，lightReason 'busy'；排在回归日后面、
//                         自己选的前面，state.standard 能改回标准版，推翻不了 21:00、考前一天、听写夜
//     boost?,             家长说的最近错词 [slug]（intake.js review.slugs，只有课本词）：同一档里排到前面，不跨档、不超封顶
//     gains? / history?   这周的增量（sprint.weeklyGains 的结果），或事件数组（拿来现算）
//     // 也认任务稿里的写法：{ entries, curriculum, settings, history, now }：entries 自动过 wordsForPlan，
//     // settings.newPerDay 当 newPerDay，history 是事件数组（session_end）或 { lessonDays }，now 覆盖第二个参数
//   }
//
//   Plan = {
//     date: 'YYYY-MM-DD',
//     light: bool,                       这次是不是轻松版
//     minutes: number,                   今天约几分钟（首页“今天约 12 分钟”）
//     lightMinutes: number,              轻松版约几分钟（首页“轻松版 8 分钟”）；第一节课为 0（不给轻松版）
//     cells: [Cell × 4],                 顺序固定：warmup、read、write、wrap
//     why: string,                       首页一句中文：“今天先练 Unit 2 的必会词，因为它们是期中重点。”
//     summary: string,                   首页一句中文：“先热身 15 张，再拼 3 个词，最后收尾。”
//     counts: { due, fresh, total, reviews, intro, newWords, deferred, cutNew, grammar, spell, pulled }
//         due 今天到期的复习卡（不含新卡）；fresh 选进来的新卡（课本词 + 新词）；total 热身张数（单词卡，不含语法题）；
//         reviews / intro / newWords 选进来的复习卡 / 课本词 / 新词；deferred 顺延到以后的复习卡；cutNew 因为封顶没放的新卡；
//         grammar 热身里的语法题数；spell 今天要拼的词（热身字母块 + 写几个词）；pulled 期中季提前拿来复习的重点词
//     kind: 'standard' | 'easy' | 'weekend',   给 events 'session_start'.kind（小卷日还是 standard，ui-lesson 自己记 'sprint'）
//     lightReason: '' | 'late' | 'exam' | 'dictation' | 'comeback' | 'busy' | 'chosen'
//     first: bool, weekend: bool, dictation: bool（= dictationTonight）, comeback: bool, cap: number, allDone: bool,
//     week: { days, goal },
//     slots / easy / reason              cells / light / why 的别名（任务稿里的名字）
//     // v1 加的
//     examSeason: bool                   期中季开着（考前 1-14 天）
//     season: Sprint                     sprint.js sprintOf：{ on, phase, label（“期中季 · Starter 到 Unit 3”）, from, to, date,
//                                        daysLeft（只给家长区）, keys, keySource, spellPerDay }
//     quiz: Quiz | null, quizDay: bool   考前小卷（sprint.js buildQuiz）；小卷日 sprint 是 quiz 的别名（ui-lesson 看它开小卷）
//     closing: '' | '今天早点睡。'       考前一天收尾的一句
//     gains: null | weeklyGains(...)     这周的增量（state 给了 gains 或事件数组 history 才有）
//   }
//   Cell = { id: 'warmup' | 'read' | 'write' | 'wrap', label, status, minutes, items: [slug], mode?, note? }
//     status：'ready' 可以做 | 'done' 今天做完了 | 'soon' 还没上线（显示“下周开播”，不占时间） | 'skip' 今天不做（note 说为什么）
//     warmup：mode 'mc4'（主要题型）；items 只放单词 slug（老代码照旧能用）；另加
//         cards: [{ type: 'word', slug, mode: 'mc4' | 'listen' | 'tiles' } | { type: 'grammar', id, item, point, mode: 'grammar' }]
//                按出题顺序，第一张是最有把握的词，语法题不放第一张，字母块和别的题型交错
//         modes: { slug: mode }，grammar: [GrammarItem]（sprint.js；小卷日是小卷的 5 道语法题）
//     read：v1 还是 'soon'“下周开播”
//     write：ready 时 mode 'spell'（items 是 2-3 个要拼的词；小卷日是小卷的 10 个词，另带 quiz）| 'grammar'（card: { id, part, from }）
//         | 'phonics'（card: state.phonicsCard 或 null，week: 本周一）；skip 时 mode 'paper'，note '明天开始' / '轻松版不做' / '今天不做'
//     wrap：考前一天多一个 line: '今天早点睡。'
//
// 出卡规则（DESIGN 5.1）
//   1. 封顶：上学日 20 张，周末 30 张，轻松版 12 张，第一节课 15 张，小卷日 5 张。
//   2. 优先级：第 0 档 期中范围或当前单元的必会词（期中季重点词最前，再是“写得出”线开着的）→ 第 1 档 已学单元的必会词 →
//      第 2 档 认读词 → 第 3 档 小学地基词 → 第 4 档 其余（她自己收藏的课外词）。同档里先出快忘的（r 小 / 到期早）。
//   3. 课本词（新卡、有单元、不在以后的单元）每天约 15 个混进热身，算在封顶里；她自己收藏的新词每天不超过 4 个。
//      超了先减新词：新词降到 2 个，课本词减到放得下，新词再降到 0；还超，复习卡从最后一档、最有把握的开始顺延。
//   4. 第一张放她最有把握的（r 最大），四选一。
//   5. 期中季（DESIGN 6.4）：还有空位时，最多 10 个还没到期、昨天今天都没复习过的重点词提前进来（快忘的先）。
//   6. 题型：新词和第一张四选一；“写得出”线开着的词（期中季是重点词）出字母块，期中季每天约 10 个
//      （拼写日热身 7 个 + 写几个词 3 个），平时 4 个，轻松版 2-3 个，考前一天 0 个；其余每三张有一张听音选词。
//   今天已复习：last 是今天的复习卡不再算到期（FSRS 新卡答对后约 10 分钟的短间隔不会让第二节课重出一遍，
//   CONTRACTS 11 的第一条）；做完的格子按 kv 'day:' 标 'done'。
//
// 轻松版（DESIGN 2.2、2.3，teacher-memory 6.3）
//   21:00 以后只推轻松版；有听写的晚上自动轻松版；考试前一天只推轻松版；漏了一天回来、家长说作业多的日子默认轻松版
//   （state.standard 为真可以改回标准版）；她自己点“轻松版”。轻松版不做“写几个词”。
//
// wordsForPlan(entries, curriculum, opts?) -> state.words   纯函数：词条（words.favorites()）加上课标信息，拼成上面的形状。
//   词条上已有的 unit / tier（课本导入时写进去的）优先，没有才问 curriculum。app.js 的 ctx.planState() 用它。
//   opts = { now } 时多给 r、last、order、source 四个字段（排“最有把握的”、今天已复习去重要用）。
//
// 依赖：fsrs.js（endOfDay、State、retrievability、daysBetween、localMidnight）、sprint.js（期中季、题型、写几个词、小卷）。
// dayOf / unitRank / unitName 定义在 sprint.js，这里原样转出（ui-home、ui-lesson、app.js 从这里拿）。

import { endOfDay, State, retrievability, daysBetween, localMidnight } from './fsrs.js';
import {
  dayOf, unitRank, unitName, sprintOf, assignModes, grammarWarm, writePlan, buildQuiz, weeklyGains,
  MODE_SECONDS, PULL_MAX, SPELL_PER_DAY, WRITE_SPELL, WRITE_ROTATION,
} from './sprint.js';

export { dayOf, unitRank, unitName };

export const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
export const CELL_LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾' };
export const CAPS = { schoolday: 20, light: 12, weekend: 30, first: 15, quiz: 5 };   // 热身卡数封顶（DESIGN 5.1、2.1）
export const LIMITS = { standard: 13, light: 8, withDictation: 20, enough: 25, weekend: 20 };   // 分钟（teacher-memory 6.3）
export const SECONDS_PER_CARD = 15;
export const WRAP_MINUTES = 1;
export const TEXTBOOK_PER_DAY = 15;     // 课本词每天混进热身几个（DESIGN 2.1）
export const MAX_NEW_PER_DAY = 4;       // 护栏：每天新词不超过 4 个
export const NEW_SQUEEZED = 2;          // 超了先把新词降到 2 个
export const LATE_HOUR = 21;
export const BANDS = ['scope', 'learned', 'recognize', 'primary', 'extra'];
export const TILES = { regular: 4, light: 2, lightSeason: 3 };   // 热身字母块张数上限（期中季标准课按 SPELL_PER_DAY 算）
export const GRAMMAR_WARM = { standard: 2, light: 1 };           // 热身混几道语法题（DESIGN 2.2）
export const EARLY_SLEEP = '今天早点睡。';

export const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

export function wordsForPlan(entries = [], curriculum = null, opts = null) {
  const c = curriculum || {};
  const now = opts && opts.now ? new Date(opts.now) : null;
  return entries.filter(e => e && e.slug && e.fsrs).map(e => {
    const w = {
      slug: e.slug,
      headword: e.headword,
      unit: e.unit || (c.unitOf ? c.unitOf(e.headword) : null),
      tier: e.tier || (c.tierOf ? c.tierOf(e.headword) : 'extra'),
      due: e.fsrs.due || null,
      isNew: e.fsrs.state === State.New,
      reps: e.fsrs.reps || 0,
      lapses: e.fsrs.lapses || 0,
      write: !!e.write,
      scope: !!e.scope,
    };
    if (now) {
      w.r = retrievability(e.fsrs, now);
      w.last = e.fsrs.last_review || null;
      w.order = Number.isFinite(e.order) ? e.order : null;
      w.source = e.source || null;
    }
    return w;
  });
}

// lesson days from task-style history: an events array (session_end) or { lessonDays }
function lessonDaysOf(history) {
  if (!history) return null;
  if (Array.isArray(history.lessonDays)) return history.lessonDays.slice();
  if (!Array.isArray(history)) return null;
  const days = new Set();
  for (const e of history) if (e && e.type === 'session_end' && e.completed !== false && e.at) days.add(String(e.at).slice(0, 10));
  return [...days].sort();
}

function mondayOf(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d);
}

const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
const isPhrase = w => /\s/.test(String(w.headword || w.slug || '').trim());
const len = w => String(w.headword || w.slug || '').length;
const secOf = m => MODE_SECONDS[m] || SECONDS_PER_CARD;
const minOf = s => (s > 0 ? Math.max(1, Math.round(s / 60)) : 0);

// after which word card each of k grammar questions goes: never first, spread through the round (same as ui-lesson)
function grammarSlots(n, k) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(n ? Math.max(1, Math.min(n, Math.round(((i + 1) * n) / (k + 1)))) : 0);
  return out;
}

export function planToday(state = {}, now = new Date()) {
  state = state || {};
  if (state.now) now = new Date(state.now);
  const today = dayOf(now);
  const settings = state.settings || {};
  const words = Array.isArray(state.words) ? state.words
    : Array.isArray(state.entries) ? wordsForPlan(state.entries, state.curriculum, { now }) : [];
  const done = state.doneToday || {};
  const progress = state.progress || {};
  const ranks = state.unitRanks || null;
  const rank = id => unitRank(id, ranks);

  // ---- which day is this
  const lessonDays = Array.isArray(state.lessonDays) ? state.lessonDays.slice().sort() : lessonDaysOf(state.history);
  const first = state.firstLesson === true || (state.firstLesson !== false && Array.isArray(lessonDays) && lessonDays.length === 0);
  const before = (lessonDays || []).filter(d => d < today);
  const lessonToday = (lessonDays || []).includes(today);
  const gap = before.length ? daysBetween(localMidnight(before[before.length - 1]), now) : 0;
  const comeback = !first && !lessonToday && gap >= 2;
  const weekend = isWeekend(now);
  const examGap = progress.examDate ? daysBetween(now, localMidnight(progress.examDate)) : null;
  const examEve = examGap === 1;
  const examSeason = examGap !== null && examGap >= 0;
  const dictation = !!state.dictationTonight;

  // ---- the midterm season (sprint.js, DESIGN 6.4): on 1-14 days before the exam, off again once it is over
  const sp = sprintOf({ ...state, words, progress, unitRanks: ranks }, now);
  const season = sp.on;
  const keys = new Set(season ? sp.keys : []);
  const isKey = w => keys.has(w.slug);

  // ---- light version: guardrails first, then the defaults she can undo
  const lightWhy = [];
  if (now.getHours() >= LATE_HOUR) lightWhy.push('late');
  if (examEve) lightWhy.push('exam');
  if (dictation) lightWhy.push('dictation');
  if (comeback && !state.standard) lightWhy.push('comeback');
  // the parent said this weekday is a heavy homework day (intake.js isBusyDay): light by default, she can undo it
  if (state.busyDay && !state.standard) lightWhy.push('busy');
  if (state.light) lightWhy.push('chosen');
  const light = lightWhy.length > 0;
  const lightReason = lightWhy[0] || '';
  const capFor = isLight => (isLight ? CAPS.light : weekend ? CAPS.weekend : CAPS.schoolday);
  const limitFor = isLight => (isLight ? LIMITS.light : weekend ? LIMITS.weekend : LIMITS.standard);

  // ---- sort words into reviews, textbook intros and her own new words
  const eod = endOfDay(now);
  const curRank = progress.unit ? rank(progress.unit) : Infinity;   // no progress set: every unit counts as learned
  const lo = season ? rank(sp.from) : progress.examFrom ? rank(progress.examFrom) : null;
  const hi = season ? rank(sp.to) : progress.examTo ? rank(progress.examTo) : null;
  const inScope = w => !!w.scope || (lo !== null && hi !== null && !!w.unit && rank(w.unit) >= lo && rank(w.unit) <= hi);
  const isCurrent = w => !!progress.unit && !!w.unit && w.unit === progress.unit;
  const future = w => !!w.unit && !inScope(w) && rank(w.unit) > curRank;
  const band = w => {
    if (isKey(w)) return 0;
    if (w.tier === 'required') return inScope(w) || isCurrent(w) ? 0 : 1;
    if (w.tier === 'recognize') return 2;
    if (w.tier === 'primary') return 3;
    return 4;
  };
  const sub = w => (isKey(w) ? 0 : w.write ? 1 : 2);        // inside the top band: key words, then the write line, then the rest
  // words the parent named as recent mistakes (intake.js review.slugs): first inside their own band, never across bands
  const boostSet = new Set(Array.isArray(state.boost) ? state.boost : []);
  const boosted = w => (boostSet.has(w.slug) ? 0 : 1);
  const dueNow = w => !w.due || new Date(w.due) <= eod;
  const reviewedToday = w => !!w.last && dayOf(new Date(w.last)) === today;
  const yesterday = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const recent = w => !!w.last && dayOf(new Date(w.last)) >= yesterday;
  const rOf = w => (Number.isFinite(w.r) ? w.r : null);
  const byForget = (a, b) => {
    const ra = rOf(a), rb = rOf(b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    return (a.due ? new Date(a.due) : 0) - (b.due ? new Date(b.due) : 0);
  };

  const reviews = words.filter(w => w && !w.isNew && w.due && new Date(w.due) <= eod && !reviewedToday(w))
    .sort((a, b) => band(a) - band(b) || (band(a) === 0 ? sub(a) - sub(b) : 0) || boosted(a) - boosted(b) || byForget(a, b));
  const ordOf = w => (Number.isFinite(w.order) ? w.order : 1e9);
  const intros = words.filter(w => w && w.isNew && w.unit && !future(w) && dueNow(w))
    .sort((a, b) => band(a) - band(b) || sub(a) - sub(b) || boosted(a) - boosted(b) || rank(a.unit) - rank(b.unit) || ordOf(a) - ordOf(b));
  const fresh = words.filter(w => w && w.isNew && !w.unit && dueNow(w))
    .sort((a, b) => (a.due ? new Date(a.due) : 0) - (b.due ? new Date(b.due) : 0));

  const newDone = Math.max(0, num(state.newDoneToday, 0));
  const introDone = Math.max(0, num(state.introDoneToday, newDone));
  const newPerDay = Math.min(MAX_NEW_PER_DAY, Math.max(0, num(state.newPerDay ?? settings.newPerDay, MAX_NEW_PER_DAY)));
  const introQuota = Math.max(0, num(state.textbookPerDay, TEXTBOOK_PER_DAY) - introDone);
  const freshQuota = Math.max(0, newPerDay - newDone);
  const introPool = intros.slice(0, introQuota);
  const freshPool = fresh.slice(0, freshQuota);

  // DESIGN 5.1 rule 3: new words go first (to 2, then 0), textbook words shrink to fit, then the last band is put off
  function squeeze(c, R, I0, F0) {
    const R0 = R.length;
    let I = I0.length, F = F0.length;
    if (R0 + I + F > c) F = Math.min(F, NEW_SQUEEZED);
    if (R0 + I + F > c) I = Math.max(0, c - R0 - F);
    if (R0 + I + F > c) { F = 0; I = Math.max(0, c - R0); }
    const n = Math.min(R0, c - I - F);
    return { R: R.slice(0, n), I: I0.slice(0, I), F: F0.slice(0, F) };
  }

  // DESIGN 6.4: the two quiz days (2-3 days before the exam) swap the standard lesson for a 10-15 minute quiz
  const quiz = !first && sp.phase === 'quiz' ? buildQuiz({ ...state, words, progress, unitRanks: ranks, plan: null }, now, { sprint: sp }) : null;

  function build(isLight) {
    const quizDay = !!quiz && !isLight;
    const c = first ? CAPS.first : quizDay ? CAPS.quiz : capFor(isLight);
    const inQuiz = quizDay ? new Set(quiz.items) : null;
    const keep = w => !inQuiz || !inQuiz.has(w.slug);
    const R = reviews.filter(keep), I = introPool.filter(keep), Fp = freshPool;
    let cards, pick = { R: [], I: [], F: [] }, pulled = [];
    if (first) {
      // DESIGN 2.1: only the 15 Starter words she is surest of, so the first lesson ends on right answers
      const unitWords = words.filter(w => w && w.unit);
      const minRank = unitWords.reduce((m, w) => Math.min(m, rank(w.unit)), Infinity);
      const starter = unitWords.filter(w => rank(w.unit) === minRank);
      const tierSure = { primary: 0, required: 1, recognize: 2, extra: 3 };
      starter.sort((a, b) => (rOf(b) ?? 0) - (rOf(a) ?? 0) || (tierSure[a.tier] ?? 3) - (tierSure[b.tier] ?? 3)
        || (isPhrase(a) ? 1 : 0) - (isPhrase(b) ? 1 : 0) || len(a) - len(b) || ordOf(a) - ordOf(b));
      cards = starter.slice(0, CAPS.first);
      if (!cards.length) { pick = squeeze(CAPS.first, R, I, Fp); cards = [...pick.R, ...pick.I, ...pick.F]; }
    } else {
      pick = squeeze(c, R, I, Fp);
      // DESIGN 6.4: key words come forward in the season, into whatever room is left
      const room = c - pick.R.length - pick.I.length - pick.F.length;
      if (season && !isLight && !quizDay && room > 0) {
        pulled = words.filter(w => w && isKey(w) && !w.isNew && w.due && new Date(w.due) > eod && !recent(w))
          .sort(byForget).slice(0, Math.min(room, PULL_MAX));
      }
      const all = [...pick.R, ...pulled, ...pick.I, ...pick.F];
      const order = new Map();
      all.forEach((w, i) => order.set(w, i));
      cards = all.slice().sort((a, b) => band(a) - band(b) || (a.isNew ? 1 : 0) - (b.isNew ? 1 : 0) || order.get(a) - order.get(b));
      // DESIGN 2.2: the first card is the one she is surest of
      const surest = [...pick.R, ...pulled].reduce((best, w) => {
        if (!best) return w;
        const sw = rOf(w) ?? (w.reps - 2 * w.lapses) / 100, sb = rOf(best) ?? (best.reps - 2 * best.lapses) / 100;
        return sw > sb ? w : best;
      }, null);
      if (surest) cards = [surest, ...cards.filter(w => w !== surest)];
    }

    // ---- what kind of card each one is (DESIGN 2.2, 5.1)
    const spellDay = !isLight && !first && !quizDay && WRITE_ROTATION[now.getDay()] === 'spell';
    const tilesMax = first || quizDay || examEve ? 0
      : isLight ? (season ? TILES.lightSeason : TILES.light)
      : season ? SPELL_PER_DAY - (spellDay ? WRITE_SPELL : 0) : TILES.regular;
    const eligible = w => (season ? isKey(w) || !!w.write : !!w.write);
    let am = assignModes(cards, { first, tilesMax, eligible });

    // ---- 写几个词
    const write = writePlan({ now, state, sprint: sp, words, warm: new Set(cards.map(w => w.slug)), light: isLight, first, quiz: quizDay ? quiz : null, isKey });
    // a spelling day with nothing left to spell there (every key word is already in the warm-up): the warm-up spells them all
    if (season && spellDay && write.mode !== 'spell') am = assignModes(cards, { first, tilesMax: SPELL_PER_DAY, eligible });
    cards = am.cards;
    const modes = am.modes;

    // ---- grammar in the warm-up: 1-2 a day; the quiz day brings its 5
    const gN = first || examEve || quizDay || !cards.length ? 0 : isLight ? GRAMMAR_WARM.light : GRAMMAR_WARM.standard;
    let grammar = quizDay ? (quiz.grammar || []).slice() : grammarWarm({ ...state, progress, unitRanks: ranks }, now, gN, sp);

    // ---- keep to time (DESIGN 2.3): tiles back to multiple choice first, then fewer grammar questions
    const limit = limitFor(isLight);
    const warmSec = () => modes.reduce((a, m) => a + secOf(m), 0) + grammar.length * secOf('grammar');
    const total = () => minOf(warmSec()) + (write.status === 'ready' ? write.minutes : 0) + WRAP_MINUTES;
    while (total() > limit && modes.includes('tiles')) modes[modes.lastIndexOf('tiles')] = 'mc4';
    while (total() > limit && grammar.length && !quizDay) grammar = grammar.slice(0, -1);

    const wcards = cards.map((w, i) => ({ type: 'word', slug: w.slug, mode: modes[i] }));
    const at = grammarSlots(cards.length, grammar.length);
    for (let i = grammar.length - 1; i >= 0; i--) {
      const g = grammar[i];
      wcards.splice(at[i], 0, { type: 'grammar', id: g.id || g.item, item: g.item || g.id, point: g.point || null, card: g.card || null, mode: 'grammar' });
    }
    return { cards, modes, grammar, wcards, write, pick, pulled, quizDay, R, I, Fp, warmMin: minOf(warmSec()) };
  }

  const m = build(light);
  const lb = first ? null : light ? m : build(true);
  const items = m.cards.map(w => w.slug);

  const cell = (id, status, minutes, list = [], extra = {}) =>
    ({ id, label: CELL_LABELS[id], status: done[id] && status !== 'soon' ? 'done' : status, minutes, items: list, ...extra });
  const w = m.write;
  const writeExtra = { mode: w.mode, note: w.note || '' };
  if (w.card !== undefined) writeExtra.card = w.card;
  if (w.week) writeExtra.week = w.week;
  if (w.quiz) writeExtra.quiz = w.quiz;
  const cells = [
    cell('warmup', items.length || m.grammar.length ? 'ready' : 'skip', m.warmMin, items, {
      mode: 'mc4',
      cards: m.wcards,
      modes: Object.fromEntries(m.cards.map((x, i) => [x.slug, m.modes[i]])),
      grammar: m.grammar,
    }),
    cell('read', 'soon', 0, [], { note: '下周开播' }),
    cell('write', w.status, w.minutes, w.items, writeExtra),
    cell('wrap', 'ready', WRAP_MINUTES, [], examEve ? { line: EARLY_SLEEP } : {}),
  ];
  const minutes = Math.min(limitFor(light), cells.filter(c => c.status === 'ready').reduce((a, c) => a + c.minutes, 0));
  const allDone = cells.every(c => c.status !== 'ready');
  const lightMinutes = !lb ? 0 : light ? minutes
    : Math.min(LIMITS.light, lb.cards.length ? lb.warmMin + (lb.write.status === 'ready' ? lb.write.minutes : 0) + WRAP_MINUTES : 0);

  // ---- the two sentences on the home page
  const why = reasonOf({ first, cards: m.cards, light, lightReason, gap, band, inScope, examSeason, rank, quizDay: m.quizDay, sp, isKey, write: cells[2] });
  const summary = summaryOf({ first, n: items.length, dictation, cards: m.cards, rank, quizDay: m.quizDay, write: cells[2] });

  const weekDays = num(state.weekDays, 0) > 0 ? num(state.weekDays, 0)
    : (lessonDays || []).filter(d => d >= mondayOf(now) && d <= today).length;
  const newIn = m.cards.filter(x => x.isNew).length;
  const gains = state.gains || (Array.isArray(state.history) ? weeklyGains(state.history, now) : null);
  const spellN = m.modes.filter(x => x === 'tiles').length + (w.status === 'ready' && w.mode === 'spell' ? w.items.length : 0);
  return {
    date: today,
    light,
    minutes,
    lightMinutes,
    cells,
    why,
    summary,
    counts: {
      due: reviews.length,
      fresh: newIn,
      total: items.length,
      reviews: items.length - newIn,
      intro: first ? newIn : m.pick.I.length,
      newWords: first ? 0 : m.pick.F.length,
      deferred: first ? reviews.length : m.R.length - m.pick.R.length,
      cutNew: first ? 0 : m.I.length + m.Fp.length - m.pick.I.length - m.pick.F.length,
      grammar: m.grammar.length,
      spell: spellN,
      pulled: m.pulled.length,
    },
    kind: light ? 'easy' : weekend ? 'weekend' : 'standard',
    lightReason,
    first,
    weekend,
    dictation,
    dictationTonight: dictation,
    comeback,
    cap: first ? CAPS.first : m.quizDay ? CAPS.quiz : capFor(light),
    allDone,
    week: { days: weekDays, goal: num(state.weekGoal, 0) },
    slots: cells,
    easy: light,
    reason: why,
    examSeason: season,
    season: sp,
    quiz: m.quizDay ? quiz : null,
    quizDay: m.quizDay,
    ...(m.quizDay ? { sprint: quiz } : {}),
    closing: examEve ? EARLY_SLEEP : '',
    gains,
  };
}

const LIGHT_WHY = {
  late: '今天先练轻松版，因为已经很晚了，早点睡。',
  exam: '今天先练轻松版，因为明天考试，今天早点睡。',
  dictation: '今天先练轻松版，因为今晚还有听写。',
  busy: '今天先练轻松版，因为今天作业多，练一点也算一天。',
  chosen: '今天先练轻松版，因为作业多的日子，练一点也算一天。',
};

const WRITE_WHY = {
  spell: '今天先练拼几个词，因为写得出才算真会了。',
  grammar: '今天先练一张语法卡，因为语法每天练一点就好。',
  phonics: '今天先练一张语音小卡，因为会读了就更好拼。',
};

function unitsText(list, rank) {
  const ids = [...new Set(list.map(w => w.unit).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
  if (!ids.length) return '';
  if (ids.length === 1) return unitName(ids[0]);
  if (ids.length === 2) return `${unitName(ids[0])} 和 ${unitName(ids[1])}`;
  return `${unitName(ids[0])} 到 ${unitName(ids[ids.length - 1])}`;
}

function reasonOf({ first, cards, light, lightReason, gap, band, inScope, examSeason, rank, quizDay, sp, isKey, write }) {
  if (first) {
    const u = unitsText(cards, rank) || 'Starter';
    return cards.length ? `今天先练 ${u} 里你最有把握的 ${cards.length} 个词，因为第一节课从有把握的开始。` : '今天先认识一下老师，因为课本词还没导进来。';
  }
  if (light) {
    if (lightReason === 'comeback') return gap > 2 ? '今天先练轻松版，因为歇了几天，先找回手感。' : '今天先练轻松版，因为昨天歇了一天，先找回手感。';
    return LIGHT_WHY[lightReason] || LIGHT_WHY.chosen;
  }
  if (quizDay) return '今天先练一份小卷，因为期中前把重点词再写一遍。';
  if (!cards.length) {
    if (write && write.status === 'ready' && WRITE_WHY[write.mode]) return WRITE_WHY[write.mode];
    return '今天没有要复习的词，收个尾就好。';
  }
  const top = Math.min(...cards.map(band));
  const group = cards.filter(w => band(w) === top);
  const keyed = sp && sp.on ? group.filter(isKey) : [];
  if (top === 0 && keyed.length) {
    if (sp.keySource === 'outline') return '今天先练复习提纲上的重点词，因为它们是期中重点。';
    const ku = unitsText(keyed, rank);
    return `今天先练 ${ku ? ku + ' 的' : '期中范围的'}必会词，因为它们是期中重点。`;
  }
  const u = unitsText(group, rank);
  const of = (fallback) => (u ? `${u} 的` : fallback);
  switch (top) {
    case 0:
      return group.some(inScope) && examSeason
        ? `今天先练 ${of('期中范围的')}必会词，因为它们是期中重点。`
        : `今天先练 ${of('这个单元的')}必会词，因为这是正在学的单元。`;
    case 1:
      return `今天先练 ${of('学过单元的')}必会词，因为它们到了该复习的时候。`;
    case 2: return '今天先练课本里的认读词，因为它们只要认得，很快就能过一遍。';
    case 3: return '今天先练小学学过的词，因为它们是初中的地基。';
    default: return '今天先练你收藏的词，因为它们到了该复习的时候。';
  }
}

// what 写几个词 is today, as a few words in the home sentence
function writeBit(write) {
  if (!write || write.status !== 'ready') return '';
  if (write.mode === 'spell') return `拼 ${write.items.length} 个词`;
  if (write.mode === 'grammar') return '做一张语法卡';
  if (write.mode === 'phonics') return '看一张语音小卡';
  return '';
}

function summaryOf({ first, n, dictation, cards, rank, quizDay, write }) {
  // dictation: today's dictation is already written (its record lands after the first check), so the lesson is short
  const tail = dictation ? '今天写过听写，课短一点。' : '';
  if (!n) {
    const bit = writeBit(write);
    return (bit ? `今天没有要复习的词，${bit}就收尾。` : '今天没有要复习的词。') + tail;
  }
  if (first) return `先认 ${n} 个 ${unitsText(cards, rank) || 'Starter'} 里的词，再收尾。` + tail;
  if (quizDay) return `先热身 ${n} 张，再做一份小卷，最后收尾。` + tail;
  const bit = writeBit(write);
  return (bit ? `先热身 ${n} 张，再${bit}，最后收尾。` : `先热身 ${n} 张，再收尾。`) + tail;
}
