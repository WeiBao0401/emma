// 今天的课（DESIGN 2.0-2.3、5.1）：每天四格，热身 → 读一段 → 写几个词 → 收尾。决定热身出哪些卡（按优先级、
// 时长封顶）、今天开几个新词、轻松版、21:00 以后只推轻松版、首页那句“为什么今天练这个”。
// 负责：今天的课 agent（plan.js）。
// 状态：骨架。返回的形状已定，内容是最简单的占位规则（到期卡按到期时间排，封顶 20 张）；优先级、新词数、
// 轻松版、听写晚上换轻松版这些规则由负责的 agent 补。
//
// 纯函数，不碰 DOM、不读数据库，Node 里直接测。app.js / ui-home.js 拼好 state 再调用。
//
// planToday(state, now = new Date()) -> Plan
//   state = {
//     words: [{ slug, headword, unit, tier, due, isNew, reps, lapses, write, scope }],
//         unit   课本单元 id 或 null（curriculum.unitOf）
//         tier   'primary' | 'required' | 'recognize' | 'extra'（curriculum.tierOf）
//         due    FSRS 下次到期时间 ISO，没卡为 null
//         isNew  还没学过的新卡
//         reps / lapses   FSRS 的复习次数 / 忘记次数
//         write  “写得出”线开着没有（v0 先都是 false）
//         scope  在期中范围或当前单元里
//     newPerDay,          每天新词上限（settings.newPerDay）
//     newDoneToday,       今天已经开过几个新词（words.newDoneToday()）
//     doneToday: { warmup?, read?, write?, wrap? }   今天哪几格做完了（kv 'day:<YYYY-MM-DD>'.cells）
//     light,              她点了“轻松版”
//     dictationTonight,   今晚有听写（kv 'dictation:<YYYY-MM-DD>' 存在且没做完）
//     progress: { unit, examFrom, examTo, examDate }   家长区填的进度（kv 'progress'）
//     weekDays, weekGoal  这周做了几天 / 她定的目标
//   }
//
//   Plan = {
//     date: 'YYYY-MM-DD',
//     light: bool,                       这次是不是轻松版
//     minutes: number,                   今天约几分钟（首页“今天约 12 分钟”）
//     lightMinutes: number,              轻松版约几分钟（首页“轻松版 8 分钟”）
//     cells: [Cell × 4],                 顺序固定：warmup、read、write、wrap
//     why: string,                       首页一句中文：“今天先练 there be，因为它是期中重点。”可以为空
//     summary: string,                   首页一句中文：“先热身 15 张，再……”
//     counts: { due, fresh, total }
//   }
//   Cell = { id: 'warmup' | 'read' | 'write' | 'wrap', label, status, minutes, items: [slug], mode?, note? }
//     status：'ready' 可以做 | 'done' 今天做完了 | 'soon' 还没上线（显示“下周开播”，不占时间） | 'skip' 今天不做
//     mode：warmup 用 'mc4'（四选一）；write 用 'paper'（纸上写）或 'tiles'（v1）
//
// wordsForPlan(entries, curriculum) -> state.words   纯函数：词条（words.favorites()）加上课标信息，拼成上面的形状。
//   词条上已有的 unit / tier（课本导入时写进去的）优先，没有才问 curriculum。app.js 的 ctx.planState() 用它。
//
// 依赖：fsrs.js（endOfDay、State）。

import { endOfDay, State } from './fsrs.js';

export const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
export const CELL_LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾' };
export const CAPS = { schoolday: 20, light: 12, weekend: 30 };   // 热身卡数封顶（DESIGN 5.1）
export const SECONDS_PER_CARD = 15;

const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function wordsForPlan(entries = [], curriculum = null) {
  const c = curriculum || {};
  return entries.filter(e => e && e.slug && e.fsrs).map(e => ({
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
  }));
}

export function planToday(state = {}, now = new Date()) {
  const words = Array.isArray(state.words) ? state.words : [];
  const done = state.doneToday || {};
  const light = !!state.light || now.getHours() >= 21;
  const eod = endOfDay(now);
  const due = words.filter(w => w.due && !w.isNew && new Date(w.due) <= eod).sort((a, b) => new Date(a.due) - new Date(b.due));
  const quota = Math.max(0, (state.newPerDay ?? 4) - (state.newDoneToday || 0));
  const fresh = words.filter(w => w.isNew).slice(0, quota);
  const cap = light ? CAPS.light : CAPS.schoolday;
  const cards = [...due, ...fresh].slice(0, cap).map(w => w.slug);
  const warmMin = cards.length ? Math.max(1, Math.round((cards.length * SECONDS_PER_CARD) / 60)) : 0;
  const cell = (id, status, minutes, items = [], extra = {}) => ({ id, label: CELL_LABELS[id], status: done[id] ? 'done' : status, minutes, items, ...extra });
  const cells = [
    cell('warmup', cards.length ? 'ready' : 'skip', warmMin, cards, { mode: 'mc4' }),
    cell('read', 'soon', 0, [], { note: '下周开播' }),
    cell('write', 'soon', 0, [], { mode: 'paper', note: '下周开播' }),
    cell('wrap', 'ready', 1),
  ];
  const minutes = cells.filter(c => c.status === 'ready').reduce((a, c) => a + c.minutes, 0);
  return {
    date: dayOf(now),
    light,
    minutes,
    lightMinutes: cards.length ? Math.max(1, Math.round((Math.min(cards.length, CAPS.light) * SECONDS_PER_CARD) / 60)) + 1 : 0,
    cells,
    why: '',
    summary: cards.length ? `先热身 ${cards.length} 张。` : '今天没有要复习的词。',
    counts: { due: due.length, fresh: fresh.length, total: cards.length },
  };
}
