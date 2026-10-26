// 今天（首页，DESIGN 2.0 的草图）：书眉“Emma 的英语老师”，右上是当前阶段（“期中季 · S 到 U3”，没设就不显示）；
// 老师的英文招呼一行（千问读，中文字幕按 lines.shouldShowZh，点“看中文”展开）；“今天约 12 分钟”和一句为什么；
// 一个主按钮“开始今天的课”，下面文字入口“轻松版 8 分钟”；底部一行：明天有听写？、问老师（0.3.0）、查词、这周 3 / 5 天。
// 听写提醒（“再写一次错的”“出门前看一眼”，dictation.js homeReminders）放在招呼上面一行。轻松版由 plan.js 定
// （21:00 以后、有听写的晚上、考前一天、漏了一天回来）；回归日可以改点“标准版”。
// v1（期中季，DESIGN 2.2、6.4、9）只往这个样子里加内容：
//   “写几个词”那格开了以后写当天是哪种：“拼几个词 / 语法卡 / 语音小卡”（plan 的 write 格 mode，见 WRITE_KINDS）；
//   考前小卷那天（plan.quiz / plan.sprint、kind 'quiz' / 'sprint'，或写几个词格 mode 'quiz'）主按钮是“开始今天的小卷”，
//   go('lesson', { light: false, sprint: true })（ui-lesson.js 的 params.sprint）；
//   增量一行“这周又能写出 N 个词。”（sprint.js 的 weeklyGains(events, now).line，和 plan 同一个口径；sprint.js 没有时
//   用这里的 writtenThisWeek），不放倒计时、不放进度条；
//   0.5.0：四格下面一行“课文陪读：拍一页课文，一句一句读懂”（ctx.textread.open()，ui-textread.js 盖一层全屏），读过的页再给
//   “再读 Unit 1 · 第 8 页”（textread.js listSaved，最近的一页）；写几个词多“句型转换”（3 个句子），小卷日读一段是“期中阅读”。
//   周日晚上起“这周小结出来了”一行（weekly.js 的 hasNewWeekly(kv, now)，点了 go('weekly')，页面是 ui-weekly.js）。
//   weekly.js 是别的 agent 同时写的，按需 import()：文件没有、函数没有、nav 里没有 weekly 路由时这一行不出现。
// 0.9.0（Wei 10-26：每日阅读和接着练找不到，不要死板的固定流程）：招呼下面三张并排的卡，随时都能点，不用先上完课：
//   ① 今天的课：约几分钟、先练什么（plan.summary）、为什么，原来的四格缩成一行小字（cellLine），“这周又能写出 N 个词。”，
//      按钮“开始”（小卷日“开始小卷”，做了一半“接着上”），轻松版 / 标准版一个小入口；上完了“做完了”，按钮“再来一节”。
//   ② 今天的阅读（daily-read.js）：写好了是题目、话题和约几分钟、要学的词（最多 5 个），“去读”打开 app.dailyRead；
//      还在写或今天没写成，“老师正在写今天这篇。先读番外第 N 集。”，“去读”直接用接着练的一轮读那一集（pickFallback）；
//      读完了“再来一篇”（当天最多 3 篇）和“读读别的”。
//   ③ 接着练（ui-practice.js 的 card 模式）：老师推荐的下一件事一句话和“开始”；下面一行小入口：练不熟的词、错题、语法、
//      听写、复习考试（复习做到一半是“接着复习”）。
//   老师会先推的那张卡（primaryCard：课没上完是 ①，上完了今天的阅读写好没读是 ②，否则 ③）按钮实心、顶上一道主题色线，别的描边。
//   iPad 竖屏 ① 占一整行、② ③ 并排；横屏（宽 1000 以上）整页放宽到约 1100，三张一排，“学一点”挪到招呼右边。
//   底部一行：问老师、查词、课文陪读、这周 N 天。听写挪进了 ③，“我要复习考试”“有 N 道错题今天再考”两行变成 ③ 的小入口。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/home.css、css/lesson.css、css/dictation.css）。
//
// 导出
//   createHomeTab(ctx) -> { show(params), onChange() }
//     渲染进 #tab-home（index.html）。show 每次切到“今天”时调用；onChange 在词或设置变了以后调用（app.js 节流过）。
//   纯函数（Node 里测，tests/ui-today.test.mjs、tests/ui-home.test.mjs；ui-lesson.js、ui-dictation.js 也用）：
//     lessonDays(kv) -> ['YYYY-MM-DD']        做过课的日子（kv 'day:' 有做完的格子），升序；给 plan 的 state.lessonDays
//     practiceDays(kv) -> ['YYYY-MM-DD']      做过课或听写（kv 'dictation:'）的日子，升序
//     weekCount(days, now) -> number          这周（周一起）做了几天
//     dayNumber(days, now) -> number          今天是第几个上课日（1 起，今天算一天）；第一周按钮问题按它挑
//     missedDays(days, now) -> number         上一次练到今天中间空了几天（第一次用为 0）
//     phaseText(progress, now, titleOf?) -> string   右上角那行；没设进度返回 ''
//     latestDictation(kv) -> { key, rec } | null     最近一次听写记录
//     wrongWords(rec) -> [{ slug, w, cn }]           这次听写里打过叉的词（各轮合在一起）
//     dictationNotice(kv, now) -> null | { kind: 'tonight' | 'soon' | 'morning', key, words, minutes?, label? }
//     dictationToday(kv, now) -> bool         今天写过听写（给 plan 的 state.dictationTonight）
//     slotText(cell) -> { name, note }        四格里一格的名字和下面那行小字（读一段：“第 2 集”，0.4.0；连词成句：“3 个句子”）
//     readNote(cell) -> string                读一段那格的小字
//     isQuizDay(plan) -> bool、startLabel(plan) -> string   主按钮
//     writtenThisWeek(events, now) -> [slug]  这周第一次写对的词：spell 事件、纸笔听写、answer 里 mode 是拼写的，
//                                              correct 为真；这周以前写对过的不算
//     gainText(n) -> string                   “这周又能写出 N 个词。”，0 个时为 ''
//     optionalModule(path) -> Promise<module | null>   按需 import()，失败返回 null（ui-dictation、ui-parent 也用）
//     0.9.0 三张卡：cellLine(plan) -> [{ id, name, status }]、lessonState(plan) -> 'todo' | 'going' | 'done'、
//       cardStart(plan) -> 按钮字、pieceWords(piece, max = 5) -> [{ w, zh }]、
//       readModel(dayState, homeLine, fallback) -> 第二张卡的内容、primaryCard(lessonState, readStatus) -> 'lesson' | 'read' | 'practice'、
//       whenHidden(el, fn)（每日阅读那一层关上以后重画）
//
// 用到的 ctx（CONTRACTS.md）：todayPlan({ lessonDays, standard })、lines.pick / markSeen / shouldShowZh / tapZh、say、
// go('lesson', { light | sprint }) / go('dictation', params) / go('look') / go('weekly')、kv.peek / keys、
// events.query、statusSlot(el)、curriculum、toast、currentRoute；0.9.0 practice（mount 的 card 模式、start）、
// dailyRead（open、el）、textread（open）、settings / mockForced（模拟模式下每日阅读在内存里）。
// 样式写在 css/home.css，类名一律以 home- 开头。
import { h, icon } from './ui-dom.js';
import { dayOf, CELL_LABELS } from './plan.js';
import { ROUTES } from './nav.js';
import * as D from './dictation.js';
import { examPhase as examPhaseOf } from './lines.js';
// 0.7.0: 我要复习考试 (review.js) and 错题 due again today (mistakes.js); 0.9.0 they are small entries on the 接着练 card
import { activePlan as reviewActive } from './review.js';
import { summary as mistakesSummary } from './mistakes.js';
// 0.8.0 (第 6 批): “老师说 + 学一点” (lines.js talk), her difficulty and topics for it (kid-me.js), adding a phrase to her word book
import { difficulty as kidDifficulty, readPrefs as kidPrefs } from './kid-me.js';
import { ownCandidate, ownExport } from './wordbook.js';
// 0.9.0 three cards: today's reading (daily-read.js; the story it falls back on comes from reader.js), words about to slip (practice.js)
import * as DR from './daily-read.js';
import * as RD from './reader.js';
import { fadingWords } from './practice.js';

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ---------------------------------------------------------------- pure helpers

// The days she did a lesson: a kv 'day:' record with a done cell. plan.js reads them as state.lessonDays
// (first lesson, coming back after a gap, this week's count).
export function lessonDays(kv) {
  const out = [];
  for (const k of kv.keys('day:')) {
    const r = kv.peek(k, null);
    const d = k.slice(4);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && r && r.cells && Object.values(r.cells).some(Boolean)) out.push(d);
  }
  return out.sort();
}
// Lesson days plus dictation days (the 这周 count shows lessons only, as plan.js counts them)
export function practiceDays(kv) {
  const set = new Set(lessonDays(kv));
  for (const k of kv.keys('dictation:')) {
    const r = kv.peek(k, null);
    if (r && Array.isArray(r.rounds) && r.rounds.length) set.add(k.slice(10));
  }
  return [...set].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

export function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export function weekCount(days, now = new Date()) {
  const lo = dayOf(weekStart(now)), hi = dayOf(addDays(weekStart(now), 6));
  return days.filter(d => d >= lo && d <= hi).length;
}
export const weekList = (days, now = new Date()) => {
  const lo = dayOf(weekStart(now)), hi = dayOf(addDays(weekStart(now), 6));
  return days.filter(d => d >= lo && d <= hi);
};
export function dayNumber(days, now = new Date()) {
  const t = dayOf(now);
  return days.filter(d => d < t).length + 1;
}
export function missedDays(days, now = new Date()) {
  const t = dayOf(now);
  const before = days.filter(d => d < t);
  if (!before.length) return 0;
  const last = before[before.length - 1].split('-').map(Number);
  const a = new Date(last[0], last[1] - 1, last[2]);
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 864e5) - 1);
}

// "期中季 · S 到 U3" while the midterm range is set and the exam has not passed; otherwise the current unit
export function phaseText(p, now = new Date(), titleOf = id => id) {
  if (!p || typeof p !== 'object') return '';
  const today = dayOf(now);
  const examOver = p.examDate && String(p.examDate).slice(0, 10) < today;
  if (p.examTo && !examOver) return `期中季 · ${p.examFrom || 'S'} 到 ${p.examTo}`;
  if (p.unit) return `在学 ${titleOf(p.unit) || p.unit}`;
  return '';
}

export function latestDictation(kv) {
  const keys = kv.keys('dictation:').filter(k => /^dictation:\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const rec = kv.peek(keys[i], null);
    if (rec && Array.isArray(rec.rounds) && rec.rounds.length) return { key: keys[i], rec };
  }
  return null;
}

// the words she wrote wrong that evening (the quick retry round does not add any): dictation.js morningList
export const wrongWords = rec => (rec ? D.morningList(rec).map(({ slug, w, cn }) => ({ slug, w, cn })) : []);

// The reminder line on 今天 (DESIGN 5.3). dictation.js homeReminders decides tonight (10 minutes after, until it is
// written once more) and the next morning (before noon); 'soon' is the wait before tonight's comes up.
export function dictationNotice(kv, now = new Date()) {
  const r = D.homeReminders(kv, now);
  if (r.tonight && r.tonight.words.length) return { kind: 'tonight', key: r.tonight.key, words: r.tonight.words, label: r.tonight.label };
  const key = D.recordKey(dayOf(now));
  const rec = kv.peek(key, null);
  if (rec && rec.remindAt && !rec.eveningDone && !rec.tonightDone) {
    const left = Math.ceil((new Date(rec.remindAt) - now) / 6e4);
    const words = wrongWords(rec);
    if (left > 0 && words.length) return { kind: 'soon', key, words, minutes: Math.min(D.REMIND_AFTER_MIN, left) };
  }
  if (r.morning && r.morning.words.length) return { kind: 'morning', key: r.morning.key, words: r.morning.words, label: r.morning.label };
  return null;
}

// A dictation tonight (written or not) makes it a dictation night: plan.js then recommends the light lesson
export const dictationToday = (kv, now = new Date()) => !!kv.peek(D.recordKey(dayOf(now)), null);

// ---- v1 additions

// Modules other agents write in parallel (weekly.js, intake.js): loaded on demand, so a file that is missing, renamed
// or broken never stops the page from drawing. Cached per path.
const optional = new Map();
export function optionalModule(path) {
  if (!optional.has(path)) {
    optional.set(path, import(path).catch(e => { console.warn('optional module', path + ':', (e && e.message) || e); return null; }));
  }
  return optional.get(path);
}

// The 写几个词 cell once it opens (DESIGN 2.2): what today holds. Keys are the write cell's mode from plan.js.
export const WRITE_KINDS = { spell: '拼几个词', spelling: '拼几个词', tiles: '拼几个词', tile: '拼几个词', keys: '拼几个词',
  grammar: '语法卡', 'grammar-card': '语法卡', card: '语法卡', phonics: '语音小卡', sound: '语音小卡', quiz: '小卷', sprint: '小卷',
  order: '连词成句', transform: '句型转换' };
// 读一段 once it opens (0.4.0): which episode, “第 2 集”; a light day reads it with 2 questions, after all six she reads one again
export function readNote(c) {
  if (!c || !c.n) return c && c.note ? c.note : '';
  if (c.again) return '今天的阅读';   // 0.8.0: all six read, 读一段 is the daily reading (daily-read.js)
  return c.short ? `第 ${c.n} 集 · 2 道题` : `第 ${c.n} 集`;
}
export function slotText(c) {
  const open = c.status === 'ready' || c.status === 'done';
  const kind = c.id === 'write' && open ? WRITE_KINDS[c.mode] || WRITE_KINDS[c.kind] || '' : '';
  const name = kind || c.label || CELL_LABELS[c.id] || '';
  const items = Array.isArray(c.items) ? c.items.length : 0;
  let note = '';
  if (c.status === 'done') note = '做完了';
  else if (c.status === 'soon') note = c.note || '下周开播';
  else if (c.status === 'skip') note = c.note || (c.id === 'write' ? '下周开播' : '今天不做');
  else if (c.id === 'warmup') note = items ? `${items} 张` : `${c.minutes} 分钟`;
  else if (c.id === 'wrap') note = '一个小问题';
  else if (c.id === 'read') note = readNote(c) || (c.minutes ? `${c.minutes} 分钟` : '');
  else if (kind === '连词成句' || kind === '句型转换') note = items ? `${items} 个句子` : '';
  else if (kind === '拼几个词') note = items ? `${items} 个词` : c.note || (c.minutes ? `${c.minutes} 分钟` : '');
  else if (kind) note = c.note || c.title || (c.minutes ? `${c.minutes} 分钟` : '');
  else note = c.note || (c.minutes ? `${c.minutes} 分钟` : '');
  return { name, note };
}

// 考前 3 天 the standard lesson becomes a short paper (DESIGN 2.2, 6.4); plan.js decides the day (sprint.js buildQuiz)
const quizCell = plan => (plan.cells || []).some(c => c && c.id === 'write' && c.mode === 'quiz' && c.status === 'ready');
export const isQuizDay = plan => !!(plan && !plan.light &&
  (plan.kind === 'quiz' || plan.kind === 'sprint' || !!plan.quiz || !!plan.sprint || quizCell(plan)));
export const startLabel = plan => (isQuizDay(plan) ? '开始今天的小卷' : plan && plan.light ? '开始轻松版' : '开始今天的课');

// “这周又能写出 9 个词” (DESIGN 6.4): words she wrote right this week for the first time. Written = a spelling event,
// a paper dictation she ticked, or an answer in a spelling mode; a word written right before this week does not count.
export const WRITE_MODES = ['tiles', 'keys', 'spell', 'paper'];
const isWritten = e => !!(e && e.correct === true && e.slug &&
  (e.type === 'spell' || e.type === 'dictation' || (e.type === 'answer' && WRITE_MODES.includes(e.mode))));
export function writtenThisWeek(events, now = new Date()) {
  const lo = dayOf(weekStart(now)), hi = dayOf(now);
  const before = new Set(), week = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    if (!isWritten(e)) continue;
    const d = String(e.at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hi) continue;
    (d < lo ? before : week).add(e.slug);
  }
  return [...week].filter(s => !before.has(s));
}
export const gainText = n => (n > 0 ? `这周又能写出 ${n} 个词。` : '');
const GAIN_LOOKBACK_DAYS = 56;   // “before this week” looks back 8 weeks (events are kept 180 days)

// ---- 0.8.0 “老师说 + 学一点” (lines.js talk): the context the talk lines read, and the 学一点 block (home and the wrap)

// days in a row with a lesson, counting back from today (or yesterday when today has none yet)
export function streakOf(days, now = new Date()) {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(dayOf(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayOf(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function talkCtx(ctx, now = new Date(), { slips = null } = {}) {
  const kv = ctx.kv;
  const c = { name: ((kv.peek('profile', {}) || {}).name) || 'Emma', hour: now.getHours(), now };
  const ex = examPhaseOf(kv.peek('progress', {}) || {}, now);
  if (ex) c.exam = ex;
  const unit = (kv.peek('progress', {}) || {}).unit;
  if (unit) c.unit = unit;
  try { c.level = kidDifficulty(kv, now).read; } catch (e) { /* fine */ }
  try { c.topics = kidPrefs(kv).topics || []; } catch (e) { /* fine */ }
  if (Array.isArray(slips) && slips.length) c.slips = slips;
  const streak = streakOf(lessonDays(kv), now);
  if (streak >= 3) c.streak = streak;
  return c;
}
// the 学一点 part under the teacher's line: label, the thing to learn, its explanation, listen and add to the word book
export function learnBlock(ctx, t, { step = 'look', cls = 'home-learn' } = {}) {
  if (!t || !t.learn || !t.learn.text) return null;
  const L = t.learn;
  const log = (action, extra = {}) => { try { const r = ctx.events.log(ctx.lines.talkEvent(t, action, { step, ...extra })); if (r && r.catch) r.catch(() => {}); } catch (e) { /* bookkeeping only */ } };
  let add = null;
  try {
    const entry = ctx.lines.wordbookEntry ? ctx.lines.wordbookEntry(t) : null;
    if (entry && entry.w) {
      const cand = ownCandidate(entry.w, { dict: ctx.dict, words: ctx.words });
      if (cand.status === 'inbook') add = h('span', { className: 'small muted', text: '单词本里有了' });
      else if (cand.status !== 'bad') {
        add = h('button', { type: 'button', className: 'home-pill', text: '加进单词本', on: { click: async ev => {
          const b = ev.currentTarget;
          b.disabled = true;
          try {
            const c = cand.status === 'nodict' ? { ...cand, cn: entry.cn || '' } : { ...cand, cn: cand.cn || entry.cn || '' };
            let e = ctx.words.get(c.slug) || null;
            if (!e) { await ctx.words.importData(ownExport(c, { typed: entry.w, where: entry.where || t.en })); e = ctx.words.get(c.slug) || null; }
            if (e && !e.favorited) await ctx.words.favorite(e.slug, true);
            b.textContent = '已加进单词本';
            log('add', entry.w ? { w: entry.w } : {});
          } catch (err) { b.disabled = false; try { ctx.toast('没加上，再点一次。'); } catch (e2) { /* ignore */ } }
        } } });
      }
    }
  } catch (e) { add = null; }
  return h('div', { className: cls },
    h('p', { className: cls + '-label', text: '学一点' + (t.kindZh ? ' · ' + t.kindZh : '') }),
    h('p', { className: cls + '-text', lang: 'en', text: L.text }),
    L.zh ? h('p', { className: cls + '-zh', lang: 'zh-CN', text: L.zh }) : null,
    h('div', { className: 'home-pills' },
      h('button', { type: 'button', className: 'home-pill', on: { click: ev => { ctx.say(L.say || L.text, ev.currentTarget); log('listen'); } } }, icon('speak'), h('span', { text: '听一遍' })),
      add));
}

// ---- 0.9.0 the three cards (今天的课 · 今天的阅读 · 接着练)

// the four cells of the day as one small line in card ①: [{ id, name, status }]
export function cellLine(plan) {
  return ((plan && plan.cells) || []).filter(c => c && c.id).map(c => ({ id: c.id, name: slotText(c).name, status: c.status || 'ready' }));
}
// 'todo' nothing done yet, 'going' part of it done, 'done' the wrap is done
export function lessonState(plan) {
  const cells = (plan && plan.cells) || [];
  if (cells.some(c => c && c.id === 'wrap' && c.status === 'done')) return 'done';
  return cells.some(c => c && c.status === 'done') ? 'going' : 'todo';
}
// the button on card ①
export function cardStart(plan) {
  const st = lessonState(plan);
  if (st === 'done') return '再来一节';
  if (isQuizDay(plan)) return st === 'going' ? '接着做小卷' : '开始小卷';
  return st === 'going' ? '接着上' : '开始';
}
// the words today's reading teaches: the new ones first, then the ones it brings back; five at most
export function pieceWords(piece, max = 5) {
  const seen = new Set();
  const list = Array.isArray(piece && piece.targets) ? piece.targets : [];
  const order = t => (t && t.kind === 'review' ? 1 : 0);
  return list.filter(t => t && t.w).slice().sort((a, b) => order(a) - order(b))
    .filter(t => { const k = String(t.w).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max).map(t => ({ w: t.w, zh: t.zh || '' }));
}
// card ② from daily-read.js dayState (st) and homeLine (line); fb is the story it falls back on ({ episodeId, n, again })
//   -> { status: 'ready' | 'writing' | 'none' | 'done', title, text, sub, words, go, more, wait?, fb, fbLabel }
//   wait: the first one is read and the next one is being written (the daily page waits for it)
export function readModel(st, line = null, fb = null) {
  const story = fb && fb.episodeId && fb.n ? fb : null;
  const fbLabel = story ? `${story.again ? '再读' : ''}番外第 ${story.n} 集` : '';
  const base = { status: 'none', title: '', text: '', sub: '', words: [], go: '去读', more: false, fb: story, fbLabel };
  const fbSub = story ? (story.again ? `先再读一遍番外第 ${story.n} 集。` : `先读番外第 ${story.n} 集。`) : '先读一篇现成的。';
  const pieces = st && Array.isArray(st.pieces) ? st.pieces : [];
  if (st && st.ready) {
    const p = st.ready;
    const sub = line && line.status === 'ready' && line.sub ? line.sub : (p.topic && p.topic.zh) || '';
    return { ...base, status: 'ready', title: (p.passage && p.passage.title) || '', text: (p.passage && p.passage.title_zh) || '', sub, words: pieceWords(p), fb: null, fbLabel: '' };
  }
  if (st && st.writing) {
    if (pieces.length) return { ...base, status: 'writing', text: '老师在写下一篇。', sub: '写好了就能读。', go: '去看看', wait: true, fb: null, fbLabel: '' };
    return { ...base, status: 'writing', text: '老师正在写今天这篇。', sub: fbSub };
  }
  if (pieces.length) {
    const read = pieces.filter(p => p && p.read && p.read.done);
    const last = read[read.length - 1] || pieces[pieces.length - 1];
    const n = Number(st.readCount) || read.length;
    return { ...base, status: 'done', title: (last && last.passage && last.passage.title) || '', text: n ? `今天读了 ${n} 篇。` : '今天的读过了。',
      sub: st.canMore ? '还想读，老师再写一篇。' : '今天读够了，明天有新的。', go: st.canMore ? '再来一篇' : '读读别的', more: !!st.canMore, fb: null, fbLabel: '' };
  }
  return { ...base, text: '今天这篇还没写好。', sub: fbSub };
}
// which card the teacher would pick first: the lesson until it is done, then today's reading, then 接着练
export function primaryCard(lesson, read) {
  if (lesson !== 'done') return 'lesson';
  return read === 'ready' ? 'read' : 'practice';
}
// call fn once when a layer (the daily reading's) is hidden again
export function whenHidden(el, fn) {
  if (!el || typeof fn !== 'function' || typeof MutationObserver !== 'function') return false;
  const mo = new MutationObserver(() => { if (el.hidden || !el.isConnected) { mo.disconnect(); fn(); } });
  mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  return true;
}

// ---------------------------------------------------------------- view

export function createHomeTab(ctx) {
  const root = document.getElementById('tab-home');
  root.replaceChildren();
  const statusSlot = h('div', { className: 'status-slot' });
  const phase = h('span', { className: 'runhead-meta home-phase' });
  const body = h('div', { className: 'home-body' });
  root.append(h('div', { className: 'home' },
    h('header', { className: 'runhead' }, h('h1', { className: 'runhead-title' }, 'Emma', h('span', { className: 'sub', text: ' 的英语老师' })),
      // 0.7.0: 孩子端“我” (ui-kid-me.js) in the top right corner, where she looks first
      h('div', { className: 'home-head-r' }, phase,
        h('button', { type: 'button', className: 'home-me', 'aria-label': '我：学到哪、考试、喜欢的', on: { click: () => ctx.go('kidme') } }, '我'))),
    statusSlot, body));
  ctx.statusSlot(statusSlot);

  // one greeting a day: picked (and counted as seen) on the first visit of the day, redrawn as is afterwards
  let line = null;
  let lineDay = '';
  const profile = () => ctx.kv.peek('profile', {}) || {};

  const planExtra = () => ({ lessonDays: lessonDays(ctx.kv), ...(dictationToday(ctx.kv) ? { dictationTonight: true } : {}) });

  function pickLine(now, days, plan) {
    const name = profile().name || 'Emma';
    const back = plan && plan.comeback !== undefined ? !!plan.comeback : missedDays(days, now) > 0;
    // the first visit of the day can come after the lesson (the first open goes straight into it): say goodbye then
    const done = !!(plan && plan.cells && plan.cells.some(c => c.id === 'wrap' && c.status === 'done'));
    // the exam season (lines.js examPhase): the night before it is “go to bed early”, before the 21:00 line; the
    // other phases mix the exam lines with the everyday hellos
    const ex = examPhaseOf(ctx.kv.peek('progress', {}) || {}, now);
    const scene = done ? 'close' : ex === 'eve' ? 'exam' : now.getHours() >= 21 ? 'late' : back ? 'back' : ex ? ['exam', 'open'] : 'open';
    const c = { name, day: dayNumber(days, now), hour: now.getHours(), ...(ex ? { exam: ex } : {}) };
    // 0.8.0: “老师说 + 学一点” first (lines.js talk: different every time, something to learn); the old lines are the fallback
    let t = null;
    try { t = ctx.lines.talk ? ctx.lines.talk(scene, talkCtx(ctx, now, { slips })) : null; } catch (e) { t = null; }
    line = t || ctx.lines.pick(scene, c) || (scene !== 'open' ? ctx.lines.pick('open', c) : null);
    lineDay = dayOf(now);
    if (t) {
      ctx.lines.markTalk(t);
      try { const r = ctx.events.log(ctx.lines.talkEvent(t, 'show', { step: 'look' })); if (r && r.catch) r.catch(() => {}); } catch (e) { /* fine */ }
    } else if (line) ctx.lines.markSeen(line.id);
  }
  // her slips of the last three days, for the personal talk lines (read once per visit, used by the next pick)
  let slips = null;
  async function loadSlips(now) {
    try {
      if (!ctx.lines.talk) return;
      const { slipsFrom } = await import('./lines.js');
      const since = new Date(now.getTime() - 3 * 864e5);
      const list = await ctx.events.query({ since, type: 'answer', limit: 5000 });
      slips = slipsFrom(list, { now, word: slug => { const e = ctx.words.get(slug); return e ? { w: e.headword, cn: e.brief_cn || '' } : null; } });
    } catch (e) { slips = null; }
  }

  function greeting() {
    if (!line) return null;
    const l = line;
    // the prototype Wei approved: “老师说”, the English line in large serif, then two pills (listen, show or hide Chinese).
    // Opening the Chinese counts as a tap for the fade rule (DESIGN 2.5); hiding it again does not.
    const zh = h('p', { className: 'home-zh', lang: 'zh-CN', text: l.zh, hidden: !l.showZh });
    const zhBtn = !l.zh ? null : h('button', { type: 'button', className: 'home-pill', text: l.showZh ? '收起中文' : '看中文',
      on: { click: ev => {
        const open = zh.hidden;
        zh.hidden = !open;
        l.showZh = open;
        ev.currentTarget.textContent = open ? '收起中文' : '看中文';
        if (open) (ctx.lines.tapZh || ctx.lines.markZhTapped || (() => {}))(l.id);
        if (open && l.learn) { try { const r = ctx.events.log(ctx.lines.talkEvent(l, 'zh', { step: 'look' })); if (r && r.catch) r.catch(() => {}); } catch (e) { /* fine */ } }
      } } });
    const listen = ev => {
      ctx.say(l.en, ev.currentTarget);
      if (l.learn) { try { const r = ctx.events.log(ctx.lines.talkEvent(l, 'listen', { step: 'look', part: 'en' })); if (r && r.catch) r.catch(() => {}); } catch (e) { /* fine */ } }
    };
    return h('div', { className: 'home-hello' },
      h('p', { className: 'home-label', text: '老师说' }),
      h('p', { className: 'home-en', lang: 'en', text: l.en }),
      zh,
      h('div', { className: 'home-pills' },
        h('button', { type: 'button', className: 'home-pill', on: { click: listen } }, icon('speak'), h('span', { text: '听一遍' })),
        zhBtn),
      l.learn ? learnBlock(ctx, l, { step: 'look' }) : null);
  }

  function noticeRow(n) {
    if (!n) return null;
    const count = n.words.length;
    if (n.kind === 'tonight') {
      return h('div', { className: 'home-notice', role: 'status' }, icon('pen'),
        h('span', { text: `${n.label || '再写一次错的'} ${count} 个，1 分钟。` }),
        h('button', { type: 'button', className: 'text-btn accent', text: '现在写', on: { click: () => ctx.go('dictation', { retry: true }) } }));
    }
    if (n.kind === 'soon') {
      return h('div', { className: 'home-notice quiet', role: 'status' }, icon('clock'),
        h('span', { text: `约 ${n.minutes} 分钟后，再写一次错的 ${count} 个。` }));
    }
    return h('div', { className: 'home-notice', role: 'status' }, icon('sun'),
      h('span', { text: `出门前看一眼昨晚错的 ${count} 个。` }),
      h('button', { type: 'button', className: 'text-btn accent', text: '看一眼', on: { click: () => ctx.go('dictation', { glance: true }) } }));
  }

  // ---- 0.9.0 three cards under the greeting (Wei 10-26: 每日阅读和接着练要一眼看到，不要死板的固定流程):
  // ① 今天的课 ② 今天的阅读 ③ 接着练. Each can be tapped any time; the one the teacher would pick first gets the filled
  // button and the accent line on top (primaryCard). The four cells of the day shrink to one small line in ①.
  const cardCls = (kind, primary) => `home-card home-card-${kind}${primary ? ' primary' : ''}`;
  const goCls = primary => 'btn home-go' + (primary ? '' : ' home-quiet');

  function cellsLine(plan) {
    const cells = cellLine(plan);
    if (!cells.length) return null;
    const out = [];
    cells.forEach((c, i) => {
      if (i) out.push(h('span', { className: 'home-cells-dot', 'aria-hidden': 'true', text: '·' }));
      out.push(h('span', { className: `home-cell ${c.status}` }, c.status === 'done' ? icon('check') : null, h('span', { text: c.name })));
    });
    return h('p', { className: 'home-cells', 'aria-label': '今天的四步：' + cells.map(c => c.name + (c.status === 'done' ? '做完了' : '')).join('、') }, ...out);
  }

  function lessonCard(plan, primary) {
    const st = lessonState(plan);
    const label = h('p', { className: 'home-card-label', text: '今天的课' });
    if (st === 'done') {
      const again = !!(plan.counts && plan.counts.total > 0);
      return h('section', { className: cardCls('lesson', primary), 'aria-label': '今天的课' },
        label,
        h('p', { className: 'home-card-big', text: '做完了' }),
        h('p', { className: 'home-card-text', text: again ? '还想练，就再来一节轻松的。' : '明天见。' }),
        cellsLine(plan), gainLine(),
        again ? h('div', { className: 'home-card-go' },
          h('button', { type: 'button', className: goCls(primary), text: '再来一节', on: { click: () => ctx.go('lesson', { light: true, again: true }) } })) : null);
    }
    // plan.js decides the light lesson (DESIGN 2.2, 2.3): after 21:00, a dictation night, the day before the exam,
    // coming back after a gap, a heavy homework day (parent's form). Only those two defaults can be switched back.
    // 考前小卷 (plan.quiz / plan.sprint): ui-lesson.js reads the same plan; params.sprint is its own name for it
    const quiz = isQuizDay(plan);
    const start = h('button', { type: 'button', className: goCls(primary), text: cardStart(plan),
      on: { click: () => ctx.go('lesson', quiz ? { light: false, sprint: true } : { light: !!plan.light }) } });
    let alt = null;
    if (st === 'todo' && plan.light && (plan.lightReason === 'comeback' || plan.lightReason === 'busy')) {
      const std = ctx.todayPlan({ ...planExtra(), standard: true });
      if (!std.light && std.minutes) alt = h('button', { type: 'button', className: 'text-btn accent home-alt', text: `标准版 · ${std.minutes} 分钟`, on: { click: () => ctx.go('lesson', { standard: true }) } });
    } else if (st === 'todo' && !plan.light && plan.lightMinutes && plan.lightMinutes < plan.minutes) {
      alt = h('button', { type: 'button', className: 'text-btn accent home-alt', text: `轻松版 · ${plan.lightMinutes} 分钟`, on: { click: () => ctx.go('lesson', { light: true }) } });
    }
    const n = x => h('span', { className: 'n', text: String(x) });
    const why = plan.reason || plan.why || '';
    return h('section', { className: cardCls('lesson', primary), 'aria-label': '今天的课' },
      label,
      plan.minutes ? h('p', { className: 'home-card-big' }, plan.light ? '今晚约 ' : '约 ', n(plan.minutes), ' 分钟')
        : h('p', { className: 'home-card-big', text: '准备好了' }),
      plan.summary ? h('p', { className: 'home-card-text', text: plan.summary }) : null,
      why ? h('p', { className: 'home-card-sub', text: why }) : null,
      cellsLine(plan), gainLine(),
      h('div', { className: 'home-card-go' }, start, alt));
  }

  // ② today's reading (daily-read.js). Ready: its title, topic, minutes and the new words. Still being written (or not
  // written today): the story it falls back on, read straight away through 接着练's reading round.
  const mockOn = () => { try { return !!((ctx.settings && ctx.settings()) || {}).mock || !!(ctx.mockForced && ctx.mockForced()); } catch (e) { return false; } };
  let readTimer = null;
  function readNow(now) {
    const mock = mockOn();
    let st = null, line = null, fb = null;
    try { st = DR.dayState(mock ? null : ctx.kv, now, { mock }); line = DR.homeLine(mock ? null : ctx.kv, now, { mock }); } catch (e) { st = null; }
    if (!st || !st.ready) {
      try {
        const c = RD.content();
        const f = c ? DR.pickFallback({ kv: ctx.kv, content: c, passages: [], now }) : null;
        if (f && f.kind === 'story') { const ep = c.episode(f.episodeId); if (ep) fb = { ...f, n: ep.n }; }
      } catch (e) { fb = null; }
    }
    return readModel(st, line, fb);
  }
  function openDaily(params = {}) {
    const dr = ctx.dailyRead;
    if (!dr || typeof dr.open !== 'function') { if (ctx.practice) ctx.practice.start('read'); return; }
    dr.open(params);
    whenHidden(dr.el, () => { if (ctx.currentRoute() === 'home') render(); });
  }
  function readGo(m) {
    if (m.status === 'ready') return openDaily();
    if (m.status === 'done') return m.more ? openDaily({ more: true }) : (ctx.practice ? ctx.practice.start('read') : openDaily());
    if (m.wait) return openDaily();
    // not written yet: the story it falls back on, at once (the reading round of 接着练); anything else, the daily page's own fallback
    if (m.fb && ctx.practice && typeof ctx.practice.start === 'function') {
      ctx.practice.start('read', { option: { kind: 'episode', id: m.fb.episodeId, label: m.fbLabel, again: !!m.fb.again, minutes: 6 } });
      return;
    }
    openDaily({ fallback: true });
  }
  function readCard(m, primary) {
    const words = m.words.length ? h('div', { className: 'home-words' },
      h('p', { className: 'home-words-label', text: `要学的 ${m.words.length} 个词` }),
      h('ul', { className: 'home-chips' }, ...m.words.map(w => h('li', { className: 'home-chip' },
        h('span', { className: 'home-chip-w', lang: 'en', text: w.w }), w.zh ? h('span', { className: 'home-chip-zh', text: w.zh }) : null)))) : null;
    const other = m.status === 'done' && m.more && ctx.practice
      ? h('button', { type: 'button', className: 'text-btn accent home-alt', text: '读读别的', on: { click: () => ctx.practice.start('read') } }) : null;
    return h('section', { className: cardCls('read', primary), 'aria-label': '今天的阅读' },
      h('p', { className: 'home-card-label', text: '今天的阅读' }),
      m.title ? h('p', { className: 'home-card-title', lang: 'en', text: m.title }) : null,
      m.text ? h('p', { className: 'home-card-text', text: m.text }) : null,
      m.sub ? h('p', { className: 'home-card-sub', text: m.sub }) : null,
      words,
      h('div', { className: 'home-card-go' },
        h('button', { type: 'button', className: goCls(primary), text: m.go, on: { click: () => readGo(m) } }), other));
  }

  // ③ 接着练 (ui-practice.js, app.practice): the hub draws the teacher's pick (card mode); compact = not the first pick,
  // so its button is an outline. The small entries under it are drawn here.
  function practiceSlot(compact) {
    const P = ctx.practice;
    if (!P || typeof P.mount !== 'function') return null;
    const slot = h('div', { className: 'home-practice' });
    try { P.mount(slot, { card: true, compact, onClose: () => { if (ctx.currentRoute() === 'home') render(); } }); } catch (e) { console.warn('home: practice:', (e && e.message) || e); return null; }
    return slot;
  }
  function miniEntries(now) {
    const P = ctx.practice && typeof ctx.practice.start === 'function' ? ctx.practice : null;
    const btn = (text, click, n = 0) => h('button', { type: 'button', className: 'text-btn home-mini-btn', on: { click } },
      h('span', { text }), n > 0 ? h('span', { className: 'home-mini-n', text: String(n) }) : null);
    const items = [];
    let fading = 0, due = 0, rp = null;
    try { fading = fadingWords(ctx.words.favorites(), now).length; } catch (e) { fading = 0; }
    try { due = (mistakesSummary(ctx.kv, now) || {}).due || 0; } catch (e) { due = 0; }
    try { rp = reviewActive(ctx.kv, now); } catch (e) { rp = null; }
    if (P) items.push(btn('练不熟的词', () => P.start('words'), fading));
    // mistakes due today go to the 错题 tab's own review (it counts for the 1, 3, 7 days); otherwise a free round here
    items.push(btn('错题', () => (due > 0 || !P ? ctx.go('mistakes', { review: true }) : P.start('mistakes')), due));
    if (P) items.push(btn('语法', () => P.start('grammar')));
    items.push(btn('听写', () => ctx.go('dictation')));
    items.push(rp ? btn('接着复习', () => ctx.go('revise', { start: true })) : btn('复习考试', () => ctx.go('revise')));
    return h('nav', { className: 'home-mini', 'aria-label': '自己挑一样练' }, ...items);
  }
  function practiceCard(now, primary) {
    const slot = primary ? practiceSlot(false) : practiceSlot(true);
    return h('section', { className: cardCls('practice', primary), 'aria-label': '接着练' },
      h('p', { className: 'home-card-label', text: '接着练' }),
      slot || h('p', { className: 'home-card-text', text: '挑一样，练几分钟。' }),
      miniEntries(now));
  }

  // the piece is written in the background (app.js prepareDaily, about a minute): while it is not there yet, look again
  // every 5 seconds and redraw only when card ② would change; 'none' gives up after about 3 minutes
  let readKey = '', readTicks = 0;
  function watchRead(m) {
    readKey = m.status + '|' + m.title;
    if (readTimer || !(m.status === 'writing' || m.status === 'none')) return;
    if (m.status === 'none' && readTicks >= 36) return;
    readTimer = setTimeout(() => {
      readTimer = null;
      readTicks++;
      if (ctx.currentRoute() !== 'home') return;
      const n = readNow(new Date());
      if (n.status + '|' + n.title !== readKey) render(); else watchRead(n);
    }, 5000);
  }
  function cards(now, plan) {
    const m = readNow(now);
    watchRead(m);
    const first = primaryCard(lessonState(plan), m.status);
    return h('div', { className: 'home-cards' },
      lessonCard(plan, first === 'lesson'), readCard(m, first === 'read'), practiceCard(now, first === 'practice'));
  }

  // ---- v1: the weekly gain and the weekly summary, both found asynchronously and drawn when they arrive
  let gain = '';
  let gainAt = 0;
  let weeklyOn = false;
  const gainLine = () => (gain ? h('p', { className: 'home-gain', text: gain }) : null);
  function weeklyRow() {
    if (!weeklyOn) return null;
    return h('div', { className: 'home-notice home-weekly', role: 'status' }, icon('note'),
      h('span', { text: '这周小结出来了。' }),
      h('button', { type: 'button', className: 'text-btn accent', text: '看看', on: { click: () => ctx.go('weekly') } }));
  }
  async function checkGain(now, force) {
    if (!force && Date.now() - gainAt < 30000) return;
    gainAt = Date.now();
    let text = gain;
    try {
      const since = dayOf(addDays(weekStart(now), -GAIN_LOOKBACK_DAYS));
      const list = await ctx.events.query({ since, type: ['spell', 'dictation', 'answer'], limit: 100000 });
      // sprint.js weeklyGains is plan's own count (it also has “这周又认出了 N 个词”); this file's rule if it is not there
      const S = await optionalModule('./sprint.js');
      const g = S && typeof S.weeklyGains === 'function' ? S.weeklyGains(list, now) : null;
      text = g ? String(g.line || '') : gainText(writtenThisWeek(list, now).length);
      if (text && !/[。！]$/.test(text)) text += '。';
    } catch (e) { console.warn('home: gain:', (e && e.message) || e); }
    if (text !== gain) { gain = text; if (ctx.currentRoute() === 'home') render(); }
  }
  // weekly.js hasNewWeekly(kv, now): from Sunday evening until she has opened it. Only with a 'weekly' route.
  async function checkWeekly(now) {
    let on = false;
    if (ROUTES.weekly) {
      const W = await optionalModule('./weekly.js');
      if (W && typeof W.hasNewWeekly === 'function') {
        try { on = !!(await W.hasNewWeekly(ctx.kv, now)); } catch (e) { console.warn('home: weekly:', (e && e.message) || e); }
      }
    }
    if (on !== weeklyOn) { weeklyOn = on; if (ctx.currentRoute() === 'home') render(); }
  }
  function refresh(force) {
    const now = new Date();
    checkGain(now, force);
    checkWeekly(now);
    if (force) loadSlips(now);
  }

  function links(now, days, plan) {
    const goal = (plan.week && plan.week.goal) || Number(profile().weeklyGoal) || 0;
    const done = plan.week && typeof plan.week.days === 'number' ? plan.week.days : weekCount(days, now);
    const week = goal ? `这周 ${done} / ${goal} 天` : `这周 ${done} 天`;
    const tapWeek = () => {
      // v1: the week line opens 这周小结 (any day of the week, not only from Sunday evening)
      if (ROUTES.weekly) { ctx.go('weekly'); return; }
      const list = weekList(days, now).map(d => { const [y, m, dd] = d.split('-').map(Number); return WEEK[new Date(y, m - 1, dd).getDay()]; });
      ctx.toast(list.length ? `这周练了：${list.join('、')}` : (goal ? `这周的目标是 ${goal} 天` : '这周还没开始'), 2400);
    };
    // 0.9.0: 听写 moved onto the 接着练 card; 课文陪读 (0.5.0, ui-textread.js: photograph a page of the textbook and read it
    // sentence by sentence; its first page lists the pages read before) is one link here
    const tr = ctx.textread && typeof ctx.textread.open === 'function' ? ctx.textread : null;
    return h('nav', { className: 'home-links', 'aria-label': '其他入口' },
      ROUTES.chat ? h('button', { type: 'button', className: 'text-btn home-link', text: '问老师', on: { click: () => ctx.go('chat') } }) : null,
      h('button', { type: 'button', className: 'text-btn home-link', text: '查词', on: { click: () => ctx.go('look') } }),
      tr ? h('button', { type: 'button', className: 'text-btn home-link', text: '课文陪读', on: { click: () => tr.open() } }) : null,
      h('button', { type: 'button', className: 'text-btn home-week', on: { click: tapWeek } }, h('span', { text: week })));
  }

  function render() {
    const now = new Date();
    const days = lessonDays(ctx.kv);
    const plan = ctx.todayPlan(planExtra());
    if (!line || lineDay !== dayOf(now)) pickLine(now, days, plan);
    const titleOf = id => { try { const u = ctx.curriculum.units().find(x => x.id === id); return u ? u.title : id; } catch (e) { return id; } };
    // v1 plans say when the season is on (plan.season.label, empty outside the 14 days before the exam); no countdown here
    const prog = ctx.kv.peek('progress', {}) || {};
    const season = plan && plan.season && typeof plan.season === 'object' ? plan.season : null;
    phase.textContent = season ? (season.label || phaseText({ unit: prog.unit }, now, titleOf)) : phaseText(prog, now, titleOf);
    let notice = null;
    try { notice = dictationNotice(ctx.kv, now); } catch (e) { console.warn('home: dictation notice:', (e && e.message) || e); }
    body.replaceChildren(...[noticeRow(notice), weeklyRow(), greeting(), cards(now, plan), links(now, days, plan)].filter(Boolean));
  }

  return {
    show() { readTicks = 0; render(); refresh(true); },
    onChange() { if (ctx.currentRoute() === 'home') { render(); refresh(false); } },
  };
}
