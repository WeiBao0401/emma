// 读一段（DESIGN 5.6 连载故事、5.5 读后题和提示阶梯）：期中番外一集怎么走、她读的时候能得到哪些帮助、记什么。
// Emma 最弱的是“阅读看不懂”。一集的走法按一个好老师陪读来定：
//   1. 本集“读的方法”小贴士（北京阅读题的方法：先看题、回原文找关键词……），加上前情提要和这集会遇到的词（读前见一面）
//   2. 先听后读：老师一句一句读，当前句高亮，她不用自己翻页；可以暂停、重听这句
//   3. 自己再读一遍（可选）
//   4. 4 道题：答错第 1 级提示自动出来，“再给个提示”到第 4 级，第 4 级后马上出变式题，变式做对才算过；用了提示记“模糊”。
//      做题时随时能“回原文看看”，第 2 级提示起把答案所在的那句标出来（回原文找依据，是这类题的命门）
//   5. 收尾：说出本集学的目标词
// 读的时候：点任意英文词出小卡片（中文和读音，只用离线词典和课本释义，不调模型），能“加进单词本”；
// 每句都有“看不懂”：第一下断句，第二下两个关键词的意思，第三下整句中文。
// 这个文件是纯逻辑（不碰 DOM、不读数据库），Node 里直接测。画界面在 ui-reader.js，样式 css/reader.css（类名 rd-）。
// 负责：阅读器 agent（reader.js、ui-reader.js、css/reader.css、tests/reader.test.mjs）。故事内容 curriculum/stories.json 由内容 agent 写。
//
// ---------------------------------------------------------------- stories.json 的格式（内容 agent 写的样子；读的时候很宽容，见 createContent）
// { version: 1, id, title, title_zh, about_zh,
//   names: [{ key: 'hero', default: 'Mia', zh: '主角……', replaceable: true }],   人物；replaceable 的名字她可以换（kv 'story:names'）
//   episodes: [Episode] }
// Episode = {
//   id: 'ep1', n: 1,                 一集的编号，定下就不改（事件和 kv 都用它）
//   title: 'Where Is My Red Scarf?', title_zh: '第 1 集 · 红领巾去哪了？'（“第 1 集 ·”画的时候去掉）
//   recap_zh: '前情提要', next_zh: '下一集预告'（也认 recap、teaser_zh）
//   tip: { title, lines: [说明], steps: [做法], preview: true, q: 'q1' }   本集读的方法；preview 读前先看题（默认就看）；
//        q 是用上这个方法的那道题（做到它时提醒一句）。也认字符串或数组；没写用 DEFAULT_TIPS 按集数轮
//   parts: [{ kind: 'chat' | 'story' | 'diary' | 'talk', label, label_zh }]   一集分几段，句子的 part 指第几段
//   names: [{ en, zh, key, replaceable }]   这集出场的人（点到名字时说“这是名字”）；也认字符串
//   targets: [{ w: 'strict', zh: '严格的', pos }]（也认 target_words、字符串数组）
//   glossary: [{ w, zh }] 或 { w: zh }   这集里词的意思（按故事里的意思写），点词时最先用它
//   sentences: [{ id: 1, part: 0, line: 1, speaker: 'Mia', role: 'hero', en, zh,
//                 chunks: 'My red scarf / is not in my schoolbag!'（或数组）, keys: [{ w, zh }] × 2, point? }]
//             line 一样的是同一条消息；也认 lines / text、{ speaker, sentences: [...] }
//   questions: [{ id: 'q1', type: 'detail' | 'infer' | 'cloze' | 'meaning' | 'main' | ..., skill: 'detail' | 'word' ..., skill_zh: '找细节',
//                 ask: 'What does Ms Wang do every Monday?', zh: '题目的中文', stem?: 'Ms Wang is ______, but she is kind.', stem_zh?,
//                 options: [...], options_zh: [...], answer: '选项原文'（也认 0 起的下标、字母、{ text, correct }、语法卡的 answer + wrong）,
//                 wrong?: { 选项: 误解标签 }, word?: 'strict'（考目标词的题）, evidence: [句子 id], drop: '第 3 级提示排除的那个选项',
//                 hints: [4 句], explain?, variant: { ask | stem, zh, stem_zh, options, options_zh, answer, evidence?, explain } }]
// }
// 名字：speaker 写人名；她起的名字按整词换进全部文字（英文、中文、题目、提示），Tom 不会换掉 Tomorrow。

// ---------------------------------------------------------------- 导出
//   FILE、KV_KEY = 'story:progress'、MODE = 'read'、STEP = 'read'、HINT_MAX = 4、HELP_MAX = 3、SHORT_QUESTIONS = 2
//   SKILLS、DEFAULT_TIPS、FUNCTION_ZH、HELP_LABELS
//   loadStories({ fetchJSON }) -> Promise<Content>；setContent(data)；content()；contentWith(names) -> 换上她起的名字的 Content
//   NAMES_KEY = 'story:names'；nameList(data?)；cleanNames(names, data?) -> 只留能换、英文字母、不和别人重名的
//   createContent(data, { names }) -> Content = { version, title, titleZh, about, names: [{ key, name, zh, replaceable }], picked,
//                                                episodes: [Ep], episode(idOrN) -> Ep | null, next(id) -> Ep | null }
//     Ep = { id, n, title, titleZh, recap, tip: { title, lines, steps, preview, q }, parts: [{ i, kind, label, labelZh }],
//            targets: [{ w, zh, unit, pos, slug }], glossary: { w: zh }, names: { 名字的词: 中文 }, sentences: [S], questions: [Q], teaser, words }
//     S  = { i（1 起）, id, no（屏幕上的句号）, speaker, speakerKey, part, line, en, zh, chunks, keys: [{ w, zh }], point, words }
//     Q  = { id, item: 'ep:<ep>:<q>', ep, skill, skillName, word, ask, zh, stem, stemZh, kind: 'choice' | 'tf',
//            options: [{ text, correct, tag, zh, drop? }], answer, hints, explain, evidence: [i], variant: Q | null, isVariant, of }
//   tokenize(en) -> [{ text, word? }]；wordCount(en)；splitSentences(text)
//   formsOf(word, { dict, curriculum }) -> [写法]；wordInfo(word, { episode, curriculum, words, dict }) -> WordInfo
//     WordInfo = { word, w, base, zh, phonetic, source: 'story' | 'textbook' | 'entry' | 'basic' | 'dict' | '', label, unit,
//                  slug, name, target, inBook, canAdd }
//   trimGloss(ecdictCn) -> 简短的两个义项
//   placeholderExport(info, now) -> emma-export（一个词条，favorited，needs_core），给“加进单词本”的词还没有词条时用
//   chunksOf(S)、autoChunks(en)、keysOf(S, env)、helpEvent(ep, S, level, { phase })
//   createAttempt(q, { now }) -> Attempt（和语法卡同一套提示阶梯，见下）
//   createReadAloud({ count, speak, stopSpeech, sleep, gap, onIndex, onState }) -> Player   一句一句读的节奏（ui 和测试都用）
//   speakMs(text) -> 估计读完一句要多少毫秒
//   sameWord(form, word)：notebooks / leaves 算 notebook / leave；targetHits(ep) -> { slug: 本集出现几次 }；hasTarget(ep, S)
//   emptyProgress()、normProgress(raw)、readProgress(kv)
//   startEpisode / noteListen / noteSelfRead / noteHelp / noteTap / noteAdded / noteAnswer / noteFlag / noteBoring / finishEpisode
//     (progress, ...) -> 新的 progress（纯函数，不改原来的）
//   nextEpisode(kvOrProgress, { content }) -> 该读的那一集的 id | null（都读完了）
//   episodeDone(kvOrProgress, id) -> bool
//   readCell(kvOrProgress, now, { content, light }) -> Cell   给 plan.js：今天该读哪一集、约几分钟
//     Cell = { id: 'read', label: '读一段', mode: 'story', status: 'ready' | 'done' | 'skip' | 'soon', episodeId, n, of, title, titleZh,
//              minutes, again（6 集读完了，挑她最吃力的一集再读）, short（轻松版：只做 2 道题）, resume, note, items: [] }
//   estimateMinutes(ep, { short, again })；wordsMet(kvOrProgress) -> { slug: 遇见次数 }；readingSummary(kvOrProgress, { content })
//   checkEpisode(ep) -> [问题]   内容自检（测试用）：每道题恰好一个正确选项、提示 4 级、有变式题、依据句找得到……
//
// ---------------------------------------------------------------- kv 'story:progress'（新键）
//   { v: 1, current: 正在读的那集 | null,
//     episodes: { [epId]: { started, done: 'YYYY-MM-DD' | null, again: [日子], met: 日子, listens, selfReads, readMs, helps: { 句号: 第几下 },
//                           taps, answers: { qid: { grade, passed, clean, hint, at } }, flagged: [qid], stats: { right, fuzzy, failed, flagged },
//                           boring, last } },
//     words: { slug: { n: 遇见次数, first: 第一次见的那集, last: 日子, eps: [集] } },
//     looked: { 原形: { n, last, ep } },      她在故事里点开看过的词
//     added: [slug],                          她从故事里加进单词本的词
//     updated }
// kv 'story:names'（新键）：{ hero?: 'Emma', cat?: 'Kitty', at }   第 1 集读前问一次；“就用这两个”也存（只有 at），以后不再问
//
// ---------------------------------------------------------------- 事件（CONTRACTS 第 6 节的字段）
//   answer    { item: 'ep:<ep>:<q>'（变式题加 v）, mode: 'read', step, sid, episode, skill, slug?（考词的题）, unit?, choice, correct,
//               first_try, ms, hint_level, misconception, done?, passed?, grade?, fuzzy?, fixed_after?, variant?, of? }
//   hint      { item, mode: 'read', step, sid, episode, level, hint_level, auto }
//   read_help { item: 'ep:<ep>:s<句号>', mode: 'read', step, sid, episode, sentence, level（1 断句 2 关键词 3 整句中文）, phase,
//               words（这句几个词）, speaker（是不是对话）, question（是不是问句）, point, has_target, kind: 'sentence' }
//               题目的“看中文”也记 read_help：{ item: 'ep:<ep>:<q>', kind: 'question_zh', level: 1 }
//   read_time { item: 'ep:<ep>', mode: 'read', step, sid, episode, phase: 'listen' | 'self', ms, words, sentences, completed,
//               pauses, replays, helps, taps }
//   lookup    { query, source, from: 'story', item: 'ep:<ep>:s<句号>', slug?, phase }   点开一个词（已有的事件类型）
//   flag      { item, mode: 'read' }   “这题有问题”：跳过、不记分
//   feel      { item: 'ep:<ep>', choice: 'boring' }   “这集不好看”
// slugify and localIso are the same as words.js (tests/reader.test.mjs checks): copied so the reader opens even while
// the lookup modules change; a word's slug must match the word book's.
export function slugify(word) {
  let s = String(word ?? '').trim().toLowerCase();
  s = s.replace(/[^\p{L}\p{N}_\s'-]/gu, '');
  s = s.replace(/[\s']+/g, '-').replace(/^-+|-+$/g, '');
  return Array.from(s).slice(0, 80).join('') || 'word';
}
const localIso = d => `${dayOf(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

export const FILE = 'curriculum/stories.json';
export const KV_KEY = 'story:progress';
export const MODE = 'read';
export const STEP = 'read';
export const HINT_MAX = 4;
export const HELP_MAX = 3;
export const SHORT_QUESTIONS = 2;

export const SKILLS = {
  detail: '找细节', infer: '想一想', main: '这集讲什么', word: '词的意思', meaning: '看前后句猜词义', cloze: '用目标词填空', ref: '指的是谁',
  order: '先后顺序', who: '谁说的', tf: '对还是错',
};
export const HELP_LABELS = ['看不懂', '还不懂', '还不懂'];

// 每集“读的方法”没写时按集数轮一条。都是北京初一阅读题的基本功，一次只讲一个。
export const DEFAULT_TIPS = [
  { title: '先看题，再读', lines: ['先把题目看一遍，知道要找什么。', '读的时候，看到和题目有关的地方，多看一眼。'], preview: true },
  { title: '不认识的词，先别停', lines: ['一句里有一个词不认识，先往下读。', '看看前后句，常常能猜出它的意思。猜不出再点它。'] },
  { title: '回原文找关键词', lines: ['题目里的名字、时间、地方，就是关键词。', '回到故事里，找到有这个词的那一句，答案就在旁边。'] },
  { title: '看清是谁说的', lines: ['对话要先看名字。', '名字后面的那句话，才是这个人说的。'] },
  { title: '选之前，找到那一句', lines: ['答案在故事里，不靠猜。', '选之前，先在故事里找到能证明它的那一句。'] },
  { title: '意思一样就对', lines: ['选项的说法常常和故事里不一样。', '比如故事说 at ten, 选项说 at 10 o’clock。意思一样，就是对的。'] },
];

// 小学最常见的功能词：离线词典的第一个义项常常不对（a 是“第一个字母 A”），这里用她课本里的意思。
export const FUNCTION_ZH = {
  a: '一（个）', an: '一（个）', the: '这；那（特指某一个）', is: '是', am: '是', are: '是', was: '是（过去）', were: '是（过去）', be: '是',
  do: '做；（问句、否定句里帮忙的词）', does: '做；（问句、否定句里帮忙的词，跟 he、she、it）', did: '做（过去）', "don't": '不（= do not）',
  "doesn't": '不（= does not）', "isn't": '不是（= is not）', "aren't": '不是（= are not）', "can't": '不能（= cannot）', can: '能；会',
  will: '将要', i: '我', you: '你；你们', he: '他', she: '她', it: '它', we: '我们', they: '他们；她们；它们', me: '我（放在动词后面）',
  him: '他（放在动词后面）', her: '她；她的', us: '我们（放在动词后面）', them: '他们（放在动词后面）', my: '我的', your: '你的；你们的',
  his: '他的', its: '它的', our: '我们的', their: '他们的', mine: '我的（后面不跟名词）', yours: '你的（后面不跟名词）', hers: '她的（后面不跟名词）',
  this: '这；这个', that: '那；那个', these: '这些', those: '那些', there: '那里；（there is 有）', here: '这里', what: '什么', who: '谁',
  where: '在哪里', when: '什么时候', why: '为什么', how: '怎么；怎么样', which: '哪一个', whose: '谁的', and: '和；而且', but: '但是', or: '或者',
  so: '所以；这么', because: '因为', if: '如果', of: '……的', in: '在……里', on: '在……上', at: '在（某个地点、时间）', to: '到；向',
  for: '为了；给', with: '和……一起；带着', from: '从；来自', up: '向上', down: '向下', not: '不', no: '不；没有', yes: '是的',
  very: '很；非常', too: '也；太', all: '全部；都', some: '一些', any: '任何；一些（问句里）', one: '一；一个', "it's": '它是（= it is）',
  "what's": '是什么（= what is）', "let's": '让我们（= let us）', "i'm": '我是（= I am）', "you're": '你是（= you are）', "they're": '他们是（= they are）',
  "we're": '我们是（= we are）', "he's": '他是（= he is）', "she's": '她是（= she is）', "that's": '那是（= that is）', "there's": '有（= there is）',
  "o'clock": '……点钟', ms: '女士（放在姓前面，Ms Wang 王老师）', mr: '先生（放在姓前面）', mrs: '太太（放在姓前面）', oh: '哦', ok: '好的', okay: '好的', hi: '你好', hello: '你好', please: '请', thanks: '谢谢', sorry: '对不起',
};

// ---------------------------------------------------------------- small helpers

const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : typeof x === 'function' ? toDate(x()) : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function isoLocal(x = new Date()) {
  const d = toDate(x);
  const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const addDays = (day, n) => { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const str = x => (x == null ? '' : String(x)).trim();
const arr = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
export const normW = w => str(w).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const CJK = /[㐀-鿿]/;
const unitName = id => { const s = String(id || ''); if (/^s/i.test(s)) return 'Starter'; const m = s.match(/(\d+)/); return m ? `Unit ${m[1]}` : s; };
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }
const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };

// ---------------------------------------------------------------- text

const TOKEN_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*|\d+(?::\d+)?/g;
// "Mia's cat is in the lab." -> [{ text: "Mia's", word: "mia's" }, { text: ' ' }, ...]; numbers are not tappable
export function tokenize(text) {
  const s = String(text ?? '');
  const out = [];
  let at = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(/[A-Za-z]/.test(m[0]) ? { text: m[0], word: normW(m[0]) } : { text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}
export const wordCount = text => tokenize(text).filter(t => t.word || /^\d/.test(t.text)).length;

const ABBR = /\b(Mr|Mrs|Ms|Dr|St|Miss)\.$/;
export function splitSentences(text) {
  const parts = String(text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=["“A-Z0-9])/);
  const out = [];
  for (const p of parts) { if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ' ' + p; else if (p) out.push(p); }
  return out;
}

// ---------------------------------------------------------------- content

// The raw file stays in memory so the names she picked (kv 'story:names') can be swapped in without fetching again.
let raw = null;
let cached = null;
const withNames = new Map();   // JSON of the names -> Content
export function setContent(data) { raw = data || null; withNames.clear(); cached = data ? createContent(data) : null; return cached; }
export function content() { return cached; }
// content with the names she picked: { hero: 'Lily', cat: 'Kitty' } (only replaceable names, English letters)
export function contentWith(names) {
  if (!raw) return cached;
  const picked = cleanNames(names, raw);
  if (!Object.keys(picked).length) return cached;
  const key = JSON.stringify(picked);
  if (!withNames.has(key)) withNames.set(key, createContent(raw, { names: picked }));
  return withNames.get(key);
}
export async function loadStories({ fetchJSON } = {}) {
  const get = fetchJSON || (async p => { const r = await fetch(p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
  return setContent(await get(FILE));
}

// ---- names: top-level { key, default, zh, replaceable }; speakers are keys ('hero'); she may rename the replaceable ones
export const NAMES_KEY = 'story:names';
const NAME_RE = /^[A-Za-z][A-Za-z' -]{0,13}$/;
// words that are also plain words she should read as words (妈妈, 奶奶), and titles before a surname
const COMMON_NAME_WORDS = new Set(['mum', 'mom', 'dad', 'grandma', 'grandpa', 'ms', 'mr', 'mrs', 'miss', 'sir', 'aunt', 'uncle']);
function topNames(data) {
  return arr(data && !Array.isArray(data) ? data.names : null)
    .filter(n => n && typeof n === 'object' && str(n.key) && str(n.default ?? n.name ?? n.en))
    .map(n => ({ key: str(n.key), name: str(n.default ?? n.name ?? n.en), zh: str(n.zh ?? n.cn), replaceable: !!n.replaceable }));
}
export function nameList(data = raw) { return topNames(data); }
// keeps only real changes: a replaceable name, English letters, not the same as any other character's name
export function cleanNames(names, data = raw) {
  const out = {};
  const list = topNames(data);
  const taken = new Set(list.map(n => n.name.toLowerCase()));
  for (const [key, v] of Object.entries(obj(names))) {
    const n = list.find(x => x.key === key && x.replaceable);
    const val = str(v).replace(/\s+/g, ' ');
    if (!n || !NAME_RE.test(val) || val.toLowerCase() === n.name.toLowerCase()) continue;
    if (taken.has(val.toLowerCase()) || Object.values(out).some(x => x.toLowerCase() === val.toLowerCase())) continue;
    out[key] = val.charAt(0).toUpperCase() + val.slice(1);
  }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a whole-word swap through every string of the file (Tom is not in Tomorrow); Chinese text carries the English names too
function swapNames(data, picked) {
  const list = topNames(data).filter(n => picked[n.key]);
  if (!list.length) return data;
  const res = list.map(n => [new RegExp(`(?<![A-Za-z])${esc(n.name)}(?![A-Za-z])`, 'g'), picked[n.key]]);
  const walk = x => {
    if (typeof x === 'string') return res.reduce((s, [re, to]) => s.replace(re, to), x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = k === 'names' || k === 'key' || k === 'role' || k === 'id' ? v : walk(v); return o; }
    return x;
  };
  return walk(data);
}

function normKeys(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw) && typeof raw === 'object') return Object.entries(raw).map(([w, zh]) => ({ w: str(w), zh: str(zh) })).filter(k => k.w);
  return arr(raw).map(k => {
    if (typeof k === 'string') {
      const m = k.match(/^([^㐀-鿿]+?)\s*[=:：]?\s*([㐀-鿿（(].*)$/);
      return m ? { w: m[1].trim(), zh: m[2].trim() } : { w: k.trim(), zh: '' };
    }
    if (k && typeof k === 'object') return { w: str(k.w ?? k.word ?? k.en), zh: str(k.zh ?? k.cn ?? k.meaning) };
    return null;
  }).filter(k => k && k.w);
}

function normSentence(s, i, speakers) {
  const en = str(s.en ?? s.text ?? s.english ?? s.sentence);
  let chunks = s.chunks ?? s.split ?? s.breaks ?? s.parse ?? null;
  if (typeof chunks === 'string') chunks = chunks.split(/\s*[/|｜]\s*/);
  const sp = str(s.speaker ?? s.who);
  const id = str(s.id) || 's' + (i + 1);
  return {
    i: i + 1, id, no: /^\d+$/.test(id) ? Number(id) : i + 1,
    speakerKey: sp, speaker: (speakers[sp] && speakers[sp].name) || sp,
    part: s.part == null || s.part === '' ? null : num(s.part), line: s.line == null || s.line === '' ? null : num(s.line),
    en, zh: str(s.zh ?? s.cn ?? s.chinese ?? s.translation),
    chunks: arr(chunks).map(str).filter(Boolean),
    keys: normKeys(s.keys ?? s.key_words ?? s.keywords ?? s.key ?? null),
    point: str(s.point ?? s.grammar), words: wordCount(en),
  };
}

function sentenceList(raw, speakers = {}) {
  const src = raw.sentences ?? raw.lines ?? raw.text ?? raw.body ?? raw.story ?? [];
  const list = typeof src === 'string' ? splitSentences(src) : arr(src);
  const flat = [];
  for (const item of list) {
    if (typeof item === 'string') { for (const en of splitSentences(item)) flat.push({ en }); continue; }
    if (!item || typeof item !== 'object') continue;
    const speaker = str(item.speaker ?? item.who ?? item.name);
    const inner = item.sentences ?? item.parts;
    if (Array.isArray(inner)) {
      for (const s of inner) {
        if (typeof s === 'string') flat.push({ en: s, speaker });
        else if (s && typeof s === 'object') flat.push({ ...s, speaker: str(s.speaker ?? s.who) || speaker });
      }
      continue;
    }
    // a chat message with several sentences in one string and no per-sentence help: split it, keep the speaker
    const en = str(item.en ?? item.text ?? item.english ?? item.sentence);
    const parts = splitSentences(en);
    if (parts.length > 1 && !item.zh && !item.chunks && !item.keys) { for (const p of parts) flat.push({ ...item, en: p, speaker, id: undefined }); continue; }
    flat.push({ ...item, speaker });
  }
  return flat.map((s, i) => normSentence(s, i, speakers)).filter(s => s.en);
}

function normGlossary(raw) {
  const out = {};
  const src = raw.glossary ?? raw.gloss ?? raw.notes ?? null;
  if (Array.isArray(src)) for (const g of src) { const k = normKeys([g])[0]; if (k && k.zh) out[normW(k.w)] = k.zh; }
  else for (const [w, zh] of Object.entries(obj(src))) if (str(zh)) out[normW(w)] = str(zh);
  return out;
}
// the words of a name she may tap: "Mia", "Ms Wang" and "Wang", "Grandma Li" and "Li" (Grandma and Ms stay plain words)
function nameWords(out, name, zh) {
  const full = normW(name);
  if (!full) return;
  if (!(full in out) && !COMMON_NAME_WORDS.has(full)) out[full] = zh;
  for (const part of full.split(' ')) if (part && part !== full && !COMMON_NAME_WORDS.has(part) && !(part in out)) out[part] = zh;
}
function normNames(raw, top = []) {
  const out = {};
  for (const n of top) nameWords(out, n.name, n.zh);
  for (const n of arr(raw.names ?? raw.characters ?? raw.cast)) {
    if (typeof n === 'string') { nameWords(out, n, ''); continue; }
    if (n && typeof n === 'object') { const w = str(n.en ?? n.name ?? n.w ?? n.default); if (w) nameWords(out, w, str(n.zh ?? n.cn)); }
  }
  return out;
}
function normTargets(raw, glossary) {
  const src = raw.targets ?? raw.target_words ?? raw.targetWords ?? (Array.isArray(raw.words) ? raw.words : null) ?? [];
  const list = Array.isArray(src) ? src : src && typeof src === 'object' ? Object.entries(src).map(([w, zh]) => ({ w, zh })) : [];
  return list
    .map(t => (typeof t === 'string' ? { w: t.trim() } : t && typeof t === 'object' ? { w: str(t.w ?? t.word ?? t.en), zh: str(t.zh ?? t.cn ?? t.meaning), unit: str(t.unit), pos: str(t.pos) } : null))
    .filter(t => t && t.w)
    .map(t => ({ w: t.w, zh: t.zh || glossary[normW(t.w)] || '', unit: t.unit || '', pos: t.pos || '', slug: slugify(t.w) }));
}
function normTip(raw, n) {
  const t = raw.tip ?? raw.method ?? raw.how ?? raw.reading_tip ?? null;
  let tip = null;
  if (typeof t === 'string') tip = { title: '', lines: [t.trim()].filter(Boolean) };
  else if (Array.isArray(t)) tip = { title: '', lines: t.map(str).filter(Boolean) };
  else if (t && typeof t === 'object') {
    const lines = arr(t.lines ?? t.text ?? t.body ?? t.zh ?? t.lead).map(str).filter(Boolean);
    const steps = arr(t.steps).map(str).filter(Boolean);
    tip = { id: str(t.id), title: str(t.title ?? t.name), lines: lines.length ? lines : steps, steps: lines.length ? steps : [],
      q: str(t.q ?? t.question), ...(t.preview != null || t.questions_first != null ? { preview: !!(t.preview ?? t.questions_first) } : {}) };
  }
  if (!tip || (!tip.title && !tip.lines.length)) tip = { ...clone(DEFAULT_TIPS[(Math.max(1, n) - 1) % DEFAULT_TIPS.length]), fallback: true };
  tip.steps = tip.steps || [];
  // 先看题 is the habit every time: the questions are shown before reading unless the episode says not to
  tip.preview = tip.preview !== false;
  tip.q = tip.q || '';
  return tip;
}
function normParts(raw) {
  return arr(raw.parts ?? raw.sections).map((p, i) => (p && typeof p === 'object'
    ? { i, kind: str(p.kind ?? p.type), label: str(p.label ?? p.title ?? p.en), labelZh: str(p.label_zh ?? p.zh ?? p.title_zh) }
    : { i, kind: '', label: str(p), labelZh: '' }));
}

const LETTER_RE = /^\s*([A-Fa-f])\s*[.、．)）:：]\s*/;
const sameText = (a, b) => normW(String(a).replace(LETTER_RE, '')).replace(/[.。!！?？\s]+$/, '') === normW(String(b).replace(LETTER_RE, '')).replace(/[.。!！?？\s]+$/, '');

function normOptions(raw) {
  const kind = /^(tf|judge|truefalse|true_false|true-false)$/i.test(str(raw.kind ?? raw.type ?? raw.format)) ? 'tf' : 'choice';
  const answerRaw = raw.answer ?? raw.correct ?? raw.key;
  const wrong = raw.wrong && typeof raw.wrong === 'object' && !Array.isArray(raw.wrong) ? raw.wrong : null;
  const src = raw.options ?? raw.choices ?? null;
  const zhs = arr(raw.options_zh ?? raw.choices_zh);
  let opts = [];
  if (Array.isArray(src)) {
    opts = src.map((o, i) => {
      if (typeof o === 'string' || typeof o === 'number') return { text: String(o).replace(LETTER_RE, '').trim(), correct: false, tag: null, zh: str(zhs[i]) };
      if (o && typeof o === 'object') return { text: str(o.text ?? o.en ?? o.label ?? o.option).replace(LETTER_RE, ''), correct: !!(o.correct ?? o.right ?? o.answer === true), tag: str(o.tag ?? o.misconception) || null, zh: str(o.zh ?? zhs[i]) };
      return null;
    }).filter(o => o && o.text);
    if (!opts.some(o => o.correct) && answerRaw != null) {
      // the option's own text first, then a 0-based index, then a letter
      let k = typeof answerRaw === 'string' ? opts.findIndex(o => sameText(o.text, answerRaw)) : -1;
      if (k < 0 && typeof answerRaw === 'number') k = answerRaw;
      if (k < 0 && /^[A-Fa-f]$/.test(str(answerRaw))) k = 'ABCDEF'.indexOf(str(answerRaw).toUpperCase());
      if (k >= 0 && k < opts.length) opts[k].correct = true;
    }
    if (wrong) for (const o of opts) if (!o.correct && !o.tag) { const hit = Object.keys(wrong).find(w => sameText(w, o.text)); if (hit) o.tag = str(wrong[hit]) || null; }
  } else if (kind === 'tf') {
    const yes = answerRaw === true || /^(t|true|对|yes|y|正确|√)$/i.test(str(answerRaw));
    opts = [{ text: '对', correct: yes, tag: null, zh: '' }, { text: '错', correct: !yes, tag: null, zh: '' }];
  } else if (answerRaw != null && wrong) {
    opts = [{ text: str(answerRaw), correct: true, tag: null, zh: '' }, ...Object.entries(wrong).map(([t, tag]) => ({ text: str(t), correct: false, tag: str(tag) || null, zh: '' }))];
  }
  if (kind === 'tf' && opts.length === 2 && /^(t|true)$/i.test(opts[0].text)) { opts[0].text = '对'; opts[1].text = '错'; }
  // 排除法: the option hint 3 rules out
  const drop = str(raw.drop ?? raw.exclude);
  if (drop) for (const o of opts) if (!o.correct && sameText(o.text, drop)) o.drop = true;
  return { kind, opts, shuffle: kind !== 'tf' && raw.shuffle !== false };
}

function evidenceOf(raw, sentences) {
  const out = [];
  for (const e of arr(raw.evidence ?? raw.ref ?? raw.refs ?? raw.source_sentence ?? raw.from ?? raw.lines)) {
    let i = 0;
    const s = str(e);
    const byId = sentences.find(x => x.id === s);
    if (byId) i = byId.i;
    else if (typeof e === 'number' || /^s?\d+$/i.test(s)) i = Number(s.replace(/^s/i, ''));
    else if (s) { const hit = sentences.find(x => normW(x.en).includes(normW(s))); if (hit) i = hit.i; }
    if (i >= 1 && i <= sentences.length && !out.includes(i)) out.push(i);
  }
  return out;
}

function normQuestion(raw, ep, idx, sentences, parent = null) {
  if (!raw || typeof raw !== 'object') return null;
  const id = parent ? parent.id + 'v' : str(raw.id) || 'q' + (idx + 1);
  const { kind, opts, shuffle } = normOptions(raw);
  // skill: an id ('detail') in type or skill; a Chinese name in skill is kept for the screen
  const cands = [raw.skill, raw.type, raw.focus, raw.ability, raw.skill_zh, raw.skillName].map(str);
  let skill = cands.find(x => SKILLS[x]) || '';
  if (!skill) skill = kind === 'tf' ? 'tf' : parent ? parent.skill : '';
  const zhName = cands.find(x => CJK.test(x)) || '';
  const hints = arr(raw.hints ?? raw.ladder ?? raw.hint).map(str).filter(Boolean).slice(0, HINT_MAX);
  const answer = (opts.find(o => o.correct) || {}).text || '';
  let ask = str(raw.ask ?? raw.question ?? raw.prompt);
  let stem = str(raw.stem ?? raw.sentence).replace(/_{2,}/g, '____');
  // a stem with no blank is the question itself
  if (!ask && stem && !stem.includes('____')) { ask = stem; stem = ''; }
  const q = {
    id, item: `ep:${ep}:${id}`, ep, kind, skill, skillName: zhName || SKILLS[skill] || (parent ? parent.skillName : ''),
    word: str(raw.word ?? raw.target) || (parent ? parent.word : ''),
    ask, zh: str(raw.zh ?? raw.ask_zh ?? raw.question_zh ?? raw.cn ?? (ask === str(raw.stem) ? raw.stem_zh : '')), stem,
    stemZh: stem ? str(raw.stem_zh ?? raw.sentence_zh) : '',
    options: opts, answer, hints,
    explain: str(raw.explain ?? raw.why ?? raw.reason) || hints[HINT_MAX - 1] || '',
    evidence: evidenceOf(raw, sentences),
    variant: null, isVariant: !!parent, of: parent ? parent.item : null,
  };
  if (!q.ask && !q.stem) q.ask = kind === 'tf' ? '这句话对不对？' : '选一个。';
  if (parent && !q.evidence.length) q.evidence = parent.evidence.slice();
  if (shuffle && opts.length > 2) {
    let seed = hash(q.item) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  }
  if (!parent) {
    const v = raw.variant ?? raw.twin ?? raw.again ?? null;
    q.variant = v ? normQuestion(v, ep, idx, sentences, q) : null;
  }
  return q;
}

function epIdOf(raw, i) {
  const v = str(raw.id ?? raw.episode ?? raw.ep);
  if (v) return /^\d+$/.test(v) ? 'ep' + v : v;
  return 'ep' + (num(raw.n) || i + 1);
}

function normEpisode(raw, i, top) {
  const id = epIdOf(raw, i);
  const n = num(raw.n ?? raw.number ?? raw.no) || (/^ep?(\d+)$/i.test(id) ? Number(id.replace(/\D/g, '')) : i + 1);
  const speakers = Object.fromEntries(top.map(x => [x.key, x]));
  const sentences = sentenceList(raw, speakers);
  const glossary = normGlossary(raw);
  const names = normNames(raw, top);
  const questions = arr(raw.questions ?? raw.quiz).map((q, k) => normQuestion(q, id, k, sentences)).filter(Boolean);
  return {
    id, n, title: str(raw.title ?? raw.title_en),
    titleZh: str(raw.title_zh ?? raw.titleZh ?? raw.zh_title).replace(/^第\s*\d+\s*集\s*[·・:：]?\s*/, ''),
    recap: str(raw.recap_zh ?? raw.recap ?? raw.previously ?? raw.intro_zh), tip: normTip(raw, n), parts: normParts(raw),
    targets: normTargets(raw, glossary), glossary, names, sentences, questions,
    teaser: str(raw.teaser_zh ?? raw.teaser ?? raw.next_zh ?? raw.cliffhanger).replace(/^(下一集|第\s*\d+\s*集)\s*[·・:：]\s*/, ''),
    words: sentences.reduce((a, s) => a + s.words, 0),
  };
}

export function createContent(data, { names = null } = {}) {
  const picked = names ? cleanNames(names, data) : {};
  const src = Object.keys(picked).length ? swapNames(data, picked) : data;
  const top = topNames(src).map(n => ({ ...n, name: picked[n.key] || n.name }));
  const list = Array.isArray(src) ? src : arr(src && (src.episodes ?? src.stories));
  const episodes = list.filter(x => x && typeof x === 'object').map((e, i) => normEpisode(e, i, top)).filter(e => e.sentences.length);
  episodes.sort((a, b) => a.n - b.n);
  const byId = new Map(episodes.map(e => [e.id, e]));
  const find = x => {
    if (x == null || x === '') return null;
    if (typeof x === 'object' && x.id) return byId.get(x.id) || null;
    const s = String(x);
    if (byId.has(s)) return byId.get(s);
    if (/^\d+$/.test(s)) return episodes.find(e => e.n === Number(s)) || byId.get('ep' + s) || null;
    const m = s.match(/^ep?(\d+)$/i);
    return m ? episodes.find(e => e.n === Number(m[1])) || null : null;
  };
  return {
    version: (src && src.version) || 1,
    title: str(src && src.title), titleZh: str(src && src.title_zh), about: str(src && src.about_zh),
    names: top, picked,
    episodes,
    episode: find,
    next: id => { const e = find(id); const k = e ? episodes.indexOf(e) : -1; return k >= 0 ? episodes[k + 1] || null : null; },
  };
}

// ---------------------------------------------------------------- one word: what the little card shows (no model call)

// The written form first, then the ones we are sure of (Mia's -> mia, the dictionary's and the word lists' base form),
// then, only while the dictionary has not loaded, regular endings guessed (cats -> cat). `sure` is how many are sure.
function forms(word, { dict = null, curriculum = null } = {}) {
  const w = normW(word);
  const out = w ? [w] : [];
  const add = x => { const k = normW(x); if (k && !out.includes(k)) out.push(k); };
  if (/'s$/.test(w)) add(w.slice(0, -2));
  if (/s'$/.test(w)) add(w.slice(0, -1));
  add(safe(() => (dict && dict.lemma ? dict.lemma(w) : null)));
  add(safe(() => (curriculum && curriculum.baseOf ? curriculum.baseOf(w) : null)));
  const sure = out.length;
  if (!(dict && safe(() => dict.loaded && dict.loaded(), false)) && w.length > 3) {
    for (const [re, rep] of [[/ies$/, 'y'], [/s$/, ''], [/es$/, ''], [/ied$/, 'y'], [/([b-df-hj-np-tv-z])\1(ed|ing)$/, '$1'], [/ed$/, 'e'], [/ed$/, ''], [/ing$/, 'e'], [/ing$/, '']]) {
      if (re.test(w)) add(w.replace(re, rep));
    }
  }
  return { list: out, sure };
}
export const formsOf = (word, env = {}) => forms(word, env).list;

// "notebooks" and "leaves" count for notebook and leave
const stemOf = x => x.replace(/'s$/, '').replace(/ies$/, 'y').replace(/(es|s|ed|ing)$/, '');
export function sameWord(x, w) {
  if (!x || !w) return false;
  if (x === w || stemOf(x) === w) return true;
  return w.length >= 4 && /e$/.test(w) && stemOf(x) === w.slice(0, -1);
}

// ECDICT "a. 神经紧张的, 不安的, 神经的" -> "神经紧张的，不安的"
export function trimGloss(cn) {
  const s = String(cn ?? '').replace(/\\[rnt]/g, '；').replace(/\[[^\]]*\]/g, '');
  const seg = s.split(/[；;]/).map(x => x.trim()).filter(Boolean)[0] || '';
  const body = seg.replace(/^(?:[a-z]+\.\s*)+/i, '').trim();
  return body.split(/[,，、]/).map(x => x.trim()).filter(Boolean).slice(0, 2).join('，');
}

function entryOf(f, words) {
  if (!words || typeof words.get !== 'function') return null;
  return safe(() => words.get(slugify(f)), null);
}
function textbookCn(f, curriculum, words) {
  const u = safe(() => (curriculum && curriculum.unitOf ? curriculum.unitOf(f) : null), null);
  if (u) {
    const list = safe(() => curriculum.unitWords(u), []) || [];
    const x = list.find(it => it && normW(it.w) === f);
    if (x && str(x.cn)) return { unit: u, cn: str(x.cn) };
  }
  const e = entryOf(f, words);
  if (e && /^(textbook|photo)/.test(String(e.source || '')) && str(e.brief_cn)) return { unit: e.unit || u, cn: str(e.brief_cn) };
  return null;
}

export function wordInfo(raw, { episode = null, curriculum = null, words = null, dict = null } = {}) {
  const word = str(raw);
  const w = normW(raw);
  const info = { word, w, base: w, zh: '', phonetic: '', source: '', label: '', unit: null, slug: slugify(w), name: false, target: false, inBook: false, canAdd: false };
  if (!w) return info;
  const ep = episode || {};
  const { list: fs, sure } = forms(w, { dict, curriculum });
  const names = ep.names || {};
  const nameHit = fs.slice(0, sure).find(f => f in names);
  if (nameHit) return { ...info, base: nameHit, name: true, zh: names[nameHit] || '', source: 'story', label: '名字' };
  let hit = null;
  for (const [k, f] of fs.entries()) {
    const t = (ep.targets || []).find(x => normW(x.w) === f);
    const g = (ep.glossary || {})[f];
    if ((t && t.zh) || g) { hit = { base: f, zh: (t && t.zh) || g, source: 'story', target: !!t }; break; }
    const tb = textbookCn(f, curriculum, words);
    if (tb) { hit = { base: f, zh: tb.cn, source: 'textbook', unit: tb.unit }; break; }
    const e = entryOf(f, words);
    if (e && str(e.brief_cn)) { hit = { base: f, zh: str(e.brief_cn), source: 'entry' }; break; }
    if (FUNCTION_ZH[f] && k < sure) { hit = { base: f, zh: FUNCTION_ZH[f], source: 'basic' }; break; }
    const d = safe(() => (dict && dict.get ? dict.get(f) : null), null);
    if (d && trimGloss(d.cn)) { hit = { base: f, zh: trimGloss(d.cn), source: 'dict', phonetic: d.phonetic || '' }; break; }
  }
  const out = { ...info, ...(hit || {}) };
  if (!out.target) out.target = (ep.targets || []).some(x => fs.slice(0, sure).includes(normW(x.w)) || sameWord(w, normW(x.w)));
  const entry = entryOf(out.base, words) || entryOf(w, words);
  if (!out.phonetic) out.phonetic = str(entry && entry.phonetic) || str(safe(() => (dict && dict.get ? (dict.get(out.base) || dict.get(w) || {}).phonetic : ''), ''));
  if (out.unit == null) out.unit = safe(() => (curriculum && curriculum.unitOf ? curriculum.unitOf(out.base) : null), null) || (entry && entry.unit) || null;
  const level = out.unit ? `课本 ${unitName(out.unit)}`
    : safe(() => curriculum && curriculum.isPrimary && curriculum.isPrimary(out.base), false) ? '小学词'
      : safe(() => curriculum && curriculum.levelOf && curriculum.levelOf(out.base) === 3, false) ? '初中词' : '';
  out.label = [out.target ? '这集的词' : '', level].filter(Boolean).join(' · ');
  out.slug = entry ? entry.slug : slugify(out.base);
  out.inBook = !!(entry && entry.favorited);
  out.canAdd = !!out.zh && !out.name && out.source !== 'basic';
  return out;
}

// “加进单词本”的词还没有词条：做一个占位词条（和课本导入一样走 words.importData），讲解第一次打开时补（needs_core）
export function placeholderExport(info, now = new Date()) {
  const at = localIso(toDate(now));
  const cnSource = info.source === 'dict' ? 'ecdict' : info.source === 'textbook' ? 'book-list' : 'story';
  const e = { slug: info.slug, headword: info.base, brief_cn: info.zh || '', cn_source: cnSource, needs_core: true,
    favorited: true, favorited_at: at, created: at, updated: at, note: '', history: [{ at, query: info.w, source: 'story' }] };
  if (info.phonetic) e.phonetic = info.phonetic;
  return { format: 'emma-export', version: 1, source: 'story', exported_at: toDate(now).toISOString(), entries: [e], zh: [] };
}

// ---------------------------------------------------------------- 这句看不懂：断句、关键词

const BREAK_BEFORE = new Set(['and', 'but', 'so', 'because', 'when', 'if', 'or', 'then', 'after', 'before', 'with', 'in', 'on', 'at', 'to',
  'for', 'from', 'of', 'under', 'near', 'behind', 'into', 'about', 'until', 'than', 'like', 'every', 'without', 'across', 'along', 'through']);
const BE = new Set(['am', 'is', 'are', 'was', 'were', "it's", "i'm", "he's", "she's", "that's", "what's"]);
export function autoChunks(en) {
  const toks = String(en ?? '').trim().split(/\s+/).filter(Boolean);
  if (toks.length <= 4) return [toks.join(' ')].filter(Boolean);
  const out = [];
  let cur = [];
  toks.forEach((t, i) => {
    const w = t.toLowerCase().replace(/[^a-z']/g, '');
    const prev = i ? toks[i - 1].toLowerCase().replace(/[^a-z']/g, '') : '';
    const left = toks.length - i;
    // "The light is on" and "is in the lab" stay together: never cut right after am / is / are
    if (cur.length >= 2 && left >= 2 && BREAK_BEFORE.has(w) && !BE.has(prev)) { out.push(cur.join(' ')); cur = []; }
    cur.push(t);
    if (/[,;:]$/.test(t) && cur.length >= 2 && left > 2) { out.push(cur.join(' ')); cur = []; }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}
export function chunksOf(s) {
  const c = (s && s.chunks) || [];
  const letters = x => normW(x).replace(/[^a-z0-9]/g, '');
  if (c.length >= 2 && letters(c.join(' ')) === letters(s.en)) return c.slice();
  return autoChunks(s && s.en);
}

const FUNCTION_SET = new Set(Object.keys(FUNCTION_ZH));
export function keysOf(s, env = {}) {
  const fill = k => { if (k.zh) return k; const i = wordInfo(k.w, env); return { w: k.w, zh: i.zh }; };
  if (s && s.keys && s.keys.length) return s.keys.slice(0, 2).map(fill).filter(k => k.zh);
  const ep = env.episode || {};
  const seen = new Set();
  const cands = [];
  for (const t of tokenize(s && s.en)) {
    if (!t.word || seen.has(t.word) || FUNCTION_SET.has(t.word)) continue;
    seen.add(t.word);
    const info = wordInfo(t.text, env);
    if (!info.zh || info.name) continue;
    const primary = safe(() => env.curriculum && env.curriculum.isPrimary && env.curriculum.isPrimary(info.base), false);
    cands.push({ w: t.text, zh: info.zh, score: (info.target ? 4 : 0) + (primary ? 0 : 2) + (t.word.length >= 5 ? 1 : 0) + (ep.glossary && ep.glossary[info.base] ? 1 : 0) });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, 2).map(({ w, zh }) => ({ w, zh }));
}

export function hasTarget(ep, s) {
  const toks = tokenize(s && s.en).filter(t => t.word).map(t => t.word);
  const text = ' ' + normW(s && s.en).replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  return ((ep && ep.targets) || []).some(t => { const w = normW(t.w); return / /.test(w) ? text.includes(' ' + w + ' ') : toks.some(x => sameWord(x, w)); });
}

export function helpEvent(ep, s, level, { phase = 'listen' } = {}) {
  return { type: 'read_help', item: `ep:${ep.id}:s${s.i}`, mode: MODE, episode: ep.id, sentence: s.i, level, phase, kind: 'sentence',
    words: s.words, speaker: !!s.speaker, question: /\?["”]?\s*$/.test(s.en), point: s.point || null, has_target: hasTarget(ep, s) };
}

// ---------------------------------------------------------------- a question: the same hint ladder as the grammar cards (DESIGN 5.5)
// 答对（没看提示）→ 过关，grade 3。答错 → 第 1 级自动出来；每再错一次自动多一级；“再给个提示”给下一级。
// 改对 → 过关，用了提示记“模糊”，grade 2。到第 4 级（讲清楚，答案亮出来）→ 马上出变式题：做对才算过（grade 2），做错 grade 1。
// 没有变式题的题，到第 4 级就结束，不算过（grade 1）。没答就点“给个提示”再答对：过关，记模糊。

export function createAttempt(q, { now = () => Date.now() } = {}) {
  const clock = typeof now === 'function' ? () => +toDate(now()) : () => +toDate(now);
  const variant = q.variant || null;
  const picked = new Set();
  const tags = [];
  let phase = 'ask', level = 0, wrongs = 0, passed = null, clean = false, firstTry = null, variantCorrect = null, hintEarly = false;
  let t0 = clock(), vT0 = 0;
  const a = {
    q, variant, options: q.options, vOptions: variant ? variant.options : null, picked,
    get phase() { return phase; }, get level() { return level; }, get wrongs() { return wrongs; }, get passed() { return passed; },
    get clean() { return clean; }, get done() { return phase === 'done'; },
    get grade() { return passed === null ? null : passed ? (clean ? 3 : 2) : 1; },
  };
  const reveal = () => { if (variant && variant.options.some(o => o.correct)) { phase = 'variant'; vT0 = clock(); } else { phase = 'done'; passed = false; } };
  const base = (question, opt, ms, extra) => ({
    item: question.item, mode: MODE, episode: question.ep, skill: question.skill || null, ...(question.word ? { word: question.word } : {}),
    choice: opt.text, correct: !!opt.correct, ms: Math.max(0, Math.round(ms)), misconception: opt.correct ? null : opt.tag || null, ...extra,
  });
  a.hint = () => {
    if (phase !== 'ask' && phase !== 'retry') return null;
    if (level >= HINT_MAX) return null;
    if (!wrongs) hintEarly = true;
    level++;
    const out = { level, text: q.hints[level - 1] || '', auto: false };
    if (level >= HINT_MAX) reveal();
    return out;
  };
  a.pick = i => {
    if (phase !== 'ask' && phase !== 'retry') return null;
    const opt = q.options[i];
    if (!opt || picked.has(i)) return null;
    picked.add(i);
    const first = firstTry === null;
    if (first) firstTry = !!opt.correct;
    const seen = level;
    const ms = clock() - t0;
    const out = { correct: !!opt.correct, text: opt.text, tag: opt.correct ? null : opt.tag, level: seen, first, done: false, hintShown: null };
    if (opt.correct) {
      phase = 'done'; passed = true; clean = first && !hintEarly && level === 0;
      out.done = true;
      out.event = base(q, opt, ms, { first_try: first, hint_level: seen, done: true, passed: true, grade: clean ? 3 : 2, fuzzy: !clean, ...(wrongs ? { fixed_after: seen } : {}) });
      return out;
    }
    wrongs++;
    if (opt.tag) tags.push(opt.tag);
    phase = 'retry';
    if (level < HINT_MAX) {
      level++;
      out.hintShown = { level, text: q.hints[level - 1] || '', auto: true };
      if (level >= HINT_MAX) reveal();
    }
    out.done = phase === 'done';
    out.event = base(q, opt, ms, { first_try: first, hint_level: seen, ...(out.done ? { done: true, passed: false, grade: 1, fuzzy: false } : {}) });
    return out;
  };
  a.pickVariant = i => {
    if (phase !== 'variant' || !variant) return null;
    const opt = variant.options[i];
    if (!opt) return null;
    phase = 'done';
    variantCorrect = !!opt.correct;
    passed = variantCorrect;
    const out = { correct: !!opt.correct, text: opt.text, tag: opt.correct ? null : opt.tag, level: HINT_MAX, first: true, done: true, hintShown: null };
    out.event = base(variant, opt, clock() - vT0, { first_try: true, hint_level: 0, variant: true, of: q.item, done: true, passed, grade: passed ? 2 : 1, fuzzy: !!passed });
    return out;
  };
  a.result = () => ({ item: q.item, qid: q.id, skill: q.skill, word: q.word, passed: !!passed, grade: a.grade || 1, clean, firstTry: firstTry === true,
    hintLevel: level, wrongs, tags: tags.slice(), variantCorrect });
  return a;
}

// ---------------------------------------------------------------- reading aloud, one sentence at a time

// about how long one sentence takes to say (when there is no voice to ask): ~2.6 words a second plus a breath
export const speakMs = text => 380 * Math.max(1, wordCount(text)) + 500;

// count: how many sentences; speak(i) -> Promise that settles when sentence i has been said (or was stopped);
// stopSpeech(): stop the voice now (speak's promise must settle); gap(i): the pause after sentence i.
// Player = { index, state: 'idle' | 'playing' | 'paused' | 'done' | 'stopped', start(from), pause(), resume(), replay(), goto(i), stop() }
// The first sentence is spoken inside start() itself (no await before it), so it stays inside the tap that started it.
export function createReadAloud({ count = 0, speak, stopSpeech = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), gap = () => 700, onIndex = () => {}, onState = () => {} } = {}) {
  let index = 0, state = 'idle', token = 0, spoke = false;
  const set = s => { state = s; try { onState(s, index); } catch (e) { /* the view's problem */ } };
  const mark = () => { try { onIndex(index); } catch (e) { /* ignore */ } };
  const say = i => { try { return Promise.resolve(speak(i)); } catch (e) { return Promise.resolve(); } };
  async function loop(t) {
    while (t === token) {
      spoke = false;
      mark();
      await say(index);
      if (t !== token) return;
      spoke = true;
      if (index >= count - 1) { set('done'); return; }
      await sleep(gap(index));
      if (t !== token) return;
      index++;
    }
  }
  const api = {
    get index() { return index; },
    get state() { return state; },
    start(from = 0) {
      token++;
      stopSpeech();
      if (!count) { set('done'); return; }
      index = Math.max(0, Math.min(count - 1, from));
      set('playing');
      loop(token);
    },
    pause() {
      if (state !== 'playing') return false;
      token++;
      stopSpeech();
      set('paused');
      return true;
    },
    resume() {
      if (state !== 'paused') return false;
      if (spoke) { if (index >= count - 1) { set('done'); return true; } index++; }
      token++;
      set('playing');
      loop(token);
      return true;
    },
    // 重听这句: while playing it says this sentence again and goes on; paused or done it says it once and stays put
    replay() {
      if (!count) return;
      const playing = state === 'playing';
      token++;
      stopSpeech();
      if (playing) { loop(token); return; }
      const t = token;
      spoke = false;
      mark();
      say(index).then(() => { if (t === token) spoke = true; });
    },
    goto(i) {
      if (!count) return;
      const playing = state === 'playing';
      token++;
      stopSpeech();
      index = Math.max(0, Math.min(count - 1, i));
      spoke = false;
      if (playing) loop(token); else mark();
    },
    stop() { token++; stopSpeech(); if (state !== 'done') set('stopped'); },
  };
  return api;
}

// ---------------------------------------------------------------- progress (kv 'story:progress')

export function emptyProgress() { return { v: 1, current: null, episodes: {}, words: {}, looked: {}, added: [], updated: '' }; }
function normEp(e) {
  const s = obj(e.stats);
  return {
    started: str(e.started), done: isDay(e.done) ? e.done : null, again: arr(e.again).map(str).filter(isDay), met: str(e.met),
    listens: num(e.listens), selfReads: num(e.selfReads), readMs: num(e.readMs), helps: { ...obj(e.helps) }, taps: num(e.taps),
    answers: clone(obj(e.answers)), flagged: arr(e.flagged).map(str).filter(Boolean),
    stats: { right: num(s.right), fuzzy: num(s.fuzzy), failed: num(s.failed), flagged: num(s.flagged) }, boring: !!e.boring, last: str(e.last),
  };
}
export function normProgress(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object') return p;
  if (typeof raw.current === 'string' && raw.current) p.current = raw.current;
  for (const [id, e] of Object.entries(obj(raw.episodes))) if (e && typeof e === 'object') p.episodes[id] = normEp(e);
  for (const [slug, w] of Object.entries(obj(raw.words))) if (w && typeof w === 'object') p.words[slug] = { n: num(w.n), first: str(w.first), last: str(w.last), eps: arr(w.eps).map(str).filter(Boolean) };
  for (const [k, w] of Object.entries(obj(raw.looked))) if (w && typeof w === 'object') p.looked[k] = { n: num(w.n), last: str(w.last), ep: str(w.ep) };
  p.added = arr(raw.added).map(str).filter(Boolean);
  p.updated = str(raw.updated);
  return p;
}
export function readProgress(kv) {
  return normProgress(safe(() => (kv && typeof kv.peek === 'function' ? kv.peek(KV_KEY, null) : null), null));
}
// kv, a progress object, or nothing
const progressOf = x => (x && typeof x.peek === 'function' ? readProgress(x) : normProgress(x));

const withEp = (p, id, fn) => {
  const out = normProgress(p);
  const e = out.episodes[id] || normEp({});
  fn(e, out);
  out.episodes[id] = e;
  return out;
};

export const startEpisode = (p, id, now = new Date()) => withEp(p, id, (e, out) => {
  if (!e.started) e.started = dayOf(now);
  e.last = dayOf(now);
  if (!e.done) out.current = id;
});

// how often each target word shows up in this episode ("notebooks" counts for notebook)
export function targetHits(ep) {
  const out = {};
  const text = ' ' + ep.sentences.map(s => normW(s.en).replace(/[^a-z' ]/g, ' ')).join(' ').replace(/\s+/g, ' ') + ' ';
  const toks = tokenize(ep.sentences.map(s => s.en).join(' ')).filter(t => t.word).map(t => t.word);
  for (const t of ep.targets) {
    const w = normW(t.w);
    out[t.slug] = / /.test(w) ? text.split(' ' + w + ' ').length - 1 : toks.filter(x => sameWord(x, w)).length;
  }
  return out;
}

// one listen to the end: reading time, and the target words met (counted once a day per episode)
export const noteListen = (p, ep, { ms = 0, now = new Date() } = {}) => withEp(p, ep.id, (e, out) => {
  e.listens++;
  e.readMs += Math.max(0, Math.round(ms));
  const day = dayOf(now);
  if (e.met === day) return;
  e.met = day;
  for (const [slug, n] of Object.entries(targetHits(ep))) {
    if (!n) continue;
    const w = out.words[slug] || { n: 0, first: ep.id, last: '', eps: [] };
    w.n += n;
    w.last = day;
    if (!w.first) w.first = ep.id;
    if (!w.eps.includes(ep.id)) w.eps.push(ep.id);
    out.words[slug] = w;
  }
});
export const noteSelfRead = (p, id, { ms = 0 } = {}) => withEp(p, id, e => { e.selfReads++; e.readMs += Math.max(0, Math.round(ms)); });
export const noteHelp = (p, id, i, level) => withEp(p, id, e => { e.helps[String(i)] = Math.max(num(e.helps[String(i)]), level); });
export const noteTap = (p, id, base, now = new Date()) => withEp(p, id, (e, out) => {
  e.taps++;
  if (!base) return;
  const w = out.looked[base] || { n: 0, last: '', ep: id };
  w.n++; w.last = dayOf(now); w.ep = id;
  out.looked[base] = w;
});
export const noteAdded = (p, slug) => { const out = normProgress(p); if (slug && !out.added.includes(slug)) out.added.push(slug); return out; };
export const noteAnswer = (p, id, r, now = new Date()) => withEp(p, id, e => {
  e.answers[r.qid] = { grade: r.grade, passed: !!r.passed, clean: !!r.clean, hint: r.hintLevel || 0, at: isoLocal(now) };
});
export const noteFlag = (p, id, qid) => withEp(p, id, e => { if (!e.flagged.includes(qid)) e.flagged.push(qid); });
export const noteBoring = (p, id) => withEp(p, id, e => { e.boring = true; });

function statsOf(e) {
  const s = { right: 0, fuzzy: 0, failed: 0, flagged: e.flagged.length };
  for (const a of Object.values(e.answers)) { if (a.clean) s.right++; else if (a.passed) s.fuzzy++; else s.failed++; }
  return s;
}
export const finishEpisode = (p, id, { now = new Date(), again = false } = {}) => withEp(p, id, (e, out) => {
  const day = dayOf(now);
  if (e.done && again) { if (!e.again.includes(day)) e.again.push(day); } else if (!e.done) e.done = day;
  e.stats = statsOf(e);
  e.last = day;
  if (out.current === id) out.current = null;
});

// ---------------------------------------------------------------- what to read today (plan.js)

export function nextEpisode(kv, { content: c = cached } = {}) {
  if (!c || !c.episodes.length) return null;
  const p = progressOf(kv);
  const cur = p.current ? c.episode(p.current) : null;
  if (cur && !(p.episodes[cur.id] || {}).done) return cur.id;
  const e = c.episodes.find(x => !(p.episodes[x.id] || {}).done);
  return e ? e.id : null;
}
export function episodeDone(kv, id, { content: c = cached } = {}) {
  const p = progressOf(kv);
  const ep = c ? c.episode(id) : null;
  return !!(p.episodes[ep ? ep.id : String(id)] || {}).done;
}

// all six read: the one she found hardest (wrong answers, then hints, then help) and has not read in the last 3 days
function rereadPick(p, c, today) {
  let best = null, bestScore = 0;
  for (const ep of c.episodes) {
    const e = p.episodes[ep.id];
    if (!e || !e.done) continue;
    const last = [e.done, ...e.again].sort().pop();
    if (last && last > addDays(today, -3)) continue;
    const s = statsOf(e);
    const score = s.failed * 3 + s.fuzzy * 2 + Object.values(e.helps).reduce((a, n) => a + num(n), 0) * 0.5 - e.again.length * 2;
    if (score > bestScore) { best = ep; bestScore = score; }
  }
  return best ? best.id : null;
}

export function estimateMinutes(ep, { short = false } = {}) {
  if (!ep) return 0;
  const listen = (ep.words / 2.2 + ep.sentences.length * 0.8) / 60;
  const nq = short ? Math.min(SHORT_QUESTIONS, ep.questions.length) : ep.questions.length;
  return Math.max(2, Math.round(0.5 + listen + nq * 0.7));
}

export function readCell(kv, now = new Date(), { content: c = cached, light = false } = {}) {
  const base = { id: 'read', label: '读一段', mode: 'story', status: 'soon', items: [], minutes: 0, note: '' };
  if (!c || !c.episodes.length) return base;
  const p = progressOf(kv);
  const today = dayOf(now);
  const of = c.episodes.length;
  const todays = c.episodes.find(e => { const r = p.episodes[e.id]; return r && (r.done === today || r.again.includes(today)); });
  if (todays) return { ...base, status: 'done', episodeId: todays.id, n: todays.n, of, title: todays.title, titleZh: todays.titleZh, note: `第 ${todays.n} 集读完了` };
  let id = nextEpisode(p, { content: c });
  let again = false;
  if (!id) { id = rereadPick(p, c, today); again = !!id; }
  if (!id) return { ...base, status: 'skip', of, allDone: true, note: '番外都读完了' };
  const ep = c.episode(id);
  const short = !!light;
  const rec = p.episodes[ep.id];
  return { ...base, status: 'ready', episodeId: ep.id, n: ep.n, of, title: ep.title, titleZh: ep.titleZh,
    minutes: estimateMinutes(ep, { short }), again, short, resume: !again && !!(rec && rec.started),
    note: again ? `再读第 ${ep.n} 集` : `番外第 ${ep.n} 集` };
}

export function wordsMet(kv) {
  const p = progressOf(kv);
  return Object.fromEntries(Object.entries(p.words).map(([slug, w]) => [slug, w.n]));
}

// for the parent page and the weekly look back: where reading is still hard
export function readingSummary(kv, { content: c = cached } = {}) {
  const p = progressOf(kv);
  const eps = c ? c.episodes : [];
  const bySkill = {};
  const hard = [];
  let done = 0, helps = 0, full = 0;
  for (const ep of eps) {
    const e = p.episodes[ep.id];
    if (!e) continue;
    if (e.done) done++;
    for (const [i, lv] of Object.entries(e.helps)) {
      helps++;
      if (num(lv) >= HELP_MAX) full++;
      const s = ep.sentences[Number(i) - 1];
      if (s) hard.push({ ep: ep.id, n: ep.n, i: s.i, en: s.en, level: num(lv), point: s.point || null });
    }
    for (const q of ep.questions) {
      const a = e.answers[q.id];
      if (!a) continue;
      const k = q.skill || 'other';
      const b = bySkill[k] || (bySkill[k] = { name: SKILLS[k] || '其他', n: 0, clean: 0, fuzzy: 0, failed: 0 });
      b.n++;
      if (a.clean) b.clean++; else if (a.passed) b.fuzzy++; else b.failed++;
    }
  }
  hard.sort((a, b) => b.level - a.level || a.n - b.n || a.i - b.i);
  return { done, of: eps.length, helps, full, hard: hard.slice(0, 8), bySkill, words: Object.keys(p.words).length, looked: Object.keys(p.looked).length };
}

// ---------------------------------------------------------------- content check (tests): things that would teach her something wrong

export function checkEpisode(ep) {
  const out = [];
  const where = q => `${ep.id} ${q.id}`;
  if (!ep.title) out.push(`${ep.id}: no title`);
  if (!ep.sentences.length) out.push(`${ep.id}: no sentences`);
  for (const s of ep.sentences) {
    if (!s.zh) out.push(`${ep.id} s${s.i}: no Chinese`);
    if (s.chunks.length >= 2 && chunksOf(s).join('|') !== s.chunks.join('|')) out.push(`${ep.id} s${s.i}: chunks do not add up to the sentence`);
    for (const k of s.keys) if (!tokenize(s.en).some(t => t.word && sameWord(t.word, normW(k.w))) && !normW(s.en).includes(normW(k.w))) out.push(`${ep.id} s${s.i}: key word ${k.w} is not in the sentence`);
  }
  for (const q of ep.questions) {
    for (const x of [q, q.variant].filter(Boolean)) {
      const right = x.options.filter(o => o.correct).length;
      if (right !== 1) out.push(`${where(x)}: ${right} correct options`);
      if (x.options.length < 2) out.push(`${where(x)}: fewer than 2 options`);
      const texts = x.options.map(o => normW(o.text));
      if (new Set(texts).size !== texts.length) out.push(`${where(x)}: two options say the same`);
    }
    if (q.hints.length !== HINT_MAX) out.push(`${where(q)}: ${q.hints.length} hints, not ${HINT_MAX}`);
    if (!q.variant) out.push(`${where(q)}: no variant`);
    if (!q.evidence.length && q.skill !== 'main') out.push(`${where(q)}: no evidence sentence`);
  }
  return out;
}
