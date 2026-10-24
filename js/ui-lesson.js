// 上课（DESIGN 2.0-2.3）：按 plan 的四格走，热身 → 读一段 → 写几个词 → 收尾。v0 只有热身和收尾；
// “读一段”“写几个词”在顶上的四格条里显示“下周开播”，一行，不占时间。
// 热身：按 plan 给的卡片顺序（第一张是最有把握的），四选一（modes/choice.js）；凑不齐 3 个干扰项的词
// （choiceMode 返回 question: null）退回词典原来的闪卡（ui-review.js）。
// 每张出题前算一次“做对的把握”记 events 'predict'（teacher-memory 10），作答记 'answer'（用时、选了什么、是不是第一次），
// 评分后记 'review'；“有点难”记 'feel'，“这题有问题”记 'flag' 并跳过、不记分。超过 25 分钟提示“今天够了”。
// 收尾：老师夸一句（lines 'praise'，填今天答对的一个词）、“今天认出了 N 个”、第一周每天一个按钮问题、说再见。
// 负责：今天标签 UI agent（ui-home.js、ui-lesson.js、ui-dictation.js、css/lesson.css）。
//
// 导出
//   createLessonView(ctx) -> { show(params), inSession(), onChange() }
//     渲染进 #tab-lesson。params：{ light: bool, standard?: bool（回归日她点了“标准版”）, again?: bool（今天做完了再练一会儿） }。
//     全屏，左上角“结束”回到今天。
//   ENOUGH_MIN = 25                         单次超过这么多分钟提示“今天够了”（DESIGN 2.3）
//   ASK_KEY = 'ask.answers'                 kv：第一周按钮问题的回答 { qid: { answer, skipped, at, day, who } }
//   predictCorrect(entry, now, { mode }) -> 0..1   她第一次就答对的把握（v0：FSRS 记得的概率，四选一按 1/4 蒙对抬一点；
//                                            新词 0.5）。choice.js 以后导出同名函数就用它的
//   praiseWord(results) -> slug | null      收尾夸哪个词：第一次就答对的词里把握最小的那个
//
// 记的事件（CONTRACTS.md 第 6 节）：session_start { kind, hour }、predict { item, slug, mode, p_base, p_teacher }、
// answer（choice.js 给的字段加 sid、step、unit）、review { slug, rating, line: 'recognize', p_fsrs, mode }、feel、flag、
// exit { step, after_item, wrong_streak }、session_end { min, steps_done, completed }、ask { qid, who: 'emma', answer }。
// 写 kv 'day:<YYYY-MM-DD>' { cells, minutes, light }。
import { h, icon, toast } from './ui-dom.js';
import { createSession } from './session.js';
import { endOfDay, retrievability, State } from './fsrs.js';
import * as Choice from './modes/choice.js';
import { flashcard } from './ui-review.js';
import { dayOf, CELL_LABELS as PLAN_LABELS } from './plan.js';
import { lessonDays, dayNumber, dictationToday } from './ui-home.js';

export const ENOUGH_MIN = 25;
export const ASK_KEY = 'ask.answers';
const CELL_IDS = ['warmup', 'read', 'write', 'wrap'];
const LABELS = { warmup: '热身', read: '读一段', write: '写几个词', wrap: '收尾', ...(PLAN_LABELS || {}) };
const round2 = x => Math.round(x * 100) / 100;

export function predictCorrect(entry, now = new Date(), { mode = 'mc4' } = {}) {
  const guess = mode === 'mc4' ? 0.25 : 0;
  const card = entry && entry.fsrs;
  const r = !card || card.state === State.New || !card.last_review ? 0.5 : retrievability(card, now);
  return round2(guess + (1 - guess) * Math.max(0, Math.min(1, r)));
}

// results: Map slug -> { first: bool (first answer right), p }
export function praiseWord(results) {
  let best = null;
  for (const [slug, r] of results) if (r.first && (!best || r.p < best.p)) best = { slug, p: r.p };
  return best ? best.slug : null;
}

export function createLessonView(ctx) {
  const root = document.getElementById('tab-lesson');
  root.replaceChildren();
  const stage = h('div', { className: 'lesson' });
  root.append(stage);
  const predict = (e, now, o) => (typeof Choice.predictCorrect === 'function' ? Choice.predictCorrect(e, now, o) : predictCorrect(e, now, o));

  let session = null;     // createSession(...) while the warm-up runs
  let sid = '';
  let plan = null;
  let light = false;
  let kind = 'standard';
  let t0 = 0;
  let lastGrade = 0;
  let cur = null;         // { slug, mode, p, pf, t }
  let view = null;        // the mode's { el, footer, onKey }
  let pool = [];
  let results = new Map();   // slug -> { first, p }
  let wrongStreak = 0;
  let skipped = new Set();
  let stepsDone = [];
  let enoughOff = false;
  let enoughTimer = 0;
  let noteSlot = null;
  let hiddenAt = 0;
  let wrapped = false;

  const minutesIn = () => Math.round((Date.now() - t0) / 60000);
  const name = () => ((ctx.kv.peek('profile', {}) || {}).name || 'Emma');
  const unitOf = e => { try { return (e && (e.unit || ctx.curriculum.unitOf(e.headword))) || undefined; } catch (err) { return undefined; } };
  const log = ev => { try { ctx.events.log({ sid, ...ev }); } catch (err) { /* recording never blocks an answer */ } };

  function header(title) {
    return h('header', { className: 'runhead session' },
      h('button', { type: 'button', className: 'text-btn', text: wrapped ? '回到今天' : '结束', on: { click: quit } }),
      h('span', { className: 'runhead-title', text: title }),
      h('span', { className: 'lesson-kind', text: light ? '轻松版' : '' }));
  }

  // the four cells, always the same (DESIGN 2.0); not-yet-open ones say 下周开播 and take no time
  function cellStrip(now) {
    const cells = (plan && plan.cells) || CELL_IDS.map(id => ({ id, status: id === 'read' || id === 'write' ? 'soon' : 'ready' }));
    return h('ol', { className: 'lesson-cells', 'aria-label': '今天的四格' }, CELL_IDS.map(id => {
      const c = cells.find(x => x.id === id) || { id, status: 'skip' };
      const done = stepsDone.includes(id) && id !== now;
      const st = id === now ? 'now' : done ? 'done' : c.status;
      const note = st === 'now' ? '正在做' : st === 'done' ? '做完了' : st === 'soon' ? (c.note || '下周开播') : st === 'skip' ? (c.note || '') : '';
      return h('li', { className: 'lesson-cell ' + st, 'aria-current': st === 'now' ? 'step' : null },
        h('b', { text: c.label || LABELS[id] }), h('span', { className: 'st' }, st === 'done' ? icon('check') : null, note));
    }));
  }

  // ---------------------------------------------------------------- start

  function start({ light: l = false, standard = false, again = false, first = false } = {}) {
    clearTimeout(enoughTimer);
    const extra = { light: !!l, lessonDays: lessonDays(ctx.kv) };
    // straight from the first open (ui-onboard): the first lesson, whatever kv 'day:' says
    if (first) extra.firstLesson = true;
    if (dictationToday(ctx.kv)) extra.dictationTonight = true;
    if (standard) extra.standard = true;
    if (again) extra.doneToday = {};
    plan = ctx.todayPlan(extra);
    light = !!(plan.light || l);
    const now = new Date();
    kind = plan.kind || (light ? 'easy' : (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'standard');
    sid = ctx.events.sessionId();
    t0 = Date.now();
    results = new Map();
    wrongStreak = 0;
    skipped = new Set();
    stepsDone = [];
    enoughOff = false;
    wrapped = false;
    log({ type: 'session_start', kind, hour: now.getHours(), light, again: again || undefined });
    const warm = plan.cells.find(c => c.id === 'warmup');
    const queue = warm && warm.status === 'ready' ? (warm.items || []).filter(s => ctx.words.get(s)) : [];
    if (!queue.length) { wrap(); return; }
    pool = buildPool(queue);
    session = createSession({
      queue,
      mode: 'mc4',
      review: (slug, g, m) => ctx.words.review(slug, g, m),
      // DESIGN 5.1: right once in this lesson is enough; a wrong one comes back about 4 cards later (session.js)
      isToday: due => lastGrade === 1 && new Date(due) <= endOfDay(new Date()),
      isActive: slug => { if (skipped.has(slug)) return false; const e = ctx.words.get(slug); return !!(e && e.favorited); },
    });
    ctx.busy(+1);
    enoughTimer = setTimeout(showEnough, ENOUGH_MIN * 60000 + 500);
    draw();
  }

  // distractors: this lesson's words first, then the word book; choice.js tops up from the unit and the word lists
  function buildPool(queue) {
    const seen = new Set();
    const out = [];
    const add = e => { if (e && e.slug && !seen.has(e.slug) && Choice.meaningOf(e)) { seen.add(e.slug); out.push(e); } };
    for (const s of queue) add(ctx.words.get(s));
    for (const e of ctx.words.favorites()) add(e);
    return out;
  }

  // ---------------------------------------------------------------- warm-up

  function draw() {
    const s = session;
    const slug = s && s.current();
    if (!slug) { endWarmup(); return; }
    const e = ctx.words.get(slug);
    const now = new Date();
    const pf = e.fsrs && e.fsrs.state !== State.New ? round2(retrievability(e.fsrs, now)) : null;
    cur = { slug, mode: 'mc4', p: 0.5, pf, t: Date.now(), answered: false };
    const position = { n: s.done + 1, total: s.total, isNew: !e.fsrs || e.fsrs.state === State.New };
    const say = (text, btn) => ctx.say(text, btn);
    view = Choice.choiceMode.render(e, { app: ctx, pool, say, position, rate: g => rate(g), onAnswer: ev => onAnswer(e, ev) });
    if (view && view.question === null) {
      // no three distractors for this word yet: the dictionary's flashcard instead
      cur.mode = 'card';
      view = flashcard.render(e, {
        app: ctx, say, position, rate: g => rate(g),
        openFull: () => ctx.openSheet(slug, { back: '回到上课' }),
        isTall: () => document.documentElement.scrollHeight > window.innerHeight + 4,
        busy: () => !!(session && session.busy),
      });
    }
    // the teacher's bet before she answers (teacher-memory 10.1); v0 has no notebook yet, so p_teacher = p_base
    cur.p = predict(e, now, { mode: cur.mode });
    log({ type: 'predict', step: 'warmup', item: 'w:' + slug, slug, mode: cur.mode, unit: unitOf(e), p_base: cur.p, p_teacher: cur.p });
    noteSlot = h('div', { className: 'lesson-note-slot' });
    const tools = h('div', { className: 'lesson-tools' },
      h('button', { type: 'button', className: 'text-btn', text: '有点难', on: { click: ev => feel(ev.currentTarget) } }),
      h('button', { type: 'button', className: 'text-btn', text: '这题有问题', on: { click: flag } }));
    stage.replaceChildren(header(LABELS.warmup), cellStrip('warmup'), noteSlot, tools, view.el, ...[].concat(view.footer || []).filter(Boolean));
    if (minutesIn() >= ENOUGH_MIN) showEnough();
  }

  function onAnswer(e, ev) {
    log({ type: 'answer', step: 'warmup', unit: unitOf(e), ...ev });
    if (!cur || cur.slug !== ev.slug) return;
    if (!cur.answered) {
      cur.answered = true;
      wrongStreak = ev.correct ? 0 : wrongStreak + 1;
      if (!results.has(ev.slug)) results.set(ev.slug, { first: !!ev.correct, p: cur.p });
    }
  }

  async function rate(g) {
    const s = session;
    if (!s || s.busy || !cur) return;
    const c = cur;
    if (c.mode === 'card' && !c.answered) {
      // the flashcard has no options: her own rating is the answer (模糊 and up count as remembered)
      const e = ctx.words.get(c.slug);
      c.answered = true;
      log({ type: 'answer', step: 'warmup', item: 'w:' + c.slug, slug: c.slug, unit: unitOf(e), mode: 'card', choice: String(g),
        correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
      wrongStreak = g >= 2 ? 0 : wrongStreak + 1;
      if (!results.has(c.slug)) results.set(c.slug, { first: g >= 2, p: c.p });
    }
    lastGrade = g;
    let r = null;
    try { r = await s.rate(g, { modeId: c.mode }); } catch (err) { toast('这一下没记上，再点一次。'); return; }
    if (!r) return;
    log({ type: 'review', step: 'warmup', slug: c.slug, rating: g, line: 'recognize', p_fsrs: c.pf, mode: c.mode });
    if (session !== s) return;
    if (r.finished) endWarmup(); else draw();
  }

  function feel(btn) {
    if (!cur) return;
    log({ type: 'feel', step: 'warmup', item: 'w:' + cur.slug, slug: cur.slug, mode: cur.mode });
    btn.disabled = true;
    btn.textContent = '老师记下了';
  }

  function flag() {
    if (!cur || !session || session.busy) return;
    log({ type: 'flag', step: 'warmup', item: 'w:' + cur.slug, slug: cur.slug, mode: cur.mode });
    skipped.add(cur.slug);   // skipped, not graded (DESIGN 8.3); isActive drops it from the queue
    toast('这题先跳过，老师记下了。', 1600);
    draw();
  }

  function showEnough() {
    if (enoughOff || !session || !noteSlot || ctx.currentRoute() !== 'lesson') return;
    noteSlot.replaceChildren(h('div', { className: 'lesson-note', role: 'status' },
      h('p', { text: '今天够了。剩下的明天接着来。' }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '去收尾', on: { click: endWarmup } }),
        h('button', { type: 'button', className: 'text-btn', text: '再做几张', on: { click: () => { enoughOff = true; noteSlot.replaceChildren(); } } }))));
  }

  function endWarmup() {
    if (session) { session.end(); session = null; ctx.busy(-1); }
    clearTimeout(enoughTimer);
    if (results.size && !stepsDone.includes('warmup')) stepsDone.push('warmup');
    wrap();
  }

  // ---------------------------------------------------------------- wrap

  async function markDay(cells) {
    const key = 'day:' + dayOf(new Date());
    try {
      const rec = (await ctx.kv.get(key, {})) || {};
      rec.cells = { ...(rec.cells || {}), ...Object.fromEntries(cells.map(c => [c, true])) };
      rec.minutes = (rec.minutes || 0) + minutesIn();
      if (light) rec.light = true;
      rec.updated = new Date().toISOString();
      await ctx.kv.set(key, rec);
    } catch (err) { console.warn('lesson: day record:', (err && err.message) || err); }
  }

  function lineBlock(l, cls = 'lesson-line') {
    if (!l) return null;
    ctx.lines.markSeen(l.id);
    const zh = l.zh ? h('p', { className: 'lesson-zh', lang: 'zh-CN', text: l.zh, hidden: !l.showZh }) : null;
    const more = l.showZh || !l.zh ? null : h('button', { type: 'button', className: 'text-btn lesson-zh-btn', text: '看中文',
      on: { click: ev => { zh.hidden = false; ev.currentTarget.remove(); (ctx.lines.tapZh || ctx.lines.markZhTapped || (() => {}))(l.id); } } });
    return h('div', { className: cls },
      h('p', { className: 'lesson-en', lang: 'en' }, l.en,
        h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say(l.en, ev.currentTarget) } }, icon('speak'))),
      zh, more);
  }

  // first week: one button question a day at the wrap (teacher-memory 7.2); skipping is fine
  function askBlock(dayN) {
    const answers = ctx.kv.peek(ASK_KEY, {}) || {};
    const today = dayOf(new Date());
    if (Object.values(answers).some(a => a && a.day === today)) return null;
    const q = dayN <= 5 && ctx.lines.questionsForDay ? ctx.lines.questionsForDay(dayN) : null;
    if (!q || answers[q.id] || !Array.isArray(q.options) || !q.options.length) return null;
    const box = h('section', { className: 'lesson-ask', 'aria-label': '老师问你' });
    const showZh = ctx.lines.shouldShowZh ? ctx.lines.shouldShowZh(q.id) : true;
    async function answer(opt) {
      const rec = (await ctx.kv.get(ASK_KEY, {})) || {};
      rec[q.id] = { answer: opt ? opt.id : null, skipped: !opt, at: new Date().toISOString(), day: today, n: dayN, who: 'emma' };
      ctx.kv.set(ASK_KEY, rec).catch(err => console.warn('lesson: ask:', (err && err.message) || err));
      // lines.answerEvent adds the option's about tag (teacher-memory 7.2)
      const ev = ctx.lines.answerEvent ? ctx.lines.answerEvent(q, opt ? opt.id : 'skip', { step: 'wrap' })
        : { type: 'ask', step: 'wrap', qid: q.id, who: 'emma', answer: opt ? opt.id : null };
      log({ ...ev, skipped: !opt || undefined });
      box.replaceChildren(h('p', { className: 'lesson-asked', text: opt ? '老师记下了。' : '好，下次再说。' }));
    }
    box.append(
      lineBlock({ id: q.id, en: q.en, zh: q.zh, showZh }, 'lesson-line lesson-q'),
      h('div', { className: 'lesson-opts', role: 'group', 'aria-label': '选一个' }, q.options.map(o =>
        h('button', { type: 'button', className: 'lesson-opt', on: { click: () => answer(o) } },
          h('b', { lang: 'en', text: o.en || o.zh || o.id }), o.en && o.zh ? h('span', { lang: 'zh-CN', text: o.zh }) : null))),
      h('button', { type: 'button', className: 'text-btn lesson-skip', text: (q.skip && q.skip.zh) || '跳过', on: { click: () => answer(null) } }));
    return box;
  }

  function wrap() {
    session = null;
    wrapped = true;
    clearTimeout(enoughTimer);
    stepsDone = [...new Set([...stepsDone, 'wrap'])];
    const now = new Date();
    // which day of using it: counted before today's record lands
    const dayN = dayNumber(lessonDays(ctx.kv), now);
    markDay(stepsDone).then(() => { /* 今天 redraws from kv when she goes back */ });
    log({ type: 'session_end', step: 'wrap', kind, min: minutesIn(), steps_done: stepsDone, completed: true });
    const rightSlugs = [...results].filter(([, r]) => r.first).map(([s]) => s);
    const hw = s => ((ctx.words.get(s) || {}).headword || s);
    const pw = praiseWord(results);
    const praise = pw ? ctx.lines.pick('praise', { name: name(), word: hw(pw), day: dayN }) : null;
    const close = ctx.lines.pick('close', { name: name(), day: dayN, hour: now.getHours() });
    const n = rightSlugs.length;
    const few = rightSlugs.slice().sort((a, b) => (results.get(a).p - results.get(b).p)).slice(0, 3).map(hw);
    stage.replaceChildren(header(LABELS.wrap), cellStrip('wrap'),
      h('section', { className: 'lesson-wrap' },
        lineBlock(praise),
        h('div', { className: 'lesson-tally' },
          n ? h('p', { className: 'lede' }, '今天认出了 ', h('span', { className: 'n', text: String(n) }), ' 个')
            : h('p', { className: 'lede', text: results.size ? `今天练了 ${results.size} 个词` : '今天的课上完了' }),
          few.length ? h('p', { className: 'lesson-words', lang: 'en', text: few.join('  ·  ') }) : null,
          n && results.size > n ? h('p', { className: 'small', text: '没认出的几个，明天热身再见。' })
            : plan && plan.first && n ? h('p', { className: 'small', text: '明天接着来。' }) : null),
        askBlock(dayN),
        lineBlock(close, 'lesson-line lesson-bye'),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '回到今天', on: { click: () => ctx.go('home') } }))));
  }

  // ---------------------------------------------------------------- leaving

  function quit() {
    if (session) {
      log({ type: 'exit', step: 'warmup', after_item: session.done, wrong_streak: wrongStreak });
      log({ type: 'session_end', kind, min: minutesIn(), steps_done: stepsDone, completed: false });
      session.end();
      session = null;
      ctx.busy(-1);
      clearTimeout(enoughTimer);
      if (results.size) markDay([]);
    }
    ctx.go('home');
  }

  // away from the app 60 seconds or more counts as leaving (teacher-memory 2.1); the lesson stays where it was
  document.addEventListener('visibilitychange', () => {
    if (!session) return;
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= 60000) log({ type: 'exit', step: 'warmup', after_item: session.done, wrong_streak: wrongStreak, away_s: Math.round((Date.now() - hiddenAt) / 1000) });
    hiddenAt = 0;
  });
  // keyboard for desktop testing (1-4 picks an option or rates a flashcard)
  document.addEventListener('keydown', ev => {
    if (!session || !view || !view.onKey || ctx.currentRoute() !== 'lesson') return;
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    view.onKey(ev);
  });

  return {
    show(params = {}) {
      if (session) { session.end(); session = null; ctx.busy(-1); }
      start(params);
    },
    inSession: () => !!session,
    onChange() {},
  };
}
