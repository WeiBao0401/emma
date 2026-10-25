// 语法卡的界面（DESIGN 5.4、5.5）：一屏中文规则加例句，然后 5 道题；答错第 1 级提示自动出现，“再给个提示”给下一级，
// 第 4 级讲清楚以后马上出变式题（“现在你来：”）。热身里混进来的语法题用 renderGrammarItem，一样的提示阶梯，没有讲解页。
// 逻辑都在 grammar.js（createRun），这里只画。样式 css/grammar.css（类名 gram-）。
// 负责：语法卡 agent。
//
// 导出
//   renderGrammarCard(container, ctx, { cardId, part, onDone, sid?, step?, doneLabel? }) -> Controller
//     把一张卡的一天（part 1 = 前 5 道，part 2 = 后 5 道）画进 container（会清空它）。先是规则页，点“开始做题”出题；
//     上次没做完的接着做。做完显示今天的结果，点“接着上课”调用 onDone({ cardId, part, done: true, stats, state })。
//     ctx 用到：kv（读写 'grammar:<cardId>'）、events.log、events.sessionId（没给 sid 时）、say（朗读，可以没有）。
//     step 默认 'grammar'（上课里那一格叫什么由 ui-lesson 定，可以传 'write'）。
//   renderGrammarItem(container, ctx, { item | items, onDone, sid?, step = 'warmup', autoNextMs = 1400 }) -> Controller
//     热身里的 1-2 道（grammarWarmItems 给的 WarmItem，或它的 item 字符串）。做完调用 onDone({ results: [{ item, grade, passed, clean }],
//     stats })。第一次就答对的停 autoNextMs 毫秒自动往下（0 = 等她点）。
//   Controller = { el, onKey(ev), stop(), run }   onKey 认 1-4 / A-D 选，Enter 下一题
//
// 0.5.2 讲不通就换讲法、对比小卡（teacher-next 4.3）：
//   renderGrammarCard：这张卡该换讲法了（grammar.js altDue），规则页换成 alt（“换个讲法”：配对口诀或判断步骤、5 个新例句），
//     先做 alt 的 3 道（“换个讲法 · 第 1 题 / 3”），再做这一天的题。
//   renderGrammarItem：热身里 kind 'alt' 带 intro 的那道，先讲一屏 alt 再出题。
//   一道题没过（第 4 级以后变式也错），下面显示这个误解的对比小卡（只有一句区别和左右各 1 个例句，不出题）。
//   renderContrast(container, ctx, { id | item, onDone, sid?, step = 'warmup', doneLabel = '接着上课', why? }) -> Controller
//     一张对比小卡：一句中文说清区别、左右两列各 2 个例句、3 道快速判断题（点一下就出对错和一句解释）。做完调用
//     onDone({ id, done: true, results: [{ qid, item, correct }], right })；没有这张卡 onDone({ id, done: false })。
//     每道记一条 answer（mode 'grammar'、kind 'contrast'，见 grammar.js），kv 'contrast.state' 每答一道存一次。ctx 另用 fetchJSON（读 contrast.json）。
//
// 事件和 kv 见 grammar.js 顶部注释：每次选择 'answer'（mode 'grammar'，带 misconception、hint_level），每级提示 'hint'，
// “这题有问题” 'flag'（跳过、不记分、以后不再出）。
import { h, icon } from './ui-dom.js';
import * as G from './grammar.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const PART_LABEL = { 1: '第一天 · 前 5 道', 2: '第二天 · 后 5 道' };
const unitName = id => { const s = String(id || ''); if (/^s/i.test(s)) return 'Starter'; const m = s.match(/(\d+)/); return m ? `Unit ${m[1]}` : s; };

function ensureContent(ctx) {
  const c = G.content();
  if (c) return Promise.resolve(c);
  return G.loadGrammar({ fetchJSON: ctx && ctx.fetchJSON });
}
// the 对比小卡 (null when contrast.json is not there: the cards work without them)
function ensureContrast(ctx) {
  const cc = G.contrastContent();
  if (cc) return Promise.resolve(cc);
  return G.loadContrast({ fetchJSON: ctx && ctx.fetchJSON }).catch(() => null);
}
function sidOf(ctx, sid) {
  if (sid) return sid;
  if (ctx && ctx.sid) return ctx.sid;
  try { return ctx && ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''; } catch (e) { return ''; }
}
const logger = ctx => ev => (ctx && ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log(ev) : null);
const saver = ctx => (id, st) => (ctx && ctx.kv && typeof ctx.kv.set === 'function' ? ctx.kv.set(G.kvKey(id), st) : null);
function sayBtn(ctx, text) {
  if (!ctx || typeof ctx.say !== 'function' || !text) return null;
  return h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => { ev.stopPropagation(); ctx.say(text, ev.currentTarget); } } }, icon('speak'));
}

// "This is my bag." with marks ['my'] -> text with <b class="gram-mark">my</b>
export function markParts(text, marks = []) {
  const list = (marks || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return [String(text)];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z'])(${list.map(esc).join('|')})(?![A-Za-z])`, 'g');
  const out = [];
  let at = 0;
  for (const m of String(text).matchAll(re)) {
    if (m.index > at) out.push(String(text).slice(at, m.index));
    out.push(h('b', { className: 'gram-mark' }, m[0]));
    at = m.index + m[0].length;
  }
  if (at < String(text).length) out.push(String(text).slice(at));
  return out;
}

function stemLine(q) {
  if (q.kind === 'pick') return null;
  const [a, b] = q.stem.split(G.BLANK);
  return h('p', { className: 'gram-stem', lang: 'en' },
    a, b !== undefined ? h('span', { className: 'gram-blank', 'aria-label': '空' }, ' ') : null, b !== undefined ? b : null,
    q.cue ? h('span', { className: 'gram-cue', lang: /[a-z]/i.test(q.cue) ? 'en' : 'zh-CN' }, `（${q.cue}）`) : null);
}
function askLine(q) {
  // a pick question's ask is the question itself (“莉莉的狗”英语怎么说？); a fill question's ask is a quiet line
  return h('p', { className: q.kind === 'pick' ? 'gram-ask big' : 'gram-ask' }, q.ask);
}

// ---------------------------------------------------------------- one question (shared by the card and the warm-up)

// the 对比小卡 for what she mixed up: the variant's wrong pick first (her last try), then the main question's, the latest
// first; a card about the very words she saw (her / hers for a her-hers variant) before the general one for the tag
function cmpFor(a, vPick) {
  try {
    const tries = [];
    const vOpt = vPick && a.vOptions ? a.vOptions[vPick.i] : null;
    if (vOpt && !vOpt.correct && vOpt.tag) tries.push({ tag: vOpt.tag, text: [a.variant.answer, vOpt.text] });
    for (const i of [...a.picked].reverse()) { const o = a.options[i]; if (o && !o.correct && o.tag) tries.push({ tag: o.tag, text: [a.q.answer, o.text] }); }
    for (const t of tries) {
      const words = new Set(t.text.join(' ').toLowerCase().split(/[^a-z']+/).filter(Boolean));
      const c = G.contrastFor(t.tag, { text: t.text });
      if (c && c.words.some(w => words.has(w))) return c;
    }
    for (const t of tries) { const c = G.contrastFor(t.tag); if (c) return c; }
  } catch (e) { /* no contrast cards: nothing to show */ }
  return null;
}

function questionView(run, ctx, { label, onNext, autoNextMs = 0, nextLabel = '下一题' }) {
  const el = h('div', { className: 'gram gram-q' });
  let timer = 0;
  let vPick = null;
  const x = run.current();
  const q = x.q;
  const a = run.attempt;
  const hintsShown = [];

  function optionButtons(opts, onPick, { variant = false } = {}) {
    const longOnes = opts.some(o => o.text.length > 14);
    return h('div', { className: 'gram-options' + (longOnes ? ' one-col' : '') }, opts.map((o, i) => {
      const b = h('button', { type: 'button', className: 'gram-opt', lang: 'en', dataset: { i: String(i) }, on: { click: () => onPick(i) } },
        h('span', { className: 'gram-letter', 'aria-hidden': 'true' }, LETTERS[i]), h('span', { className: 'gram-text' }, o.text));
      if (variant) b.classList.add('v');
      return b;
    }));
  }

  function draw() {
    const top = h('div', { className: 'gram-top' },
      h('span', { className: 'gram-pos' }, label, q.familyName ? h('span', { className: 'sub' }, ` · ${q.familyName}`) : null),
      a.done ? null : h('button', { type: 'button', className: 'text-btn gram-flag', on: { click: flag } }, '这题有问题'));
    const main = optionButtons(a.options, pick);
    main.childNodes.forEach((b, i) => {
      if (!b.classList) return;
      const o = a.options[i];
      const picked = a.picked.has(i);
      if (picked && !o.correct) { b.classList.add('wrong'); b.disabled = true; }
      if (o.correct && (picked || a.phase === 'variant' || (a.done && a.level >= G.HINT_MAX))) b.classList.add(picked ? 'right' : 'is-answer');
      if (a.done || a.phase === 'variant') b.disabled = true;
    });
    const hints = hintsShown.length ? h('ol', { className: 'gram-hints' }, hintsShown.map(hh =>
      h('li', { className: 'gram-hint' + (hh.level >= G.HINT_MAX ? ' full' : '') }, h('span', { className: 'gram-n' }, String(hh.level)),
        h('span', { className: 'gram-hint-text' }, hh.text)))) : null;
    const canHint = (a.phase === 'ask' || a.phase === 'retry') && a.level < G.HINT_MAX;
    const more = canHint ? h('button', { type: 'button', className: 'text-btn accent gram-more', on: { click: moreHint } }, a.level ? '再给个提示' : '给个提示') : null;

    let variantBlock = null;
    if (a.variant && (a.phase === 'variant' || (a.done && vPick))) {
      const v = a.variant;
      const vOpts = optionButtons(a.vOptions, pickVariant, { variant: true });
      vOpts.childNodes.forEach((b, i) => {
        if (!b.classList) return;
        const o = a.vOptions[i];
        if (a.done) {
          b.disabled = true;
          if (vPick && vPick.i === i) b.classList.add(o.correct ? 'right' : 'wrong');
          else if (o.correct) b.classList.add('is-answer');
        }
      });
      variantBlock = h('div', { className: 'gram-variant' },
        h('p', { className: 'gram-now' }, '现在你来：'), askLine(v), stemLine(v), vOpts);
    }

    let feedback = null, full = null, actions = null, cmp = null;
    if (a.done) {
      const r = a.result();
      let msg = '';
      if (a.variant && vPick) msg = r.variantCorrect ? '这题过关了。' : `答案是 ${a.variant.answer}。${a.variant.explain || ''}过两天再练一次。`;
      else if (r.clean) msg = '对了。';
      else if (r.passed) msg = '改对了。';
      else msg = `答案是 ${q.answer}。过两天再练一次。`;
      feedback = h('p', { className: 'gram-feedback' + (r.passed ? ' ok' : '') }, msg);
      const shown = a.variant && vPick ? a.variant : q;
      const sent = G.sentenceOf(shown);
      full = h('div', { className: 'gram-full' },
        h('p', { className: 'gram-en', lang: 'en' }, sent, sayBtn(ctx, sent)),
        shown.zh ? h('p', { className: 'gram-zh' }, shown.zh) : null);
      // not passed (the variant wrong too): the two things she mixed up, side by side
      if (!r.passed) cmp = cmpFor(a, vPick);
      actions = h('div', { className: 'gram-actions' }, h('button', { type: 'button', className: 'btn gram-next', on: { click: next } }, nextLabel));
    }
    el.replaceChildren(...[top, askLine(q), stemLine(q), main, hints, more, variantBlock, feedback, full, cmp ? contrastMini(cmp, ctx) : null, actions].filter(Boolean));
  }

  function pick(i) {
    const p = run.pick(i);
    if (!p) return;
    if (p.hintShown) hintsShown.push(p.hintShown);
    draw();
    if (a.done && a.result().clean && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
  }
  function moreHint() {
    const hh = run.hint();
    if (!hh) return;
    hintsShown.push(hh);
    draw();
  }
  function pickVariant(i) {
    const p = run.pickVariant(i);
    if (!p) return;
    vPick = { i, correct: p.correct };
    draw();
  }
  async function flag() {
    clearTimeout(timer);
    const nx = await run.flag();
    onNext(nx, { flagged: true });
  }
  async function next() {
    clearTimeout(timer);
    if (!a.done) return;
    const nx = await run.next();
    onNext(nx, {});
  }
  draw();
  return {
    el,
    stop: () => clearTimeout(timer),
    onKey(ev) {
      const k = String(ev.key || '').toUpperCase();
      const i = '1234'.includes(k) && k ? Number(k) - 1 : LETTERS.indexOf(k);
      if (ev.key === 'Enter' && a.done) { ev.preventDefault && ev.preventDefault(); next(); return; }
      if (i < 0 || i > 3) return;
      if (a.phase === 'variant') pickVariant(i); else if (!a.done) pick(i);
    },
  };
}

// ---------------------------------------------------------------- the card

function ruleView(card, part, { remaining, total, onStart, ctx, why = '' }) {
  const table = card.table ? h('table', { className: 'gram-table' },
    h('thead', null, h('tr', null, card.table.head.map(t => h('th', null, t)))),
    h('tbody', null, card.table.rows.map(r => h('tr', null, r.map((t, i) => h(i ? 'td' : 'th', i ? { lang: 'en' } : { scope: 'row' }, t)))))) : null;
  const resume = remaining < total;
  return h('div', { className: 'gram gram-intro' },
    // the foundation cards say 打地基 and the Unit 4 one 下个单元 (card.label), the others their unit
    h('p', { className: 'gram-chip' }, h('span', { className: 'gram-tag' }, `${card.label || unitName(card.unit)} · 语法卡`), h('span', { className: 'gram-part' }, PART_LABEL[part] || '')),
    h('h2', { className: 'gram-title' }, card.title),
    // why today (grammar.js nextCard): “这几天有几处错和名词复数有关，今天先把它补牢。”
    why ? h('p', { className: 'gram-why' }, why) : null,
    h('ol', { className: 'gram-rule' }, card.rule.map(t => h('li', null, t))),
    table,
    h('h3', { className: 'gram-sub' }, '例句'),
    h('ul', { className: 'gram-examples' }, card.examples.map(e => h('li', null,
      h('p', { className: 'gram-en', lang: 'en' }, markParts(e.en, e.mark), sayBtn(ctx, e.en)),
      h('p', { className: 'gram-zh' }, e.zh)))),
    h('div', { className: 'gram-actions' },
      h('button', { type: 'button', className: 'btn gram-start', on: { click: onStart } }, resume ? `接着做 · 还剩 ${remaining} 道` : `开始做题 · ${remaining} 道`)));
}

function endView(card, part, stats, { onDone, label = '接着上课' }) {
  const n = stats.right + stats.fuzzy + stats.failed;
  const lines = [];
  if (n) lines.push(`第一次就对了 ${stats.right} 道${stats.fuzzy ? `，${stats.fuzzy} 道看了提示改对` : ''}${stats.failed ? `，${stats.failed} 道过几天换个句子再练` : ''}。`);
  lines.push(Number(part) === 1 ? '明天接着做后 5 道。' : '这张卡做完了。以后热身里会混进它的题。');
  return h('div', { className: 'gram gram-end' },
    h('p', { className: 'gram-chip' }, h('span', { className: 'gram-tag' }, `${card.label || unitName(card.unit)} · ${card.title}`)),
    h('p', { className: 'lede' }, n ? `今天的 ${n} 道做完了。` : '今天这份做完了。'),
    lines.map(t => h('p', { className: 'gram-zh' }, t)),
    h('div', { className: 'gram-actions' }, h('button', { type: 'button', className: 'btn gram-done', on: { click: onDone } }, label)));
}

// ---------------------------------------------------------------- 换个讲法 (the card's alt)

const langOf = t => (/[一-鿿]/.test(String(t)) ? 'zh-CN' : 'en');
// be 动词“找搭档”: I → am; plurals a cat → two cats; the frequency ladder always … never
function pairsView(pairs) {
  if (!pairs || !pairs.length) return null;
  return h('ul', { className: 'gram-pairs' }, pairs.map(p => h('li', { className: 'gram-pair' },
    h('span', { className: 'gram-pair-l', lang: langOf(p.left) }, p.left),
    h('span', { className: 'gram-pair-arrow', 'aria-hidden': 'true' }, '→'),
    h('span', { className: 'gram-pair-r', lang: langOf(p.right) }, p.right),
    p.note ? h('span', { className: 'gram-pair-note', lang: langOf(p.note) }, p.note) : null)));
}
// 物主代词“后面有没有名词”: numbered questions, each with its answers
function stepsView(steps) {
  if (!steps || !steps.length) return null;
  return h('ol', { className: 'gram-steps' }, steps.map((st, i) => h('li', { className: 'gram-step' },
    h('p', { className: 'gram-step-ask' }, h('span', { className: 'gram-n' }, String(i + 1)), st.ask),
    h('ul', { className: 'gram-branches' }, (st.branches || []).map(b => h('li', { className: 'gram-branch' },
      h('span', { className: 'gram-branch-if' }, b.if), h('span', { className: 'gram-pair-arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { className: 'gram-branch-then' }, b.then)))))));
}
function tableView(table) {
  if (!table || !Array.isArray(table.head)) return null;
  return h('table', { className: 'gram-table' },
    h('thead', null, h('tr', null, table.head.map(t => h('th', null, t)))),
    h('tbody', null, (table.rows || []).map(r => h('tr', null, r.map((t, i) => h(i ? 'td' : 'th', i ? { lang: 'en' } : { scope: 'row' }, t))))));
}
// the alt page: 换个讲法 instead of the rule page (the card) or before the first alt question (the warm-up)
function altView(card, { onStart, ctx, startLabel, lead = '上次这里有点绕，今天换个讲法。' }) {
  const a = card.alt;
  return h('div', { className: 'gram gram-intro gram-alt' },
    h('p', { className: 'gram-chip' }, h('span', { className: 'gram-tag alt' }, '换个讲法'), h('span', { className: 'gram-part' }, card.title)),
    h('h2', { className: 'gram-title' }, a.title || card.title),
    lead ? h('p', { className: 'gram-why' }, lead) : null,
    h('ol', { className: 'gram-rule' }, a.rule.map(t => h('li', null, t))),
    pairsView(a.pairs), stepsView(a.steps), tableView(a.table),
    a.examples.length ? h('h3', { className: 'gram-sub' }, '例句') : null,
    a.examples.length ? h('ul', { className: 'gram-examples' }, a.examples.map(e => h('li', null,
      h('p', { className: 'gram-en', lang: 'en' }, markParts(e.en, e.mark), sayBtn(ctx, e.en)),
      h('p', { className: 'gram-zh' }, e.zh)))) : null,
    h('div', { className: 'gram-actions' }, h('button', { type: 'button', className: 'btn gram-start', on: { click: onStart } }, startLabel)));
}

// ---------------------------------------------------------------- 对比小卡

// one column: the word, when to use it, n examples
function cmpCol(side, ctx, n = 2, cls = '') {
  return h('div', { className: 'gram-cmp-col' + (cls ? ' ' + cls : '') },
    h('p', { className: 'gram-cmp-head', lang: langOf(side.head) }, side.head),
    side.note ? h('p', { className: 'gram-cmp-note' }, side.note) : null,
    h('ul', { className: 'gram-cmp-ex' }, side.examples.slice(0, n).map(e => h('li', null,
      h('p', { className: 'gram-en', lang: 'en' }, markParts(e.en, e.mark), ctx ? sayBtn(ctx, e.en) : null),
      h('p', { className: 'gram-zh' }, e.zh)))));
}
// under a question she did not pass: the difference in one sentence and one example a side, nothing to answer
function contrastMini(c, ctx) {
  return h('div', { className: 'gram-cmp mini' },
    h('p', { className: 'gram-cmp-kicker' }, `对比着看：${c.title}`),
    h('p', { className: 'gram-cmp-zh' }, c.zh),
    h('div', { className: 'gram-cmp-cols' }, cmpCol(c.left, ctx, 1, 'l'), cmpCol(c.right, ctx, 1, 'r')));
}

export function renderContrast(container, ctx, { id = '', item = null, onDone = () => {}, sid = '', step = 'warmup', doneLabel = '接着上课', why = '' } = {}) {
  const shell = h('div', { className: 'gram-shell cmp' }, h('p', { className: 'gram-wait small' }, '稍等……'));
  container.replaceChildren(shell);
  const ref = item && typeof item === 'object' ? item : null;
  const cid = String(id || (ref && (ref.id || ref.item)) || item || '').replace(/^gc:/, '').split(':')[0];
  const lead = String(why || (ref && ref.why) || '');
  let stopped = false, onKey = () => {};
  const ctl = { el: shell, onKey: ev => onKey(ev), stop: () => { stopped = true; } };
  const missing = () => shell.replaceChildren(h('p', { className: 'gram-wait small' }, '这张小卡还没准备好。'),
    h('button', { type: 'button', className: 'btn', on: { click: () => onDone({ id: cid, done: false }) } }, doneLabel));
  ensureContrast(ctx).then(cc => {
    if (stopped) return;
    const x = cc && cc.get(cid);
    if (!x || !x.quiz.length) { missing(); return; }
    const log = logger(ctx);
    const sidNow = sidOf(ctx, sid);
    const base = G.readContrastState(ctx && ctx.kv);   // before this look: every save counts this look once
    const picks = new Map();   // qid -> option index
    const results = [];
    const t0 = Date.now();
    let tLast = t0;
    const save = () => { try { if (ctx && ctx.kv && typeof ctx.kv.set === 'function') { const r = ctx.kv.set(G.CONTRAST_KV, G.markContrast(base, x.id, { now: new Date(), results })); if (r && r.catch) r.catch(() => {}); } } catch (e) { /* progress stays on the screen */ } };
    const finished = () => results.length >= x.quiz.length;
    const done = () => onDone({ id: x.id, done: true, results: results.slice(), right: results.filter(r => r.correct).length });
    function pick(q, i) {
      if (picks.has(q.id) || stopped) return;
      picks.set(q.id, i);
      const choice = q.options[i];
      const correct = choice === q.answer;
      const now = Date.now();
      results.push({ qid: q.id, item: q.item, correct });
      try {
        const r = log({ type: 'answer', item: q.item, mode: G.MODE, kind: 'contrast', contrast: x.id, card: x.cards[0] || undefined, step, sid: sidNow || undefined,
          choice, correct, first_try: true, ms: Math.max(0, now - tLast), hint_level: 0, misconception: correct ? null : q.tag || null });
        if (r && r.catch) r.catch(() => {});
      } catch (e) { /* recording never blocks an answer */ }
      tLast = now;
      save();
      draw();
    }
    function quizItem(q, n) {
      const chosen = picks.has(q.id) ? picks.get(q.id) : -1;
      const answered = chosen >= 0;
      const [a, b] = String(q.stem || '').split(G.BLANK);
      const stem = q.stem ? h('p', { className: 'gram-qz-stem', lang: 'en' }, a, b !== undefined ? h('span', { className: 'gram-blank', 'aria-label': '空' }, ' ') : null, b !== undefined ? b : null) : null;
      const opts = h('div', { className: 'gram-qz-opts' + (q.options.some(o => o.length > 14) ? ' one-col' : '') }, q.options.map((o, i) => {
        const btn = h('button', { type: 'button', className: 'gram-qz-opt', lang: 'en', dataset: { i: String(i) }, on: { click: () => pick(q, i) } },
          h('span', { className: 'gram-letter', 'aria-hidden': 'true' }, LETTERS[i]), h('span', { className: 'gram-text' }, o));
        if (answered) {
          btn.disabled = true;
          if (o === q.answer) btn.classList.add(i === chosen ? 'right' : 'is-answer');
          else if (i === chosen) btn.classList.add('wrong');
        }
        return btn;
      }));
      const ok = answered && q.options[chosen] === q.answer;
      return h('li', { className: 'gram-qz-item' + (answered ? (ok ? ' ok' : ' no') : '') },
        h('p', { className: 'gram-qz-n' }, `第 ${n} 题`, q.ask ? h('span', { className: 'gram-qz-ask' }, q.ask) : null),
        stem, opts,
        answered ? h('p', { className: 'gram-qz-explain' + (ok ? ' ok' : '') }, `${ok ? '对了。' : `是 ${q.answer}。`}${q.explain}`) : null);
    }
    function draw() {
      const end = finished();
      const right = results.filter(r => r.correct).length;
      shell.replaceChildren(h('div', { className: 'gram gram-cmp-card' },
        h('p', { className: 'gram-chip' }, h('span', { className: 'gram-tag cmp' }, '对比小卡')),
        h('h2', { className: 'gram-title' }, x.title),
        lead ? h('p', { className: 'gram-why' }, lead) : null,
        h('div', { className: 'gram-cmp' },
          h('p', { className: 'gram-cmp-zh big' }, x.zh),
          h('div', { className: 'gram-cmp-cols' }, cmpCol(x.left, ctx, 2, 'l'), cmpCol(x.right, ctx, 2, 'r'))),
        h('h3', { className: 'gram-sub' }, '快速判断'),
        h('ol', { className: 'gram-qz' }, x.quiz.map((q, i) => quizItem(q, i + 1))),
        end ? h('p', { className: 'gram-feedback' + (right === x.quiz.length ? ' ok' : '') }, right === x.quiz.length ? '都对了。' : '错的那道，再对着上面的两列看一眼。') : null,
        end ? h('div', { className: 'gram-actions' }, h('button', { type: 'button', className: 'btn gram-done', on: { click: done } }, doneLabel)) : null));
    }
    onKey = ev => {
      const k = String(ev.key || '').toUpperCase();
      if (ev.key === 'Enter' && finished()) { if (ev.preventDefault) ev.preventDefault(); done(); return; }
      const i = k === '1' || k === 'A' ? 0 : k === '2' || k === 'B' ? 1 : -1;
      const q = x.quiz.find(z => !picks.has(z.id));
      if (i >= 0 && q && i < q.options.length) pick(q, i);
    };
    draw();
  }).catch(() => { if (!stopped) missing(); });
  return ctl;
}

export function renderGrammarCard(container, ctx, { cardId, part = 1, onDone = () => {}, sid = '', step = G.STEP, doneLabel = '接着上课', why = '' } = {}) {
  const shell = h('div', { className: 'gram-shell' }, h('p', { className: 'gram-wait small' }, '稍等……'));
  container.replaceChildren(shell);
  let qv = null, run = null, stopped = false;
  const ctl = { el: shell, get run() { return run; }, onKey: ev => { if (qv) qv.onKey(ev); }, stop: () => { stopped = true; if (qv) qv.stop(); } };
  ensureContrast(ctx);   // for the 对比小卡 under a question she does not pass
  ensureContent(ctx).then(c => {
    if (stopped) return;
    const card = c && c.card(cardId);
    if (!card) { shell.replaceChildren(h('p', { className: 'gram-wait small' }, '这张卡还没准备好。'), h('button', { type: 'button', className: 'btn', on: { click: () => onDone({ cardId, part, done: false }) } }, doneLabel)); return; }
    const state = G.normState(ctx && ctx.kv ? ctx.kv.peek(G.kvKey(cardId), null) : null, cardId);
    // 讲不通就换讲法: the same mistake twice (or a variant missed after hint 4) since the last time, so this time the other way
    const due = card.alt ? G.altDue(state, new Date(), { content: c }) : null;
    run = G.createRun({ content: c, cardId, part, state, now: () => new Date(), log: logger(ctx), save: saver(ctx), sid: sidOf(ctx, sid), step, alt: due || false });
    const total = c.part(cardId, part).length;
    const finish = () => onDone({ cardId, part, done: true, stats: run.stats, state: run.state });
    const end = () => { qv = null; shell.replaceChildren(endView(card, part, run.stats, { onDone: finish, label: doneLabel })); };
    const show = () => {
      const x = run.current();
      if (!x) { end(); return; }
      const label = x.kind === 'alt' ? `换个讲法 · 第 ${run.index + 1} 题 / ${run.altCount}` : `第 ${total - (run.total - run.index) + 1} 题 / ${total}`;
      qv = questionView(run, ctx, { label, onNext: nx => (nx ? show() : end()) });
      shell.replaceChildren(qv.el);
    };
    if (!run.total) { end(); return; }
    shell.replaceChildren(run.altCount
      ? altView(card, { onStart: show, ctx, startLabel: `开始做题 · ${run.total} 道` })
      : ruleView(card, part, { remaining: run.total, total, onStart: show, ctx, why: String(why || '') }));
  }).catch(() => {
    if (stopped) return;
    shell.replaceChildren(h('p', { className: 'gram-wait small' }, '语法卡没有打开，等一下再试。'), h('button', { type: 'button', className: 'btn', on: { click: () => onDone({ cardId, part, done: false }) } }, doneLabel));
  });
  return ctl;
}

export function renderGrammarItem(container, ctx, { item = null, items = null, onDone = () => {}, sid = '', step = 'warmup', autoNextMs = 1400 } = {}) {
  const shell = h('div', { className: 'gram-shell warm' }, h('p', { className: 'gram-wait small' }, '稍等……'));
  container.replaceChildren(shell);
  let qv = null, run = null, stopped = false;
  const list = (items || (item ? [item] : [])).map(x => (typeof x === 'string' ? { item: x, kind: 'practice' } : x));
  const ctl = { el: shell, get run() { return run; }, onKey: ev => { if (qv) qv.onKey(ev); }, stop: () => { stopped = true; if (qv) qv.stop(); } };
  ensureContrast(ctx);
  ensureContent(ctx).then(c => {
    if (stopped) return;
    const states = G.grammarState(ctx && ctx.kv, c).cards;
    run = G.createRun({ content: c, items: list, states, now: () => new Date(), log: logger(ctx), save: saver(ctx), sid: sidOf(ctx, sid), step });
    const finish = () => { qv = null; onDone({ results: run.results, stats: run.stats }); };
    const show = () => {
      const x = run.current();
      if (!x) { finish(); return; }
      const card = c.card(x.q.card);
      const label = `${x.kind === 'alt' ? '换个讲法' : '语法'} · ${card ? card.title : ''}`;
      qv = questionView(run, ctx, { label, autoNextMs, nextLabel: '下一个', onNext: nx => (nx ? show() : finish()) });
      shell.replaceChildren(qv.el);
    };
    if (!run.total) { finish(); return; }
    // 讲不通就换讲法 in the warm-up: the first alt question comes after one screen of the other explanation
    const intro = list.find(x => x && x.kind === 'alt' && x.intro);
    const introCard = intro ? c.card(intro.card || ((c.item(intro.item) || {}).card)) : null;
    if (introCard && introCard.alt) shell.replaceChildren(altView(introCard, { onStart: show, ctx, startLabel: '开始做题' }));
    else show();
  }).catch(() => { if (!stopped) onDone({ results: [], stats: null, error: true }); });
  return ctl;
}
