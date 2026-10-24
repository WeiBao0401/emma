// 第一次打开（DESIGN 2.1、8.6）：看“老师和你的约定”，给老师起名字、挑主题色，定每周目标 4-6 天，写一句
// “每天＿＿我就打开它”。做完直接进第一节课（ctx.go('lesson', { first: true })，第一节课的内容由 ui-lesson.js 定）。
// 拍课本、填 Key、体检页、家长开机问卷都由 Wei 事先做完：家长还没在装机清单里点“都好了，交给 Emma”
// （kv 'onboard'.handed）时，这一页先请家长去家长区准备。中途关了 App 再打开，还是先到这一页，家长不会被关在
// Emma 的流程里。家长数字码 10-24 删了（kv 'parent.pin' 老数据留着，不再读）。
// 约定只留学习上的几条（Wei 10-24：照片、录音、隐私、上报家长这些不写）。
// 负责：家长区 UI agent（ui-parent.js、ui-onboard.js、ui-me.js、css/parent.css、css/onboard.css）。
//
// 导出
//   createOnboardView(ctx) -> { needed() -> bool, show(params) }
//     渲染进 #tab-onboard，全屏（nav.js immersive）。needed() 同步，看 kv 'onboard'.done；app.js 启动时用它决定先进哪页。
//     已经做过（比如从备份恢复了）再进来，直接回“今天”。
//   纯函数：promisesFor(parentCall)、cleanName(raw, max)、pledgeText(when)、accentOf(theme)；常量 PROMISES、THEMES、
//     GOAL_CHOICES、WHEN_CHOICES、TEACHER_SUGGEST、DEFAULT_PARENT_NAME
//
// 写进 kv：
//   'onboard'  { handed?, done: true, at, version: 1 }（handed 由家长区的“交给 Emma”写）
//   'profile'  { name: 'Emma', teacherName, theme: 'navy' | 'green' | 'rose' | 'violet', weeklyGoal: 4-6, pledge: '…',
//                pledgeWhen, parentCall? }（parentCall 由家长区写，这里原样保留）
//              theme 由 ctx.applyTheme(accentOf(theme)) 生效（index.html :root[data-accent]；navy 藏青是默认，不设属性）
// 记事件：{ type: 'onboard', step: 'onboard', done: true, weekly_goal, pledge_when, theme }
// 孩子这边不出现“第几步 / 共几步”（DESIGN 7：孩子端不放“x / 总数”）。
import { h, icon } from './ui-dom.js';

export const DEFAULT_PARENT_NAME = '家长';

export const PROMISES = [
  '我不会直接告诉你答案，但会一步步帮你，最多四步一定讲清楚。',
  '做错了没关系。错过的题，过几天我换个句子再考你，直到你真的会。',
  '英语上哪里不懂，课本、作业、单词、语法、怎么读，都可以来“问老师”问我。',
  '我会记下你做题的样子，每周想想怎么帮你。“老师记得的你”你都能看到，不对就点“这不对”。',
];
// “家长” becomes what the parent area set (妈妈, 爸爸...)
export const promisesFor = (parentName = DEFAULT_PARENT_NAME) => PROMISES.map(t => t.replace(/家长/g, parentName || DEFAULT_PARENT_NAME));

// three or four quiet colors; ids match index.html :root[data-accent] (navy is the default since the v0.1.1 palette, no attribute)
export const THEMES = [
  { id: 'navy', label: '藏青' },
  { id: 'green', label: '松绿' },
  { id: 'rose', label: '玫瑰' },
  { id: 'violet', label: '紫藤' },
];
export const DEFAULT_THEME = 'navy';
export const accentOf = theme => (theme && theme !== DEFAULT_THEME && THEMES.some(t => t.id === theme) ? theme : '');
export const GOAL_CHOICES = [4, 5, 6];
export const WHEN_CHOICES = ['写完作业', '吃完晚饭', '放学到家', '洗完澡'];
export const TEACHER_SUGGEST = ['Miss Lin', 'Mr. Wood', 'Ms. Sun'];

// Names she types (DESIGN 8.5: short, no numbers or addresses): letters of any script, spaces and . ' · - only
export function cleanName(raw, max = 16) {
  const s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{M} .'’·-]/gu, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}
export const pledgeText = when => `每天${when}，我就打开它。作业太多，我就做轻松版。`;

export function createOnboardView(ctx) {
  const root = document.getElementById('tab-onboard');
  root.replaceChildren();

  const needed = () => !((ctx.kv.peek('onboard', {}) || {}).done);
  const profile = () => ctx.kv.peek('profile', {}) || {};
  let step = 'promise';   // 'parent' | 'promise' | 'name' | 'goal'
  let teacherName = '';
  let theme = DEFAULT_THEME;
  let weeklyGoal = 5;
  let when = '';
  let finishing = false;

  function startFresh() {
    const p = profile();
    teacherName = cleanName(p.teacherName || '');
    theme = THEMES.some(t => t.id === p.theme) ? p.theme : DEFAULT_THEME;
    weeklyGoal = GOAL_CHOICES.includes(p.weeklyGoal) ? p.weeklyGoal : 5;
    when = WHEN_CHOICES.includes(p.pledgeWhen) ? p.pledgeWhen : '';
  }

  async function finish() {
    if (finishing || !when) return;
    finishing = true;
    const prof = { name: 'Emma', ...profile(), teacherName: teacherName || TEACHER_SUGGEST[0], theme, weeklyGoal, pledge: pledgeText(when), pledgeWhen: when };
    try {
      await ctx.kv.set('profile', prof);
      await ctx.kv.set('onboard', { ...(ctx.kv.peek('onboard', {}) || {}), done: true, at: new Date().toISOString(), version: 1 });
    } catch (e) { console.warn('onboard:', (e && e.message) || e); }
    ctx.events.log({ type: 'onboard', step: 'onboard', done: true, weekly_goal: weeklyGoal, pledge_when: when, theme });
    ctx.applyTheme(accentOf(theme));
    finishing = false;
    ctx.go('lesson', { first: true });
  }

  const page = (...kids) => h('div', { className: 'onboard' }, ...kids.filter(Boolean));
  const backBtn = to => h('button', { type: 'button', className: 'text-btn onboard-back', on: { click: () => { step = to; render(); } } }, icon('back'), '上一步');

  // before the parent has set things up: this screen is for the parent, not for Emma
  function parentStep() {
    return page(
      h('h1', { className: 'page-title', text: '先交给家长' }),
      h('p', { className: 'lede onboard-lede', text: '第一次打开，先请家长准备十几分钟。' }),
      h('ol', { className: 'onboard-list' }, ['填 Key，测一下连接', '导入课本，选课本进度和期中', '填开机问卷']
        .map((t, i) => h('li', {}, h('span', { className: 'num', text: String(i + 1) }), h('p', { text: t })))),
      h('p', { className: 'small', text: '弄好以后，在家长区点“都好了，交给 Emma”。' }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '家长开始准备', on: { click: () => ctx.go('parent', { setup: true }) } })));
  }

  function promiseStep() {
    const name = cleanName(profile().parentCall || '', 10) || DEFAULT_PARENT_NAME;
    return page(
      h('h1', { className: 'page-title', text: '老师和你的约定' }),
      h('ol', { className: 'onboard-list' }, promisesFor(name).map((t, i) => h('li', {}, h('span', { className: 'num', text: String(i + 1) }), h('p', { text: t })))),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '好，开始吧', on: { click: () => { step = 'name'; render(); } } })));
  }

  function nameStep() {
    const next = h('button', { type: 'button', className: 'btn', text: '下一步', disabled: !teacherName, on: { click: () => {
      teacherName = cleanName(input.value);
      if (!teacherName) return;
      step = 'goal';
      render();
    } } });
    const input = h('input', { type: 'text', className: 'field onboard-name', maxLength: 16, value: teacherName, placeholder: TEACHER_SUGGEST[0],
      autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '老师的名字',
      on: { input: () => { next.disabled = !cleanName(input.value); }, change: () => { teacherName = cleanName(input.value); } } });
    const swatches = h('div', { className: 'onboard-swatches', role: 'radiogroup', 'aria-label': '主题色' }, ...THEMES.map(t => h('button', {
      type: 'button', className: 'onboard-swatch' + (theme === t.id ? ' on' : ''), role: 'radio', 'aria-checked': String(theme === t.id), dataset: { theme: t.id },
      on: { click: () => { teacherName = cleanName(input.value); theme = t.id; ctx.applyTheme(accentOf(t.id)); render(); } } },
    h('span', { className: 'onboard-chip', 'aria-hidden': 'true' }), h('span', { className: 'onboard-swatch-label', text: t.label }))));
    return page(
      backBtn('promise'),
      h('h1', { className: 'page-title', text: '给老师起个名字' }),
      h('p', { className: 'small', text: '以后老师就叫这个名字。中文英文都行。' }),
      input,
      h('div', { className: 'onboard-suggest' }, ...TEACHER_SUGGEST.map(n => h('button', { type: 'button', className: 'text-btn accent', lang: 'en', text: n,
        on: { click: () => { input.value = n; teacherName = n; next.disabled = false; } } }))),
      h('h2', { className: 'sec-h onboard-h', text: '挑一个颜色' }),
      swatches,
      h('div', { className: 'btn-row' }, next));
  }

  function goalStep() {
    const blank = when || '＿＿';
    return page(
      backBtn('name'),
      h('h1', { className: 'page-title', text: '每周几天' }),
      h('p', { className: 'small', text: '一周里有几天打开它，你自己定。漏了一天，用轻松版补上就行。' }),
      h('div', { className: 'onboard-seg', role: 'radiogroup', 'aria-label': '每周几天' }, ...GOAL_CHOICES.map(n => h('button', { type: 'button',
        className: 'onboard-seg-btn' + (weeklyGoal === n ? ' on' : ''), role: 'radio', 'aria-checked': String(weeklyGoal === n), text: `${n} 天`,
        on: { click: () => { weeklyGoal = n; render(); } } }))),
      h('h2', { className: 'sec-h onboard-h', text: '什么时候打开' }),
      h('p', { className: 'lede onboard-pledge' }, '每天', h('span', { className: 'onboard-blank' + (when ? ' filled' : ''), text: blank }), '，我就打开它。'),
      h('div', { className: 'onboard-chips', role: 'radiogroup', 'aria-label': '每天什么时候' }, ...WHEN_CHOICES.map(w => h('button', { type: 'button',
        className: 'onboard-chip-btn' + (when === w ? ' on' : ''), role: 'radio', 'aria-checked': String(when === w), text: w,
        on: { click: () => { when = w; render(); } } }))),
      h('p', { className: 'lede onboard-pledge second', text: '作业太多，我就做轻松版。' }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '开始第一节课', disabled: !when, on: { click: finish } })));
  }

  function render() {
    const view = { parent: parentStep, promise: promiseStep, name: nameStep, goal: goalStep }[step] || promiseStep;
    root.replaceChildren(view());
    window.scrollTo(0, 0);
  }

  return {
    needed,
    show() {
      const ob = ctx.kv.peek('onboard', {}) || {};
      if (!ob.done && !ob.handed) step = 'parent';
      else if (!needed()) { setTimeout(() => ctx.go('home'), 0); return; }
      else if (step === 'parent') { startFresh(); step = 'promise'; }
      if (step === 'promise') startFresh();
      render();
    },
  };
}
