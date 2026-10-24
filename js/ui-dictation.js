// 明天有听写，纸笔版的界面（DESIGN 5.3 的两张草图）：选单元、勾掉老师没划的词（默认当前单元的必会词）、选考法；
// 老师一个一个读（千问），她写在纸上，“第 x / n 个”“再听一遍”“下一个”；写完出答案，她自己逐个打勾；
// 错的马上再写一轮；结束时说“10 分钟后再写一次错的”，首页到时提醒；第二天早上首页有“出门前看一眼”。
// 逻辑都在 dictation.js（buildDictation、createDictation、saveDictation、tonightDictation、morningList）。
// v1：默认考法来自家长问卷“听写怎么考”（intake.js，按需 import()；没有就直接读 kv 'parent.intake' 的 dictation_way，
// 再没有用上一次的考法，最后是读中文写英文）；选词页和“再写一次错的”开头有老师的一句（lines 的 dictation 场景，
// phase 'before'），写完那页有一句（phase 'after'，带 wrong / perfect）；短语考法只出短语，英译汉不勾没有中文的词。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/dictation.css）。
//
// 导出
//   createDictationView(ctx) -> { show(params), inSession(), holding() }
//     渲染进 #tab-dictation。全屏，左上角“结束”回到今天。params：
//       { unit? }              直接选好这个单元
//       { method? }            直接选好这个考法
//       { retry: true }        首页“再写一次错的”：今天写错过的词再写一次（dictation.js tonightDictation）
//       { glance: true }       首页“出门前看一眼”：只看昨晚错的词，看完记 morningDone
//   wordsForUnit(curriculum, unit, method, entryOf?) -> [{ slug, w, cn, required, on }]   这个单元可以听写的词（buildDictation 的 candidates）
//     entryOf(slug) -> 词条：有 AI 讲解的词读它的 brief_cn。英译汉时没有中文的词不勾（对答案时没有可对的）
//   intakeMethod(intakeRecord, intakeModule?) -> 考法 id | ''   问卷里学校怎么考（第一个能用的）；ui-parent.js 也用
//     intakeModule 是 intake.js：用它的 intakeDefaults({ 'parent.intake': rec }).dictation（known 为假就是没答）
//   defaultMethod({ intake, intakeModule, last }) -> { method, from: 'school' | 'last' | '', order: [四种考法，学校的在前] }
//     这个单元没有短语、默认又是短语时，按 order 换下一种（setup 里）
//   pickLine(lines, scene, ctx, fit?) -> Line | null   lines.pick，最多换 4 次挑一句 when 合 fit(when) 的
//
// 用到的 ctx：curriculum.units / unitWords / isRequired、kv.peek('progress') / get / set、words（saveDictation 打开
// “写得出”线要 words.patch）、say、events.log / sessionId、go('home')、busy。
// 每个打勾记一条 events（d.event(slug)：type 'dictation'、slug、correct、mode 'paper'、choice 考法、round、pass）加 sid；
// 每轮对完 saveDictation 写 kv 'dictation:<YYYY-MM-DD>'。
import { h, icon } from './ui-dom.js';
import * as D from './dictation.js';
import { meaningOf } from './modes/choice.js';
import { dayOf } from './plan.js';
import { latestDictation, optionalModule } from './ui-home.js';

export function wordsForUnit(curriculum, unit, method = 'zh2en', entryOf = null) {
  if (!curriculum || !unit) return [];
  const plan = D.buildDictation({ unit, words: curriculum.unitWords(unit) || [], method, entryOf,
    isRequired: w => !!(curriculum.isRequired && curriculum.isRequired(w)) });
  // 英译汉 is checked against the Chinese: a word without one is left unticked
  return plan.candidates.map(c => ({ slug: c.slug, w: c.w, cn: c.cn || '', required: !!c.required, on: !!c.on && (method !== 'en2zh' || !!c.cn) }));
}

// The school's way from the parent's intake answer “听写怎么考” (multi; the first one that is a method here).
// intake.js (written in parallel) decides when it is there; otherwise the answer is read as it is stored.
export function intakeMethod(rec, I = null) {
  const ok = m => (typeof m === 'string' && D.METHOD_LABEL[m] ? m : '');
  try {
    if (I && typeof I.intakeDefaults === 'function') {
      // intake.js reads a kv; a plain object keyed like kv works too
      const d = (I.intakeDefaults({ 'parent.intake': rec }) || {}).dictation || {};
      if (d.known === false) return '';
      const m = ok(d.method);
      if (m) return m;
    }
  } catch (e) { console.warn('dictation: intake:', (e && e.message) || e); }
  const a = rec && rec.answers ? rec.answers.dictation_way : null;
  return (Array.isArray(a) ? a : a ? [a] : []).map(ok).find(Boolean) || '';
}
export function defaultMethod({ intake = null, intakeModule = null, last = '' } = {}) {
  const school = intakeMethod(intake, intakeModule);
  const a = intake && intake.answers ? [].concat(intake.answers.dictation_way || []) : [];
  const order = [...new Set([school, ...a, last, 'zh2en', ...D.METHODS.map(m => m[0])].filter(m => D.METHOD_LABEL[m]))];
  if (school) return { method: school, from: 'school', order };
  if (D.METHOD_LABEL[last]) return { method: last, from: 'last', order };
  return { method: 'zh2en', from: '', order };
}

// lines.pick, trying up to 4 lines for one whose `when` fits (e.g. the wrong-words lines after a dictation with mistakes)
export function pickLine(lines, scene, c = {}, fit = null) {
  if (!lines || typeof lines.pick !== 'function') return null;
  let all = [];
  try { all = (lines.all && lines.all().lines) || []; } catch (e) { all = []; }
  const whenOf = id => ((all.find(x => x && x.id === id) || {}).when) || {};
  const recent = [].concat(c.recent || []);
  let first = null;
  for (let i = 0; i < 4; i++) {
    const l = lines.pick(scene, { ...c, recent: recent.slice() });
    if (!l) break;
    if (!first) first = l;
    if (!fit || fit(whenOf(l.id))) return l;
    if (recent.includes(l.id)) break;
    recent.push(l.id);
  }
  return first;
}

export function createDictationView(ctx) {
  const root = document.getElementById('tab-dictation');
  root.replaceChildren();
  const stage = h('div', { className: 'dict' });
  root.append(stage);

  let d = null;           // a Dictation from dictation.js
  let method = 'zh2en';
  let unit = '';
  let list = [];          // candidate words on the setup screen
  let picked = new Set(); // slugs she will write
  let fromBook = false;
  let sid = '';
  let t0 = 0;
  let pass = 'main';      // 'main' | 'tonight' (the reminder from 今天)
  let busy = false;
  let lastRec = null;
  let methodFrom = '';     // 'school' when the default came from the parent's intake answer
  let line = null;         // the teacher's line on this screen (lines 'dictation' scene)
  let I = null;            // intake.js, once loaded
  optionalModule('./intake.js').then(m => { I = m; });

  const header = (title, onEnd = end) => h('header', { className: 'runhead session' },
    h('button', { type: 'button', className: 'text-btn', text: '结束', on: { click: onEnd } }),
    h('span', { className: 'runhead-title', text: title }), h('span'));
  const log = ev => { try { ctx.events.log({ sid, ...ev }); } catch (e) { /* never blocks */ } };
  const units = () => { try { return ctx.curriculum.units() || []; } catch (e) { return []; } };
  const unitTitle = id => (units().find(u => u.id === id) || {}).title || id;
  const setBusy = on => { if (on !== busy) { busy = on; ctx.busy(on ? +1 : -1); } };
  const minutes = () => Math.round((Date.now() - t0) / 60000);
  const name = () => (ctx.kv.peek('profile', {}) || {}).name || 'Emma';

  // the teacher's line, like 今天's: “老师说”, the English line, the Chinese until it fades, 听一遍 and 看中文
  function say1(scene, c, fit) {
    let l = null;
    try { l = pickLine(ctx.lines, scene, { name: name(), ...c }, fit); } catch (e) { l = null; }
    if (l) { try { ctx.lines.markSeen(l.id); } catch (e) { /* never blocks */ } }
    return l;
  }
  function teacherLine(l) {
    if (!l) return null;
    const zh = h('p', { className: 'dict-zh', lang: 'zh-CN', text: l.zh, hidden: !l.showZh });
    const zhBtn = !l.zh ? null : h('button', { type: 'button', className: 'dict-pill', text: l.showZh ? '收起中文' : '看中文',
      on: { click: ev => {
        const open = zh.hidden;
        zh.hidden = !open;
        l.showZh = open;
        ev.currentTarget.textContent = open ? '收起中文' : '看中文';
        if (open) (ctx.lines.tapZh || ctx.lines.markZhTapped || (() => {}))(l.id);
      } } });
    return h('div', { className: 'dict-hello' },
      h('p', { className: 'dict-hello-label', text: '老师说' }),
      h('p', { className: 'dict-en', lang: 'en', text: l.en }),
      zh,
      h('div', { className: 'dict-pills' },
        h('button', { type: 'button', className: 'dict-pill', on: { click: ev => ctx.say(l.en, ev.currentTarget) } }, icon('speak'), h('span', { text: '听一遍' })),
        zhBtn));
  }
  const fitBefore = w => w.phase === 'before';
  const fitAfter = (wrong, perfect) => w => (perfect ? !!w.perfect : wrong ? !!w.wrong : w.phase === 'after' && !w.wrong && !w.perfect);

  // ---------------------------------------------------------------- setup (sketch 1)

  // out: words she took out on this screen; they stay out when only the way changes
  function loadList(out = new Set()) {
    const us = units();
    fromBook = us.length > 0;
    if (fromBook) {
      if (!unit || !us.some(u => u.id === unit)) {
        const p = (ctx.kv.peek('progress', {}) || {}).unit;
        unit = us.some(u => u.id === p) ? p : us[us.length - 1].id;
      }
      list = wordsForUnit(ctx.curriculum, unit, method, s => (ctx.words && ctx.words.get ? ctx.words.get(s) : null));
      picked = new Set(list.filter(x => x.on && !out.has(x.slug)).map(x => x.slug));
    } else {
      unit = '';
      list = ctx.words.favorites().slice(-10).map(e => ({ slug: e.slug, w: e.headword, cn: meaningOf(e) }));
      picked = new Set(list.map(x => x.slug));
    }
  }

  function setup(params = {}) {
    d = null;
    pass = 'main';
    setBusy(false);
    if (params.unit) unit = params.unit;
    let order = [];
    if (params.method && D.METHOD_LABEL[params.method]) { method = params.method; methodFrom = ''; }
    else {
      const last = latestDictation(ctx.kv);
      const dm = defaultMethod({ intake: ctx.kv.peek('parent.intake', null), intakeModule: I, last: last && last.rec ? last.rec.method : '' });
      method = dm.method;
      methodFrom = dm.from;
      order = dm.order;
    }
    line = say1('dictation', { phase: 'before' }, fitBefore);
    loadList();
    // a unit with no phrases (Unit 3) and 短语 as the default: the next way the school uses
    const school = [].concat(((ctx.kv.peek('parent.intake', null) || {}).answers || {}).dictation_way || []);
    for (const m of order) {
      if (list.length || !fromBook) break;
      if (m === method) continue;
      method = m;
      methodFrom = school.includes(m) ? 'school' : '';
      loadList();
    }
    drawSetup();
  }

  const chip = (text, on, onClick) => h('button', { type: 'button', className: 'dict-chip', 'aria-pressed': on ? 'true' : 'false', text, on: { click: onClick } });
  const countText = () => `${fromBook ? unitTitle(unit) + ' · ' : ''}${list.filter(x => picked.has(x.slug)).length} 个词`;

  function drawSetup() {
    const us = units();
    const count = h('p', { className: 'lede dict-count-line', text: countText() });
    const go = h('button', { type: 'button', className: 'btn dict-start', disabled: !picked.size, on: { click: begin } }, '开始', icon('arrow'));
    const toggle = (x, b) => {
      if (picked.has(x.slug)) picked.delete(x.slug); else picked.add(x.slug);
      b.setAttribute('aria-pressed', picked.has(x.slug) ? 'true' : 'false');
      count.textContent = countText();
      go.disabled = !picked.size;
    };
    stage.replaceChildren(header('明天有听写', () => ctx.go('home')),
      h('section', { className: 'dict-setup' },
        teacherLine(line),
        count,
        fromBook && us.length > 1 ? h('div', { className: 'dict-sec' },
          h('p', { className: 'dict-label', text: '哪个单元？' }),
          h('div', { className: 'dict-chips' }, us.map(u => chip(u.title || u.id, u.id === unit, () => { unit = u.id; loadList(); drawSetup(); })))) : null,
        h('div', { className: 'dict-sec' },
          h('p', { className: 'dict-label', text: '老师怎么考？' }),
          h('div', { className: 'dict-chips' }, D.METHODS.map(([id, label]) => chip(label, id === method, () => {
            if (id === method) return;
            // phrases and words are different lists; 英译汉 leaves out words with no Chinese. Her own picks stay out.
            const reload = fromBook && ((id === 'phrase') !== (method === 'phrase') || (id === 'en2zh') !== (method === 'en2zh'));
            const out = new Set(list.filter(x => !picked.has(x.slug)).map(x => x.slug));
            method = id;
            methodFrom = '';
            if (reload) loadList(out);
            drawSetup();
          }))),
          methodFrom === 'school' ? h('p', { className: 'small dict-hint', text: '学校常这样考，先选好了。' }) : null),
        h('div', { className: 'dict-sec' },
          h('p', { className: 'dict-label', text: fromBook ? '老师没划的词，点一下去掉' : '还没导入课本，先用单词本里最近的词' }),
          list.length ? h('ul', { className: 'dict-pick' }, list.map(x => {
            const b = h('button', { type: 'button', className: 'dict-word', 'aria-pressed': picked.has(x.slug) ? 'true' : 'false' },
              h('span', { className: 'box', 'aria-hidden': 'true' }, icon('check')),
              h('span', { className: 'w', lang: 'en', text: x.w }),
              h('span', { className: 'cn', text: x.cn || (method === 'en2zh' ? '还没有中文' : '') }));
            b.addEventListener('click', () => toggle(x, b));
            return h('li', {}, b);
          })) : h('p', { className: 'small', text: method === 'phrase' ? '这个单元没有短语。换个单元或考法试试。' : '这里还没有词。' })),
        h('p', { className: 'dict-paper', text: '拿出纸和笔，听一个写一个。' }),
        h('div', { className: 'btn-row' }, go)));
  }

  function begin() {
    const words = list.filter(x => picked.has(x.slug)).map(({ slug, w, cn }) => ({ slug, w, cn }));
    if (!words.length) return;
    run(D.createDictation({ words, method, unit, kind: 'main' }));
  }

  function run(dict) {
    sid = ctx.events.sessionId();
    t0 = Date.now();
    d = dict;
    log({ type: 'session_start', step: 'dictation', kind: 'dictation', hour: new Date().getHours(), unit: d.unit || undefined, pass });
    setBusy(true);
    draw();
  }

  // ---------------------------------------------------------------- listening (sketch 1, lower half)

  function draw() {
    if (!d) return;
    if (d.phase === 'writing') drawWriting(); else drawCheck();
  }

  function drawWriting() {
    const w = d.current();
    if (!w) { d.finishWriting(); drawCheck(); return; }
    const p = d.prompt ? d.prompt() : D.promptFor(w, d.method);
    const say = btn => ctx.say(p.say, btn);
    const pr = d.progress ? d.progress() : { n: d.index + 1, total: d.words.length };
    const last = pr.n >= pr.total;
    const again = h('button', { type: 'button', className: 'text-btn accent dict-again', on: { click: ev => say(ev.currentTarget) } }, icon('speak'), '再听一遍');
    stage.replaceChildren(header(d.kind === 'main' ? '听写' : '再写一遍'),
      h('section', { className: 'dict-run' },
        h('p', { className: 'dict-count' }, '第 ', h('span', { className: 'num', text: String(pr.n) }), ' / ', h('span', { className: 'num', text: String(pr.total) }), ' 个'),
        p.show ? h('p', { className: 'dict-prompt', lang: p.lang, text: p.show }) : h('p', { className: 'dict-prompt listen', text: '听老师读' }),
        again,
        h('div', { className: 'dict-run-foot' },
          h('button', { type: 'button', className: 'btn dict-next', on: { click: () => { d.next(); draw(); } } }, last ? '写完了' : '下一个', last ? null : icon('arrow')),
          d.index > 0 ? h('button', { type: 'button', className: 'text-btn', text: '上一个', on: { click: () => { d.back(); draw(); } } }) : null)));
    // read right away, inside the tap that got here, so iPad lets it play (if it is blocked she taps 再听一遍)
    say(again);
  }

  // ---------------------------------------------------------------- checking (sketch 2)

  function drawCheck() {
    const rows = d.answers ? d.answers() : d.words.map(w => ({ ...w, answer: D.promptFor(w, d.method).answer, mark: w.slug in d.marks() ? d.marks()[w.slug] : null }));
    const zhAnswer = d.method === 'en2zh';
    const markBtn = (w, ok) => h('button', { type: 'button', className: 'dict-mark ' + (ok ? 'ok' : 'bad'), 'aria-pressed': w.mark === ok ? 'true' : 'false',
      'aria-label': `${w.w} ${ok ? '写对了' : '写错了'}`, text: ok ? '对' : '错', on: { click: () => mark(w, ok) } });
    const left = rows.filter(w => w.mark === null).length;
    stage.replaceChildren(header('对一下'),
      h('section', { className: 'dict-check' },
        h('p', { className: 'dict-label', text: '对一下，写对的打勾' }),
        h('ul', { className: 'dict-list' }, rows.map(w => {
          const other = zhAnswer ? w.w : w.cn;
          return h('li', { className: 'dict-item' + (w.mark === true ? ' ok' : w.mark === false ? ' bad' : '') },
            h('span', { className: 'a', lang: zhAnswer ? 'zh-CN' : 'en', text: w.answer || (zhAnswer ? '（还没有中文）' : w.w) }),
            markBtn(w, true), markBtn(w, false),
            other ? h('span', { className: 'b', lang: zhAnswer ? 'en' : 'zh-CN', text: other }) : null);
        })),
        checkFoot(left)));
  }

  function checkFoot(left) {
    if (d.phase !== 'done') return h('div', { className: 'dict-foot' }, h('p', { className: 'small', text: `还有 ${left} 个没对` }));
    const bad = d.wrong();
    if (!bad.length) {
      return h('div', { className: 'dict-foot' }, h('p', { className: 'dict-result', text: d.kind === 'main' ? '全对了。' : '这一遍全对了。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '写完了', on: { click: finish } })));
    }
    return h('div', { className: 'dict-foot' },
      h('p', { className: 'dict-result', text: `错了 ${bad.length} 个：现在再写一遍这 ${bad.length} 个` }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '再写一遍', on: { click: () => { const next = d.retryRound(); if (next) { d = next; draw(); } } } }),
        h('button', { type: 'button', className: 'text-btn', text: '先到这里', on: { click: finish } })));
  }

  function mark(w, ok) {
    if (!d || d.phase === 'writing') return;
    const was = d.phase;
    d.mark(w.slug, ok);
    log({ ...(d.event ? d.event(w.slug) : { type: 'dictation', step: 'dictation', slug: w.slug, correct: ok, mode: 'paper', choice: d.method }) });
    if (d.phase === 'done') save();
    // redraw in place: the list keeps its scroll position
    const y = window.scrollY;
    drawCheck();
    if (was === d.phase) window.scrollTo(0, y);
  }

  function save() {
    if (!d) return Promise.resolve(lastRec);
    const p = D.saveDictation({ kv: ctx.kv, d, words: ctx.words, now: new Date() })
      .then(rec => { lastRec = rec; return rec; })
      .catch(e => { console.warn('dictation: not saved:', (e && e.message) || e); return lastRec; });
    return p;
  }

  async function finish() {
    const tonight = d && d.kind === 'tonight';
    const rec = await save();
    const bad = rec ? D.morningList(rec) : [];
    log({ type: 'session_end', step: 'dictation', kind: 'dictation', min: minutes(), steps_done: ['dictation'], completed: true, pass, wrong: bad.length });
    d = null;
    setBusy(false);
    const perfect = !bad.length;
    line = say1('dictation', { phase: 'after', wrong: bad.length, perfect }, fitAfter(bad.length, perfect));
    stage.replaceChildren(header('听写', () => ctx.go('home')),
      h('section', { className: 'dict-done' },
        h('p', { className: 'lede', text: !bad.length ? '全对了。' : tonight ? '又写了一遍。' : '今天的听写写完了。' }),
        teacherLine(line),
        bad.length && !tonight ? h('p', { className: 'dict-next-line', text: `${D.REMIND_AFTER_MIN || 10} 分钟后再写一次错的，首页会提醒你。` }) : null,
        h('p', { className: 'small', text: bad.length ? '明天早上出门前，再看一眼这几个词。' : '明天听写顺利。' }),
        bad.length ? h('ul', { className: 'dict-mini' }, bad.map(w => h('li', {}, h('span', { className: 'serif', lang: 'en', text: w.w }), h('span', { className: 'small', text: w.cn })))) : null,
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => ctx.go('home') } }))));
  }

  function end() {
    if (d) {
      log({ type: 'exit', step: 'dictation', after_item: d.phase === 'writing' ? d.index : d.words.length, wrong_streak: 0 });
      log({ type: 'session_end', step: 'dictation', kind: 'dictation', min: minutes(), steps_done: [], completed: false, pass });
      if (d.phase === 'done') save();
    }
    d = null;
    setBusy(false);
    ctx.go('home');
  }

  // ---------------------------------------------------------------- the two reminders from 今天

  function startTonight() {
    const key = D.recordKey ? D.recordKey(dayOf(new Date())) : 'dictation:' + dayOf(new Date());
    const rec = ctx.kv.peek(key, null);
    const next = rec ? D.tonightDictation(rec) : null;
    if (!next) { setup({}); return; }
    pass = 'tonight';
    method = next.method;
    unit = next.unit;
    // lines.js 'tonight': the second go at tonight's wrong words (the plain 'before' lines if there is none)
    line = say1('dictation', { phase: 'tonight' }, w => w.phase === 'tonight' || w.phase === 'before');
    stage.replaceChildren(header('再写一次错的', () => ctx.go('home')),
      h('section', { className: 'dict-setup' },
        teacherLine(line),
        h('p', { className: 'lede', text: `今天错的 ${next.words.length} 个，再写一次` }),
        h('p', { className: 'dict-paper', text: '拿出纸和笔，大约 1 分钟。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn dict-start', on: { click: () => run(next) } }, '开始', icon('arrow')))));
  }

  function glance() {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const key = D.recordKey ? D.recordKey(dayOf(y)) : 'dictation:' + dayOf(y);
    const rec = ctx.kv.peek(key, null);
    const words = rec ? D.morningList(rec) : [];
    if (!words.length) { setup({}); return; }
    const done = () => {
      ctx.kv.set(key, D.markMorningDone(rec)).catch(e => console.warn('dictation: glance:', (e && e.message) || e));
      ctx.go('home');
    };
    // lines.js 'morning': one line before school
    line = say1('dictation', { phase: 'morning' }, w => w.phase === 'morning');
    stage.replaceChildren(header('出门前看一眼', () => ctx.go('home')),
      h('section', { className: 'dict-glance' },
        teacherLine(line),
        h('p', { className: 'lede', text: `昨晚错的 ${words.length} 个` }),
        h('ul', { className: 'dict-glance-list' }, words.map(w => h('li', {},
          h('span', { className: 'w', lang: 'en' }, w.w,
            h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say(w.w, ev.currentTarget) } }, icon('speak'))),
          h('span', { className: 'cn', text: w.cn })))),
        h('p', { className: 'small', text: '心里拼一遍，看看自己记住没有。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '看完了', on: { click: done } }))));
  }

  return {
    show(params = {}) {
      d = null;
      setBusy(false);
      if (params.glance) { glance(); return; }
      if (params.retry) { startTonight(); return; }
      setup(params);
    },
    inSession: () => !!(d && d.phase !== 'done'),
    holding: () => false,
  };
}
