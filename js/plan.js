// 今天的课（DESIGN 2.0-2.3、5.1）：每天四格，热身 → 读一段 → 写几个词 → 收尾。决定热身出哪些卡（按优先级、
// 张数封顶）、今天开几个新词、轻松版、21:00 以后只推轻松版、首页那句“今天先练……因为……”。
// 负责：今天的课 agent（plan.js）。
// 状态：v0 规则已做完：容量封顶、四档优先级、课本词每天约 15 个混进热身、超了先减新词再顺延最后一档、
// 第一节课、轻松版（自己选 / 21:00 以后 / 有听写的晚上 / 漏了一天回来 / 考试前一天）、周末 30 张、reason。
// 护栏（teacher-memory 6.3）写死在这里，模型碰不到。
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
//         write  “写得出”线开着没有（v0 先都是 false）
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
//     progress: { unit, examFrom, examTo, examDate }   家长区填的进度（kv 'progress'）
//     weekDays, weekGoal  这周做了几天 / 她定的目标
//     lessonDays?,        做完过课的日子 ['YYYY-MM-DD', ...]（kv 'day:' 里有格子做完的那些天）。
//                         给了且为空 = 第一节课；最后一天早于昨天 = 回归日；也用来算 weekDays
//     firstLesson?,       直接指定是不是第一节课（不给就看 lessonDays）
//     unitRanks?,         { unitId: order }（curriculum.units()），不给就按 'S' = 0、'U3' = 3 算
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
//     summary: string,                   首页一句中文：“先热身 15 张，再收尾。”
//     counts: { due, fresh, total, reviews, intro, newWords, deferred, cutNew }
//         due 今天到期的复习卡（不含新卡）；fresh 选进来的新卡（课本词 + 新词）；total 热身张数；
//         reviews / intro / newWords 选进来的复习卡 / 课本词 / 新词；deferred 顺延到以后的复习卡；cutNew 因为封顶没放的新卡
//     // 以下是加的字段
//     kind: 'standard' | 'easy' | 'weekend',   给 events 'session_start'.kind
//     lightReason: '' | 'late' | 'exam' | 'dictation' | 'comeback' | 'chosen'
//     first: bool, weekend: bool, dictation: bool（= dictationTonight）, comeback: bool, cap: number, allDone: bool,
//     week: { days, goal },
//     slots / easy / reason              cells / light / why 的别名（任务稿里的名字）
//   }
//   Cell = { id: 'warmup' | 'read' | 'write' | 'wrap', label, status, minutes, items: [slug], mode?, note? }
//     status：'ready' 可以做 | 'done' 今天做完了 | 'soon' 还没上线（显示“下周开播”，不占时间） | 'skip' 今天不做
//     v0：warmup ready（没有卡时 skip）；read soon“下周开播”；write skip（空，热身后直接收尾）；wrap ready
//
// 出卡规则（DESIGN 5.1）
//   1. 封顶：上学日 20 张，周末 30 张，轻松版 12 张，第一节课 15 张。
//   2. 优先级：第 0 档 期中范围或当前单元的必会词（“写得出”线开着的排最前）→ 第 1 档 已学单元的必会词 →
//      第 2 档 认读词 → 第 3 档 小学地基词 → 第 4 档 其余（她自己收藏的课外词）。同档里先出快忘的（r 小 / 到期早）。
//   3. 课本词（新卡、有单元、不在以后的单元）每天约 15 个混进热身，算在封顶里；她自己收藏的新词每天不超过 4 个。
//      超了先减新词：新词降到 2 个，课本词减到放得下，新词再降到 0；还超，复习卡从最后一档、最有把握的开始顺延。
//   4. 第一张放她最有把握的（r 最大）。
//   今天已复习：last 是今天的复习卡不再算到期（FSRS 新卡答对后约 10 分钟的短间隔不会让第二节课重出一遍，
//   CONTRACTS 11 的第一条）；做完的格子按 kv 'day:' 标 'done'。
//
// 轻松版（DESIGN 2.2、2.3，teacher-memory 6.3）
//   21:00 以后只推轻松版；有听写的晚上自动轻松版；考试前一天只推轻松版；漏了一天回来默认轻松版
//   （state.standard 为真可以改回标准版）；她自己点“轻松版”。
//
// wordsForPlan(entries, curriculum, opts?) -> state.words   纯函数：词条（words.favorites()）加上课标信息，拼成上面的形状。
//   词条上已有的 unit / tier（课本导入时写进去的）优先，没有才问 curriculum。app.js 的 ctx.planState() 用它。
//   opts = { now } 时多给 r、last、order、source 四个字段（排“最有把握的”、今天已复习去重要用）。
//
// 依赖：fsrs.js（endOfDay、State、retrievability、daysBetween、localMidnight）。

import { endOfDay, State, retrievability, daysBetween, localMidnight } from './fsrs.js';

export const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
export const CELL_LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾' };
export const CAPS = { schoolday: 20, light: 12, weekend: 30, first: 15 };   // 热身卡数封顶（DESIGN 5.1、2.1）
export const LIMITS = { standard: 13, light: 8, withDictation: 20, enough: 25 };   // 分钟（teacher-memory 6.3）
export const SECONDS_PER_CARD = 15;
export const WRAP_MINUTES = 1;
export const TEXTBOOK_PER_DAY = 15;     // 课本词每天混进热身几个（DESIGN 2.1）
export const MAX_NEW_PER_DAY = 4;       // 护栏：每天新词不超过 4 个
export const NEW_SQUEEZED = 2;          // 超了先把新词降到 2 个
export const LATE_HOUR = 21;
export const BANDS = ['scope', 'learned', 'recognize', 'primary', 'extra'];

const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

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

  // ---- light version: guardrails first, then the defaults she can undo
  const lightWhy = [];
  if (now.getHours() >= LATE_HOUR) lightWhy.push('late');
  if (examEve) lightWhy.push('exam');
  if (dictation) lightWhy.push('dictation');
  if (comeback && !state.standard) lightWhy.push('comeback');
  if (state.light) lightWhy.push('chosen');
  const light = lightWhy.length > 0;
  const lightReason = lightWhy[0] || '';
  const capFor = isLight => (isLight ? CAPS.light : weekend ? CAPS.weekend : CAPS.schoolday);
  const cap = first ? CAPS.first : capFor(light);

  // ---- sort words into reviews, textbook intros and her own new words
  const eod = endOfDay(now);
  const curRank = progress.unit ? rank(progress.unit) : Infinity;   // no progress set: every unit counts as learned
  const lo = progress.examFrom ? rank(progress.examFrom) : null;
  const hi = progress.examTo ? rank(progress.examTo) : null;
  const inScope = w => !!w.scope || (lo !== null && hi !== null && !!w.unit && rank(w.unit) >= lo && rank(w.unit) <= hi);
  const isCurrent = w => !!progress.unit && !!w.unit && w.unit === progress.unit;
  const future = w => !!w.unit && !inScope(w) && rank(w.unit) > curRank;
  const band = w => {
    if (w.tier === 'required') return inScope(w) || isCurrent(w) ? 0 : 1;
    if (w.tier === 'recognize') return 2;
    if (w.tier === 'primary') return 3;
    return 4;
  };
  const dueNow = w => !w.due || new Date(w.due) <= eod;
  const reviewedToday = w => !!w.last && dayOf(new Date(w.last)) === today;
  const rOf = w => (Number.isFinite(w.r) ? w.r : null);
  const byForget = (a, b) => {
    const ra = rOf(a), rb = rOf(b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    return (a.due ? new Date(a.due) : 0) - (b.due ? new Date(b.due) : 0);
  };

  const reviews = words.filter(w => w && !w.isNew && w.due && new Date(w.due) <= eod && !reviewedToday(w))
    .sort((a, b) => band(a) - band(b) || (band(a) === 0 ? (b.write ? 1 : 0) - (a.write ? 1 : 0) : 0) || byForget(a, b));
  const ordOf = w => (Number.isFinite(w.order) ? w.order : 1e9);
  const intros = words.filter(w => w && w.isNew && w.unit && !future(w) && dueNow(w))
    .sort((a, b) => band(a) - band(b) || (b.write ? 1 : 0) - (a.write ? 1 : 0) || rank(a.unit) - rank(b.unit) || ordOf(a) - ordOf(b));
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
  function squeeze(c) {
    const R0 = reviews.length;
    let I = introPool.length, F = freshPool.length;
    if (R0 + I + F > c) F = Math.min(F, NEW_SQUEEZED);
    if (R0 + I + F > c) I = Math.max(0, c - R0 - F);
    if (R0 + I + F > c) { F = 0; I = Math.max(0, c - R0); }
    const R = Math.min(R0, c - I - F);
    return { R: reviews.slice(0, R), I: introPool.slice(0, I), F: freshPool.slice(0, F) };
  }

  let cards, pick = { R: [], I: [], F: [] };
  if (first) {
    // DESIGN 2.1: only the 15 Starter words she is surest of, so the first lesson ends on right answers
    const unitWords = words.filter(w => w && w.unit);
    const minRank = unitWords.reduce((m, w) => Math.min(m, rank(w.unit)), Infinity);
    const starter = unitWords.filter(w => rank(w.unit) === minRank);
    const tierSure = { primary: 0, required: 1, recognize: 2, extra: 3 };
    starter.sort((a, b) => (rOf(b) ?? 0) - (rOf(a) ?? 0) || (tierSure[a.tier] ?? 3) - (tierSure[b.tier] ?? 3)
      || (isPhrase(a) ? 1 : 0) - (isPhrase(b) ? 1 : 0) || len(a) - len(b) || ordOf(a) - ordOf(b));
    cards = starter.slice(0, CAPS.first);
    if (!cards.length) { pick = squeeze(CAPS.first); cards = [...pick.R, ...pick.I, ...pick.F]; }
  } else {
    pick = squeeze(cap);
    const order = new Map();
    [...pick.R, ...pick.I, ...pick.F].forEach((w, i) => order.set(w, i));
    cards = [...pick.R, ...pick.I, ...pick.F]
      .sort((a, b) => band(a) - band(b) || (a.isNew ? 1 : 0) - (b.isNew ? 1 : 0) || order.get(a) - order.get(b));
    // DESIGN 2.2: the first card is the one she is surest of
    const surest = pick.R.reduce((best, w) => {
      if (!best) return w;
      const sw = rOf(w) ?? (w.reps - 2 * w.lapses) / 100, sb = rOf(best) ?? (best.reps - 2 * best.lapses) / 100;
      return sw > sb ? w : best;
    }, null);
    if (surest) cards = [surest, ...cards.filter(w => w !== surest)];
  }
  const items = cards.map(w => w.slug);

  // ---- minutes
  const warmMin = n => (n ? Math.max(1, Math.round((n * SECONDS_PER_CARD) / 60)) : 0);
  const lightPick = squeeze(CAPS.light);
  const lightCards = lightPick.R.length + lightPick.I.length + lightPick.F.length;
  const lightMinutes = first ? 0 : Math.min(LIMITS.light, lightCards ? warmMin(lightCards) + WRAP_MINUTES : 0);

  const cell = (id, status, minutes, list = [], extra = {}) =>
    ({ id, label: CELL_LABELS[id], status: done[id] && status !== 'soon' ? 'done' : status, minutes, items: list, ...extra });
  const cells = [
    cell('warmup', items.length ? 'ready' : 'skip', warmMin(items.length), items, { mode: 'mc4' }),
    cell('read', 'soon', 0, [], { note: '下周开播' }),
    cell('write', 'skip', 0, [], { mode: 'paper', note: '' }),
    cell('wrap', 'ready', WRAP_MINUTES),
  ];
  const minutes = Math.min(light ? LIMITS.light : LIMITS.standard, cells.filter(c => c.status === 'ready').reduce((a, c) => a + c.minutes, 0));
  const allDone = cells.every(c => c.status !== 'ready');

  // ---- the two sentences on the home page
  const why = reasonOf({ first, cards, light, lightReason, gap, band, inScope, examSeason, rank });
  const summary = summaryOf({ first, n: items.length, dictation, cards, rank });

  const weekDays = num(state.weekDays, 0) > 0 ? num(state.weekDays, 0)
    : (lessonDays || []).filter(d => d >= mondayOf(now) && d <= today).length;
  const newIn = cards.filter(w => w.isNew).length;
  return {
    date: today,
    light,
    minutes,
    lightMinutes: first ? 0 : light ? minutes : lightMinutes,
    cells,
    why,
    summary,
    counts: {
      due: reviews.length,
      fresh: newIn,
      total: items.length,
      reviews: items.length - newIn,
      intro: first ? newIn : pick.I.length,
      newWords: first ? 0 : pick.F.length,
      deferred: first ? reviews.length : reviews.length - pick.R.length,
      cutNew: first ? 0 : introPool.length + freshPool.length - pick.I.length - pick.F.length,
    },
    kind: light ? 'easy' : weekend ? 'weekend' : 'standard',
    lightReason,
    first,
    weekend,
    dictation,
    dictationTonight: dictation,
    comeback,
    cap,
    allDone,
    week: { days: weekDays, goal: num(state.weekGoal, 0) },
    slots: cells,
    easy: light,
    reason: why,
  };
}

const LIGHT_WHY = {
  late: '今天先练轻松版，因为已经很晚了，早点睡。',
  exam: '今天先练轻松版，因为明天考试，今天早点睡。',
  dictation: '今天先练轻松版，因为今晚还有听写。',
  chosen: '今天先练轻松版，因为作业多的日子，练一点也算一天。',
};

function unitsText(list, rank) {
  const ids = [...new Set(list.map(w => w.unit).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
  if (!ids.length) return '';
  if (ids.length === 1) return unitName(ids[0]);
  if (ids.length === 2) return `${unitName(ids[0])} 和 ${unitName(ids[1])}`;
  return `${unitName(ids[0])} 到 ${unitName(ids[ids.length - 1])}`;
}

function reasonOf({ first, cards, light, lightReason, gap, band, inScope, examSeason, rank }) {
  if (first) {
    const u = unitsText(cards, rank) || 'Starter';
    return cards.length ? `今天先练 ${u} 里你最有把握的 ${cards.length} 个词，因为第一节课从有把握的开始。` : '今天先认识一下老师，因为课本词还没导进来。';
  }
  if (light) {
    if (lightReason === 'comeback') return gap > 2 ? '今天先练轻松版，因为歇了几天，先找回手感。' : '今天先练轻松版，因为昨天歇了一天，先找回手感。';
    return LIGHT_WHY[lightReason] || LIGHT_WHY.chosen;
  }
  if (!cards.length) return '今天没有要复习的词，收个尾就好。';
  const top = Math.min(...cards.map(band));
  const group = cards.filter(w => band(w) === top);
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

function summaryOf({ first, n, dictation, cards, rank }) {
  // dictation: today's dictation is already written (its record lands after the first check), so the lesson is short
  if (!n) return '今天没有要复习的词。';
  const head = first ? `先认 ${n} 个 ${unitsText(cards, rank) || 'Starter'} 里的词，再收尾。` : `先热身 ${n} 张，再收尾。`;
  return dictation ? head + '今天写过听写，课短一点。' : head;
}
