// 句子里回想（design/teacher-next.md 第 5 节）：拼写从孤立的词换到她读过的句子里，给首字母和这个词在句子里的中文：
//   “Ms Wang is very s______（严格的）.”  回想比再认牢；在句子里写，读和写一起练；期中常见按首字母填词。
// 另有 pickedWords：阅读里点过的词、问老师里出现的课本词，自动进复习（给 plan 排在同一档的前面）。
// 负责：单词从认得到会用（teacher-next 第 5 节，第 4 批）。样式 css/cloze.css（类名 cloze-，变形配对的 forms- 也在那里）。
//
// 出题规则
//   只给必会词出（modes/spell.js 的 canSpell：必会、单个词、3 个字母以上）。句子按这个顺序找，含这个词（整词、只出现一次、
//   3 到 16 个词）的才用：她读过的那几集故事 → 语法卡的例句 → 连词成句的句子 → 还没读到的故事 → 单词本词条自己的例句
//   （senses[].example）。同一档里按天轮换（同一天同一个词出同一句）。
//   中文：故事句子先用这句的关键词（keys）、本集目标词和 glossary 里这个词的意思（这句里的意思）；这句的关键词是含这个词的
//   短语（point out 里的 point）时不用这句，免得意思对不上；例句用它那个义项的中文；别的用词条的 brief_cn。中文里带英文的括号
//   （“回来（come back 回来）”）去掉，不把答案送出去。
//   字母块沿用 spell.js 的分块（6 个字母以上、两个音节以上按音节，别的按字母）和干扰块；按字母分时首字母已经放好，她拼后面的；
//   键盘（设置 spellMode 是 'keys'，默认字母块）：首字母写在框前面，她打后面的字母（整词打全也算对）。
//   第一次拼错：对的开头留着，出整句中文、读一遍句子、一句拼写规律（spell.js spellHint）；字母块第二次错就给答案；
//   键盘第二次错再多给一个字母，第三次错给答案。随时能点“提示”（同第一级）和“看答案”。
//   评分（gradeOf）：没看提示一次拼对 3；看了提示（自己点的或拼错后出来的）再拼对 2；看答案 1。
//
// 导出
//   MODE_ID = 'cloze'；EVENT_MODE = 'cloze'；SECONDS = 30（plan 算时长）；MAX_TRIES = { tiles: 2, keys: 3 }
//   SOURCE_RANK、FROM_ZH（“故事里的一句”……）；PICK_DAYS = 14；PICK_MAX = 12
//   clozeSources({ stories, grammar, order, read, swaps }) -> [Sent]   纯函数
//       stories：reader.js 的 Content（contentWith 换过名字的）或 stories.json 原样；grammar：grammar.js content() 或 grammar.json；
//       order：modes/order.js content() 或 order.json；read：她读过（started / done）的集 id；swaps：[[原名, 她起的名字]]（语法卡和
//       连词成句的句子里换名字；故事用 contentWith 已经换好）
//       Sent = { en, zh, from: 'story' | 'grammar' | 'order', ref: 'ep1:3' | 'g:pronoun:2' | 'o:be1', read, keys: [{ w, zh }], gloss: { w: zh }, speaker }
//   defaultSources(app) -> [Sent]   从已经加载的 reader / grammar / order 内容现拼（kv 'story:names' 换名字、'story:progress' 看读过哪几集）；
//       同样的内容和进度只拼一次
//   findWord(en, word) -> { start, end, text } | null   整词、不分大小写、只出现一次（连字符里的不算）
//   sentencesFor(entry, sents, { now }) -> [Cand]   这个词能用的句子，排好序（Cand = Sent 加 at、meaning、meaningFrom、rank）
//   pickSentence(entry, sents, { now }) -> Cand | null   今天用哪一句
//   canCloze(entry, sources, { curriculum }) -> bool；clozeReady(entries, sources, { curriculum }) -> [slug]（给 app 拼 plan 的 state）
//   clozePicks(cards, { ready, keys, n = 2, season }) -> [slug]   纯函数：热身的单词卡里哪几张换成句子里回想（建议，plan 可以直接用）：
//       在 ready 里、没在今天错过；期中季先挑复习提纲重点词（keys），别的日子先挑开了“写得出”线的、见过次数多的
//   makeCloze(entry, sources, { input = 'tiles', curriculum, now, rng, unit }) -> ClozeQuestion | null   纯函数
//     ClozeQuestion = { id: 'w:<slug>', slug, headword, word（句子里的写法）, unit, input: 'tiles' | 'keys',
//                       kind: 'letter' | 'syllable'（键盘时 'keys'）, given: 已经给的首字母（音节块时 ''）, parts, need,
//                       tiles: [{ id, text, real }]（键盘时 []）, first（首字母，句子里的样子）, before, after,
//                       meaning（括号里的中文）, meaningFrom: 'key' | 'target' | 'gloss' | 'sense' | 'entry',
//                       sentence: { en, zh, from, ref, read, speaker }, fromZh, say（读出来的句子）, right: { word, meaning, parts } }
//   gradeOf({ correct, tries, hintLevel, revealed }) -> 1 | 2 | 3
//   createClozeAttempt(q, { now, retry }) -> 纯状态（不碰 DOM）
//     { tap(id), undo(), type(text)（键盘）, hint() -> { level, zh, say }, check() -> Result | null, reveal() -> Result | null,
//       placed, bank, typed（她拼出来的整词）, rest（键盘框里该有的字）, full, done, correct, grade, tries, hintLevel, hint, events, result }
//     Result = { correct, done, grade, event, hint, kept, revealed }
//     每判一次（和“看答案”）给一条 events 'answer' 的字段（type、sid、step 由 ui-lesson 补）：
//       { item: 'w:<slug>', slug, mode: 'cloze', choice: 她拼出来的整词, correct, first_try, ms, hint_level, misconception: null,
//         input: 'tiles' | 'keys', attempt, from（句子从哪来）, ref（哪一句）, chunks?（字母块：'letter' | 'syllable'）, spell_rule?, revealed?, unit?, retry? }
//   renderCloze(container, q, { onAnswer, onDone, onMiss, say, retry, autoNextMs, backMs }) -> { el, attempt, tap, undo, check, hint,
//       reveal, next, onKey }
//     onAnswer(event) 每判一次；onMiss({ word, wrong }) 每拼错一次；onDone({ grade, correct, events }) 她往下走时一次
//   inputOf(app) -> 'tiles' | 'keys'   设置里 spellMode（或 spellInput）是 'keys' 就用键盘，别的都是字母块
//   clozeMode = { id: 'cloze', label: '句子里回想', render(entry, ctx) -> { el, footer, onKey, question, modeId, eventMode } }
//     和 spellMode、choiceMode 同一个接口；ctx = { app, rate(g, { modeId }), say, position, pool, onAnswer(ev), sources? }
//     找不到句子（或不是必会词）退回 spellMode.render（它再退回四选一）：返回它的结果，modeId 是 'spell' / 'mc4'
//   pickedWords(kv, events, { now, days = 14, max = 12, has, lemma, isBook, reviewed, content }) -> [Picked]   纯函数（不写任何东西）
//     她自己卡过的词：kv 'story:progress' 的 looked（故事里点开看过）、kv 'read:triage' 里期中阅读小篇和课文陪读点过的词、
//     事件 lookup（from 'textread' / 'chat' / 'read'）、事件 read_help（故事里“看不懂”点到第 2 下以上：这句的关键词）、
//     kv 'teacher.asked' 里讲过的词（没有 closed 'learned' 的）、事件 ask（step 'chat'）的 words 里的课本词（要给 isBook）
//     has(slug) 给了就只留单词本里有的（复习得到的）；lemma(word) 把 leaves 变回 leaf；reviewed(slug) 返回上次复习的时间
//     （fsrs.last_review），比最后一次卡住的那天晚就不再算（复习过了）。最近 days 天以内，按卡过几天、最近哪天、点了几次排，最多 max 个
//     Picked = { slug, word, from: ['read' | 'chat'], days: 卡过几天, taps, last: 'YYYY-MM-DD' }
//   pickedSlugs(kv, events, opts) -> [slug]
//
// 依赖：ui-dom.js（h、icon）、modes/choice.js（meaningOf、isRetry）、modes/spell.js（canSpell、chunksFor、decoysFor、spellHint、
// noteMiss、spellMode）、reader.js / grammar.js / modes/order.js（只读它们已经加载的内容）。不直接写数据库：评分走 ctx.rate，事件走 ctx.onAnswer。
import { h, icon } from '../ui-dom.js';
import { meaningOf, isRetry } from './choice.js';
import { canSpell, chunksFor, decoysFor, spellHint, noteMiss, spellMode, spellingAlts } from './spell.js';
import * as R from '../reader.js';
import * as G from '../grammar.js';
import * as O from './order.js';

export const MODE_ID = 'cloze';
export const EVENT_MODE = 'cloze';
export const SECONDS = 30;
export const MAX_TRIES = { tiles: 2, keys: 3 };
// read story sentences first, then the grammar cards' examples, the 连词成句 sentences, stories not read yet, the word's own example
export const SOURCE_RANK = { story: 0, grammar: 1, order: 2, unread: 3, entry: 4 };
export const FROM_ZH = { story: '故事里的一句', unread: '故事里的一句', grammar: '语法卡里的一句', order: '连词成句里的一句', entry: '单词本里的例句' };
export const PICK_DAYS = 14;
export const PICK_MAX = 12;
const MIN_WORDS = 3;
const MAX_WORDS = 16;

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const dayNum = now => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
const low = s => String(s ?? '').toLowerCase().replace(/[’‘]/g, "'");
const str = x => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const arr = x => (Array.isArray(x) ? x : []);
const headOf = e => String((e && (e.headword || e.w || e.word)) || '').trim();
const hashOf = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const slugify = w => R.slugify(w);
const dayStr = x => { const s = str(x); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- the sentences she has read (pure)

const swapper = swaps => {
  const res = arr(swaps).filter(p => Array.isArray(p) && p[0] && p[1] && p[0] !== p[1])
    .map(([from, to]) => [new RegExp(`(?<![A-Za-z])${String(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'g'), String(to)]);
  return s => res.reduce((x, [re, to]) => x.replace(re, to), str(s));
};

// glossary as { w: zh } whatever the file wrote ([{ w, zh }] or { w: zh })
function glossOf(ep) {
  const out = {};
  const g = ep && ep.glossary;
  if (Array.isArray(g)) { for (const x of g) if (x && x.w) out[low(x.w)] = str(x.zh); }
  else if (g && typeof g === 'object') for (const [w, zh] of Object.entries(g)) out[low(w)] = typeof zh === 'string' ? zh : str(zh && zh.zh);
  for (const t of arr(ep && (ep.targets || ep.target_words))) {
    if (t && typeof t === 'object' && t.w && t.zh) out['@' + low(t.w)] = str(t.zh);   // targets marked apart from glossary
  }
  return out;
}

export function clozeSources({ stories = null, grammar = null, order = null, read = [], swaps = [] } = {}) {
  const out = [];
  const readSet = new Set(read instanceof Set ? [...read] : arr(read));
  const sw = swapper(swaps);
  for (const ep of arr(stories && stories.episodes)) {
    if (!ep || !ep.id) continue;
    const gloss = glossOf(ep);
    arr(ep.sentences).forEach((s, k) => {
      if (!s || !s.en) return;
      const i = Number.isFinite(Number(s.i)) && s.i ? Number(s.i) : Number(s.id) || k + 1;
      out.push({ en: str(s.en), zh: str(s.zh), from: 'story', ref: `${ep.id}:${i}`, read: readSet.has(ep.id),
        keys: arr(s.keys).filter(x => x && x.w).map(x => ({ w: str(x.w), zh: str(x.zh) })), gloss, speaker: str(s.speaker) });
    });
  }
  for (const c of arr(grammar && grammar.cards)) {
    arr(c && c.examples).forEach((x, k) => {
      if (x && x.en) out.push({ en: sw(x.en), zh: sw(x.zh), from: 'grammar', ref: `g:${c.id}:${k + 1}`, read: true, keys: [], gloss: {}, speaker: '' });
    });
  }
  for (const it of arr(order && order.items)) {
    if (it && it.en && it.id) out.push({ en: sw(it.en), zh: sw(it.zh), from: 'order', ref: `o:${it.id}`, read: true, keys: [], gloss: {}, speaker: '' });
  }
  return out;
}

// what reader / grammar / order have loaded, with her names; rebuilt only when the content or her progress changes
let memo = { key: '', sents: [] };
const objIds = new WeakMap();
let objN = 0;
const idOf = o => { if (!o || typeof o !== 'object') return 0; if (!objIds.has(o)) objIds.set(o, ++objN); return objIds.get(o); };
export function defaultSources(app = {}) {
  const kv = app && app.kv;
  const peek = (k, d) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d; } catch (e) { return d; } };
  const names = peek(R.NAMES_KEY, null);
  let stories = null, base = null, grammar = null, order = null, read = [];
  try { base = R.content(); stories = (names ? R.contentWith(names) : null) || base; } catch (e) { stories = null; }
  try { grammar = G.content(); } catch (e) { grammar = null; }
  try { order = O.content(); } catch (e) { order = null; }
  try {
    const p = R.readProgress(kv);
    read = Object.entries((p && p.episodes) || {}).filter(([, e]) => e && (e.done || e.started)).map(([id]) => id).sort();
  } catch (e) { read = []; }
  // the names she picked go into the grammar and 连词成句 sentences too (the stories come renamed already)
  let swaps = [];
  try {
    const picked = names ? R.cleanNames(names) : {};
    swaps = arr(base && base.names).filter(n => n && n.replaceable !== false && n.name && picked[n.key] && picked[n.key] !== n.name)
      .map(n => [n.name, picked[n.key]]);
  } catch (e) { swaps = []; }
  const key = [idOf(stories), idOf(grammar), idOf(order), read.join(','), JSON.stringify(swaps)].join('|');
  if (memo.key !== key) memo = { key, sents: clozeSources({ stories, grammar, order, read, swaps }) };
  return memo.sents;
}

// ---------------------------------------------------------------- one word in one sentence (pure)

const TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const wordCount = en => (str(en).match(TOKEN) || []).length;

export function findWord(en, word) {
  const w = low(word).trim();
  if (!w || /\s/.test(w)) return null;
  const s = str(en);
  let hit = null, n = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(s))) {
    if (low(m[0]) !== w) continue;
    const before = s[m.index - 1], after = s[m.index + m[0].length];
    if (before === '-' || after === '-') return null;   // part of high-speed, paper-cutting
    n++;
    hit = { start: m.index, end: m.index + m[0].length, text: m[0] };
  }
  return n === 1 ? hit : null;
}

// no English inside the hint's brackets (回来（come back 回来）would give the answer away)
function cleanMeaning(zh, word) {
  let s = str(zh).trim();
  s = s.replace(/[（(][^）)]*[A-Za-z]{2,}[^）)]*[）)]/g, '').trim();
  // it goes inside brackets itself: 准备好（做某事）的 reads better as 准备好的, unless that leaves one character (（铃）响)
  const bare = s.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (bare.length >= 2) s = bare;
  if (word && new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'i').test(s)) return '';
  return s.replace(/[，,；;、\s]+$/, '');
}

// what the word means in this sentence: its key, the episode's target word or glossary, else the entry's meaning;
// null when a key is a phrase holding the word (point out): the entry's meaning may not be the one here
function meaningIn(sent, word, entry) {
  const w = low(word);
  for (const k of arr(sent.keys)) {
    const kw = low(k.w).trim();
    if (kw === w) { const m = cleanMeaning(k.zh, w); if (m) return { meaning: m, from: 'key' }; }
  }
  if (arr(sent.keys).some(k => / /.test(low(k.w).trim()) && low(k.w).trim().split(/\s+/).includes(w))) return null;
  const g = sent.gloss || {};
  if (g['@' + w]) { const m = cleanMeaning(g['@' + w], w); if (m) return { meaning: m, from: 'target' }; }
  if (g[w]) { const m = cleanMeaning(g[w], w); if (m) return { meaning: m, from: 'gloss' }; }
  const m = cleanMeaning(String(meaningOf(entry)).split(/[；;]/)[0], w);
  return m ? { meaning: m, from: 'entry' } : null;
}

function entrySentences(entry) {
  const out = [];
  arr(entry && entry.senses).forEach((s, k) => {
    if (!s || !s.example) return;
    out.push({ en: str(s.example), zh: str(s.example_cn), from: 'entry', ref: `entry:${k + 1}`, read: true, keys: [], gloss: {}, speaker: '',
      senseCn: str(s.cn) });
  });
  return out;
}

export function sentencesFor(entry, sents = [], { now = new Date() } = {}) {
  const word = headOf(entry);
  if (!word) return [];
  const out = [];
  const all = [...arr(sents), ...entrySentences(entry)];
  for (const s of all) {
    if (!s || !s.en) continue;
    const n = wordCount(s.en);
    if (n < MIN_WORDS || n > MAX_WORDS) continue;
    const at = findWord(s.en, word);
    if (!at) continue;
    let mean = null;
    if (s.from === 'entry') {
      const m = cleanMeaning(String(s.senseCn || '').split(/[；;]/)[0], low(word)) || cleanMeaning(String(meaningOf(entry)).split(/[；;]/)[0], low(word));
      mean = m ? { meaning: m, from: s.senseCn ? 'sense' : 'entry' } : null;
    } else mean = meaningIn(s, word, entry);
    if (!mean) continue;
    const rank = s.from === 'story' ? (s.read ? SOURCE_RANK.story : SOURCE_RANK.unread) : SOURCE_RANK[s.from] ?? SOURCE_RANK.entry;
    out.push({ ...s, at, meaning: mean.meaning, meaningFrom: mean.from, rank, ctx: mean.from === 'entry' ? 1 : 0 });
  }
  out.sort((a, b) => a.rank - b.rank || a.ctx - b.ctx || hashOf(a.ref) - hashOf(b.ref) || a.ref.localeCompare(b.ref));
  // the best group (same source, same kind of meaning) takes turns by day: the same sentence all day, another one tomorrow
  const top = out.filter(x => out.length && x.rank === out[0].rank && x.ctx === out[0].ctx).length;
  if (top > 1) {
    const k = (hashOf(low(word)) + dayNum(now)) % top;
    out.unshift(...out.splice(k, top - k));
  }
  return out;
}

export function pickSentence(entry, sents, opts = {}) {
  const list = sentencesFor(entry, sents, opts);
  return list[0] || null;
}

const sentsOf = sources => (Array.isArray(sources) ? sources : sources && typeof sources === 'object' ? clozeSources(sources) : []);

export function canCloze(entry, sources, { curriculum } = {}) {
  if (!entry || !entry.slug || !canSpell(entry, curriculum)) return false;
  return sentencesFor(entry, sentsOf(sources)).length > 0;
}

export function clozeReady(entries, sources, { curriculum } = {}) {
  const sents = sentsOf(sources);
  return arr(entries).filter(e => canCloze(e, sents, { curriculum })).map(e => e.slug);
}

// which warm-up word cards become 句子里回想 today (a suggestion plan.js can use as it is): in ready, not wrong today;
// in exam season the outline's key words first, other days the words on the 写得出 line and the ones seen most
export function clozePicks(cards, { ready = [], keys = [], n = 2, season = false, now = new Date() } = {}) {
  const ok = new Set(ready instanceof Set ? [...ready] : arr(ready));
  const key = new Set(keys instanceof Set ? [...keys] : arr(keys));
  const reps = w => (w && w.fsrs && w.fsrs.reps) || (w && w.reps) || 0;
  const list = arr(cards).filter(w => w && w.slug && ok.has(w.slug) && !w.isNew && !isRetry(w, now));
  const score = w => (season ? (key.has(w.slug) ? 0 : 2) : 0) + (w.write ? 0 : 1);
  return list.map((w, i) => ({ w, i })).sort((a, b) => score(a.w) - score(b.w) || reps(b.w) - reps(a.w) || a.i - b.i)
    .slice(0, Math.max(0, n)).map(x => x.w.slug);
}

// ---------------------------------------------------------------- the question (pure)

export function makeCloze(entry, sources, { input = 'tiles', curriculum, now = new Date(), rng = Math.random, unit } = {}) {
  if (!entry || !entry.slug || !canSpell(entry, curriculum)) return null;
  const cand = pickSentence(entry, sentsOf(sources), { now });
  if (!cand) return null;
  const text = cand.en.slice(cand.at.start, cand.at.end);
  const headword = headOf(entry);
  const keys = input === 'keys';
  let kind = 'keys', given = text[0], parts = [...text.slice(1)], tiles = [];
  if (!keys) {
    const c = chunksFor(text);
    kind = c.kind;
    if (kind === 'syllable') { given = ''; parts = c.parts.slice(); }
    else { given = text[0]; parts = [...text.slice(1)]; }
    const n = parts.length <= 2 || (kind === 'letter' && text.length <= 4) ? 1 : 2;
    const decoys = decoysFor(text, { kind, parts: kind === 'letter' ? [...text] : parts }, { rng, n });
    const all = [...parts.map(t => ({ text: t, real: true })), ...decoys.map(t => ({ text: t, real: false }))];
    let t = shuffle(all, rng);
    // never hand her the answer already in order
    const inOrder = x => x.slice(0, parts.length).every(y => y.real) && x.filter(y => y.real).map(y => y.text).join('') === parts.join('');
    for (let k = 0; k < 6 && inOrder(t); k++) t = shuffle(all, rng);
    if (inOrder(t)) t.push(t.shift());
    tiles = t.map((x, i) => ({ id: 't' + i, ...x }));
  }
  if (!parts.length) return null;
  const from = cand.from === 'story' && !cand.read ? 'unread' : cand.from;
  return {
    id: 'w:' + entry.slug,
    slug: entry.slug,
    headword,
    word: text,
    alts: spellingAlts(text, curriculum),
    unit: unit || entry.unit || null,
    input: keys ? 'keys' : 'tiles',
    kind,
    given,
    parts,
    need: parts.length,
    tiles,
    first: text[0],
    before: cand.en.slice(0, cand.at.start),
    after: cand.en.slice(cand.at.end),
    meaning: cand.meaning,
    meaningFrom: cand.meaningFrom,
    sentence: { en: cand.en, zh: cand.zh, from: cand.from, ref: cand.ref, read: !!cand.read, speaker: cand.speaker || '' },
    fromZh: FROM_ZH[from] || '',
    say: cand.en,
    right: { word: text, meaning: cand.meaning, parts: kind === 'syllable' ? parts.slice() : [text] },
  };
}

// ---------------------------------------------------------------- attempt (pure state)

export const gradeOf = ({ correct, tries = 1, hintLevel = 0, revealed = false } = {}) =>
  (revealed || !correct ? 1 : tries <= 1 && hintLevel <= 0 ? 3 : 2);

export function createClozeAttempt(q, { now = () => Date.now(), retry = false } = {}) {
  const t0 = now();
  const keys = q.input === 'keys';
  const max = MAX_TRIES[keys ? 'keys' : 'tiles'];
  const byId = new Map(q.tiles.map(t => [t.id, t]));
  const word = low(q.word);
  // 10-26: another spelling the 课标 lists (gray for grey, center for centre) is right too
  const alts = Array.isArray(q.alts) ? q.alts : [];
  let placed = [], typedRaw = '', tries = 0, hintLevel = 0, hint = null, result = null;
  const events = [];
  // the whole word she has: the given letter plus what she placed, or what she typed (the rest, or all of it)
  // (the box after the given letter takes the rest; the whole word typed out counts too)
  const typed = () => {
    if (!keys) return q.given + placed.map(id => byId.get(id).text).join('');
    const t = String(typedRaw).replace(/\s+/g, '');
    if (!t) return '';
    return low(t) === word || alts.includes(low(t)) ? t : q.given + t;
  };
  const event = (correct, extra = {}) => {
    const ev = {
      item: q.id, slug: q.slug, mode: EVENT_MODE, choice: typed(), correct, first_try: !retry && tries <= 1 && !extra.revealed,
      ms: Math.max(0, now() - t0), hint_level: hintLevel, misconception: null, input: q.input, attempt: Math.max(1, tries),
      from: q.sentence.from, ref: q.sentence.ref, ...(keys ? {} : { chunks: q.kind }), ...extra,
    };
    if (q.unit) ev.unit = q.unit;
    if (retry) ev.retry = true;
    events.push(ev);
    return ev;
  };
  const finish = (correct, revealed, ev) => {
    result = { correct, done: true, grade: gradeOf({ correct, tries, hintLevel, revealed }), event: ev, hint, kept: 0, revealed };
    return result;
  };
  const prefixLen = got => { let k = 0; const g = low(got); while (k < g.length && k < word.length && g[k] === word[k]) k++; return k; };
  return {
    get placed() { return placed.map(id => byId.get(id)); },
    get bank() { return q.tiles.filter(t => !placed.includes(t.id)); },
    get typed() { return typed(); },
    get rest() { return keys ? typedRaw : placed.map(id => byId.get(id).text).join(''); },
    get full() { return keys ? !!String(typedRaw).trim() : placed.length >= q.need; },
    get done() { return !!result; },
    get correct() { return result ? result.correct : null; },
    get grade() { return result ? result.grade : null; },
    get tries() { return tries; },
    get hintLevel() { return hintLevel; },
    get hint() { return hint; },
    get events() { return events.slice(); },
    get result() { return result; },
    tap(id) {
      if (result || keys || !byId.has(id)) return false;
      if (placed.includes(id)) placed = placed.filter(x => x !== id);
      else if (placed.length < q.need) placed.push(id);
      else return false;
      return true;
    },
    undo() { if (result || keys || !placed.length) return false; placed.pop(); return true; },
    type(text) { if (result || !keys) return false; typedRaw = String(text ?? '').replace(/[^A-Za-z'’-]/g, ''); return true; },
    // the first hint (her own tap): the whole sentence in Chinese and read aloud; costs the 3
    hint() {
      if (result) return null;
      hintLevel = Math.max(hintLevel, 1);
      return { level: hintLevel, zh: q.sentence.zh, say: q.say };
    },
    check() {
      if (result || !typed() || (!keys && !placed.length)) return null;
      tries++;
      const got = typed();
      if (low(got) === word || alts.includes(low(got))) return finish(true, false, event(true));
      if (tries >= max) {
        hintLevel = Math.max(hintLevel, 2);
        return finish(false, true, event(false, { revealed: true }));
      }
      // keep the right beginning, one line of rule; on the keyboard the second slip also gives one more letter
      const rule = spellHint(q.word, got);
      hintLevel = Math.max(hintLevel, tries);
      const k = prefixLen(got);
      const ev = event(false, rule && rule.id ? { spell_rule: rule.id } : {});
      let kept = 0;
      if (keys) {
        const show = tries >= 2 ? Math.min(word.length - 1, Math.max(k, 1) + 1) : Math.max(k, 1);
        typedRaw = q.word.slice(1, show);
        kept = show;
        hint = { rule, level: hintLevel, zh: q.sentence.zh, say: q.say, letters: tries >= 2 ? q.word.slice(0, show) : '' };
      } else {
        let j = 0;
        while (j < placed.length && j < q.parts.length && low(byId.get(placed[j]).text) === low(q.parts[j])) j++;
        placed = placed.slice(0, j);
        kept = j;
        hint = { rule, level: hintLevel, zh: q.sentence.zh, say: q.say, letters: '' };
      }
      return { correct: false, done: false, grade: null, event: ev, hint, kept };
    },
    reveal() {
      if (result) return null;
      hintLevel = 2;
      return finish(false, true, event(false, { revealed: true }));
    },
  };
}

// ---------------------------------------------------------------- rendering

export function renderCloze(container, q, { onAnswer, onDone, onMiss, say, retry = false, autoNextMs = 1800, backMs = 650 } = {}) {
  const el = container;
  const keys = q.input === 'keys';
  const attempt = createClozeAttempt(q, { retry });
  let left = false, timer = 0, hold = false;
  const speak = (text, btn) => { if (text && say) { try { say(text, btn || null); } catch (e) { /* sound is optional */ } } };
  const report = ev => { if (onAnswer && ev) { try { onAnswer(ev); } catch (e) { /* bookkeeping never blocks the answer */ } } };
  const next = () => {
    if (!attempt.done || left) return;
    left = true;
    clearTimeout(timer);
    if (onDone) onDone({ grade: attempt.grade, correct: attempt.correct, events: attempt.events });
  };

  // the sentence, the blank (the given letter and what she has so far) and the meaning in brackets
  const given = h('span', { className: 'cloze-given', text: q.given || q.first });
  const fill = h('span', { className: 'cloze-fill' });
  const blank = h('span', { className: 'cloze-blank', 'aria-label': '要填的词' }, given, fill);
  const cue = h('span', { className: 'cloze-cue', lang: 'zh-CN', text: `（${q.meaning}）` });
  const line = h('p', { className: 'cloze-line', lang: 'en' }, q.before, blank, cue, q.after);
  const zhSay = h('button', { type: 'button', className: 'say cloze-say', 'aria-label': '听这句', on: { click: ev => speak(q.say, ev.currentTarget) } }, icon('speak'));
  const zhLine = h('p', { className: 'cloze-zh', lang: 'zh-CN', hidden: true }, h('span', { text: q.sentence.zh || '' }), zhSay);
  const hintBox = h('p', { className: 'cloze-hint', hidden: true, role: 'note' });
  const feedback = h('p', { className: 'cloze-feedback', role: 'status', 'aria-live': 'polite' });
  const title = h('p', { className: 'cloze-title small', text: '句子里回想' + (q.fromZh ? ' · ' + q.fromZh : '') });
  const ask = h('p', { className: 'cloze-ask small', text: keys ? '首字母给你了，把这个词打出来。' : '首字母给你了，把这个词拼出来。' });

  const hintBtn = h('button', { type: 'button', className: 'text-btn cloze-hint-btn', text: '提示', on: { click: () => giveHint() } });
  const revealBtn = h('button', { type: 'button', className: 'text-btn cloze-reveal', text: '看答案', on: { click: () => reveal() } });
  const nextBtn = h('button', { type: 'button', className: 'btn cloze-next', text: '下一个', hidden: true, on: { click: next } });

  let answer = null, bank = null, bankBtns = null, inputEl = null, checkBtn = null;
  if (keys) {
    inputEl = h('input', { type: 'text', className: 'cloze-input', lang: 'en', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      spellcheck: 'false', enterkeyhint: 'done', 'aria-label': '后面的字母',
      on: { input: ev => { attempt.type(ev.target.value); drawFill(); }, keydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); check(); } } } });
    checkBtn = h('button', { type: 'button', className: 'btn cloze-check', text: '检查', on: { click: () => check() } });
    answer = h('div', { className: 'cloze-keys' }, h('span', { className: 'cloze-keys-given', lang: 'en', text: q.given }), inputEl, checkBtn);
  } else {
    answer = h('div', { className: 'cloze-answer', role: 'group', 'aria-label': '你拼的词' });
    bank = h('div', { className: 'cloze-bank', role: 'group', 'aria-label': '字母块' });
    bankBtns = new Map(q.tiles.map(t => [t.id, h('button', {
      type: 'button', className: 'cloze-tile', lang: 'en', dataset: { id: t.id }, text: t.text, 'aria-label': t.text, on: { click: () => tap(t.id) },
    })]));
    bank.replaceChildren(...bankBtns.values());
  }

  // syllable tiles carry the first letter themselves: the hint letter shows only while the blank is empty
  function drawFill(state = '') {
    fill.textContent = attempt.rest;
    if (!q.given) given.textContent = attempt.rest ? '' : q.first;
    blank.className = 'cloze-blank' + (state ? ' ' + state : '') + (attempt.rest || q.given ? ' has-fill' : '');
  }
  function fillWord(state) {
    given.textContent = q.word[0];
    fill.textContent = q.word.slice(1);
    blank.className = 'cloze-blank has-fill ' + state;
  }
  function drawTiles(state = '') {
    if (keys) return;
    const placed = attempt.placed;
    const cells = [];
    if (q.given) cells.push(h('span', { className: 'cloze-tile cloze-placed cloze-fixed', lang: 'en', text: q.given, 'aria-label': '首字母 ' + q.given }));
    for (const t of placed) cells.push(h('button', { type: 'button', className: 'cloze-tile cloze-placed' + (state ? ' ' + state : ''), lang: 'en', text: t.text,
      'aria-label': '拿掉 ' + t.text, disabled: attempt.done || hold, on: { click: () => tap(t.id) } }));
    for (let i = placed.length; i < q.need; i++) cells.push(h('span', { className: 'cloze-slot', 'aria-hidden': 'true' }));
    answer.replaceChildren(...cells);
    for (const [id, b] of bankBtns) {
      const used = placed.some(t => t.id === id);
      if (used) b.classList.add('used'); else b.classList.remove('used');
      b.disabled = used || attempt.done || hold;
      b.setAttribute('aria-hidden', used ? 'true' : 'false');
    }
  }
  const draw = state => { drawFill(state); drawTiles(state); };

  function tap(id) {
    if (attempt.done || hold) return;
    if (!attempt.tap(id)) return;
    el.classList.remove('is-wrong');
    draw();
    if (attempt.full) check();
  }
  function undo() { if (attempt.done || hold) return; if (attempt.undo()) draw(); }

  function showZh() { if (q.sentence.zh) zhLine.hidden = false; }
  function giveHint() {
    if (attempt.done) return;
    const r = attempt.hint();
    if (!r) return;
    showZh();
    hintBtn.hidden = true;
    speak(q.say);
  }

  function lockInput() {
    if (inputEl) { inputEl.disabled = true; try { inputEl.blur(); } catch (e) { /* old WebKit */ } }
    if (checkBtn) checkBtn.hidden = true;
    if (bankBtns) for (const b of bankBtns.values()) b.disabled = true;
    hintBtn.hidden = true;
    revealBtn.hidden = true;
  }
  function showRight(r) {
    el.classList.add('is-right');
    drawTiles('right');
    fillWord('right');
    lockInput();
    showZh();
    feedback.textContent = r.grade === 3 ? '拼对了。' : '对了。';
    // another spelling (gray for grey): right; the blank shows the sentence's spelling, and this says so
    const got = low(attempt.typed);
    const other = got && got !== low(q.word);
    if (other) feedback.textContent += `这句里写 ${q.word}，${got} 是另一种写法，也对。`;
    speak(q.say);
    timer = setTimeout(next, other ? Math.max(autoNextMs, 2500) : autoNextMs);
    nextBtn.hidden = false;
  }
  function showAnswer() {
    el.classList.add('is-revealed');
    fillWord('reveal');
    if (!keys) answer.replaceChildren(...(q.kind === 'syllable' ? q.parts : [q.word]).map(p => h('span', { className: 'cloze-tile cloze-placed reveal', lang: 'en', text: p })));
    else if (inputEl) inputEl.value = q.word.slice(1);
    lockInput();
    showZh();
    feedback.textContent = `是 ${q.kind === 'syllable' ? q.parts.join('·') : q.word}。` + (q.meaning ? `“${q.meaning}”。` : '');
    nextBtn.hidden = false;
    speak(q.say);
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
  }

  function check() {
    if (attempt.done || hold) return;
    const wrongIds = keys ? [] : attempt.placed.map(t => t.id);
    const r = attempt.check();
    if (!r) return;
    report(r.event);
    if (r.correct) { showRight(r); return; }
    if (onMiss) { try { onMiss({ word: q.word, wrong: r.event.choice }); } catch (e) { /* bookkeeping never blocks the answer */ } }
    if (r.done) { showAnswer(); return; }
    el.classList.add('is-wrong');
    showZh();
    hintBtn.hidden = true;
    const rule = r.hint && r.hint.rule && r.hint.rule.text ? r.hint.rule.text : '';
    const more = r.hint && r.hint.letters ? `再给你一个字母：${r.hint.letters}。` : '';
    const kept = keys ? r.kept > 1 : r.kept > 0;
    hintBox.textContent = (kept && !more ? '对的开头留着了。' : '') + more + (rule || (more ? '' : '看看整句的意思，再听一遍。'));
    hintBox.hidden = false;
    feedback.textContent = '';
    speak(q.say);
    if (keys) {
      inputEl.value = attempt.rest;
      drawFill();
      try { inputEl.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
      return;
    }
    const back = () => { hold = false; draw(); };
    if (backMs > 0) {
      hold = true;
      answer.replaceChildren(...[
        q.given ? h('span', { className: 'cloze-tile cloze-placed cloze-fixed', lang: 'en', text: q.given }) : null,
        ...wrongIds.map((id, i) => h('span', { className: 'cloze-tile cloze-placed' + (i >= r.kept ? ' wrong' : ''), lang: 'en', text: q.tiles.find(t => t.id === id).text })),
      ].filter(Boolean));
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

  el.classList.add('cloze');
  el.classList.add(keys ? 'cloze-by-keys' : q.kind === 'syllable' ? 'cloze-syllable' : 'cloze-letter');
  el.replaceChildren(...[
    h('div', { className: 'cloze-q' }, title, line, ask),
    zhLine, answer, bank, hintBox, feedback,
    h('div', { className: 'btn-row cloze-actions' }, hintBtn, revealBtn, nextBtn),
  ].filter(Boolean));
  draw();
  if (inputEl) setTimeout(() => { try { inputEl.focus({ preventScroll: true }); } catch (e) { /* the keyboard opens on her tap */ } }, 0);

  function onKey(ev) {
    if (!ev || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (attempt.done) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); next(); } return; }
    if (keys) return;   // the input box takes its own keys (Enter checks)
    if (ev.key === 'Backspace') { ev.preventDefault(); undo(); return; }
    if (/^[a-z]$/i.test(ev.key || '')) {
      const t = attempt.bank.find(x => low(x.text).startsWith(low(ev.key)));
      if (t) { ev.preventDefault(); tap(t.id); }
    }
  }
  return { el, attempt, tap, undo, check, hint: giveHint, reveal, next, onKey, type: text => { if (inputEl) inputEl.value = text; attempt.type(text); drawFill(); } };
}

// ---------------------------------------------------------------- the mode (same interface as spellMode)

export function inputOf(app) {
  try {
    const s = app && typeof app.settings === 'function' ? app.settings() : null;
    return s && (s.spellMode === 'keys' || s.spellInput === 'keys') ? 'keys' : 'tiles';
  } catch (e) { return 'tiles'; }
}

export const clozeMode = {
  id: MODE_ID,
  label: '句子里回想',
  render(e, ctx = {}) {
    const app = ctx.app || {};
    let sources = [];
    try { sources = ctx.sources || defaultSources(app); } catch (err) { sources = []; }
    let q = null;
    try { q = makeCloze(e, sources, { input: ctx.input || inputOf(app), curriculum: app.curriculum }); } catch (err) { q = null; }
    // no sentence for this word: a plain spelling card (which itself falls back to four choices)
    if (!q) return spellMode.render(e, ctx);
    const el = h('article', { className: 'cloze' });
    const view = renderCloze(el, q, {
      say: ctx.say, retry: isRetry(e), onAnswer: ctx.onAnswer, ...(Number.isFinite(ctx.autoNextMs) ? { autoNextMs: ctx.autoNextMs } : {}),
      onMiss: ({ word, wrong }) => noteMiss(word, wrong, app.kv),
      onDone: ({ grade }) => ctx.rate && ctx.rate(grade, { modeId: MODE_ID }),
    });
    return { el, footer: null, onKey: view.onKey, question: q, modeId: MODE_ID, eventMode: EVENT_MODE };
  },
};

// ---------------------------------------------------------------- the words she got stuck on (pure)

// story taps are already in 'story:progress' looked; these are the other places she reads
const READ_LOOKUPS = new Set(['textread', 'read', 'passage']);
export function pickedWords(kv, events = [], { now = new Date(), days = PICK_DAYS, max = PICK_MAX, has = null, lemma = null, isBook = null,
  reviewed = null, content = null } = {}) {
  const peek = (k, d) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d; } catch (e) { return d; } };
  const today = dayOf(now);
  const since = dayOf(addDays(now, -days));
  const map = new Map();
  const slugFor = word => {
    const w = str(word).trim();
    if (!w || !/[a-z]/i.test(w)) return '';
    const tries = [w];
    if (typeof lemma === 'function') { try { const b = lemma(w); if (b && b !== w) tries.push(b); } catch (e) { /* no lemma */ } }
    if (typeof has !== 'function') return slugify(tries[1] || w);
    for (const t of tries) { const s = slugify(t); if (has(s)) return s; }
    return '';
  };
  const add = (word, from, day, taps = 1) => {
    const d = dayStr(day) || today;
    if (d < since || d > today) return;
    const slug = slugFor(word);
    if (!slug) return;
    const p = map.get(slug) || { slug, word: str(word).trim(), from: new Set(), dayset: new Set(), taps: 0, last: '' };
    p.from.add(from);
    p.dayset.add(d);
    p.taps += Math.max(1, Number(taps) || 1);
    if (d > p.last) p.last = d;
    map.set(slug, p);
  };
  // the stories: every word she opened (reader.js noteTap keeps the base form)
  const prog = peek('story:progress', null);
  for (const [w, x] of Object.entries((prog && typeof prog === 'object' && prog.looked && typeof prog.looked === 'object') ? prog.looked : {})) {
    if (x && typeof x === 'object') add(w, 'read', x.last, Math.min(5, Number(x.n) || 1));
  }
  // 期中阅读小篇 and 课文陪读 (the stories are counted above)
  const tri = peek('read:triage', null);
  for (const [id, e] of Object.entries((tri && tri.eps && typeof tri.eps === 'object') ? tri.eps : {})) {
    if (/^ep\d+$/.test(id) || !e) continue;
    for (const r of arr(e.log)) if (r && r.kind === 'word' && r.w) add(r.w, 'read', r.day);
  }
  const ct = content || (() => { try { return R.content(); } catch (e) { return null; } })();
  for (const ev of arr(events)) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'lookup' && (ev.from === 'chat' || READ_LOOKUPS.has(ev.from))) {
      add(ev.slug || ev.query, ev.from === 'chat' ? 'chat' : 'read', ev.at);
    } else if (ev.type === 'read_help' && ev.kind === 'sentence' && Number(ev.level) >= 2 && /^ep:/.test(str(ev.item))) {
      // 看不懂 to the second step or further: the sentence's key words are what she was missing
      const m = str(ev.item).match(/^ep:([^:]+):s(\d+)$/);
      const ep = m && ct && typeof ct.episode === 'function' ? ct.episode(m[1]) : null;
      const s = ep && arr(ep.sentences).find(x => Number(x.i) === Number(m[2]));
      for (const k of arr(s && s.keys)) if (k && k.w && !/\s/.test(str(k.w).trim())) add(k.w, 'read', ev.at);
    } else if (ev.type === 'ask' && (ev.step === 'chat' || ev.qid === 'chat') && typeof isBook === 'function') {
      for (const w of arr(ev.words)) { try { if (w && isBook(w)) add(w, 'chat', ev.at); } catch (e) { /* skip */ } }
    }
  }
  // 我问过的 words (teacher.js), until they count as learned
  const asked = peek('teacher.asked', null);
  for (const x of Object.values((asked && asked.items && typeof asked.items === 'object') ? asked.items : {})) {
    if (!x || x.type !== 'word' || x.closed === 'learned') continue;
    add(x.slug || x.word, 'chat', x.last || x.first);
  }
  const out = [];
  for (const p of map.values()) {
    if (typeof reviewed === 'function') {
      let r = '';
      try { r = dayStr(reviewed(p.slug)); } catch (e) { r = ''; }
      if (r && r > p.last) continue;   // reviewed after the last time she got stuck on it
    }
    out.push({ slug: p.slug, word: p.word, from: [...p.from].sort(), days: p.dayset.size, taps: p.taps, last: p.last });
  }
  return out.sort((a, b) => b.days - a.days || b.last.localeCompare(a.last) || b.taps - a.taps || a.slug.localeCompare(b.slug)).slice(0, Math.max(0, max));
}

export const pickedSlugs = (kv, events, opts) => pickedWords(kv, events, opts).map(x => x.slug);
