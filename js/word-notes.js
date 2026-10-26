// 巧记小本（0.8.2，Wei 10-26）：离线的单词巧记和词性说明。查词页、离线词典那一层拿来马上显示，不等模型、不花钱。
// 数据：curriculum/word-notes-a.json、curriculum/word-notes-b.json（原创：每个词初中最常用的意思、1-2 种记法、容易错、
// 最常用的一个搭配；不带单元号），curriculum/pos-guide.json（每个词性是干什么的）。哪个文件读不到就算了：
// 没有小本的词，查词页用模型给的巧记（prompts.js 的 mem / trap / use / posZh，字段名和这里一样）。
// 负责：查词讲解加巧记 agent（prompts.js、ui-entry.js、css/entry-memory.css、本文件、tests/word-notes.test.mjs）。
//
// 一条小本 Note（清洗过，冻结，只读）：
//   { w: 'strict', pos: ['adj'], posZh: '形容词', cn: '严格的', mem: [{ kind: 'picture' | 'split' | 'link' | 'story' | 'sound' | '', text }],
//     trap: '' | '容易错的地方', use: '' | 'a strict teacher 严格的老师', forms: ['stricter'] }
//   文件可以是数组、{ words | notes | items | entries: [...] }，或者 { 词: note }；词条里 w 也认 word、headword。
//
// 导出（纯函数，不碰 DOM）
//   NOTE_FILES, POS_FILE
//   loadNotes({ fetchJSON?, files?, force? }) -> Promise<{ words, files: { 文件: 词数 | 'missing' } }>
//       两个文件各读各的，先到先用（坏一个不影响另一个）；同一次 App 只读一次，force 重读
//   loadPosGuide({ fetchJSON?, force? }) -> Promise<guide | null>
//   loadAll({ fetchJSON? }) -> Promise<void>        上面两个一起（app.js 启动时、查词页第一次打开时调）
//   useNotes(...data)        换成这几份数据（测试用）；addNotes(data) -> 加了几个词
//   usePosGuide(data)        pos-guide.json：{ kinds: { n: { zh, abbr, what, image, tip, examples, ... } } }；也认 { guide: {...} }、
//                            { 词性: {...} }、[{ pos, zh, what, tip }]；键 'int' 读成 'interj'
//   noteFor(word, { lemma? }) -> Note | null       认原形和变形：原样 → note.forms → lemma(word)（传 app.dict.lemma）→
//       常见不规则变化 → 去词尾（-s/-es/-ies 只认名词动词，-ed/-ing 只认动词，-er/-est 只认形容词副词）。
//       从变形找到的另带 via（她查的那个形式）
//   notesReady() -> boolean；notesVersion() -> number（小本或词性说明每到一次加 1）；onNotes(fn) -> off
//   posKey(raw) -> 'n' | 'v' | 'adj' | 'adv' | 'pron' | 'prep' | 'conj' | 'num' | 'art' | 'interj' | 'modal' | 'aux' | 'det' | 'phr' | 'abbr' | ''
//   posKeys(raw) -> [key]    'v. & n.'、['adj', 'adv']、'形容词' 都认，去重
//   posInfo(raw) -> { key, abbr: 'adj.', zh: '形容词', what, image, tip, examples } | null
//       先用 pos-guide.json（image 是一个比喻：“形容词是给名词穿的衣服”），读不到时 what 用这里的一句，image、tip 空
//   posListOf(entry, note?) -> [key]   词条页头上显示的词性：小本的在前，再 senses 的，再 posZh，最多 3 个
//   memoryOf(entry, note?) -> { mem, trap, use, posZh, cn, from: 'note' | 'model' | 'old' } | null
//       有小本用小本（缺的 trap / use 用模型的补）；没有就用词条上模型给的 mem；再没有就是旧的一句 mnemonic；都没有 null
//   MEM_KIND_ZH              { picture: '想画面', split: '拆开记', link: '连中文', story: '小故事', sound: '听声音' }
//   POS_ZH                   内置的词性中文名
// 依赖：prompts.js（cleanMemory，和模型的巧记同一套清洗）。
import { cleanMemory } from './prompts.js';

export const NOTE_FILES = ['curriculum/word-notes-a.json', 'curriculum/word-notes-b.json'];
export const POS_FILE = 'curriculum/pos-guide.json';

export const MEM_KIND_ZH = { picture: '想画面', split: '拆开记', link: '连中文', story: '小故事', sound: '听声音' };

export const POS_ZH = { n: '名词', v: '动词', adj: '形容词', adv: '副词', pron: '代词', prep: '介词', conj: '连词', num: '数词',
  art: '冠词', interj: '感叹词', modal: '情态动词', aux: '助动词', det: '限定词', phr: '短语', abbr: '缩写' };
const POS_ABBR = { modal: 'modal v.', phr: 'phr.' };
// used only when pos-guide.json is not there: one plain line each, words from the primary list
const POS_WHAT = {
  n: '人、动物、东西、地方的名字，比如 cat、book、school。前面常有 a、the、my。',
  v: '表示动作或状态，就是“做什么”，比如 run、eat、like。一个句子少不了它。',
  adj: '说人或东西“什么样”，比如 big、happy、strict。放在名词前面，或者 is、are 后面。',
  adv: '说动作“怎么做、多常做”，比如 often、very、slowly。',
  pron: '代替名词，免得一遍遍重复，比如 I、she、it、they。',
  prep: '放在名词前面，说位置、时间、方向，比如 in、on、at、under。',
  conj: '把词或句子连起来，比如 and、but、or、because。',
  num: '表示数量或第几，比如 one、ten、first。',
  art: '放在名词前面的 a、an、the。',
  interj: '表示感情或打招呼，比如 oh、wow、hello。',
  modal: '放在动词前面，说“能、会、必须”，比如 can、must。后面的动词用原形。',
  aux: '帮别的动词变成问句、否定句，比如 do、does。',
  det: '放在名词前面，说是哪个、有多少，比如 this、some、every。',
  phr: '几个词连在一起当一个意思用，比如 look after。',
  abbr: '把一个词写短了的样子，比如 No. 就是 number（号码）。',
};
const POS_ALIAS = {
  n: 'n', noun: 'n', nouns: 'n', '名词': 'n',
  v: 'v', vt: 'v', vi: 'v', verb: 'v', verbs: 'v', '动词': 'v',
  adj: 'adj', a: 'adj', adjective: 'adj', '形容词': 'adj',
  adv: 'adv', ad: 'adv', adverb: 'adv', '副词': 'adv',
  pron: 'pron', pronoun: 'pron', '代词': 'pron',
  prep: 'prep', preposition: 'prep', '介词': 'prep',
  conj: 'conj', conjunction: 'conj', '连词': 'conj',
  num: 'num', numeral: 'num', number: 'num', '数词': 'num',
  art: 'art', article: 'art', '冠词': 'art',
  interj: 'interj', int: 'interj', interjection: 'interj', excl: 'interj', exclamation: 'interj', '感叹词': 'interj', '叹词': 'interj',
  modal: 'modal', 'modal v': 'modal', 'modal verb': 'modal', 'v modal': 'modal', '情态动词': 'modal',
  aux: 'aux', 'aux v': 'aux', auxiliary: 'aux', 'auxiliary verb': 'aux', '助动词': 'aux',
  det: 'det', determiner: 'det', '限定词': 'det',
  phr: 'phr', phrase: 'phr', 'phrasal verb': 'phr', phrasal_verb: 'phr', idiom: 'phr', '短语': 'phr', '词组': 'phr',
  abbr: 'abbr', abbreviation: 'abbr', '缩写': 'abbr',
};

const norm = w => String(w ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- parts of speech

export function posKey(raw) {
  const s = norm(raw).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (POS_ALIAS[s]) return POS_ALIAS[s];
  const first = s.split(' ')[0];
  return POS_ALIAS[first] || '';
}

export function posKeys(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[&,/、;；|＆，]|\s+and\s+|\s+or\s+/);
  const out = [];
  for (const p of parts) {
    if (p == null) continue;
    const k = posKey(p);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------- state

const notes = new Map();      // lowercase word or phrase -> Note
const formsOf = new Map();    // a form listed in a note -> its word
let guide = {};               // pos key -> { zh, what, tip }
let version = 0;
const listeners = new Set();
let notesLoad = null, guideLoad = null;
const fileStatus = {};

function emit() {
  version++;
  for (const fn of listeners) { try { fn(version); } catch (e) { console.error(e); } }
}
export const onNotes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const notesReady = () => notes.size > 0;
export const notesVersion = () => version;

function listOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.map(x => [x, '']);
  if (typeof data !== 'object') return [];
  for (const k of ['words', 'notes', 'items', 'entries']) if (Array.isArray(data[k])) return data[k].map(x => [x, '']);
  // { strict: {...}, ... }: keys are the words (meta keys such as version or note are skipped: their values are not notes)
  return Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => [v, k]);
}

function cleanNote(x, keyHint = '') {
  if (!x || typeof x !== 'object') return null;
  const w = oneLine(x.w || x.word || x.headword || keyHint);
  if (!w || !/[a-z]/i.test(w)) return null;
  const m = cleanMemory(x);
  const pos = posKeys(x.pos);
  const posZh = m.posZh || pos.map(k => POS_ZH[k]).filter(Boolean).join('、');
  const forms = (Array.isArray(x.forms) ? x.forms : typeof x.forms === 'string' ? x.forms.split(/[,，、/]/) : [])
    .map(norm).filter(f => f && f !== norm(w));
  const cn = oneLine(x.cn || x.zh || '');
  if (!m.mem.length && !m.trap && !m.use && !cn) return null;
  return Object.freeze({ w, pos: Object.freeze(pos), posZh, cn, mem: Object.freeze(m.mem.map(i => Object.freeze(i))), trap: m.trap, use: m.use,
    forms: Object.freeze([...new Set(forms)]) });
}

// add one file's notes; a word already there is kept unless the new note has more memory tricks
export function addNotes(data) {
  let n = 0;
  for (const [x, key] of listOf(data)) {
    const note = cleanNote(x, key);
    if (!note) continue;
    const k = norm(note.w);
    const old = notes.get(k);
    if (old && old.mem.length >= note.mem.length) continue;
    notes.set(k, note);
    for (const f of note.forms) if (!formsOf.has(f)) formsOf.set(f, k);
    n++;
  }
  if (n) emit();
  return n;
}

export function useNotes(...datas) {
  notes.clear();
  formsOf.clear();
  for (const d of datas) addNotes(d);
  emit();
}

export function usePosGuide(data) {
  const next = {};
  const put = (k, v) => {
    const key = posKey(k || (v && (v.pos || v.key)));
    if (!key || !v || typeof v !== 'object') return;
    next[key] = { zh: oneLine(v.zh || v.name || ''), abbr: oneLine(v.abbr || ''), what: oneLine(v.what || v.explain || ''),
      image: oneLine(v.image || ''), tip: oneLine(v.tip || ''), examples: Array.isArray(v.examples) ? v.examples.map(oneLine).filter(Boolean).slice(0, 6) : [] };
  };
  const src = data && typeof data === 'object' ? (data.kinds || data.guide || data.pos || data.items || data) : null;
  if (Array.isArray(src)) for (const v of src) put('', v);
  else if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) put(k, v);
  guide = next;
  emit();
}

async function defaultFetch(p) {
  if (typeof fetch !== 'function') throw new Error('no fetch');
  const r = await fetch(p);
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
}

export function loadNotes({ fetchJSON = defaultFetch, files = NOTE_FILES, force = false } = {}) {
  if (notesLoad && !force) return notesLoad;
  const fj = typeof fetchJSON === 'function' ? fetchJSON : defaultFetch;
  notesLoad = Promise.all(files.map(f => Promise.resolve().then(() => fj(f)).then(
    data => { fileStatus[f] = addNotes(data); },
    () => { fileStatus[f] = 'missing'; },
  ))).then(() => ({ words: notes.size, files: { ...fileStatus } }));
  return notesLoad;
}

export function loadPosGuide({ fetchJSON = defaultFetch, file = POS_FILE, force = false } = {}) {
  if (guideLoad && !force) return guideLoad;
  const fj = typeof fetchJSON === 'function' ? fetchJSON : defaultFetch;
  guideLoad = Promise.resolve().then(() => fj(file)).then(data => { usePosGuide(data); return guide; }, () => null);
  return guideLoad;
}

export function loadAll({ fetchJSON } = {}) {
  return Promise.all([loadNotes({ fetchJSON }), loadPosGuide({ fetchJSON })]).then(() => {});
}

// ---------------------------------------------------------------- finding a word's note

// the irregular forms a Grade 7 student meets first (the offline dictionary's lemma table covers the rest). Forms that are
// words of their own at her level are left out (left 左边, lay, more, my, its): a note for leave must not show up for left.
const IRREGULAR = new Map();
for (const row of ('be:am,is,are,was,were,been,being;have:has,had,having;do:does,did,done,doing;go:goes,went,gone,going;' +
  'see:saw,seen;come:came;get:got,gotten;make:made;take:took,taken;say:said,says;know:knew,known;think:thought;give:gave,given;' +
  'eat:ate,eaten;drink:drank,drunk;write:wrote,written;run:ran,running;swim:swam,swimming;sing:sang,sung;buy:bought;bring:brought;' +
  'teach:taught;catch:caught;fly:flew,flown,flies;draw:drew,drawn;sit:sat,sitting;stand:stood;tell:told;find:found;feel:felt;' +
  'meet:met;sleep:slept;keep:kept;begin:began,begun,beginning;speak:spoke,spoken;wear:wore,worn;ride:rode,ridden;' +
  'win:won,winning;lose:lost;hear:heard;send:sent;spend:spent;build:built;fall:fell,fallen;grow:grew,grown;throw:threw,thrown;' +
  'forget:forgot,forgotten;choose:chose,chosen;hide:hid,hidden;break:broke,broken;wake:woke,woken;understand:understood;' +
  'lie:lying;die:died,dying;tie:tying;' +
  'child:children;man:men;woman:women;foot:feet;tooth:teeth;mouse:mice;person:people;goose:geese;leaf:leaves;knife:knives;' +
  'wife:wives;life:lives;half:halves;shelf:shelves;wolf:wolves;potato:potatoes;tomato:tomatoes;' +
  'good:better,best;well:better,best;bad:worse,worst').split(';')) {
  const [base, list] = row.split(':');
  for (const f of list.split(',')) if (!IRREGULAR.has(f)) IRREGULAR.set(f, base);
}

const NV = ['n', 'v'], V = ['v', 'modal', 'aux'], AJ = ['adj', 'adv'];
const CONS = /[bcdfghjklmnpqrstvwxz]/;
const doubled = b => b.length >= 3 && b[b.length - 1] === b[b.length - 2] && CONS.test(b[b.length - 1]);

// [candidate base, the parts of speech that ending belongs to]
function stems(q) {
  const out = [];
  if (!/^[a-z][a-z'-]*$/.test(q)) return out;
  const L = q.length;
  if (q.endsWith('ies') && L > 4) out.push([q.slice(0, -3) + 'y', NV]);
  if (q.endsWith('ves') && L > 4) out.push([q.slice(0, -3) + 'f', ['n']], [q.slice(0, -3) + 'fe', ['n']]);
  if (q.endsWith('es') && L > 3) out.push([q.slice(0, -2), NV]);
  if (q.endsWith('s') && !q.endsWith('ss') && L > 2) out.push([q.slice(0, -1), NV]);
  if (q.endsWith('ied') && L > 4) out.push([q.slice(0, -3) + 'y', V]);
  if (q.endsWith('ed') && L > 3) {
    const b = q.slice(0, -2);
    out.push([b, V], [q.slice(0, -1), V]);
    if (doubled(b)) out.push([b.slice(0, -1), V]);
  }
  if (q.endsWith('ing') && L > 4) {
    const b = q.slice(0, -3);
    out.push([b, V], [b + 'e', V]);
    if (doubled(b)) out.push([b.slice(0, -1), V]);
    if (b.endsWith('y')) out.push([b.slice(0, -1) + 'ie', V]);
  }
  if (q.endsWith('iest') && L > 5) out.push([q.slice(0, -4) + 'y', AJ]);
  if (q.endsWith('ier') && L > 4) out.push([q.slice(0, -3) + 'y', AJ]);
  if (q.endsWith('est') && L > 4) {
    const b = q.slice(0, -3);
    out.push([b, AJ], [b + 'e', AJ]);
    if (doubled(b)) out.push([b.slice(0, -1), AJ]);
  }
  if (q.endsWith('er') && L > 3) {
    const b = q.slice(0, -2);
    out.push([b, AJ], [b + 'e', AJ]);
    if (doubled(b)) out.push([b.slice(0, -1), AJ]);
  }
  return out;
}
// a note without a part of speech only takes a plural / third-person -s
const fits = (note, need) => (note.pos.length ? note.pos.some(p => need.includes(p)) : need === NV);
const via = (note, q) => Object.freeze({ ...note, via: q });

export function noteFor(word, { lemma = null } = {}) {
  const q = norm(word);
  if (!q || !notes.size) return null;
  const hit = notes.get(q);
  if (hit) return hit;
  const listed = formsOf.get(q);
  if (listed && notes.get(listed)) return via(notes.get(listed), q);
  // "to swim", "a ruler": the word itself
  const bare = q.replace(/^(to|a|an|the) (?=\S)/, '');
  if (bare !== q && notes.get(bare)) return via(notes.get(bare), q);
  if (typeof lemma === 'function') {
    let l = '';
    try { l = norm(lemma(q)); } catch (e) { l = ''; }
    if (l && l !== q && notes.get(l)) return via(notes.get(l), q);
  }
  const irr = IRREGULAR.get(q);
  if (irr && notes.get(irr)) return via(notes.get(irr), q);
  for (const [stem, need] of stems(q)) {
    const n = notes.get(stem);
    if (n && fits(n, need)) return via(n, q);
  }
  return null;
}

// ---------------------------------------------------------------- what the word page shows

export function posInfo(raw) {
  const key = Array.isArray(raw) ? posKeys(raw)[0] || '' : posKey(raw);
  if (!key) return null;
  const g = guide[key] || {};
  return { key, abbr: g.abbr || POS_ABBR[key] || key + '.', zh: g.zh || POS_ZH[key] || '', what: g.what || POS_WHAT[key] || '',
    image: g.image || '', tip: g.tip || '', examples: g.examples ? g.examples.slice() : [] };
}

export function posListOf(entry, note = null) {
  const e = entry || {};
  const out = [];
  const add = keys => { for (const k of keys) if (k && !out.includes(k)) out.push(k); };
  if (note && note.pos) add(posKeys(note.pos));
  for (const s of Array.isArray(e.senses) ? e.senses : []) if (s && s.pos) add(posKeys(s.pos));
  if (!out.length && e.posZh) add(posKeys(String(e.posZh)));
  if (!out.length && e.kind && /phrase|phrasal|idiom/.test(String(e.kind))) add(['phr']);
  return out.slice(0, 3);
}

export function memoryOf(entry, note = null) {
  const fromEntry = cleanMemory(entry || {});
  if (note && (note.mem.length || note.trap || note.use)) {
    return { mem: note.mem.slice(), trap: note.trap || fromEntry.trap, use: note.use || fromEntry.use,
      posZh: note.posZh || fromEntry.posZh, cn: note.cn || '', from: 'note' };
  }
  if (!fromEntry.mem.length) return null;
  const model = Array.isArray(entry.mem) || (entry.mem && typeof entry.mem === 'object') || typeof entry.mem === 'string';
  return { ...fromEntry, cn: '', from: model ? 'model' : 'old' };
}
