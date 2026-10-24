// 上课（DESIGN 2.0-2.3）：按 plan 的四格走，热身 → 读一段 → 写几个词 → 收尾。v0 只有热身（四选一）和收尾；
// “读一段”“写几个词”还没上线时直接跳过。收尾老师说一句英文（lines 'close'），说出今天做对的几个词。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/lesson.css）。
// 状态：骨架，能跑通：热身用 session.js 的队列加 modes/choice.js，每次作答记 events 'answer'，评分走 words.review；
// 收尾记 'session_end' 并在 kv 'day:<YYYY-MM-DD>' 记下做完的格子。界面是占位，由负责的 agent 做完整版
// （进度、“有点难”“这题有问题”、离开时记 'exit'、超过 25 分钟提示“今天够了”）。
//
// 导出
//   createLessonView(ctx) -> { show(params), inSession(), onChange() }
//     渲染进 #tab-lesson。params：{ light: bool }。全屏（nav.js immersive），左上角“结束”回到今天。
//
// 用到的 ctx：todayPlan({ light })、words.get / review、events.log / sessionId、kv.get / set、lines.pick、say、
// go('home')、toast、kidError。
import { h, icon, toast } from './ui-dom.js';
import { createSession } from './session.js';
import { endOfDay } from './fsrs.js';
import { choiceMode } from './modes/choice.js';
import { dayOf } from './plan.js';

export function createLessonView(ctx) {
  const root = document.getElementById('tab-lesson');
  root.replaceChildren();
  const stage = h('div', { className: 'lesson' });
  root.append(stage);

  let session = null;   // createSession(...)
  let sid = '';
  let plan = null;
  let t0 = 0;
  let right = [];       // slugs answered right the first time
  let lastGrade = 0;

  function header(title, n = 0, total = 0) {
    return h('header', { className: 'runhead session' },
      h('button', { type: 'button', className: 'text-btn', text: '结束', on: { click: quit } }),
      h('span', { className: 'runhead-title', text: title }),
      total ? h('span', { className: 'count3' }, h('span', { className: 'num', text: String(n) }), ' / ', h('span', { className: 'num', text: String(total) })) : h('span'));
  }

  function start({ light = false } = {}) {
    plan = ctx.todayPlan({ light });
    sid = ctx.events.sessionId();
    t0 = Date.now();
    right = [];
    ctx.events.log({ type: 'session_start', sid, kind: light ? 'easy' : 'standard', hour: new Date().getHours() });
    const warm = plan.cells.find(c => c.id === 'warmup');
    if (warm && warm.status === 'ready' && warm.items.length) {
      session = createSession({
        queue: warm.items,
        mode: 'mc4',
        review: (slug, g, m) => ctx.words.review(slug, g, m),
        // DESIGN 5.1: right once in this lesson is enough; a wrong one comes back about 4 cards later (session.js)
        isToday: due => lastGrade === 1 && new Date(due) <= endOfDay(new Date()),
        isActive: slug => { const e = ctx.words.get(slug); return !!(e && e.favorited); },
      });
      draw();
    } else wrap();
  }

  function draw() {
    const s = session;
    const slug = s && s.current();
    if (!slug) { wrap(); return; }
    const e = ctx.words.get(slug);
    const pool = plan.cells[0].items.map(x => ctx.words.get(x)).filter(Boolean).concat(ctx.words.favorites().slice(0, 40));
    const view = choiceMode.render(e, {
      app: ctx,
      pool,
      say: (text, btn) => ctx.say(text, btn),
      position: { n: s.done + 1, total: s.total },
      onAnswer: ev => {
        ctx.events.log({ type: 'answer', sid, step: 'warmup', unit: ctx.curriculum.unitOf(e.headword) || undefined, ...ev });
        if (ev.correct && ev.first_try) right.push(ev.slug);
      },
      rate: g => rate(g),
    });
    stage.replaceChildren(header('热身', s.done + 1, s.total), view.el, ...[].concat(view.footer || []));
  }

  async function rate(g) {
    const s = session;
    if (!s || s.busy) return;
    lastGrade = g;
    try { const r = await s.rate(g, { modeId: 'mc4' }); if (r && r.finished) { wrap(); return; } } catch (err) { toast(err.message || String(err)); }
    draw();
  }

  async function markDone(cells) {
    const key = 'day:' + dayOf(new Date());
    const rec = (await ctx.kv.get(key, {})) || {};
    rec.cells = { ...(rec.cells || {}), ...Object.fromEntries(cells.map(c => [c, true])) };
    rec.minutes = (rec.minutes || 0) + Math.round((Date.now() - t0) / 60000);
    await ctx.kv.set(key, rec).catch(() => {});
  }

  function wrap() {
    session = null;
    const done = ['warmup', 'wrap'];
    markDone(done);
    ctx.events.log({ type: 'session_end', sid, min: Math.round((Date.now() - t0) / 60000), steps_done: done, completed: true });
    const line = ctx.lines.pick('close', {});
    if (line) ctx.lines.markSeen(line.id);
    const words = [...new Set(right)].slice(0, 3).map(s => (ctx.words.get(s) || {}).headword).filter(Boolean);
    stage.replaceChildren(header('收尾'),
      h('section', { className: 'lesson-wrap' },
        line ? h('p', { className: 'lede', lang: 'en' }, line.en,
          h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say(line.en, ev.currentTarget) } }, icon('speak'))) : null,
        line && line.showZh ? h('p', { className: 'small', text: line.zh }) : null,
        h('p', { className: 'small', text: words.length ? `今天做对了 ${words.join('、')}。` : '今天的课上完了。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => ctx.go('home') } }))));
  }

  function quit() {
    if (session) ctx.events.log({ type: 'exit', sid, step: 'warmup', after_item: session.done });
    session = null;
    ctx.go('home');
  }

  return {
    show(params = {}) { start(params); },
    inSession: () => !!session,
    onChange() {},
  };
}
