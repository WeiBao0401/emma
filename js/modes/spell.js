// 字母块拼写（DESIGN 5.1 的“写得出”线和语音小卡，v1）：看中文、听读音，把打乱的字母块拼回这个词。
// 负责：题型 agent（modes/spell.js、modes/listen.js、css/spell.css）。
//
// 出题规则
//   只给必会词出（entry.required 为 true；老词条没有这个字段时问 curriculum.isRequired）；短语、带连字符或
//   空格的、两个字母以内的不出（短语留给纸笔听写）。
//   分块：6 个字母以上、能分成两个以上音节的词按音节分块（sel·dom、re·mem·ber），别的按字母。
//   音节先用 phonics.js 的 syllables(word)（另一个 agent 在写，加载不到或结果对不上这个词就不用），
//   没有就用这里的 simpleSyllables 兜底。
//   干扰块：短词（4 个字母以内）或两块的词加 1 块，别的加 2 块。字母块用长得像、读得像、又不在这个词里的
//   字母（b / d、m / n、e / i）；音节块用常见拼错（漏双写 ca、多双写 sell、丢掉词尾不发音的 e、ck 写成 k、
//   tion 写成 sion、换一个元音 dum）。
//   摆满了（放下的块数等于要的块数）就自动判，拼出来的字母和这个词一样就对（大小写不管）。
//   第一次错：对的开头留着，其余退回去，给一句规律提示（phonics.js 的 missRule / hintFor(word, 她拼的)，没有就用
//   ruleHint）；第二次还错就显示答案。随时能点“看答案”。拼错的都经 phonics.recordMiss 记进 kv 'phonics.state'。
//   评分：一次拼对 3；错一次后拼对 2；看答案（含错两次）1（gradeOf）。
//
// 导出
//   MODE_ID = 'spell'（给 ctx.rate 的 modeId）；EVENT_MODE = 'tiles'（events 的 mode，events.MODES 里的名字）
//   SYL_MIN = 6；MAX_TRIES = 2；SPELL_CAP = 10（一节课最多拼几个，pickMode 用）
//   setPhonics(m) / phonicsReady               测试或接线时换 phonics 模块；phonicsReady 是动态加载的 Promise
//   simpleSyllables(word) -> [string]          兜底的分音节：拼起来就是原词，每块都有元音
//   syllablesOf(word) -> [string]              phonics.syllables 能用就用它，否则 simpleSyllables
//   canSpell(entry, curriculum?) -> bool
//   chunksFor(word) -> { kind: 'syllable' | 'letter', parts: [string] }
//   decoysFor(word, { kind, parts }, { rng, n }) -> [string]   干扰块，和真块都不一样
//   makeSpell(entry, { rng, curriculum, unit }) -> SpellQuestion | null   纯函数
//     SpellQuestion = { id: 'w:<slug>', slug, headword, unit, kind, parts, need: parts.length,
//                       tiles: [{ id: 't0', text, real: bool }]（已打乱，不会正好是答案的顺序）,
//                       prompt: { text: 中文意思, lang: 'zh-CN', say: 要读的英文 }, right: { headword, meaning, parts } }
//   ruleHint(word, typed) -> { id, kind: 'rule' | 'order' | 'memorize', text }   兜底的一句规律提示
//   spellHint(word, typed) -> { id, kind, text }   phonics.js 能用就用它的 missRule(word, typed)（或 hintFor）：
//                                            它说“只能死记”（null）时不给规律，只留“顺序再想想”“只有一个 l”这类提醒
//   noteMiss(word, wrong, kv) -> Promise        拼错一次就交给 phonics.recordMiss 记进 kv 'phonics.state'（没有就不记）
//   gradeOf({ correct, tries, revealed }) -> 1 | 2 | 3
//   createSpellAttempt(q, { now, retry }) -> 纯状态（不碰 DOM）
//     { tap(id), undo(), placed: [tile], bank: [tile], typed, full, check() -> Result, reveal() -> Result,
//       done, correct, grade, tries, hintLevel, hint, events }
//     Result = { correct, done, grade, event, hint, kept }
//     每判一次（和“看答案”）给一条 events 'answer' 的字段（type、sid、step 由调用方补）：
//       { item, slug, mode: 'tiles', choice: 她拼出来的, correct, first_try, ms, hint_level, misconception: null,
//         chunks: 'syllable' | 'letter', attempt: 第几次, spell_rule?: 规律 id, revealed?: true, unit?, retry? }
//   renderSpell(container, q, { onAnswer, onDone, onMiss, say, retry, autoNextMs, backMs }) -> { el, attempt, tap, undo, check,
//     reveal, next, onKey }
//     onAnswer(event) 每判一次调用；onMiss({ word, wrong }) 每拼错一次调用；onDone({ grade, correct, events }) 她往下走时调用一次
//   pickMode(entry, { index, spelled, spellCap, inScope, curriculum, now }) -> 'spell' | 'listen' | 'mc4'
//     题型按卡换：今天答错过的回到四选一（更容易）；开了“写得出”线（或在期中范围、见过一次以上）的必会词拼写，
//     一节课最多 spellCap 个；其余每三张有一张听音选词；别的四选一
//   spellMode = { id: 'spell', label: '字母块拼写', render(entry, ctx) -> { el, footer, onKey, question, modeId, eventMode } }
//     和 choiceMode 同一个接口；ctx = { app, rate(g, { modeId }), say, position, pool, extra?, onAnswer(ev)? }
//     出不了拼写题的词（不是必会词、是短语）退回四选一：返回 choiceMode.render 的结果，modeId 是 'mc4'
//
// 依赖：ui-dom.js（h、icon）、modes/choice.js（meaningOf、isRetry、choiceMode）、modes/listen.js（canListen）；
// phonics.js 动态加载（可以没有）。不直接写数据库：评分走 ctx.rate，事件走 ctx.onAnswer。
import { h, icon } from '../ui-dom.js';
import { meaningOf, isRetry, choiceMode } from './choice.js';
import { canListen } from './listen.js';

export const MODE_ID = 'spell';
export const EVENT_MODE = 'tiles';
export const SYL_MIN = 6;
export const MAX_TRIES = 2;
export const SPELL_CAP = 10;

// ---------------------------------------------------------------- phonics.js (written in parallel; optional)

let PH = null, injected = false;
export const phonicsReady = import('../phonics.js')
  .then(m => { if (!injected) PH = m; return m; })
  .catch(() => null);
export function setPhonics(m) { injected = true; PH = m || null; }

// ---------------------------------------------------------------- syllables (pure)

const VOW = new Set(['a', 'e', 'i', 'o', 'u']);
const DIGRAPHS = ['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng'];
const R_BLENDS = new Set(['br', 'cr', 'dr', 'fr', 'gr', 'pr', 'tr', 'wr']);
const ONSETS = new Set([...R_BLENDS, 'bl', 'cl', 'fl', 'gl', 'pl', 'st', 'sp', 'sc', 'sk']);
// compound words the rules would cut in the wrong place
const COMPOUNDS = Object.fromEntries(('everyone:every+one everybody:every+body everything:every+thing everyday:every+day '
  + 'classmate:class+mate classroom:class+room notebook:note+book textbook:text+book railway:rail+way '
  + 'yourself:your+self yourselves:your+selves ourselves:our+selves myself:my+self himself:him+self herself:her+self '
  + 'itself:it+self themselves:them+selves without:with+out into:in+to online:on+line handsome:hand+some '
  + 'volleyball:volley+ball basketball:basket+ball football:foot+ball homework:home+work housework:house+work '
  + 'something:some+thing sometimes:some+times someone:some+one somebody:some+body birthday:birth+day weekend:week+end '
  + 'playground:play+ground afternoon:after+noon grandmother:grand+mother grandfather:grand+father grandparent:grand+parent '
  + 'grandparents:grand+parents bedroom:bed+room bathroom:bath+room goodbye:good+bye today:to+day tonight:to+night '
  + 'maybe:may+be sunlight:sun+light lifetime:life+time teammate:team+mate website:web+site newspaper:news+paper '
  + 'anything:any+thing anyone:any+one nothing:no+thing outside:out+side inside:in+side careful:care+ful')
  .split(' ').map(x => { const [w, p] = x.split(':'); return [w, p.split('+')]; }));

const lettersOnly = w => /^[a-z]+$/i.test(w);

function isVowelAt(s, i) {
  const c = s[i], prev = s[i - 1], next = s[i + 1];
  if (VOW.has(c)) {
    if (c === 'u' && prev === 'q') return false;                                   // qu
    if (c === 'u' && prev === 'g' && i === 1 && next && VOW.has(next)) return false; // guitar, guess
    return true;
  }
  if (c === 'y') {
    if (i === 0) return false;                                                     // yes, you
    return !(next && VOW.has(next));                                               // happy, holiday; not player's y
  }
  if (c === 'w') return i > 0 && VOW.has(prev) && !(next && VOW.has(next));       // ow, aw, ew
  return false;
}

function units(c) {
  const out = [];
  for (let i = 0; i < c.length;) {
    const two = c.slice(i, i + 2);
    if (DIGRAPHS.includes(two)) { out.push(two); i += 2; } else { out.push(c[i]); i++; }
  }
  return out;
}

// how many consonant units stay with the syllable before
function keepBefore(u) {
  const n = u.length;
  if (n <= 0) return 0;
  if (n === 1) return ['ck', 'x', 'ng', 'gh'].includes(u[0]) ? 1 : 0;   // jack·et, tax·i, sing·er; else si·lent
  if (n === 2) return u[0] !== u[1] && R_BLENDS.has(u[0] + u[1]) ? 0 : 1; // se·cret, a·cross; car·ry, sel·dom
  if (['scr', 'spr', 'spl', 'thr', 'shr'].includes(u.join(''))) return 0;   // de·scribe
  if (ONSETS.has(u[n - 2] + u[n - 1])) return n - 2;                   // hun·dred, com·plete, mon·ster
  return n - 1;                                                         // part·ner, class·mate
}

// words the rules get wrong on their own
const SPLITS = { every: ['ev', 'ery'], people: ['peo', 'ple'], science: ['sci', 'ence'], diary: ['di', 'a', 'ry'], biology: ['bi', 'ol', 'o', 'gy'],
  geography: ['ge', 'og', 'ra', 'phy'], serious: ['se', 'ri', 'ous'], video: ['vi', 'de', 'o'], piano: ['pi', 'a', 'no'] };

function cutLower(s) {
  if (s.length < 3) return [s];
  if (SPLITS[s]) return SPLITS[s].slice();
  if (COMPOUNDS[s]) return COMPOUNDS[s].flatMap(cutLower);
  // -ing: teach·ing, swim·ming, writ·ing
  if (s.length >= 6 && s.endsWith('ing')) {
    const stem = s.slice(0, -3);
    if ([...stem].some((_, i) => isVowelAt(stem, i))) {
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && !VOW.has(stem[stem.length - 1])) {
        return [...cutLower(stem.slice(0, -1)), stem.slice(-1) + 'ing'];
      }
      return [...cutLower(stem), 'ing'];
    }
  }
  // -ly: real·ly, lone·ly, fa·mi·ly (not re·ply, ap·ply)
  if (s.length >= 5 && s.endsWith('ly')) {
    const stem = s.slice(0, -2);
    if (stem.length >= 3 && !stem.endsWith('p') && [...stem].some((_, i) => isVowelAt(stem, i))) return [...cutLower(stem), 'ly'];
  }
  // consonant + le: ap·ple, lit·tle, cir·cle, pick·le
  if (s.length >= 4 && /[^aeiouy]le$/.test(s)) {
    const ck = s.endsWith('ckle');
    const stem = ck ? s.slice(0, -2) : s.slice(0, -3), tail = ck ? 'le' : s.slice(-3);
    if ([...stem].some((_, i) => isVowelAt(stem, i))) return [...cutLower(stem), tail];
  }
  const vowel = [...s].map((_, i) => isVowelAt(s, i));
  // a final e after a consonant is silent (po·lite, sen·tence), as long as another vowel comes before it
  if (s.length >= 3 && s.endsWith('e') && !vowel[s.length - 2] && vowel.slice(0, -2).some(Boolean)) vowel[s.length - 1] = false;
  // and before a final s, unless the -es is a syllable of its own (selves, makes; but bus·es, box·es, pag·es)
  if (s.length >= 4 && /[^aeiou]es$/.test(s) && !/(s|x|z|ch|sh|c|g)es$/.test(s) && vowel.slice(0, -3).some(Boolean)) vowel[s.length - 2] = false;
  const groups = [];
  for (let i = 0; i < s.length; i++) {
    if (!vowel[i]) continue;
    if (groups.length && groups[groups.length - 1][1] === i) groups[groups.length - 1][1] = i + 1;
    else groups.push([i, i + 1]);
  }
  if (groups.length < 2) return [s];
  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const a = groups[g][1], b = groups[g + 1][0];
    const u = units(s.slice(a, b));
    const k = keepBefore(u);
    cuts.push(a + u.slice(0, k).join('').length);
  }
  const out = [];
  let last = 0;
  for (const c of cuts) { if (c > last) { out.push(s.slice(last, c)); last = c; } }
  out.push(s.slice(last));
  return out;
}

// the original letters (and case) cut at the same places
function recase(word, parts) {
  const out = [];
  let i = 0;
  for (const p of parts) { out.push(word.slice(i, i + p.length)); i += p.length; }
  return out;
}

export function simpleSyllables(word) {
  const w = String(word ?? '').trim();
  if (!w || !lettersOnly(w)) return w ? [w] : [];
  let parts = cutLower(w.toLowerCase());
  // every chunk carries a vowel; a chunk without one joins the one before (or after)
  const hasV = p => /[aeiouy]/i.test(p);
  const merged = [];
  for (const p of parts) {
    if (merged.length && (!hasV(p) || !hasV(merged[merged.length - 1]))) merged[merged.length - 1] += p;
    else merged.push(p);
  }
  parts = merged;
  return parts.join('') === w.toLowerCase() ? recase(w, parts) : [w];
}

export function syllablesOf(word) {
  const w = String(word ?? '').trim();
  try {
    if (PH && typeof PH.syllables === 'function') {
      const r = PH.syllables(w);
      const parts = Array.isArray(r) ? r.map(String) : typeof r === 'string' ? r.split(/[·•\s]+/) : null;
      if (parts && parts.length && parts.every(Boolean) && parts.join('').toLowerCase() === w.toLowerCase()) return recase(w, parts);
    }
  } catch (e) { /* phonics is optional */ }
  return simpleSyllables(w);
}

// ---------------------------------------------------------------- questions (pure)

const headOf = e => String((e && (e.headword || e.w || e.word)) || '').trim();
const low = s => String(s ?? '').toLowerCase();

export function canSpell(entry, curriculum) {
  const w = headOf(entry);
  if (!w || w.length < 3 || !lettersOnly(w) || (entry && entry.phrase)) return false;
  if (entry.required === true) return true;
  if (entry.required === false) return false;
  try { return !!(curriculum && typeof curriculum.isRequired === 'function' && curriculum.isRequired(w)); } catch (e) { return false; }
}

export function chunksFor(word) {
  const w = String(word ?? '').trim();
  const syl = w.length >= SYL_MIN ? syllablesOf(w) : [w];
  if (syl.length >= 2 && syl.every(p => p.length <= 6)) return { kind: 'syllable', parts: syl };
  return { kind: 'letter', parts: [...w] };
}

// letters that look or sound like the ones in the word
const LETTER_TWINS = { a: 'eu', e: 'ia', i: 'ey', o: 'ua', u: 'oa', b: 'dp', d: 'bt', p: 'bq', q: 'p', m: 'n', n: 'm', c: 'ks', k: 'c',
  s: 'cz', v: 'wf', w: 'v', g: 'j', j: 'g', l: 'r', r: 'l', t: 'd', f: 'v', h: 'n', y: 'i', x: 'k', z: 's' };
const SWAP_VOWEL = { a: 'e', e: 'i', i: 'e', o: 'u', u: 'o' };

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function decoysFor(word, { kind, parts }, { rng = Math.random, n = 1 } = {}) {
  const real = new Set(parts.map(low));
  const out = [];
  const add = t => { if (t && !real.has(low(t)) && !out.some(x => low(x) === low(t))) out.push(t); };
  if (kind === 'letter') {
    const inWord = new Set([...low(word)]);
    const twins = [];
    for (const c of new Set([...low(word)])) for (const t of LETTER_TWINS[c] || '') if (!inWord.has(t)) twins.push(t);
    for (const t of shuffle(twins, rng)) add(t);
    for (const t of shuffle(['a', 'e', 'i', 'o', 'u', 'r', 'n', 's', 't'], rng)) if (!inWord.has(t)) add(t);
    return out.slice(0, n);
  }
  // syllable chunks: the usual spelling slips first, then a swapped vowel
  const slips = [], vowels = [];
  parts.forEach((p, i) => {
    const l = low(p), next = low(parts[i + 1] || '');
    const end = l.slice(-1);
    if (next && l.length >= 2 && end === next[0] && !VOW.has(end)) slips.push(p.slice(0, -1));          // car·ry -> ca
    else if (next && /[bdfglmnprst]$/.test(l) && !/(.)\1$/.test(l)) slips.push(p + p.slice(-1));          // sel -> sell
    if (i === parts.length - 1 && l.length >= 3 && /[^aeiou]e$/.test(l)) slips.push(p.slice(0, -1));      // lite -> lit
    if (l.includes('ck')) slips.push(p.replace(/ck/i, 'k'));                                              // jack -> jak
    if (l === 'tion') slips.push('sion');
    if (/(er|or|ar)$/.test(l) && l.length >= 3) slips.push(p.slice(0, -2) + (l.endsWith('er') ? 'or' : 'er'));
    if (l.startsWith('ph')) slips.push('f' + p.slice(2));
    const m = l.match(/[aeiou]/);
    if (m) vowels.push(p.slice(0, m.index) + SWAP_VOWEL[m[0]] + p.slice(m.index + 1));
  });
  for (const t of shuffle(slips, rng)) add(t);
  for (const t of shuffle(vowels, rng)) add(t);
  return out.slice(0, n);
}

export function makeSpell(entry, { rng = Math.random, curriculum, unit } = {}) {
  if (!entry || !entry.slug || !canSpell(entry, curriculum)) return null;
  const headword = headOf(entry);
  const { kind, parts } = chunksFor(headword);
  if (parts.length < 2) return null;
  const n = parts.length <= 2 || (kind === 'letter' && headword.length <= 4) ? 1 : 2;
  const decoys = decoysFor(headword, { kind, parts }, { rng, n });
  const all = [...parts.map(text => ({ text, real: true })), ...decoys.map(text => ({ text, real: false }))];
  let tiles = shuffle(all, rng);
  // never hand her the answer already in order
  const inOrder = t => t.filter(x => x.real).map(x => x.text).join('') === parts.join('') && t.slice(0, parts.length).every(x => x.real);
  for (let k = 0; k < 6 && inOrder(tiles); k++) tiles = shuffle(all, rng);
  if (inOrder(tiles)) tiles.push(tiles.shift());
  tiles = tiles.map((t, i) => ({ id: 't' + i, ...t }));
  const meaning = meaningOf(entry);
  return {
    id: 'w:' + entry.slug,
    slug: entry.slug,
    headword,
    unit: unit || entry.unit || null,
    kind,
    parts,
    need: parts.length,
    tiles,
    prompt: { text: meaning, lang: 'zh-CN', say: headword },
    right: { headword, meaning, parts },
  };
}

// ---------------------------------------------------------------- the one-line rule after a wrong try

const ONE_SYL_E = /^[^aeiou]*([aeiou])[^aeiouvwxyr]e$/i;   // page, smile, hope; not have, give, more
const E_EXCEPT = new Set(['come', 'some', 'done', 'gone', 'none', 'one', 'lose', 'whose']);
const Y_I_EXCEPT = /(ply|fy|fly)$|^july$|^deny$|^rely$/i;
const syllableCount = w => simpleSyllables(w).length;

// [id, pattern, text]; a rule counts when the word has it and her spelling got that part wrong
const RULES = [
  ['double', /([bcdfgklmnprstz])\1/i, m => `${m[0]} 是两个 ${m[1]}，别漏了一个。`],
  ['ck', /ck/i, () => '短元音后面的 /k/ 常写成 ck，比如 back。'],
  ['tion', /(?<!s)tion/i, () => '词尾读 /ʃən/ 的，常写成 tion。'],
  ['le', /[^aeiouy]le$/i, () => '词尾读 /əl/ 的，这里写成 le，比如 apple、little。'],
  ['igh', /(?<!e)igh/i, () => 'igh 读 /aɪ/，gh 不发音，比如 night。'],
  ['ght', /ght/i, () => 'ght 里的 gh 不发音，但要写上。'],
  ['ph', /ph/i, () => 'ph 读 /f/，比如 photo。'],
  ['wh', /^wh(?!o)/i, () => 'wh 开头读 /w/，h 不发音，比如 what、where。'],
  ['wr', /^wr/i, () => 'wr 开头，w 不发音，比如 write。'],
  ['kn', /^kn/i, () => 'kn 开头，k 不发音，比如 know。'],
  ['qu', /qu/i, () => 'q 后面总跟着 u。'],
  ['ee', /ee(?!r|$)|^[a-z]{0,3}ee$/i, () => '这里的 /iː/ 写成 ee，比如 meet。'],
  ['y', /[^aeiou]y$/i, (m, w) => (syllableCount(w) <= 1 ? 'y 在词尾读 /aɪ/，比如 my、why。' : Y_I_EXCEPT.test(w) ? '' : '词尾读 /i/ 的，常写成 y，比如 happy。')],
  ['e', /[^aeiouy]e$/i, (m, w) => {
    if (syllableCount(w) > 1) return '词尾的 e 不发音，但要写上。';
    const v = w.match(ONE_SYL_E);
    return v && !E_EXCEPT.has(low(w)) ? `词尾的 e 不发音，但要写上。它让前面的 ${v[1]} 读字母本身的音。` : '词尾的 e 不发音，但要写上。';
  }],
];

const sortLetters = s => [...low(s)].sort().join('');

export function ruleHint(word, typed = '') {
  const w = String(word ?? '').trim(), t = low(typed);
  if (!w) return { id: null, kind: 'memorize', text: '' };
  // the letters are all there, only the order is off
  if (t && t !== low(w) && sortLetters(t) === sortLetters(w)) return { id: 'order', kind: 'order', text: '字母都对，顺序再想想。' };
  for (const [id, re, say] of RULES) {
    const m = w.match(re);
    if (!m) continue;
    if (t && t.indexOf(low(m[0])) === m.index && (id !== 'e' || t.length === w.length)) continue;  // she got this part right
    if (id === 'ght' && /(?<!e)igh/i.test(w)) continue;
    const text = say(m, w);
    if (text) return { id, kind: 'rule', text };
  }
  // a doubled letter the word does not have (sell·dom)
  const d = t.match(/([a-z])\1/);
  if (d && !low(w).includes(d[0])) return { id: 'single', kind: 'rule', text: `这里只有一个 ${d[1]}。` };
  return MEMORIZE;
}

const MEMORIZE = { id: null, kind: 'memorize', text: '这个词要多拼几次才记得住。' };

// phonics.js decides whether the slip follows a rule (missRule(word, wrong) -> { rule, kind, hint } | null, or
// hintFor(word, wrong) -> string | null). null there means memory work: no rule line, only the plain pointers
// (the letters are right but out of order; a doubled letter the word does not have). No phonics: ruleHint.
export function spellHint(word, typed = '') {
  try {
    if (PH && (typeof PH.missRule === 'function' || typeof PH.hintFor === 'function')) {
      let r = typeof PH.missRule === 'function' ? PH.missRule(word, typed) : PH.hintFor(word, typed);
      if (typeof r === 'string') r = { hint: r };
      const text = r && String(r.hint || r.text || '').trim();
      if (text) return { id: r.rule || r.id || null, kind: 'rule', text };
      const own = ruleHint(word, typed);
      return own.id === 'order' || own.id === 'single' ? own : MEMORIZE;
    }
  } catch (e) { /* phonics is optional */ }
  return ruleHint(word, typed);
}

// A slip that follows a rule goes into phonics.js's kv 'phonics.state' (flagged), so the weekly phonics card can pick
// the rule she trips on most. Never throws, never blocks; no phonics or no kv: nothing.
export function noteMiss(word, wrong, kv) {
  try {
    if (PH && typeof PH.recordMiss === 'function' && kv && wrong) return Promise.resolve(PH.recordMiss({ kv, word, wrong })).catch(() => null);
  } catch (e) { /* optional */ }
  return Promise.resolve(null);
}

// ---------------------------------------------------------------- attempt (pure state)

export const gradeOf = ({ correct, tries = 1, revealed = false } = {}) => (revealed || !correct ? 1 : tries <= 1 ? 3 : 2);

export function createSpellAttempt(q, { now = () => Date.now(), retry = false } = {}) {
  const t0 = now();
  const byId = new Map(q.tiles.map(t => [t.id, t]));
  let placed = [], tries = 0, hintLevel = 0, hint = null, result = null;
  const events = [];
  const typed = () => placed.map(id => byId.get(id).text).join('');
  const event = (correct, extra = {}) => {
    const ev = {
      item: q.id, slug: q.slug, mode: EVENT_MODE, choice: typed(), correct, first_try: !retry && tries <= 1 && !extra.revealed,
      ms: Math.max(0, now() - t0), hint_level: hintLevel, misconception: null, chunks: q.kind, attempt: Math.max(1, tries), ...extra,
    };
    if (q.unit) ev.unit = q.unit;
    if (retry) ev.retry = true;
    events.push(ev);
    return ev;
  };
  const finish = (correct, revealed, ev) => {
    result = { correct, done: true, grade: gradeOf({ correct, tries, revealed }), event: ev, hint, kept: placed.length, revealed };
    return result;
  };
  return {
    get placed() { return placed.map(id => byId.get(id)); },
    get bank() { return q.tiles.filter(t => !placed.includes(t.id)); },
    get typed() { return typed(); },
    get full() { return placed.length >= q.need; },
    get done() { return !!result; },
    get correct() { return result ? result.correct : null; },
    get grade() { return result ? result.grade : null; },
    get tries() { return tries; },
    get hintLevel() { return hintLevel; },
    get hint() { return hint; },
    get events() { return events.slice(); },
    get result() { return result; },
    // a tile in the bank goes to the end of her word; a placed one goes back
    tap(id) {
      if (result || !byId.has(id)) return false;
      if (placed.includes(id)) placed = placed.filter(x => x !== id);
      else if (placed.length < q.need) placed.push(id);
      else return false;
      return true;
    },
    undo() { if (result || !placed.length) return false; placed.pop(); return true; },
    check() {
      if (result || !placed.length) return null;
      tries++;
      const got = typed();
      const correct = low(got) === low(q.headword);
      if (correct) return finish(true, false, event(true));
      if (tries >= MAX_TRIES) {
        hintLevel = Math.max(hintLevel, 2);
        const ev = event(false, { revealed: true });
        return finish(false, true, ev);
      }
      // keep the right beginning, send the rest back, one line of rule
      hint = spellHint(q.headword, got);
      hintLevel = 1;
      const ev = event(false, hint.id ? { spell_rule: hint.id } : {});
      let k = 0;
      while (k < placed.length && k < q.parts.length && low(byId.get(placed[k]).text) === low(q.parts[k])) k++;
      placed = placed.slice(0, k);
      return { correct: false, done: false, grade: null, event: ev, hint, kept: k };
    },
    reveal() {
      if (result) return null;
      hintLevel = 2;
      return finish(false, true, event(false, { revealed: true }));
    },
  };
}

// ---------------------------------------------------------------- rendering

export function renderSpell(container, q, { onAnswer, onDone, onMiss, say, retry = false, autoNextMs = 900, backMs = 650 } = {}) {
  const el = container;
  const attempt = createSpellAttempt(q, { retry });
  let left = false, timer = 0, hold = false;
  const speak = (text, btn) => { if (text && say) { try { say(text, btn || null); } catch (e) { /* sound is optional */ } } };
  const next = () => {
    if (!attempt.done || left) return;
    left = true;
    clearTimeout(timer);
    if (onDone) onDone({ grade: attempt.grade, correct: attempt.correct, events: attempt.events });
  };
  const report = ev => { if (onAnswer && ev) { try { onAnswer(ev); } catch (e) { /* bookkeeping never blocks the answer */ } } };

  const sayBtn = h('button', { type: 'button', className: 'say spell-say', 'aria-label': '听一遍', on: { click: ev => speak(q.prompt.say, ev.currentTarget) } }, icon('speak'));
  const prompt = q.prompt.text
    ? h('p', { className: 'spell-prompt', lang: 'zh-CN' }, q.prompt.text, sayBtn)
    : h('p', { className: 'spell-prompt spell-prompt-listen' }, sayBtn, h('span', { text: '听读音' }));
  const ask = h('p', { className: 'spell-ask small', text: q.kind === 'syllable' ? '听一听，把音节块拼成这个词。' : '听一听，把字母拼成这个词。' });
  const answer = h('div', { className: 'spell-answer', role: 'group', 'aria-label': '你拼的词' });
  const bank = h('div', { className: 'spell-bank', role: 'group', 'aria-label': '字母块' });
  const hintBox = h('p', { className: 'spell-hint', hidden: true, role: 'note' });
  const feedback = h('p', { className: 'spell-feedback', role: 'status', 'aria-live': 'polite' });
  const revealBtn = h('button', { type: 'button', className: 'text-btn spell-reveal', text: '看答案', on: { click: () => reveal() } });
  const nextBtn = h('button', { type: 'button', className: 'btn spell-next', text: '下一个', hidden: true, on: { click: next } });
  const actions = h('div', { className: 'btn-row spell-actions' }, revealBtn, nextBtn);

  const bankBtns = new Map(q.tiles.map(t => [t.id, h('button', {
    type: 'button', className: 'spell-tile', lang: 'en', dataset: { id: t.id }, text: t.text, 'aria-label': t.text,
    on: { click: () => tap(t.id) },
  })]));

  function draw(state = '') {
    const placed = attempt.placed;
    const cells = placed.map(t => h('button', {
      type: 'button', className: 'spell-tile spell-placed' + (state ? ' ' + state : ''), lang: 'en', text: t.text,
      'aria-label': '拿掉 ' + t.text, disabled: attempt.done || hold, on: { click: () => tap(t.id) },
    }));
    for (let i = placed.length; i < q.need; i++) cells.push(h('span', { className: 'spell-slot', 'aria-hidden': 'true' }));
    answer.replaceChildren(...cells);
    for (const [id, b] of bankBtns) {
      const used = placed.some(t => t.id === id);
      b.classList.toggle ? b.classList.toggle('used', used) : (used ? b.classList.add('used') : b.classList.remove('used'));
      b.disabled = used || attempt.done || hold;
      b.setAttribute('aria-hidden', used ? 'true' : 'false');
    }
  }

  function tap(id) {
    if (attempt.done || hold) return;
    if (!attempt.tap(id)) return;
    el.classList.remove('is-wrong');
    draw();
    if (attempt.full) check();
  }

  function undo() {
    if (attempt.done || hold) return;
    if (attempt.undo()) draw();
  }

  function showRight(r) {
    el.classList.add('is-right');
    draw('right');
    feedback.textContent = r.grade === 3 ? '拼对了。' : '对了。';
    revealBtn.hidden = true;
    speak(q.headword);
    timer = setTimeout(next, autoNextMs);
  }

  function showAnswer() {
    el.classList.add('is-revealed');
    answer.replaceChildren(...q.parts.map(p => h('span', { className: 'spell-tile spell-placed reveal', lang: 'en', text: p })));
    for (const b of bankBtns.values()) b.disabled = true;
    feedback.textContent = `是 ${q.kind === 'syllable' ? q.parts.join('·') : q.headword}。` + (q.right.meaning ? `“${q.right.meaning}”。` : '');
    revealBtn.hidden = true;
    nextBtn.hidden = false;
    speak(q.headword);
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
  }

  function check() {
    const wrongIds = attempt.placed.map(t => t.id);
    const r = attempt.check();
    if (!r) return;
    report(r.event);
    if (r.correct) { showRight(r); return; }
    if (onMiss) { try { onMiss({ word: q.headword, wrong: r.event.choice }); } catch (e) { /* bookkeeping never blocks the answer */ } }
    if (r.done) { showAnswer(); return; }
    // first slip: the wrong tiles show for a moment, then go back; the right beginning stays
    el.classList.add('is-wrong');
    hintBox.textContent = (r.kept ? '对的留着了。' : '') + (r.hint && r.hint.text ? r.hint.text : '再听一遍，接着拼。');
    hintBox.hidden = false;
    feedback.textContent = '';
    const back = () => { hold = false; draw(); };
    if (backMs > 0) {
      hold = true;
      // show what she put down, the kept beginning plain and the rest marked
      answer.replaceChildren(...wrongIds.map((id, i) => h('span', { className: 'spell-tile spell-placed' + (i >= r.kept ? ' wrong' : ''), lang: 'en', text: q.tiles.find(t => t.id === id).text })));
      timer = setTimeout(back, backMs);
    } else back();
  }

  function reveal() {
    if (attempt.done) return;
    clearTimeout(timer);
    hold = false;
    const r = attempt.reveal();
    if (!r) return;
    report(r.event);
    showAnswer();
  }

  el.classList.add('spell');
  el.classList.add(q.kind === 'syllable' ? 'spell-syllable' : 'spell-letter');
  bank.replaceChildren(...bankBtns.values());
  el.replaceChildren(h('div', { className: 'spell-q' }, prompt, ask), answer, bank, hintBox, feedback, actions);
  draw();

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (attempt.done) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); next(); } return; }
    if (ev.key === 'Backspace') { ev.preventDefault(); undo(); return; }
    if (/^[a-z]$/i.test(ev.key || '')) {
      const t = attempt.bank.find(x => low(x.text).startsWith(low(ev.key)));
      if (t) { ev.preventDefault(); tap(t.id); }
    }
  }
  return { el, attempt, tap, undo, check, reveal, next, onKey };
}

// ---------------------------------------------------------------- which mode for this card

export function pickMode(entry, { index = 0, spelled = 0, spellCap = SPELL_CAP, inScope = false, curriculum, now = new Date() } = {}) {
  if (!entry || isRetry(entry, now)) return 'mc4';
  const reps = (entry.fsrs && entry.fsrs.reps) || 0;
  if ((entry.write || (inScope && reps >= 1)) && spelled < spellCap && canSpell(entry, curriculum)) return MODE_ID;
  if (index % 3 === 2 && reps >= 1 && canListen(entry)) return 'listen';
  return 'mc4';
}

export const spellMode = {
  id: MODE_ID,
  label: '字母块拼写',
  render(e, ctx = {}) {
    const app = ctx.app || {};
    const q = makeSpell(e, { curriculum: app.curriculum });
    if (!q) return { ...choiceMode.render(e, ctx), modeId: 'mc4', eventMode: 'mc4' };
    const el = h('article', { className: 'spell' });
    const view = renderSpell(el, q, {
      say: ctx.say, retry: isRetry(e), onAnswer: ctx.onAnswer,
      onMiss: ({ word, wrong }) => noteMiss(word, wrong, app.kv),
      onDone: ({ grade }) => ctx.rate && ctx.rate(grade, { modeId: MODE_ID }),
    });
    // iPad may block sound without a tap; then she taps the speaker
    if (ctx.say) setTimeout(() => { try { ctx.say(q.prompt.say, null); } catch (err) { /* sound is optional */ } }, 0);
    return { el, footer: null, onKey: view.onKey, question: q, modeId: MODE_ID, eventMode: EVENT_MODE };
  },
};
