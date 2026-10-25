// 我要复习考试（Wei 10-25）：入口页选单元（多选）、哪天考，点“帮我复习”，马上排好一套复习（review.js buildReview），
// 存 kv 'review:plan'；复习时沿用上课的四格外壳（lesson.css 的 runhead、lesson-cells），四格是 单词 → 语法 → 阅读 → 小测，
// 每格调现成题型的 render：单词卡 modes/choice.js choiceMode、modes/listen.js listenMode、modes/spell.js spellMode、
// modes/cloze.js clozeMode（出不了题一路退到四选一、闪卡，和上课一样）；语法 ui-grammar.js renderGrammarItem、renderContrast；
// 阅读 ui-reader.js renderPassage；小测先拼写（spellMode，line 'write'），再语法题，再一篇只做题的阅读。
// 负责：复习考试 agent。样式 css/review-request.css（类名 rvq-），四格外壳借 lesson.css。
//
// 导出
//   createReviewRequestView(ctx, { root? }) -> { show(params), inSession(), holding(), hide(), onChange(), el }
//     画进 #tab-revise（没有这个元素就自己在 <main> 里建一个；接线要加路由 'revise'，见 wip/b5/review-needs.md）。
//     params：{ units?: ['U1', 'U2'] | ['u1'], date?: 'YYYY-MM-DD', start?: true（有就直接开始今天那份）, focus? }
//     问老师识别到“我要考 Unit 1 2”以后 ctx.go('revise', reviewReply(...).action.params)；首页“我要复习考试”ctx.go('revise')。
//   pickedDate(choice, now) -> 'YYYY-MM-DD'   入口页“今天 / 明天 / 后天”换成日子（choice 是 0、1、2 或日子本身）
//   unitChoices(ctx) -> [{ id, label, title }]   入口页能选的单元：课本导入过就按课本，没有就 Starter 到 Unit 6
//
// 记的事件（CONTRACTS 第 6 节的字段）：session_start { kind: 'review', review: plan.id, day: 第几份, hour }、
// predict（单词卡，和上课一样）、answer / review（step 'review'，另带 review: plan.id）、session_end { min, steps_done, completed, kind: 'review' }。
// 语法题、对比小卡、阅读由各自的模块记（step 'review'）。小测拼错的词开“写得出”线：words.patch(slug, { write: true, write_at, write_from: 'review' })。
import { h, icon, toast } from './ui-dom.js';
import { createSession } from './session.js';
import { endOfDay, State } from './fsrs.js';
import * as Choice from './modes/choice.js';
import { flashcard } from './ui-review.js';
import { loadV1, eventModeOf } from './ui-lesson.js';
import { isoLocal } from './events.js';
import * as V from './review.js';
import * as R from './reader.js';

const round2 = x => Math.round(x * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const DEFAULT_UNITS = ['S', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'];

export function pickedDate(choice, now = new Date()) {
  if (typeof choice === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(choice)) return choice;
  const n = Number(choice);
  return Number.isFinite(n) && n >= 0 ? V.addDays(V.dayOf(now), Math.floor(n)) : '';
}
export function unitChoices(ctx) {
  let list = [];
  try { list = (ctx && ctx.curriculum && ctx.curriculum.units ? ctx.curriculum.units() : []) || []; } catch (e) { list = []; }
  const ids = list.map(u => V.normUnit(u.id)).filter(Boolean);
  const use = ids.length ? [...new Set(ids)] : DEFAULT_UNITS;
  return use.map(id => {
    const u = list.find(x => V.normUnit(x.id) === id);
    return { id, label: V.unitName(id), title: (u && u.title && u.title !== V.unitName(id) ? u.title : '') };
  });
}
const monthDay = day => { const [, m, d] = String(day).split('-').map(Number); return `${m} 月 ${d} 日`; };
function whenLabel(day, now) {
  const g = V.gapDays(V.dayOf(now), day);
  return g === 0 ? '今天' : g === 1 ? '明天' : g === 2 ? '后天' : monthDay(day);
}

const modeOf = (mod, ...names) => {
  if (!mod) return null;
  for (const n of names) if (mod[n] && typeof mod[n].render === 'function') return mod[n];
  return null;
};
const fnOf = (mod, name) => (mod && typeof mod[name] === 'function' ? mod[name] : null);

export function createReviewRequestView(ctx, { root = null } = {}) {
  let host = root || (typeof document !== 'undefined' ? document.getElementById('tab-revise') : null);
  if (!host && typeof document !== 'undefined') {
    host = h('section', { id: 'tab-revise', className: 'tab', hidden: true });
    (document.querySelector('main') || document.body).append(host);
  }
  const stage = h('div', { className: 'lesson rvq' });
  host.replaceChildren(stage);

  let mods = {};
  let data = null;          // review.js loadReviewData
  let plan = null;
  let dayIdx = -1;
  let day = null;           // dayFor(plan, dayIdx)
  let sid = '';
  let t0 = 0;
  let cellAt = -1;          // which of the four cells is on now
  let running = false;
  let view = null;          // { onKey, stop? }
  let session = null;
  let cur = null;
  let lastGrade = 0;
  let skipped = new Set();
  let firstSeen = new Set();
  let ratedToday = new Set();
  let tally = { known: 0, wrote: 0, gright: 0, gtotal: 0, wrongWords: new Set(), wrongItems: new Set(), read: false };
  let pick = { units: new Set(), date: '' };
  let token = 0;

  const log = ev => { try { return ctx.events.log({ sid, review: plan && plan.id, ...ev }); } catch (e) { return null; } };
  const say = (text, btn) => (ctx.say ? ctx.say(text, btn) : null);
  const now = () => new Date();
  const unitOf = e => { try { return (e && (e.unit || ctx.curriculum.unitOf(e.headword))) || undefined; } catch (err) { return undefined; } };
  const hold = on => {
    if (on && !running) { running = true; try { ctx.busy(+1); } catch (e) { /* no busy counter */ } }
    if (!on && running) { running = false; try { ctx.busy(-1); } catch (e) { /* no busy counter */ } }
  };
  const save = async () => { try { await V.savePlan(ctx.kv, plan); } catch (e) { console.warn('review: save:', (e && e.message) || e); } };
  const note = r => { plan = V.noteResult(plan, { ...r, now: now() }); save(); };

  function header(title, back) {
    return h('header', { className: 'runhead session' },
      h('button', { type: 'button', className: 'text-btn', text: back ? '返回' : running ? '结束' : '回到今天', on: { click: back || quit } }),
      h('span', { className: 'runhead-title', text: title }),
      h('span', { className: 'lesson-kind', text: running ? '复习' : '' }));
  }

  // ---------------------------------------------------------------- the entry page

  function entry(params = {}) {
    hold(false);
    running = false;
    view = null;
    const n0 = now();
    const choices = unitChoices(ctx);
    pick = { units: new Set((params.units || []).map(V.normUnit).filter(id => choices.some(c => c.id === id))), date: /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : '' };
    const active = V.activePlan(ctx.kv, n0);
    const go = h('button', { type: 'button', className: 'btn rvq-go', text: '帮我复习', on: { click: () => make(params.focus) } });
    const hint = h('p', { className: 'small rvq-hint', role: 'status' });
    const refresh = () => {
      const ok = pick.units.size > 0 && !!pick.date && V.gapDays(V.dayOf(n0), pick.date) >= 0;
      go.disabled = !ok;
      hint.textContent = !pick.units.size ? '先选要考的单元，可以选好几个。' : !pick.date ? '再选哪天考。' : V.gapDays(V.dayOf(n0), pick.date) < 0 ? '这一天已经过去了，换一天。' : planHint(pick.date, n0);
    };
    const chips = choices.map(c => {
      const b = h('button', { type: 'button', className: 'rvq-chip', 'aria-pressed': pick.units.has(c.id) ? 'true' : 'false', on: { click: () => {
        if (pick.units.has(c.id)) pick.units.delete(c.id); else pick.units.add(c.id);
        b.setAttribute('aria-pressed', pick.units.has(c.id) ? 'true' : 'false');
        refresh();
      } } }, h('b', { text: c.label }), c.title ? h('span', { className: 'rvq-chip-sub', text: c.title }) : null);
      return b;
    });
    const dateInput = h('input', { type: 'date', className: 'rvq-date-input', min: V.dayOf(n0), value: pick.date, 'aria-label': '考试那天',
      on: { change: ev => { pick.date = ev.currentTarget.value || ''; mark(); refresh(); } } });
    const dayBtns = [0, 1, 2].map(k => h('button', { type: 'button', className: 'rvq-chip rvq-day', dataset: { k: String(k) }, text: ['今天', '明天', '后天'][k],
      on: { click: () => { pick.date = pickedDate(k, n0); dateInput.value = pick.date; mark(); refresh(); } } }));
    const mark = () => dayBtns.forEach((b, k) => b.setAttribute('aria-pressed', pick.date === pickedDate(k, n0) ? 'true' : 'false'));
    mark();
    const current = active ? currentBlock(active, n0) : null;
    stage.replaceChildren(
      header('我要复习考试'),
      h('div', { className: 'rvq-page' },
        current,
        h('p', { className: 'lede rvq-lede', text: '要考试了？告诉我考哪几个单元、哪天考，我给你排好复习。' }),
        h('section', { className: 'rvq-block' }, h('h2', { className: 'rvq-h', text: '考哪几个单元' }), h('div', { className: 'rvq-chips', role: 'group', 'aria-label': '单元' }, chips)),
        h('section', { className: 'rvq-block' }, h('h2', { className: 'rvq-h', text: '哪天考' }),
          h('div', { className: 'rvq-chips', role: 'group', 'aria-label': '哪天考' }, dayBtns),
          h('label', { className: 'rvq-date' }, h('span', { className: 'small', text: '别的日子' }), dateInput)),
        h('div', { className: 'rvq-actions' }, go, hint)));
    refresh();
  }
  function planHint(date, n0) {
    const g = V.gapDays(V.dayOf(n0), date);
    if (g === 0) return '今天考：挑最要紧的看一眼，5 分钟左右。';
    if (g === 1) return '明天考：今天一份，20 分钟以内。';
    return `还有 ${g} 天：分 ${Math.min(g, V.MAX_DAYS)} 天，每天一小份，最后一天做小测。`;
  }
  function currentBlock(p, n0) {
    const i = V.todayIndex(p, n0);
    if (i < 0) return null;
    const d = p.days[i];
    const ahead = d.day > V.dayOf(n0);
    return h('section', { className: 'rvq-current' },
      h('p', { className: 'rvq-current-title serif', text: `${p.names}${p.date ? '，' + whenLabel(p.date, n0) + '考' : ''}` }),
      h('p', { className: 'small', text: V.summaryLine(p, i) }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: ahead ? `提前做第 ${d.n} 天` : '接着复习', on: { click: () => begin(p, i) } })));
  }

  async function make(focus) {
    const my = ++token;
    const units = [...pick.units];
    const date = pick.date;
    const btn = stage.querySelector('.rvq-go');
    if (btn) { btn.disabled = true; btn.textContent = '稍等……'; }
    try {
      data = data || await V.loadReviewData(ctx);
      if (my !== token) return;
      const p = V.buildReview(ctx, { units, date, focus, ...data });
      if (!p) { toast('没排出来，换个单元或日子试试。'); if (btn) { btn.disabled = false; btn.textContent = '帮我复习'; } return; }
      plan = p;
      await save();
      preview();
    } catch (err) {
      console.warn('review: make:', (err && err.message) || err);
      toast('没排出来，再点一次。');
      if (btn) { btn.disabled = false; btn.textContent = '帮我复习'; }
    }
  }

  function preview() {
    const n0 = now();
    const i = V.todayIndex(plan, n0);
    const rows = plan.days.map((d, k) => h('li', { className: 'rvq-day-row' + (k === i ? ' now' : '') },
      h('b', { className: 'serif', text: plan.days.length > 1 ? `第 ${d.n} 天 · ${whenLabel(d.day, n0)}` : whenLabel(d.day, n0) }),
      h('span', { className: 'small', text: `${d.cells.filter(c => c.status === 'ready').map(c => c.label).join('、')}，约 ${Math.max(1, d.minutes)} 分钟` })));
    const lead = plan.kind === 'today' ? `${plan.names}，今天考。挑最要紧的，几分钟看一眼。`
      : plan.kind === 'cram' ? `${plan.names}，明天考。今天这一份练最要紧的，20 分钟以内。`
      : `${plan.names}，${monthDay(plan.date)}考。分 ${plan.days.length} 天，每天一小份。`;
    const empty = !plan.stats.words ? h('p', { className: 'small rvq-hint', text: '这几个单元的词还没进单词本，先练语法和阅读。' }) : null;
    stage.replaceChildren(
      header('排好了', () => entry({ units: plan.units, date: plan.date })),
      h('div', { className: 'rvq-page' },
        h('p', { className: 'lede rvq-lede', text: lead }),
        empty,
        h('ol', { className: 'rvq-days' }, rows),
        h('div', { className: 'rvq-actions' },
          i >= 0 ? h('button', { type: 'button', className: 'btn', text: plan.days[i].day > V.dayOf(n0) ? `提前做第 ${plan.days[i].n} 天` : '开始今天的复习', on: { click: () => begin(plan, i) } }) : null,
          h('button', { type: 'button', className: 'text-btn', text: '先回到今天', on: { click: () => ctx.go('home') } }))));
  }

  // ---------------------------------------------------------------- one day's review, in the four cells

  async function begin(p, i) {
    const my = ++token;
    plan = p;
    try { mods = await loadV1(); } catch (e) { mods = {}; }
    try { data = data || await V.loadReviewData(ctx); } catch (e) { data = data || {}; }
    if (my !== token) return;
    dayIdx = i;
    day = V.dayFor(plan, i, { content: data.grammar || null, now: now() });
    if (!day) { entry({}); return; }
    sid = ctx.events.sessionId();
    t0 = Date.now();
    tally = { known: 0, wrote: 0, gright: 0, gtotal: 0, wrongWords: new Set(), wrongItems: new Set(), read: false };
    skipped = new Set();
    firstSeen = new Set();
    ratedToday = new Set();
    hold(true);
    log({ type: 'session_start', kind: 'review', day: day.n, of: day.of, hour: new Date().getHours(), units: plan.units.join(',') });
    cellAt = -1;
    nextCell();
  }

  const doneCells = () => new Set(Object.keys(((plan.done || {})[String(dayIdx)] || {}).cells || {}));
  function strip(nowId) {
    const done = doneCells();
    return h('ol', { className: 'lesson-cells', 'aria-label': '今天的四格' }, day.cells.map(c => {
      const st = c.id === nowId ? 'now' : done.has(c.id) ? 'done' : c.status === 'ready' ? 'ready' : 'skip';
      const sub = st === 'now' ? '正在做' : st === 'done' ? '做完了' : st === 'skip' ? (c.note || '') : (c.note || '');
      return h('li', { className: 'lesson-cell ' + st, 'aria-current': st === 'now' ? 'step' : null },
        h('b', { text: c.label }), h('span', { className: 'st' }, st === 'done' ? icon('check') : null, sub));
    }));
  }
  function paint(cell, ...body) {
    stage.replaceChildren(...[header(day.title), strip(cell.id), ...body.flat()].filter(Boolean));
  }

  function nextCell() {
    if (!running) return;
    for (cellAt++; cellAt < day.cells.length; cellAt++) {
      const c = day.cells[cellAt];
      if (c.status !== 'ready' || doneCells().has(c.id)) continue;
      if (c.id === 'words') return startWords(c);
      if (c.id === 'grammar') return startGrammar(c, () => finishCell(c));
      if (c.id === 'read') return startRead(c, c.passage, () => finishCell(c));
      if (c.id === 'quiz') return startQuiz(c);
    }
    wrap();
  }
  async function finishCell(c) {
    plan = V.markCell(plan, dayIdx, c.id, now());
    await save();
    nextCell();
  }

  // ---- 单词: one round like the warm-up (session.js), FSRS ratings through words.review

  function poolOf(queue) {
    const seen = new Set();
    const out = [];
    const add = e => { if (e && e.slug && !seen.has(e.slug) && Choice.meaningOf(e)) { seen.add(e.slug); out.push(e); } };
    for (const s of queue) add(ctx.words.get(s));
    for (const e of ctx.words.favorites()) add(e);
    return out;
  }
  function renderWord(e, want, base) {
    const tries = want === 'cloze' ? ['cloze', 'tiles', 'mc4', 'card'] : want === 'tiles' ? ['tiles', 'mc4', 'card'] : want === 'listen' ? ['listen', 'mc4', 'card'] : ['mc4', 'card'];
    for (const m of tries) {
      let v = null;
      try {
        if (m === 'card') v = flashcard.render(e, { ...base, openFull: () => ctx.openSheet(e.slug, { back: '回到复习' }), isTall: () => false, busy: () => !!(session && session.busy) });
        else {
          const mode = m === 'mc4' ? Choice.choiceMode : m === 'listen' ? modeOf(mods.listen, 'listenMode') : m === 'cloze' ? modeOf(mods.cloze, 'clozeMode') : modeOf(mods.spell, 'spellMode');
          if (!mode) continue;
          v = mode.render(e, base);
        }
      } catch (err) { console.warn('review: ' + m + ' card:', (err && err.message) || err); v = null; }
      if (v && v.el && v.question !== null) return { v, mode: m === 'card' ? 'card' : eventModeOf(v, m) };
    }
    return null;
  }
  function startWords(c) {
    const queue = (c.items || []).filter(s => ctx.words.get(s));
    if (!queue.length) { finishCell(c); return; }
    const pool = poolOf(queue);
    const modes = c.modes || {};
    session = createSession({
      queue,
      mode: 'mc4',
      review: (slug, g, m) => ctx.words.review(slug, g, m),
      isToday: due => lastGrade === 1 && new Date(due) <= endOfDay(new Date()),
      isActive: slug => !skipped.has(slug) && !!ctx.words.get(slug),
    });
    const draw = () => {
      if (!running) return;
      const slug = session.current();
      if (!slug) { session = null; finishCell(c); return; }
      const e = ctx.words.get(slug);
      // wrong once today: back as four-choice (DESIGN 5.1 rule 4, as in the lesson)
      const want = tally.wrongWords.has(slug) ? 'mc4' : (modes[slug] || 'mc4');
      cur = { kind: 'word', slug, item: 'w:' + slug, mode: want, p: 0.5, t: Date.now(), answered: false };
      const base = { app: ctx, pool, say, position: { n: session.done + 1, total: session.total, isNew: !e.fsrs || e.fsrs.state === State.New },
        rate: g => rate(g, draw), onAnswer: ev => onWordAnswer(e, ev) };
      const r = renderWord(e, want, base);
      if (!r) { skipped.add(slug); draw(); return; }
      view = r.v;
      cur.mode = r.mode;
      cur.p = predictOf(e, cur.mode);
      log({ type: 'predict', step: 'review', item: cur.item, slug, mode: cur.mode, unit: unitOf(e), p_base: cur.p, p_teacher: cur.p });
      paint(c, tools(), view.el, [].concat(view.footer || []));
    };
    draw();
  }
  function predictOf(e, mode) {
    try { const p = ctx.events.predict(e, { mode }); if (Number.isFinite(p)) return round2(p); } catch (err) { /* fall back */ }
    try { return Choice.predictCorrect(e, new Date(), { mode }); } catch (err) { return 0.5; }
  }
  function onWordAnswer(e, ev) {
    log({ type: 'answer', step: 'review', unit: unitOf(e), ...ev });
    if (!cur || cur.slug !== ev.slug || cur.answered) return;
    cur.answered = true;
    firstAnswer(ev.slug, !!ev.correct && ev.first_try !== false, cur.mode);
  }
  function firstAnswer(slug, ok, mode) {
    if (firstSeen.has(slug)) return;
    firstSeen.add(slug);
    if (ok) { if (mode === 'tiles' || mode === 'cloze') tally.wrote++; else tally.known++; }
    else tally.wrongWords.add(slug);
    note({ kind: 'word', slug, correct: ok });
  }
  async function rate(g, draw) {
    const s = session;
    if (!s || s.busy || !cur || cur.kind !== 'word') return;
    const c = cur;
    if (!c.answered) {
      // the flashcard (or a mode that only rates): her rating is the answer
      c.answered = true;
      if (c.mode === 'card') log({ type: 'answer', step: 'review', item: c.item, slug: c.slug, mode: 'card', choice: String(g), correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
      firstAnswer(c.slug, g >= (c.mode === 'card' ? 2 : 3), c.mode);
    }
    lastGrade = g;
    let r = null;
    try { r = await s.rate(g, { modeId: c.mode }); } catch (err) { toast('这一下没记上，再点一次。'); return; }
    if (!r) return;
    ratedToday.add(c.slug);
    log({ type: 'review', step: 'review', slug: c.slug, rating: g, line: c.mode === 'tiles' || c.mode === 'cloze' ? 'write' : 'recognize', mode: c.mode });
    if (session === s) draw();
  }
  function tools() {
    return h('div', { className: 'lesson-tools' },
      h('button', { type: 'button', className: 'text-btn', text: '有点难', on: { click: ev => { if (!cur) return; log({ type: 'feel', step: 'review', item: cur.item, slug: cur.slug, mode: cur.mode }); ev.currentTarget.disabled = true; ev.currentTarget.textContent = '老师记下了'; } } }),
      h('button', { type: 'button', className: 'text-btn', text: '这题有问题', on: { click: () => {
        if (!cur || !cur.slug) return;
        log({ type: 'flag', step: 'review', item: cur.item, slug: cur.slug, mode: cur.mode });
        toast('老师记下了，这题先跳过。');
        skipped.add(cur.slug);
        if (session && cellAt >= 0) { cur = null; const c = day.cells[cellAt]; if (c.id === 'words') { session = null; startWords({ ...c, items: c.items.filter(s => !skipped.has(s) && !firstSeen.has(s)) }); } }
      } } }));
  }

  // ---- 语法: grammar.js WarmItems through ui-grammar renderGrammarItem, then the 对比小卡

  // ctx for the modules: their events pass by here, so each question gets a 'predict' before its first answer and the review id
  function watchCtx() {
    const announced = new Set();
    const base = ctx.events;
    const events = Object.assign(Object.create(base), {
      log(ev) {
        try {
          if (ev && ev.type === 'answer' && ev.item && !announced.has(ev.item)) {
            announced.add(ev.item);
            const p = /^gc:/.test(String(ev.item)) ? 0.75 : 0.63;
            base.log({ type: 'predict', sid, step: 'review', review: plan.id, item: ev.item, mode: ev.mode, p_base: p, p_teacher: p });
          }
        } catch (err) { /* bookkeeping only */ }
        return base.log({ review: plan && plan.id, ...ev });
      },
      sessionId: () => sid,
    });
    return Object.assign(Object.create(ctx), { events, sid });
  }
  function gramResults(items, res) {
    for (const r of (res && res.results) || []) {
      const it = items.find(x => x.item === r.item) || {};
      tally.gtotal++;
      if (r.clean) tally.gright++; else tally.wrongItems.add(r.item);
      note({ kind: 'grammar', item: r.item, card: it.card || '', family: it.family || '', correct: !!r.clean });
    }
  }
  function startGrammar(c, done, { items = c.items || [], contrast = c.contrast || null, title = c.label } = {}) {
    const draw = fnOf(mods.grammarUI, 'renderGrammarItem');
    const drawC = fnOf(mods.grammarUI, 'renderContrast');
    const thenContrast = () => {
      if (!contrast || !drawC) { done(); return; }
      const box = h('article', { className: 'lesson-gq-box lesson-contrast-box' });
      paint(c, box);
      try {
        const v = drawC(box, watchCtx(), { item: contrast, sid, step: 'review', doneLabel: '接着复习', why: contrast.why,
          onDone: res => { for (const r of (res && res.results) || []) { tally.gtotal++; if (r.correct) tally.gright++; } done(); } });
        view = v || null;
        if (!v) done();
      } catch (err) { console.warn('review: contrast:', (err && err.message) || err); done(); }
    };
    if (!items.length || !draw) { thenContrast(); return; }
    const box = h('article', { className: 'lesson-gq-box' });
    paint(c, box);
    try {
      const v = draw(box, watchCtx(), { items, sid, step: 'review', onDone: res => { gramResults(items, res); thenContrast(); } });
      view = v || null;
      if (!v) thenContrast();
    } catch (err) { console.warn('review: grammar:', (err && err.message) || err); thenContrast(); }
  }

  // ---- 阅读: renderPassage (a 期中阅读小篇, or an episode with the names she picked); not written into the story's progress

  function episodeOf(p) {
    if (!p) return null;
    if (p.source === 'exam') return (data.passages || []).find(x => x && x.id === p.id) || null;
    let c = null;
    try { c = R.contentWith(ctx.kv.peek('story:names', null)) || data.stories || R.content(); } catch (e) { c = data.stories || R.content(); }
    if (!c) return null;
    return (typeof c.episode === 'function' ? c.episode(p.id) : null) || (c.episodes || []).find(e => e.id === p.id) || null;
  }
  async function markExam(id) {
    try {
      const rec = (await ctx.kv.get('exam.reading', null)) || {};
      await ctx.kv.set('exam.reading', { v: 1, done: { ...((rec && typeof rec.done === 'object' && rec.done) || {}), [id]: V.dayOf(new Date()) }, updated: new Date().toISOString() });
    } catch (err) { /* the review goes on */ }
  }
  function startRead(c, p, done) {
    const fn = fnOf(mods.reader, 'renderPassage');
    const ep = episodeOf(p);
    if (!fn || !ep) { done(); return; }
    const box = h('div', { className: 'lesson-module lesson-module-read' });
    paint(c, p.hits && p.hits.length && p.mode === 'read' ? h('p', { className: 'small rvq-hits', text: '这篇里有这几个单元的词：' + p.hits.slice(0, 8).join('、') }) : null, box);
    let finished = false;
    const end = res => {
      if (finished) return;
      finished = true;
      view = null;
      if (res && res.done) { tally.read = true; if (p.source === 'exam') markExam(p.id); }
      for (const r of (res && res.results) || []) { tally.gtotal++; if (r.clean) tally.gright++; }
      done();
    };
    try {
      const v = fn(box, watchCtx(), { passage: ep, mode: p.mode === 'questions' ? 'questions' : 'read', label: p.label, sid, step: 'review', doneLabel: '接着复习', onDone: end });
      view = v && typeof v.onKey === 'function' ? v : null;
    } catch (err) { console.warn('review: reading:', (err && err.message) || err); end(null); }
  }

  // ---- 小测: spelling (no FSRS rating here, as 写几个词), then the grammar, then one reading with the questions only

  function startQuiz(c) {
    const spell = modeOf(mods.spell, 'spellMode');
    const queue = spell ? (c.spell || []).filter(s => ctx.words.get(s)) : [];
    const total = queue.length;
    let done = 0;
    const retried = new Set();
    const pool = poolOf(queue);
    const afterSpell = () => startGrammar(c, () => (c.passage ? startRead(c, c.passage, () => finishCell(c)) : finishCell(c)), { items: c.grammar || [], contrast: null });
    const draw = () => {
      if (!running) return;
      const slug = queue[0];
      if (!slug) { afterSpell(); return; }
      const e = ctx.words.get(slug);
      cur = { kind: 'quiz', slug, item: 'w:' + slug, mode: 'tiles', t: Date.now(), answered: false };
      let v = null;
      try {
        v = spell.render(e, { app: ctx, pool, say, line: 'write', position: { n: done + 1, total: Math.max(total, done + queue.length), isNew: false },
          rate: g => quizRate(g), onAnswer: ev => { log({ type: 'answer', step: 'review', unit: unitOf(e), quiz: true, ...ev }); } });
      } catch (err) { v = null; }
      // a phrase or a word it cannot tile: the quiz is for spelling, so pass it
      if (!v || !v.el || v.question === null || eventModeOf(v, 'tiles') !== 'tiles') { queue.shift(); draw(); return; }
      view = v;
      const p = predictOf(e, 'tiles');
      log({ type: 'predict', step: 'review', item: cur.item, slug, mode: 'tiles', unit: unitOf(e), p_base: p, p_teacher: p, quiz: true });
      paint(c, h('p', { className: 'small rvq-quiz-note', text: '小测：拼出来。写错的也没关系，后面会再练。' }), view.el, [].concat(view.footer || []));
    };
    const quizRate = async g => {
      if (!cur || cur.kind !== 'quiz') return;
      const slug = cur.slug;
      if (!cur.answered) {
        cur.answered = true;
        const ok = g >= 3;
        if (ok) tally.wrote++;
        else {
          tally.wrongWords.add(slug);
          // 写错的进复习：开“写得出”线，今天还没评过的词评一次“忘了”
          try { if (ctx.words.patch) await ctx.words.patch(slug, { write: true, write_at: isoLocal(new Date()), write_from: 'review' }); } catch (err) { /* still go on */ }
          const e = ctx.words.get(slug);
          const last = e && e.fsrs && e.fsrs.last_review ? String(e.fsrs.last_review).slice(0, 10) : '';
          if (!ratedToday.has(slug) && last !== V.dayOf(new Date())) {
            try { await ctx.words.review(slug, 1, 'spell'); ratedToday.add(slug); log({ type: 'review', step: 'review', slug, rating: 1, line: 'write', mode: 'tiles', quiz: true }); } catch (err) { /* recorded as a miss anyway */ }
          }
        }
        if (!firstSeen.has('q:' + slug)) { firstSeen.add('q:' + slug); note({ kind: 'word', slug, correct: ok }); }
      }
      queue.shift();
      done++;
      if (g === 1 && !retried.has(slug)) { retried.add(slug); queue.splice(Math.min(2, queue.length), 0, slug); }
      draw();
    };
    draw();
  }

  // ---------------------------------------------------------------- the end

  function wrap() {
    const min = Math.round((Date.now() - t0) / 60000);
    const completed = V.dayDone(plan, dayIdx);
    log({ type: 'session_end', kind: 'review', min, steps_done: Object.keys(((plan.done || {})[String(dayIdx)] || {}).cells || {}), completed });
    settle(min);
    hold(false);
    cur = null;
    view = null;
    const words = tally.wrongWords.size, items = tally.wrongItems.size;
    const next = plan.days[dayIdx + 1];
    const right = [tally.known ? `认对了 ${tally.known} 个词` : '', tally.wrote ? `写对了 ${tally.wrote} 个` : '', tally.gright ? `题做对了 ${tally.gright} 道` : ''].filter(Boolean).join('，');
    const wrongLine = words || items
      ? `错了的${words ? ` ${words} 个词` : ''}${words && items ? '和' : ''}${items ? ` ${items} 道题` : ''}，${next ? (next.day === V.addDays(V.dayOf(new Date()), 1) ? '明天' : '下次') + '先练它们' : '考前再看一眼'}。`
      : '今天的都做对了。';
    const last = !next && plan.date && V.gapDays(V.dayOf(new Date()), plan.date) === 1 ? '明天考试，早点睡。' : !next && plan.kind === 'today' ? '去考吧，你准备过了。' : next ? `下一份在${whenLabel(next.day, new Date())}，大约 ${Math.max(1, next.minutes)} 分钟。` : '';
    stage.replaceChildren(
      header(day.title),
      strip(''),
      h('section', { className: 'lesson-wrap rvq-wrap' },
        h('p', { className: 'lede', text: completed ? '今天的复习做完了。' : '今天先到这儿。' }),
        right ? h('p', { className: 'rvq-tally', text: right + '。' }) : null,
        h('p', { className: 'rvq-tally', text: wrongLine }),
        last ? h('p', { className: 'small', text: last }) : null,
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => ctx.go('home') } }))));
  }
  function settle(min) {
    const id = sid;
    import('./weekly.js').then(W => W.settleLesson && W.settleLesson(ctx, { sid: id, end: { min, sid: id, at: isoLocal(new Date()), kind: 'review' } }))
      .catch(err => console.warn('review: settle:', (err && err.message) || err));
  }
  function quit() {
    if (running) {
      if (session) { try { session.end(); } catch (e) { /* ignore */ } session = null; }
      if (view && typeof view.stop === 'function') { try { view.stop(); } catch (e) { /* ignore */ } }
      log({ type: 'exit', step: 'review', after_item: cur ? cur.item : '', wrong_streak: 0 });
      wrap();
      return;
    }
    ctx.go('home');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', ev => {
      if (!running || !view || typeof view.onKey !== 'function') return;
      try { if (ctx.currentRoute && ctx.currentRoute() !== 'revise') return; } catch (e) { /* no router */ }
      if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      view.onKey(ev);
    });
  }

  return {
    el: stage,
    show(params = {}) {
      if (running) return;   // coming back to the page mid-review keeps it where it was
      if (params && params.start) {
        const p = V.activePlan(ctx.kv, now());
        const i = p ? V.todayIndex(p, now()) : -1;
        if (p && i >= 0) { begin(p, i); return; }
      }
      entry(params || {});
    },
    inSession: () => running,
    holding: () => false,
    hide() { if (view && typeof view.stop === 'function') { try { view.stop(); } catch (e) { /* ignore */ } } },
    onChange() {},
  };
}
