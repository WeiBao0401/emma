// 词性（Wei 10-26）：老师要她把词背下来、会写，还要知道它是名词还是动词。只认得意思不算会。
// 这里有三样：
//   1. 词性小卡：每个词性是干什么的、一个记得住的画面、怎么认、试一试（curriculum/pos-guide.json）
//   2. 词性题：给一个词选词性（看着它的中文选）；给一句话里画线的词选词性（看它在句子里干什么）
//   3. 看中文和词性写出英文：字母块拼写（modes/spell.js），题面上多一行“n. 名词”（posSpellMode）
// 负责：词性 agent（pos.js、curriculum/pos-guide.json、tests/pos.test.mjs）。
//
// 一个词的词性从哪来（posInfo，先到先用）
//   词条 book_pos（拍课本时书上印的）→ 词条 pos → 讲解的 senses[0].pos（提示词让课本义项在前）
//   → 课标详表 curriculum.posOf（kebiao.json，curriculum.loadDetails 以后才有）只列一个词性时
//   → brief_cn 开头的“n.”（离线词典的写法）。
//   课标详表列了好几个词性、词条又没说是哪个的（like：v. 喜欢、prep. 像），不出“给词选词性”的题：看中文也说不清。
//   显示的时候照样列出来（“也可以作介词”）。aux（can、must 这类情态动词）和短语不出题。
//
// 一道词性题怎么走（createPosAttempt）
//   四个选项都是词性（“名词 n.”），对的那个加三个她最容易混的（名词和动词、形容词和副词……）；给一个词的题，这个词
//   别的词性不当干扰项（water 也能作动词，就不放动词）。第一次选错：那个选项划掉，给一句提示（“不是动词：I can cat
//   说不通。想一想：cat 是一个人、动物、东西或地方的名字吗？”），再选；第二次还错就给出答案。
//   评分：一次就对 3，第二次对 2，给出答案 1。做完一定给“为什么”（句子题的 why，或者“my cat，说得通”）、
//   一个画面（巧记）和词尾规律（-ous 结尾多半是形容词；lonely 是 -ly 结尾的形容词，要单独记），点“名词怎么认”看整张小卡。
//
// 事件（不加新类型）
//   answer：{ type: 'answer', item: 'pos:w:<slug>' | 'pos:s:<句子 id>', mode: 'pos', kind: 'word' | 'sentence', pos: 对的词性,
//            choice: 她选的词性, correct, first_try, ms, hint_level, misconception: null, word: 这个词, sentence?: 句子 id,
//            unit? }，结束的那条另带 done: true、grade。不带 slug：词性题不算进单词的“认得 / 会写了”。
//   hint：{ type: 'hint', item, mode: 'pos', level: 1, auto: true }
//   “看中文和词性写出英文”记的是字母块拼写自己的事件（mode 'tiles'，item 'w:<slug>'，带 slug），另加 pos 字段。
//
// 导出
//   FILE、MODE = 'pos'、KINDS（10 个词性，顺序同 pos-guide.json order）、ZH、ABBR、ASKABLE、SECONDS = { word: 12, sentence: 18, write: 30 }
//   normPos(x) -> 'n' | 'v' | 'adj' | 'adv' | 'pron' | 'prep' | 'art' | 'num' | 'conj' | 'int' | 'aux' | 'phrase' | ''
//                认 'n.'、'vt.'、'adj.'、'a.'、'ad.'、'interj.'、'名词' 这些写法
//   setGuide(data) -> Guide；guide() -> Guide | null；loadGuide({ fetchJSON }) -> Promise<Guide | null>（读不到返回 null，不抛错）
//   loadPos(ctx) -> Promise<Guide | null>   读小卡，顺带 ctx.curriculum.loadDetails()（课标详表的词性）
//   ensureDetails(ctx) -> Promise            只读课标详表，读过就算了，从不抛错
//   kindInfo(kind, guide?) -> { kind, zh, abbr, what, image, tip, try, frame, check, examples }（小卡没读到时只有 zh、abbr、what）
//   posLabel(kind) -> '名词 n.'
//   posInfo(entry, { curriculum, headword }) -> { main, all: [kind], from: 'book' | 'entry' | 'sense' | 'kebiao' | 'cn' | '', phrase }
//   wordPos(entry, opts) -> main | ''
//   posLine(entry, { curriculum, guide }) -> { main, abbr, zh, label, what, image, tip, also: [kind], alsoText } | null
//       单词卡、听写用：main 没定下来但课标详表有的，main 用详表的第一个、also 是其余的
//   suffixTip(word, kind, guide?) -> '' | 一句（-ous 结尾多半是形容词；lonely 这种例外也说）
//   frameLine(kind, word, guide?) -> '' | 'my cat'
//   wordItem(entry, { curriculum }) -> PosItem | null；sentenceItem(s) -> PosItem
//   weakKinds(events, { now, days = 21 }) -> [kind]   最近第一次就选错的词性（对的那个），错得多的在前
//   posItems({ words, entryOf, curriculum, guide, n = 4, seed = 0, wordShare = 0.5, skip, events, now }) -> [PosItem]
//       一份题：给词的题从 words 里挑（只挑词性定得下来的，排在前面的先），其余是句子题；词性轮着来，她错过的词性先，
//       同一个 seed（一般是日子）结果一样，换一天换一批句子。PosItem = { id, item, mode: 'pos', kind: 'word' | 'sentence',
//       slug?（给词的题）, sid?（句子题）, w, pos, zh? }
//   writeItem(entry, { curriculum }) -> PosItem（kind 'write'，item 'w:<slug>'）| null   “看中文和词性写出英文”，renderPos 也能画
//   optionsFor(right, { exclude, rng }) -> [kind × 4]
//   makePosQuestion(item, { entryOf, curriculum, guide, rng }) -> PosQuestion | null
//       PosQuestion = { id, item, kind, w, slug?, sid?, pos, options: [kind], answer: 下标, prompt: { en, mark: { start, end } | null,
//                       zh, say }, ask, why, image, tip, unit? }
//   createPosAttempt(q, { now }) -> { pick(i) -> Result | null, done, correct, grade, tries, hintLevel, wrong: Set<下标>, events }
//       Result = { correct, done, grade, event, hint: '' | 一句 }
//   renderPosQuestion(container, q, { onAnswer, onDone, say, guide, autoNextMs }) -> { el, attempt, pick, next, onKey }
//   renderPos(container, ctx, { items, sid, step, onDone, onAnswer?, autoNextMs }) -> { el, onKey, stop }
//       一组词性题（和 modes/forms.js renderForms 一个叫法）：每题自己记 answer / hint 事件（ctx.events.log，补上 sid、step），
//       onDone({ done: true, results: [{ id, item, kind, pos, choice, correct, clean, grade }], right })
//   makePosSpell(entry, { curriculum, rng }) -> SpellQuestion（spell.js makeSpell 的）加 pos | null
//   posSpellMode = { id: 'spell', label, render(entry, ctx) }   和 spellMode 同一个接口：字母块题面多一行“n. 名词：写出这个名词”，
//       事件多 pos；出不了拼写题照样退回四选一（spellMode 自己退）
//   canSpell   spell.js 的，转出来给单词本“练一下”用
//
// 样式：借四选一的 mc4- 类（choice.css）、画线借 ord-mark（order.css）、词性缩写用全局的 .pos，不加新 CSS 文件。
import { h, icon } from './ui-dom.js';
import { meaningOf } from './modes/choice.js';
import * as S from './modes/spell.js';

export const FILE = 'curriculum/pos-guide.json';
export const MODE = 'pos';
export const KINDS = ['n', 'v', 'adj', 'adv', 'pron', 'prep', 'art', 'num', 'conj', 'int'];
export const ZH = { n: '名词', v: '动词', adj: '形容词', adv: '副词', pron: '代词', prep: '介词', art: '冠词', num: '数词', conj: '连词', int: '感叹词', aux: '情态动词' };
export const ABBR = { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', pron: 'pron.', prep: 'prep.', art: 'art.', num: 'num.', conj: 'conj.', int: 'interj.', aux: 'v.' };
export const ASKABLE = new Set(KINDS);
export const SECONDS = { word: 12, sentence: 18, write: 30 };
export const canSpell = S.canSpell;

// what each kind is for, when pos-guide.json is not there (the labels still work)
const WHAT = { n: '人、动物、东西、地方的名字。', v: '说“做什么”的词。', adj: '说人或东西“怎么样”。', adv: '说动作“怎么做”“多常做”，或者“有多……”。',
  pron: '代替名词的词。', prep: '放在名词前面，说在哪里、什么时候、和谁一起。', art: '名词前面的 a、an、the。', num: '说“几个”或者“第几”。',
  conj: '把两个词或者两句话连起来。', int: '一下子喊出来的一声。', aux: '放在动词前面，说“能、会、必须”。' };
// the kinds she mixes up most, for the three wrong options
const CONFUSE = { n: ['v', 'adj', 'pron'], v: ['n', 'adj', 'adv'], adj: ['adv', 'n', 'v'], adv: ['adj', 'v', 'prep'], pron: ['n', 'art', 'adj'],
  prep: ['adv', 'conj', 'v'], art: ['pron', 'num', 'adj'], num: ['adj', 'n', 'art'], conj: ['prep', 'adv', 'pron'], int: ['adv', 'n', 'pron'] };
const CORE = ['n', 'v', 'adj', 'adv'];
const MINOR = ['pron', 'prep', 'conj', 'num', 'art', 'int'];

const arr = x => (Array.isArray(x) ? x : []);
const str = x => (x == null ? '' : String(x));
const low = x => str(x).trim().toLowerCase();
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { return undefined; } };
const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rot = (list, k) => { if (!list.length) return list.slice(); const s = ((k % list.length) + list.length) % list.length; return [...list.slice(s), ...list.slice(0, s)]; };

// ---------------------------------------------------------------- names of the kinds

const POS_RE = [[/^(n|noun|名词)$/, 'n'], [/^(v|vt|vi|verb|动词)$/, 'v'], [/^(aux|modal|助动词|情态动词)$/, 'aux'], [/^(adj|a|形容词)$/, 'adj'],
  [/^(adv|ad|副词)$/, 'adv'], [/^(pron|代词)$/, 'pron'], [/^(prep|介词)$/, 'prep'], [/^(art|冠词)$/, 'art'], [/^(num|数词)$/, 'num'],
  [/^(conj|连词)$/, 'conj'], [/^(int|interj|excl|感叹词|叹词)$/, 'int'], [/^(phrase|phr|短语)$/, 'phrase']];
export function normPos(x) {
  const t = low(x).replace(/[.。]+$/, '');
  if (!t) return '';
  for (const [re, k] of POS_RE) if (re.test(t)) return k;
  return '';
}
// 'n./v.' / ['n.', 'v.'] / 'adj. & adv.' -> ['n', 'v']
function splitPos(x) {
  if (Array.isArray(x)) return x.flatMap(splitPos);
  return str(x).split(/[\s/&,，、;；]+|\.(?=[a-z])/i).map(normPos).filter(Boolean);
}

// ---------------------------------------------------------------- the guide (curriculum/pos-guide.json)

let G = null;
export function setGuide(data) {
  if (!data || typeof data !== 'object' || !data.kinds) { G = null; return null; }
  const kinds = {};
  for (const k of KINDS) kinds[k] = { kind: k, zh: ZH[k], abbr: ABBR[k], what: WHAT[k], ...(data.kinds[k] || {}) };
  const sentences = arr(data.sentences).filter(s => s && s.id && s.en && s.w && KINDS.includes(s.pos)).map(s => ({ ...s, mark: markOf(s.en, s.w, s.at) }))
    .filter(s => s.mark);
  G = { version: data.version || 1, order: arr(data.order).length ? data.order.slice() : KINDS.slice(), kinds, sentences,
    suffixes: arr(data.suffixes).filter(x => x && x.end && x.pos), traps: arr(data.traps).filter(x => x && x.end && x.pos),
    sentence: id => sentences.find(s => s.id === id) || null };
  return G;
}
export const guide = () => G;
export async function loadGuide({ fetchJSON } = {}) {
  if (G) return G;
  try { return setGuide(await fetchJSON(FILE)); } catch (e) { return null; }
}
export async function ensureDetails(ctx) {
  try { const c = ctx && ctx.curriculum; if (c && typeof c.loadDetails === 'function') await c.loadDetails(); } catch (e) { /* the textbook POS just stays unknown */ }
}
export async function loadPos(ctx) {
  const [g] = await Promise.all([loadGuide({ fetchJSON: ctx && ctx.fetchJSON }), ensureDetails(ctx)]);
  return g;
}

export function kindInfo(kind, g = null) {
  const k = kind === 'aux' ? 'aux' : KINDS.includes(kind) ? kind : '';
  if (!k) return null;
  const gg = g || G;
  const base = { kind: k, zh: ZH[k], abbr: ABBR[k], what: WHAT[k], image: '', tip: '', try: '', frame: '', check: '', examples: [] };
  return gg && gg.kinds[k] ? { ...base, ...gg.kinds[k] } : base;
}
export const posLabel = kind => (ZH[kind] ? `${ZH[kind]} ${ABBR[kind]}` : '');

// ---------------------------------------------------------------- one word's part of speech

const headOf = (e, hw) => str(hw || (e && (e.headword || e.w || e.word || e.slug))).trim();
export function posInfo(e, { curriculum = null, headword = '' } = {}) {
  const hw = headOf(e, headword);
  const out = { main: '', all: [], from: '', phrase: false };
  if (!hw) return out;
  if (/\s/.test(hw) || (e && e.phrase)) { out.phrase = true; return out; }
  const add = (list, from, setMain = true) => {
    for (const k of list) {
      if (k === 'phrase') continue;
      if (!out.all.includes(k)) out.all.push(k);
      if (setMain && !out.main && k !== 'aux') { out.main = k; out.from = from; }
    }
  };
  if (e) {
    add(splitPos(e.book_pos), 'book');
    add(splitPos(e.pos), 'entry');
    const senses = arr(e.senses).filter(s => s && s.pos);
    if (senses.length) { add(splitPos(senses[0].pos), 'sense'); add(senses.slice(1).flatMap(s => splitPos(s.pos)), 'sense', false); }
  }
  const kb = splitPos(call(curriculum && curriculum.posOf, hw) || []);
  const kbMain = [...new Set(kb.filter(k => k !== 'aux'))];
  add(kb, 'kebiao', kbMain.length === 1 && !kb.includes('aux'));
  if (!out.main && e) {
    const m = str(e.brief_cn || e.cn).match(/^\s*([a-z]+)\.\s/i);
    if (m) add(splitPos(m[1]), 'cn');
  }
  if (!out.main && out.all.length === 1 && out.all[0] !== 'aux') { out.main = out.all[0]; out.from = out.from || 'kebiao'; }
  return out;
}
export const wordPos = (e, opts) => posInfo(e, opts).main;

export function posLine(e, { curriculum = null, guide: g = null, headword = '' } = {}) {
  const info = posInfo(e, { curriculum, headword });
  const main = info.main || info.all.find(k => k !== 'aux') || info.all[0] || '';
  if (!main) return null;
  const k = kindInfo(main, g);
  const also = info.all.filter(x => x !== main && x !== 'aux');
  const hw = headOf(e, headword);
  return { main, sure: !!info.main, abbr: k.abbr, zh: k.zh, label: posLabel(main), what: k.what, image: k.image || '',
    tip: suffixTip(hw, main, g), also, alsoText: also.length ? `也可以作${also.map(x => ZH[x]).join('、')}。` : '' };
}

export function suffixTip(word, kind, g = null) {
  const gg = g || G;
  const w = low(word);
  if (!gg || !w || !/^[a-z]+$/.test(w)) return '';
  for (const t of gg.traps) if (w.endsWith(t.end) && w.length >= t.end.length + 3 && t.pos === kind) return str(t.say).replace(/\{w\}/g, w);
  for (const s of gg.suffixes) if (w.endsWith(s.end) && w.length >= s.end.length + 3 && s.pos === kind) return `${w} 是 -${s.end} 结尾，${s.say}。`;
  return '';
}
export function frameLine(kind, word, g = null) {
  const k = kindInfo(kind, g);
  const w = str(word).trim();
  return k && k.frame && /^[A-Za-z]+$/.test(w) ? k.frame.replace(/\{w\}/g, w === 'I' ? w : w.toLowerCase()) : '';
}

// ---------------------------------------------------------------- the items

function markOf(en, w, at = 0) {
  const s = str(en), t = str(w);
  if (!s || !t) return null;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const flags of ['g', 'gi']) {
    const re = new RegExp(`(^|[^A-Za-z'’])(${esc})(?=[^A-Za-z]|$)`, flags);
    let m, k = 0;
    while ((m = re.exec(s))) {
      const start = m.index + m[1].length;
      if (k++ === (at || 0)) return { start, end: start + m[2].length };
      re.lastIndex = start + 1;
    }
  }
  return null;
}
const shortZh = e => Array.from(str(meaningOf(e)).replace(/^\s*(?:[a-z]+\.\s*)+/i, '').split(/[；;\n]/)[0].trim()).slice(0, 16).join('');

export function wordItem(e, { curriculum = null } = {}) {
  if (!e || !e.slug) return null;
  const w = headOf(e);
  if (!/^[A-Za-z]+$/.test(w)) return null;
  const pos = wordPos(e, { curriculum });
  if (!ASKABLE.has(pos)) return null;
  const zh = shortZh(e);
  if (!zh) return null;
  const item = 'pos:w:' + e.slug;
  return { id: item, item, mode: MODE, kind: 'word', slug: e.slug, w, pos, zh, ...(e.unit ? { unit: e.unit } : {}) };
}
export function sentenceItem(s) {
  if (!s || !s.id) return null;
  const item = 'pos:s:' + s.id;
  return { id: item, item, mode: MODE, kind: 'sentence', sid: s.id, w: s.w, pos: s.pos };
}
export function writeItem(e, { curriculum = null } = {}) {
  if (!e || !e.slug) return null;
  const item = 'w:' + e.slug;
  return { id: item, item, mode: MODE, kind: 'write', slug: e.slug, w: headOf(e), pos: wordPos(e, { curriculum }) };
}

export function weakKinds(events = [], { now = new Date(), days = 21 } = {}) {
  const since = now.getTime() - days * 864e5;
  const n = {};
  for (const e of arr(events)) {
    if (!e || e.type !== 'answer' || e.mode !== MODE || e.correct !== false || e.first_try === false || !KINDS.includes(e.pos)) continue;
    const t = new Date(e.at).getTime();
    if (Number.isFinite(t) && (t < since || t > now.getTime())) continue;
    n[e.pos] = (n[e.pos] || 0) + 1;
  }
  return Object.keys(n).sort((a, b) => n[b] - n[a] || KINDS.indexOf(a) - KINDS.indexOf(b));
}

// the order the kinds come round in: the ones she got wrong, then the four big ones (turned by the day), then the small ones;
// on odd days one small kind comes in third, so pronouns and prepositions are not left out of a four-question set
function kindOrder(seed, weak = []) {
  const core = rot(CORE, seed), minor = rot(MINOR, Math.floor(seed / 2));
  const base = seed % 2 ? [core[0], core[1], minor[0], core[2], core[3], ...minor.slice(1)] : [...core, ...minor];
  return [...new Set([...weak.filter(k => KINDS.includes(k)), ...base])];
}
// k items from list, one kind at a time in `order`; kinds in `later` wait until the others have had their turn
function spread(list, k, order, later = new Set()) {
  if (k <= 0 || !list.length) return [];
  const by = new Map(order.map(x => [x, []]));
  for (const it of list) { if (!by.has(it.pos)) by.set(it.pos, []); by.get(it.pos).push(it); }
  const kinds = [...by.keys()];
  const seq = [...kinds.filter(x => !later.has(x)), ...kinds.filter(x => later.has(x))];
  const out = [];
  for (let round = 0; out.length < k && seq.some(x => by.get(x).length); round++) {
    for (const x of seq) { if (out.length >= k) break; const q = by.get(x); if (q.length) out.push(q.shift()); }
  }
  return out;
}

export function posItems({ words = [], entryOf = null, curriculum = null, guide: g0 = null, n = 4, seed = 0, wordShare = 0.5, skip = [], events = [], now = new Date() } = {}) {
  if (!(n > 0)) return [];
  const g = g0 || G;
  const skipSet = new Set(arr(skip));
  const weak = weakKinds(events, { now });
  const order = kindOrder(Math.abs(Math.floor(seed)) || 0, weak);
  const seen = new Set();
  const wItems = [];
  for (const w of arr(words)) {
    if (!w) continue;
    const slug = typeof w === 'string' ? w : w.slug;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const e = (typeof entryOf === 'function' ? call(entryOf, slug) : null) || (typeof w === 'object' ? w : null);
    const it = wordItem(e, { curriculum });
    if (it && !skipSet.has(it.item)) wItems.push(it);
  }
  const sItems = g ? rot(g.sentences, Math.abs(Math.floor(seed)) * 3).map(sentenceItem).filter(it => it && !skipSet.has(it.item)) : [];
  const wantW = sItems.length ? Math.min(wItems.length, Math.round(n * wordShare)) : Math.min(wItems.length, n);
  const pickW = spread(wItems, wantW, order);
  // the sentences bring the kinds the words did not
  const pickS = spread(sItems, n - pickW.length, order, new Set(pickW.map(x => x.pos)));
  const moreW = pickW.length + pickS.length < n ? spread(wItems.filter(x => !pickW.includes(x)), n - pickW.length - pickS.length, order) : [];
  const W = [...pickW, ...moreW];
  const out = [];
  for (let i = 0; out.length < W.length + pickS.length; i++) { if (W[i]) out.push(W[i]); if (pickS[i]) out.push(pickS[i]); }
  return out.slice(0, n);
}

// ---------------------------------------------------------------- one question

export function optionsFor(right, { exclude = [], rng = Math.random } = {}) {
  const ex = new Set([right, ...arr(exclude)]);
  const pick = [];
  for (const k of [...(CONFUSE[right] || []), ...CORE, ...MINOR]) { if (pick.length >= 3) break; if (!ex.has(k) && !pick.includes(k)) pick.push(k); }
  const out = [right, ...pick];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function makePosQuestion(item, { entryOf = null, curriculum = null, guide: g0 = null, rng = Math.random } = {}) {
  if (!item) return null;
  const g = g0 || G;
  if (item.kind === 'sentence') {
    const s = g && g.sentence(item.sid || String(item.item || '').replace(/^pos:s:/, ''));
    if (!s) return null;
    const options = optionsFor(s.pos, { exclude: s.not, rng });
    return { id: item.item || 'pos:s:' + s.id, item: item.item || 'pos:s:' + s.id, kind: 'sentence', sid: s.id, w: s.w, pos: s.pos, options, answer: options.indexOf(s.pos),
      prompt: { en: s.en, mark: s.mark, zh: s.zh || '', say: s.en }, ask: '画线的词在这句话里是什么词性？', why: s.why || '' };
  }
  if (item.kind === 'word') {
    const e = (item.slug && typeof entryOf === 'function' ? call(entryOf, item.slug) : null) || item.entry || null;
    const info = e ? posInfo(e, { curriculum }) : { main: item.pos, all: [item.pos] };
    const pos = info.main || item.pos;
    if (!ASKABLE.has(pos)) return null;
    const w = (e && headOf(e)) || item.w;
    const zh = (e && shortZh(e)) || item.zh || '';
    const options = optionsFor(pos, { exclude: info.all, rng });
    const frame = frameLine(pos, w, g);
    const k = kindInfo(pos, g);
    return { id: item.item, item: item.item, kind: 'word', slug: item.slug, w, pos, options, answer: options.indexOf(pos),
      prompt: { en: w, mark: null, zh, say: w }, ask: `${w} 是什么词性？`, why: frame ? `${frame}，说得通。` : `${k.zh}是${k.what}`,
      ...(item.unit || (e && e.unit) ? { unit: item.unit || e.unit } : {}) };
  }
  return null;
}

export function hintFor(q, choice, g = null) {
  const k = kindInfo(q.pos, g);
  const c = kindInfo(choice, g);
  if (!k || !c) return '';
  const frame = q.kind === 'word' ? frameLine(choice, q.w, g) : '';
  const head = frame ? `不是${c.zh}：${frame} 说不通。` : `不是${c.zh}。`;
  const check = k.check || '';
  if (!check) return head + '再想想。';
  return `${head}想一想：${q.kind === 'sentence' ? '画线的 ' : ''}${q.w} ${check}`;
}

export function createPosAttempt(q, { now = () => Date.now(), guide: g = null } = {}) {
  const t0 = now();
  const wrong = new Set();
  const events = [];
  const st = { done: false, correct: false, grade: 0, tries: 0, hintLevel: 0, wrong, events, choice: '' };
  st.pick = i => {
    if (st.done || wrong.has(i) || !(i >= 0 && i < q.options.length)) return null;
    st.tries++;
    const ok = i === q.answer;
    const choice = q.options[i];
    st.choice = choice;
    const ev = { type: 'answer', item: q.item, mode: MODE, kind: q.kind, pos: q.pos, choice, correct: ok, first_try: st.tries === 1, ms: now() - t0,
      hint_level: st.hintLevel, misconception: null, word: q.w, ...(q.sid ? { sentence: q.sid } : {}), ...(q.unit ? { unit: q.unit } : {}) };
    let hint = '';
    if (ok) { st.done = true; st.correct = true; st.grade = st.tries === 1 ? 3 : 2; Object.assign(ev, { done: true, grade: st.grade }); }
    else if (st.tries >= 2) { st.done = true; st.grade = 1; wrong.add(i); Object.assign(ev, { done: true, grade: 1 }); }
    else { wrong.add(i); st.hintLevel = 1; hint = hintFor(q, choice, g); }
    events.push(ev);
    return { correct: ok, done: st.done, grade: st.grade, event: ev, hint };
  };
  return st;
}

// ---------------------------------------------------------------- drawing

function sentenceEl(q) {
  const s = q.prompt.en, m = q.prompt.mark;
  if (!m) return [s];
  return [s.slice(0, m.start), h('u', { className: 'ord-mark pos-mark', text: s.slice(m.start, m.end) }), s.slice(m.end)];
}
function cardEl(kind, g) {
  const k = kindInfo(kind, g);
  if (!k) return null;
  return h('div', { className: 'mc4-hint pos-card' },
    h('p', { className: 'mc4-hint-text' }, h('b', { text: k.zh }), ' ', h('i', { className: 'pos', lang: 'en', text: k.abbr }), '：', k.what),
    k.image ? h('p', { className: 'mc4-hint-text', text: k.image }) : null,
    k.tip ? h('p', { className: 'small', text: '怎么认：' + k.tip }) : null,
    k.try ? h('p', { className: 'small', text: k.try.replace(/\{w\}/g, arr(k.examples)[0] || '…') }) : null,
    arr(k.examples).length ? h('p', { className: 'small' }, '例词：', h('span', { lang: 'en', text: k.examples.join('、') })) : null);
}

export function renderPosQuestion(container, q, { onAnswer, onDone, say, guide: g0 = null, autoNextMs = 0 } = {}) {
  const g = g0 || G;
  const el = container;
  const attempt = createPosAttempt(q, { guide: g });
  let left = false, timer = 0;
  const speak = (text, btn) => { if (text && say) { try { say(text, btn || null); } catch (e) { /* sound is optional */ } } };
  const next = () => {
    if (!attempt.done || left) return;
    left = true;
    clearTimeout(timer);
    if (onDone) onDone({ grade: attempt.grade, correct: attempt.correct, choice: attempt.choice, events: attempt.events });
  };
  const k = kindInfo(q.pos, g);
  const prompt = h('p', { className: q.kind === 'sentence' ? 'lede pos-sentence' : 'mc4-prompt', lang: 'en' }, ...(q.kind === 'sentence' ? sentenceEl(q) : [q.prompt.en]),
    h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => speak(q.prompt.say, ev.currentTarget) } }, icon('speak')));
  const zh = q.prompt.zh ? h('p', { className: q.kind === 'sentence' ? 'mc4-meaning small' : 'mc4-meaning', lang: 'zh-CN', text: q.prompt.zh }) : null;
  const ask = h('p', { className: 'mc4-ask small', text: q.ask });
  const hintBox = h('div', { className: 'mc4-hint', hidden: true });
  const feedback = h('p', { className: 'mc4-feedback', role: 'status', 'aria-live': 'polite' });
  const note = h('div', { className: 'pos-note', hidden: true });
  const more = h('div', { className: 'pos-more', hidden: true });
  const moreBtn = h('button', { type: 'button', className: 'text-btn accent pos-more-btn', text: `${k.zh}怎么认`, hidden: true,
    on: { click: () => { more.hidden = !more.hidden; const c = cardEl(q.pos, g); if (!more.hidden && !more.childNodes.length && c) more.append(c); } } });
  const nextBtn = h('button', { type: 'button', className: 'btn mc4-next', text: '下一个', hidden: true, on: { click: next } });
  const buttons = q.options.map((o, i) => h('button', { type: 'button', className: 'mc4-opt', lang: 'zh-CN', dataset: { i: String(i), pos: o },
    on: { click: () => pick(i) } }, ZH[o] + ' ', h('i', { className: 'pos', lang: 'en', text: ABBR[o] })));
  const list = h('div', { className: 'mc4-options', role: 'group', 'aria-label': '选一个词性' }, buttons);

  // why (the sentence's reason, or “my hobby，说得通”), the word ending rule, and the picture to remember the kind by;
  // after a miss the whole card opens instead of the picture line
  function explain(open) {
    const tip = q.kind === 'word' ? suffixTip(q.w, q.pos, g) : '';
    note.replaceChildren(...[
      q.why ? h('p', { className: 'mc4-hint-text', text: q.why }) : null,
      tip ? h('p', { className: 'small', text: tip }) : null,
      k.image && !open ? h('p', { className: 'small', text: '记一记：' + k.image }) : null].filter(Boolean));
    note.hidden = false;
    moreBtn.hidden = false;
    nextBtn.hidden = false;
  }
  function pick(i) {
    const r = attempt.pick(i);
    if (!r) return;
    if (onAnswer) { try { onAnswer(r.event); } catch (e) { /* bookkeeping never blocks the answer */ } }
    if (!r.done) {
      buttons[i].classList.add('wrong');
      buttons[i].disabled = true;
      hintBox.replaceChildren(h('p', { className: 'mc4-hint-text', text: r.hint }));
      hintBox.hidden = false;
      el.classList.add('is-wrong');
      return;
    }
    buttons.forEach((b, n) => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); if (n === q.answer) b.classList.add(r.correct ? 'right' : 'reveal'); });
    if (!r.correct) buttons[i].classList.add('wrong');
    hintBox.hidden = true;
    el.classList.remove('is-wrong');
    el.classList.add(r.correct ? 'is-right' : 'is-revealed');
    feedback.textContent = r.correct ? (r.grade === 3 ? `对了。${q.w} 是${k.zh}（${k.abbr}）。` : `对了。${q.w} 是${k.zh}。`) : `是${k.zh}（${k.abbr}）。`;
    explain(!r.correct);
    if (!r.correct) { more.replaceChildren(...[cardEl(q.pos, g)].filter(Boolean)); more.hidden = false; }
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
    if (r.correct && r.grade === 3 && autoNextMs > 0) timer = setTimeout(next, autoNextMs);
  }

  el.classList.add('mc4', 'pos');
  el.replaceChildren(h('div', { className: 'mc4-q' }, h('p', { className: 'small mc4-ask', text: '词性' }), prompt, zh, ask), hintBox, list, feedback, note, moreBtn, more,
    h('div', { className: 'btn-row mc4-actions' }, nextBtn));
  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const n = Number(ev.key);
    if (!attempt.done && n >= 1 && n <= q.options.length) { ev.preventDefault(); pick(n - 1); return; }
    if (attempt.done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); }
  }
  return { el, attempt, pick, next, onKey };
}

// a set of questions, one after another (the 词性题 of a review day, the quiz, the warm-up)
export function renderPos(container, ctx = {}, { items = [], sid = '', step = 'warmup', onDone = () => {}, onAnswer = null, autoNextMs = 0, rng = Math.random } = {}) {
  const el = h('div', { className: 'pos-set' });
  container.replaceChildren(el);
  const g = G;
  const results = [];
  let stopped = false, keyFn = null, i = 0;
  const queue = arr(items).filter(Boolean);
  const log = ev => {
    try { if (onAnswer) onAnswer(ev); } catch (e) { /* bookkeeping only */ }
    try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, ...ev }) : null; } catch (e) { return null; }
  };
  const entryOf = slug => call(ctx.words && ctx.words.get, slug) || null;
  const say = (t, b) => { if (t && ctx.say) { try { ctx.say(t, b || null); } catch (e) { /* sound is optional */ } } };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    onDone({ done: true, results: results.slice(), right: results.filter(r => r.clean).length });
  };
  function draw() {
    if (stopped) return;
    const it = queue[i++];
    if (!it) { finish(); return; }
    if (it.kind === 'write') { drawWrite(it); return; }
    const q = makePosQuestion(it, { entryOf, curriculum: ctx.curriculum, guide: g, rng });
    if (!q) { draw(); return; }
    const box = h('article', { className: 'pos-q' });
    el.replaceChildren(box);
    let hinted = false;
    const v = renderPosQuestion(box, q, {
      guide: g, say, autoNextMs,
      onAnswer: ev => { log(ev); if (!ev.correct && !ev.done && !hinted) { hinted = true; log({ type: 'hint', item: q.item, mode: MODE, level: 1, auto: true }); } },
      onDone: r => {
        results.push({ id: q.id, item: q.item, kind: q.kind, pos: q.pos, choice: r.choice, correct: !!r.correct, clean: r.grade === 3, grade: r.grade });
        draw();
      },
    });
    keyFn = v.onKey;
  }
  function drawWrite(it) {
    const e = entryOf(it.slug);
    if (!e) { draw(); return; }
    const box = h('article', { className: 'pos-q pos-write' });
    el.replaceChildren(box);
    let graded = false;
    const pool = (() => { try { return (ctx.words && ctx.words.favorites ? ctx.words.favorites() : []).filter(x => x && x.brief_cn); } catch (err) { return []; } })();
    let v = null;
    try {
      v = posSpellMode.render(e, {
        app: ctx, say, pool, position: { n: i, total: queue.length, isNew: false },
        onAnswer: ev => log({ type: 'answer', ...ev }),
        rate: grade => {
          if (graded) return;
          graded = true;
          results.push({ id: it.item, item: it.item, kind: 'write', slug: it.slug, pos: it.pos || '', correct: grade >= 2, clean: grade === 3, grade });
          draw();
        },
      });
    } catch (err) { v = null; }
    if (!v || !v.el) { draw(); return; }
    box.replaceChildren(v.el, ...[].concat(v.footer || []).filter(Boolean));
    keyFn = v.onKey || null;
  }
  if (!queue.length) setTimeout(finish, 0); else draw();
  return { el, onKey: ev => { if (keyFn && !stopped) keyFn(ev); }, stop() { stopped = true; } };
}

// ---------------------------------------------------------------- 看中文和词性写出英文

export function makePosSpell(e, { curriculum = null, rng } = {}) {
  const q = S.makeSpell(e, { curriculum, ...(rng ? { rng } : {}) });
  if (!q) return null;
  const pos = wordPos(e, { curriculum });
  return pos ? { ...q, pos, posLabel: posLabel(pos) } : q;
}

function cueEl(kind) {
  return h('p', { className: 'spell-ask small pos-cue' }, h('i', { className: 'pos', lang: 'en', text: ABBR[kind] }), ` ${ZH[kind]}：写出这个${ZH[kind]}`);
}
export const posSpellMode = {
  id: S.MODE_ID,
  label: '看中文和词性写出来',
  render(e, ctx = {}) {
    const app = ctx.app || {};
    const kind = wordPos(e, { curriculum: app.curriculum });
    const onAnswer = ctx.onAnswer ? ev => ctx.onAnswer(kind && ev && typeof ev === 'object' ? { ...ev, pos: kind } : ev) : ctx.onAnswer;
    const v = S.spellMode.render(e, { ...ctx, onAnswer });
    if (!v || !v.el || v.modeId !== S.MODE_ID || !kind || kind === 'aux') return v;
    try {
      const top = arr(v.el.childNodes && [...v.el.childNodes])[0];
      if (top && top.childNodes) {
        const kids = [...top.childNodes];
        top.replaceChildren(kids[0], cueEl(kind), ...kids.slice(1));
      }
    } catch (err) { /* the spelling works without the cue */ }
    return { ...v, pos: kind };
  },
};

// for tests and the parent area: today's seed
export const seedOf = (now = new Date()) => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
export { dayOf };
