// 今天（首页，DESIGN 2.0 的草图）：老师的英文招呼加一行中文小字，“今天约 12 分钟”，一句“为什么今天练这个”，
// 一个主按钮“开始今天的课”，文字入口“轻松版 8 分钟”“明天有听写？”“查词”“这周 3 / 5 天”。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/home.css、css/lesson.css、css/dictation.css）。
// 状态：骨架。能显示今天的计划和入口，样子是占位；按草图做完整版、回归日、21:00 以后、听写提醒由负责的 agent 补。
//
// 导出
//   createHomeTab(ctx) -> { show(params), onChange() }
//     渲染进 #tab-home（index.html）。show 每次切到“今天”时调用；onChange 在词或设置变了以后调用（app.js 节流过）。
//
// 用到的 ctx（CONTRACTS.md）：todayPlan({ light }) 、lines.pick / markSeen / shouldShowZh / tapZh、say、go('lesson',
// { light }) / go('dictation') / go('look')、kv.peek('profile')、statusSlot(el)、curriculum、events。
// 样式写在 css/home.css，类名一律以 home- 开头。
import { h, icon } from './ui-dom.js';

export function createHomeTab(ctx) {
  const root = document.getElementById('tab-home');
  root.replaceChildren();
  const statusSlot = h('div', { className: 'status-slot' });
  const body = h('div', { className: 'home-body' });
  root.append(h('div', { className: 'home' },
    h('header', { className: 'runhead' }, h('h1', { className: 'runhead-title', text: 'Emma 的英语老师' }), h('span', { className: 'runhead-meta home-date' })),
    statusSlot, body));
  ctx.statusSlot(statusSlot);

  // one greeting per visit: picked (and counted as seen) in show(), redrawn as is by onChange
  let line = null;
  function pickLine() {
    const name = (ctx.kv.peek('profile', {}) || {}).name || 'Emma';
    line = ctx.lines.pick('open', { name });
    if (line) ctx.lines.markSeen(line.id);
  }
  function greeting() {
    if (!line) return null;
    const zh = h('p', { className: 'home-zh', lang: 'zh-CN', text: line.zh, hidden: !line.showZh });
    return h('div', { className: 'home-hello' },
      h('p', { className: 'home-en', lang: 'en' }, line.en,
        h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say(line.en, ev.currentTarget) } }, icon('speak'))),
      zh,
      line.showZh ? null : h('button', { type: 'button', className: 'text-btn', text: '看中文', on: { click: () => { zh.hidden = false; ctx.lines.tapZh(line.id); } } }));
  }

  function render() {
    const plan = ctx.todayPlan();
    const d = new Date();
    root.querySelector('.home-date').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    const n = x => h('span', { className: 'n', text: String(x) });
    body.replaceChildren(
      greeting(),
      h('section', { className: 'home-plan' },
        plan.minutes ? h('p', { className: 'lede' }, '今天约 ', n(plan.minutes), ' 分钟') : h('p', { className: 'lede', text: '今天的课准备好了' }),
        h('p', { className: 'small', text: plan.summary }),
        plan.why ? h('p', { className: 'small', text: plan.why }) : null,
        h('ol', { className: 'home-cells' }, plan.cells.map(c => h('li', { className: 'home-cell ' + c.status },
          h('span', { text: c.label }), h('span', { className: 'small', text: c.status === 'soon' ? (c.note || '下周开播') : c.status === 'done' ? '做完了' : c.minutes ? `${c.minutes} 分钟` : '' })))),
        h('div', { className: 'home-actions' },
          h('button', { type: 'button', className: 'btn', on: { click: () => ctx.go('lesson', { light: false }) } }, '开始今天的课', icon('arrow')),
          plan.lightMinutes ? h('button', { type: 'button', className: 'text-btn accent', text: `轻松版 ${plan.lightMinutes} 分钟`, on: { click: () => ctx.go('lesson', { light: true }) } }) : null)),
      h('nav', { className: 'home-links', 'aria-label': '其他入口' },
        h('button', { type: 'button', className: 'text-btn accent', text: '明天有听写？', on: { click: () => ctx.go('dictation') } }),
        h('button', { type: 'button', className: 'text-btn accent', text: '查词', on: { click: () => ctx.go('look') } })));
  }

  return {
    show(params, { from } = {}) { if (from !== 'home' || !line) pickLine(); render(); },
    onChange() { if (ctx.currentRoute() === 'home') render(); },
  };
}
