// 家长开机问卷的回答用起来（DESIGN 3.5；teacher-memory 7.1）：把 kv 'parent.intake' 的回答变成各模块的默认值。
// 家长的说法一律先当“待确认”（status: 'pending'）：这里只给起点，App 自己的作答数据以后会确认或推翻。
// 负责：英语小对话 agent（题目在 curriculum/intake.json，回答由家长区 ui-parent.js 写）。
//
// 导出
//   INTAKE_KEY = 'parent.intake'、TEXTBOOK_KEY = 'textbook'、METHOD_IDS（= dictation.js METHODS 的 id）、DEFAULT_METHOD = 'zh2en'
//   DAY_IDS（Date.getDay() 的顺序：sun, mon, ...）、MAX_REVIEW = 40、PRAISE_STYLES、GRAMMAR_CUES、FOCUS_CUES
//   intakeDefaults(kv, opts?) -> Defaults           纯函数（只读 kv.peek），读不到、没填都给默认值，从不抛错
//     kv    app.js 的 ctx.kv（peek 同步）；测试里的 memKv、Map、普通对象 { 'parent.intake': ... } 也认
//     opts  { textbook?（默认读 kv 'textbook'）, entries?（words.all()，用词条上的 unit）, curriculum?（unitOf 兜底）,
//             lemma?(word) -> 原形（dict.lemma） }
//   Defaults = {
//     filled: bool, at, updated, status: 'pending', source: 'parent',
//     review: {                                   最近的错题和老师说过的问题 → 先进复习的词
//       words: [{ slug, w, unit, cn, from: 'mistakes' | 'teacher' }],   只取课本里有的（kv 'textbook' 的单元词、导入的词条），
//                                                最多 MAX_REVIEW 个，按家长写的顺序，错题在前
//       slugs: [slug],                           同上，只要 slug（plan.js 的 boost）
//       outside: [词],                           写了但不在课本 Starter 到 Unit 3 里的（家长区可以提一句，不进复习）
//       grammar: ['g:there_be', ...],            提到的语法点（prereq.json 的 id）
//       focus: ['spelling' | 'words' | 'grammar' | 'listening' | 'reading' | 'phonics' | 'speaking'],   老师说的问题落在哪
//       teacher: '原话'                          老师的原话（只给家长区和笔记本看）
//     },
//     dictation: { method, methods: [四种考法，家长选的在前], known, freq: 'daily' | 'few' | 'weekly' | 'rare' | '' },
//     praise: { style: 'specific' | 'short' | 'fact', tone: [lines.json 的 tone], lines: 1, word: true, exclaim, parentTip, known },
//                                                具体、少、不夸张：一节课最多一句，说出那个词；不太喜欢被夸的只说事实
//     busy: { ids: ['mon', ...], days: [1, ...], varies, known },         作业多的那几天默认轻松版
//     time: { slot: 'before_19' | '19_20' | '20_21' | 'after_21' | 'varies' | '', late, known },
//     phonics: { level: 'yes' | 'some' | 'not_yet' | 'unknown', ipa, ipaTap, startFrom: 'starter' | 'unit', known },
//                                                ipa 语音小卡默认显示音标；ipaTap 音标先收起，点“看音标”才显示（还没学会音标时）
//     onMistake: ['retry' | 'skip' | 'upset' | 'ask'],                    做错题时她通常怎样（只进笔记本的“还想弄清的”）
//   }
//   isBusyDay(defaults, date) -> bool               这天是家长说的作业多的日子
//   parseMentions(text) -> [string]                 自由文本里的英文词和短语（小写，按出现顺序）
//   grammarOf(text) / focusOf(text) -> [id]
//   textbookIndex({ textbook, entries }) -> Map(key -> { slug, w, unit, cn })
//
// 依赖：words.js（slugify）。无 DOM。

import { slugify } from './words.js';

export const INTAKE_KEY = 'parent.intake';
export const TEXTBOOK_KEY = 'textbook';
export const METHOD_IDS = ['zh2en', 'en2en', 'phrase', 'en2zh'];
export const DEFAULT_METHOD = 'zh2en';
export const DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const MAX_REVIEW = 40;

// the praise knob's starting point (teacher-memory 6.1 praise): specific, few, never over the top
export const PRAISE_STYLES = {
  specific: { style: 'specific', tone: ['specific', 'self'], exclaim: true,
    parentTip: '夸具体的努力，说出做对的那个词，比如“strict 上周写不出，这周写对了”。不问分数。' },
  short: { style: 'short', tone: ['short'], exclaim: true,
    parentTip: '夸一句就够，带上一个具体的词，比如“strict 写对了”。不问分数。' },
  fact: { style: 'fact', tone: ['fact'], exclaim: false,
    parentTip: '她不太喜欢被夸，说事实就好，比如“这周写对了 5 个词”。不夸张，不问分数。' },
};
const PRAISE_OF = { specific: 'specific', short: 'short', dislike: 'fact' };

// grammar points a parent or teacher may name (prereq.json ids)
export const GRAMMAR_CUES = [
  [/there\s+(be|is|are|was|were)\b/i, 'g:there_be'],
  [/how\s+(many|much)\b/i, 'g:how_many_much'],
  [/所有格/, 'g:possessive_s'],
  [/物主代词/, 'g:possessive_pronoun'],
  [/人称代词|主格|宾格/, 'g:personal_pronoun'],
  [/be\s*动词|\bam\s*[/、,，]\s*is\s*[/、,，]\s*are\b/i, 'g:be'],
  [/复数/, 'g:plural'],
  [/可数/, 'g:countable'],
  [/三单|第三人称单数/, 'g:third_s'],
  [/一般现在时/, 'g:present_simple'],
  [/进行时/, 'g:present_continuous'],
  [/频度副词/, 'g:freq_adverb'],
];
// what a teacher's remark is about (the notebook's open questions; never shown to her)
export const FOCUS_CUES = [
  [/默写|听写|拼写|拼错|拼不|写不出|写错|单词写/, 'spelling'],
  [/单词|词汇|记不住|背不/, 'words'],
  [/语法|时态|句型|代词|复数|所有格|there\s+be/i, 'grammar'],
  [/听力|听不懂|听不清/, 'listening'],
  [/阅读|读不懂|看不懂/, 'reading'],
  [/音标|发音|读音|拼读/, 'phonics'],
  [/口语|朗读|开口/, 'speaking'],
];
const POSSESSIVES = ['my', 'mine', 'your', 'yours', 'his', 'her', 'hers', 'its', 'our', 'ours', 'their', 'theirs'];
// words in a note that are never review words on their own
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'am', 'be', 'was', 'were', 'i', 's', 'it',
  'unit', 'starter', 'there', 'how', 'many', 'much', 'he', 'she', 'ok']);

// ---------------------------------------------------------------- small readers

function peekKv(kv, key) {
  try {
    if (!kv) return undefined;
    if (typeof kv.peek === 'function') return kv.peek(key, undefined);
    if (kv instanceof Map) return kv.get(key);
    if (typeof kv === 'object') return kv[key];
  } catch (e) { /* a broken kv gives the defaults */ }
  return undefined;
}
// { version, at, updated, answers } (the agreed shape); a bare answers object is read too
function answersOf(rec) {
  if (!rec || typeof rec !== 'object') return {};
  if (rec.answers && typeof rec.answers === 'object') return rec.answers;
  const { version, at, updated, ...rest } = rec;
  return rest;
}
const textOf = v => (Array.isArray(v) ? v.filter(x => x != null).map(String).join('，') : v == null ? '' : String(v)).trim();
const listAnswer = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
const uniq = a => [...new Set(a)];

const norm = s => String(s ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').replace(/^[\s'.-]+|[\s'.-]+$/g, '');

// English words and phrases in free text, in order: "strict, carry；look after" -> ['strict', 'carry', 'look after']
export function parseMentions(text) {
  const out = [];
  for (const seg of String(text ?? '').split(/[,，、;；。.!！?？\n\r/|（）()“”"]+/)) {
    for (const run of seg.match(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*/g) || []) {
      const r = norm(run);
      if (r) out.push(r);
    }
  }
  return out;
}

export const grammarOf = text => {
  const s = String(text ?? '');
  const out = GRAMMAR_CUES.filter(([re]) => re.test(s)).map(([, id]) => id);
  const words = new Set((s.toLowerCase().match(/[a-z]+/g) || []));
  if (POSSESSIVES.filter(w => words.has(w)).length >= 2) out.push('g:possessive_pronoun');
  if (words.has('he') && words.has('she')) out.push('g:personal_pronoun');
  return uniq(out);
};
// clause by clause; a clause that says it is fine (“听力还行”) is not a problem
const FINE = /还行|还可以|不错|挺好|很好|没问题/;
export const focusOf = text => uniq(String(text ?? '').split(/[,，、;；。.!！?？\n\r]+/).filter(c => !FINE.test(c))
  .flatMap(c => FOCUS_CUES.filter(([re]) => re.test(c)).map(([, id]) => id)));

// ---------------------------------------------------------------- the textbook's words

export function textbookIndex({ textbook = null, entries = null } = {}) {
  const idx = new Map();
  const add = (w, unit, cn, slug) => {
    const k = norm(w);
    if (!k || idx.has(k)) return;
    idx.set(k, { slug: slug || slugify(w), w: String(w).trim(), unit: unit || null, cn: cn || '' });
  };
  const units = textbook && Array.isArray(textbook.units) ? textbook.units : [];
  for (const u of units) for (const x of (u && Array.isArray(u.words) ? u.words : [])) if (x && x.w) add(x.w, u.id, x.cn);
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e && e.unit && (e.headword || e.slug)) add(e.headword || e.slug, e.unit, e.brief_cn, e.slug);
  }
  return idx;
}

// a word as written -> the forms it may come from (carried -> carry, stopped -> stop, mistakes -> mistake)
function formsOf(t, lemma) {
  const out = [t];
  if (lemma) { try { const b = lemma(t); if (b && b !== t) out.push(norm(b)); } catch (e) { /* ignore */ } }
  if (/ies$/.test(t)) out.push(t.slice(0, -3) + 'y');
  if (/es$/.test(t)) out.push(t.slice(0, -2));
  if (/s$/.test(t)) out.push(t.slice(0, -1));
  if (/ied$/.test(t)) out.push(t.slice(0, -3) + 'y');
  if (/ed$/.test(t)) out.push(t.slice(0, -2), t.slice(0, -1), t.slice(0, -3));
  if (/ing$/.test(t)) out.push(t.slice(0, -3), t.slice(0, -3) + 'e', t.slice(0, -4));
  return uniq(out.filter(x => x && x.length > 1));
}

function matcher(idx, { curriculum = null, lemma = null } = {}) {
  const unitOf = curriculum && typeof curriculum.unitOf === 'function' ? w => { try { return curriculum.unitOf(w); } catch (e) { return null; } } : null;
  return t => {
    for (const f of formsOf(t, lemma)) {
      if (idx.has(f)) return idx.get(f);
      const u = unitOf && unitOf(f);
      if (u) return { slug: slugify(f), w: f, unit: u, cn: '' };
    }
    return null;
  };
}

// one free-text answer -> textbook hits and the rest
function scan(text, find, from) {
  const hits = [], outside = [];
  for (const run of parseMentions(text)) {
    if (grammarOf(run).length && /^(there|how)\b/.test(run)) continue;   // "there be" is a grammar point, not two words
    const ws = run.split(' ');
    let i = 0;
    while (i < ws.length) {
      let got = null, len = Math.min(4, ws.length - i);
      for (; len >= 1; len--) { got = find(ws.slice(i, i + len).join(' ')); if (got) break; }
      if (got) { hits.push({ ...got, from }); i += len; continue; }
      const w = ws[i];
      if (!STOP.has(w) && !POSSESSIVES.includes(w) && /^[a-z][a-z'-]+$/.test(w)) outside.push(w);
      i++;
    }
  }
  return { hits, outside };
}

// ---------------------------------------------------------------- defaults

export function intakeDefaults(kv, opts = {}) {
  const o = opts || {};
  const rec = peekKv(kv, INTAKE_KEY);
  const a = answersOf(rec);
  const known = v => listAnswer(v).some(x => x && x !== 'unknown');

  // ---- review: mistakes and the teacher's words, only words in the textbook
  const textbook = o.textbook !== undefined ? o.textbook : peekKv(kv, TEXTBOOK_KEY);
  const find = matcher(textbookIndex({ textbook, entries: o.entries }), o);
  const mistakes = textOf(a.mistakes);
  const teacher = textOf(a.teacher);
  const m = scan(mistakes, find, 'mistakes');
  const t = scan(teacher, find, 'teacher');
  const seen = new Set();
  const words = [...m.hits, ...t.hits].filter(x => x.slug && !seen.has(x.slug) && seen.add(x.slug)).slice(0, MAX_REVIEW);
  const review = {
    words, slugs: words.map(x => x.slug),
    outside: uniq([...m.outside, ...t.outside]).filter(w => !words.some(x => norm(x.w) === w)),
    grammar: uniq([...grammarOf(mistakes), ...grammarOf(teacher)]),
    focus: uniq([...focusOf(teacher), ...focusOf(mistakes)]),
    teacher,
  };

  // ---- dictation: the first way the parent picked becomes the default
  const ways = listAnswer(a.dictation_way).filter(x => METHOD_IDS.includes(x));
  const dictation = {
    method: ways[0] || DEFAULT_METHOD,
    methods: uniq([...ways, ...METHOD_IDS]),
    known: ways.length > 0,
    freq: ['daily', 'few', 'weekly', 'rare'].includes(a.dictation_freq) ? a.dictation_freq : '',
  };

  // ---- praise: specific, few, not over the top
  const style = PRAISE_OF[a.on_praise] || 'specific';
  const praise = { ...PRAISE_STYLES[style], tone: [...PRAISE_STYLES[style].tone], lines: 1, word: true, known: !!PRAISE_OF[a.on_praise] };

  // ---- busy days: light by default (she can still pick the standard lesson)
  const dayIds = listAnswer(a.busy_days).filter(x => DAY_IDS.includes(x));
  const busy = { ids: DAY_IDS.filter(d => dayIds.includes(d)), days: DAY_IDS.map((d, i) => (dayIds.includes(d) ? i : -1)).filter(i => i >= 0),
    varies: listAnswer(a.busy_days).includes('varies'), known: known(a.busy_days) };

  const slot = ['before_19', '19_20', '20_21', 'after_21', 'varies'].includes(a.free_time) ? a.free_time : '';
  const time = { slot, late: slot === 'after_21', known: !!slot };

  // ---- phonics: does the phonics card show IPA
  const level = ['yes', 'some', 'not_yet'].includes(a.phonics) ? a.phonics : 'unknown';
  const phonics = { level, ipa: level !== 'not_yet', ipaTap: level === 'not_yet', startFrom: level === 'yes' ? 'unit' : 'starter', known: level !== 'unknown' };

  const onMistake = listAnswer(a.on_mistake).filter(x => ['retry', 'skip', 'upset', 'ask'].includes(x));

  const filled = Object.values(a).some(v => textOf(v) !== '');
  return { filled, at: (rec && rec.at) || null, updated: (rec && rec.updated) || null, status: 'pending', source: 'parent',
    review, dictation, praise, busy, time, phonics, onMistake };
}

export function isBusyDay(defaults, date = new Date()) {
  const days = defaults && defaults.busy && Array.isArray(defaults.busy.days) ? defaults.busy.days : [];
  return days.includes(new Date(date).getDay());
}
