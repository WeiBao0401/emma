// 地基探针和小学 505 词摸底（design/teacher-next.md 4.1、DESIGN 5.2）。都混在热身里，孩子端不说“测验”。
// 内容在 curriculum/probes.json（原创探针 36 道；课标 505 词按词频排、给初一孩子的中文、6 个假词）。
// 这个文件是纯逻辑（不碰 DOM、不读数据库），Node 里直接测。画界面在 ui-screen.js，样式 css/screen.css（类名 scr-）。
// 负责：地基探针和 505 摸底 agent（screen.js、ui-screen.js、css/screen.css、curriculum/probes.json、tests/screen.test.mjs）。
//
// 一、地基探针
//   6 块地基：be 动词、名词复数、人称代词主格和宾格、物主代词、三单 -s、there be，各 6 道选择题。每道题的错误选项带误解标签
//   （tags.json），四级提示和语法卡一样（答错自动出下一级；错到只剩答案那一个，直接出第 4 级）。
//   每天最多 2 道混进热身（probeItems），轮流探：答得少的那块先，一样多的最久没探的先，再按上面的顺序。
//   只看第一次就答对、没看提示的（clean）。每块的状态：
//     稳 steady：前 4 道全对，或对了 5 道；全部做完时错的不超过 1 道
//     不会 weak：前 3 道全错，或错了 4 道；全部做完时对的比错的少
//     在练 practicing：对了 3 道以上、又错了 2 道以上（怎么做都到不了“稳”，也到不了“不会”）；全部做完时其余的情况
//     还在看 probing：还看不出来；还没探 new：一道没做
//   有了结论（稳 / 在练 / 不会）的那块不再探。“不会”的那块，对应的语法卡提前（weakFoundations 给 grammar.js nextCard）。
//
// 二、小学 505 词摸底
//   课标二级词 505 个，去掉每节课都在用的 31 个（ASSUMED：a、the、I、you、is 这类，直接算认识），剩下 474 个按词频排。
//   每天热身里混 12 个（SCREEN_PER_DAY，10 到 15 个；plan 可以给 max），看词点“认识 / 不确定 / 没学过”，约 3 秒一个。
//   混进 6 个像英语的假词（fakeAt：摸到第 3、16、40、75、120、190 个词时各出一个，一天最多一个，不放在第一个）。
//   她对假词点了“认识”：从这以后每个“认识”都核对（audit），以前点了“认识”、还没核对过的，每天先出 3 个直接核对（recheck）。
//   平时点“认识”的，每 3 个核对 1 个（第 3、6、9……个）：四选一选中文，还有“想不起来了”。
//   不会的词（没学过、不确定、核对错了）进单词本，打开认得线（ui-screen.js 收尾时 addToBook）。
//   knownPrimary(kv) 给故事和问老师当已知词表：认识而且核对过（或者还没出过假词、不用核对）的，加上 ASSUMED。
//
// 导出
//   FILE = 'curriculum/probes.json'；PROBE_KEY = 'probe:state'；SCREEN_KEY = 'screen:505'
//   PROBE_MAX = 2；SCREEN_PER_DAY = 12；SCREEN_MIN = 10；SCREEN_MAX = 15；CHECK_EVERY = 3；RECHECK_MAX = 3
//   STATUS_LABEL = { steady: '稳', practicing: '在练', weak: '不会', probing: '还在看', new: '还没探' }
//   loadScreen({ fetchJSON }) -> Promise<Content>（读 probes.json 并缓存；读不到抛错）；setContent(data)；content()
//   createContent(data) -> Content = { version, blocks: [Block], block(id), probes: [Probe], probe(id), probesOf(blockId),
//       screen: { words: [Word], word(w), fakes, fakeAt, assumed, perDay, apart } }
//     Block = { id, name, point, card }；Probe = probes.json 的一道（id、block、kind、stem?、cue?、ask?、answer、wrong、zh、hints）
//     Word = { w, zh, kind: 'f' | 'a' | 'p' | 'x', display, slug, rank }   rank 是词频顺序（0 起）
//   slugify(w)   和 words.js 一样
//   probeQuestion(id, c?) -> Question   grammar.js 的题目形状（G.createAttempt、G.optionsOf、G.sentenceOf 直接能用）：
//       { id, item: 'g:<语法点>:pb-<id>', block, blockName, point, family, familyName, kind, stem, cue, ask, answer, wrong, zh,
//         hints, explain, variant: null, spare: false, isVariant: false, probe: true }   没有 card、unit（事件里就不带）
//   probeItemId(id, c?) -> 'g:be:pb-be1'；probeIdOf(item) -> 'be1' | null
//   emptyProbe()；readProbe(x) -> ProbeState   x 是 kv（读 'probe:state'）、kv 里的值，或 { probe: 值 }；坏数据读成空的
//   blockStatus(state, blockId, c?) -> { id, name, status, label, n, right, wrong, tags: [她选错的误解], last, open: 还能出几道 }
//   probeItems(state, now, { max = 2, content }) -> [ProbeItem]
//       ProbeItem = { type: 'probe', id, item, block, point, card, mode: 'grammar' }
//       今天已经做了几道就少给几道；同一天、同样的进度，结果一样。全部有结论了返回 []
//   applyProbe(state, { qid, result, now }) -> ProbeState   result 是 G.createAttempt(q).result()（看 clean、tags、hintLevel、grade）
//   flagProbe(state, qid, now) -> ProbeState   “这题有问题”：不再出，不算进状态
//   weakFoundations(x, { content, include = ['weak'] }) -> { blocks: [blockStatus], cards: [语法卡 id], points: ['g:be', ...], tags }
//       “不会”的那几块。cards 给 grammar.js nextCard 提前这些卡；points 可以直接并进 nextCard 的 state.grammarFocus
//       （地基卡 be_verb、plural、present_simple 现在就能提前；pronoun、there_be 不是地基卡，要 nextCard 认 state.weakCards，见 needs）
//   probeSummary(x, { content }) -> [blockStatus]   6 块，按顺序；给家长区
//
//   emptyScreen()；readScreen(x) -> ScreenState   x 是 kv（读 'screen:505'）、kv 里的值，或 { screen: 值 }
//   screenItems(state, now, { max = 12, content, skip }) -> [ScreenItem]
//       ScreenItem = { type: 'screen', id: 'w:<slug>' | 'fake:<词>', w, slug?, zh?, display, fake?: true, recheck?: true }
//       先出要补核对的（最多 3 个），再按词频出没摸过的；假词按 fakeAt 插在中间。skip 是不用摸的词（比如已经在单词本里的）。
//       今天已经做了几个就少给几个；同一天、同样的进度，结果一样。
//   answerScreen(state, item, choice, now) -> { state, check: bool, fakeHit: bool }   choice 'know' | 'unsure' | 'new'
//       check 为真：马上出四选一核对（answerCheck）。fakeHit：她对假词点了认识（从此每个认识都核对）
//   answerCheck(state, item, correct, now) -> ScreenState   核对的结果（“想不起来了”算错）
//   checkOptions(w, { content }) -> { options: [4 个中文], answer: 下标 }   同一个词每次一样；错误选项不是近义词、不是同一类的大词
//       （cat 不配“动物”）、不和答案共用汉字（的、子、一、个、在、儿 除外），尽量和答案同一种词（kind）
//   pendingWords(state, c?) -> [{ w, slug, zh, display, why: 'new' | 'unsure' | 'wrong' }]   该进单词本、还没进的
//   markQueued(state, slugs, now) -> ScreenState
//   knownPrimary(x, { content, assumed = true }) -> [词]   她认识的小学词（原形、小写），按词频
//   unknownPrimary(x, { content }) -> [词]   摸过、不认识的（没学过、不确定、核对错了），按词频
//   screenSummary(x, { content }) -> { of, done, left, known, unsure, new, wrong, checked, fakes, fakeHits, audit, finished }
//       给家长区（孩子端不放这些数字）
//   placeholderExport(word, now) -> emma-export   一个词条（favorited，needs_core，中文是这里写好的），给 words.importData
//
// kv 'probe:state'（新键）
//   { v: 1, items: { qid: { at: 'YYYY-MM-DD', ok: 第一次就对没看提示, tag: 第一次选错的误解 | null, tags: [这题选错的误解],
//     hint: 看到第几级, grade, flagged?: true } }, updated }
// kv 'screen:505'（新键）
//   { v: 1, words: { 词: { a: 'know' | 'unsure' | 'new', at, check?: 'right' | 'wrong', checkAt?, queued?: 'YYYY-MM-DD' } },
//     fakes: { 假词: { a, at } }, audit: 'YYYY-MM-DD' | null, knownN: 点了几次“认识”, intro: 第一次看到的那天 | null,
//     days: { 'YYYY-MM-DD': 那天摸了几个 }（留 14 天）, updated }
//
// 事件（ui-screen.js 记；字段都是 CONTRACTS 第 6 节已有的）
//   探针：answer { item: 'g:<点>:pb-<id>', mode: 'grammar', kind: 'probe', block, point, family, choice, correct, first_try, ms,
//         hint_level, misconception, done?, passed?, grade?, fixed_after? }；hint { item, mode: 'grammar', kind: 'probe', level, auto }；
//         flag { item, mode: 'grammar', kind: 'probe', reason: 'probe' }
//   摸底：ask { qid: 'screen', who: 'emma', item: 'w:<slug>' | 'fake:<词>', slug?, answer: 'know' | 'unsure' | 'new', about: 'screen:505',
//         fake?: true, ms }；核对 answer { item: 'w:<slug>', slug, mode: 'mc4', kind: 'screen', direction: 'en2zh', choice, correct,
//         first_try: true, ms, hint_level: 0, misconception: null, recheck? }

export const FILE = 'curriculum/probes.json';
export const PROBE_KEY = 'probe:state';
export const SCREEN_KEY = 'screen:505';
export const PROBE_MAX = 2;
export const SCREEN_PER_DAY = 12;
export const SCREEN_MIN = 10;
export const SCREEN_MAX = 15;
export const CHECK_EVERY = 3;
export const RECHECK_MAX = 3;
export const DAYS_KEPT = 14;
export const STATUS_LABEL = { steady: '稳', practicing: '在练', weak: '不会', probing: '还在看', new: '还没探' };
const DECIDED = new Set(['steady', 'practicing', 'weak']);
const CHOICES = new Set(['know', 'unsure', 'new']);

// ---------------------------------------------------------------- small helpers

const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : typeof x === 'function' ? toDate(x()) : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localIso = d => `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
function shuffled(list, seed) { const a = list.slice(); const r = rng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// same as words.js slugify
export function slugify(word) {
  let s = String(word ?? '').trim().toLowerCase();
  s = s.replace(/[^\p{L}\p{N}_\s'-]/gu, '');
  s = s.replace(/[\s']+/g, '-').replace(/^-+|-+$/g, '');
  return Array.from(s).slice(0, 80).join('') || 'word';
}

// ---------------------------------------------------------------- content

let cached = null;
export function setContent(data) { cached = data ? createContent(data) : null; return cached; }
export function content() { return cached; }
export async function loadScreen({ fetchJSON } = {}) {
  const get = fetchJSON || (async p => { const r = await fetch(p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
  return setContent(await get(FILE));
}

export function createContent(data) {
  const blocks = ((data && data.blocks) || []).map((b, i) => ({ id: b.id, name: b.name || b.id, point: b.point || '', card: b.card || '', index: i }));
  const blockById = new Map(blocks.map(b => [b.id, b]));
  const probes = ((data && data.probes) || []).filter(p => p && p.id && blockById.has(p.block));
  const probeById = new Map(probes.map(p => [p.id, p]));
  const sc = (data && data.screen) || {};
  const words = (sc.words || []).map((row, rank) => {
    const [w, zh, kind, display] = Array.isArray(row) ? row : [row.w, row.zh, row.kind, row.display];
    return { w: String(w).toLowerCase(), zh: String(zh || ''), kind: kind || 'x', display: display || String(w), slug: slugify(w), rank };
  }).filter(x => x.w && x.zh);
  const wordBy = new Map(words.map(x => [x.w, x]));
  const apart = new Map();
  for (const g of sc.apart || []) for (const w of g) { if (!apart.has(w)) apart.set(w, new Set()); for (const o of g) if (o !== w) apart.get(w).add(o); }
  return {
    version: (data && data.version) || 1,
    blocks,
    block: id => blockById.get(id) || null,
    probes,
    probe: id => probeById.get(id) || null,
    probesOf: id => probes.filter(p => p.block === id),
    screen: {
      words, word: w => wordBy.get(String(w || '').toLowerCase()) || null,
      fakes: (sc.fakes || []).map(String), fakeAt: (sc.fakeAt || []).map(Number),
      assumed: (sc.assumed || []).map(w => String(w).toLowerCase()),
      perDay: Number(sc.perDay) || SCREEN_PER_DAY,
      apart,
    },
  };
}
const ctOf = c => c || cached;

// ---------------------------------------------------------------- 地基探针

const shortPoint = point => String(point || '').replace(/^g:/, '') || 'probe';
export function probeItemId(id, c = null) {
  const ct = ctOf(c);
  const p = ct && ct.probe(id);
  const b = p && ct.block(p.block);
  return `g:${shortPoint(b && b.point)}:pb-${id}`;
}
export function probeIdOf(item) {
  const m = String(item || '').match(/^g:[^:]+:pb-(.+)$/);
  return m ? m[1] : null;
}

export function probeQuestion(id, c = null) {
  const ct = ctOf(c);
  const p = ct && ct.probe(id);
  if (!p) return null;
  const b = ct.block(p.block);
  const kind = p.kind === 'pick' ? 'pick' : 'fill';
  const hints = Array.isArray(p.hints) ? p.hints.slice(0, 4) : [];
  return {
    id: p.id, item: probeItemId(p.id, ct), block: p.block, blockName: b.name, point: b.point,
    family: p.block, familyName: b.name, kind, stem: p.stem || '', cue: p.cue || '',
    ask: p.ask || (kind === 'pick' ? '选出正确的句子。' : '选出填进空里的词。'),
    answer: String(p.answer), wrong: { ...(p.wrong || {}) }, zh: p.zh || '', hints, explain: p.explain || hints[3] || '',
    variant: null, spare: false, isVariant: false, probe: true,
  };
}

export function emptyProbe() { return { v: 1, items: {}, updated: null }; }
function normProbe(raw) {
  const e = emptyProbe();
  if (!isObj(raw)) return e;
  const items = {};
  for (const [qid, it] of Object.entries(isObj(raw.items) ? raw.items : {})) {
    if (!isObj(it)) continue;
    items[qid] = { at: isDay(it.at) ? it.at : String(it.at || '').slice(0, 10), ok: !!it.ok, tag: it.tag || null,
      tags: Array.isArray(it.tags) ? it.tags.filter(Boolean) : [], hint: Number(it.hint) || 0, grade: Number(it.grade) || 0,
      ...(it.flagged ? { flagged: true } : {}) };
  }
  return { ...e, ...raw, v: 1, items, updated: raw.updated || null };
}
const kvLike = x => !!x && typeof x.peek === 'function';
export function readProbe(x) {
  if (kvLike(x)) { try { return normProbe(x.peek(PROBE_KEY, null)); } catch (err) { return emptyProbe(); } }
  if (isObj(x) && isObj(x.probe) && !x.items) return normProbe(x.probe);
  return normProbe(x);
}

export function blockStatus(state, blockId, c = null) {
  const ct = ctOf(c);
  const s = state && state.v ? state : readProbe(state);
  const b = ct && ct.block(blockId);
  const qs = ct ? ct.probesOf(blockId) : [];
  let right = 0, wrong = 0, last = '';
  const tags = [];
  let flagged = 0;
  for (const q of qs) {
    const it = s.items[q.id];
    if (!it) continue;
    if (it.flagged) { flagged++; continue; }
    if (it.ok) right++; else { wrong++; for (const t of it.tags.length ? it.tags : it.tag ? [it.tag] : []) if (!tags.includes(t)) tags.push(t); }
    if (it.at > last) last = it.at;
  }
  const n = right + wrong;
  const avail = qs.length - flagged;
  let status = 'probing';
  if (!n) status = 'new';
  else if ((right >= 4 && !wrong) || right >= 5) status = 'steady';
  else if ((wrong >= 3 && !right) || wrong >= 4) status = 'weak';
  else if (n >= avail) status = wrong <= 1 ? 'steady' : right >= wrong ? 'practicing' : 'weak';
  else if (right >= 3 && wrong >= 2) status = 'practicing';
  const open = DECIDED.has(status) ? 0 : Math.max(0, avail - n);
  return { id: blockId, name: b ? b.name : blockId, point: b ? b.point : '', card: b ? b.card : '', status, label: STATUS_LABEL[status],
    n, right, wrong, tags, last, open };
}

export function probeItems(state, now = new Date(), { max = PROBE_MAX, content: c = null } = {}) {
  const ct = ctOf(c);
  if (!ct || !ct.blocks.length) return [];
  const s = readProbe(state);
  const day = dayOf(now);
  const doneToday = Object.values(s.items).filter(it => it.at === day).length;
  const room = Math.max(0, Math.min(Number.isFinite(max) ? max : PROBE_MAX, PROBE_MAX) - doneToday);
  if (!room) return [];
  const open = ct.blocks.map(b => ({ b, st: blockStatus(s, b.id, ct) })).filter(x => x.st.open > 0);
  open.sort((x, y) => x.st.n - y.st.n || String(x.st.last).localeCompare(String(y.st.last)) || x.b.index - y.b.index);
  const out = [];
  for (const { b } of open) {
    if (out.length >= room) break;
    const q = ct.probesOf(b.id).find(p => !s.items[p.id]);
    if (q) out.push({ type: 'probe', id: q.id, item: probeItemId(q.id, ct), block: b.id, point: b.point, card: b.card, mode: 'grammar' });
  }
  return out;
}

export function applyProbe(state, { qid, result, now = new Date() } = {}) {
  const s = clone(readProbe(state));
  if (!qid || !result) return s;
  const tags = Array.isArray(result.tags) ? result.tags.filter(Boolean) : [];
  s.items[qid] = { at: dayOf(now), ok: !!result.clean, tag: tags[0] || null, tags: [...new Set(tags)], hint: Number(result.hintLevel) || 0,
    grade: Number(result.grade) || (result.passed ? 2 : 1) };
  s.updated = localIso(toDate(now));
  return s;
}
export function flagProbe(state, qid, now = new Date()) {
  const s = clone(readProbe(state));
  if (!qid) return s;
  s.items[qid] = { ...(s.items[qid] || { ok: false, tag: null, tags: [], hint: 0, grade: 0 }), at: dayOf(now), flagged: true };
  s.updated = localIso(toDate(now));
  return s;
}

export function probeSummary(x, { content: c = null } = {}) {
  const ct = ctOf(c);
  if (!ct) return [];
  const s = readProbe(x);
  return ct.blocks.map(b => blockStatus(s, b.id, ct));
}

export function weakFoundations(x, { content: c = null, include = ['weak'] } = {}) {
  const want = new Set(include);
  const blocks = probeSummary(x, { content: c }).filter(b => want.has(b.status));
  const uniq = list => [...new Set(list.filter(Boolean))];
  return { blocks, cards: uniq(blocks.map(b => b.card)), points: uniq(blocks.map(b => b.point)), tags: uniq(blocks.flatMap(b => b.tags)) };
}

// ---------------------------------------------------------------- 小学 505 词摸底

export function emptyScreen() { return { v: 1, words: {}, fakes: {}, audit: null, knownN: 0, intro: null, days: {}, updated: null }; }
function normScreen(raw) {
  const e = emptyScreen();
  if (!isObj(raw)) return e;
  const words = {};
  for (const [w, it] of Object.entries(isObj(raw.words) ? raw.words : {})) {
    if (!isObj(it) || !CHOICES.has(it.a)) continue;
    const r = { a: it.a, at: String(it.at || '').slice(0, 10) };
    if (it.check === 'right' || it.check === 'wrong') { r.check = it.check; if (it.checkAt) r.checkAt = String(it.checkAt).slice(0, 10); }
    if (it.queued) r.queued = String(it.queued).slice(0, 10);
    words[String(w).toLowerCase()] = r;
  }
  const fakes = {};
  for (const [w, it] of Object.entries(isObj(raw.fakes) ? raw.fakes : {})) if (isObj(it) && CHOICES.has(it.a)) fakes[w] = { a: it.a, at: String(it.at || '').slice(0, 10) };
  const days = {};
  for (const [d, n] of Object.entries(isObj(raw.days) ? raw.days : {})) if (isDay(d) && Number(n) > 0) days[d] = Number(n);
  return { ...e, ...raw, v: 1, words, fakes, days, audit: isDay(raw.audit) ? raw.audit : null, knownN: Number(raw.knownN) || 0,
    intro: isDay(raw.intro) ? raw.intro : null, updated: raw.updated || null };
}
export function readScreen(x) {
  if (kvLike(x)) { try { return normScreen(x.peek(SCREEN_KEY, null)); } catch (err) { return emptyScreen(); } }
  if (isObj(x) && isObj(x.screen) && !x.words) return normScreen(x.screen);
  return normScreen(x);
}
function bump(s, day) {
  s.days[day] = (s.days[day] || 0) + 1;
  const keep = Object.keys(s.days).sort().slice(-DAYS_KEPT);
  for (const d of Object.keys(s.days)) if (!keep.includes(d)) delete s.days[d];
}
const needsRecheck = (s, it) => !!s.audit && it.a === 'know' && !it.check;

export function screenItems(state, now = new Date(), { max = null, content: c = null, skip = null } = {}) {
  const ct = ctOf(c);
  if (!ct || !ct.screen.words.length) return [];
  const s = readScreen(state);
  const day = dayOf(now);
  const per = Number.isFinite(max) && max !== null ? Math.max(0, Math.min(SCREEN_MAX, max)) : Math.max(SCREEN_MIN, Math.min(SCREEN_MAX, ct.screen.perDay));
  const room = Math.max(0, per - (s.days[day] || 0));
  if (!room) return [];
  const skipSet = new Set([...(skip || [])].map(x => String(x).toLowerCase()));
  const wordItem = (x, extra = {}) => ({ type: 'screen', id: 'w:' + x.slug, w: x.w, slug: x.slug, zh: x.zh, display: x.display, ...extra });
  const out = [];
  // the ones she said she knew before a fake word showed she was guessing: checked first, a few a day
  const rechecks = ct.screen.words.filter(x => s.words[x.w] && needsRecheck(s, s.words[x.w])).slice(0, Math.min(RECHECK_MAX, room));
  for (const x of rechecks) out.push(wordItem(x, { recheck: true }));
  const fresh = ct.screen.words.filter(x => !s.words[x.w] && !skipSet.has(x.w) && !skipSet.has(x.slug)).slice(0, room - out.length);
  const firstNew = out.length;
  for (const x of fresh) out.push(wordItem(x));
  // one fake word a day at most, once she has met enough real ones; never first in the row
  const met = Object.keys(s.words).length;
  if (fresh.length >= 2) {
    const i = ct.screen.fakes.findIndex((f, k) => !s.fakes[f] && Number.isFinite(ct.screen.fakeAt[k]) && ct.screen.fakeAt[k] <= met + fresh.length);
    if (i >= 0) {
      const f = ct.screen.fakes[i];
      const at = Math.max(1, Math.min(fresh.length - 1, ct.screen.fakeAt[i] - met));
      out.splice(firstNew + at, 0, { type: 'screen', id: 'fake:' + f, w: f, display: f, fake: true });
      if (out.length > room) out.pop();
    }
  }
  return out;
}

export function answerScreen(state, item, choice, now = new Date()) {
  const s = clone(readScreen(state));
  const day = dayOf(now);
  if (!item || !CHOICES.has(choice)) return { state: s, check: false, fakeHit: false };
  if (!s.intro) s.intro = day;
  s.updated = localIso(toDate(now));
  if (item.fake) {
    s.fakes[item.w] = { a: choice, at: day };
    bump(s, day);
    const fakeHit = choice === 'know';
    if (fakeHit && !s.audit) s.audit = day;
    return { state: s, check: false, fakeHit };
  }
  const w = String(item.w || '').toLowerCase();
  if (!w) return { state: s, check: false, fakeHit: false };
  const prev = s.words[w];
  s.words[w] = { a: choice, at: day, ...(prev && prev.queued ? { queued: prev.queued } : {}) };
  bump(s, day);
  let check = false;
  if (choice === 'know') {
    s.knownN += 1;
    check = !!s.audit || s.knownN % CHECK_EVERY === 0;
  }
  return { state: s, check, fakeHit: false };
}

export function answerCheck(state, item, correct, now = new Date()) {
  const s = clone(readScreen(state));
  const w = String((item && item.w) || '').toLowerCase();
  if (!w) return s;
  const day = dayOf(now);
  const prev = s.words[w] || { a: 'know', at: day };
  s.words[w] = { ...prev, check: correct ? 'right' : 'wrong', checkAt: day };
  if (item.recheck) bump(s, day);
  s.updated = localIso(toDate(now));
  return s;
}

// Chinese characters that do not make two meanings close (小的 / 红色的, 盒子 / 杯子, 在……下面 / 在……之间)
const SHARED_OK = new Set(['的', '子', '一', '个', '在', '儿']);
const hanOf = zh => new Set([...String(zh)].filter(ch => /[\u4e00-\u9fff]/.test(ch) && !SHARED_OK.has(ch)));
export function checkOptions(w, { content: c = null } = {}) {
  const ct = ctOf(c);
  const x = ct && ct.screen.word(w);
  if (!x) return null;
  const mine = hanOf(x.zh);
  const apart = ct.screen.apart.get(x.w) || new Set();
  const ok = o => o.w !== x.w && o.zh !== x.zh && !apart.has(o.w) && ![...hanOf(o.zh)].some(ch => mine.has(ch));
  const pool = ct.screen.words.filter(ok);
  const same = shuffled(pool.filter(o => o.kind === x.kind), hash(x.w));
  const rest = shuffled(pool.filter(o => o.kind !== x.kind), hash(x.w + '/'));
  const picked = [];
  for (const o of [...same, ...rest]) {
    if (picked.length >= 3) break;
    // two wrong options should not be close to each other either (猫 / 小猫), so she can tell them apart
    if (picked.some(p => (ct.screen.apart.get(p.w) || new Set()).has(o.w) || [...hanOf(o.zh)].some(ch => hanOf(p.zh).has(ch)))) continue;
    picked.push(o);
  }
  const options = shuffled([x.zh, ...picked.map(o => o.zh)], hash('opts:' + x.w));
  return { options, answer: options.indexOf(x.zh) };
}

export function pendingWords(state, c = null) {
  const ct = ctOf(c);
  if (!ct) return [];
  const s = readScreen(state);
  const out = [];
  for (const x of ct.screen.words) {
    const it = s.words[x.w];
    if (!it || it.queued) continue;
    const why = it.check === 'wrong' ? 'wrong' : it.a === 'new' ? 'new' : it.a === 'unsure' ? 'unsure' : '';
    if (why) out.push({ w: x.w, slug: x.slug, zh: x.zh, display: x.display, why });
  }
  return out;
}
export function markQueued(state, slugs, now = new Date()) {
  const s = clone(readScreen(state));
  const want = new Set([...(slugs || [])].map(String));
  const day = dayOf(now);
  for (const [w, it] of Object.entries(s.words)) if (want.has(slugify(w)) || want.has(w)) it.queued = day;
  s.updated = localIso(toDate(now));
  return s;
}

const isKnown = (s, it) => it.a === 'know' && (it.check === 'right' || (!it.check && !s.audit));
const isUnknown = it => it.a !== 'know' || it.check === 'wrong';
export function knownPrimary(x, { content: c = null, assumed = true } = {}) {
  const ct = ctOf(c);
  if (!ct) return [];
  const s = readScreen(x);
  const out = assumed ? ct.screen.assumed.slice() : [];
  for (const w of ct.screen.words) { const it = s.words[w.w]; if (it && isKnown(s, it)) out.push(w.w); }
  return out;
}
export function unknownPrimary(x, { content: c = null } = {}) {
  const ct = ctOf(c);
  if (!ct) return [];
  const s = readScreen(x);
  return ct.screen.words.filter(w => s.words[w.w] && isUnknown(s.words[w.w])).map(w => w.w);
}
export function screenSummary(x, { content: c = null } = {}) {
  const ct = ctOf(c);
  const s = readScreen(x);
  const of = ct ? ct.screen.words.length : 0;
  const list = Object.entries(s.words).filter(([w]) => !ct || ct.screen.word(w));
  const count = f => list.filter(([, it]) => f(it)).length;
  const done = list.length;
  return {
    of, done, left: Math.max(0, of - done),
    known: count(it => isKnown(s, it)), unsure: count(it => it.a === 'unsure'), new: count(it => it.a === 'new'),
    wrong: count(it => it.check === 'wrong'), checked: count(it => !!it.check),
    fakes: Object.keys(s.fakes).length, fakeHits: Object.values(s.fakes).filter(f => f.a === 'know').length,
    audit: s.audit, finished: !!of && done >= of,
  };
}

export function placeholderExport(word, now = new Date()) {
  const t = toDate(now);
  const at = localIso(t);
  const w = String((word && word.w) || '').toLowerCase();
  const e = { slug: (word && word.slug) || slugify(w), headword: (word && word.display) || w, brief_cn: (word && word.zh) || '',
    cn_source: 'screen', needs_core: true, favorited: true, favorited_at: at, created: at, updated: at, note: '',
    history: [{ at, query: w, source: 'screen' }] };
  return { format: 'emma-export', version: 1, source: 'screen', exported_at: t.toISOString(), entries: [e], zh: [] };
}
