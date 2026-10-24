// 今天（首页，DESIGN 2.0 的草图）：书眉“Emma 的英语老师”，右上是当前阶段（“期中季 · S 到 U3”，没设就不显示）；
// 老师的英文招呼一行（千问读，中文字幕按 lines.shouldShowZh，点“看中文”展开）；“今天约 12 分钟”和一句为什么；
// 一个主按钮“开始今天的课”，下面文字入口“轻松版 8 分钟”；底部一行：明天有听写？、查词、这周 3 / 5 天。
// 听写提醒（“再写一次错的”“出门前看一眼”，dictation.js homeReminders）放在招呼上面一行。轻松版由 plan.js 定
// （21:00 以后、有听写的晚上、考前一天、漏了一天回来）；回归日可以改点“标准版”。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/home.css、css/lesson.css、css/dictation.css）。
//
// 导出
//   createHomeTab(ctx) -> { show(params), onChange() }
//     渲染进 #tab-home（index.html）。show 每次切到“今天”时调用；onChange 在词或设置变了以后调用（app.js 节流过）。
//   纯函数（Node 里测，tests/ui-today.test.mjs；ui-lesson.js、ui-dictation.js 也用）：
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
//
// 用到的 ctx（CONTRACTS.md）：todayPlan({ lessonDays, standard })、lines.pick / markSeen / shouldShowZh / tapZh、say、
// go('lesson', { light }) / go('dictation', params) / go('look')、kv.peek / keys、statusSlot(el)、curriculum、toast。
// 样式写在 css/home.css，类名一律以 home- 开头。
import { h, icon } from './ui-dom.js';
import { dayOf } from './plan.js';
import * as D from './dictation.js';

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

// ---------------------------------------------------------------- view

export function createHomeTab(ctx) {
  const root = document.getElementById('tab-home');
  root.replaceChildren();
  const statusSlot = h('div', { className: 'status-slot' });
  const phase = h('span', { className: 'runhead-meta home-phase' });
  const body = h('div', { className: 'home-body' });
  root.append(h('div', { className: 'home' },
    h('header', { className: 'runhead' }, h('h1', { className: 'runhead-title' }, 'Emma', h('span', { className: 'sub', text: ' 的英语老师' })), phase),
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
    const scene = done ? 'close' : now.getHours() >= 21 ? 'late' : back ? 'back' : 'open';
    const c = { name, day: dayNumber(days, now), hour: now.getHours() };
    line = ctx.lines.pick(scene, c) || (scene !== 'open' ? ctx.lines.pick('open', c) : null);
    lineDay = dayOf(now);
    if (line) ctx.lines.markSeen(line.id);
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
      } } });
    return h('div', { className: 'home-hello' },
      h('p', { className: 'home-label', text: '老师说' }),
      h('p', { className: 'home-en', lang: 'en', text: l.en }),
      zh,
      h('div', { className: 'home-pills' },
        h('button', { type: 'button', className: 'home-pill', on: { click: ev => ctx.say(l.en, ev.currentTarget) } }, icon('speak'), h('span', { text: '听一遍' })),
        zhBtn));
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

  function planBlock(now, plan) {
    const n = x => h('span', { className: 'n', text: String(x) });
    const wrapCell = plan.cells.find(c => c.id === 'wrap');
    if (wrapCell && wrapCell.status === 'done') {
      const again = plan.counts && plan.counts.total > 0;
      return h('section', { className: 'home-plan' },
        h('p', { className: 'lede', text: '今天的课上完了。' }),
        h('p', { className: 'home-summary', text: '明天见。' }),
        again ? h('div', { className: 'home-actions' },
          h('button', { type: 'button', className: 'text-btn accent', text: '再练一会儿', on: { click: () => ctx.go('lesson', { light: true, again: true }) } })) : null);
    }
    // plan.js decides the light lesson (DESIGN 2.2, 2.3): after 21:00, a dictation night, the day before the exam,
    // coming back after a gap. Only the comeback default can be switched back to the standard lesson.
    const start = h('button', { type: 'button', className: 'btn home-start', text: plan.light ? '开始轻松版' : '开始今天的课', on: { click: () => ctx.go('lesson', { light: !!plan.light }) } });
    let alt = null;
    if (plan.light && plan.lightReason === 'comeback') {
      const std = ctx.todayPlan({ ...planExtra(), standard: true });
      if (!std.light && std.minutes) alt = h('button', { type: 'button', className: 'text-btn accent', text: `标准版 · ${std.minutes} 分钟`, on: { click: () => ctx.go('lesson', { standard: true }) } });
    } else if (!plan.light && plan.lightMinutes && plan.lightMinutes < plan.minutes) {
      alt = h('button', { type: 'button', className: 'text-btn accent', text: `轻松版 · ${plan.lightMinutes} 分钟`, on: { click: () => ctx.go('lesson', { light: true }) } });
    }
    const why = plan.reason || plan.why || '';
    return h('section', { className: 'home-plan' },
      plan.minutes ? h('p', { className: 'home-minutes' }, plan.light ? '今晚约 ' : '今天约 ', n(plan.minutes), ' 分钟') : h('p', { className: 'home-minutes', text: '今天的课准备好了' }),
      plan.summary ? h('p', { className: 'home-summary', text: plan.summary }) : null,
      why ? h('p', { className: 'home-why', text: why }) : null,
      slots(plan),
      h('div', { className: 'home-actions' }, start, alt));
  }

  // the four cells of the day in one row (DESIGN 2.0): a line on top, dark for what she can do today, light for what
  // has not opened yet (v0: 读一段、写几个词 “下周开播”)
  function slots(plan) {
    const note = c => {
      if (c.status === 'done') return '做完了';
      if (c.status === 'soon') return c.note || '下周开播';
      if (c.status === 'skip') return c.id === 'write' ? '下周开播' : (c.note || '今天不做');
      if (c.id === 'warmup') return c.items && c.items.length ? `${c.items.length} 张` : `${c.minutes} 分钟`;
      if (c.id === 'wrap') return '一个小问题';
      return c.minutes ? `${c.minutes} 分钟` : '';
    };
    const cells = (plan.cells || []).filter(c => c && c.id);
    if (!cells.length) return null;
    return h('div', { className: 'home-slots', role: 'list', 'aria-label': '今天的四格' },
      ...cells.map(c => h('div', { className: `home-slot ${c.status}`, role: 'listitem' },
        h('div', { className: 'home-slot-name', text: c.label }),
        h('div', { className: 'home-slot-note', text: note(c) }))));
  }

  function links(now, days, plan) {
    const goal = (plan.week && plan.week.goal) || Number(profile().weeklyGoal) || 0;
    const done = plan.week && typeof plan.week.days === 'number' ? plan.week.days : weekCount(days, now);
    const week = goal ? `这周 ${done} / ${goal} 天` : `这周 ${done} 天`;
    const tapWeek = () => {
      const list = weekList(days, now).map(d => { const [y, m, dd] = d.split('-').map(Number); return WEEK[new Date(y, m - 1, dd).getDay()]; });
      ctx.toast(list.length ? `这周练了：${list.join('、')}` : (goal ? `这周的目标是 ${goal} 天` : '这周还没开始'), 2400);
    };
    return h('nav', { className: 'home-links', 'aria-label': '其他入口' },
      h('button', { type: 'button', className: 'text-btn home-link', text: '明天有听写？', on: { click: () => ctx.go('dictation') } }),
      h('button', { type: 'button', className: 'text-btn home-link', text: '查词', on: { click: () => ctx.go('look') } }),
      h('button', { type: 'button', className: 'text-btn home-week', on: { click: tapWeek } }, h('span', { text: week })));
  }

  function render() {
    const now = new Date();
    const days = lessonDays(ctx.kv);
    const plan = ctx.todayPlan(planExtra());
    if (!line || lineDay !== dayOf(now)) pickLine(now, days, plan);
    const titleOf = id => { try { const u = ctx.curriculum.units().find(x => x.id === id); return u ? u.title : id; } catch (e) { return id; } };
    phase.textContent = phaseText(ctx.kv.peek('progress', {}) || {}, now, titleOf);
    let notice = null;
    try { notice = dictationNotice(ctx.kv, now); } catch (e) { console.warn('home: dictation notice:', (e && e.message) || e); }
    body.replaceChildren(...[noticeRow(notice), greeting(), planBlock(now, plan), links(now, days, plan)].filter(Boolean));
  }

  return {
    show() { render(); },
    onChange() { if (ctx.currentRoute() === 'home') render(); },
  };
}
