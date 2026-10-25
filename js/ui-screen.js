// 热身里的地基小题和“认几个小学的老朋友”（screen.js 的界面）。逻辑都在 screen.js；地基小题的选项、提示阶梯沿用 grammar.js 的
// createAttempt 和 css/grammar.css 的 gram- 样式，看起来和语法卡的热身题一样。摸底的卡片样式在 css/screen.css（类名 scr-）。
// 负责：地基探针和 505 摸底 agent。
//
// 导出
//   renderProbe(container, ctx, { items | item, sid?, step = 'warmup', onDone, autoNextMs = 1400 }) -> Controller
//     items 是 screen.probeItems 给的 ProbeItem（或题目 id）。一道一道做：答错自动出下一级提示，可以点“再给个提示”；
//     第 4 级给答案和为什么（没有变式题：探针只看第一次答得怎么样，补的事交给语法卡）。每题做完写 kv 'probe:state'。
//     第一次就答对的停 autoNextMs 毫秒自动往下（0 = 等她点）。“这题有问题”：跳过，不算进状态，以后不再出。
//     做完调用 onDone({ results: [{ item, id, block, clean, passed, grade }], stats: { right, fuzzy, failed, flagged }, weak })
//     weak 是做完以后“不会”的那几块（weakFoundations 的 blocks）。
//   renderScreen(container, ctx, { items, sid?, step = 'warmup', onDone, autoNextMs = 700 }) -> Controller
//     items 是 screen.screenItems 给的 ScreenItem。一个词一屏：大字的词、三个按钮“认识 / 不确定 / 没学过”。
//     认识：多数直接下一个；要核对的出四选一（选中文，另有“想不起来了”）。不确定、没学过：给出中文，点“下一个”。
//     假词：点了认识，告诉她这是老师编的词、拿不准就点“不确定”；没点认识，说她说得对。
//     做完把不会的词放进单词本（addToBook），再调用 onDone({ results: [{ id, w, choice, check?, fake? }], added: [slug] })。
//   addToBook(ctx, words, now?) -> Promise<[slug]>   screen.pendingWords 给的词进单词本：没有词条的走 words.importData
//     （screen.placeholderExport，中文是 probes.json 里写好的，needs_core 等第一次打开时补讲解），有词条没收藏的 toggleFav。
//   Controller = { el, onKey(ev), stop() }   onKey：地基小题 1-4 / A-D 选，Enter 下一题；摸底 1 认识 2 不确定 3 没学过，
//     核对时 1-4 选，Enter 下一个
//
//   ctx 用到：kv（读写 'probe:state'、'screen:505'）、events.log、events.sessionId（没给 sid 时）、say（可以没有）、
//   words（get、importData）、toggleFav、toast（可以没有）、fetchJSON（第一次读 probes.json）。
//   事件见 screen.js 顶部。
import { h, icon } from './ui-dom.js';
import * as S from './screen.js';
import * as G from './grammar.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function ensureContent(ctx) {
  const c = S.content();
  if (c) return Promise.resolve(c);
  return S.loadScreen({ fetchJSON: ctx && ctx.fetchJSON });
}
function sidOf(ctx, sid) {
  if (sid) return sid;
  if (ctx && ctx.sid) return ctx.sid;
  try { return ctx && ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''; } catch (e) { return ''; }
}
function logger(ctx) {
  return ev => {
    try { return ctx && ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log(ev) : null; } catch (e) { return null; }
  };
}
function saver(ctx, key) {
  return value => {
    try { return ctx && ctx.kv && typeof ctx.kv.set === 'function' ? ctx.kv.set(key, value) : null; } catch (e) { return null; }
  };
}
function sayBtn(ctx, text) {
  if (!ctx || typeof ctx.say !== 'function' || !text) return null;
  return h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => { ev.stopPropagation(); ctx.say(text, ev.currentTarget); } } }, icon('speak'));
}
// show a waiting line until probes.json is there, then draw; a failed load ends the module quietly
function whenReady(ctx, container, el, draw, finish) {
  if (S.content()) { draw(); return; }
  el.replaceChildren(h('p', { className: 'small scr-wait' }, '稍等一下……'));
  ensureContent(ctx).then(() => draw()).catch(err => { console.warn('screen: content:', (err && err.message) || err); finish(); });
}

// ---------------------------------------------------------------- 地基小题

export function renderProbe(container, ctx, { items = null, item = null, sid = '', step = 'warmup', onDone = () => {}, autoNextMs = 1400 } = {}) {
  const el = h('div', { className: 'gram gram-q scr-probe' });
  container.replaceChildren(el);
  const log = logger(ctx);
  const save = saver(ctx, S.PROBE_KEY);
  const theSid = sidOf(ctx, sid);
  const list = [].concat(items || item || []).map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  let index = 0, timer = 0, finished = false;
  let a = null, q = null, hintsShown = [];
  const results = [];
  const stats = { right: 0, fuzzy: 0, failed: 0, flagged: 0 };
  const state = () => S.readProbe(ctx && ctx.kv);

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    let weak = [];
    try { weak = S.weakFoundations(ctx && ctx.kv).blocks; } catch (e) { weak = []; }
    onDone({ results, stats, weak });
  }
  function start() {
    while (index < list.length && !S.probeQuestion(list[index])) index++;
    if (index >= list.length) { finish(); return; }
    q = S.probeQuestion(list[index]);
    a = G.createAttempt(q);
    hintsShown = [];
    draw();
  }
  const base = () => ({ sid: theSid, step, kind: 'probe', block: q.block });

  function stemLine() {
    if (q.kind === 'pick') return null;
    const [x, y] = q.stem.split(G.BLANK);
    return h('p', { className: 'gram-stem', lang: 'en' },
      x, y !== undefined ? h('span', { className: 'gram-blank', 'aria-label': '空' }, ' ') : null, y !== undefined ? y : null,
      q.cue ? h('span', { className: 'gram-cue', lang: /[a-z]/i.test(q.cue) ? 'en' : 'zh-CN' }, `（${q.cue}）`) : null);
  }
  function draw() {
    const top = h('div', { className: 'gram-top' },
      h('span', { className: 'gram-pos' }, '语法小题', h('span', { className: 'sub' }, ` · ${q.blockName}`)),
      a.done ? null : h('button', { type: 'button', className: 'text-btn gram-flag', on: { click: flag } }, '这题有问题'));
    const longOnes = a.options.some(o => o.text.length > 14);
    const opts = h('div', { className: 'gram-options' + (longOnes ? ' one-col' : '') }, a.options.map((o, i) => {
      const b = h('button', { type: 'button', className: 'gram-opt', lang: 'en', dataset: { i: String(i) }, on: { click: () => pick(i) } },
        h('span', { className: 'gram-letter', 'aria-hidden': 'true' }, LETTERS[i]), h('span', { className: 'gram-text' }, o.text));
      const picked = a.picked.has(i);
      if (picked && !o.correct) { b.classList.add('wrong'); b.disabled = true; }
      if (o.correct && (picked || (a.done && a.level >= G.HINT_MAX))) b.classList.add(picked ? 'right' : 'is-answer');
      if (a.done) b.disabled = true;
      return b;
    }));
    const hints = hintsShown.length ? h('ol', { className: 'gram-hints' }, hintsShown.map(x =>
      h('li', { className: 'gram-hint' + (x.level >= G.HINT_MAX ? ' full' : '') }, h('span', { className: 'gram-n' }, String(x.level)),
        h('span', { className: 'gram-hint-text' }, x.text)))) : null;
    const canHint = !a.done && a.level < G.HINT_MAX;
    const more = canHint ? h('button', { type: 'button', className: 'text-btn accent gram-more', on: { click: moreHint } }, a.level ? '再给个提示' : '给个提示') : null;
    let feedback = null, full = null, actions = null;
    if (a.done) {
      const r = a.result();
      const msg = r.clean ? '对了。' : r.passed ? '改对了。' : `答案是 ${q.answer}。`;
      feedback = h('p', { className: 'gram-feedback' + (r.passed ? ' ok' : '') }, msg);
      const sent = G.sentenceOf(q);
      full = h('div', { className: 'gram-full' },
        h('p', { className: 'gram-en', lang: 'en' }, sent, sayBtn(ctx, sent)),
        q.zh ? h('p', { className: 'gram-zh' }, q.zh) : null);
      actions = h('div', { className: 'gram-actions' }, h('button', { type: 'button', className: 'btn gram-next', on: { click: next } },
        index + 1 < list.length ? '下一题' : '接着来'));
    }
    const ask = h('p', { className: q.kind === 'pick' ? 'gram-ask big' : 'gram-ask' }, q.ask);
    el.replaceChildren(...[top, ask, stemLine(), opts, hints, more, feedback, full, actions].filter(Boolean));
  }
  function settle() {
    const r = a.result();
    results.push({ item: q.item, id: q.id, block: q.block, clean: r.clean, passed: r.passed, grade: r.grade });
    if (r.clean) stats.right++; else if (r.passed) stats.fuzzy++; else stats.failed++;
    save(S.applyProbe(state(), { qid: q.id, result: r, now: new Date() }));
  }
  function pick(i) {
    if (!a || a.done) return;
    const p = a.pick(i);
    if (!p) return;
    log({ type: 'answer', ...base(), ...p.event });
    if (p.hintShown) { hintsShown.push(p.hintShown); log({ type: 'hint', ...base(), item: q.item, mode: 'grammar', level: p.hintShown.level, auto: true }); }
    if (a.done) settle();
    draw();
    if (a.done && a.result().clean && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
  }
  function moreHint() {
    if (!a || a.done) return;
    const x = a.hint();
    if (!x) return;
    hintsShown.push(x);
    log({ type: 'hint', ...base(), item: q.item, mode: 'grammar', level: x.level, auto: false });
    // the fourth hint gives the answer away: the question ends there (no variant for a probe)
    if (a.done) settle();
    draw();
  }
  function flag() {
    clearTimeout(timer);
    if (!a || a.done) return;
    log({ type: 'flag', ...base(), item: q.item, mode: 'grammar', reason: 'probe' });
    save(S.flagProbe(state(), q.id, new Date()));
    stats.flagged++;
    index++;
    start();
  }
  function next() {
    clearTimeout(timer);
    if (!a || !a.done) return;
    index++;
    start();
  }
  whenReady(ctx, container, el, start, finish);
  return {
    el,
    stop: () => clearTimeout(timer),
    onKey(ev) {
      if (!a) return;
      const k = String(ev.key || '').toUpperCase();
      if (ev.key === 'Enter' && a.done) { if (ev.preventDefault) ev.preventDefault(); next(); return; }
      const i = k && '1234'.includes(k) ? Number(k) - 1 : LETTERS.indexOf(k);
      if (i >= 0 && i < a.options.length && !a.done) pick(i);
    },
  };
}

// ---------------------------------------------------------------- 认几个小学的老朋友

export async function addToBook(ctx, words, now = new Date()) {
  const W = ctx && ctx.words;
  const done = [];
  if (!W) return done;
  for (const x of words || []) {
    try {
      let e = W.get ? W.get(x.slug) : null;
      if (!e && typeof W.importData === 'function') { await W.importData(S.placeholderExport(x, now)); e = W.get ? W.get(x.slug) : null; }
      if (e && !e.favorited) {
        if (ctx && typeof ctx.toggleFav === 'function') await ctx.toggleFav(e.slug, true);
        else if (typeof W.favorite === 'function') await W.favorite(e.slug, true);
      }
      if (e) done.push(x.slug);
    } catch (err) { console.warn('screen: add word:', x && x.slug, (err && err.message) || err); }
  }
  return done;
}

const CHOICE_LABEL = { know: '认识', unsure: '不确定', new: '没学过' };

export function renderScreen(container, ctx, { items = [], sid = '', step = 'warmup', onDone = () => {}, autoNextMs = 700 } = {}) {
  const el = h('div', { className: 'scr' });
  container.replaceChildren(el);
  const log = logger(ctx);
  const save = saver(ctx, S.SCREEN_KEY);
  const theSid = sidOf(ctx, sid);
  const list = (items || []).filter(x => x && x.w);
  const firstTime = !S.readScreen(ctx && ctx.kv).intro;
  let index = 0, timer = 0, finished = false;
  let phase = 'ask';      // ask | check | result | meaning | fake
  let cur = null, opts = null, picked = -1, t0 = 0, note = '';
  const results = [];
  const state = () => S.readScreen(ctx && ctx.kv);
  const put = s => save(s);

  async function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    let added = [];
    try {
      const pending = S.pendingWords(state());
      if (pending.length) {
        added = await addToBook(ctx, pending, new Date());
        if (added.length) {
          await put(S.markQueued(state(), added, new Date()));
          if (ctx && typeof ctx.toast === 'function') ctx.toast('没学过的词记进单词本了，以后热身里再见。', 2600);
        }
      }
    } catch (err) { console.warn('screen: finish:', (err && err.message) || err); }
    onDone({ results, added });
  }
  function start() {
    if (index >= list.length) { finish(); return; }
    cur = list[index];
    picked = -1; note = '';
    t0 = Date.now();
    if (cur.recheck) { opts = S.checkOptions(cur.w); phase = opts ? 'check' : 'ask'; }
    else { opts = null; phase = 'ask'; }
    draw();
  }
  function next() {
    clearTimeout(timer);
    index++;
    start();
  }
  function head() {
    return h('div', { className: 'scr-head' },
      h('p', { className: 'scr-title' }, '认几个小学的老朋友'),
      firstTime && index === 0 && phase === 'ask' ? h('p', { className: 'scr-intro' }, '看到词点一下就行：认识、不确定、没学过都可以。没学过的，老师帮你记下来慢慢学。') : null);
  }
  function wordLine() {
    return h('p', { className: 'scr-word', lang: 'en' }, cur.display || cur.w, cur.fake ? null : sayBtn(ctx, cur.display || cur.w));
  }
  function draw() {
    const parts = [head(), wordLine()];
    if (phase === 'ask') {
      parts.push(h('div', { className: 'scr-choices' }, ['know', 'unsure', 'new'].map(c =>
        h('button', { type: 'button', className: 'scr-choice ' + c, dataset: { c }, on: { click: () => choose(c) } }, CHOICE_LABEL[c]))));
    } else if (phase === 'check' || phase === 'result') {
      parts.push(h('p', { className: 'scr-ask' }, cur.recheck ? '你说过认识它。选一选它的意思：' : '选一选它的意思：'));
      parts.push(h('div', { className: 'scr-options' }, opts.options.map((o, i) => {
        const b = h('button', { type: 'button', className: 'scr-opt', dataset: { i: String(i) }, on: { click: () => check(i) } },
          h('span', { className: 'scr-letter', 'aria-hidden': 'true' }, LETTERS[i]), h('span', { className: 'scr-text' }, o));
        if (phase === 'result') {
          b.disabled = true;
          if (i === opts.answer) b.classList.add(picked === i ? 'right' : 'is-answer');
          else if (i === picked) b.classList.add('wrong');
        }
        return b;
      })));
      if (phase === 'check') parts.push(h('button', { type: 'button', className: 'text-btn scr-forget', on: { click: () => check(-1) } }, '想不起来了'));
    }
    if (note) parts.push(h('p', { className: 'scr-note' + (phase === 'result' && picked === opts.answer ? ' ok' : '') }, note));
    // a right check moves on by itself (autoNextMs); a wrong one waits so she can read the meaning
    if ((phase === 'result' && (picked !== opts.answer || !(autoNextMs > 0))) || phase === 'meaning' || phase === 'fake') {
      parts.push(h('div', { className: 'scr-actions' }, h('button', { type: 'button', className: 'btn scr-next', on: { click: next } },
        index + 1 < list.length ? '下一个' : '接着来')));
    }
    el.replaceChildren(...parts);
  }
  function choose(c) {
    if (phase !== 'ask' || !cur) return;
    const ms = Date.now() - t0;
    const r = S.answerScreen(state(), cur, c, new Date());
    put(r.state);
    log({ type: 'ask', sid: theSid, step, qid: 'screen', who: 'emma', item: cur.id, slug: cur.fake ? undefined : cur.slug,
      answer: c, about: 'screen:505', fake: cur.fake ? true : undefined, ms });
    results.push({ id: cur.id, w: cur.w, choice: c, ...(cur.fake ? { fake: true } : {}) });
    if (cur.fake) {
      phase = 'fake';
      note = c === 'know' ? '这个词是老师编的，英语里没有它。拿不准的时候，点“不确定”就好。' : '你说得对：这个词是老师编的，英语里没有它。';
      draw();
      return;
    }
    if (r.check) {
      opts = S.checkOptions(cur.w);
      if (opts) { phase = 'check'; t0 = Date.now(); draw(); return; }
    }
    if (c === 'know') { next(); return; }
    phase = 'meaning';
    note = `${cur.display || cur.w} 是“${cur.zh}”。记下来了，以后热身里再见。`;
    draw();
  }
  function check(i) {
    if (phase !== 'check' || !cur || !opts) return;
    const ms = Date.now() - t0;
    picked = i;
    const correct = i === opts.answer;
    put(S.answerCheck(state(), cur, correct, new Date()));
    log({ type: 'answer', sid: theSid, step, item: cur.id, slug: cur.slug, mode: 'mc4', kind: 'screen', direction: 'en2zh',
      choice: i >= 0 ? opts.options[i] : 'forget', correct, first_try: true, ms, hint_level: 0, misconception: null,
      recheck: cur.recheck ? true : undefined });
    const last = results.length && results[results.length - 1].id === cur.id ? results[results.length - 1] : null;
    if (last) last.check = correct ? 'right' : 'wrong';
    else results.push({ id: cur.id, w: cur.w, choice: 'know', check: correct ? 'right' : 'wrong', recheck: true });
    phase = 'result';
    note = correct ? '对了。' : `是“${cur.zh}”。记下来了，以后热身里再见。`;
    draw();
    if (correct && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
  }
  whenReady(ctx, container, el, start, finish);
  return {
    el,
    stop: () => clearTimeout(timer),
    onKey(ev) {
      const k = String(ev.key || '').toUpperCase();
      if (ev.key === 'Enter') {
        if (phase === 'meaning' || phase === 'fake' || (phase === 'result')) { if (ev.preventDefault) ev.preventDefault(); next(); }
        return;
      }
      if (phase === 'ask') { const c = { 1: 'know', 2: 'unsure', 3: 'new' }[k]; if (c) choose(c); return; }
      if (phase === 'check') { const i = k && '1234'.includes(k) ? Number(k) - 1 : LETTERS.indexOf(k); if (i >= 0 && i < opts.options.length) check(i); }
    },
  };
}
