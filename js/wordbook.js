// 单词本的积累（Wei 10-25，第 5 批）：每个词从哪来、掌握到哪一档、她自己加词、选几个词现在练一下、每个词的卡片、
// 顶部一句这周的进步。列表本身在 ui-lib.js，这里是它用的纯函数和三块界面（加词、卡片、练一下）。样式 css/wordbook.css（类名 wb-）。
// 负责：单词本 agent（wordbook.js、css/wordbook.css、ui-lib.js、tests/wordbook.test.mjs）。
//
// 从哪来（sourcesOf，一个词可以有好几个来源，第一个是它最早怎么进来的）
//   self 我自己加的   kv 'wordbook.own' 里有它（这里的加词写的）
//   story 故事        kv 'story:progress' 的 added 有它（阅读器“加进单词本”）；第几集看 words[slug].first 或 looked[原形].ep
//   textread 课文陪读 词条 history 有 source 'story' 的那条，但不在故事的 added 里（课文陪读也用 reader.placeholderExport）
//   screen 摸底       词条 history 有 source 'screen'（505 摸底说“没学过”加进来的）
//   chat 问老师       kv 'teacher.asked' 有这个词，或事件 ask（step 'chat'）的 words 里有它
//   look 查词         词条有真查过的记录（words.lookupEvents，不算导入和重新生成）
//   textbook 课本     词条的 unit（或 curriculum.unitOf），标签写“课本 Unit 2”；词条 source 是 textbook / photo 时排第一
//   mistake 错题      家长问卷里写的错词（ctx.intake().review.slugs）、纸笔听写写错过、或者第一次就答错过 2 次以上
//
// 掌握到哪一档（levelOf）：两条线（DESIGN 5.1“认得 / 写得出”）各看自己的判据
//   write 会写   weekly.js 的“会写了”（metDays：跨天 3 次客观题答对，首尾隔 2 天，至少一次在拼写或新句子里），
//                或 kv 'weekly.tally'.written 记过（事件清掉以后也认）
//   know  认得   FSRS 卡片评过一次“模糊”以上（reviews 里 rating ≥ 2），或卡片已经在 Review
//   new   没见过 别的（还没在复习里认出来过）
// 筛选（flagsOf）
//   shaky 我不熟的   不是“会写”，并且：错过（第一次就错）、FSRS 忘过（lapses）、卡片在 Learning / Relearning、最后一次评分 ≤ 2
//                    之一；“没见过”的只有错过才算
//   fading 快忘的    评过分的卡片，现在记得的概率（fsrs.retrievability）低于 FADE_R
//   week 这周新加的  favorited_at 在这周一以后
//
// 导出（纯函数，不碰 DOM）
//   KV_KEY = 'wordbook.own'   { v: 1, words: { slug: { at, typed, where, cn } }, updated }   她自己加的词和她写的“在哪看到”
//   SOURCES [[kind, 标签]]、LEVELS { new, know, write }、FILTER_ZH、FADE_R = 0.85、PRACTICE_MAX = 12、PRACTICE_QUICK = 8
//   weekStart(now) -> 'YYYY-MM-DD'（这周一）
//   readOwn(kv) -> { v, words, updated }（坏数据读成空的）
//   buildFacts({ entries, kv, events, curriculum, intake, now }) -> Facts   一次算好列表要的东西
//     Facts = { written: { slug: 日子 }, misses: { slug: n }, dictWrong: Set, boost: Set, own, storyAdded: Set, storyEp: { slug: epId },
//               chatWords: Set(小写词), asked: Set(slug), episodes: { epId: n }, curriculum, now }
//   epLabel(epId, facts) -> '故事第 2 集'
//   sourcesOf(entry, facts) -> [{ kind, label }]
//   levelOf(entry, facts) -> 'new' | 'know' | 'write'
//   flagsOf(entry, facts) -> { shaky, fading, week }
//   weekLine(entries, facts) -> 顶部一句：“这周新认得 12 个，会写 5 个。”（没有新进展时说单词本里有多少）
//   textbookMeaning(entry, curriculum) -> { cn, unit } | null   课本词表上的中文
//   shortCn(cn) -> 离线词典中文的头两个意思
//   ownCandidate(raw, { dict, words }) -> { status: 'bad' | 'inbook' | 'entry' | 'new' | 'nodict', q, slug?, headword?, cn?, phonetic?, via?, msg? }
//   ownExport(cand, { typed, where, now }) -> emma-export（一个词条，favorited、needs_core，history 一条 source 'self'，原句放 context）
//   noteOwn(own, cand, { typed, where, now }) -> own
//   sentencePool({ kv, stories, entry }) -> [{ en, zh, where }]   她遇见过的句子：读过的故事、课文陪读、问老师、查词时的原句、她写的“在哪看到”
//   sentencesMet(entry, pool, { lemma, max }) -> [{ en, zh, where }]
//   pickModes(entries, { canSpell, single }) -> [{ slug, want: 'mc4' | 'listen' | 'tiles' | 'cloze' }]   题型轮着来
//   practiceSummary(results) -> { right: [slug], again: [slug] }
//
// 导出（界面，ctx 是 app.js 的 ctx）
//   renderAdd(container, ctx, { onAdded(slug), onClose, onOpen(slug) }) -> { el, focus() }
//   renderCard(container, ctx, entry, facts, { onPractice(slugs), onFull(slug) }) -> { el }
//     0.8.2（Wei 10-26）：卡片上多一块“词性”：n. 名词、它是干什么的、一个记得住的画面、词尾规律（-ous 结尾多半是形容词），
//     还能作别的词性的写“也可以作动词”（pos.js posLine；词性小卡和课标详表第一次打开卡片时读进来，读到了重画这张卡）
//   cardPos(entry, curriculum) -> pos.js posLine 的结果 | null（短语、没有词性的词是 null）
//   createPractice(container, ctx, { slugs, onExit(results) }) -> Promise<{ el, onKey(ev), stop(), inSession() }>
//     题型用现有的 choice / listen / spell / cloze（动态加载，和上课一样的 mode 接口；0.8.2 字母块换成 pos.js posSpellMode，
//     题面多一行词性）。每判一次记 events 'answer'
//     （step 'wordbook'、sid、unit）。不给 FSRS 评分（复习的日子还是热身说了算），所以随便练不打乱复习；
//     她的答题照样算进“会写了”。第一次没对的词最后再出一次。
import { h, icon } from './ui-dom.js';
import { State, retrievability } from './fsrs.js';
import { slugify, localIso, lookupEvents } from './words.js';
import { metDays, TALLY_KEY } from './weekly.js';
import * as R from './reader.js';
import { posLine, loadPos } from './pos.js';

export const KV_KEY = 'wordbook.own';
export const SOURCES = [['self', '我自己加的'], ['story', '故事'], ['textread', '课文陪读'], ['chat', '问老师'], ['look', '查词'],
  ['textbook', '课本'], ['mistake', '错题'], ['screen', '摸底']];
export const SOURCE_ZH = Object.fromEntries(SOURCES);
export const LEVELS = { new: '没见过', know: '认得', write: '会写' };
export const FILTER_ZH = { shaky: '我不熟的', fading: '快忘的', week: '这周新加的' };
export const FADE_R = 0.85;
export const PRACTICE_MAX = 12;
export const PRACTICE_QUICK = 8;
const BOOK_SOURCES = new Set(['textbook', 'textbook-draft', 'photo']);

const str = v => (v == null ? '' : String(v));
const low = v => str(v).toLowerCase().trim();
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = v => (v instanceof Date ? v : new Date(v == null ? Date.now() : v));
const peek = (kv, k, d) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d; } catch (e) { return d; } };
const keysOf = (kv, p) => { try { return kv && typeof kv.keys === 'function' ? kv.keys(p) : []; } catch (e) { return []; } };
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { return undefined; } };

export function weekStart(now = new Date()) {
  const d = toDate(now);
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return dayOf(x);
}

export function readOwn(kv) {
  const raw = obj(peek(kv, KV_KEY, null));
  const words = {};
  for (const [slug, w] of Object.entries(obj(raw.words))) if (w && typeof w === 'object') words[slug] = { at: str(w.at), typed: str(w.typed), where: str(w.where), cn: str(w.cn) };
  return { v: 1, words, updated: str(raw.updated) };
}

// ---------------------------------------------------------------- facts

export function buildFacts({ entries = [], kv = null, events = [], curriculum = null, intake = null, now = new Date() } = {}) {
  const t = toDate(now);
  const written = {};
  const tally = obj(peek(kv, TALLY_KEY, null));
  for (const [slug, d] of Object.entries(obj(tally.written))) if (d) written[slug] = str(d);
  let met = {};
  try { met = metDays(arr(events)) || {}; } catch (e) { met = {}; }
  for (const [slug, d] of Object.entries(met)) if (!written[slug] || str(d) < written[slug]) written[slug] = str(d);

  const misses = {};
  const dictWrong = new Set();
  const chatWords = new Set();
  for (const ev of arr(events)) {
    if (!ev) continue;
    if (ev.type === 'answer' && ev.slug && ev.correct === false && ev.first_try !== false) misses[ev.slug] = (misses[ev.slug] || 0) + 1;
    else if (ev.type === 'dictation' && ev.slug && ev.correct === false) { misses[ev.slug] = (misses[ev.slug] || 0) + 1; dictWrong.add(ev.slug); }
    else if (ev.type === 'ask' && ev.step === 'chat') for (const w of arr(ev.words)) { const x = low(typeof w === 'string' ? w : w && (w.w || w.word)); if (x) chatWords.add(x); }
  }

  const asked = new Set();
  for (const it of Object.values(obj(obj(peek(kv, 'teacher.asked', null)).items))) {
    if (it && it.type === 'word') { if (it.slug) asked.add(it.slug); if (it.word) chatWords.add(low(it.word)); }
  }

  let prog = null;
  try { prog = R.readProgress(kv); } catch (e) { prog = null; }
  const storyAdded = new Set(arr(prog && prog.added));
  const storyEp = {};
  for (const [slug, w] of Object.entries(obj(prog && prog.words))) if (w && w.first) storyEp[slug] = w.first;
  const looked = obj(prog && prog.looked);
  const episodes = {};
  try { for (const ep of arr((R.content() || {}).episodes)) if (ep && ep.id) episodes[ep.id] = ep.n; } catch (e) { /* stories not loaded */ }

  let boost = [];
  try { const d = typeof intake === 'function' ? intake() : intake; boost = arr(d && d.review && d.review.slugs); } catch (e) { boost = []; }

  return { written, misses, dictWrong, boost: new Set(boost), own: readOwn(kv).words, storyAdded, storyEp, looked, chatWords, asked,
    episodes, curriculum, now: t, week: weekStart(t), entries: arr(entries).length };
}

export function epLabel(epId, facts = {}) {
  const id = str(epId);
  if (!id) return '故事';
  const n = (facts.episodes || {})[id] ?? (id.match(/\d+/) || [])[0];
  return n ? `故事第 ${n} 集` : '故事';
}

const shortUnit = t => { const s = str(t); const m = s.match(/^(Unit \d+|Starter)\b/i); return m ? m[1] : s; };
function unitOf(e, cur) {
  if (e.unit) return e.unit;
  return call(cur && cur.unitOf, e.headword) || '';
}
function unitLabel(unit, cur) {
  if (!unit) return '课本';
  const title = call(cur && cur.unitTitle, unit) || unit;
  return '课本 ' + shortUnit(title);
}

export function sourcesOf(e, facts = {}) {
  if (!e) return [];
  const out = [];
  const add = (kind, label) => { if (!out.some(x => x.kind === kind)) out.push({ kind, label: label || SOURCE_ZH[kind] }); };
  const hist = arr(e.history).filter(x => x && x.source);
  const has = s => hist.some(x => x.source === s);
  const cur = facts.curriculum;
  const unit = unitOf(e, cur);
  if (BOOK_SOURCES.has(e.source)) add('textbook', unitLabel(unit, cur));
  if ((facts.own || {})[e.slug] || has('self')) add('self');
  if (facts.storyAdded && facts.storyAdded.has(e.slug)) {
    const ep = (facts.storyEp || {})[e.slug] || ((facts.looked || {})[low(e.headword)] || {}).ep;
    add('story', epLabel(ep, facts));
  } else if (has('story')) add('textread');
  if (has('screen')) add('screen');
  if ((facts.asked && facts.asked.has(e.slug)) || (facts.chatWords && facts.chatWords.has(low(e.headword)))) add('chat');
  if (lookupEvents(e).length) add('look');
  if (unit) add('textbook', unitLabel(unit, cur));
  const miss = (facts.misses || {})[e.slug] || 0;
  if ((facts.boost && facts.boost.has(e.slug)) || (facts.dictWrong && facts.dictWrong.has(e.slug)) || miss >= 2) add('mistake');
  return out;
}

export function levelOf(e, facts = {}) {
  if (!e) return 'new';
  if ((facts.written || {})[e.slug]) return 'write';
  const c = e.fsrs;
  if (c && c.state !== State.New && (c.state === State.Review || arr(e.reviews).some(r => r && r.rating >= 2))) return 'know';
  return 'new';
}

export function flagsOf(e, facts = {}) {
  const level = levelOf(e, facts);
  const c = e && e.fsrs;
  const miss = (facts.misses || {})[e && e.slug] || 0;
  const reviews = arr(e && e.reviews);
  const last = reviews.length ? reviews[reviews.length - 1].rating : 0;
  const rated = !!(c && c.state !== State.New);
  const shaky = level !== 'write' && (miss > 0 ||
    (rated && ((c.lapses || 0) > 0 || c.state === State.Learning || c.state === State.Relearning || (last && last <= 2))));
  let r = 1;
  if (rated && c.last_review) { try { r = retrievability(c, facts.now || new Date()); } catch (err) { r = 1; } }
  const fading = rated && !!c.last_review && r < FADE_R;
  const week = !!(e && e.favorited_at && str(e.favorited_at).slice(0, 10) >= (facts.week || weekStart(facts.now)));
  return { shaky, fading, week, r };
}

export function weekLine(entries = [], facts = {}) {
  const from = facts.week || weekStart(facts.now);
  let know = 0, write = 0, added = 0, knowAll = 0;
  for (const e of arr(entries)) {
    if (!e) continue;
    const good = arr(e.reviews).find(r => r && r.rating >= 2);
    if (good && str(good.at).slice(0, 10) >= from) know++;
    const w = (facts.written || {})[e.slug];
    if (w && w >= from) write++;
    if (e.favorited_at && str(e.favorited_at).slice(0, 10) >= from) added++;
    if (levelOf(e, facts) !== 'new') knowAll++;
  }
  if (know && write) return `这周新认得 ${know} 个，会写 ${write} 个。`;
  if (write) return `这周会写了 ${write} 个词。`;
  if (know) return `这周新认得 ${know} 个词。`;
  if (added) return `这周加了 ${added} 个新词，热身里会见到它们。`;
  const n = arr(entries).length;
  if (!n) return '';
  return knowAll ? `单词本里有 ${n} 个词，你已经认得 ${knowAll} 个。` : `单词本里有 ${n} 个词，从下一节课开始认它们。`;
}

export function textbookMeaning(e, cur) {
  if (!e) return null;
  const unit = unitOf(e, cur);
  if (!unit) return null;
  const hw = low(e.headword);
  const row = arr(call(cur && cur.unitWords, unit)).find(x => x && low(x.w) === hw);
  const cn = str((row && row.cn) || (BOOK_SOURCES.has(e.source) ? e.brief_cn : ''));
  return cn ? { cn, unit, label: unitLabel(unit, cur) } : null;
}

// ECDICT: "n. 苹果, 苹果树\nv. ..." -> "苹果，苹果树"
export function shortCn(cn) {
  const line = str(cn).split(/\\n|\n/).map(s => s.trim()).filter(Boolean)[0] || '';
  const body = line.replace(/^([a-z]+\.\s*)+/i, '').replace(/\[[^\]]*\]/g, '').trim();
  const parts = body.split(/[,，;；]/).map(s => s.trim()).filter(Boolean).slice(0, 2);
  return Array.from(parts.join('，')).slice(0, 16).join('');
}

// ---------------------------------------------------------------- 她自己加词

export function ownCandidate(raw, { dict = null, words = null } = {}) {
  const typed = str(raw).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!typed) return { status: 'bad', q: '', msg: '' };
  if (!/^[A-Za-z][A-Za-z '.-]*$/.test(typed) || typed.split(' ').length > 4 || typed.length > 40) {
    return { status: 'bad', q: typed, msg: '写一个英文单词或短语，比如 apple。' };
  }
  const q = typed === 'I' ? 'I' : typed.toLowerCase();
  const e = call(words && words.resolve, q) || call(words && words.get, slugify(q)) || null;
  if (e && e.favorited) return { status: 'inbook', q, slug: e.slug, headword: e.headword, cn: str(e.brief_cn) };
  const info = call(dict && dict.find, q) || null;
  if (e) return { status: 'entry', q, slug: e.slug, headword: e.headword, cn: str(e.brief_cn) || shortCn(info && info.cn), phonetic: str(e.phonetic || (info && info.phonetic)) };
  if (!info) return { status: 'nodict', q, slug: slugify(q), headword: q, cn: '', phonetic: '' };
  const head = str(info.word) || q;
  const out = { status: 'new', q, slug: slugify(head), headword: head, cn: shortCn(info.cn), phonetic: str(info.phonetic) };
  if (info.via && low(head) !== low(q)) out.via = q;
  return out;
}

export function ownExport(cand, { typed = '', where = '', now = new Date() } = {}) {
  const t = toDate(now);
  const at = localIso(t);
  const item = { at, query: str(typed || cand.q || cand.headword), source: 'self' };
  const ctxLine = str(where).trim().slice(0, 300);
  if (ctxLine) item.context = ctxLine;
  const e = { slug: cand.slug || slugify(cand.headword), headword: cand.headword, brief_cn: str(cand.cn), cn_source: cand.cn ? 'ecdict' : '',
    needs_core: true, favorited: true, favorited_at: at, created: at, updated: at, note: '', history: [item] };
  if (!e.cn_source) delete e.cn_source;
  if (cand.phonetic) e.phonetic = cand.phonetic;
  return { format: 'emma-export', version: 1, source: 'self', exported_at: t.toISOString(), entries: [e], zh: [] };
}

export function noteOwn(own, cand, { typed = '', where = '', now = new Date() } = {}) {
  const out = { v: 1, words: { ...obj(own && own.words) }, updated: localIso(toDate(now)) };
  out.words[cand.slug] = { at: localIso(toDate(now)), typed: str(typed || cand.q), where: str(where).trim().slice(0, 300), cn: str(cand.cn) };
  return out;
}

// ---------------------------------------------------------------- 她遇见过的句子

const EN_SENT = /[A-Z][A-Za-z0-9 ,'’"“”:;-]*[A-Za-z0-9'’"”][.?!]/g;
const englishIn = text => (str(text).match(EN_SENT) || []).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 3);

export function sentencePool({ kv = null, stories = undefined, entry = null } = {}) {
  const pool = [];
  // the stories she has started or finished
  let c = stories;
  if (c === undefined) {
    try { const names = peek(kv, R.NAMES_KEY, null); c = (names ? R.contentWith(names) : null) || R.content(); } catch (e) { c = null; }
  }
  let prog = null;
  try { prog = R.readProgress(kv); } catch (e) { prog = null; }
  const readEps = new Set(Object.entries(obj(prog && prog.episodes)).filter(([, x]) => x && (x.started || x.done)).map(([id]) => id));
  for (const ep of arr(c && c.episodes)) {
    if (!ep || !readEps.has(ep.id)) continue;
    for (const s of arr(ep.sentences)) if (s && s.en) pool.push({ en: str(s.en), zh: str(s.zh), where: ep.n ? `故事第 ${ep.n} 集` : '故事' });
  }
  // 课文陪读 pages she checked
  for (const k of keysOf(kv, 'textread:')) {
    const p = obj(peek(kv, k, null));
    const where = p.unit ? `课文陪读 ${shortUnit(p.unit)}${p.page ? ` 第 ${p.page} 页` : ''}` : '课文陪读';
    for (const s of arr(p.sentences)) if (s && s.en) pool.push({ en: str(s.en), zh: str(s.zh), where });
  }
  // 问老师: English sentences in her questions and the teacher's answers
  for (const k of keysOf(kv, 'chat:').sort().reverse()) {
    const d = obj(peek(kv, k, null));
    for (const m of arr(d.messages)) {
      if (!m || !m.text) continue;
      for (const en of englishIn(m.text)) pool.push({ en, zh: '', where: m.role === 'user' ? '你问老师的话' : '老师讲的例句' });
    }
  }
  // the word's own history: where she saw it (her note when adding, the sentence pasted with a lookup)
  if (entry) {
    for (const x of arr(entry.history)) {
      if (!x || !x.context) continue;
      pool.push({ en: str(x.context), zh: '', where: x.source === 'self' ? '你写的“在哪看到”' : '查词时的原句', own: true });
    }
  }
  return pool;
}

const TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
function formsOf(w) {
  const out = new Set([w]);
  if (w.length < 2) return out;
  out.add(w + 's'); out.add(w + 'es'); out.add(w + 'ed'); out.add(w + 'd'); out.add(w + 'ing'); out.add(w + "'s");
  if (/[^aeiou]y$/.test(w)) { out.add(w.slice(0, -1) + 'ies'); out.add(w.slice(0, -1) + 'ied'); }
  if (/e$/.test(w)) out.add(w.slice(0, -1) + 'ing');
  if (/[^aeiou][aeiou][bdgmnprt]$/.test(w)) { out.add(w + w.slice(-1) + 'ed'); out.add(w + w.slice(-1) + 'ing'); }
  return out;
}
export function hasWord(en, headword, lemma = null) {
  const w = low(headword);
  if (!w) return false;
  const s = low(en).replace(/[’‘]/g, "'");
  if (/\s/.test(w)) return new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(s);
  const forms = formsOf(w);
  for (const m of s.match(TOKEN) || []) {
    if (forms.has(m)) return true;
    const l = call(lemma, m);
    if (l && low(l) === w) return true;
  }
  return false;
}

export function sentencesMet(entry, pool = [], { lemma = null, max = 6 } = {}) {
  if (!entry) return [];
  const seen = new Set();
  const own = [], rest = [];
  for (const s of arr(pool)) {
    const key = low(s.en);
    if (!key || seen.has(key)) continue;
    // her own note may be Chinese only (“英语课上”): keep it, it says where she saw the word
    if (!s.own && !hasWord(s.en, entry.headword, lemma)) continue;
    seen.add(key);
    (s.own ? own : rest).push({ en: s.en, zh: s.zh || '', where: s.where });
  }
  return [...own, ...rest].slice(0, max);
}

// ---------------------------------------------------------------- 练一下

const WRITE_WANT = ['tiles', 'cloze'];
export function pickModes(entries = [], { canSpell = () => false, single = false } = {}) {
  const out = [];
  let i = 0;
  for (const e of arr(entries)) {
    if (!e || !e.slug) continue;
    const spell = !!call(canSpell, e);
    const opts = spell ? ['mc4', 'listen', 'tiles', 'cloze'] : ['mc4', 'listen'];
    out.push({ slug: e.slug, want: opts[i % opts.length] });
    // one word on its own: see it once, then write it (or hear it)
    if (single) out.push({ slug: e.slug, want: spell ? WRITE_WANT[i % 2] : 'listen' });
    i++;
  }
  return out;
}

export function practiceSummary(results) {
  const right = [], again = [];
  for (const [slug, r] of results instanceof Map ? results : new Map(Object.entries(obj(results)))) (r && r.first ? right : again).push(slug);
  return { right, again };
}

// ---------------------------------------------------------------- 界面：加一个词

export function renderAdd(container, ctx, { onAdded = () => {}, onClose = () => {}, onOpen = () => {} } = {}) {
  const wordEl = h('input', { type: 'text', className: 'wb-in', lang: 'en', placeholder: '写一个英文词', autocomplete: 'off', autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next', 'aria-label': '要加的英文词' });
  const whereEl = h('textarea', { className: 'wb-in wb-where', rows: 2, placeholder: '在哪看到的？可以写那一句，也可以不写', 'aria-label': '在哪看到的' });
  const preview = h('div', { className: 'wb-preview', 'aria-live': 'polite' });
  const addBtn = h('button', { type: 'button', className: 'btn wb-big', text: '加进单词本', disabled: true });
  const closeBtn = h('button', { type: 'button', className: 'text-btn', text: '先不加', on: { click: () => onClose() } });
  const el = h('section', { className: 'wb-add', 'aria-label': '加一个词' },
    h('h2', { className: 'wb-h', text: '加一个词' }),
    wordEl, preview,
    h('label', { className: 'wb-label', text: '在哪看到的（可以不写）' }), whereEl,
    h('div', { className: 'wb-actions' }, addBtn, closeBtn));
  container.replaceChildren(el);

  let cand = null;
  const say = (t, b) => { try { ctx.say(t, b); } catch (e) { /* sound is optional */ } };
  function draw() {
    cand = ownCandidate(wordEl.value, { dict: ctx.dict, words: ctx.words });
    const st = cand.status;
    addBtn.disabled = !(st === 'new' || st === 'entry' || st === 'nodict');
    addBtn.textContent = '加进单词本';
    if (st === 'bad') { preview.replaceChildren(cand.msg ? h('p', { className: 'small', text: cand.msg }) : ''); return; }
    if (st === 'inbook') {
      preview.replaceChildren(h('p', { className: 'small' }, h('b', { lang: 'en', text: cand.headword }), ' 已经在单词本里了。'),
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => onOpen(cand.slug) } }, '看看它', icon('chev')));
      return;
    }
    if (st === 'nodict') {
      preview.replaceChildren(h('p', { className: 'small', text: '离线词典里没有这个词。拼对了吗？加进来以后，第一次打开时老师补上中文。' }),
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { try { ctx.lookup(cand.q); } catch (e) { /* ignore */ } } } }, '去查一下', icon('chev')));
      return;
    }
    preview.replaceChildren(h('p', { className: 'wb-pv' },
      h('span', { className: 'wb-pv-w', lang: 'en', text: cand.headword }),
      cand.phonetic ? h('span', { className: 'wb-pv-ph', lang: 'en', text: `/${cand.phonetic}/` }) : null,
      h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => say(cand.headword, ev.currentTarget) } }, icon('speak'))),
    h('p', { className: 'wb-pv-cn', text: cand.cn || '中文等打开时补上' }),
    cand.via ? h('p', { className: 'small' }, h('span', { lang: 'en', text: cand.via }), ' 的原形是 ', h('b', { lang: 'en', text: cand.headword }), '，加的是原形。') : null);
  }
  let timer = 0;
  wordEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 120); });
  wordEl.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); whereEl.focus(); } });
  addBtn.addEventListener('click', async () => {
    draw();
    if (!cand || addBtn.disabled) return;
    addBtn.disabled = true;
    const c = cand;
    const typed = wordEl.value.trim();
    const where = whereEl.value.trim();
    try {
      const W = ctx.words;
      let e = W.get(c.slug) || null;
      if (!e) { await W.importData(ownExport(c, { typed, where })); e = W.get(c.slug) || null; }
      if (e && !e.favorited) await ctx.toggleFav(e.slug, true);
      await ctx.kv.set(KV_KEY, noteOwn(readOwn(ctx.kv), c, { typed, where }));
      try { ctx.toast('加好了，热身里会见到它。'); } catch (err) { /* ignore */ }
      wordEl.value = ''; whereEl.value = ''; draw();
      onAdded(c.slug);
    } catch (err) {
      addBtn.disabled = false;
      try { ctx.toast('没加上，再点一次。'); } catch (e2) { /* ignore */ }
    }
  });
  draw();
  return { el, focus: () => { try { wordEl.focus(); } catch (e) { /* ignore */ } } };
}

// ---------------------------------------------------------------- 界面：一个词的卡片

export function cardPos(e, curriculum = null) {
  if (!e || /\s/.test(str(e.headword).trim()) || e.phrase) return null;
  try { return posLine(e, { curriculum }); } catch (err) { return null; }
}
function posSection(p) {
  if (!p) return null;
  return h('section', { className: 'wb-sec wb-pos' },
    h('h3', { className: 'wb-sec-h', text: '词性' }),
    h('p', { className: 'wb-pos-line' }, h('i', { className: 'pos', lang: 'en', text: p.abbr }), ' ', h('b', { text: p.zh }), `：${p.what}`),
    p.image ? h('p', { className: 'small', text: '记一记：' + p.image }) : null,
    p.tip ? h('p', { className: 'small', text: p.tip }) : null,
    p.alsoText ? h('p', { className: 'small', text: p.alsoText }) : null);
}

const LEVEL_SUB = { new: '还没在复习里认出来过', know: '看到能认出来', write: '跨好几天都拼对了' };
export function renderCard(container, ctx, e, facts, { onPractice = () => {}, onFull = () => {} } = {}) {
  const info = call(ctx.dict && ctx.dict.find, e.headword) || null;
  const ph = str(e.phonetic || (info && info.phonetic));
  const level = levelOf(e, facts);
  const book = textbookMeaning(e, facts.curriculum);
  const cn = (book && book.cn) || str(e.brief_cn) || shortCn(info && info.cn);
  const srcs = sourcesOf(e, facts);
  const own = (facts.own || {})[e.slug];
  const miss = (facts.misses || {})[e.slug] || 0;
  let met = [];
  try { met = sentencesMet(e, sentencePool({ kv: ctx.kv, entry: e }), { lemma: w => call(ctx.dict && ctx.dict.lemma, w) }); } catch (err) { met = []; }
  const say = (t, b) => { try { ctx.say(t, b); } catch (err) { /* ignore */ } };
  const flags = flagsOf(e, facts);
  const pos = cardPos(e, facts.curriculum || ctx.curriculum);

  const el = h('article', { className: 'wb-card' },
    h('header', { className: 'wb-card-top' },
      h('h2', { className: 'wb-card-w', lang: 'en', text: e.headword }),
      h('button', { type: 'button', className: 'say wb-card-say', 'aria-label': '听一遍', on: { click: ev => say(e.headword, ev.currentTarget) } }, icon('speak'))),
    ph ? h('p', { className: 'wb-card-ph', lang: 'en', text: `/${ph}/` }) : null,
    h('p', { className: 'wb-card-cn' }, pos ? h('i', { className: 'pos', lang: 'en', title: pos.zh, text: pos.abbr }) : null, pos ? ' ' : null,
      cn || '中文第一次打开完整讲解时补上'),
    book ? h('p', { className: 'small', text: `${book.label} 里的意思` }) : null,
    h('div', { className: 'wb-card-level' },
      h('span', { className: 'wb-lv wb-lv-' + level, text: LEVELS[level] }),
      h('span', { className: 'small', text: LEVEL_SUB[level] + (flags.fading ? '，最近有点要忘' : '') })),
    posSection(pos),
    h('section', { className: 'wb-sec' },
      h('h3', { className: 'wb-sec-h', text: '从哪来' }),
      srcs.length ? h('p', { className: 'wb-srcs' }, srcs.map(s => h('span', { className: 'wb-src wb-src-' + s.kind, text: s.label }))) : h('p', { className: 'small', text: '单词本里的词' }),
      own && own.where && !arr(e.history).some(x => x && x.source === 'self' && x.context) ? h('p', { className: 'wb-where-note', text: `你写的：${own.where}` }) : null),
    h('section', { className: 'wb-sec' },
      h('h3', { className: 'wb-sec-h', text: '你遇见过的句子' }),
      met.length
        ? h('ul', { className: 'wb-sents' }, met.map(s => h('li', { className: 'wb-sent' },
          h('p', { className: 'wb-sent-en', lang: /[A-Za-z]/.test(s.en) && !/[一-鿿]/.test(s.en) ? 'en' : null },
            s.en, /[A-Za-z]{2}/.test(s.en) && !/[一-鿿]/.test(s.en) ? h('button', { type: 'button', className: 'say', 'aria-label': '读这一句', on: { click: ev => say(s.en, ev.currentTarget) } }, icon('speak')) : null),
          s.zh ? h('p', { className: 'wb-sent-zh', text: s.zh }) : null,
          h('p', { className: 'wb-sent-where', text: s.where }))))
        : h('p', { className: 'small', text: '还没在故事、课文或问老师里碰到它。碰到了会记在这里。' })),
    h('section', { className: 'wb-sec' },
      h('h3', { className: 'wb-sec-h', text: '错过几次' }),
      h('p', { className: 'wb-miss', text: miss ? `错过 ${miss} 次。错了再练，就记住了。` : '还没错过。' })),
    h('div', { className: 'wb-actions' },
      h('button', { type: 'button', className: 'btn wb-big', on: { click: () => onPractice([e.slug]) } }, '现在练一下'),
      h('button', { type: 'button', className: 'text-btn accent', on: { click: () => onFull(e.slug) } }, '看完整讲解', icon('chev'))));
  container.replaceChildren(el);
  // the 词性 cards and the 课标 details (parts of speech) the first time a card opens: draw it again once they are in
  if (!posReady) {
    posReady = loadPos(ctx);
    posReady.then(() => { if (container.firstChild === el) renderCard(container, ctx, e, facts, { onPractice, onFull }); });
  }
  return { el };
}
let posReady = null;

// ---------------------------------------------------------------- 界面：练一下

// 0.8.2: the tiles show the word's part of speech too (pos.js posSpellMode wraps spell.js spellMode, same interface)
const MODE_FILES = { mc4: ['./modes/choice.js', 'choiceMode'], listen: ['./modes/listen.js', 'listenMode'], tiles: ['./pos.js', 'posSpellMode'], cloze: ['./modes/cloze.js', 'clozeMode'] };
const EVENT_MODE = { mc4: 'mc4', listen: 'listen', spell: 'tiles', tiles: 'tiles', cloze: 'cloze', card: 'card', keys: 'keys' };

export async function createPractice(container, ctx, { slugs = [], onExit = () => {} } = {}) {
  const mods = {};
  for (const [k, [file, name]] of Object.entries(MODE_FILES)) {
    try { const m = await import(file); mods[k] = m[name] || null; if (k === 'tiles') mods.canSpell = m.canSpell; } catch (err) { mods[k] = null; }
  }
  const list = slugs.map(s => ctx.words.get(s)).filter(e => e && e.favorited).slice(0, PRACTICE_MAX);
  // 0.7.0 (Wei 10-25): the words she added herself (kv wordbook.own) get spelling too, so they can reach 会写
  const ownSet = new Set(Object.keys(readOwn(ctx.kv).words));
  const asOwn = e => (e && ownSet.has(e.slug) ? { ...e, own: true } : e);
  const canSpell = e => !!(mods.canSpell && mods.canSpell(asOwn(e), ctx.curriculum));
  let queue = pickModes(list, { canSpell, single: list.length === 1 });
  const sid = (() => { try { return ctx.events.sessionId(); } catch (e) { return ''; } })();
  const results = new Map();
  const retried = new Set();
  let cur = null, view = null, finished = false, done = 0;
  const total = queue.length;
  const say = (t, b) => { try { ctx.say(t, b); } catch (e) { /* ignore */ } };
  const pool = (() => { const seen = new Set(), out = []; for (const e of [...list, ...ctx.words.favorites()]) if (e && e.brief_cn && !seen.has(e.slug)) { seen.add(e.slug); out.push(e); } return out; })();
  const unitOfE = e => unitOf(e, ctx.curriculum) || undefined;
  const log = ev => { try { ctx.events.log(ev); } catch (e) { /* recording must not stop her */ } };

  const stage = h('div', { className: 'wb-stage' });
  const foot = h('div', { className: 'wb-stage-foot' });
  const quit = h('button', { type: 'button', className: 'text-btn', text: '不练了', on: { click: () => end(true) } });
  const el = h('section', { className: 'wb-practice' },
    h('header', { className: 'wb-pr-top' }, h('h2', { className: 'wb-h', text: '练一下' }), quit), stage, foot);
  container.replaceChildren(el);

  function next() {
    if (finished) return;
    cur = queue.shift();
    if (!cur) { end(false); return; }
    const e = ctx.words.get(cur.slug);
    if (!e) { next(); return; }
    cur.t = Date.now(); cur.answered = false;
    const base = { app: ctx, pool, say, position: { n: done + 1, total: Math.max(total, done + queue.length + 1), isNew: !e.fsrs || e.fsrs.state === State.New },
      rate: g => rated(g), onAnswer: ev => answered(e, ev) };
    const tries = [cur.want, 'mc4'];
    view = null;
    for (const m of tries) {
      const mode = mods[m];
      if (!mode) continue;
      try { view = mode.render(asOwn(e), base); } catch (err) { view = null; }
      if (view && view.el) { cur.mode = EVENT_MODE[view.eventMode && view.modeId !== 'mc4' ? view.eventMode : view.modeId] || EVENT_MODE[m] || 'mc4'; break; }
    }
    if (!view || !view.el) { done++; next(); return; }
    stage.replaceChildren(view.el);
    foot.replaceChildren(...[].concat(view.footer || []).filter(Boolean));
  }
  function answered(e, ev) {
    log({ type: 'answer', step: 'wordbook', sid, unit: unitOfE(e), ...ev });
    if (!cur || ev.slug !== cur.slug || cur.answered) return;
    cur.answered = true;
    // a word asked twice (one word alone) is 一下就对 only when both went clean
    const clean = !!ev.correct && ev.first_try !== false && !(ev.hint_level > 0);
    const prev = results.get(cur.slug);
    results.set(cur.slug, { first: prev ? prev.first && clean : clean });
  }
  function rated(g) {
    if (!cur || finished) return;
    const c = cur;
    if (!c.answered) {
      // a card with no choices to tap (not enough distractors): her own 认得 / 没认出来 is the answer
      const e = ctx.words.get(c.slug);
      log({ type: 'answer', step: 'wordbook', sid, item: 'w:' + c.slug, slug: c.slug, unit: e ? unitOfE(e) : undefined, mode: 'card',
        choice: String(g), correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
      if (!results.has(c.slug)) results.set(c.slug, { first: g >= 3 });
    }
    done++;
    if (g <= 1 && results.has(c.slug)) results.set(c.slug, { first: false });
    if (g <= 1 && !retried.has(c.slug)) { retried.add(c.slug); queue.push({ slug: c.slug, want: 'mc4' }); }
    cur = null;
    next();
  }
  function end(early) {
    if (finished) return;
    finished = true;
    try { ctx.voice && ctx.voice.stop && ctx.voice.stop(); } catch (e) { /* ignore */ }
    const sum = practiceSummary(results);
    const word = s => { const e = ctx.words.get(s); return e ? e.headword : s; };
    const line = (label, slugs2) => slugs2.length ? h('p', { className: 'wb-sum-line' }, h('span', { className: 'small', text: label }), ' ',
      slugs2.map((s, i) => [i ? '、' : '', h('span', { lang: 'en', className: 'wb-sum-w', text: word(s) })])) : null;
    const head = !results.size ? '这次没练到词。' : sum.again.length ? `练了 ${results.size} 个词。` : `练了 ${results.size} 个词，一下就对了。`;
    stage.replaceChildren(h('div', { className: 'wb-sum' },
      h('p', { className: 'lede', text: early && results.size ? '先练到这儿。' : head }),
      line('一下就对：', sum.right),
      line('再看看：', sum.again),
      h('div', { className: 'wb-actions' },
        sum.again.length ? h('button', { type: 'button', className: 'btn wb-big', on: { click: () => onExit({ results, again: sum.again }) } }, '再练没对的') : null,
        h('button', { type: 'button', className: sum.again.length ? 'text-btn accent' : 'btn wb-big', on: { click: () => onExit({ results }) } }, '回单词本'))));
    foot.replaceChildren();
    quit.hidden = true;
  }
  next();
  return {
    el,
    onKey: ev => { if (view && typeof view.onKey === 'function' && !finished) view.onKey(ev); },
    stop: () => { finished = true; },
    inSession: () => !finished,
    results,
  };
}
