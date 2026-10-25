// 每日阅读（DESIGN 5.6“现写的流水线”提前做；Wei 10-25：每天给她一篇比现在水平稍难一点的阅读，在读里学词、学句子）。
// 一篇这样来：
//   1. 备料（本机，0 元，buildMaterial）：她认识的词（小学 505 去掉摸底说不会的 + 课标另列的数词月份 + 功能词 + 单词本里复习稳定的词
//      + 故事里遇见过的词，减去 14 天里点开查过、还没稳的词）、目标新词 5-6 个（当前单元还不会的必会词 4 个优先，再加 1-2 个到期复习词）、
//      1-2 个目标句型（语法卡现在这张和下一张）、话题（kid.prefs 的喜好轮换，猫一直在里面）、长度（kid.level 的阅读等级）。
//   2. 写一篇（textread.js 的 textRoute：Poe 设好走 GPT，否则百炼问老师的模型 qwen3.8-max）：固定 JSON，和 stories.json 的一集同一个格式。
//   3. 核对（本机代码，checkPassage）：分词、还原词形（课标 forms + 规则变化；不规则变化表里没有的算生词），目标词以外她认识的不少于 95%，
//      目标词各出现 2 次以上，平均句长、最长一句在范围内，每句都有中文，题目答案在选项里、依据句编号存在。
//      不过关只把超纲的句子发回去改（fixSentences），最多 2 次；还不过，超纲词加注（glossary，中文先用模型给的，再用离线词典）。
//   4. 题目自检（blindCheck，百炼 qwen3.8-flash，没有百炼 Key 就用同一条线）：不看答案做一遍，对不上的题删掉；剩不到 2 道算没写成。
//   5. 存 kv 'daily:<日期>'。每天一篇，当天第一次打开（或前一天 19 点以后）后台写（prepare，不挡课）；“再来一篇”当天最多 3 篇。
//      没网、预算到了、写坏了：用现成的故事（下一集番外）或期中阅读小篇顶上（pickFallback），不花钱。
// 读：ui-daily-read.js 用阅读器的 renderPassage（先听后读、点词、看不懂三下、做题）；读完 settleRead：目标词进单词本（复习队列），
//   目标句型的语法卡加一次复习（她已经开始学的卡），piece 记下读完，记一条 read_time 事件。
// 这个文件是纯逻辑加请求（不碰 DOM），Node 里直接测（tests/daily-read.test.mjs）。负责：每日阅读 agent（daily-read.js、ui-daily-read.js、
// css/daily-read.css、tests/daily-read.test.mjs）。
//
// ---------------------------------------------------------------- 导出
//   KV_PREFIX = 'daily:'、kvKey(date)、MAX_PER_DAY = 3、FIX_TRIES = 2、COVERAGE = 0.95、TARGET_TIMES = 2、GEN_KIND = 'story'、
//   CHECK_MODEL = 'qwen3.8-flash'、NEW_TARGETS = 4、REVIEW_TARGETS = 2、STABLE_DAYS = 3、LOOKED_DAYS = 14、EVENT_PREFIX = 'daily:'
//   LEVELS、levelSpec(level) -> { level, words, min, max, avg, longest }   0 约 120 词，每高一级 +30 词、句子更长
//   EXTRA_KNOWN、FUNCTION_WORDS、TOPIC_EN
//   tokenize(text) -> [{ raw, low, parts }]（缩写拆开：don't = do + not）；wordCount(text)
//   makeVocab({ standard, unknown, add, remove }) -> Vocab = { known: Set, forms: Map, isKnownBase(w), baseOf(w) }
//   classify(tok, vocab, names) -> { kind: 'name' | 'known' | 'unknown', base?, word? }；countTarget(text, w, vocab)
//   buildMaterial(input) -> Material（纯函数，见下）；gatherMaterial(ctx, { now, date, n }) -> Promise<Material>（从 ctx 读好再调 buildMaterial）
//   systemPrompt()、userPrompt(mat)、fixPrompt(mat, passage, report)、blindPrompt(passage)
//   normalizePassage(raw, mat, { id }) -> Passage（stories.json 一集的形状，id 'daily-<日期>-<n>'）
//   cleanQuestions(passage) -> { passage, dropped: [qid] }   结构不对的题去掉（答案不在选项里、依据句不存在……）
//   checkPassage(passage, { vocab, targets, spec }) -> Report = { ok, words, sentences, avg, longest, coverage, unknown: [{ w, count, ids }],
//       targetHits: { w: n }, missing: [w], bad: [句子 id], long: [句子 id], problems: [中文] }
//   applyFix(passage, sentences) -> Passage   只换掉发回去改的那几句（id 对上的）
//   glossUnknown(passage, report, { glossFor }) -> Passage   超纲词加注（glossary 里没有的补上）
//   blindCompare(passage, answers) -> { keep: [qid], drop: [qid] }
//   generate(ctx, { date, n, now, fetchImpl, sleep, signal, mat }) -> Promise<Piece>   一篇从备料到自检（不写 kv）
//   mockPiece(mat, { now }) -> Piece   模拟模式的一篇假的（原创，只用小学词）
//   readDay(kv, date) -> DayRec；saveDay(kv, date, fn) 读最新的再改再写；pieceById(kv, id)
//   dayState(kv, now) -> { date, pieces, ready, unread, readCount, canMore, writing, failed }
//   prepare(ctx, { now, fetchImpl, sleep }) -> Promise<Piece | null>   后台：今天没有就写今天的；19 点以后写明天的；从不抛错
//   another(ctx, { now, fetchImpl, sleep }) -> Promise<Piece>   “再来一篇”（当天第 2、3 篇），失败抛 AIError
//   writing(date?) -> bool   这一天正在写
//   pickFallback({ kv, content, passages, now }) -> { kind: 'story', episodeId } | { kind: 'passage', id, passage } | null
//   settleRead(ctx, piece, result, { now }) -> Promise<{ added: [w], queued: [cardId] }>
//   homeLine(kv, now) -> { status: 'ready' | 'writing' | 'done' | 'none', label, sub, more }   给首页“接着练”
//
// ---------------------------------------------------------------- kv 'daily:<YYYY-MM-DD>'（新键，随备份走；60 天前的 prepare 时清掉）
//   DayRec = { v: 1, date, pieces: [Piece], tries: [{ at, n, code, message }]（最近 6 次失败）, updated }
//   Piece = { n: 1..3, id: 'daily-<date>-<n>', status: 'ready', at, model, provider, mock?, level, topic: { id, zh },
//             targets: [{ w, zh, slug, kind: 'new' | 'review' }], points: [{ card, tag, title }],
//             passage: stories.json 一集（sentences、questions、tip、targets、glossary、names）,
//             check: { words, sentences, avg, longest, coverage, unknown: [w], glossed: [w], hits: { w: n }, fixes, dropped: [qid], blind: 'ok' | 'skipped' },
//             read?: { at, done, right, fuzzy, failed, ms, added: [w], queued: [cardId] } }
//
// ---------------------------------------------------------------- 事件（只加不改，不加新类型）
//   阅读器自己记：answer / hint / read_help / lookup（from 'story'）/ read_time，item 'ep:daily-<date>-<n>:…'，step 照调用方给（上课里 'read'）
//   读完这里再记一条 read_time { item: 'daily:<id>', mode: 'read', step, phase: 'done', daily: true, episode: id, words, sentences,
//                               completed: true, ms, right, fuzzy, failed, targets: [w], points: [card], topic, level, fallback? }
//   用了顶替的现成内容：read_time 带 fallback: 'story' | 'passage'
//
// 依赖：config.js（API_URL）、ai.js（AIError）、textread.js（callJSON、textRoute）、reader.js、screen.js（unknownPrimary）、
//   kid-me.js（difficulty、readPrefs、TOPICS）、grammar.js（content、grammarState、nextCard、cardStatus、normState、kvKey）
import { API_URL } from './config.js';
import { AIError } from './ai.js';
import { callJSON, textRoute } from './textread.js';
import * as R from './reader.js';
import { unknownPrimary } from './screen.js';
import { difficulty, readPrefs, TOPICS } from './kid-me.js';
import * as G from './grammar.js';
import { inflectionBases } from './curriculum.js';

export const KV_PREFIX = 'daily:';
export const kvKey = date => KV_PREFIX + String(date || '');
export const EVENT_PREFIX = 'daily:';
export const MAX_PER_DAY = 3;
export const FIX_TRIES = 2;
export const COVERAGE = 0.95;
export const TARGET_TIMES = 2;
export const GEN_KIND = 'story';
export const CHECK_MODEL = 'qwen3.8-flash';
export const NEW_TARGETS = 4;
export const REVIEW_TARGETS = 2;
export const STABLE_DAYS = 3;
export const LOOKED_DAYS = 14;
export const KEEP_DAYS = 60;
export const EVENING_HOUR = 19;
export const RETRY_AFTER_MS = 30 * 60000;
export const GEN_TIMEOUT_MS = 150000;
export const CHECK_TIMEOUT_MS = 60000;
export const STANDARD_FILE = 'curriculum/standard-words.json';

// 阅读等级（kid.level 的 read，-1..2）：0 约 120 词，每高一级 +30 词，句子也更长一点
export const LEVELS = {
  '-1': { words: 90, avg: 6, longest: 11 },
  0: { words: 120, avg: 7, longest: 12 },
  1: { words: 150, avg: 8, longest: 14 },
  2: { words: 180, avg: 9, longest: 16 },
};
export function levelSpec(level = 0) {
  const lv = Math.max(-1, Math.min(2, Math.round(Number(level) || 0)));
  const L = LEVELS[lv];
  return { level: lv, words: L.words, min: L.words - 20, max: L.words + 25, avg: L.avg, longest: L.longest };
}

// 课标不列、她天天在用的：语气词和功能词（reader.js FUNCTION_ZH 里的都算认识）
export const EXTRA_KNOWN = ['oh', 'wow', 'hmm', 'haha', 'ah', 'ok', 'okay', 'hi', 'hello', 'yes', 'no', 'mum', 'mom', 'dad', 'grandma', 'grandpa', 'ms', 'mr', 'mrs', "o'clock"];
export const FUNCTION_WORDS = Object.keys(R.FUNCTION_ZH).filter(w => !/'/.test(w));
export const TOPIC_EN = { cats: 'a cat', animals: 'animals', food: 'food', school: 'school and friends', family: 'family life', sports: 'sports',
  music: 'music', art: 'drawing', games: 'games', travel: 'a day out', nature: 'weather and nature', science: 'a small science question' };

// ---------------------------------------------------------------- small helpers
const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (day, n) => { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); };
const dayNum = day => { const [y, m, d] = String(day).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const str = x => (x == null ? '' : String(x)).trim();
const arr = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const safe = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const norm = w => str(w).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const CJK = /[㐀-鿿]/;
const peek = (kv, k, d) => { try { const v = kv && kv.peek ? kv.peek(k, d) : d; return v == null ? d : v; } catch (e) { return d; } };
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- words as she reads them (same rules as tools/check_stories.mjs)
const TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;
const CONTRACT = { "'m": 'am', "'re": 'are', "'ll": 'will', "'ve": 'have', "'d": 'would' };
const NOT_BASE = { ca: 'can', wo: 'will', sha: 'shall' };
export function tokenize(text) {
  const out = [];
  for (const m of String(text || '').replace(/’/g, "'").matchAll(TOKEN)) {
    const raw = m[0];
    const low = raw.toLowerCase();
    let parts;
    if (/n't$/.test(low)) { const b = low.slice(0, -3); parts = [NOT_BASE[b] || b, 'not']; }
    else if (low === "let's") parts = ['let', 'us'];
    else if (/'(m|re|ll|ve|d)$/.test(low)) { const i = low.lastIndexOf("'"); parts = [low.slice(0, i), CONTRACT[low.slice(i)]]; }
    else if (/'s$/.test(low)) parts = [low.slice(0, -2)];
    else parts = [low];
    out.push({ raw, low, parts });
  }
  return out;
}
export const wordCount = text => tokenize(text).length;

const NOT_INFLECTED = ['news', 'butter', 'manner', 'litter', 'hers'];
// standard = standard-words.json（primary、listed、forms）；unknown = 摸底说不会的小学词；add / remove = 另外认识 / 不算认识的原形
export function makeVocab({ standard = {}, unknown = [], add = [], remove = [] } = {}) {
  const known = new Set();
  const no = new Set(arr(unknown).map(norm));
  for (const w of arr(standard.primary)) { const k = norm(w); if (!no.has(k)) known.add(k); }
  for (const w of arr(standard.listed)) known.add(norm(w));
  for (const w of [...EXTRA_KNOWN, ...FUNCTION_WORDS]) known.add(norm(w));
  for (const w of arr(add)) { const k = norm(w); if (k && !/ /.test(k)) known.add(k); }
  for (const w of arr(remove)) known.delete(norm(w));
  const forms = new Map(Object.entries(obj(standard.forms)).map(([f, b]) => [norm(f), norm(b)]));
  const isKnownBase = w => known.has(norm(w));
  const guesses = w => (NOT_INFLECTED.includes(w) ? [] : inflectionBases(w).filter(c => /[aeiouy]/.test(c.replace(/e$/, ''))));
  function baseOf(word) {
    const w = norm(word);
    if (!w) return null;
    if (known.has(w)) return { base: w, how: 'word' };
    const f = forms.get(w);
    if (f && known.has(f)) return { base: f, how: 'form' };
    for (const c of guesses(w)) {
      if (known.has(c)) return { base: c, how: 'rule' };
      const cf = forms.get(c);
      if (cf && known.has(cf)) return { base: cf, how: 'rule' };
    }
    return null;
  }
  return { known, forms, isKnownBase, baseOf, size: known.size };
}
export function classify(tok, vocab, names = new Set()) {
  if (tok.parts.every(p => names.has(p))) return { kind: 'name' };
  if (vocab.isKnownBase(tok.low)) return { kind: 'known', base: tok.low };
  const pieces = tok.low.includes('-') ? tok.low.split('-') : tok.parts;
  for (const p of pieces) {
    if (names.has(p)) continue;
    if (!vocab.baseOf(p)) return { kind: 'unknown', word: tok.low.includes('-') ? tok.low : tok.parts[0] };
  }
  return { kind: 'known', base: pieces.join(' ') };
}
// a target word (or phrase) at token i: how many tokens it covers (forms count: checks, checked, checking)
function matchAt(toks, i, target, vocab) {
  const tw = norm(target).split(' ');
  if (i + tw.length > toks.length) return 0;
  for (let k = 0; k < tw.length; k++) {
    const t = toks[i + k];
    if (t.low === tw[k] || t.parts[0] === tw[k]) continue;
    if (t.parts.length === 1 && (inflectionBases(t.low).includes(tw[k]) || (vocab && vocab.forms.get(t.low) === tw[k]))) continue;
    return 0;
  }
  return tw.length;
}
export function countTarget(text, target, vocab = null) {
  const toks = tokenize(text);
  let n = 0;
  for (let i = 0; i < toks.length; i++) { const k = matchAt(toks, i, target, vocab); if (k) { n++; i += k - 1; } }
  return n;
}

// ---------------------------------------------------------------- 1. 备料
// input = {
//   date, n, now, level（kid.level 的 read）, standard（standard-words.json）, unknownPrimary: [词],
//   entries: [词条]（words.all()：slug、headword、unit、favorited、fsrs、brief_cn、tier、required）,
//   unit（progress.unit）, unitWords: [{ w, cn, phrase }]（当前单元，课本顺序）, isRequired(w)（curriculum.isRequired）,
//   met: { slug: { n } }（story:progress.words）, looked: { 原形: { last } }（story:progress.looked）,
//   topics: [kid.prefs 的 topic id], points: [{ card, tag, title, example }]（现在这张卡和下一张）,
//   recent: [w]（最近几天每日阅读用过的目标词，今天前几篇的也在里面）
// }
// Material = { date, n, level, spec, topic: { id, zh, en }, targets: [{ w, zh, slug, kind, unit }], points, known: [词], avoid: [词], vocab }
const stableOf = e => !!(e && e.fsrs && (Number(e.fsrs.stability) || 0) >= STABLE_DAYS && e.fsrs.state !== 0);
const single = w => !!w && /^[a-z][a-z'-]*$/i.test(w) && !/ /.test(w);
export function buildMaterial(input = {}) {
  const now = toDate(input.now);
  const date = input.date || dayOf(now);
  const n = Math.max(1, Number(input.n) || 1);
  const spec = levelSpec(input.level);
  const entries = arr(input.entries).filter(e => e && e.slug);
  const bySlug = new Map(entries.map(e => [e.slug, e]));
  const byHead = new Map(entries.map(e => [norm(e.headword || e.slug), e]));
  const recent = new Set(arr(input.recent).map(norm));
  const metSlugs = obj(input.met);
  const isReq = typeof input.isRequired === 'function' ? w => safe(() => input.isRequired(w), false) : () => true;

  // targets: this unit's required words she does not have yet, the ones not met in a story first, then her textbook order
  const pickedW = new Set();
  const targets = [];
  const take = (w, zh, kind, unit) => {
    const k = norm(w);
    if (!single(k) || pickedW.has(k)) return false;
    pickedW.add(k);
    targets.push({ w: k, zh: str(zh), slug: R.slugify(k), kind, ...(unit ? { unit } : {}) });
    return true;
  };
  const unitList = arr(input.unitWords).filter(x => x && single(norm(x.w)) && !x.phrase && isReq(x.w))
    .map((x, i) => ({ x, i, e: byHead.get(norm(x.w)) }))
    .filter(o => !stableOf(o.e));
  const fresh = unitList.filter(o => !recent.has(norm(o.x.w)));
  const pool = (fresh.length >= NEW_TARGETS ? fresh : unitList)
    .sort((a, b) => ((metSlugs[R.slugify(a.x.w)] ? 1 : 0) - (metSlugs[R.slugify(b.x.w)] ? 1 : 0)) || a.i - b.i);
  // rotate inside the pool by day and piece, so “再来一篇” and the next day do not start on the same four
  const shift = pool.length > NEW_TARGETS ? ((dayNum(date) + n - 1) * NEW_TARGETS) % pool.length : 0;
  const rotated = [...pool.slice(shift), ...pool.slice(0, shift)];
  for (const o of rotated) { if (targets.length >= NEW_TARGETS) break; take(o.x.w, o.x.cn || (o.e && o.e.brief_cn), 'new', input.unit); }
  // no textbook (or the unit is done): new words in her word book, then primary words she said she does not know
  if (targets.length < NEW_TARGETS) {
    const fresh2 = entries.filter(e => e.favorited && e.fsrs && e.fsrs.state === 0 && single(norm(e.headword)) && !recent.has(norm(e.headword)));
    for (const e of fresh2) { if (targets.length >= NEW_TARGETS) break; take(e.headword, e.brief_cn, 'new', e.unit); }
  }
  if (targets.length < NEW_TARGETS) for (const w of arr(input.unknownPrimary)) { if (targets.length >= NEW_TARGETS) break; take(w, '', 'new'); }
  // 1-2 words due for review (earliest due first)
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const due = entries.filter(e => e.favorited && e.fsrs && e.fsrs.state !== 0 && e.fsrs.due && new Date(e.fsrs.due).getTime() <= eod && single(norm(e.headword)))
    .sort((a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due));
  const wantReview = targets.length >= NEW_TARGETS ? REVIEW_TARGETS : 6 - targets.length;
  let r = 0;
  for (const e of due) { if (r >= wantReview) break; if (take(e.headword, e.brief_cn, 'review', e.unit)) r++; }

  // the words she knows: 505 minus 摸底 says no + listed + function words + stable word-book words + words met in stories,
  // minus words she tapped in a story in the last 14 days that are not stable yet; the targets are not “known”
  const add = [];
  for (const e of entries) if (stableOf(e) && single(norm(e.headword))) add.push(e.headword);
  for (const slug of Object.keys(metSlugs)) { const e = bySlug.get(slug); add.push(e ? e.headword : slug); }
  const cutoff = addDays(date, -LOOKED_DAYS);
  const remove = [];
  for (const [w, it] of Object.entries(obj(input.looked))) {
    const last = str(obj(it).last).slice(0, 10);
    if (last && last < cutoff) continue;
    if (stableOf(byHead.get(norm(w)))) continue;
    remove.push(w);
  }
  for (const t of targets) remove.push(t.w);
  const vocab = makeVocab({ standard: input.standard, unknown: input.unknownPrimary, add, remove });
  const known = [...vocab.known].filter(w => /^[a-z]/.test(w)).sort();
  const avoid = [...new Set([...arr(input.unknownPrimary).map(norm), ...remove.map(norm).filter(w => !pickedW.has(w))])].slice(0, 60);

  // topic: her picks in turn, a cat always among them
  const ids = [...new Set([...arr(input.topics).filter(id => TOPICS.some(t => t.id === id)), 'cats'])];
  const tid = ids[(dayNum(date) + n - 1) % ids.length];
  const topic = { id: tid, zh: (TOPICS.find(t => t.id === tid) || {}).zh || '猫', en: TOPIC_EN[tid] || 'a cat' };
  const points = arr(input.points).filter(p => p && p.tag).slice(0, 2);
  return { date, n, level: spec.level, spec, topic, targets, points, known, avoid, vocab };
}

// tag -> which grammar card it belongs to (textread.js TAG_CARD); the tag the passage should show for a card
export const CARD_TAG = { be_verb: 'be_verb', plural: 'plural', pronoun: 'pronoun', there_be: 'there_be', possessive_s: 'poss_s',
  present_simple: 'third_s', can: 'can', freq_adverb: 'freq_adv' };
// the card she is on now and the one after it (grammar.js order), as { card, tag, title, example }
export function pointsFrom({ content = null, gstate = null, now = new Date(), upTo = null } = {}) {
  const c = content;
  if (!c || !Array.isArray(c.cards) || !c.cards.length) return [];
  const cards = c.cards.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const nc = safe(() => G.nextCard(gstate || { cards: {} }, now, { content: c, upTo }), null);
  const statusOf = id => safe(() => G.cardStatus(G.normState(gstate && gstate.cards && gstate.cards[id], id), now), 'new');
  let cur = nc && cards.find(x => x.id === nc.cardId);
  if (!cur) cur = cards.find(x => ['learning', 'practicing'].includes(statusOf(x.id))) || cards.find(x => statusOf(x.id) === 'new') || cards[0];
  const after = cards.slice(cards.indexOf(cur) + 1).find(x => statusOf(x.id) !== 'steady' && CARD_TAG[x.id]) || null;
  return [cur, after].filter(x => x && CARD_TAG[x.id]).map(x => ({
    card: x.id, tag: CARD_TAG[x.id], title: str(x.title),
    example: str(((x.examples || [])[0] || {}).en),
  }));
}

export async function gatherMaterial(ctx, { now = new Date(), date = null, n = 1 } = {}) {
  const kv = ctx && ctx.kv;
  const fetchJSON = ctx && ctx.fetchJSON;
  const standard = await (async () => { try { return fetchJSON ? await fetchJSON(STANDARD_FILE) : null; } catch (e) { return null; } })() || {};
  const progress = obj(peek(kv, 'progress', {}));
  const cur = ctx && ctx.curriculum;
  const unit = str(progress.unit) || safe(() => (cur.units()[0] || {}).id, '') || '';
  const unitWords = unit ? safe(() => cur.unitWords(unit), []) || [] : [];
  const sp = R.readProgress(kv);
  const d = date || dayOf(now);
  const recent = [];
  for (let i = 0; i <= 6; i++) for (const p of readDay(kv, addDays(d, -i)).pieces) for (const t of arr(p.targets)) recent.push(t.w);
  const gc = safe(() => G.content(), null);
  return buildMaterial({
    date: d, n, now,
    level: safe(() => difficulty(kv, now).read, 0),
    standard,
    unknownPrimary: safe(() => unknownPrimary(kv), []) || [],
    entries: safe(() => ctx.words.all(), []) || [],
    unit, unitWords,
    isRequired: cur && cur.isRequired ? w => cur.isRequired(w) : null,
    met: sp.words, looked: sp.looked,
    topics: safe(() => readPrefs(kv).topics, []) || [],
    points: pointsFrom({ content: gc, gstate: gc ? safe(() => G.grammarState(kv, gc), null) : null, now, upTo: unit || null }),
    recent,
  });
}

// ---------------------------------------------------------------- 2. 写一篇（提示词）
const TAG_LIST = 'there_be, poss_s, pronoun, be_adj, be_verb, can, third_s, plural, do_q, wh_q, imperative, freq_adv, be_ing, past, will';
export function systemPrompt() {
  return `你是北京一位很会教的初一英语老师，在给自己的一个学生写今天的一篇小阅读。她用外研版七年级，基础弱，阅读看不懂。
这篇要比她现在的水平只难一点点：几乎每个词她都认识，只多今天要学的几个目标词；她在读里学会这几个词和一个句型。
写作规矩：
- 正文只用“她认识的词”里的词，加上目标词。变化形式可以用：-s、-es、-ed、-ing、's；不规则变化（went、saw、children）只有表里写出来的才能用。
  名字用简单的英文名（Lily、Tom、Kitty 这种），算不上生词。实在要用表外的词，最多 2 个，写进 glossary。
- 每个目标词在正文里至少出现 2 次，放在能看出意思的句子里，第一次出现的那句前后要能猜出它的意思。
- 目标句型要在正文里自然地用上至少 2 句。
- 一般现在时为主，可以有对话（speaker 写说话人的名字，叙述句 speaker 写 null）。句子短，一句只说一件事。
- 内容温暖、有一点小悬念或好笑，结尾有一个小转折。不写恋爱，不吓人，不出现真实人名、品牌、学校名，不抄课本课文。
每句给：
- zh：整句中文，准确、自然、短。
- chunks：按意群用 " / " 分开，去掉 " / " 要和 en 一字不差；4 个词以内照抄原句。
- keys：这句最关键的 1-2 个词或短语（她最可能卡住的），w 照原句抄，zh 写在这句里的意思。
- trunk：主干。subject 主语、verb 谓语，都照原句抄（verb 带上 be、can、do、does、not，如 is looking for、doesn't like）；
  note 一句中文，格式像“谁 = Lily，干什么 = is looking for（在找）”。祈使句 subject 写空字符串、kind 写 "imperative"。
- tags：这句用到的语法点，只能从这些里选：${TAG_LIST}；没有就空数组。
题目 4 到 5 道，照北京初一阅读题的考法，答案一定能在原文找到依据，不能有两个都对的选项，选项里不写 A、B、C、D：
- q1 type "evidence"（点出答案句）：问一个细节，answer 是能回答它的句子编号数组（1 个为主）；keyword 写题目里要回原文找的那个词；
  then 是找到句子以后的四选一（options 4 个英文短句、options_zh、answer 等于其中一个）；variant 也是一道点句子的题。
- q2 type "reference"（代词指谁）：pronoun 写那个代词（it / she / he / they），at 写它所在的句子编号；options 3-4 个原文里的名字或名词，answer 等于其中一个。
- q3 type "detail" 或 "infer"（四选一）：options 4 个英文短句，options_zh 对应的中文，answer 等于其中一个。
- q4 type "cloze"（用目标词填空）：word 写考的目标词；stem 是一句挖了空（______）的新句子，stem_zh 是它的中文；options 4 个目标词。
- 可以再加 q5 type "meaning"（看前后句猜词义）：word 写一个目标词，ask 写 What is “词” in Chinese? (Sentence 5)，options 4 个中文。
每道题都要：zh（题目中文）、evidence（依据句编号数组）、drop（第 3 级提示要排除的那个错项，evidence 题写一个句子编号）、
hints 4 级中文提示（1 去第几句找，不说答案；2 关键词是哪个、原文哪里有它；3 排除一个错项并说为什么；4 讲清楚答案和依据句）、
variant（变式题：同一个考法换一句话考，带 answer、evidence、explain；四选一的变式带 options 和 options_zh）。
题目和选项的英文也只用她认识的词、目标词和文中的名字。
再给一条“读的方法”tip：title 一句，lines 两句中文说明，steps 三步做法；和 q1 的考法配合（比如“先看题，再回原文找关键词”）。
只回一个 JSON 对象，形状固定：
{
  "title": "英文标题", "title_zh": "中文标题", "recap_zh": "这篇讲什么，一两句中文，不剧透答案",
  "tip": {"title": "", "lines": ["", ""], "steps": ["", "", ""]},
  "names": [{"en": "Lily", "zh": "女孩"}],
  "glossary": [{"w": "", "zh": ""}],
  "sentences": [{"id": 1, "line": 1, "speaker": null, "en": "", "zh": "", "chunks": "", "keys": [{"w": "", "zh": ""}], "trunk": {"subject": "", "verb": "", "note": ""}, "tags": []}],
  "questions": [
    {"id": "q1", "type": "evidence", "ask": "", "zh": "", "keyword": "", "preview": true, "answer": [3], "evidence": [3], "drop": 5, "hints": ["", "", "", ""],
     "then": {"ask": "", "zh": "", "options": ["", "", "", ""], "options_zh": ["", "", "", ""], "answer": ""},
     "variant": {"ask": "", "zh": "", "keyword": "", "answer": [6], "evidence": [6], "explain": ""}},
    {"id": "q2", "type": "reference", "ask": "Who is “she” in Sentence 7?", "zh": "", "pronoun": "she", "at": 7, "options": [], "options_zh": [], "answer": "", "evidence": [6, 7], "drop": "", "hints": [],
     "variant": {"ask": "", "zh": "", "pronoun": "", "at": 0, "options": [], "options_zh": [], "answer": "", "evidence": [], "explain": ""}},
    {"id": "q3", "type": "detail", "ask": "", "zh": "", "options": [], "options_zh": [], "answer": "", "evidence": [], "drop": "", "hints": [],
     "variant": {"ask": "", "zh": "", "options": [], "options_zh": [], "answer": "", "evidence": [], "explain": ""}},
    {"id": "q4", "type": "cloze", "word": "", "ask": "Choose the right word.", "zh": "选一个词，填进句子里。", "stem": "", "stem_zh": "", "options": [], "options_zh": [], "answer": "", "evidence": [], "drop": "", "hints": [],
     "variant": {"stem": "", "stem_zh": "", "options": [], "options_zh": [], "answer": "", "explain": ""}}
  ]
}
句子编号从 1 起连续。写完自己数一遍：每个目标词出现了几次，有没有表外的词，题目自己做一遍。不要输出 JSON 以外的任何文字。`;
}
export function userPrompt(mat) {
  const m = mat || {};
  const sp = m.spec || levelSpec(0);
  const t = arr(m.targets);
  return [
    `今天的话题：${m.topic ? `${m.topic.zh}（${m.topic.en}）` : '猫'}。`,
    `长度：正文一共 ${sp.min} 到 ${sp.max} 个词（约 ${sp.words} 个），平均每句不超过 ${sp.avg} 个词，最长一句不超过 ${sp.longest} 个词。`,
    t.length ? `目标词（每个至少出现 2 次）：${t.map(x => `${x.w}${x.zh ? `（${x.zh}）` : ''}`).join('、')}。` : '这次没有指定目标词，选 4 个她认识的词表以外、初一常用的词当目标词，写进 glossary。',
    arr(m.points).length ? `目标句型（各写 2 句以上，tags 里标出来）：${m.points.map(p => `${p.title || p.tag}（标签 ${p.tag}${p.example ? `，例句：${p.example}` : ''}）`).join('；')}。` : '',
    arr(m.avoid).length ? `这些词她还不认识，别用：${m.avoid.join(', ')}。` : '',
    `她认识的词（${arr(m.known).length} 个）：${arr(m.known).join(', ')}`,
  ].filter(Boolean).join('\n');
}
export function fixPrompt(mat, passage, report) {
  const want = new Set([...arr(report.bad), ...arr(report.long)]);
  if (!want.size && report.missing && report.missing.length) for (const s of passage.sentences.slice(-2)) want.add(s.id);
  const list = passage.sentences.filter(s => want.has(s.id)).map(s => {
    const unk = arr(report.unknown).filter(u => u.ids.includes(s.id)).map(u => u.w);
    return { id: s.id, speaker: s.speaker || null, en: s.en, problem: [unk.length ? `表外的词：${unk.join(', ')}` : '', arr(report.long).includes(s.id) ? `太长（${wordCount(s.en)} 个词）` : ''].filter(Boolean).join('；') || '要用上目标词' };
  });
  const sp = (mat && mat.spec) || levelSpec(0);
  return {
    system: `你在帮一位初一英语老师改一篇小阅读里的几句话。只改我给你的这几句，意思和上下文不变，id 不变。
改的时候只用“她认识的词”和目标词，每句不超过 ${sp.longest} 个词。每句照原来的格式给全：en、zh、chunks（" / " 分意群，去掉要和 en 一样）、
keys（1-2 个，w 照原句抄）、trunk（subject、verb 照原句抄，note 一句中文）、tags（只能从 ${TAG_LIST} 里选）。
只回一个 JSON 对象：{"sentences": [{"id": 3, "speaker": null, "en": "", "zh": "", "chunks": "", "keys": [{"w": "", "zh": ""}], "trunk": {"subject": "", "verb": "", "note": ""}, "tags": []}]}`,
    user: [
      report.missing && report.missing.length ? `这几个目标词出现得还不够 2 次，改的时候用上：${report.missing.join('、')}。` : '',
      `目标词：${arr(mat && mat.targets).map(t => t.w).join(', ') || '无'}`,
      `要改的句子：${JSON.stringify(list)}`,
      '前后文（不用改）：' + passage.sentences.map(s => `${s.id}. ${s.speaker ? s.speaker + ': ' : ''}${s.en}`).join(' '),
      `她认识的词：${arr(mat && mat.known).join(', ')}`,
    ].filter(Boolean).join('\n'),
  };
}
const isEvidence = q => q && (q.type === 'evidence' || q.type === 'locate');
export function blindPrompt(passage) {
  const qs = passage.questions.map(q => isEvidence(q)
    ? { id: q.id, kind: 'sentence', ask: q.ask }
    : { id: q.id, kind: 'choice', ask: q.stem ? `${q.ask} ${q.stem}` : q.ask, options: q.options });
  return {
    system: `你是一个认真的学生，在做一篇英语小阅读的题。只根据文章回答，不要猜。
kind 是 "sentence" 的题：回答能回答这道题的句子编号数组。kind 是 "choice" 的题：回答 options 里的一个，原样抄。
只回一个 JSON 对象：{"answers": {"q1": [3], "q2": "原样抄的选项"}}`,
    user: `文章（每句前面是编号）：\n${passage.sentences.map(s => `${s.id}. ${s.speaker ? s.speaker + ': ' : ''}${s.en}`).join('\n')}\n\n题目：${JSON.stringify(qs)}`,
  };
}

// ---------------------------------------------------------------- what the model wrote -> one fixed shape
function normKeys(raw) {
  return arr(raw).map(k => (typeof k === 'string' ? { w: k, zh: '' } : k && typeof k === 'object' ? { w: str(k.w ?? k.word), zh: str(k.zh ?? k.cn) } : null)).filter(k => k && k.w).slice(0, 2);
}
function normTrunk(t) {
  if (!t || typeof t !== 'object') return null;
  const out = { subject: str(t.subject), verb: str(t.verb), note: str(t.note) };
  if (t.kind) out.kind = str(t.kind);
  if (Array.isArray(t.also) && t.also.length) out.also = t.also.filter(x => x && typeof x === 'object');
  return out.verb || out.kind ? out : null;
}
const TAGS_OK = new Set(TAG_LIST.split(', '));
const normTags = t => [...new Set(arr(t).map(x => str(x).toLowerCase().replace(/^g:/, '')).filter(x => TAGS_OK.has(x)))];
function normSentence(s, i) {
  const en = str(s.en ?? s.text);
  const chunks = str(Array.isArray(s.chunks) ? s.chunks.join(' / ') : s.chunks);
  const out = { id: Number(s.id) || i + 1, part: 0, line: Number(s.line) || i + 1, speaker: str(s.speaker) && str(s.speaker) !== 'null' ? str(s.speaker) : null,
    en, zh: str(s.zh), chunks: chunks && chunks.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim() === en.replace(/\s+/g, ' ').trim() ? chunks : en,
    keys: normKeys(s.keys), tags: normTags(s.tags) };
  const tr = normTrunk(s.trunk);
  if (tr) out.trunk = tr;
  return out;
}
export function normalizePassage(raw, mat = {}, { id = '' } = {}) {
  const r = obj(raw);
  const sentences = arr(r.sentences).filter(s => s && typeof s === 'object' && str(s.en ?? s.text)).map(normSentence);
  // ids 1..n in order (the questions point at them; a model that skipped a number is renumbered only when there are no gaps to keep)
  const ids = sentences.map(s => s.id);
  if (new Set(ids).size !== ids.length) sentences.forEach((s, i) => { s.id = i + 1; });
  const tip = obj(r.tip);
  const names = arr(r.names).map(x => (typeof x === 'string' ? { en: x, zh: '名字' } : { en: str(x && x.en), zh: str(x && x.zh) || '名字' })).filter(x => /^[A-Z][a-zA-Z]+$/.test(x.en));
  // speakers are names too
  for (const s of sentences) if (s.speaker && /^[A-Z][a-zA-Z]+$/.test(s.speaker) && !names.some(x => x.en === s.speaker)) names.push({ en: s.speaker, zh: '名字' });
  const targets = arr(mat.targets).map(t => ({ w: t.w, zh: t.zh || '' }));
  for (const g of arr(r.glossary)) { const w = norm(g && g.w); const t = targets.find(x => x.w === w); if (t && !t.zh) t.zh = str(g.zh); }
  return {
    id: id || str(r.id) || 'daily',
    title: str(r.title) || 'Today’s Reading',
    title_zh: str(r.title_zh),
    recap_zh: str(r.recap_zh ?? r.about_zh),
    tip: { title: str(tip.title) || '先看题，再回原文找', lines: arr(tip.lines).map(str).filter(Boolean).slice(0, 3), steps: arr(tip.steps).map(str).filter(Boolean).slice(0, 3), preview: true },
    names,
    parts: [{ kind: sentences.some(s => s.speaker) ? 'talk' : 'story', label: str(r.title) || 'Reading', label_zh: str(r.title_zh) || '今天的阅读' }],
    targets,
    glossary: arr(r.glossary).map(g => ({ w: str(g && g.w), zh: str(g && g.zh) })).filter(g => g.w && g.zh && !targets.some(t => t.w === norm(g.w))),
    sentences,
    questions: arr(r.questions).filter(q => q && typeof q === 'object').map((q, i) => ({ ...q, id: str(q.id) || 'q' + (i + 1) })),
  };
}

// ---------------------------------------------------------------- 3. 核对
const sameOpt = (a, b) => norm(a).replace(/[.。!！?？\s]+$/, '') === norm(b).replace(/[.。!！?？\s]+$/, '');
function choiceOk(q, idSet) {
  const opts = arr(q.options).map(str).filter(Boolean);
  if (opts.length < 3 || opts.length > 4 || new Set(opts.map(norm)).size !== opts.length) return false;
  if (!opts.some(o => sameOpt(o, q.answer))) return false;
  return arr(q.evidence).every(x => idSet.has(Number(x)));
}
function evidenceOk(q, idSet) {
  const a = arr(q.answer).map(Number);
  return a.length > 0 && a.every(x => idSet.has(x));
}
function questionOk(q, p, idSet) {
  if (!str(q.ask) && !str(q.stem)) return false;
  if (isEvidence(q)) return evidenceOk(q, idSet) && (!q.then || choiceOk({ ...q.then, evidence: [] }, idSet));
  if (q.type === 'reference') {
    const s = p.sentences.find(x => x.id === Number(q.at));
    const pr = norm(q.pronoun || q.word);
    if (!s || !pr || !tokenize(s.en).some(t => t.low === pr)) return false;
    return choiceOk(q, idSet);
  }
  return choiceOk(q, idSet);
}
const pad4 = (hints, q) => {
  const h = arr(hints).map(str).filter(Boolean).slice(0, 4);
  const fallback = ['回到原文，找一找题目里的关键词。', '找到有这个词的那一句，看它前后。', '先把一定不对的那个划掉。', str(q.explain) || '答案就在依据句里。'];
  while (h.length < 4) h.push(fallback[h.length]);
  return h;
};
export function cleanQuestions(passage) {
  const p = clone(passage);
  const idSet = new Set(p.sentences.map(s => s.id));
  const dropped = [];
  const out = [];
  for (const q of p.questions) {
    if (out.length >= 5 || !questionOk(q, p, idSet)) { dropped.push(q.id); continue; }
    q.hints = pad4(q.hints, q);
    if (!arr(q.evidence).length && isEvidence(q)) q.evidence = arr(q.answer).map(Number);
    if (q.variant && !(isEvidence(q) ? evidenceOk(q.variant, idSet) : q.type === 'reference' ? questionOk({ ...q.variant, type: 'reference' }, p, idSet) : choiceOk({ ...q.variant, evidence: arr(q.variant.evidence) }, idSet))) q.variant = null;
    if (q.type === 'cloze' && q.stem && !/_{3,}/.test(q.stem)) { dropped.push(q.id); continue; }
    out.push(q);
  }
  p.questions = out;
  return { passage: p, dropped };
}

export function checkPassage(passage, { vocab, targets = [], spec = levelSpec(0) } = {}) {
  const p = passage || { sentences: [], questions: [] };
  const names = new Set();
  for (const n of arr(p.names)) for (const t of tokenize(n.en)) names.add(t.low);
  for (const s of p.sentences) if (s.speaker) for (const t of tokenize(s.speaker)) names.add(t.low);
  const tw = arr(targets).map(t => norm(t.w || t));
  const unknown = new Map();
  let known = 0, denom = 0, words = 0, longest = 0;
  const bad = new Set(), long = [];
  const problems = [];
  for (const s of p.sentences) {
    if (!s.zh || !CJK.test(s.zh)) problems.push(`第 ${s.id} 句没有中文`);
    const toks = tokenize(s.en);
    words += toks.length;
    longest = Math.max(longest, toks.length);
    if (toks.length > spec.longest) long.push(s.id);
    for (let i = 0; i < toks.length; i++) {
      let hit = 0;
      for (const t of tw) { hit = matchAt(toks, i, t, vocab); if (hit) break; }
      if (hit) { i += hit - 1; continue; }
      const c = classify(toks[i], vocab, names);
      if (c.kind === 'name') continue;
      denom++;
      if (c.kind === 'known') { known++; continue; }
      const u = unknown.get(c.word) || { w: c.word, count: 0, ids: [] };
      u.count++;
      if (!u.ids.includes(s.id)) u.ids.push(s.id);
      unknown.set(c.word, u);
      bad.add(s.id);
    }
  }
  const body = p.sentences.map(s => s.en).join(' ');
  const targetHits = Object.fromEntries(tw.map(t => [t, countTarget(body, t, vocab)]));
  const missing = tw.filter(t => targetHits[t] < TARGET_TIMES);
  const coverage = denom ? known / denom : 1;
  const n = p.sentences.length;
  const avg = n ? Math.round((words / n) * 10) / 10 : 0;
  if (n < 6) problems.push(`只有 ${n} 句`);
  if (coverage < COVERAGE) problems.push(`认识的词 ${(coverage * 100).toFixed(1)}%，要 ${COVERAGE * 100}% 以上`);
  for (const t of missing) problems.push(`目标词 ${t} 只出现 ${targetHits[t]} 次`);
  if (avg > spec.avg) problems.push(`平均句长 ${avg} 个词，要 ${spec.avg} 以内`);
  if (long.length) problems.push(`第 ${long.join('、')} 句太长`);
  if (words < spec.min * 0.7 || words > spec.max * 1.3) problems.push(`一共 ${words} 个词，要 ${spec.min} 到 ${spec.max}`);
  if (arr(p.questions).length < 2) problems.push('题目不到 2 道');
  // rewriting sentences fixes coverage, length and targets; the rest makes the piece unusable
  const fatal = n < 6 || p.sentences.some(s => !s.zh) || arr(p.questions).length < 2 || words < spec.min * 0.7 || words > spec.max * 1.3;
  return {
    ok: !problems.length, fatal, words, sentences: n, avg, longest, coverage: Math.round(coverage * 10000) / 10000,
    unknown: [...unknown.values()].sort((a, b) => b.count - a.count), targetHits, missing, bad: [...bad].sort((a, b) => a - b), long, problems,
  };
}

// only the sentences sent back (same id) are replaced; questions keep pointing at the same numbers
export function applyFix(passage, sentences) {
  const p = clone(passage);
  const fixes = new Map(arr(sentences).filter(s => s && str(s.en)).map((s, i) => { const n = normSentence(s, i); return [Number(s.id), n]; }));
  p.sentences = p.sentences.map(s => {
    const f = fixes.get(s.id);
    if (!f) return s;
    return { ...s, en: f.en, zh: f.zh || s.zh, chunks: f.chunks || f.en, keys: f.keys.length ? f.keys : [], tags: f.tags, ...(f.trunk ? { trunk: f.trunk } : { trunk: undefined }), speaker: s.speaker };
  }).map(s => { if (s.trunk === undefined) delete s.trunk; return s; });
  return p;
}

// words still outside her list after the fixes: glossed (the model's glossary first, then the offline dictionary)
export function glossUnknown(passage, report, { glossFor = null } = {}) {
  const p = clone(passage);
  const have = new Set(arr(p.glossary).map(g => norm(g.w)));
  for (const u of arr(report && report.unknown)) {
    if (have.has(u.w)) continue;
    const zh = str(safe(() => (glossFor ? glossFor(u.w) : ''), ''));
    p.glossary.push({ w: u.w, zh: zh || '（生词，点它看意思）' });
    have.add(u.w);
  }
  return p;
}

// the self-check's answers -> which questions agree with the answer key
export function blindCompare(passage, answers) {
  const a = obj(answers && (answers.answers || answers));
  const keep = [], drop = [];
  for (const q of passage.questions) {
    const got = a[q.id];
    let ok = false;
    if (isEvidence(q)) {
      const want = new Set(arr(q.answer).map(Number));
      ok = arr(got).map(Number).some(x => want.has(x));
    } else if (got != null) {
      const opts = arr(q.options);
      const g = str(got);
      const byLetter = /^[A-Da-d]$/.test(g) ? opts['ABCD'.indexOf(g.toUpperCase())] : null;
      ok = sameOpt(byLetter || g, q.answer) || (/^\d$/.test(g) && sameOpt(opts[Number(g)] || '', q.answer));
    }
    (ok ? keep : drop).push(q.id);
  }
  return { keep, drop };
}

// ---------------------------------------------------------------- 4. 一篇从头到尾（不写 kv）
const isMock = ctx => !!safe(() => ((ctx.settings && ctx.settings()) || {}).mock, false) || !!safe(() => ctx.mockForced && ctx.mockForced(), false);
const settingsOf = ctx => safe(() => (ctx.settings && ctx.settings()) || {}, {}) || {};
export function checkRoute(s = {}) {
  const key = str(s.apiKey);
  if (key) return { provider: 'bailian', name: '百炼', url: API_URL, key, model: CHECK_MODEL, relay: false };
  return textRoute(s);
}
function glosser(ctx) {
  return w => {
    const e = safe(() => ctx.dict && ctx.dict.get ? ctx.dict.get(w) || (ctx.dict.lemma && ctx.dict.get(ctx.dict.lemma(w))) : null, null);
    const cn = e && (e.cn || e.translation || e.brief_cn);
    return cn ? R.trimGloss(cn) : '';
  };
}
export async function generate(ctx, { date = null, n = 1, now = new Date(), fetchImpl = null, sleep = sleepMs, signal = null, mat: given = null } = {}) {
  const d = date || dayOf(now);
  const mat = given || await gatherMaterial(ctx, { now, date: d, n });
  const id = `daily-${d}-${n}`;
  if (isMock(ctx)) { await sleep(600); return mockPiece(mat, { now, id }); }
  const s = settingsOf(ctx);
  const route = textRoute(s);
  const budget = (ctx && ctx.budget) || null;
  const first = await callJSON({ route, system: systemPrompt(), user: userPrompt(mat), kind: GEN_KIND, budget, fetchImpl, signal, sleep, timeoutMs: GEN_TIMEOUT_MS });
  let passage = cleanQuestions(normalizePassage(first.obj, mat, { id }));
  const dropped = passage.dropped.slice();
  passage = passage.passage;
  let report = checkPassage(passage, { vocab: mat.vocab, targets: mat.targets, spec: mat.spec });
  if (report.fatal) throw new AIError('这篇没写好：' + report.problems.slice(0, 2).join('；'), 'incomplete');
  let fixes = 0;
  while (!report.ok && fixes < FIX_TRIES && (report.bad.length || report.long.length || report.missing.length)) {
    fixes++;
    try {
      const fp = fixPrompt(mat, passage, report);
      const r = await callJSON({ route, system: fp.system, user: fp.user, kind: GEN_KIND, budget, fetchImpl, signal, sleep, timeoutMs: GEN_TIMEOUT_MS });
      passage = applyFix(passage, obj(r.obj).sentences);
    } catch (e) {
      if (e && (e.code === 'abort' || e.code === 'budget' || e.code === 'budget-day')) throw e;
      break;   // the rewrite failed: what we have gets glossed below
    }
    report = checkPassage(passage, { vocab: mat.vocab, targets: mat.targets, spec: mat.spec });
  }
  if (report.unknown.length) passage = glossUnknown(passage, report, { glossFor: glosser(ctx) });
  // self-check: a second model does the questions without the key; the ones it gets differently are dropped
  let blind = 'skipped';
  try {
    const bp = blindPrompt(passage);
    const r = await callJSON({ route: checkRoute(s), system: bp.system, user: bp.user, kind: GEN_KIND, budget, fetchImpl, signal, sleep, timeoutMs: CHECK_TIMEOUT_MS });
    const cmp = blindCompare(passage, r.obj);
    if (passage.questions.length - cmp.drop.length >= 2) {
      passage = { ...passage, questions: passage.questions.filter(q => cmp.keep.includes(q.id)) };
      dropped.push(...cmp.drop);
      blind = 'ok';
    } else throw new AIError('这篇的题自己做一遍对不上。', 'incomplete');
  } catch (e) {
    if (e && (e.code === 'abort' || (e instanceof AIError && /对不上/.test(e.message)))) throw e;
    blind = 'skipped';
  }
  return makePiece({ mat, passage, report, fixes, dropped, blind, model: first.model, provider: route.provider, now, id });
}
function makePiece({ mat, passage, report, fixes = 0, dropped = [], blind = 'skipped', model = '', provider = '', now = new Date(), id, mock = false }) {
  return {
    n: mat.n, id, status: 'ready', at: R.isoLocal(now), model, provider, ...(mock ? { mock: true } : {}),
    level: mat.level, topic: { id: mat.topic.id, zh: mat.topic.zh },
    targets: mat.targets.map(t => ({ w: t.w, zh: t.zh || (passage.targets.find(x => x.w === t.w) || {}).zh || '', slug: t.slug, kind: t.kind })),
    points: mat.points.map(p => ({ card: p.card, tag: p.tag, title: p.title })),
    passage,
    check: { words: report.words, sentences: report.sentences, avg: report.avg, longest: report.longest, coverage: report.coverage,
      unknown: report.unknown.map(u => u.w), glossed: arr(passage.glossary).map(g => g.w), hits: report.targetHits, fixes, dropped, blind },
  };
}

// 模拟模式：一篇原创的假阅读（只用小学词，目标词是 window、quiet、wait、hungry，句型 there be）
export const MOCK_RAW = {
  title: 'The Cat at the Window', title_zh: '窗边的猫', recap_zh: '放学回家，Lily 发现她的猫 Kitty 一直坐在窗边。它在等什么？',
  tip: { title: '先看题，再回原文找', lines: ['先看第一道题，记住要找什么。', '读到题目里的词，就停下来看看这一句。'], steps: ['看题，圈出关键词', '听一遍，找到有关键词的句子', '回到那一句，再选答案'] },
  names: [{ en: 'Lily', zh: '女孩' }, { en: 'Kitty', zh: 'Lily 的猫' }],
  glossary: [],
  sentences: [
    { id: 1, en: 'Lily has a little cat.', zh: 'Lily 有一只小猫。', chunks: 'Lily has / a little cat.', keys: [{ w: 'little', zh: '小的' }], trunk: { subject: 'Lily', verb: 'has', note: '谁 = Lily，干什么 = has（有）' }, tags: ['third_s'] },
    { id: 2, en: 'Her name is Kitty.', zh: '它的名字叫 Kitty。', chunks: 'Her name / is Kitty.', keys: [{ w: 'name', zh: '名字' }], trunk: { subject: 'Her name', verb: 'is', note: '谁 = Her name（它的名字），是 = is' }, tags: ['be_verb', 'pronoun'] },
    { id: 3, en: 'Every day, Kitty sits at the window.', zh: '每天，Kitty 都坐在窗边。', chunks: 'Every day, / Kitty sits / at the window.', keys: [{ w: 'window', zh: '窗户' }, { w: 'sits', zh: '坐' }], trunk: { subject: 'Kitty', verb: 'sits', note: '谁 = Kitty，干什么 = sits（坐）' }, tags: ['third_s'] },
    { id: 4, en: 'She is very quiet.', zh: '它很安静。', chunks: 'She is very quiet.', keys: [{ w: 'quiet', zh: '安静的' }], trunk: { subject: 'She', verb: 'is', note: '谁 = She（Kitty），是 = is，怎么样 = quiet（安静的）' }, tags: ['be_adj', 'pronoun'] },
    { id: 5, en: 'There is a big tree near the window.', zh: '窗户旁边有一棵大树。', chunks: 'There is / a big tree / near the window.', keys: [{ w: 'near', zh: '在……旁边' }, { w: 'tree', zh: '树' }], trunk: { subject: 'a big tree', verb: 'There is', note: '有什么 = a big tree（一棵大树），用 There is' }, tags: ['there_be'] },
    { id: 6, en: 'There are two birds in the tree.', zh: '树上有两只鸟。', chunks: 'There are / two birds / in the tree.', keys: [{ w: 'birds', zh: '鸟' }], trunk: { subject: 'two birds', verb: 'There are', note: '有什么 = two birds（两只鸟），两只用 There are' }, tags: ['there_be', 'plural'] },
    { id: 7, line: 7, speaker: 'Lily', en: 'Kitty, are you hungry?', zh: 'Kitty，你饿了吗？', chunks: 'Kitty, / are you hungry?', keys: [{ w: 'hungry', zh: '饿的' }], trunk: { subject: 'you', verb: 'are', note: '谁 = you（你），是 = are，怎么样 = hungry（饿的）' }, tags: ['be_adj'] },
    { id: 8, en: 'Kitty does not look at her food.', zh: 'Kitty 不看它的食物。', chunks: 'Kitty does not look / at her food.', keys: [{ w: 'food', zh: '食物' }], trunk: { subject: 'Kitty', verb: 'does not look', note: '谁 = Kitty，干什么 = does not look（不看）' }, tags: ['third_s', 'pronoun'] },
    { id: 9, en: 'She is not hungry.', zh: '它不饿。', chunks: 'She is not hungry.', keys: [{ w: 'hungry', zh: '饿的' }], trunk: { subject: 'She', verb: 'is not', note: '谁 = She（Kitty），是 = is not（不是）' }, tags: ['be_adj', 'pronoun'] },
    { id: 10, en: 'She wants to wait for the birds.', zh: '它想等那些鸟。', chunks: 'She wants / to wait for the birds.', keys: [{ w: 'wait for', zh: '等' }], trunk: { subject: 'She', verb: 'wants', note: '谁 = She（Kitty），干什么 = wants（想要）' }, tags: ['third_s', 'pronoun'] },
    { id: 11, en: 'Lily sits with her and waits, too.', zh: 'Lily 坐在它旁边，也一起等。', chunks: 'Lily sits with her / and waits, too.', keys: [{ w: 'waits', zh: '等' }], trunk: { subject: 'Lily', verb: 'sits', note: '谁 = Lily，干什么 = sits（坐）和 waits（等）' }, tags: ['third_s'] },
    { id: 12, en: 'The room is quiet.', zh: '房间里很安静。', chunks: 'The room is quiet.', keys: [{ w: 'quiet', zh: '安静的' }], trunk: { subject: 'The room', verb: 'is', note: '谁 = The room（房间），是 = is，怎么样 = quiet' }, tags: ['be_adj'] },
    { id: 13, en: 'Then the birds fly to the window!', zh: '然后，那两只鸟飞到了窗边！', chunks: 'Then / the birds fly / to the window!', keys: [{ w: 'fly', zh: '飞' }], trunk: { subject: 'the birds', verb: 'fly', note: '谁 = the birds（鸟），干什么 = fly（飞）' }, tags: ['plural'] },
    { id: 14, en: 'Kitty is happy. Now she is hungry.', zh: 'Kitty 很开心。现在它饿了。', chunks: 'Kitty is happy. / Now she is hungry.', keys: [{ w: 'happy', zh: '开心的' }], trunk: { subject: 'Kitty', verb: 'is', note: '谁 = Kitty，是 = is，怎么样 = happy' }, tags: ['be_adj', 'pronoun'] },
  ],
  questions: [
    { id: 'q1', type: 'evidence', skill: 'locate', ask: 'Where does Kitty sit every day?', zh: 'Kitty 每天坐在哪儿？', keyword: 'every day', preview: true, answer: [3], evidence: [3], drop: 11,
      hints: ['找一找题目里的 every day（每天），看它在哪一句。', '在前半篇，Lily 家的猫出场以后。', '排除第 11 句：那是 Lily 坐下来，不是 Kitty 每天坐的地方。', '答案是第 3 句：Every day, Kitty sits at the window.（每天，Kitty 都坐在窗边。）'],
      then: { ask: 'Where does Kitty sit every day?', zh: 'Kitty 每天坐在哪儿？', options: ['At the window.', 'In the tree.', 'Near her food.', 'On Lily’s bed.'], options_zh: ['在窗边。', '在树上。', '在食物旁边。', '在 Lily 的床上。'], answer: 'At the window.' },
      variant: { ask: 'What is near the window?', zh: '窗户旁边有什么？', keyword: 'near', answer: [5], evidence: [5], explain: '第 5 句：There is a big tree near the window.（窗户旁边有一棵大树。）' } },
    { id: 'q2', type: 'reference', skill: 'ref', ask: 'Who is “She” in Sentence 4?', zh: '第 4 句里的 She 指谁？', pronoun: 'She', at: 4, options: ['Lily', 'Kitty', 'the birds', 'the tree'], options_zh: ['Lily', 'Kitty', '那些鸟', '那棵树'], answer: 'Kitty', evidence: [3, 4], drop: 'Lily',
      hints: ['回到第 4 句，再看它前面的第 3 句。', 'She 一般指前面刚说到的那一个。第 3 句刚说完 Kitty。', '排除 Lily：第 3、4 句说的都是坐在窗边的猫。', '答案是 Kitty。第 3 句说 Kitty 坐在窗边，第 4 句接着说 She is very quiet。'],
      variant: { ask: 'Who is “She” in Sentence 10?', zh: '第 10 句里的 She 指谁？', pronoun: 'She', at: 10, options: ['Lily', 'Kitty', 'the birds', 'the tree'], options_zh: ['Lily', 'Kitty', '那些鸟', '那棵树'], answer: 'Kitty', evidence: [8, 9, 10], explain: '第 8、9 句都在说 Kitty，第 10 句的 She 还是 Kitty。' } },
    { id: 'q3', type: 'infer', skill: 'infer', ask: 'Why does Kitty sit at the window?', zh: 'Kitty 为什么坐在窗边？', options: ['She is hungry.', 'She wants to wait for the birds.', 'She is sad.', 'Lily is in the tree.'], options_zh: ['它饿了。', '它想等那些鸟。', '它不开心。', 'Lily 在树上。'], answer: 'She wants to wait for the birds.', evidence: [6, 10], drop: 'She is hungry.',
      hints: ['看第 6 句和第 10 句。', '关键词是 birds（鸟）：树上有鸟，Kitty 想等它们。', '排除“She is hungry”：第 9 句说它不饿。', '答案是“She wants to wait for the birds”。第 10 句：She wants to wait for the birds.'],
      variant: { ask: 'Is Kitty hungry at first?', zh: '一开始 Kitty 饿吗？', options: ['Yes, she is.', 'No, she is not.', 'Yes, she eats a bird.', 'No, Lily is hungry.'], options_zh: ['是的，它饿。', '不，它不饿。', '是的，它吃了一只鸟。', '不，是 Lily 饿了。'], answer: 'No, she is not.', evidence: [9], explain: '第 9 句：She is not hungry.（它不饿。）' } },
    { id: 'q4', type: 'cloze', skill: 'word', word: 'quiet', ask: 'Choose the right word.', zh: '选一个词，填进句子里。', stem: 'Please be ______. The baby is sleeping.', stem_zh: '请____。宝宝在睡觉。', options: ['hungry', 'quiet', 'window', 'wait'], options_zh: ['饿的', '安静的', '窗户', '等'], answer: 'quiet', evidence: [4, 12], drop: 'window',
      hints: ['回到第 4 句和第 12 句，看 quiet 是什么意思。', '宝宝在睡觉，要不出声。', '排除 window：window 是窗户，不能说“请窗户”。', '答案是 quiet（安静的）。Please be quiet. 请安静。'],
      variant: { stem: 'The room is very ______ at night.', stem_zh: '晚上房间里非常____。', options: ['hungry', 'wait', 'quiet', 'window'], options_zh: ['饿的', '等', '安静的', '窗户'], answer: 'quiet', explain: '晚上房间里没有声音，是 quiet（安静的）。' } },
  ],
};
export function mockPiece(mat, { now = new Date(), id = '' } = {}) {
  const m = { ...mat, targets: ['window', 'quiet', 'wait', 'hungry'].map(w => ({ w, zh: { window: '窗户', quiet: '安静的', wait: '等', hungry: '饿的' }[w], slug: w, kind: 'new' })),
    points: [{ card: 'there_be', tag: 'there_be', title: 'there be（有）' }] };
  const passage = normalizePassage(MOCK_RAW, m, { id: id || `daily-${m.date}-${m.n}` });
  const report = checkPassage(passage, { vocab: m.vocab || makeVocab({}), targets: m.targets, spec: m.spec || levelSpec(0) });
  return makePiece({ mat: m, passage, report, now, id: passage.id, model: 'mock', provider: 'mock', mock: true });
}

// ---------------------------------------------------------------- 5. 存、后台写、再来一篇
export function normDay(raw, date) {
  const r = obj(raw);
  return { v: 1, date: str(r.date) || date, pieces: arr(r.pieces).filter(p => p && p.id && p.passage && Array.isArray(p.passage.sentences)),
    tries: arr(r.tries).filter(t => t && t.at).slice(-6), updated: str(r.updated) };
}
const memory = new Map();   // mock mode: pieces never go into kv
export function readDay(kv, date) {
  return normDay(peek(kv, kvKey(date), null), date);
}
// read the newest copy, change it, write it back (another tab or session may have written in between)
export async function saveDay(kv, date, fn, { mock = false } = {}) {
  if (mock) { const cur = normDay(memory.get(date), date); const next = normDay(fn(cur) || cur, date); memory.set(date, next); return next; }
  let cur = null;
  try { cur = kv && kv.get ? await kv.get(kvKey(date), null) : peek(kv, kvKey(date), null); } catch (e) { cur = peek(kv, kvKey(date), null); }
  const base = normDay(cur, date);
  const next = normDay(fn(clone(base)) || base, date);
  next.updated = R.isoLocal(new Date());
  if (kv && kv.set) await kv.set(kvKey(date), next);
  return next;
}
const dayFor = (ctx, date) => (isMock(ctx) ? normDay(memory.get(date), date) : readDay(ctx && ctx.kv, date));
export function pieceById(kv, id, { mock = false } = {}) {
  const m = String(id || '').match(/^daily-(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (!m) return null;
  const d = mock ? normDay(memory.get(m[1]), m[1]) : readDay(kv, m[1]);
  return d.pieces.find(p => p.id === id) || null;
}

const inflight = new Map();   // date -> Promise
export const writing = (date = dayOf(new Date())) => inflight.has(date);

export function dayState(kvOrDay, now = new Date(), { mock = false } = {}) {
  const date = dayOf(now);
  const d = kvOrDay && kvOrDay.pieces ? normDay(kvOrDay, date) : mock ? normDay(memory.get(date), date) : readDay(kvOrDay, date);
  const pieces = d.pieces.slice().sort((a, b) => a.n - b.n);
  const unread = pieces.filter(p => !(p.read && p.read.done));
  const lastTry = d.tries[d.tries.length - 1] || null;
  return {
    date, pieces, ready: unread[0] || null, unread: unread.length, readCount: pieces.length - unread.length,
    canMore: pieces.length < MAX_PER_DAY, writing: writing(date), failed: !pieces.length && !!lastTry, lastTry, tries: d.tries.length,
  };
}

async function writeOne(ctx, { date, n, now, fetchImpl, sleep }) {
  const mock = isMock(ctx);
  const key = date;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try {
      const piece = await generate(ctx, { date, n, now, fetchImpl, sleep });
      await saveDay(ctx.kv, date, d => {
        if (d.pieces.some(p => p.n === piece.n)) {
          piece.n = Math.max(...d.pieces.map(p => p.n)) + 1;
          piece.id = `daily-${date}-${piece.n}`;
          piece.passage.id = piece.id;
        }
        if (d.pieces.length < MAX_PER_DAY) d.pieces.push(piece);
        return d;
      }, { mock });
      return piece;
    } catch (e) {
      try {
        await saveDay(ctx.kv, date, d => { d.tries.push({ at: R.isoLocal(now), n, code: str(e && e.code) || 'error', message: str(e && e.message).slice(0, 160) }); return d; }, { mock });
      } catch (e2) { /* bookkeeping only */ }
      throw e;
    }
  })();
  inflight.set(key, job);
  job.then(() => inflight.delete(key), () => inflight.delete(key));
  return job;
}

const online = () => !(globalThis.navigator && navigator.onLine === false);
const blocked = ctx => !!safe(() => ctx.budget && ctx.budget.blockReason && ctx.budget.blockReason(GEN_KIND), '');
// 后台：今天还没有就写今天的；今天的有了、19 点以后，写明天的。没网、预算到了、正在写、刚失败过（30 分钟内或今天失败 3 次）都不写。
export async function prepare(ctx, { now = new Date(), fetchImpl = null, sleep = sleepMs } = {}) {
  try {
    if (!ctx || !ctx.kv) return null;
    const mock = isMock(ctx);
    if (!mock) cleanOld(ctx.kv, now);
    if (!mock && (!online() || blocked(ctx))) return null;
    const today = dayOf(now);
    const st = dayState(dayFor(ctx, today), now);
    const recentFail = st.lastTry && (now - new Date(st.lastTry.at) < RETRY_AFTER_MS || st.tries >= 3);
    if (!st.pieces.length) {
      if (recentFail || writing(today)) return null;
      return await writeOne(ctx, { date: today, n: 1, now, fetchImpl, sleep });
    }
    if (now.getHours() >= EVENING_HOUR) {
      const tomorrow = addDays(today, 1);
      const t = dayFor(ctx, tomorrow);
      if (t.pieces.length || writing(tomorrow) || t.tries.length >= 2) return null;
      return await writeOne(ctx, { date: tomorrow, n: 1, now, fetchImpl, sleep });
    }
    return null;
  } catch (e) { return null; }
}
// “再来一篇”：今天第 2、3 篇（今天一篇都没有就是第 1 篇）
export async function another(ctx, { now = new Date(), fetchImpl = null, sleep = sleepMs } = {}) {
  const today = dayOf(now);
  const st = dayState(dayFor(ctx, today), now);
  if (!st.canMore) throw new AIError('今天已经读了 3 篇，明天再来。', 'limit');
  if (writing(today)) return inflight.get(today);
  if (!isMock(ctx) && !online()) throw new AIError('连不上：网络不通。', 'network');
  const n = st.pieces.length ? Math.max(...st.pieces.map(p => p.n)) + 1 : 1;
  return writeOne(ctx, { date: today, n, now, fetchImpl, sleep });
}
function cleanOld(kv, now) {
  const cutoff = addDays(dayOf(now), -KEEP_DAYS);
  for (const k of safe(() => kv.keys(KV_PREFIX), []) || []) {
    const d = k.slice(KV_PREFIX.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) safe(() => { const r = kv.delete(k); if (r && r.catch) r.catch(() => {}); });
  }
}

// ---------------------------------------------------------------- 6. 没写成：现成的顶上
// content：reader.js 的 Content（R.content()）；passages：期中阅读小篇 [Ep]（R.loadPassages）
// 先没读完的番外下一集，再没读过（或最早读过）的期中阅读小篇，再番外里她最吃力的那集
export function pickFallback({ kv = null, content = null, passages = [], now = new Date() } = {}) {
  const c = content || safe(() => R.content(), null);
  if (c) {
    const next = safe(() => R.nextEpisode(kv, { content: c }), null);
    if (next) return { kind: 'story', episodeId: next };
  }
  const list = arr(passages);
  if (list.length) {
    const done = obj(obj(peek(kv, 'exam.reading', {})).done);
    const fb = obj(obj(peek(kv, 'daily.fallback', {})).done);
    const when = p => fb[p.id] || done[p.id] || '';
    const pick = list.slice().sort((a, b) => String(when(a)).localeCompare(String(when(b))))[0];
    if (pick) return { kind: 'passage', id: pick.id, passage: pick };
  }
  if (c) {
    const cell = safe(() => R.readCell(kv, now, { content: c }), null);
    if (cell && cell.episodeId) return { kind: 'story', episodeId: cell.episodeId, again: true };
    if (c.episodes && c.episodes.length) return { kind: 'story', episodeId: c.episodes[0].id, again: true };
  }
  return null;
}

// ---------------------------------------------------------------- 7. 读完：目标词、句型进复习，记一笔
// result 是 renderPassage 的 onDone（results、stats、ms、helps、hardSentences）。
export async function settleRead(ctx, piece, result = {}, { now = new Date(), step = 'read', sid = '' } = {}) {
  const out = { added: [], queued: [] };
  if (!ctx || !piece) return out;
  const mock = isMock(ctx) || !!piece.mock;
  const res = obj(result);
  const results = arr(res.results);
  const stats = obj(res.stats);
  if (!mock) {
    // 1. target words into the word book (favorited = in the review queue); ones already there stay as they are
    const W = ctx.words;
    for (const t of arr(piece.targets)) {
      try {
        const slug = t.slug || R.slugify(t.w);
        let e = W && W.get ? W.get(slug) : null;
        if (!e && W && W.importData) {
          const info = { slug, base: t.w, w: t.w, zh: t.zh || '', source: t.zh ? 'story' : 'dict' };
          await W.importData(R.placeholderExport(info, now));
          e = W.get ? W.get(slug) : null;
          if (e) out.added.push(t.w);
        } else if (e && !e.favorited) {
          if (ctx.toggleFav) await ctx.toggleFav(slug, true); else if (W.favorite) await W.favorite(slug, true);
          out.added.push(t.w);
        }
      } catch (e) { /* one word failing never stops the rest */ }
    }
    // 2. the sentence patterns: a card she has started gets a review (tomorrow if this reading was hard on it, else in 3 days)
    const gc = safe(() => G.content(), null);
    const day = dayOf(now);
    const helpedTags = new Set();
    for (const hs of arr(res.hardSentences)) { const s = piece.passage.sentences.find(x => x.id === hs.i || x.id === Number(hs.i)); for (const t of arr(s && s.tags)) helpedTags.add(t); }
    for (const p of arr(piece.points)) {
      try {
        const card = gc && gc.card ? gc.card(p.card) : null;
        if (!card || !ctx.kv) continue;
        const cur = G.normState(peek(ctx.kv, G.kvKey(p.card), null), p.card);
        if (G.cardStatus(cur, now) === 'new') continue;            // not started: nextCard brings it in its turn
        const soon = addDays(day, 3);
        if (cur.reviews.some(r => r.due && r.due <= soon)) continue;  // one is coming anyway
        const q = (card.questions || []).find(x => x.family) || null;
        if (!q) continue;
        const hard = helpedTags.has(p.tag);
        const rec = { id: q.id, family: q.family, miss: day, step: hard ? 0 : 1, due: addDays(day, hard ? 1 : 3), served: [], from: 'daily' };
        const next = { ...cur, reviews: [...cur.reviews.filter(r => r.id !== q.id), rec], updated: R.isoLocal(now) };
        await ctx.kv.set(G.kvKey(p.card), next);
        out.queued.push(p.card);
      } catch (e) { /* keep going */ }
    }
  }
  // 3. the piece remembers it was read
  const read = { at: R.isoLocal(now), done: res.done !== false, right: Number(stats.right) || 0, fuzzy: Number(stats.fuzzy) || 0, failed: Number(stats.failed) || 0,
    ms: Number(res.ms) || 0, added: out.added, queued: out.queued };
  const m = String(piece.id).match(/^daily-(\d{4}-\d{2}-\d{2})-\d+$/);
  if (m) { try { await saveDay(ctx.kv, m[1], d => { const p = d.pieces.find(x => x.id === piece.id); if (p) p.read = read; return d; }, { mock }); } catch (e) { /* the reading itself is done */ } }
  // 4. one event
  try {
    const ev = { type: 'read_time', item: EVENT_PREFIX + piece.id, mode: 'read', step, phase: 'done', daily: true, episode: piece.id,
      words: piece.check ? piece.check.words : 0, sentences: piece.passage.sentences.length, completed: res.done !== false, ms: read.ms,
      right: read.right, fuzzy: read.fuzzy, failed: read.failed, answered: results.length,
      targets: arr(piece.targets).map(t => t.w), points: arr(piece.points).map(p => p.card), topic: piece.topic && piece.topic.id, level: piece.level, ...(sid ? { sid } : {}) };
    if (ctx.events && ctx.events.log) { const r = ctx.events.log(ev); if (r && r.catch) r.catch(() => {}); }
  } catch (e) { /* never blocks */ }
  return out;
}
// 顶替的现成内容读完：记一笔（小篇记进 kv 'daily.fallback'，下次换一篇）
export async function settleFallback(ctx, fb, result = {}, { now = new Date(), step = 'read', sid = '' } = {}) {
  if (!ctx || !fb) return;
  if (fb.kind === 'passage' && ctx.kv && !isMock(ctx)) {
    try { const cur = obj(peek(ctx.kv, 'daily.fallback', {})); await ctx.kv.set('daily.fallback', { v: 1, done: { ...obj(cur.done), [fb.id]: dayOf(now) }, updated: R.isoLocal(now) }); } catch (e) { /* fine */ }
  }
  try {
    const id = fb.kind === 'story' ? fb.episodeId : fb.id;
    const ev = { type: 'read_time', item: EVENT_PREFIX + 'fallback-' + id, mode: 'read', step, phase: 'done', daily: true, fallback: fb.kind, episode: id,
      completed: obj(result).done !== false, ms: Number(obj(result).ms) || 0, ...(sid ? { sid } : {}) };
    if (ctx.events && ctx.events.log) { const r = ctx.events.log(ev); if (r && r.catch) r.catch(() => {}); }
  } catch (e) { /* never blocks */ }
}

// 0.8.0 接着练 (ui-practice.js readOptions): today's reading as { id, title, minutes, done } | null
export function todayRead(ctx, now = new Date()) {
  try {
    const mock = isMock(ctx);
    const l = homeLine(mock ? null : ctx && ctx.kv, now, { mock });
    if (l.status === 'ready') return { id: l.id, title: '今天的阅读', minutes: Number((String(l.sub).match(/约 (\d+) 分钟/) || [])[1]) || 6, done: false };
    if (l.status === 'done') return { id: 'daily-' + dayOf(now), title: '今天的阅读', minutes: 6, done: true };
    if (l.status === 'writing') return { id: 'daily-' + dayOf(now), title: '今天的阅读', minutes: 6, done: false };
    return null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- 8. 首页“接着练”的一行
export function homeLine(kvOrDay, now = new Date(), { mock = false } = {}) {
  const st = dayState(kvOrDay, now, { mock });
  const minutes = p => Math.max(3, Math.round(((p.check && p.check.words) || 120) / 40) + (p.passage.questions || []).length);
  if (st.ready) return { status: 'ready', label: '今天的阅读', sub: `${st.ready.topic ? st.ready.topic.zh + ' · ' : ''}约 ${minutes(st.ready)} 分钟`, more: st.canMore, id: st.ready.id };
  if (st.writing) return { status: 'writing', label: '今天的阅读', sub: '老师在写', more: false };
  if (st.pieces.length) return { status: 'done', label: '今天的阅读', sub: st.canMore ? `读完了 ${st.readCount} 篇 · 再来一篇` : `今天读完 ${st.readCount} 篇了`, more: st.canMore };
  return { status: 'none', label: '今天的阅读', sub: '先读一篇现成的', more: false };
}
