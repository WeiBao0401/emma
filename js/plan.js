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
//     // 0.4.0 加的（都可以不给）
//     readCell?,          reader.js readCell(kv, now) 的结果（今天读哪一集）：{ status, episodeId, n, of, title, titleZh, minutes,
//                         shortMinutes?, again, resume, note }。不给就还是“下周开播”。plan 再按今天定：第一节课、小卷日、考前一天、
//                         有听写的晚上不读；轻松版只读半集（short：2 道题，shortMinutes）
//     readTargets?,       这一集的目标词 [slug]（单词本里有的）：读之前在热身里见一面（DESIGN 5.6“读前见一面”），
//                         不在热身里的补进去（四选一），放不下就顺延最后一档的复习卡
//     orderItems?,        modes/order.js writeItems：连词成句那天“写几个词”的句子 id
//     orderWarm?,         modes/order.js warmItem：热身偶尔混的 1 句连词成句（id 数组，0-1 个）
//     gains? / history?   这周的增量（sprint.weeklyGains 的结果），或事件数组（拿来现算）
//     // 0.5.0 加的（都可以不给；第 3 批，design/teacher-next.md）
//     probeItems?,        screen.js probeItems：今天的地基探针（0-2 道，ProbeItem）。轻松版 1 道；第一节课、小卷日、考前一天不放
//     screenItems?,       screen.js screenItems：今天的 505 摸底（app.js 给到 15 个，plan 再截）。平时 12 个，期中季 6 个，她说“生词太多”
//                         或读的时候卡在词上的 15 个；轻松版、第一节课、小卷日、考前一天、考试当天不放
//     verbItems?,         modes/verb.js verbItems：找动词的句子 id（app.js 给 2 个，平时出 1 道，她说“句子看不懂”或卡在句子上出 2 道）；
//                         轻松版、第一节课、小卷日不放
//     askedWords?,        teacher.js askedReviewItems 里的单词（问老师讲过、今天该再考的，单词本里有的）：像读前见一面那样进热身，最多 2 个
//                         （轻松版 1 个）。语法点那一半由 app.js 并进 grammarWarm（排在最前）
//     transformItems?,    modes/order.js transformItems：句型转换那天“写几个词”的句子 id（sprint.js writePlan）
//     readTune?,          { hard: 'words' | 'sentences' | 'find' | 'ok' | '', main: 'word' | 'sentence' | 'method' | '' }：她最近自己说的
//                         “今天哪里最难”（两天以内）和读的求助分诊最多的一类（reader.js triageSummary），用来调上面两样的量
//     examPassages?, examReading?   sprint.js quizPassage：小卷里的期中阅读小篇
//     // 0.6.0 加的（都可以不给；第 4 批，design/teacher-next.md 4.3、5）
//     clozeReady?,        modes/cloze.js clozeReady：能出“句子里回想”的词 [slug]（必会词、找得到句子）。热身单词卡里挑 2 到 3 张
//                         （期中季 3 张，轻松版 1 张、期中季 2 张）换成 mode 'cloze'：不挑新词、第一张、读前见一面和问过的词；
//                         期中季先挑复习提纲重点词，别的日子先挑开了“写得出”线的、复习次数多的。第一节课、小卷日、考前一天不出
//     formsItem?,         modes/forms.js formsItems：今天这组变形配对 { kind: 'match' | 'mc4', items: [pair id] } | null。每天 1 组，
//                         放在找动词后面、连词成句前面；第一节课、小卷日、考前一天、轻松版不放
//     contrastItems?,     grammar.js contrastItems：她这几天犯得多的误解对应的对比小卡（ContrastItem），每天最多 1 张，放在语法题后面；
//                         第一节课、小卷日、考前一天、轻松版不放
//     picked?,            modes/cloze.js pickedSlugs：她自己点过、问过的词 [slug]（阅读里点开的、问老师里出现的课本词）。像 boost
//                         一样在同一档里排前面（家长说的错词在它前面），不跨档、不超封顶；没到期的也补进热身，最多 2 个（轻松版 1 个），
//                         今天复习过的、新词不补；第一节课、小卷日、考前一天不补
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
//     read：0.4.0 期中番外开放：ready 时 mode 'story'，episodeId、n、of、title、titleZh、short（轻松版只做 2 道题）、again、resume、note；
//         state.readCell 没给是 'soon'“下周开播”；第一节课、小卷日、考前一天、有听写的晚上是 'skip'（note 说为什么）
//     write：ready 时 mode 'spell'（items 是 2-3 个要拼的词；小卷日是小卷的 10 个词，另带 quiz）| 'grammar'（card: { id, part, from }）
//         | 'phonics'（card: state.phonicsCard 或 null，week: 本周一）| 'order'（连词成句，items 是句子 id，0.4.0）；
//         skip 时 mode 'paper'，note '明天开始' / '轻松版不做' / '今天不做'
//     warmup 另有 order: [句子 id]（热身偶尔混的连词成句，cards 里是 { type: 'order', id, item: 'o:<id>', mode: 'order' }，放在最后）、
//         preteach: [slug]（今天这一集的目标词，读前见一面）
//     wrap：考前一天多一个 line: '今天早点睡。'
//     0.5.0：warmup 另有 probe: [ProbeItem]、screen: [ScreenItem]、verb: [id]、asked: [slug]（热身里问老师讲过的词）；cards 里多
//         { type: 'probe', id, item, block, mode: 'grammar' }（和语法题一起铺开）、{ type: 'screen', id }（单词卡后面，整批一起）、
//         { type: 'verb', id, item: id, mode: 'verb' }（摸底后面）。read 格在小卷日放期中阅读小篇：status 'ready'、mode 'passage'、
//         passageId、note '期中阅读'。write 格多 mode 'transform'（句型转换，items 是 3 个句子 id）。
//         Plan 多 tune: [{ id: 'screen' | 'verb', why }]（这节课按她说的和读的求助多调了哪样，家长区看）
//     0.6.0：warmup 另有 cloze: [slug]（换成句子里回想的词）、forms: [{ kind, items }]（0-1 组）、contrast: [ContrastItem]（0-1 张）、
//         picked: [slug]（热身里她自己点过、问过的词）；cards 里单词卡多 mode 'cloze'，多
//         { type: 'contrast', id, item: 'gc:<id>', mode: 'contrast', title, tags }（和语法题、探针一起铺开，排在它们后面）、
//         { type: 'forms', id: 'forms', item: 'forms', mode: 'forms', kind, items }（找动词后面、连词成句前面）。
//         counts 多 cloze、forms、contrast、picked；spell 算上 cloze。语法题里 intro 为真的换个讲法题多算 40 秒（那一屏）
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
  dayOf, unitRank, unitName, sprintOf, assignModes, grammarWarm, writePlan, buildQuiz, weeklyGains, tileable,
  MODE_SECONDS, PULL_MAX, SPELL_PER_DAY, WRITE_SPELL, WRITE_ROTATION, writeEligible, WRITE_SHARE, POS_WARM,
} from './sprint.js';
import { todayMix } from './kid-me.js';
import { posItems } from './pos.js';

export { dayOf, unitRank, unitName };

export const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
export const CELL_LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾' };
export const CAPS = { schoolday: 20, light: 12, weekend: 30, first: 15, quiz: 5 };   // 热身卡数封顶（DESIGN 5.1、2.1）
export const LIMITS = { standard: 13, light: 8, withDictation: 20, enough: 25, weekend: 20, withRead: 15 };   // 分钟（teacher-memory 6.3；有故事的上学日约 13-15 分钟）
export const PRETEACH_MAX = 6;          // 读前见一面：最多补进几个目标词
export const WARM_MIN = 12;             // 有故事的日子，热身为了时长减卡，最少留几张
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
// 0.5.0 热身里的新东西（design/teacher-next.md 3.2、4.1、6.3，DESIGN 5.2）
export const PROBE_WARM = { standard: 2, light: 1 };
export const SCREEN_WARM = { standard: 12, season: 6, words: 15, tight: 6 };
export const VERB_WARM = { standard: 1, sentences: 2 };
export const ASKED_WORDS = { standard: 2, light: 1 };
// 0.6.0 热身里的新东西（design/teacher-next.md 4.3、5）
export const CLOZE_WARM = { standard: 2, season: 3, light: 1, lightSeason: 2 };
export const PICKED_WORDS = { standard: 2, light: 1 };
// 0.8.0: 学校听写打了叉的词（state.dictWarm，mistakes.js dictWarmSlugs）和“会写了”第 7、21 天复查（state.recheck，encounters.js）：
// 没到期也补进热身，一律拼写（字母块；spellMode 'keys' 给键盘；拼不了字母块的四选一），减卡时不减；第一节课不放，复查考前一天也不放
export const DICT_WARM_MAX = 6;
export const RECHECK_MAX = 3;
export const CONTRAST_WARM = 1;
// 0.9.0 (Wei 10-26: 会写、知道词性、巧记): a new word gets a 巧记 screen after its card in the lesson (ui-lesson showMemo)
export const MEMO_SECONDS = 10;
export const MEMO_NEW_MAX = 6;          // at most this many new words get their 巧记 screen in one lesson (wrong ones always do)
export const NEW_KEEP = 3;              // when time is short, textbook words still new wait for tomorrow, but this many stay
// what counts as writing the word in the warm-up (spelling tiles, the keyboard, 句子里回想)
const WRITTEN = new Set(['tiles', 'keys', 'cloze']);

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
  // words the parent named as recent mistakes (intake.js review.slugs): first inside their own band, never across bands;
  // 0.6.0: then the words she tapped or asked about herself (modes/cloze.js pickedSlugs), the same way
  const boostSet = new Set(Array.isArray(state.boost) ? state.boost : []);
  const pickedList = Array.isArray(state.picked) ? state.picked.filter(Boolean) : [];
  const pickedSet = new Set(pickedList);
  const boosted = w => (boostSet.has(w.slug) ? 0 : pickedSet.has(w.slug) ? 1 : 2);
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
  // 0.7.0 (kid-me.js): what she said about the difficulty (state.knobs) and what she wants to practise first today
  // (state.todayChoice). Both optional: without them nothing changes. Only numbers move, never the order or the time rules.
  const kn = state.knobs && typeof state.knobs === 'object' ? state.knobs : null;
  const kw = (kn && kn.warmup) || {}, kr = (kn && kn.read) || {}, kwr = (kn && kn.write) || {}, kg = (kn && kn.grammar) || {};
  const kNum = x => (Number.isFinite(x) ? x : 0);
  let newPerDay = Math.min(MAX_NEW_PER_DAY, Math.max(0, num(state.newPerDay ?? settings.newPerDay, MAX_NEW_PER_DAY)));
  if (kn && !first) newPerDay = Math.max(1, Math.min(MAX_NEW_PER_DAY + kNum(kw.newCapBonus), newPerDay + kNum(kw.newDelta)));
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

  const choice = !first && !quiz && !examEve && typeof state.todayChoice === 'string' && state.todayChoice ? state.todayChoice : '';
  const mix = choice ? todayMix(choice, { examSet: !!(progress.examDate || progress.examFrom) }) : null;
  const mixId = mix ? mix.id : 'plan';

  // ---- 读一段 (DESIGN 5.6): reader.js says which episode; today decides whether and how much
  const rc = state.readCell && typeof state.readCell === 'object' ? state.readCell : null;
  // the quiz day reads one 期中阅读小篇 instead of the episode (sprint.js quizPassage)
  const passageCell = ps => ({ mode: 'passage', items: [], status: 'ready', passageId: ps.id, minutes: Math.max(1, num(ps.minutes, 6)), note: ps.label || '期中阅读', short: false });
  function readFor(isLight, quizDay) {
    if (quizDay && quiz && quiz.passage) return passageCell(quiz.passage);
    const base = { mode: 'story', items: [] };
    if (!rc || rc.status === 'soon' || !rc.status) return { ...base, status: 'soon', minutes: 0, note: '下周开播' };
    const info = { episodeId: rc.episodeId, n: rc.n, of: rc.of, title: rc.title, titleZh: rc.titleZh, again: !!rc.again, resume: !!rc.resume };
    if (rc.status !== 'ready') return { ...base, ...info, status: rc.status, minutes: 0, note: rc.note || '' };
    const no = note => ({ ...base, ...info, status: 'skip', minutes: 0, note });
    if (first) return no('明天开始');
    if (quizDay && quiz && quiz.passage) return passageCell(quiz.passage);
    if (quizDay) return no('今天做小卷');
    if (examEve) return no('考完接着读');
    if (dictation) return no('今晚写过听写，明天读');
    // 0.7.0: 太难 reads the short version; 多读故事 the full one even on a light day, 多练单词 / 练语法 the short one
    const short = mixId === 'read' ? false : mixId === 'words' || mixId === 'grammar' || mixId === 'exam' ? true : !!isLight || !!kr.short;
    const full = Math.max(1, num(rc.minutes, 5));
    const challenge = Math.max(kNum(kr.challenge), mixId === 'read' ? 1 : 0);
    const minutes = short ? Math.max(1, Math.min(full, num(rc.shortMinutes, Math.ceil(full * 0.6)))) : Math.max(1, full + kNum(kr.minutesDelta));
    return { ...base, ...info, status: 'ready', minutes, short, note: rc.note || (rc.n ? `第 ${rc.n} 集` : ''),
      ...(challenge ? { challenge } : {}), ...(kr.autoTrunk ? { autoTrunk: true } : {}), ...(kr.selfFirst ? { selfFirst: true } : {}) };
  }
  const readTargets = new Set(Array.isArray(state.readTargets) ? state.readTargets : []);
  const askedWords = new Set(Array.isArray(state.askedWords) ? state.askedWords : []);
  const clozeOk = new Set(Array.isArray(state.clozeReady) ? state.clozeReady : []);
  const formsSpec = state.formsItem && typeof state.formsItem === 'object' && Array.isArray(state.formsItem.items) && state.formsItem.items.length
    ? { kind: state.formsItem.kind === 'mc4' ? 'mc4' : 'match', items: state.formsItem.items.slice() } : null;
  // what she said was hardest lately, and where reading got stuck most (reader.js triageSummary): more of the matching help
  const tune = state.readTune && typeof state.readTune === 'object' ? state.readTune : {};
  const tuneWords = tune.hard === 'words' || tune.main === 'word';
  const tuneSentences = tune.hard === 'sentences' || tune.main === 'sentence';
  const examDay = examGap === 0;

  function build(isLight) {
    const quizDay = !!quiz && !isLight;
    const read = readFor(isLight, quizDay);
    const c0 = first ? CAPS.first : quizDay ? CAPS.quiz : capFor(isLight);
    const capDelta = mix && !first && !quizDay ? kNum(mix.warmup.capDelta) : 0;
    const c = isLight && capDelta > 0 ? c0 : Math.max(mix && mix.warmup.minCards ? Math.min(c0, mix.warmup.minCards) : 1, c0 + capDelta);
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

    // ---- 读前见一面 (DESIGN 5.6): this episode's target words she has in her word book, seen once before the story.
    // Words already in the warm-up count; the others come in (room first, then in place of the last review cards).
    // words that must be in the warm-up (this episode's targets, words 问老师 explained): room first, then in place of the
    // last review cards (lowest band, surest), never the first card, a new word or another word that must be there
    const keepSet = new Set();
    const bring = (set, max, { order = null, skipNew = false } = {}) => {
      const inWarm = new Set(cards.map(w => w.slug));
      let cand = words.filter(w => w && set.has(w.slug) && !inWarm.has(w.slug) && !reviewedToday(w) && !future(w) && !(skipNew && w.isNew));
      if (order) { const at = new Map(order.map((x, i) => [x, i])); cand = cand.sort((a, b) => at.get(a.slug) - at.get(b.slug)); }
      const add = cand.slice(0, max);
      for (const w of cards) if (set.has(w.slug)) keepSet.add(w.slug);
      for (const w of add) keepSet.add(w.slug);
      if (!add.length) return;
      const out = add.length - Math.max(0, c - cards.length);
      let k = out;
      for (let i = cards.length - 1; i > 0 && k > 0; i--) if (!keepSet.has(cards[i].slug) && !cards[i].isNew) { cards.splice(i, 1); k--; }
      cards = [...cards, ...add.slice(0, Math.max(0, c - cards.length))];
    };
    let preteach = [];
    if (read.status === 'ready' && read.mode === 'story' && readTargets.size) {
      bring(readTargets, PRETEACH_MAX + kNum(kr.preteachDelta));
      preteach = cards.filter(w => readTargets.has(w.slug)).map(w => w.slug);
    }
    // 我问过的 (teacher.js): a word 问老师 explained comes back on day 2 and day 5
    const noExtras = first || quizDay || examEve;
    let asked = [];
    if (!noExtras && askedWords.size && cards.length) {
      bring(askedWords, isLight ? ASKED_WORDS.light : ASKED_WORDS.standard);
      asked = cards.filter(w => askedWords.has(w.slug)).map(w => w.slug);
    }
    // 0.6.0: the words she tapped or asked about herself come in even when not due (her own order: stuck most days first)
    if (!noExtras && pickedSet.size && cards.length) bring(pickedSet, isLight ? PICKED_WORDS.light : PICKED_WORDS.standard, { order: pickedList, skipNew: true });
    // 0.8.0: the school's dictation misses and the 会写 rechecks due today
    const dictList = Array.isArray(state.dictWarm) ? state.dictWarm.filter(Boolean) : [];
    const recheckList = Array.isArray(state.recheck) ? state.recheck.filter(Boolean) : [];
    if (!first && dictList.length && cards.length) bring(new Set(dictList), DICT_WARM_MAX, { order: dictList, skipNew: true });
    if (!first && !examEve && recheckList.length && cards.length) bring(new Set(recheckList), RECHECK_MAX, { order: recheckList, skipNew: true });
    const spellMust = new Set([...dictList.filter(x => cards.some(w => w.slug === x)), ...(first || examEve ? [] : recheckList).filter(x => cards.some(w => w.slug === x))]);
    const mustMode = w => (!tileable(w) ? 'mc4' : state.spellMode === 'keys' ? 'keys' : 'tiles');
    const forceSpell = () => { cards.forEach((w, i) => { if (i > 0 && spellMust.has(w.slug)) modes[i] = mustMode(w); }); };

    // ---- what kind of card each one is (DESIGN 2.2, 5.1)
    const spellDay = !isLight && !first && !quizDay && WRITE_ROTATION[now.getDay()] === 'spell';
    let tilesMax = first || quizDay || examEve ? 0
      : isLight ? (season ? TILES.lightSeason : TILES.light)
      : season ? SPELL_PER_DAY - (spellDay ? WRITE_SPELL : 0) : TILES.regular;
    if (tilesMax) tilesMax = Math.max(0, tilesMax + kNum(kw.tilesDelta) + (mix ? kNum(mix.warmup.tilesDelta) : 0));
    const preSet = new Set([...preteach, ...asked]);
    // 0.9.0: a 必会词 is spelled from the second time she sees it (sprint.js writeEligible), and at least half of the warm-up's
    // word cards are written (minShare WRITE_SHARE) whenever spelling is on today (not the first lesson, the quiz day, the night
    // before the exam, or when she said spelling is too hard)
    const eligible = w => !preSet.has(w.slug) && writeEligible(w, { season, isKey });
    const share = tilesMax > 0 ? WRITE_SHARE : 0;
    let am = assignModes(cards, { first, tilesMax, eligible, minShare: share });

    // ---- 写几个词
    const writeFirst = mixId === 'words' || mixId === 'exam' ? 'spell' : mixId === 'grammar' ? (state.grammarCard === null ? 'transform' : 'grammar') : '';
    const writeDelta = kNum(kwr.itemsDelta) + (mix ? kNum(mix.write.itemsDelta) : 0);
    const write = writePlan({ now, state: writeFirst || writeDelta ? { ...state, writeFirst, writeDelta } : state, sprint: sp, words, warm: new Set(cards.map(w => w.slug)), light: isLight, first, quiz: quizDay ? quiz : null, isKey });
    // a spelling day with nothing left to spell there (every key word is already in the warm-up): the warm-up spells them all
    if (season && spellDay && write.mode !== 'spell') am = assignModes(cards, { first, tilesMax: SPELL_PER_DAY, eligible, minShare: share });
    cards = am.cards;
    const modes = am.modes;
    // 读前见一面 is one four-choice card (DESIGN 5.6), not a listening one: with more spelling cards the every-third
    // listening card can land on it
    if (preteach.length) { const ps = new Set(preteach); cards.forEach((w, i) => { if (ps.has(w.slug) && modes[i] === 'listen') modes[i] = 'mc4'; }); }
    // ---- 0.6.0 句子里回想 (modes/cloze.js): a few of the word cards are spelled inside a sentence she has read. Not the
    // first card, a new word, a target word before the story or a word 问老师 explained; the exam season takes the outline's
    // key words first, other days the words on the 写得出 line (a tiles card before a four-choice one), then the most reviewed
    const clozeMax = !clozeOk.size || !tilesMax ? 0
      : Math.max(0, (isLight ? (season ? CLOZE_WARM.lightSeason : CLOZE_WARM.light) : season ? CLOZE_WARM.season : CLOZE_WARM.standard) + kNum(kw.clozeDelta));
    if (clozeMax) {
      const score = (w, i) => (season ? (isKey(w) ? 0 : 4) : 0) + (w.write ? 0 : 2) + (modes[i] === 'tiles' ? 0 : 1);
      cards.map((w, i) => ({ w, i })).filter(({ w, i }) => i > 0 && !w.isNew && clozeOk.has(w.slug) && !preSet.has(w.slug))
        .sort((a, b) => score(a.w, a.i) - score(b.w, b.i) || (b.w.reps || 0) - (a.w.reps || 0) || a.i - b.i)
        .slice(0, clozeMax).forEach(({ i }) => { modes[i] = 'cloze'; });
    }
    forceSpell();

    // ---- grammar in the warm-up: 1-2 a day; the quiz day brings its 5
    const gN0 = first || examEve || quizDay || !cards.length ? 0 : isLight ? GRAMMAR_WARM.light : GRAMMAR_WARM.standard;
    const gN = gN0 ? Math.max(0, Math.min(3, gN0 + kNum(kg.warmDelta) + (mix ? kNum(mix.warmup.grammarDelta) : 0))) : 0;
    let grammar = quizDay ? (quiz.grammar || []).slice() : grammarWarm({ ...state, progress, unitRanks: ranks }, now, gN, sp);

    // ---- 连词成句 now and then in the warm-up (modes/order.js warmItem): not on a 连词成句 day, the first lesson, a light
    // lesson, the quiz day or the night before the exam
    let order = !first && !isLight && !quizDay && !examEve && cards.length && write.mode !== 'order' && Array.isArray(state.orderWarm)
      ? state.orderWarm.filter(Boolean).slice(0, 1) : [];

    // ---- 0.5.0: 地基探针 (1-2), 505 摸底 (6-15 words), 找动词 (1-2). Never on the first lesson, the quiz day or the night
    // before the exam; the 摸底 not on a light lesson or the exam day either (it waits for an ordinary day)
    let probe = noExtras || !Array.isArray(state.probeItems) ? [] : state.probeItems.filter(Boolean).slice(0, Math.max(0, (isLight ? PROBE_WARM.light : PROBE_WARM.standard) + kNum(kw.probeDelta)));
    let screenMax = season ? SCREEN_WARM.season : tuneWords ? SCREEN_WARM.words : SCREEN_WARM.standard;
    if (kw.screenTight) screenMax = Math.min(screenMax, SCREEN_WARM.tight);
    // 0.7.0: 错题 due again today (mistakes.js mistakeReviewItems, 1-2), after the grammar questions and probes
    let mistakes = noExtras || !Array.isArray(state.mistakeItems) ? [] : state.mistakeItems.filter(x => x && x.id).slice(0, isLight ? 1 : 2);
    let screen = noExtras || isLight || examDay || !Array.isArray(state.screenItems) ? [] : state.screenItems.filter(Boolean).slice(0, screenMax);
    let verb = noExtras || isLight || !Array.isArray(state.verbItems) ? [] : state.verbItems.filter(Boolean).slice(0, tuneSentences ? VERB_WARM.sentences : VERB_WARM.standard);
    // ---- 0.6.0: one 变形配对 group, one 对比小卡 (the misconception she hit most lately); neither on a light lesson
    let forms = noExtras || isLight || !formsSpec ? [] : [formsSpec];
    let contrast = noExtras || isLight || !Array.isArray(state.contrastItems) ? []
      : state.contrastItems.filter(x => x && x.id).slice(0, CONTRAST_WARM);
    // ---- 0.9.0: 1-2 词性题 (pos.js posItems) after 变形配对; not on the first lesson, the quiz day (the quiz brings its own)
    // or the night before the exam. The questions are picked from the final cards at the end.
    let posN = noExtras || !cards.length ? 0 : isLight ? POS_WARM.light : POS_WARM.standard;

    // ---- keep to time (DESIGN 2.3): on a story day some recognition cards wait for tomorrow first; then the 连词成句 extra
    // goes, then tiles back to multiple choice, then fewer grammar questions. A school day with the story is about 13-15 minutes.
    const limit = read.status === 'ready' && !isLight && !weekend ? LIMITS.withRead : limitFor(isLight);
    const warmSec = () => modes.reduce((a, m) => a + secOf(m), 0) + grammar.length * secOf('grammar') + order.length * secOf('order')
      + probe.length * secOf('probe') + screen.length * secOf('screen') + verb.length * secOf('verb')
      + forms.length * secOf('forms') + contrast.length * secOf('contrast') + mistakes.length * secOf('grammar') * 2
      + grammar.filter(g => g && g.intro).length * secOf('alt_intro')
      + posN * secOf('pos') + (first ? 0 : Math.min(MEMO_NEW_MAX, cards.filter(w => w.isNew).length) * MEMO_SECONDS);
    const total = () => minOf(warmSec()) + (read.status === 'ready' ? read.minutes : 0) + (write.status === 'ready' ? write.minutes : 0) + WRAP_MINUTES;
    // a story day: recognition cards from the end of the list (lowest band, put off to tomorrow) go first, before the
    // 连词成句 sentence and before the spelling, so the key words are still written and one sentence is still ordered;
    // never below WARM_MIN cards, never the first card, a new word, a target word, a word 问老师 explained or one she picked
    let trimmed = 0;
    if (read.status === 'ready') {
      const preSet2 = new Set(preteach);
      for (let i = cards.length - 1; i > 0 && total() > limit && cards.length > WARM_MIN; i--) {
        if (modes[i] === 'tiles' || modes[i] === 'cloze' || cards[i].isNew || preSet2.has(cards[i].slug) || asked.includes(cards[i].slug) || pickedSet.has(cards[i].slug) || spellMust.has(cards[i].slug)) continue;
        cards.splice(i, 1); modes.splice(i, 1); trimmed++;
      }
    }
    // 0.9.0: spelling cards above the half the warm-up must write (a story day's trim leaves more) turn back first
    const written = () => modes.filter(x => WRITTEN.has(x)).length;
    const floor = () => (share ? Math.ceil(share * cards.length) : 0);
    if (share) while (total() > limit && modes.includes('tiles') && written() > floor()) modes[modes.lastIndexOf('tiles')] = 'mc4';
    if (total() > limit) order = [];
    // 0.5.0: then fewer 摸底 words (none in the exam season, where spelling the key words matters more), tiles back to
    // multiple choice, one grammar question besides the probes, no 摸底, one probe, no grammar, no 找动词, no probe
    // 0.6.0 adds, in this fixed order: after the tiles, 句子里回想 down to one card; the 对比小卡 counts like a probe (one
    // grammar question is enough beside it); after the second probe, no 变形配对, then no 对比小卡, then no 句子里回想,
    // all before the last grammar question goes (变形配对 helps her read saw / children, so it stays longer than the 摸底)
    // 0.9.0: when she said there were too many new words, her 15 小学词 wait until recognition cards have gone first
    if (total() > limit && screen.length > SCREEN_WARM.tight && !tuneWords) screen = screen.slice(0, SCREEN_WARM.tight);
    if (total() > limit && season) screen = [];
    // 0.9.0: the written cards stay at least half. Recognition cards wait for tomorrow first (from the end, never below
    // WARM_MIN, never the first card, a new word, a target word, a word 问老师 explained, one she picked or one that must be
    // spelled); then a tile turns back into four-choice only while the written ones stay above half
    if (share && total() > limit) {
      const preSet2 = new Set(preteach);
      for (let i = cards.length - 1; i > 0 && total() > limit && cards.length > WARM_MIN; i--) {
        if (WRITTEN.has(modes[i]) || cards[i].isNew || preSet2.has(cards[i].slug) || asked.includes(cards[i].slug) || pickedSet.has(cards[i].slug) || spellMust.has(cards[i].slug)) continue;
        cards.splice(i, 1); modes.splice(i, 1); trimmed++;
      }
    }
    if (total() > limit && screen.length > SCREEN_WARM.tight) screen = screen.slice(0, SCREEN_WARM.tight);
    while (total() > limit && modes.includes('tiles') && written() > floor()) modes[modes.lastIndexOf('tiles')] = 'mc4';
    while (total() > limit && modes.filter(x => x === 'cloze').length > 1 && written() > floor()) modes[modes.lastIndexOf('cloze')] = 'mc4';
    // the probes are grammar questions too: with them in, one grammar question is enough (the first one stays: 我问过的)
    if (total() > limit && (probe.length || contrast.length) && grammar.length > 1 && !quizDay) grammar = grammar.slice(0, 1);
    // 0.9.0: one 词性题 is enough when time is short (it never goes to none)
    if (total() > limit && posN > 1) posN = 1;
    if (total() > limit) screen = [];
    if (total() > limit && probe.length > 1) probe = probe.slice(0, 1);
    if (total() > limit) forms = [];
    if (total() > limit) contrast = [];
    // 0.9.0: then textbook words that are still new wait for tomorrow (from the end; NEW_KEEP stay, never below WARM_MIN;
    // never a target word, a word 问老师 explained, one she picked or one that must be spelled), before the written half
    // or the last grammar question goes. They come back in tomorrow's share of textbook words.
    let introCut = 0;
    if (share && total() > limit) {
      const keep = Math.min(NEW_KEEP, cards.filter(w => w.isNew).length);
      const protect = new Set([...preteach, ...asked, ...pickedSet, ...spellMust]);
      for (let i = cards.length - 1; i > 0 && total() > limit && cards.length > WARM_MIN; i--) {
        if (cards.filter(w => w.isNew).length <= keep) break;
        const w = cards[i];
        if (!w.isNew || !w.unit || WRITTEN.has(modes[i]) || protect.has(w.slug)) continue;
        cards.splice(i, 1); modes.splice(i, 1); introCut++;
      }
    }
    while (total() > limit && modes.includes('cloze') && written() > floor()) modes[modes.lastIndexOf('cloze')] = 'mc4';
    while (total() > limit && grammar.length && !quizDay) grammar = grammar.slice(0, -1);
    if (total() > limit) verb = [];
    if (total() > limit) probe = [];
    if (total() > limit && mistakes.length > 1) mistakes = mistakes.slice(0, 1);
    // last resort, so a lesson never runs long: the written cards go below half after all
    while (total() > limit && modes.includes('tiles')) modes[modes.lastIndexOf('tiles')] = 'mc4';
    while (total() > limit && modes.includes('cloze')) modes[modes.lastIndexOf('cloze')] = 'mc4';
    forceSpell();   // the time trims turn tiles back into four-choice; these stay spelled
    // the 词性题: words from today's cards (their part of speech is known), the rest sentences from pos-guide.json; the part
    // of speech she picked wrong lately first (state.posEvents: the last days' answers), the same set all day
    let pos = [];
    if (posN) {
      try {
        pos = posItems({ words: cards, entryOf: typeof state.entryOf === 'function' ? state.entryOf : null, curriculum: state.curriculum || null,
          n: posN, seed: Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5),
          events: Array.isArray(state.posEvents) ? state.posEvents : Array.isArray(state.history) ? state.history : [], now });
      } catch (e) { pos = []; }
    }

    const wcards = cards.map((w, i) => ({ type: 'word', slug: w.slug, mode: modes[i], ...(kw.distractor && kw.distractor !== 'normal' ? { distractor: kw.distractor } : {}) }));
    // grammar questions and probes spread through the word cards together (probes after the grammar ones)
    const gp = [...grammar.map(g => ({ type: 'grammar', id: g.id || g.item, item: g.item || g.id, point: g.point || null, card: g.card || null, mode: 'grammar',
      ...(g.kind === 'alt' ? { kind: 'alt' } : {}), ...(g.intro ? { intro: true } : {}) })),
      ...probe.map(x => ({ type: 'probe', id: x.id, item: x.item, block: x.block || null, point: x.point || null, card: x.card || null, mode: 'grammar' })),
      ...contrast.map(x => ({ type: 'contrast', id: x.id, item: x.item || 'gc:' + x.id, title: x.title || '', tags: Array.isArray(x.tags) ? x.tags.slice() : [], mode: 'contrast' }))];
    const at = grammarSlots(cards.length, gp.length);
    for (let i = gp.length - 1; i >= 0; i--) wcards.splice(at[i], 0, gp[i]);
    for (const x of mistakes) wcards.push({ type: 'mistake', id: x.id, item: x.item || 'mx:' + x.id, mode: 'mistake' });
    for (const x of screen) wcards.push({ type: 'screen', id: x.id });
    for (const id of verb) wcards.push({ type: 'verb', id, item: id, mode: 'verb' });
    for (const f of forms) wcards.push({ type: 'forms', id: 'forms', item: 'forms', mode: 'forms', kind: f.kind, items: f.items.slice() });
    if (pos.length) wcards.push({ type: 'pos', id: 'pos', item: 'pos', mode: 'pos', items: pos.slice() });
    for (const id of order) wcards.push({ type: 'order', id, item: 'o:' + id, mode: 'order' });
    const tuned = [];
    if (tuneWords && screen.length > SCREEN_WARM.standard) tuned.push({ id: 'screen', why: `${tune.hard === 'words' ? '她说生词太多' : '读的时候多卡在词上'}：今天多认几个小学词（${screen.length} 个）。` });
    if (tuneSentences && verb.length > VERB_WARM.standard) tuned.push({ id: 'verb', why: `${tune.hard === 'sentences' ? '她说句子看不懂' : '读的时候多卡在句子上'}：今天多找一句的动词。` });
    const cloze = cards.filter((w, i) => modes[i] === 'cloze').map(w => w.slug);
    const picked = cards.filter(w => pickedSet.has(w.slug)).map(w => w.slug);
    const dictWarm = cards.filter(w => dictList.includes(w.slug)).map(w => w.slug);
    const recheck = cards.filter(w => spellMust.has(w.slug) && recheckList.includes(w.slug)).map(w => w.slug);
    const warmMin = minOf(warmSec() - posN * secOf('pos') + pos.length * secOf('pos'));
    return { cards, modes, grammar, order, preteach, asked, probe, screen, verb, forms, contrast, cloze, picked, dictWarm, recheck, tuned, wcards, mistakes, pos, write, read, pick, pulled, quizDay, R, I, Fp, trimmed, introCut, warmMin };
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
  const r = m.read;
  const readExtra = { mode: r.mode || 'story', note: r.note || '' };
  for (const k of ['episodeId', 'passageId', 'n', 'of', 'title', 'titleZh', 'short', 'again', 'resume', 'challenge', 'autoTrunk', 'selfFirst']) if (r[k] !== undefined) readExtra[k] = r[k];
  const extras = m.mistakes.length + m.probe.length + m.screen.length + m.verb.length + m.forms.length + m.contrast.length + m.pos.length;
  const cells = [
    cell('warmup', items.length || m.grammar.length || extras ? 'ready' : 'skip', m.warmMin, items, {
      mode: 'mc4',
      cards: m.wcards,
      modes: Object.fromEntries(m.cards.map((x, i) => [x.slug, m.modes[i]])),
      grammar: m.grammar,
      order: m.order,
      preteach: m.preteach,
      probe: m.probe,
      screen: m.screen,
      verb: m.verb,
      asked: m.asked,
      cloze: m.cloze,
      forms: m.forms,
      contrast: m.contrast,
      picked: m.picked,
      mistakes: m.mistakes,
      dictWarm: m.dictWarm || [],
      recheck: m.recheck || [],
      pos: m.pos || [],
    }),
    cell('read', r.status, r.minutes, [], readExtra),
    cell('write', w.status, w.minutes, w.items, writeExtra),
    cell('wrap', 'ready', WRAP_MINUTES, [], examEve ? { line: EARLY_SLEEP } : {}),
  ];
  const withRead = cells[1].status === 'ready' && !light && !weekend;
  const minutes = Math.min(withRead ? LIMITS.withRead : limitFor(light), cells.filter(c => c.status === 'ready').reduce((a, c) => a + c.minutes, 0));
  const allDone = cells.every(c => c.status !== 'ready');
  const lbRead = lb && lb.read.status === 'ready' && !done.read ? lb.read.minutes : 0;
  const lightMinutes = !lb ? 0 : light ? minutes
    : Math.min(LIMITS.light, lb.cards.length || lbRead ? lb.warmMin + lbRead + (lb.write.status === 'ready' ? lb.write.minutes : 0) + WRAP_MINUTES : 0);

  // ---- the two sentences on the home page
  const why = reasonOf({ first, cards: cells[0].status === 'done' ? [] : m.cards, light, lightReason, gap, band, inScope, examSeason, rank, quizDay: m.quizDay, sp, isKey, write: cells[2], read: cells[1] });
  const summary0 = summaryOf({ first, n: items.length, dictation, cards: m.cards, rank, quizDay: m.quizDay, write: cells[2], read: cells[1], warmDone: cells[0].status === 'done' });

  const weekDays = num(state.weekDays, 0) > 0 ? num(state.weekDays, 0)
    : (lessonDays || []).filter(d => d >= mondayOf(now) && d <= today).length;
  const newIn = m.cards.filter(x => x.isNew).length;
  const gains = state.gains || (Array.isArray(state.history) ? weeklyGains(state.history, now) : null);
  const spellN = m.modes.filter(x => x === 'tiles' || x === 'cloze').length + (w.status === 'ready' && w.mode === 'spell' ? w.items.length : 0);
  return {
    date: today,
    light,
    minutes,
    lightMinutes,
    cells,
    why,
    summary: mix && mix.note && summary0 ? mix.note + summary0 : summary0,
    today: { choice: choice || '', mix },
    difficulty: kn ? kn.levels || null : null,
    counts: {
      due: reviews.length,
      fresh: newIn,
      total: items.length,
      reviews: items.length - newIn,
      intro: first ? newIn : m.pick.I.length - (m.introCut || 0),
      newWords: first ? 0 : m.pick.F.length,
      deferred: first ? reviews.length : m.R.length - m.pick.R.length + m.trimmed,
      cutNew: first ? 0 : m.I.length + m.Fp.length - m.pick.I.length - m.pick.F.length + (m.introCut || 0),
      grammar: m.grammar.length,
      spell: spellN,
      pulled: m.pulled.length,
      order: m.order.length,
      preteach: m.preteach.length,
      probe: m.probe.length,
      screen: m.screen.length,
      verb: m.verb.length,
      asked: m.asked.length,
      cloze: m.cloze.length,
      forms: m.forms.length,
      contrast: m.contrast.length,
      picked: m.picked.length,
      mistakes: m.mistakes.length,
      dictWarm: (m.dictWarm || []).length,
      recheck: (m.recheck || []).length,
      pos: (m.pos || []).length,
      written: m.modes.filter(x => WRITTEN.has(x)).length,
    },
    tune: m.tuned,
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
  order: '今天先排几个句子，因为排对顺序是写句子的第一步。',
  transform: '今天先把几个句子变一变，因为会变否定句和问句，才算会用。',
};
const READ_WHY = '今天先读一集故事，因为每天读一点，句子就越看越懂。';

function unitsText(list, rank) {
  const ids = [...new Set(list.map(w => w.unit).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
  if (!ids.length) return '';
  if (ids.length === 1) return unitName(ids[0]);
  if (ids.length === 2) return `${unitName(ids[0])} 和 ${unitName(ids[1])}`;
  return `${unitName(ids[0])} 到 ${unitName(ids[ids.length - 1])}`;
}

function reasonOf({ first, cards, light, lightReason, gap, band, inScope, examSeason, rank, quizDay, sp, isKey, write, read }) {
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
    if (read && read.status === 'ready') return READ_WHY;
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
  if (write.mode === 'order') return `排 ${write.items.length} 个句子`;
  if (write.mode === 'transform') return `做 ${write.items.length} 道句型转换`;
  return '';
}
// 读一段 today, as a few words: “读第 2 集故事” / “读半集故事” / “再读第 3 集”
function readBit(read) {
  if (!read || read.status !== 'ready') return '';
  if (read.mode === 'passage') return '读一篇期中阅读';
  if (read.again) return `再读第 ${read.n} 集故事`;
  return read.short ? `读第 ${read.n} 集故事（做 2 道题）` : `读第 ${read.n} 集故事`;
}

function summaryOf({ first, n, dictation, cards, rank, quizDay, write, read, warmDone = false }) {
  // dictation: today's dictation is already written (its record lands after the first check), so the lesson is short
  const tail = dictation ? '今天写过听写，课短一点。' : '';
  const steps = [readBit(read), writeBit(write)].filter(Boolean);
  // the warm-up is done (she left in the middle): what is left
  if (warmDone && !first && !quizDay) return (steps.length ? `热身做完了。接着${steps.join('，再')}，最后收尾。` : '热身做完了，收个尾就好。') + tail;
  if (!n) {
    return (steps.length ? `今天没有要复习的词，${steps.join('，再')}，就收尾。` : '今天没有要复习的词。') + tail;
  }
  if (first) return `先认 ${n} 个 ${unitsText(cards, rank) || 'Starter'} 里的词，再收尾。` + tail;
  if (quizDay) return `先热身 ${n} 张，再做一份小卷，最后收尾。` + tail;
  return (steps.length ? `先热身 ${n} 张，再${steps.join('，再')}，最后收尾。` : `先热身 ${n} 张，再收尾。`) + tail;
}
