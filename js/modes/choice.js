// 四选一（DESIGN 5.1，v0 唯一的题型）：看英文选中文意思（en2zh），或看中文选英文（zh2en）。干扰项带误解标签
// （form 形近、category 同类、meaning 意思近、sound 读音近，teacher-memory 2.2），作答记一条 events 'answer'。
// 负责：题型 agent（modes/choice.js、dictation.js、css/choice.css）。
//
// 出题规则
//   干扰项先从同单元的词里挑，再看同词性、长度相近；pool（这节课的词、单词本）不够时，用同单元的课本词
//   和课标词（经离线词典查中文）补。近义词不当干扰项（会有两个对的）；和正确答案形近的最多一个；
//   三个干扰项之间不放形近词、不放意思一样的。答错的词隔约 4 张再出（session.js），再出时换成更容易的形式：
//   看英文选中文，干扰项不带形近、读音近、意思近。
//   评分：第一次就对 3；用了“再看一次”才对 2；答错 1（gradeOf）。上课里答对一次就收。
//
// 导出
//   DIRECTIONS = ['en2zh', 'zh2en']；MODE_ID = 'mc4'；TAG_NOTE 每个标签答错时的一句话
//   meaningOf(entry) -> string               词条最短的中文意思（brief_cn，没有就用第一个义项，再没有用 cn）
//   posOf(entry) -> 'n' | 'v' | 'adj' | 'adv' | 'prep' | 'pron' | 'num' | 'conj' | 'int' | 'art' | 'phrase' | ''
//   formNear(a, b) / soundNear(a, b) / categoriesOf(word) / meaningRelation(a, b) -> 'same' | 'near' | null
//   tagOf(target, other) -> null | 'form' | 'sound' | 'category' | 'meaning'
//   makeQuestion(entry, pool, { direction, rng, extra, unit, easy, distractor }) -> Question | null   纯函数
//     distractor（0.7.1，她说的热身难度，kid-me knobs）：'near' 同单元、同词性、长得像 / 读音近的先；'far' 别的单元、
//     别的词性、长度差得多的先，不放形近、读音近、意思近；'normal' 原来的做法。'far' 凑不齐时退回 'normal'
//     pool：可以当干扰项的词条（同一节课的词、单词本）；extra：补位用的词（课本单元词 { w, cn }、词典条目
//     { word, cn }、词条都行），排在 pool 后面；easy：只用离得远的干扰项（答错后再考）
//     三个干扰项凑不齐就返回 null（换闪卡或跳过）
//     Question = { id: 'w:<slug>', slug, direction, unit, easy,
//                  prompt: { text, lang: 'en' | 'zh-CN', say: 要朗读的英文 },
//                  options: [{ text, slug, correct: bool, tag: null | 'form' | 'category' | 'meaning' | 'sound',
//                              headword, meaning, src: 'target' | 'pool' | 'extra' }],
//                  answer: 正确选项的下标, right: { headword, meaning }, hint: Hint | null }
//   makeChoice(entry, pool, { direction?, rng, extra, unit, easy? }) -> Question | null
//     makeQuestion 加默认值：direction 按 directionFor(entry)，easy 按 isRetry(entry)
//   directionFor(entry, now) -> 'en2zh' | 'zh2en'   新词、刚答错的看英文选中文；见过一次以后多半看中文选英文（0.9.3，三次里两次）
//   isRetry(entry, now) -> bool              今天最后一次评分是 1（这节课里答错过，隔几张又出来了）
//   hintFor(entry, direction) -> Hint | null “再看一次”给的东西：en2zh 是例句（没有例句用巧记），zh2en 是首字母和字母数
//     Hint = { kind: 'example' | 'mnemonic' | 'letter', text, lang, say, mark? }
//   explain(q, i) -> string                  选了第 i 个以后的一句中文说明（答错时显示）
//   gradeOf({ correct, firstTry, hintLevel }) -> 1 | 2 | 3   给 FSRS 的评分
//   createAttempt(q, { now, retry }) -> { pick(i) -> Result | null, hint() -> hintLevel, done, picked, correct, grade, hintLevel, event }
//     纯状态（不碰 DOM）：只能选一次；Result = { correct, grade, event, explain }
//     event 是 events 'answer' 的字段（type、sid、step 由调用方补）：
//       { item, slug, mode: 'mc4', direction, choice: 选项文字, choice_slug, distractor: 选中的干扰项 slug 或 null,
//         correct, first_try, ms, hint_level, misconception: 干扰项的标签（答对为 null）, unit?, retry? }
//   renderChoice(container, q, { onAnswer, onDone, say, retry, autoNextMs }) -> { el, attempt, pick(i), hint(), next(), onKey(ev) }
//     把一道题画进 container（大按钮）。onAnswer(event) 作答时调用一次；onDone({ grade, correct, event }) 她往下走时调用：
//     答对停一下自动往下，答错显示正确答案和一句说明，点“下一个”往下
//   fillerFor(entry, app) -> [补位的词]       从 app.curriculum（同单元课本词、standardWords()、posOf）和 app.dict 拼 extra；
//                                            app.words 里已有 AI 讲解的词用它的 brief_cn
//   sureFirst(slugs, get, now) -> [slug]     把最有把握的那张挪到第一张（今天热身用，先让她答对一个）
//   choiceMode = { id: 'mc4', label: '四选一', render(entry, ctx) -> { el, footer, onKey, question } }
//     和 ui-review.js 的 flashcard 同一个“mode”接口，session.js 跑队列：
//     ctx = { app, rate(rating, { modeId }), say(text, button), position: { n, total, isNew }, pool: [entry],
//             extra?: [补位的词], direction?: 指定方向, onAnswer(ev)?: 作答时调用，sid、step 由 ui-lesson 补 }
//
// 依赖：ui-dom.js（h、icon、marked、stemRe）、words.js（slugify）、fsrs.js（retrievability、State）。
// 不直接写数据库：评分走 ctx.rate，事件走 ctx.onAnswer。
import { h, icon, marked, stemRe } from '../ui-dom.js';
import { slugify } from '../words.js';
import { retrievability, State } from '../fsrs.js';

export const DIRECTIONS = ['en2zh', 'zh2en'];
export const MODE_ID = 'mc4';
export const WORD_TAGS = ['form', 'category', 'meaning', 'sound'];
export const TAG_NOTE = {
  form: '两个词长得像，看清每个字母。',
  sound: '两个词读起来像，多听两遍。',
  category: '它们是同一类词，各记各的意思。',
  meaning: '意思有点像，抓住不一样的地方。',
};

// ---------------------------------------------------------------- word helpers (pure)

const low = s => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const headOf = x => String((x && (x.headword || x.w || x.word)) || '').trim();
const hasHan = s => /[一-鿿]/.test(String(s || ''));

// "a. 严厉的, 绝对的；n. ..." -> "严厉的"; drops [计] 这类标注和括号里的说明
function firstMeaning(cn) {
  const s = String(cn ?? '').replace(/\\[rnt]/g, ' ').replace(/^\s*(?:[a-z]+\.\s*)+/i, '');
  const parts = s.split(/[；;，,、\n]/).map(x => x.replace(/\[[^\]]*\]|（[^）]*）|\([^)]*\)|<[^>]*>/g, '').trim()).filter(Boolean);
  return parts.find(hasHan) || parts[0] || '';
}

export function meaningOf(e) {
  if (!e) return '';
  if (e.brief_cn) return String(e.brief_cn);
  const s = (e.senses || []).find(x => x && x.cn);
  if (s) return String(s.cn).split(/[；;]/)[0];
  return e.cn ? firstMeaning(e.cn) : '';
}

// every Chinese meaning an entry carries, for the synonym check
function meaningsOf(e) {
  if (!e) return [];
  const out = [meaningOf(e)];
  for (const s of e.senses || []) if (s && s.cn) out.push(...String(s.cn).split(/[；;，,、]/));
  if (e.cn) out.push(...String(e.cn).replace(/\\[rnt]/g, ' ').split(/[；;，,、\n]/));
  return out.map(core).filter(Boolean);
}
// the Chinese characters that carry the meaning: no part of speech, no notes, no 的 / 地 / 得 / 了 / 着
function core(s) {
  return String(s ?? '').replace(/\[[^\]]*\]|（[^）]*）|\([^)]*\)|<[^>]*>/g, '').replace(/^\s*(?:[a-z]+\.\s*)+/i, '')
    .replace(/[的地得了着]/g, '').replace(/[^一-鿿]/g, '');
}

const POS = [[/^(adj|a)$/, 'adj'], [/^(adv|ad)$/, 'adv'], [/^n$/, 'n'], [/^(v|vt|vi|aux|modal)$/, 'v'], [/^prep$/, 'prep'],
  [/^pron$/, 'pron'], [/^num$/, 'num'], [/^conj$/, 'conj'], [/^(int|interj)$/, 'int'], [/^(art|det)$/, 'art'], [/^phrase$/, 'phrase']];
export function normPos(p) {
  const t = low(p).split(/[\s/&,.]+/).filter(Boolean)[0] || '';
  for (const [re, v] of POS) if (re.test(t)) return v;
  return '';
}
export function posOf(e) {
  if (!e) return '';
  if (e.pos) return normPos(e.pos);
  if (e.phrase || /\s/.test(headOf(e))) return 'phrase';
  const s = (e.senses || []).find(x => x && x.pos);
  if (s) return normPos(s.pos);
  const m = String(e.cn || '').match(/^\s*([a-z]+)\./i);
  return m ? normPos(m[1]) : '';
}

export function editDistance(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// book / books, like / liked: the same word, never a distractor of each other
export function sameWord(a, b) {
  a = low(a); b = low(b);
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return ['s', 'es', 'd', 'ed', 'ing'].some(x => l === s + x) || (s.endsWith('e') && l === s.slice(0, -1) + 'ing') ||
    (s.endsWith('y') && (l === s.slice(0, -1) + 'ies' || l === s.slice(0, -1) + 'ied'));
}

// 形近：拼写只差一两个字母（here / there、form / from、quiet / quite）。两个字母以内的词不算
export function formNear(a, b) {
  a = low(a); b = low(b);
  if (!a || !b || a === b || sameWord(a, b) || Math.min(a.length, b.length) < 3) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if ([...a].sort().join('') === [...b].sort().join('')) return true;
  const n = Math.max(a.length, b.length);
  return editDistance(a, b) <= (n <= 4 ? 1 : n <= 8 ? 2 : 3);
}

const HOMOPHONES = [['right', 'write'], ['two', 'too', 'to'], ['there', 'their'], ['hear', 'here'], ['see', 'sea'], ['son', 'sun'],
  ['meet', 'meat'], ['know', 'no'], ['buy', 'by', 'bye'], ['for', 'four'], ['eye', 'i'], ['one', 'won'], ['hour', 'our'],
  ['which', 'witch'], ['week', 'weak'], ['road', 'rode'], ['flower', 'flour'], ['dear', 'deer'], ['new', 'knew'],
  ['blue', 'blew'], ['wear', 'where'], ['tail', 'tale'], ['sail', 'sale'], ['pair', 'pear'], ['plane', 'plain'], ['piece', 'peace'],
  ['whole', 'hole'], ['night', 'knight'], ['be', 'bee'], ['red', 'read'], ['ate', 'eight']];
export function soundKey(w) {
  const s = low(w).replace(/[^a-z]/g, '');
  if (!s) return '';
  const code = c => ('bfpv'.includes(c) ? '1' : 'cgjkqsxz'.includes(c) ? '2' : 'dt'.includes(c) ? '3' : c === 'l' ? '4' : 'mn'.includes(c) ? '5' : c === 'r' ? '6' : '');
  let out = s[0].toUpperCase(), last = code(s[0]);
  for (const c of s.slice(1)) {
    const d = code(c);
    if (d && d !== last) out += d;
    if (c !== 'h' && c !== 'w') last = d;
  }
  return (out + '000').slice(0, 4);
}
// 读音近：同音词表里的一对，或首字母相同、Soundex 一样（但不是形近，形近优先）
export function soundNear(a, b) {
  a = low(a); b = low(b);
  if (!a || !b || a === b || sameWord(a, b)) return false;
  if (HOMOPHONES.some(g => g.includes(a) && g.includes(b))) return true;
  return a.length >= 3 && b.length >= 3 && soundKey(a) === soundKey(b);
}

// 同类：颜色、星期、月份、数字、家人、动物……（DESIGN 5.1 说的那几类）。一个词可以在几类里（orange、chicken）
export const CATEGORIES = Object.fromEntries(Object.entries({
  color: 'red orange yellow green blue purple pink brown black white grey gray',
  weekday: 'monday tuesday wednesday thursday friday saturday sunday',
  month: 'january february march april may june july august september october november december',
  number: 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand first second third',
  family: 'father mother dad mum mom brother sister grandfather grandmother grandpa grandma uncle aunt cousin son daughter parent parents baby husband wife',
  animal: 'cat dog bird fish pig cow horse sheep duck chicken rabbit mouse tiger lion monkey panda elephant bear snake zebra giraffe wolf fox kangaroo koala',
  body: 'head face eye ear nose mouth hand arm leg foot feet hair tooth teeth finger knee neck shoulder back',
  subject: 'chinese english maths math science history geography music art pe biology physics chemistry',
  food: 'rice noodle noodles bread egg milk water juice tea coffee apple banana orange pear grape meat chicken fish vegetable vegetables fruit cake sandwich hamburger dumpling dumplings',
  clothes: 'shirt t-shirt skirt dress coat jacket sweater trousers jeans shorts shoe shoes sock socks hat cap',
  weather: 'sunny rainy cloudy windy snowy hot cold warm cool',
  season: 'spring summer autumn fall winter',
  place: 'school home park zoo library hospital shop museum cinema classroom playground supermarket',
  room: 'bedroom kitchen bathroom desk chair bed table door window sofa',
  job: 'teacher doctor nurse driver farmer worker student cook policeman engineer',
  time: 'morning afternoon evening night today tomorrow yesterday week month year',
}).map(([k, v]) => [k, new Set(v.split(' '))]));
export const categoriesOf = w => Object.keys(CATEGORIES).filter(k => CATEGORIES[k].has(low(w)));
const sameCategory = (a, b) => { const ca = categoriesOf(a); return ca.length > 0 && categoriesOf(b).some(c => ca.includes(c)); };

// 'same'：意思一样或几乎一样（近义词，不能当干扰项）；'near'：有一个字相同（高的 / 高兴的）；null：不相干
export function meaningRelation(a, b) {
  if (!a || !b) return null;
  const ha = low(headOf(a)), hb = low(headOf(b));
  // the entry's own synonym list (lexicon); confusables are left out on purpose, they make good 形近 distractors
  const syn = (x, w) => (x.synonyms || []).some(s => low(s && typeof s === 'object' ? s.word : s) === w);
  if ((ha && syn(b, ha)) || (hb && syn(a, hb))) return 'same';
  const ma = core(meaningOf(a)), mb = core(meaningOf(b));
  if (!ma || !mb) return null;
  if (ma === mb || meaningsOf(a).includes(mb) || meaningsOf(b).includes(ma)) return 'same';
  const shared = [...new Set(mb)].filter(c => ma.includes(c)).length;
  if (!shared) return null;
  return shared / Math.max(ma.length, mb.length) >= 0.67 ? 'same' : 'near';
}

// the misconception tag a distractor carries (teacher-memory 2.2): what she probably mixed up if she picks it
export function tagOf(target, other, rel = meaningRelation(target, other)) {
  const a = headOf(target), b = headOf(other);
  if (formNear(a, b)) return 'form';
  if (soundNear(a, b)) return 'sound';
  if (sameCategory(a, b)) return 'category';
  if (rel === 'near') return 'meaning';
  return null;
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- questions (pure)

function candidate(x, src) {
  const headword = headOf(x);
  if (!headword) return null;
  return { x, src, slug: x.slug || slugify(headword), headword, meaning: meaningOf(x), pos: posOf(x), unit: x.unit || null };
}
const textOf = (c, direction) => (direction === 'en2zh' ? c.meaning : c.headword);
const lenClose = (a, b) => Math.abs([...a].length - [...b].length) <= Math.max(2, Math.round(Math.max([...a].length, [...b].length) * 0.3));

export const DISTRACTOR_LEVELS = ['far', 'normal', 'near'];
// how much a candidate distractor is wanted at this distance (0.7.1); 'normal' keeps the old score
export function distanceScore(target, c, { tag, u, text, right, distractor = 'normal' } = {}) {
  if (distractor === 'near') {
    return (u && c.unit === u ? 6 : 0) + (target.pos && c.pos === target.pos ? 3 : 0) + (tag === 'form' ? 5 : tag === 'sound' ? 4 : tag === 'category' ? 2 : 0)
      + (low(c.headword)[0] === low(target.headword)[0] ? 1 : 0) + (lenClose(text, right) ? 1 : 0);
  }
  if (distractor === 'far') {
    return (u && c.unit && c.unit !== u ? 4 : 0) + (target.pos && c.pos && c.pos !== target.pos ? 3 : 0) + (!lenClose(text, right) ? 2 : 0)
      + (low(c.headword)[0] !== low(target.headword)[0] ? 1 : 0) + (tag ? -6 : 0);
  }
  return null;
}

export function makeQuestion(entry, pool = [], { direction = 'en2zh', rng = Math.random, extra = [], unit, easy = false, distractor = 'normal' } = {}) {
  if (!entry || !entry.slug) return null;
  if (!DISTRACTOR_LEVELS.includes(distractor) && distractor !== 'far-only') distractor = 'normal';
  if (distractor === 'far') {
    const xs = typeof extra === 'function' ? extra() : extra;
    const far = makeQuestion(entry, pool, { direction, rng, extra: xs, unit, easy: true, distractor: 'far-only' });
    if (far) return { ...far, easy: !!easy, distractor: 'far' };
    return makeQuestion(entry, pool, { direction, rng, extra: xs, unit, easy, distractor: 'normal' });
  }
  const dist = distractor === 'far-only' ? 'far' : distractor;
  if (!DIRECTIONS.includes(direction)) direction = 'en2zh';
  const target = candidate(entry, 'target');
  if (!target) return null;
  const right = textOf(target, direction);
  if (!right) return null;
  // no Chinese yet (a word whose meaning the list lost, waiting for the AI): Chinese-to-English would show an empty prompt
  if (!target.meaning) return null;
  const u = unit || entry.unit || null;
  const seenSlug = new Set([entry.slug]);
  const seenHead = new Set([low(target.headword)]);
  const scored = [];
  const consider = (list, src) => {
    for (const x of list || []) {
      if (!x) continue;
      const c = candidate(x, src);
      if (!c || seenSlug.has(c.slug) || seenHead.has(low(c.headword))) continue;
      seenSlug.add(c.slug); seenHead.add(low(c.headword));
      const text = textOf(c, direction);
      if (!text || low(text) === low(right) || sameWord(target.headword, c.headword)) continue;
      if (direction === 'zh2en' && (posOf(c.x) === 'phrase') !== (target.pos === 'phrase')) continue;  // a phrase among words gives itself away
      const rel = meaningRelation(entry, x);
      if (rel === 'same') continue;                    // a synonym would make two right answers
      const tag = tagOf(entry, x, rel);
      if (easy && (tag === 'form' || tag === 'sound' || tag === 'meaning')) continue;
      const d = distanceScore(target, c, { tag, u, text, right, distractor: dist });
      const score = d === null ? (u && c.unit === u ? 8 : 0) + (src === 'pool' ? 3 : 0) + (target.pos && c.pos === target.pos ? 2 : 0)
        + (lenClose(text, right) ? 1 : 0) + rng() * 0.9 : d + (src === 'pool' ? 1 : 0) + rng() * 0.9;
      scored.push({ c, text, tag, score });
    }
  };
  consider(pool, 'pool');
  consider(typeof extra === 'function' ? extra() : extra, 'extra');
  scored.sort((a, b) => b.score - a.score);

  // strict pass: at most one 形近 and one 意思近 next to the answer, and no two distractors that look alike or mean
  // the same; then a looser pass that only keeps the distractors apart from each other
  const picked = [];
  const clash = s => picked.some(p => low(p.text) === low(s.text) || (dist !== 'near' && formNear(p.c.headword, s.c.headword)) || meaningRelation(p.c.x, s.c.x) === 'same');
  for (const strict of [true, false]) {
    for (const s of scored) {
      if (picked.length === 3) break;
      if (picked.includes(s) || clash(s)) continue;
      // 'near' lets two look-alike / sound-alike distractors in; the others keep one of each
      if (strict && dist !== 'near' && (s.tag === 'form' || s.tag === 'meaning') && picked.some(p => p.tag === s.tag)) continue;
      if (strict && dist === 'near' && s.tag === 'meaning' && picked.some(p => p.tag === 'meaning')) continue;
      picked.push(s);
    }
  }
  if (picked.length < 3) return null;
  const opt = (c, text, correct, tag) => ({ text, slug: c.slug, correct, tag, headword: c.headword, meaning: c.meaning, src: c.src });
  const options = shuffle([opt(target, right, true, null), ...picked.map(s => opt(s.c, s.text, false, s.tag))], rng);
  return {
    id: 'w:' + entry.slug,
    slug: entry.slug,
    direction,
    unit: u,
    easy: !!easy,
    distractor: dist,
    prompt: direction === 'en2zh' ? { text: target.headword, lang: 'en', say: target.headword } : { text: target.meaning, lang: 'zh-CN', say: '' },
    options,
    answer: options.findIndex(o => o.correct),
    right: { headword: target.headword, meaning: target.meaning },
    hint: hintFor(entry, direction),
  };
}

const pad = n => String(n).padStart(2, '0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// the last rating today was 1: she got it wrong earlier in this lesson and it came back
export function isRetry(e, now = new Date()) {
  const r = e && Array.isArray(e.reviews) ? e.reviews[e.reviews.length - 1] : null;
  return !!(r && r.rating === 1 && String(r.at || '').slice(0, 10) === localDay(now));
}

export function directionFor(e, now = new Date()) {
  if (!e || isRetry(e, now)) return 'en2zh';
  const reps = (e.fsrs && e.fsrs.reps) || 0;
  // 0.9.3 (Wei 10-27: 认得意思不够，要背下来): after the first meeting, mostly 看中文选英文
  if (e.write) return reps % 3 === 0 ? 'en2zh' : 'zh2en';
  return reps >= 1 && reps % 3 !== 0 ? 'zh2en' : 'en2zh';
}

export function makeChoice(entry, pool = [], opts = {}) {
  const now = opts.now || new Date();
  return makeQuestion(entry, pool, { ...opts, direction: opts.direction || directionFor(entry, now), easy: opts.easy ?? isRetry(entry, now) });
}

export function hintFor(e, direction = 'en2zh') {
  const hw = headOf(e);
  if (!hw) return null;
  if (direction === 'zh2en') {
    const first = hw.split(/\s+/)[0];
    const letters = first.replace(/[^a-z]/gi, '').length;
    return { kind: 'letter', text: /\s/.test(hw) ? `第一个词以 ${first[0]} 开头` : `以 ${first[0]} 开头，${letters} 个字母`, lang: 'zh-CN', say: '' };
  }
  const re = stemRe(hw);
  const ex = (e.senses || []).map(s => s && s.example).find(x => x && re && new RegExp(re.source, 'i').test(x));
  if (ex) return { kind: 'example', text: ex, lang: 'en', say: ex, mark: hw };
  if (e.mnemonic) return { kind: 'mnemonic', text: String(e.mnemonic), lang: 'zh-CN', say: '' };
  return null;
}

export function explain(q, i) {
  if (!q) return '';
  const r = q.options[q.answer], o = q.options[i];
  const rightLine = q.direction === 'en2zh' ? `${r.headword} 是“${r.meaning}”。` : `“${r.meaning}”是 ${r.headword}。`;
  if (!o || o.correct) return rightLine;
  const pickLine = q.direction === 'en2zh' ? (o.headword ? `“${o.text}”是 ${o.headword}。` : '') : (o.meaning ? `${o.text} 是“${o.meaning}”。` : '');
  return rightLine + pickLine + (o.tag ? TAG_NOTE[o.tag] : '');
}

// first try right 3; right only after “再看一次” 2; wrong 1 (a card answered wrong comes back later in the round)
export const gradeOf = ({ correct, firstTry = true, hintLevel = 0 } = {}) => (!correct || !firstTry ? 1 : hintLevel > 0 ? 2 : 3);

export function createAttempt(q, { now = () => Date.now(), retry = false } = {}) {
  const t0 = now();
  let hintLevel = 0, picked = -1, tries = 0, result = null;
  return {
    get done() { return !!result; },
    get picked() { return picked; },
    get correct() { return result ? result.correct : null; },
    get grade() { return result ? result.grade : null; },
    get hintLevel() { return hintLevel; },
    get event() { return result ? result.event : null; },
    hint() { if (!result && q && q.hint) hintLevel = 1; return hintLevel; },
    pick(i) {
      if (result || !q || !q.options[i]) return null;
      tries++;
      picked = i;
      const o = q.options[i];
      const event = {
        item: q.id, slug: q.slug, mode: MODE_ID, direction: q.direction, choice: o.text, choice_slug: o.slug,
        distractor: o.correct ? null : o.slug, correct: o.correct, first_try: !retry, ms: Math.max(0, now() - t0),
        hint_level: hintLevel, misconception: o.correct ? null : o.tag || null,
      };
      if (q.unit) event.unit = q.unit;
      if (retry) event.retry = true;
      result = { correct: o.correct, grade: gradeOf({ correct: o.correct, firstTry: tries === 1, hintLevel }), event, explain: explain(q, i) };
      return result;
    },
  };
}

// ---------------------------------------------------------------- filler words and the first card

const dictWord = (w, dict, unit) => {
  const d = dict && typeof dict.get === 'function' ? dict.get(w) : null;
  return d && d.cn ? { slug: slugify(w), headword: w, cn: d.cn, pos: posOf({ cn: d.cn }), unit: unit || null } : null;
};

// Extra distractors when the pool is short: the textbook words of the same unit first, then curriculum words of a
// similar length (curriculum.standardWords(), meanings from the offline dictionary). Never throws.
export function fillerFor(entry, app = {}) {
  const out = [];
  try {
    const cur = app.curriculum, dict = app.dict;
    // curriculum.posOf(word) -> ['n.', ...] once its details are loaded; the dictionary line is the fallback
    const curPos = w => { try { const p = cur && typeof cur.posOf === 'function' ? cur.posOf(w) : null; return p && p.length ? normPos(p[0]) : ''; } catch (e) { return ''; } };
    const withPos = x => (x && !x.pos ? { ...x, pos: curPos(x.headword) } : x);
    const hw = headOf(entry);
    const unit = (entry && entry.unit) || (cur && cur.unitOf ? cur.unitOf(hw) : null);
    // a word whose AI core has come back (no needs_core) shows its brief_cn, not the unit list's placeholder
    const aiCn = w => { try { const e = app.words && app.words.get ? app.words.get(slugify(w)) : null; return e && !e.needs_core && e.brief_cn ? String(e.brief_cn) : ''; } catch (err) { return ''; } };
    if (unit && cur && cur.unitWords) {
      for (const x of cur.unitWords(unit)) {
        if (!x || !x.w) continue;
        const cn = aiCn(x.w) || x.cn;
        if (cn) out.push(withPos({ slug: slugify(x.w), headword: x.w, cn, phrase: !!x.phrase, unit, pos: x.pos || (dictWord(x.w, dict) || {}).pos }));
        else { const d = dictWord(x.w, dict, unit); if (d) out.push(withPos(d)); }
      }
    }
    const std = cur && typeof cur.standardWords === 'function' ? cur.standardWords() || [] : [];
    const n = hw.length;
    let k = 0;
    for (const w of std) {
      if (k >= 120) break;
      if (typeof w !== 'string' || Math.abs(w.length - n) > 2) continue;
      const d = dictWord(w, dict);
      if (d) { out.push(withPos(d)); k++; }
    }
  } catch (e) { /* filler is optional */ }
  return out;
}

// The warm-up opens with the card she is surest of (highest recall probability), so the first answer is a right one.
export function sureFirst(slugs, get, now = new Date()) {
  const list = (slugs || []).slice();
  let best = -1, bestR = -1;
  list.forEach((s, i) => {
    const e = get ? get(s) : null;
    const f = e && e.fsrs;
    if (!f || f.state === State.New) return;
    const r = retrievability(f, now) + Math.min(f.reps || 0, 20) / 1000;
    if (r > bestR) { bestR = r; best = i; }
  });
  if (best > 0) list.unshift(list.splice(best, 1)[0]);
  return list;
}

// ---------------------------------------------------------------- rendering

export function renderChoice(container, q, { onAnswer, onDone, say, retry = false, autoNextMs = 700 } = {}) {
  const el = container;
  const attempt = createAttempt(q, { retry });
  let left = false, timer = 0;
  const speak = (text, btn) => { if (text && say) say(text, btn || null); };
  const next = () => {
    if (!attempt.done || left) return;
    left = true;
    clearTimeout(timer);
    if (onDone) onDone({ grade: attempt.grade, correct: attempt.correct, event: attempt.event });
  };

  const enPrompt = q.prompt.lang === 'en';
  const prompt = h('p', { className: 'mc4-prompt', lang: q.prompt.lang }, q.prompt.text,
    enPrompt ? h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => speak(q.prompt.say, ev.currentTarget) } }, icon('speak')) : null);
  const ask = h('p', { className: 'mc4-ask small', text: q.direction === 'en2zh' ? '它是什么意思？' : '哪个词是这个意思？' });
  const hintBox = h('div', { className: 'mc4-hint', hidden: true });
  const feedback = h('p', { className: 'mc4-feedback', role: 'status', 'aria-live': 'polite' });
  const buttons = q.options.map((o, i) => h('button', { type: 'button', className: 'mc4-opt', lang: q.direction === 'zh2en' ? 'en' : 'zh-CN',
    dataset: { i: String(i) }, text: o.text, on: { click: () => pick(i) } }));
  const list = h('div', { className: 'mc4-options', role: 'group', 'aria-label': '选一个' }, buttons);
  const hintBtn = q.hint ? h('button', { type: 'button', className: 'text-btn accent mc4-again', text: '再看一次', on: { click: () => hint() } }) : null;
  const nextBtn = h('button', { type: 'button', className: 'btn mc4-next', text: '下一个', hidden: true, on: { click: next } });
  const actions = h('div', { className: 'btn-row mc4-actions' }, hintBtn, nextBtn);

  function hint() {
    if (attempt.done || !q.hint) return;
    attempt.hint();
    const t = q.hint;
    hintBox.replaceChildren(h('p', { className: 'mc4-hint-text', lang: t.lang }, t.mark ? marked(t.text, t.mark) : t.text));
    hintBox.hidden = false;
    if (hintBtn) hintBtn.hidden = true;
    speak(t.say);
  }

  function pick(i) {
    const r = attempt.pick(i);
    if (!r) return;
    if (onAnswer) { try { onAnswer(r.event); } catch (e) { /* bookkeeping never blocks the answer */ } }
    buttons.forEach((b, k) => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); if (k === q.answer) b.classList.add(r.correct ? 'right' : 'reveal'); });
    if (hintBtn) hintBtn.hidden = true;
    // after the answer she hears the English word once more
    speak(q.direction === 'zh2en' ? q.right.headword : '');
    if (r.correct) {
      feedback.textContent = attempt.hintLevel ? '对了。下次不看也能选对。' : '对了。';
      el.classList.add('is-right');
      timer = setTimeout(next, autoNextMs);
    } else {
      buttons[i].classList.add('wrong');
      feedback.textContent = r.explain;
      el.classList.add('is-wrong');
      nextBtn.hidden = false;
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
    }
  }

  el.classList.add('mc4');
  if (q.easy) el.classList.add('mc4-easy');
  el.replaceChildren(h('div', { className: 'mc4-q' }, prompt, ask), hintBox, list, feedback, actions);

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const n = Number(ev.key);
    if (!attempt.done && n >= 1 && n <= q.options.length) { ev.preventDefault(); pick(n - 1); return; }
    if (attempt.done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); }
  }
  return { el, attempt, pick, hint, next, onKey };
}

export const choiceMode = {
  id: MODE_ID,
  label: '四选一',
  render(e, ctx = {}) {
    const app = ctx.app || {};
    const retry = isRetry(e);
    const q = makeChoice(e, ctx.pool || [], { direction: ctx.direction, extra: ctx.extra || (() => fillerFor(e, app)), distractor: ctx.distractor || 'normal' });
    const el = h('article', { className: 'mc4' });
    const rate = g => ctx.rate && ctx.rate(g, { modeId: MODE_ID });
    if (!q) {
      // not enough distractors yet: show the word and its meaning, she says whether she knew it
      el.append(
        h('p', { className: 'mc4-prompt', lang: 'en' }, e.headword,
          h('button', { type: 'button', className: 'say', 'aria-label': '听一遍', on: { click: ev => ctx.say && ctx.say(e.headword, ev.currentTarget) } }, icon('speak'))),
        h('p', { className: 'lede mc4-meaning', text: meaningOf(e) }),
        h('div', { className: 'btn-row mc4-actions' },
          h('button', { type: 'button', className: 'text-btn', text: '没认出来', on: { click: () => rate(1) } }),
          h('button', { type: 'button', className: 'btn', text: '认得', on: { click: () => rate(3) } })));
      if (ctx.say) setTimeout(() => ctx.say(e.headword, null), 0);
      return { el, footer: null, onKey: null, question: null };
    }
    const view = renderChoice(el, q, { say: ctx.say, retry, onAnswer: ctx.onAnswer, onDone: ({ grade }) => rate(grade) });
    // iPad may block sound without a tap; then she taps the speaker
    if (q.prompt.say && ctx.say) setTimeout(() => ctx.say(q.prompt.say, null), 0);
    return { el, footer: null, onKey: view.onKey, question: q };
  },
};
