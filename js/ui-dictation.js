// 明天有听写，纸笔版的界面（DESIGN 5.3 的两张草图）：选单元、勾掉老师没划的词、选考法；老师一个一个读，她写在纸上；
// 写完出答案，她自己打勾；错的马上再写一轮。逻辑在 dictation.js。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/dictation.css）。
// 状态：骨架，能跑通一轮：词来自当前单元（kv 'progress'.unit 的 curriculum.unitWords），没导入课本时拿单词本里
// 最近的 10 个词顶上；界面是占位。勾词、选单元、“再听一遍”的慢速、睡前提醒由负责的 agent 补。
//
// 导出
//   createDictationView(ctx) -> { show(params), inSession(), holding() }
//     渲染进 #tab-dictation。params：{ unit?, retry?: true（只写昨晚错的） }。全屏，左上角“结束”回到今天。
//
// 用到的 ctx：curriculum.unitWords / units、kv.peek('progress') / get / set、words.favorites、say、events.log、go('home')。
// 每个打勾记一条 events { type: 'dictation', slug, correct, mode: 'paper', choice: method, step: 'dictation' }；
// 整次记进 kv 'dictation:<YYYY-MM-DD>'（形状见 dictation.js 的 DictationRecord）。
import { h, icon } from './ui-dom.js';
import { METHODS, promptFor, createDictation } from './dictation.js';
import { slugify } from './words.js';
import { meaningOf } from './modes/choice.js';
import { dayOf } from './plan.js';

export function createDictationView(ctx) {
  const root = document.getElementById('tab-dictation');
  root.replaceChildren();
  const stage = h('div', { className: 'dict' });
  root.append(stage);
  let d = null;          // createDictation(...)
  let method = 'zh2en';
  let words = [];
  let unit = '';

  const header = title => h('header', { className: 'runhead session' },
    h('button', { type: 'button', className: 'text-btn', text: '结束', on: { click: () => { d = null; ctx.go('home'); } } }),
    h('span', { className: 'runhead-title', text: title }), h('span'));

  function pickWords(params) {
    unit = params.unit || (ctx.kv.peek('progress', {}) || {}).unit || '';
    const fromBook = unit ? ctx.curriculum.unitWords(unit).filter(x => !x.phrase) : [];
    if (fromBook.length) return fromBook.map(x => ({ slug: slugify(x.w), w: x.w, cn: x.cn || '' }));
    return ctx.words.favorites().slice(-10).map(e => ({ slug: e.slug, w: e.headword, cn: meaningOf(e) }));
  }

  function setup(params = {}) {
    d = null;
    words = pickWords(params);
    stage.replaceChildren(header('明天有听写'),
      h('section', { className: 'dict-setup' },
        h('p', { className: 'lede', text: `${unit ? unit + ' · ' : ''}${words.length} 个词` }),
        h('p', { className: 'small', text: '老师怎么考？' }),
        h('div', { className: 'btn-row' }, METHODS.map(([id, label]) => h('button', { type: 'button', className: 'text-btn' + (id === method ? ' on' : ''), text: label,
          on: { click: () => { method = id; setup(params); } } }))),
        h('p', { className: 'small', text: '拿出纸和笔，听一个写一个。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '开始', disabled: !words.length, on: { click: () => { d = createDictation({ words, method, unit }); draw(); } } }))));
  }

  function draw() {
    if (!d) return;
    if (d.phase === 'writing') {
      const w = d.current();
      const p = promptFor(w, method);
      const say = btn => ctx.say(p.say, btn);
      stage.replaceChildren(header('听写'),
        h('section', { className: 'dict-run' },
          h('p', { className: 'small', text: `第 ${d.index + 1} / ${d.words.length} 个` }),
          p.show ? h('p', { className: 'lede', lang: p.lang, text: p.show }) : null,
          h('div', { className: 'btn-row' },
            h('button', { type: 'button', className: 'text-btn accent', on: { click: ev => say(ev.currentTarget) } }, icon('speak'), '再听一遍'),
            h('button', { type: 'button', className: 'btn', text: d.index + 1 < d.words.length ? '下一个' : '写完了', on: { click: () => { d.next(); draw(); } } }))));
      setTimeout(() => say(null), 0);
      return;
    }
    if (d.phase === 'checking') {
      const m = d.marks();
      stage.replaceChildren(header('对一下'),
        h('section', { className: 'dict-check' },
          h('p', { className: 'small', text: '对一下，写对的打勾' }),
          h('ul', { className: 'dict-list' }, d.words.map(w => h('li', { className: 'dict-item' + (w.slug in m ? (m[w.slug] ? ' ok' : ' bad') : '') },
            h('span', { className: 'serif', lang: 'en', text: promptFor(w, method).answer }),
            h('span', { className: 'small', text: w.cn }),
            h('button', { type: 'button', className: 'text-btn', text: '对', on: { click: () => mark(w, true) } }),
            h('button', { type: 'button', className: 'text-btn', text: '错', on: { click: () => mark(w, false) } }))))));
      return;
    }
    const bad = d.wrong();
    save();
    stage.replaceChildren(header('听写'),
      h('section', { className: 'dict-done' },
        h('p', { className: 'lede', text: bad.length ? `错了 ${bad.length} 个：现在再写一遍这 ${bad.length} 个` : '全对了。' }),
        h('div', { className: 'btn-row' },
          bad.length ? h('button', { type: 'button', className: 'btn', text: '再写一遍', on: { click: () => { d = d.retryRound(); draw(); } } })
            : h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => { d = null; ctx.go('home'); } } }))));
  }

  function mark(w, ok) {
    d.mark(w.slug, ok);
    ctx.events.log({ type: 'dictation', step: 'dictation', slug: w.slug, correct: ok, mode: 'paper', choice: method, unit: unit || undefined });
    draw();
  }

  function save() {
    const rec = d.record();
    ctx.kv.set('dictation:' + dayOf(new Date()), rec).catch(() => {});
  }

  return {
    show(params = {}) { setup(params); },
    inSession: () => !!(d && d.phase !== 'done'),
    holding: () => false,
  };
}
