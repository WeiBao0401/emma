// 第一次打开（DESIGN 2.1、8.6）：看“老师和你的约定”，给老师起名字、挑主题色，定每周目标 4-6 天，写一句
// “每天＿＿我就打开它”。做完进“今天”，第一节课只放她最有把握的 15 个词。
// 拍课本、填 Key、体检页、家长开机问卷都由 Wei 事先做完，不在这里。
// 负责：家长区 UI agent（ui-parent.js、ui-onboard.js、ui-me.js、css/onboard.css）。
// 状态：骨架。只有约定页和一个“好，开始吧”；起名字、主题色、每周目标由负责的 agent 补。
//
// 导出
//   createOnboardView(ctx) -> { needed() -> bool, show(params) }
//     渲染进 #tab-onboard，全屏（nav.js immersive）。needed() 同步，看 kv 'onboard'.done；app.js 启动时用它决定先进哪页。
//
// 写进 kv：
//   'onboard'  { done: true, at, version: 1 }
//   'profile'  { name: 'Emma', teacherName, theme: 'green' | 'blue' | 'rose' | 'violet', weeklyGoal: 4-6, pledge: '…' }
//              theme 由 ctx.applyTheme(theme) 生效（index.html :root[data-accent]）
// 记事件：{ type: 'onboard', step: 'onboard', done: true }
import { h } from './ui-dom.js';

export const PROMISES = [
  '我不会直接告诉你答案，但会一步步帮你，最多四步一定讲清楚。',
  '我只当英语老师。别的作业和心事，去找家人。',
  '你拍的照片会发到阿里云识别，识别完不保留。你的录音只存在这台 iPad 上。',
  '家长能看到每周小结、花了多少钱和老师的笔记。笔记里会举几个你做错的例子，帮老师想办法；不会把每道题的对错发给家长，也听不到你的录音。“发给家长”会附上一份备份，存在家长手机里。',
  '老师会记下你做题的样子，每周想想怎么帮你，想的时候会把去掉名字的学习记录发给 AI。“老师记得的你”你都能看到，不对就点“这不对”。写到让人担心的事，老师会告诉家长。',
];

export function createOnboardView(ctx) {
  const root = document.getElementById('tab-onboard');
  root.replaceChildren();

  async function finish() {
    const profile = { name: 'Emma', theme: '', weeklyGoal: 5, ...(ctx.kv.peek('profile', {}) || {}) };
    await ctx.kv.set('profile', profile).catch(() => {});
    await ctx.kv.set('onboard', { done: true, at: new Date().toISOString(), version: 1 }).catch(() => {});
    ctx.events.log({ type: 'onboard', step: 'onboard', done: true });
    ctx.go('home');
  }

  function render() {
    root.replaceChildren(h('div', { className: 'onboard' },
      h('h1', { className: 'page-title', text: '老师和你的约定' }),
      h('ol', { className: 'onboard-list' }, PROMISES.map((t, i) => h('li', {}, h('span', { className: 'num', text: String(i + 1) }), h('p', { text: t })))),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '好，开始吧', on: { click: finish } }))));
  }

  return {
    needed: () => !((ctx.kv.peek('onboard', {}) || {}).done),
    show() { render(); },
  };
}
