// 孩子端“我”的界面（逻辑在 kid-me.js，样式 css/kid-me.css，类名 km-）。负责：孩子端“我” agent（第 5 批）。
//
// 导出
//   createKidMeView(ctx, { root? }) -> { el, show(params), onChange(), holding() }
//     “我”页面：学到哪了（单元大按钮）、下次考试（日期、从哪个单元到哪个单元）、我喜欢的（话题、想读的故事、喜欢的题）、
//     老师的名字、老师现在给我的难度（每部分一句，“都回到正好”）。都写回 kv：'progress'（和家长区同一个）、'kid.prefs'、
//     'profile'.teacherName、'kid.level'。root 不给时画进 #tab-kidme（路由要接线加，见 wip/b5/kid-me-needs.md）。
//     params: { open?: 'unit' | 'exam' | 'likes' | 'teacher' | 'level' }（滚到那一组，先只记在 el.dataset.open）
//   renderFeedback(container, ctx, { part, sid?, item?, mode?, now?, onPick? }) -> { el, stop() }
//     做完一部分（热身、读一段、写几个词、语法卡）后的一行小按钮“太简单 / 正好 / 太难”。点一下记 kid-me.recordFeedback
//     （kv 'kid.level' 和事件 'feedback'），按钮变灰，下面一句老师的话。onPick({ part, choice, level, prev, changed })
//   renderTodayAsk(container, ctx, { sid?, now?, examSet?, onPick? }) -> { el, stop() }
//     上课开头老师问“今天想先练什么？”，5 个按钮（kid-me.TODAY_CHOICES）。点了写 kv 'kid.today'，记 ask 事件
//     （qid 'today'），onPick({ choice, mix })：mix 是 kid-me.todayMix 的返回值，ui-lesson 拿它重排今天的课
//   再导出 kid-me.js 的 difficulty、todayChoice、parseFeedbackText、applyChatFeedback、knobsFor、prefsForPrompt
//
//   ctx 用到：kv（peek、set）、curriculum（units、unitTitle、unitOrder，可以没有）、events（log、sessionId，可以没有）、
//   toast（可以没有）、go（可以没有）。
import { h } from './ui-dom.js';
import * as K from './kid-me.js';

export { difficulty, todayChoice, parseFeedbackText, applyChatFeedback, knobsFor, prefsForPrompt } from './kid-me.js';

const toastOf = ctx => (msg => { try { if (ctx && ctx.toast) ctx.toast(msg); } catch (e) { /* 没有 toast 就算了 */ } });
const peek = (ctx, k, d) => { try { const v = ctx.kv.peek(k, d); return v == null ? d : v; } catch (e) { return d; } };
const teacherOf = ctx => K.readPrefs(ctx.kv).teacherName || '老师';

// ---------------------------------------------------------------- 难度反馈的一行
const FEEDBACK_REPLY = {
  easy: { up: '好，下次我出难一点。', same: '记下了。再说一次太简单，我就加难度。' },
  ok: { up: '好，就这样练。', same: '好，就这样练。' },
  hard: { up: '好，下次我放简单一点，我们慢慢来。', same: '好，下次我放简单一点，我们慢慢来。' },
};
export function renderFeedback(container, ctx, { part, sid = '', item = '', mode = '', now = null, onPick = null } = {}) {
  const ask = h('p', { className: 'km-fb-ask', text: `这一部分${K.PART_ZH[part] ? '（' + K.PART_ZH[part] + '）' : ''}觉得怎么样？` });
  const say = h('p', { className: 'km-fb-say', 'aria-live': 'polite' });
  let picked = false;
  const btns = K.FEEDBACK_CHOICES.map(c => h('button', { type: 'button', className: 'km-fb-btn km-fb-' + c.id, text: c.zh, dataset: { choice: c.id },
    on: { click: () => pick(c.id) } }));
  async function pick(choice) {
    if (picked) return;
    picked = true;
    for (const b of btns) { b.disabled = true; if (b.dataset.choice === choice) b.classList.add('on'); }
    let r = null;
    try { r = await K.recordFeedback(ctx, { part, choice, sid, item, mode, now: now || new Date() }); } catch (e) { r = null; }
    const copy = FEEDBACK_REPLY[choice];
    say.textContent = r && r.changed ? copy.up : copy.same;
    if (onPick) try { onPick(r || { part, choice }); } catch (e) { /* 不影响她往下走 */ }
  }
  const el = h('div', { className: 'km-fb', role: 'group', 'aria-label': '难度' }, ask, h('div', { className: 'km-fb-row' }, ...btns), say);
  if (container) container.append(el);
  return { el, pick, stop() { picked = true; } };
}

// ---------------------------------------------------------------- 上课开头：今天想先练什么？
export function renderTodayAsk(container, ctx, { sid = '', now = null, examSet = null, onPick = null } = {}) {
  const at = () => now || new Date();
  const hasExam = examSet !== null ? !!examSet : (() => { const p = K.readProgress(ctx.kv); return !!(p.examDate || p.examFrom); })();
  const cur = K.todayChoice(ctx.kv, at());
  let done = false;
  const line = h('p', { className: 'km-today-say' }, h('span', { className: 'km-today-who', text: teacherOf(ctx) + '：' }), '今天想先练什么？');
  const note = h('p', { className: 'km-today-note', 'aria-live': 'polite' });
  const btns = K.TODAY_CHOICES.map(c => h('button', { type: 'button', className: 'km-today-btn' + (c.id === 'plan' ? ' first' : '') + (cur === c.id ? ' on' : ''),
    dataset: { choice: c.id }, disabled: c.id === 'exam' && !hasExam,
    on: { click: () => pick(c.id) } }, h('span', { text: c.zh }), c.id === 'exam' && !hasExam ? h('span', { className: 'km-today-sub', text: '先在“我”里设考试' }) : null));
  async function pick(choice) {
    if (done) return;
    done = true;
    for (const b of btns) { b.disabled = true; b.classList.remove('on'); if (b.dataset.choice === choice) b.classList.add('on'); }
    try { await K.setTodayChoice(ctx.kv, choice, at()); } catch (e) { /* 存不上也照样上课 */ }
    try { if (ctx.events && ctx.events.log) await ctx.events.log(K.todayEvent(choice, sid)); } catch (e) { /* 记录失败不卡她 */ }
    const mix = K.todayMix(choice, { examSet: hasExam });
    note.textContent = mix.note || '好，我们开始。';
    if (onPick) try { onPick({ choice, mix }); } catch (e) { /* 不影响上课 */ }
  }
  const el = h('section', { className: 'km-today', 'aria-label': '今天想先练什么' }, line, h('div', { className: 'km-today-row' }, ...btns), note);
  if (container) container.append(el);
  return { el, pick, stop() { done = true; } };
}

// ---------------------------------------------------------------- “我”页面
export function createKidMeView(ctx, { root = null } = {}) {
  const el = root || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('tab-kidme') : null) || h('div');
  el.classList && el.classList.add('km');
  const toast = toastOf(ctx);
  let draft = null;      // 考试那一组没存的改动 { examDate, from, to }
  let nameDraft = null;  // 老师名字没存的字

  const units = () => K.unitChoices(ctx.curriculum);
  const title = id => (units().find(u => u.id === id) || {}).title || id || '';
  const order = id => { const u = units().find(x => x.id === id); return u ? u.order : 0; };

  async function saveProg(patch, msg) {
    let r;
    try { r = await K.saveProgress(ctx.kv, patch, { order, now: new Date() }); } catch (e) { toast('没存上，再点一次。'); return null; }
    if (r.error) { toast(r.error); return null; }
    if (msg) toast(msg);
    render();
    return r.progress;
  }
  async function savePrefs(patch, msg) {
    try { await K.savePrefs(ctx.kv, patch, new Date()); } catch (e) { toast('没存上，再点一次。'); return; }
    if (msg) toast(msg);
    render();
  }

  function unitGroup() {
    const list = units();
    const p = K.readProgress(ctx.kv);
    const body = !list.length
      ? h('p', { className: 'km-note', text: '课本还没放进来。请' + (ctx.parentName ? ctx.parentName() : '家长') + '在家长区导入课本。' })
      : h('div', { className: 'km-units', role: 'radiogroup', 'aria-label': '学到哪个单元' }, ...list.map(u => h('button', { type: 'button',
        className: 'km-unit' + (p.unit === u.id ? ' on' : ''), role: 'radio', 'aria-checked': String(p.unit === u.id), dataset: { unit: u.id },
        on: { click: () => saveProg({ unit: u.id }, `好，学到 ${u.title} 了。`) } }, h('span', { className: 'km-unit-t', text: u.title }))));
    return section('unit', '我们课上学到哪了？', '点你们课上正在学的那个单元。之前的单元我帮你复习，新词从这个单元出。', body);
  }

  function examGroup() {
    const list = units();
    const p = K.readProgress(ctx.kv);
    const d = draft || { examDate: p.examDate || '', from: p.examFrom || '', to: p.examTo || '' };
    const date = h('input', { type: 'date', className: 'km-date', value: d.examDate, 'aria-label': '考试那天',
      on: { change: e => { draft = { ...d, examDate: (e && e.target ? e.target.value : date.value) || '' }; } } });
    // 单元：第一下点“从”，第二下点“到”，第三下重新开始
    const inRange = id => d.from && d.to && order(id) >= Math.min(order(d.from), order(d.to)) && order(id) <= Math.max(order(d.from), order(d.to));
    const tapUnit = id => {
      const cur = draft || d;
      let next;
      if (!cur.from || (cur.from && cur.to && cur.from !== cur.to)) next = { ...cur, from: id, to: id };
      else next = { ...cur, to: id };
      if (order(next.from) > order(next.to)) next = { ...next, from: next.to, to: next.from };
      draft = next; render();
    };
    const chips = list.length ? h('div', { className: 'km-units km-range', 'aria-label': '考哪几个单元' }, ...list.map(u => h('button', { type: 'button',
      className: 'km-unit' + (inRange(u.id) ? ' on' : ''), 'aria-pressed': String(!!inRange(u.id)), dataset: { unit: u.id },
      on: { click: () => tapUnit(u.id) } }, h('span', { className: 'km-unit-t', text: u.title })))) : null;
    const rangeText = d.from ? (d.from === d.to ? `考 ${title(d.from)}` : `考 ${title(d.from)} 到 ${title(d.to)}`) : '点第一个单元，再点最后一个单元。';
    const body = [
      h('label', { className: 'km-label', text: '哪天考' }), date,
      h('label', { className: 'km-label', text: '考哪几个单元' }), chips || h('p', { className: 'km-note', text: '课本放进来以后才能选。' }),
      h('p', { className: 'km-range-text', text: rangeText }),
      h('div', { className: 'km-actions' },
        h('button', { type: 'button', className: 'btn km-save', text: '存好', on: { click: async () => {
          const cur = draft || d;
          const r = await saveProg({ examDate: cur.examDate || '', examFrom: cur.from || '', examTo: cur.to || cur.from || '' }, '考试记下了。考前两周我会帮你多练考试的词。');
          if (r) { draft = null; render(); }
        } } }),
        p.examDate || p.examFrom ? h('button', { type: 'button', className: 'text-btn km-clear', text: '考完了 / 还不知道', on: { click: async () => {
          draft = null; await saveProg({ examDate: '', examFrom: '', examTo: '' }, '好，先不排考试。');
        } } }) : null),
    ];
    return section('exam', '下次考试', '哪天考，考哪几个单元。不知道可以先不填，问问老师再来改。', body);
  }

  function chipGroup(key, list, chosen, max) {
    const set = new Set(chosen);
    return h('div', { className: 'km-chips', role: 'group' }, ...list.map(x => h('button', { type: 'button', className: 'km-chip' + (set.has(x.id) ? ' on' : ''),
      'aria-pressed': String(set.has(x.id)), dataset: { id: x.id, group: key }, text: x.zh,
      on: { click: () => {
        const next = new Set(chosen);
        if (next.has(x.id)) next.delete(x.id);
        else { if (next.size >= max) { toast(`最多选 ${max} 个。`); return; } next.add(x.id); }
        savePrefs({ [key]: [...next] });
      } } })));
  }
  function likesGroup() {
    const p = K.readPrefs(ctx.kv);
    const note = h('input', { type: 'text', className: 'km-input', maxLength: 60, value: p.storyNote, placeholder: '比如：一只会做饭的猫',
      'aria-label': '还想读什么故事', on: { change: e => savePrefs({ storyNote: (e && e.target ? e.target.value : note.value) || '' }, '记下了。') } });
    return section('likes', '我喜欢的', '老师举例子、出故事会照着你喜欢的来。点一下选上，再点一下取消。', [
      h('h3', { className: 'km-sub', text: '喜欢聊什么' }), chipGroup('topics', K.TOPICS, p.topics, 6),
      h('h3', { className: 'km-sub', text: '想读什么故事' }), chipGroup('stories', K.STORY_KINDS, p.stories, 4),
      h('label', { className: 'km-label', text: '还想读的（可以不写）' }), note,
      h('h3', { className: 'km-sub', text: '喜欢做哪种题' }), chipGroup('quiz', K.QUIZ_KINDS, p.quiz, 4),
    ]);
  }
  function teacherGroup() {
    const p = K.readPrefs(ctx.kv);
    const input = h('input', { type: 'text', className: 'km-input km-name', maxLength: 16, value: nameDraft !== null ? nameDraft : p.teacherName,
      placeholder: K.TEACHER_SUGGEST[0], 'aria-label': '老师的名字', on: { input: e => { nameDraft = (e && e.target ? e.target.value : input.value); } } });
    const save = name => {
      const n = String(name || '').trim();
      if (!n) { toast('先写一个名字。'); return; }
      nameDraft = null;
      savePrefs({ teacherName: n }, `好，以后我就叫“${n.slice(0, 16)}”。`);
    };
    return section('teacher', '想叫老师什么', '现在叫“' + (p.teacherName || '老师') + '”。想换一个就写下来。', [
      input,
      h('div', { className: 'km-chips' }, ...K.TEACHER_SUGGEST.map(n => h('button', { type: 'button', className: 'km-chip' + (p.teacherName === n ? ' on' : ''), text: n,
        on: { click: () => save(n) } }))),
      h('div', { className: 'km-actions' }, h('button', { type: 'button', className: 'btn km-save', text: '就叫这个', on: { click: () => save(input.value) } })),
    ]);
  }
  function levelGroup() {
    const d = K.difficulty(ctx.kv, new Date());
    const any = K.PARTS.some(p => d[p] !== 0);
    return section('level', '老师现在给你的难度', '每做完一部分，点“太简单 / 正好 / 太难”，我就照着调。一周不说，慢慢回到正好。', [
      h('ul', { className: 'km-levels' }, ...K.PARTS.map(p => h('li', { className: 'km-level', dataset: { part: p } },
        h('span', { className: 'km-level-k', text: K.PART_ZH[p] }), h('span', { className: 'km-level-v lv' + d[p], text: K.levelZh(d[p]) })))),
      any ? h('div', { className: 'km-actions' }, h('button', { type: 'button', className: 'text-btn km-reset', text: '都回到正好', on: { click: async () => {
        try { await K.resetLevels(ctx.kv, new Date()); toast('好，都回到正好。'); } catch (e) { toast('没存上，再点一次。'); }
        render();
      } } })) : null,
    ]);
  }
  function section(id, head, intro, body) {
    return h('section', { className: 'km-group', dataset: { group: id } },
      h('h2', { className: 'km-h', text: head }), intro ? h('p', { className: 'km-intro', text: intro }) : null, body);
  }
  function render() {
    const p = K.readProgress(ctx.kv);
    const top = K.progressText(p, { title });
    el.replaceChildren(
      h('header', { className: 'km-top' }, h('h1', { className: 'km-title', text: '我' }), top ? h('p', { className: 'km-now', text: top }) : null),
      unitGroup(), examGroup(), likesGroup(), teacherGroup(), levelGroup());
  }
  return {
    el,
    show(params = {}) { draft = null; nameDraft = null; if (params && params.open && el.dataset) el.dataset.open = params.open; render(); },
    onChange() { if (draft === null && nameDraft === null) render(); },
    holding() { return draft !== null || (nameDraft !== null && nameDraft.trim() !== K.readPrefs(ctx.kv).teacherName); },
    render,
  };
}
