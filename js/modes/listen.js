// 听音选词（DESIGN 5.1，v1）：老师读一个词，她从四个英文里点出听到的那个。
// 负责：题型 agent（modes/spell.js、modes/listen.js、css/spell.css）。
//
// 出题规则
//   只出单个的词（短语、带空格的不出）。干扰项优先选读音近、长得像的词（soundNear / formNear），再看同单元、
//   她认识的词（这节课的词、单词本、同单元课本词、小学词）、首字母相同、长度相近。
//   不放：同音词（son / sun、right / write，听不出来，会有两个对的）、英美拼法（programme / program）、
//   同一个词的变化形式（book / books）、近义词（意思一样）。三个干扰项之间也不放同音的。
//   凑不齐三个干扰项返回 null（换别的题型）。
//   评分：第一次就对 3；看了中文意思才对 2；答错 1（和四选一一样，gradeOf）。再听几遍都不扣分。
//
// 导出
//   MODE_ID = 'listen'（ctx.rate 的 modeId 和 events 的 mode 都是它）；HOMOPHONES
//   canListen(entry) -> bool
//   sameSound(a, b) -> bool                     同音（表里的一对，或英美拼法）
//   nearWords(word, words, { limit }) -> [string]   words 里和 word 读音近或长得像的（不含同音和变化形式）
//   makeListen(entry, pool, { rng, extra, unit, known, distractor }) -> ListenQuestion | null   纯函数
//     distractor（0.7.1）：'near' 读音近、长得像之外，同单元、同词性的再加分；'far' 不放读音近、长得像的，挑长度和
//     首字母都不一样的（凑不齐退回 'normal'）；'normal' 原来的做法
//     pool / extra 同四选一（词条、{ w, cn }、{ word, cn } 都行）；known(word) -> bool 她认识的词加分
//     ListenQuestion = { id: 'w:<slug>', slug, unit, say: 要读的英文,
//                        options: [{ text, slug, correct, tag: null | 'form' | 'sound' | 'category' | 'meaning', meaning, src }],
//                        answer, right: { headword, meaning }, hint: { kind: 'meaning', text, lang: 'zh-CN' } | null }
//   explainListen(q, i) -> string               选了第 i 个以后的一句中文
//   createListenAttempt(q, { now, retry }) -> { pick(i) -> Result | null, hint(), played(), done, correct, grade, hintLevel, plays, event }
//     event = { item, slug, mode: 'listen', choice, choice_slug, distractor, correct, first_try, ms, hint_level,
//               misconception: 干扰项的标签（答对为 null）, plays: 听了几遍, unit?, retry? }（type、sid、step 由调用方补）
//   listenFiller(entry, app) -> [补位的词]       同单元课本词，再从 curriculum.standardWords() 找音近、形近的词
//   renderListen(container, q, { onAnswer, onDone, say, retry, autoNextMs }) -> { el, attempt, pick, hint, play, next, onKey }
//   listenMode = { id: 'listen', label: '听音选词', render(entry, ctx) -> { el, footer, onKey, question, modeId, eventMode } }
//     ctx 和 choiceMode 一样；出不了题退回四选一（返回 choiceMode.render 的结果，modeId 'mc4'）
//
// 依赖：ui-dom.js（h、icon）、words.js（slugify）、modes/choice.js（形近、读音近、标签、意思、评分）。
import { h, icon } from '../ui-dom.js';
import { slugify } from '../words.js';
import { meaningOf, posOf, formNear, soundNear, sameWord, tagOf, meaningRelation, gradeOf, isRetry, choiceMode, TAG_NOTE } from './choice.js';

export const MODE_ID = 'listen';

// words that sound the same (British English, the textbook's voice); a pair here never shares a question
export const HOMOPHONES = [
  'right write', 'two too to', 'there their', 'hear here', 'see sea', 'son sun', 'meet meat', 'know no', 'buy by bye',
  'for four', 'eye i', 'one won', 'hour our', 'which witch', 'week weak', 'road rode', 'flower flour', 'dear deer', 'new knew',
  'blue blew', 'wear where', 'tail tale', 'sail sale', 'pair pear', 'plane plain', 'piece peace', 'whole hole', 'night knight',
  'be bee', 'red read', 'ate eight', 'wait weight', 'way weigh', 'nose knows', 'rose rows', 'break brake', 'cell sell', 'hi high',
  'its it\'s', 'your you\'re', 'aunt aren\'t', 'check cheque', 'bean been', 'through threw', 'choose chews', 'wood would',
  'made maid', 'mail male', 'rain reign', 'tea tee', 'or ore', 'saw sore', 'court caught', 'sauce source', 'board bored',
  'fair fare', 'hair hare', 'bear bare', 'so sew', 'not knot', 'some sum', 'scene seen', 'weather whether', 'war wore',
  'flew flu', 'passed past', 'heard herd', 'allowed aloud', 'great grate', 'die dye', 'role roll', 'steal steel', 'poor pour',
  'sight site', 'berry bury', 'father farther', 'tide tied', 'missed mist', 'guessed guest', 'real reel', 'lead led',
].map(s => s.split(' '));

const low = s => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, "'");
const headOf = x => String((x && (x.headword || x.w || x.word)) || '').trim();

// colour / color, programme / program, centre / center, practise / practice, organise / organize, grey / gray
const variant = w => low(w).replace(/(ti|n)ce$/, '$1se').replace(/our(s?)$/, 'or$1').replace(/our(?=[a-z])/, 'or')
  .replace(/tre(s?)$/, 'ter$1').replace(/mme(s?)$/, 'm$1').replace(/is(e|ed|es|ing|ation)$/, 'iz$1')
  .replace(/^grey/, 'gray').replace(/ll(ed|ing|er)$/, 'l$1');

export function sameSound(a, b) {
  a = low(a); b = low(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (HOMOPHONES.some(g => g.includes(a) && g.includes(b))) return true;
  return variant(a) === variant(b);
}

export function canListen(entry) {
  const w = headOf(entry);
  return !!w && !/\s/.test(w) && /[a-z]/i.test(w) && !(entry && entry.phrase);
}

// near in sound or in spelling, and still a different word she could tell apart by ear
const isNear = (a, b) => !sameSound(a, b) && !sameWord(a, b) && (formNear(a, b) || soundNear(a, b));

export function nearWords(word, words = [], { limit = 40 } = {}) {
  const out = [], seen = new Set([low(word)]);
  for (const w of words || []) {
    if (typeof w !== 'string' || /\s/.test(w) || seen.has(low(w))) continue;
    seen.add(low(w));
    if (isNear(word, w)) { out.push(w); if (out.length >= limit) break; }
  }
  return out;
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const lenClose = (a, b) => Math.abs(a.length - b.length) <= Math.max(1, Math.round(Math.max(a.length, b.length) * 0.3));

export function makeListen(entry, pool = [], { rng = Math.random, extra = [], unit, known, distractor = 'normal' } = {}) {
  if (!entry || !entry.slug || !canListen(entry)) return null;
  if (distractor === 'far') {
    const xs = typeof extra === 'function' ? extra() : extra;
    const far = makeListen(entry, pool, { rng, extra: xs, unit, known, distractor: 'far-only' });
    return far || makeListen(entry, pool, { rng, extra: xs, unit, known, distractor: 'normal' });
  }
  const dist = distractor === 'far-only' ? 'far' : distractor === 'near' ? 'near' : 'normal';
  const tpos = posOf(entry);
  const target = headOf(entry);
  const u = unit || entry.unit || null;
  const seen = new Set([low(target)]);
  const scored = [];
  const consider = (list, src) => {
    for (const x of list || []) {
      if (!x) continue;
      const hw = headOf(x);
      if (!hw || /\s/.test(hw) || (x.phrase) || seen.has(low(hw))) continue;
      seen.add(low(hw));
      if (sameSound(target, hw) || sameWord(target, hw)) continue;        // could not be told apart by ear
      if (meaningRelation(entry, x) === 'same') continue;                 // a synonym is not what she misheard
      const form = formNear(target, hw), sound = soundNear(target, hw);
      let isKnown = src === 'pool';
      try { isKnown = isKnown || (!!known && !!known(hw)); } catch (e) { /* optional */ }
      if (dist === 'far' && (form || sound)) continue;
      const samePos = !!tpos && posOf(x) === tpos;
      const score = dist === 'far'
        ? (isKnown ? 3 : 0) + (u && x.unit && x.unit !== u ? 2 : 0) + (!samePos ? 1 : 0) + (low(hw)[0] !== low(target)[0] ? 1 : 0) + (!lenClose(hw, target) ? 2 : 0) + rng() * 0.9
        : (form ? 6 : 0) + (sound ? 5 : 0) + (isKnown ? 2 : 0) + (u && x.unit === u ? (dist === 'near' ? 4 : 2) : 0) + (dist === 'near' && samePos ? 2 : 0)
          + (low(hw)[0] === low(target)[0] ? 1 : 0) + (lenClose(hw, target) ? 1 : 0) + rng() * 0.9;
      scored.push({ x, hw, src, score, tag: tagOf(entry, x) });
    }
  };
  consider(pool, 'pool');
  consider(typeof extra === 'function' ? extra() : extra, 'extra');
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of scored) {
    if (picked.length === 3) break;
    if (picked.some(p => sameSound(p.hw, s.hw) || sameWord(p.hw, s.hw))) continue;
    picked.push(s);
  }
  if (picked.length < 3) return null;
  const opt = (x, hw, correct, tag, src) => ({ text: hw, slug: x.slug || slugify(hw), correct, tag, meaning: meaningOf(x), src });
  const options = shuffle([opt(entry, target, true, null, 'target'), ...picked.map(s => opt(s.x, s.hw, false, s.tag || null, s.src))], rng);
  const meaning = meaningOf(entry);
  return {
    id: 'w:' + entry.slug,
    slug: entry.slug,
    unit: u,
    say: target,
    distractor: dist,
    options,
    answer: options.findIndex(o => o.correct),
    right: { headword: target, meaning },
    hint: meaning ? { kind: 'meaning', text: meaning, lang: 'zh-CN' } : null,
  };
}

export function explainListen(q, i) {
  if (!q) return '';
  const r = q.right, o = q.options[i];
  const rightLine = r.meaning ? `听到的是 ${r.headword}，“${r.meaning}”。` : `听到的是 ${r.headword}。`;
  if (!o || o.correct) return rightLine;
  const pickLine = `你选的是 ${o.text}${o.meaning ? `，“${o.meaning}”` : ''}。`;
  return rightLine + pickLine + (o.tag ? TAG_NOTE[o.tag] || '' : '');
}

export function createListenAttempt(q, { now = () => Date.now(), retry = false } = {}) {
  const t0 = now();
  let hintLevel = 0, plays = 0, result = null;
  return {
    get done() { return !!result; },
    get correct() { return result ? result.correct : null; },
    get grade() { return result ? result.grade : null; },
    get hintLevel() { return hintLevel; },
    get plays() { return plays; },
    get event() { return result ? result.event : null; },
    played() { plays++; return plays; },
    hint() { if (!result && q && q.hint) hintLevel = 1; return hintLevel; },
    pick(i) {
      if (result || !q || !q.options[i]) return null;
      const o = q.options[i];
      const event = {
        item: q.id, slug: q.slug, mode: MODE_ID, choice: o.text, choice_slug: o.slug, distractor: o.correct ? null : o.slug,
        correct: o.correct, first_try: !retry, ms: Math.max(0, now() - t0), hint_level: hintLevel,
        misconception: o.correct ? null : o.tag || null, plays,
      };
      if (q.unit) event.unit = q.unit;
      if (retry) event.retry = true;
      result = { correct: o.correct, grade: gradeOf({ correct: o.correct, firstTry: true, hintLevel }), event, explain: explainListen(q, i) };
      return result;
    },
  };
}

// ---------------------------------------------------------------- filler words

// The unit's textbook words, then the curriculum words that sound or look like the target (from the whole list, so
// quiet finds quite and quit). Meanings come from the word book or the offline dictionary, only for the explanation.
export function listenFiller(entry, app = {}) {
  const out = [];
  try {
    const cur = app.curriculum, dict = app.dict;
    const hw = headOf(entry);
    const cnOf = w => {
      try {
        const e = app.words && app.words.get ? app.words.get(slugify(w)) : null;
        if (e && e.brief_cn && !e.needs_core) return String(e.brief_cn);
        const d = dict && typeof dict.get === 'function' ? dict.get(w) : null;
        return d && d.cn ? d.cn : '';
      } catch (err) { return ''; }
    };
    const unit = (entry && entry.unit) || (cur && cur.unitOf ? cur.unitOf(hw) : null);
    const unitWords = unit && cur && cur.unitWords ? cur.unitWords(unit) : [];
    for (const x of unitWords) if (x && x.w && !x.phrase && !/\s/.test(x.w)) out.push({ slug: slugify(x.w), headword: x.w, cn: x.cn || cnOf(x.w), unit });
    const std = cur && typeof cur.standardWords === 'function' ? cur.standardWords() || [] : [];
    for (const w of nearWords(hw, [...unitWords.map(x => x && x.w), ...std])) out.push({ slug: slugify(w), headword: w, cn: cnOf(w) });
  } catch (e) { /* filler is optional */ }
  return out;
}

// ---------------------------------------------------------------- rendering

export function renderListen(container, q, { onAnswer, onDone, say, retry = false, autoNextMs = 800 } = {}) {
  const el = container;
  const attempt = createListenAttempt(q, { retry });
  let left = false, timer = 0;
  const next = () => {
    if (!attempt.done || left) return;
    left = true;
    clearTimeout(timer);
    if (onDone) onDone({ grade: attempt.grade, correct: attempt.correct, event: attempt.event });
  };
  const play = btn => {
    attempt.played();
    if (say) { try { say(q.say, btn || null); } catch (e) { /* sound is optional */ } }
  };

  const playBtn = h('button', { type: 'button', className: 'listen-play', 'aria-label': '再听一遍', on: { click: ev => play(ev.currentTarget) } },
    icon('speak'), h('span', { text: '再听一遍' }));
  const ask = h('p', { className: 'listen-ask small', text: '你听到的是哪个词？' });
  const hintBox = h('p', { className: 'listen-hint', lang: 'zh-CN', hidden: true });
  const feedback = h('p', { className: 'listen-feedback', role: 'status', 'aria-live': 'polite' });
  const buttons = q.options.map((o, i) => h('button', { type: 'button', className: 'listen-opt', lang: 'en', dataset: { i: String(i) }, text: o.text,
    on: { click: () => pick(i) } }));
  const list = h('div', { className: 'listen-options', role: 'group', 'aria-label': '选一个' }, buttons);
  const hintBtn = q.hint ? h('button', { type: 'button', className: 'text-btn accent listen-again', text: '看中文意思', on: { click: () => hint() } }) : null;
  const nextBtn = h('button', { type: 'button', className: 'btn listen-next', text: '下一个', hidden: true, on: { click: next } });
  const actions = h('div', { className: 'btn-row listen-actions' }, hintBtn, nextBtn);

  function hint() {
    if (attempt.done || !q.hint) return;
    attempt.hint();
    hintBox.textContent = q.hint.text;
    hintBox.hidden = false;
    if (hintBtn) hintBtn.hidden = true;
  }

  function pick(i) {
    const r = attempt.pick(i);
    if (!r) return;
    if (onAnswer) { try { onAnswer(r.event); } catch (e) { /* bookkeeping never blocks the answer */ } }
    buttons.forEach((b, k) => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); if (k === q.answer) b.classList.add(r.correct ? 'right' : 'reveal'); });
    if (hintBtn) hintBtn.hidden = true;
    if (r.correct) {
      feedback.textContent = attempt.hintLevel ? '对了。下次不看也能听出来。' : '对了。';
      el.classList.add('is-right');
      timer = setTimeout(next, autoNextMs);
    } else {
      buttons[i].classList.add('wrong');
      feedback.textContent = r.explain;
      el.classList.add('is-wrong');
      // she hears the right word once more
      if (say) { try { say(q.say, null); } catch (e) { /* sound is optional */ } }
      nextBtn.hidden = false;
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
    }
  }

  el.classList.add('listen');
  el.replaceChildren(h('div', { className: 'listen-q' }, playBtn, ask), hintBox, list, feedback, actions);

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const n = Number(ev.key);
    if (!attempt.done && n >= 1 && n <= q.options.length) { ev.preventDefault(); pick(n - 1); return; }
    if (!attempt.done && (ev.key === ' ' || low(ev.key) === 'r')) { ev.preventDefault(); play(playBtn); return; }
    if (attempt.done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); }
  }
  return { el, attempt, pick, hint, play, next, onKey };
}

export const listenMode = {
  id: MODE_ID,
  label: '听音选词',
  render(e, ctx = {}) {
    const app = ctx.app || {};
    const cur = app.curriculum;
    const known = w => {
      try { return !!(cur && ((cur.isPrimary && cur.isPrimary(w)) || (cur.unitOf && cur.unitOf(w)))); } catch (err) { return false; }
    };
    const q = makeListen(e, ctx.pool || [], { extra: ctx.extra || (() => listenFiller(e, app)), known, distractor: ctx.distractor || 'normal' });
    if (!q) return { ...choiceMode.render(e, ctx), modeId: 'mc4', eventMode: 'mc4' };
    const el = h('article', { className: 'listen' });
    const view = renderListen(el, q, {
      say: ctx.say, retry: isRetry(e), onAnswer: ctx.onAnswer,
      onDone: ({ grade }) => ctx.rate && ctx.rate(grade, { modeId: MODE_ID }),
    });
    // the first play; iPad may block sound without a tap, then she taps 再听一遍
    setTimeout(() => view.play(null), 0);
    return { el, footer: null, onKey: view.onKey, question: q, modeId: MODE_ID, eventMode: MODE_ID };
  },
};
