// 语音小卡的逻辑（DESIGN 5.1 “语音小卡（v1）”）。不做从 a 开始的拼读课：每周 1 个读音规律，先复习 Starter 学过的
// 开音节、闭音节，后面大致按课本单元排；每条规律一句中文说明、4-6 个例词（按音节分块）、一道小练习。
// 内容在 ../curriculum/phonics.json（公开数据：例词只用课标小学词和 1600 词，不放课本单元信息；单元由 iPad 上的
// kv textbook 现查）。界面在 ui-phonics.js。负责：语音小卡 agent（phonics.js、ui-phonics.js、css/phonics.css、
// curriculum/phonics.json、tests/phonics.test.mjs）。没有 DOM，Node 直接测。
//
// 导出
//   PHONICS_FILE = 'curriculum/phonics.json'     PHONICS_KEY = 'phonics.state'（kv 新键，形状见下）
//   loadPhonics(fetchJSON) -> Promise<data>       读 PHONICS_FILE 并 usePhonics；读不到返回 null，不抛错
//   usePhonics(data) -> data                       直接给内容（测试、app.js 已读好的）
//   phonicsRules() -> [rule]                       当前内容的规律，按周的先后
//   ruleById(id) -> rule | null
//
//   syllables(word) -> ['sel', 'dom']              书写上的音节切分（教学用，和 sel·dom 一样）。规则加一张常见词例外表；
//                                                  词组和连字符词按词拼起来（'social media' -> so cial me di a），保留大小写
//   syllableWords(text) -> [['so','cial'], ['me','di','a']]   同上，按词分组（界面在词之间留空）
//
//   hintFor(word, wrongAttempt) -> null | '一句规律提示'
//     判断这个拼错是“有规律可循”还是“只能死记”：前者（ck、双写、不发音的 e、tion、ai/ay、th/sh/ch、长 /iː/ 写成一个 e、
//     ou/ow、oo、单音节闭音节的元音）给一句提示，例词不会是这个词本身；后者（ee 和 ea 互换、弱读的元音、字母顺序、漏字母）
//     返回 null，交给复习算法多出几次。
//   missRule(word, wrongAttempt) -> null | { rule, hint, kind }     同上，另给规律 id（拿去记 flagged）
//
//   weekKey(now) -> 'YYYY-MM-DD'                   这周一的日期（本地时间），一周一条规律
//   weekRule(now, progress, opts?) -> rule | null  选本周规律（纯函数）
//     progress  kv 'progress'（{ unit, ... }）；可另带 phonics（= kv 'phonics.state'）
//     opts      { state?: kv 'phonics.state', rules?, unitOf?(word) -> 'U2' | '', unitOrder?(unit) -> number,
//                 skipReview?（家长说她会音标：开音节、闭音节不先出，排到最后） }
//     顺序：这周已经定了的 -> 没做过的复习卡（开音节、闭音节） -> 拼写里错得最多、还没讲过的规律 -> 按顺序下一条没做过的
//     -> 全做过了就挑最久没练的（不和上周重复）。给了 unitOf / unitOrder 和 progress.unit 时，例词里有还没学到的单元的词，
//     这条先不出。
//   weekInfo(now, state) -> { key, n }             这是第几周的语音小卡（state.weeks 里排第几）
//
//   kv 'phonics.state' = { weeks: { 'YYYY-MM-DD'（周一）: ruleId }, done: { ruleId: { at, right, total, n } },
//                          flagged: { ruleId: 次数 }, updated }
//   assignWeek(state, now, ruleId) -> state        这周定下这条（只留最近 30 周）
//   markDone(state, ruleId, now, { right, total }) -> state     做完一次；这条的 flagged 清零
//   noteMiss(state, ruleId, now) -> state          拼写里错了一次有规律的
//   readState(kv) -> state                         读 kv（老数据、坏数据都给一个空的）
//   recordMiss({ kv, word, wrong, now }) -> Promise<hint | null>   给字母块、听写用：判断、记 flagged、返回提示
//
// 依赖：无。

export const PHONICS_FILE = 'curriculum/phonics.json';
export const PHONICS_KEY = 'phonics.state';

// ---------------------------------------------------------------- content

let DATA = null;

function normalize(data) {
  const rules = (data && Array.isArray(data.rules) ? data.rules : []).filter(r => r && r.id);
  return { version: (data && data.version) || 0, rules };
}
export function usePhonics(data) { DATA = normalize(data); return DATA; }
export async function loadPhonics(fetchJSON) {
  const get = fetchJSON || (async p => { const r = await fetch(p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
  try { return usePhonics(await get(PHONICS_FILE)); } catch (e) { console.warn('phonics:', (e && e.message) || e); return null; }
}
export const phonicsRules = () => (DATA ? DATA.rules : []);
export const ruleById = (id, rules = phonicsRules()) => rules.find(r => r.id === id) || null;

// ---------------------------------------------------------------- syllables

// Common words that the rules below split differently from a dictionary (mostly a short stressed vowel before one
// consonant: fin·ish, not fi·nish). Only 课标 words here: textbook-only words never go into public files.
const EXCEPTIONS = {
  ready: ['read', 'y'], already: ['al', 'read', 'y'], every: ['ev', 'ery'], very: ['ver', 'y'], city: ['cit', 'y'],
  body: ['bod', 'y'], study: ['stud', 'y'], busy: ['bus', 'y'], money: ['mon', 'ey'], many: ['man', 'y'], any: ['an', 'y'],
  copy: ['cop', 'y'], family: ['fam', 'i', 'ly'], finish: ['fin', 'ish'], never: ['nev', 'er'], ever: ['ev', 'er'],
  seven: ['sev', 'en'], eleven: ['e', 'lev', 'en'], river: ['riv', 'er'], visit: ['vis', 'it'], magic: ['mag', 'ic'],
  lemon: ['lem', 'on'], clever: ['clev', 'er'], cover: ['cov', 'er'], present: ['pres', 'ent'], planet: ['plan', 'et'],
  habit: ['hab', 'it'], travel: ['trav', 'el'], level: ['lev', 'el'], model: ['mod', 'el'], medal: ['med', 'al'],
  metal: ['met', 'al'], minute: ['min', 'ute'], second: ['sec', 'ond'], orange: ['or', 'ange'], character: ['char', 'ac', 'ter'],
  volunteer: ['vol', 'un', 'teer'], chemistry: ['chem', 'is', 'try'], biology: ['bi', 'ol', 'o', 'gy'],
  geography: ['ge', 'og', 'ra', 'phy'], physics: ['phys', 'ics'], technology: ['tech', 'nol', 'o', 'gy'],
  activity: ['ac', 'tiv', 'i', 'ty'], holiday: ['hol', 'i', 'day'], area: ['a', 're', 'a'], idea: ['i', 'de', 'a'],
  people: ['peo', 'ple'], quiet: ['qui', 'et'], science: ['sci', 'ence'], poem: ['po', 'em'], poet: ['po', 'et'],
  evening: ['eve', 'ning'], hundred: ['hun', 'dred'], either: ['ei', 'ther'], neither: ['nei', 'ther'], father: ['fa', 'ther'],
  machine: ['ma', 'chine'], nowhere: ['no', 'where'], towards: ['to', 'wards'], toward: ['to', 'ward'], reply: ['re', 'ply'],
  apply: ['ap', 'ply'], supply: ['sup', 'ply'], disease: ['dis', 'ease'], programme: ['pro', 'gramme'], program: ['pro', 'gram'],
  business: ['busi', 'ness'], argue: ['ar', 'gue'], comic: ['com', 'ic'], panic: ['pan', 'ic'], topic: ['top', 'ic'],
  salad: ['sal', 'ad'], shadow: ['shad', 'ow'], pity: ['pit', 'y'], rapid: ['rap', 'id'], solid: ['sol', 'id'],
  punish: ['pun', 'ish'], honey: ['hon', 'ey'], experience: ['ex', 'pe', 'ri', 'ence'], piano: ['pi', 'an', 'o'],
  radio: ['ra', 'di', 'o'], video: ['vid', 'e', 'o'], museum: ['mu', 'se', 'um'], create: ['cre', 'ate'],
  theatre: ['the', 'a', 'tre'], government: ['gov', 'ern', 'ment'], enemy: ['en', 'e', 'my'], company: ['com', 'pa', 'ny'],
  library: ['li', 'bra', 'ry'], animal: ['an', 'i', 'mal'], astronaut: ['as', 'tro', 'naut'], achieve: ['a', 'chieve'],
  weekend: ['week', 'end'], safety: ['safe', 'ty'], paragraph: ['par', 'a', 'graph'], secret: ['se', 'cret'],
  society: ['so', 'ci', 'e', 'ty'], scientist: ['sci', 'en', 'tist'], onion: ['on', 'ion'], opinion: ['o', 'pin', 'ion'],
  cooperate: ['co', 'op', 'er', 'ate'], restaurant: ['res', 'tau', 'rant'], oclock: ['o', 'clock'],
  heavy: ['heav', 'y'], weather: ['weath', 'er'], pleasure: ['pleas', 'ure'], measure: ['meas', 'ure'], china: ['chi', 'na'],
};

// second halves of compounds (classmate, notebook, everyone); the first half must have 3+ letters and a vowel
const TAILS = ['selves', 'father', 'mother', 'phone', 'thing', 'where', 'times', 'ground', 'paper', 'stairs', 'board', 'house', 'light', 'night',
  'self', 'body', 'book', 'room', 'ball', 'mate', 'time', 'side', 'work', 'noon', 'shop', 'ship', 'port', 'line', 'land',
  'some', 'cake', 'case', 'coat', 'town', 'ever', 'fore', 'bag', 'fly', 'boy', 'man', 'men', 'one', 'day', 'way', 'bow'];

const ONSETS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st',
  'sw', 'tr', 'tw', 'kn', 'wr', 'thr', 'shr', 'scr', 'spl', 'spr', 'str', 'squ', 'sch', 'chr', 'phr', 'qu', 'sq', 'skr']);
const TEAMS = ['eau', 'iew', 'ough', 'augh', 'eigh', 'igh', 'ai', 'ay', 'au', 'aw', 'ea', 'ee', 'ei', 'ey', 'eu', 'ew', 'ie',
  'oa', 'oe', 'oi', 'oo', 'ou', 'ow', 'oy', 'ue', 'ui', 'uy'];
const LEFT = new Set(['ck', 'tch', 'x', 'th', 'sh', 'ch', 'ng']);       // one consonant between vowels: these stay with the first
const PREFIX = new Set(['a', 'be', 'de', 're', 'pre']);                  // a·cross, de·scribe, be·tween, re·spect

const isV = c => !!c && c.length === 1 && 'aeiou'.includes(c);
const isLetterC = c => /[a-z]/.test(c) && !isV(c);
const isCons = c => isLetterC(c) && c !== 'y';

// is w[i] (in a run of vowel letters) a vowel sound? q-u, g-u + vowel, y at the start, y after a vowel (team) are not
function vowelAt(w, i) {
  const c = w[i];
  if (c === 'y') return i > 0 && !isV(w[i - 1]) && w[i - 1] !== 'y' && !isV(w[i + 1] || '');   // gym, happy; not yes, lawyer
  if (!isV(c)) return false;
  if (c === 'u' && i > 0 && w[i - 1] === 'q') return false;
  if (c === 'u' && i > 0 && w[i - 1] === 'g' && i + 1 < w.length && isV(w[i + 1])) return false;       // guitar, dialogue
  // the i of tion / sion / cian / cial / tious / fashion is part of the /ʃ/ sound
  if (c === 'i' && i > 1 && ('tcs'.includes(w[i - 1]) || w.slice(i - 2, i) === 'sh') && /^(on|an|al|ous)/.test(w.slice(i + 1))) return false;
  return true;
}

// index of a silent final e (and of a silent e before final s / d), or -1; a syllabic e (ta·ble, cen·tre) is not silent
function silentE(w) {
  const n = w.length;
  const before = (end) => { for (let k = 0; k < end; k++) if (vowelAt(w, k)) return true; return false; };
  const cle = (k) => k >= 2 && (w[k - 1] === 'l' || w[k - 1] === 'r') && isCons(w[k - 2]) && w[k - 2] !== w[k - 1] && w[k - 2] !== 'w';
  if (n >= 3 && w[n - 1] === 'e') {
    if (cle(n - 1)) return -1;
    if ((w[n - 2] === 'u' && 'gq'.includes(w[n - 3]))) return n - 1;        // league, unique
    if (isLetterC(w[n - 2]) && before(n - 2)) return n - 1;
    return -1;
  }
  if (n >= 4 && w[n - 2] === 'e' && w[n - 1] === 's') {
    if (cle(n - 2)) return -1;                                                // tables
    const p = w[n - 3], pp = w.slice(n - 4, n - 2);
    if (isLetterC(p) && !'sxzcg'.includes(p) && pp !== 'ch' && pp !== 'sh' && before(n - 3)) return n - 2;   // likes, ourselves
    return -1;
  }
  if (n >= 4 && w[n - 2] === 'e' && w[n - 1] === 'd') {
    const p = w[n - 3];
    if (p === 't' || p === 'd' || isV(p) && p !== 'e' && p !== 'i') return -1;
    if (p === 'e' || p === 'i') return -1;                                    // need, tied: vowel teams
    if ((isLetterC(p) || p === 'y') && before(n - 3)) return n - 2;          // tired, played
  }
  return -1;
}

// a word (lowercase a-z) -> tokens { s, v, i }; v = a vowel sound (the nucleus of a syllable)
function tokens(w) {
  const out = [];
  const se = silentE(w);
  let i = 0;
  while (i < w.length) {
    if (i === se) { out.push({ s: 'e', v: false, i }); i++; continue; }
    if (vowelAt(w, i)) {
      let take = 1;
      for (const t of TEAMS) {
        if (!w.startsWith(t, i)) continue;
        const after = w[i + t.length] || '';
        if (t === 'aw' && isV(after)) continue;                                // a·way, a·wake
        if (/gh$/.test(t) && isV(after)) continue;
        if (t.length === 2 && t[1] !== 'w' && t[1] !== 'y' && i + 1 === se) continue;   // never swallow the silent e
        if (t === 'ue' && after && after !== 's') continue;                       // in·flu·ence; blue, Tues·day stay
        if (t === 'ey' && isV(after)) continue;                                    // be·yond
        take = t.length; break;
      }
      out.push({ s: w.slice(i, i + take), v: true, i });
      i += take; continue;
    }
    // consonant units
    const rest = w.slice(i);
    let u = rest[0];
    if (rest.startsWith('tch')) u = 'tch';
    else if (/^(ck|th|sh|ch|wh|ph|qu)/.test(rest)) u = rest.slice(0, 2);
    else if (rest.startsWith('ng') && !(isV(rest[2] || '') || rest[2] === 'r' || rest[2] === 'y' && i + 3 < w.length || rest.slice(2) === 'le')) u = 'ng';
    else if (rest.startsWith('gu') && isV(rest[2] || '') && !vowelAt(w, i + 1)) u = 'gu';
    else if (/^[tcs]i/.test(rest) && !vowelAt(w, i + 1)) u = rest.slice(0, 2);   // the /ʃ/ of tion, cial
    out.push({ s: u, v: false, i });
    i += u.length;
  }
  return out;
}

// where to cut the consonant units between two vowel sounds: returns how many units stay with the first syllable
function cut(units, ctx) {
  const L = units.length;
  const s = units.map(u => u.s);
  if (!L) return 0;
  if (ctx.cle && (s[L - 1] === 'l' || s[L - 1] === 'r')) {                     // ta·ble, lit·tle, cir·cle, pick·le, cen·tre
    if (L === 1) return 0;
    return s[L - 2] === 'ck' ? L - 1 : L - 2;
  }
  if (L === 1) {
    if (LEFT.has(s[0]) && s[0] !== 'th' && s[0] !== 'sh' && s[0] !== 'ch' && s[0] !== 'ng') return 1;   // jack·et, kitch·en, ex·am
    if ((s[0] === 'th' || s[0] === 'sh' || s[0] === 'ch' || s[0] === 'ng')) return 1;                    // oth·er, with·out, teach·er
    if (s[0] === 'r' && ctx.left === 'e' && ctx.k > 0 && !ctx.ria) return 1;                            // dif·fer·ent, in·ter·est
    return 0;                                                                                            // mo·ment, si·lent
  }
  if (ctx.prefix && ONSETS.has(s.join(''))) return 0;                                                     // a·cross, de·scribe
  if (L === 2) return 1;                                                                                 // hap·pen, prob·lem, sel·dom
  for (let k = 1; k < L; k++) {                                                                          // in·tro·duce, hun·dred, pump·kin
    const onset = s.slice(k).join('');
    if (k === L - 1 || ONSETS.has(onset)) return k;
  }
  return L - 1;
}

function core(w) {
  const t = tokens(w);
  const nuc = t.map((x, k) => (x.v ? k : -1)).filter(k => k >= 0);
  if (nuc.length <= 1) return [w];
  const n = w.length;
  const cleWord = n >= 3 && w[n - 1] === 'e' && silentE(w) < 0 && (w[n - 2] === 'l' || w[n - 2] === 'r') && isCons(w[n - 3]);
  const cuts = [];
  for (let j = 0; j + 1 < nuc.length; j++) {
    const a = nuc[j], b = nuc[j + 1];
    const between = t.slice(a + 1, b);
    const isLastE = cleWord && t[b].i === n - 1;
    const head = w.slice(cuts.length ? cuts[cuts.length - 1] : 0, t[a].i + t[a].s.length);
    const ria = t[b].s === 'i' && t[b + 1] && t[b + 1].v;                                              // ma·te·ri·al
    const k = cut(between, { cle: isLastE, left: t[a].s, k: j, ria, prefix: j === 0 && PREFIX.has(head) });
    cuts.push(k < between.length ? between[k].i : t[b].i);
  }
  const out = [];
  let from = 0;
  for (const c of cuts) { out.push(w.slice(from, c)); from = c; }
  out.push(w.slice(from));
  return out.filter(Boolean);
}

const hasNucleus = w => { for (let i = 0; i < w.length; i++) if (vowelAt(w, i)) return true; return false; };

function split(w) {
  if (EXCEPTIONS[w]) return EXCEPTIONS[w].slice();
  for (const tail of TAILS) {
    if (w.length > tail.length + 2 && w.endsWith(tail)) {
      const head = w.slice(0, -tail.length);
      if (head.length >= 3 && hasNucleus(head)) return [...split(head), ...split(tail)];
    }
  }
  if (/^dis[aeiou]/.test(w) && w.length > 5) return ['dis', ...split(w.slice(3))];                          // dis·ap·pear
  if (w.length > 4 && w.endsWith('ing')) {
    const root = w.slice(0, -3);
    if (root.length >= 2 && hasNucleus(root)) {
      const a = root[root.length - 1], b = root[root.length - 2];
      if (a === b && isLetterC(a) && !'lsfz'.includes(a)) return [...split(root.slice(0, -1)), a + 'ing'];  // run·ning
      if ((a === 'l' || a === 'n') && isLetterC(b) && b !== a && b !== 'r') return [...split(root.slice(0, -1)), a + 'ing'];  // sib·ling, light·ning
      return [...split(root), 'ing'];                                                                         // teach·ing
    }
  }
  if (w.length > 5 && /[td]ed$/.test(w)) {
    const root = w.slice(0, -2);
    if (hasNucleus(root)) {
      const a = root[root.length - 1];
      if (root[root.length - 2] === a) return [...split(root.slice(0, -1)), a + 'ed'];                     // spot·ted
      return [...split(root), 'ed'];                                                                        // want·ed, ex·cit·ed
    }
  }
  if (w.length > 3 && w.endsWith('ly')) {
    const root = w.slice(0, -2);
    if (root.length >= 4 && root.endsWith('b') && hasNucleus(root.slice(0, -1))) return [...split(root.slice(0, -1)), 'bly'];   // prob·a·bly
    if (root.length >= 4 && root.endsWith('mp')) return [...split(root.slice(0, -1)), 'ply'];                                   // sim·ply
    if (root.length >= 2 && hasNucleus(root)) return [...split(root), 'ly'];                                 // real·ly, sil·ly
  }
  for (const suf of ['ful', 'ness', 'ment', 'less']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const root = w.slice(0, -suf.length);
      if (root.length >= 3 && hasNucleus(root)) return [...split(root), suf];
    }
  }
  return core(w);
}

// one word (may carry capitals, apostrophes) -> syllables with the original letters
function wordSyllables(word) {
  const raw = String(word);
  const letters = [];
  for (let i = 0; i < raw.length; i++) if (/[a-z]/i.test(raw[i])) letters.push(i);
  if (!letters.length) return raw ? [raw] : [];
  const low = letters.map(i => raw[i].toLowerCase()).join('');
  const parts = split(low);
  const out = [];
  let k = 0, start = 0;
  for (let p = 0; p < parts.length; p++) {
    k += parts[p].length;
    const end = p === parts.length - 1 ? raw.length : letters[k];
    out.push(raw.slice(start, end));
    start = end;
  }
  return out;
}

export function syllableWords(text) {
  return String(text ?? '').trim().split(/[\s-]+/).filter(Boolean).map(wordSyllables);
}
export function syllables(word) {
  return syllableWords(word).flat();
}

// ---------------------------------------------------------------- spelling hints

const norm = s => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// the sentence for each kind of slip; {ex} becomes two example words that are not the word she is spelling
const HINTS = {
  ck: { rule: 'ck', text: '前面的元音读短音，/k/ 要写成 ck，像 {ex}。', ex: ['pack', 'check', 'snack', 'jacket'] },
  kLong: { rule: 'ck', text: '前面是长音或两个元音字母，/k/ 只写一个 k，像 {ex}。', ex: ['shake', 'book', 'make', 'like'] },
  kCons: { rule: 'ck', text: '辅音后面的 /k/ 只写一个 k，像 {ex}。', ex: ['desk', 'think', 'milk'] },
  doubleMid: { rule: 'double', text: '短元音后面还有一个音节，中间的辅音要写两遍，像 {ex}。', ex: ['happen', 'silly', 'better', 'hobby'] },
  doubleEnd: { rule: 'double', text: '短元音后面，词尾的 l、s、f 常写两遍，像 {ex}。', ex: ['bell', 'kiss', 'class', 'off'] },
  magicE: { rule: 'magic-e', text: '元音读字母表里的音，词尾要加一个不发音的 e，像 {ex}。', ex: ['same', 'smile', 'note', 'page'] },
  ve: { rule: 'magic-e', text: '英语单词一般不用 v 结尾，后面要加一个 e，像 {ex}。', ex: ['have', 'give', 'five'] },
  tion: { rule: 'tion', text: '词尾读 /ʃn/ 的时候多半写 tion，像 {ex}。', ex: ['action', 'position', 'information'] },
  ai: { rule: 'ai-ay', text: '/eɪ/ 在词中间常写 ai，像 {ex}。', ex: ['paint', 'main', 'rain'] },
  ay: { rule: 'ai-ay', text: '/eɪ/ 在词尾常写 ay，像 {ex}。', ex: ['play', 'away', 'day'] },
  sh: { rule: 'th-sh-ch', text: '/ʃ/ 要写成 sh 两个字母，像 {ex}。', ex: ['shelf', 'fish', 'shop'] },
  ch: { rule: 'th-sh-ch', text: '/tʃ/ 要写成 ch 两个字母，像 {ex}。', ex: ['cheese', 'each', 'choose'] },
  th: { rule: 'th-sh-ch', text: '舌尖放在牙中间的音写 th 两个字母，像 {ex}。', ex: ['three', 'other', 'this'] },
  ee: { rule: 'ee-ea', text: '长长的 /iː/ 要写两个字母，常写 ee 或 ea，像 {ex}。', ex: ['need', 'leaf', 'screen'] },
  ou: { rule: 'ou-ow', text: '/aʊ/ 在词中间常写 ou，像 {ex}。', ex: ['loud', 'sound', 'around'] },
  ow: { rule: 'ou-ow', text: '/aʊ/ 在词尾和 n、l、er 前常写 ow，像 {ex}。', ex: ['now', 'down', 'power'] },
  owLong: { rule: 'ou-ow', text: '词尾的 /əʊ/ 常写 ow，像 {ex}。', ex: ['grow', 'follow', 'snow'] },
  oo: { rule: 'oo', text: '长长的 /uː/ 和短短的 /ʊ/ 常写 oo 两个字母，像 {ex}。', ex: ['pool', 'look', 'food'] },
  closed: { rule: 'closed', text: '这是闭音节，元音读短音，再听一遍是哪个短音，像 {ex}。', ex: ['hat', 'red', 'hit', 'hot', 'fun'] },
};
export const HINT_KINDS = Object.keys(HINTS);

// words where the letters do not follow the usual sound, so a slip there is memory work
const EA_OTHER = new Set(['ready', 'already', 'head', 'bread', 'dead', 'heavy', 'weather', 'breakfast', 'breath', 'health', 'healthy',
  'instead', 'sweater', 'pleasure', 'measure', 'meant', 'feather', 'leather', 'spread', 'great', 'break', 'steak', 'idea', 'area',
  'ocean', 'create', 'theatre']);
const OU_OTHER = new Set(['you', 'your', 'yours', 'group', 'soup', 'young', 'country', 'touch', 'touching', 'double', 'trouble',
  'cousin', 'would', 'could', 'should', 'shoulder', 'soul', 'though', 'through', 'thought', 'enough', 'tough', 'journey', 'four',
  'pour', 'course', 'tour', 'route', 'youth', 'southern', 'famous']);
const OW_LONG = new Set(['grow', 'know', 'snow', 'slow', 'show', 'follow', 'yellow', 'window', 'tomorrow', 'throw', 'below', 'low',
  'blow', 'bowl', 'own', 'known', 'grown', 'shown', 'borrow', 'narrow', 'elbow', 'pillow', 'arrow', 'shadow', 'rainbow', 'row']);
const SILENT_SHORT = new Set(['have', 'give', 'live', 'love', 'come', 'some', 'done', 'gone', 'one', 'none', 'move', 'lose', 'whose',
  'are', 'were', 'there', 'where', 'police', 'machine', 'office', 'promise', 'native', 'active']);
const CLOSED_ODD = new Set(['son', 'ton', 'won', 'front', 'month', 'put', 'pull', 'push', 'full', 'bull', 'was', 'what', 'want',
  'watch', 'wash', 'swan', 'of', 'mind', 'kind', 'find', 'child', 'wild', 'old', 'cold', 'hold', 'gold', 'told', 'most', 'post',
  'both', 'pint', 'climb', 'sign', 'high']);

// every way this word could hold a rule, as { kind, right, wrongs, at? }: replacing a wrong chunk in her spelling by
// the right one should bring it (nearly) back to the word
function patterns(w) {
  const out = [];
  const add = (kind, right, wrongs) => out.push({ kind, right, wrongs });
  const syl = syllables(w);
  if (w.includes('ck')) add('ck', 'ck', ['k', 'c', 'kk']);
  for (let p = 1; p < w.length; p++) {
    if (w[p] !== 'k' || w[p - 1] === 'c') continue;
    if (isV(w[p - 1])) add('kLong', 'k', ['ck']);                          // shake, book, speak
    else if (/[lnrs]/.test(w[p - 1])) add('kCons', 'k', ['ck']);           // milk, think, park, desk
  }
  const dbl = w.match(/([bcdfglmnprstvz])\1/g) || [];
  for (const d of new Set(dbl)) {
    const end = w.endsWith(d) && 'lsf'.includes(d[0]);
    add(end ? 'doubleEnd' : 'doubleMid', d, [d[0]]);
  }
  // a dropped final e: only exact repairs count (smil -> smile), and the long-vowel rule only for one-syllable words
  if (/ve$/.test(w)) out.push({ kind: 've', right: 'e', wrongs: [''], end: true });
  else if (!SILENT_SHORT.has(w) && syl.length === 1 && /(^|[^aeiou])[aeiou][bcdfgklmnprstz]e$/.test(w) && silentE(w) === w.length - 1) {
    out.push({ kind: 'magicE', right: 'e', wrongs: [''], end: true });
  }
  if (w.includes('tion')) add('tion', 'tion', ['shion', 'shon', 'shen', 'shun', 'sion', 'tian', 'tin', 'ton', 'son', 'sen', 'shn', 'tiom']);
  if (w.includes('ai')) add('ai', 'ai', ['ay', 'a', 'ei', 'ey', 'ia', 'e']);
  if (/ay/.test(w)) add('ay', 'ay', ['ai', 'a', 'ey', 'ei', 'e']);
  if (w.includes('sh')) add('sh', 'sh', ['s', 'ch', 'x']);
  if (/ch/.test(w) && !/(sch|chr|chem|ache|tch)/.test(w)) add('ch', 'ch', ['c', 'sh', 'h', 'q']);
  if (w.includes('th')) add('th', 'th', ['t', 's', 'z', 'd', 'f', 'h']);
  if (/ee(?!r)/.test(w)) add('ee', 'ee', ['e', 'i', 'ie', 'ei', 'ii']);
  if (/ea(?!r)/.test(w) && !EA_OTHER.has(w)) add('ee', 'ea', ['e', 'i', 'ie', 'ei', 'ii']);
  if (/ou(?!r|gh)/.test(w) && !OU_OTHER.has(w) && !/ous$/.test(w)) add('ou', 'ou', ['ow', 'au', 'aw', 'o', 'u', 'ao']);
  if (/ow/.test(w)) add(OW_LONG.has(w) || /ow$/.test(w) && w.length > 4 && !/(now|how|cow|wow|allow)$/.test(w) ? 'owLong' : 'ow', 'ow', ['ou', 'o', 'au', 'oa', 'aw']);
  if (/oo(?!r)/.test(w) && !/(blood|flood)/.test(w)) add('oo', 'oo', ['u', 'o', 'ou', 'ue', 'oe']);
  if (syl.length === 1 && !CLOSED_ODD.has(w)) {
    const t = tokens(w).filter(x => x.v);
    if (t.length === 1 && t[0].s.length === 1 && 'aeiou'.includes(t[0].s) && silentE(w) < 0 && w[t[0].i + 1] && w[t[0].i + 1] !== 'r' && !(t[0].s === 'a' && /^(w|qu)/.test(w.slice(t[0].i - 2 < 0 ? 0 : t[0].i - 1)))) {
      out.push({ kind: 'closed', right: t[0].s, wrongs: 'aeiou'.split('').filter(c => c !== t[0].s), at: t[0].i });
    }
  }
  return out;
}

// candidate repairs of her spelling: one wrong chunk replaced by the right one
function repairs(attempt, pat) {
  const out = [];
  for (const wr of pat.wrongs) {
    if (pat.end) { if (wr === '' && !attempt.endsWith(pat.right)) out.push(attempt + pat.right); continue; }
    if (pat.at !== undefined) {
      for (let j = Math.max(0, pat.at - 1); j <= pat.at + 1 && j < attempt.length; j++) if (attempt.startsWith(wr, j)) out.push(attempt.slice(0, j) + pat.right + attempt.slice(j + wr.length));
      continue;
    }
    for (let j = 0; j + wr.length <= attempt.length; j++) {
      if (!attempt.startsWith(wr, j)) continue;
      if (attempt.startsWith(pat.right, j)) continue;                       // already right here
      out.push(attempt.slice(0, j) + pat.right + attempt.slice(j + wr.length));
    }
  }
  return out;
}

function exampleText(kind, w) {
  const h = HINTS[kind];
  const ex = h.ex.filter(x => x !== w && !w.includes(x) && !x.includes(w)).slice(0, 2);
  return h.text.replace('{ex}', ex.join('、'));
}

export function missRule(word, wrongAttempt) {
  const w = norm(word), a = norm(wrongAttempt);
  if (!w || !a || w === a || w.length > 24 || a.length > 30) return null;
  if (!/^[a-z' -]+$/.test(w) || !/^[a-z' -]+$/.test(a)) return null;
  const d0 = lev(w, a);
  if (d0 > Math.max(2, Math.ceil(w.length / 2))) return null;              // too far off: a different word, not a slip
  let best = null;
  for (const p of patterns(w)) {
    for (const fixed of repairs(a, p)) {
      const d = lev(w, fixed);
      if (d >= d0 || d > (p.end ? 0 : 1)) continue;
      if (!best || d < best.d) best = { d, kind: p.kind };
    }
  }
  if (!best) return null;
  return { rule: HINTS[best.kind].rule, kind: best.kind, hint: exampleText(best.kind, w) };
}

export function hintFor(word, wrongAttempt) {
  const m = missRule(word, wrongAttempt);
  return m ? m.hint : null;
}

// ---------------------------------------------------------------- which rule this week

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function weekKey(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

const blank = () => ({ weeks: {}, done: {}, flagged: {} });
function cleanState(s) {
  const o = s && typeof s === 'object' ? s : {};
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return { ...o, weeks: { ...obj(o.weeks) }, done: { ...obj(o.done) }, flagged: { ...obj(o.flagged) } };
}

function available(rule, progress, opts) {
  const { unitOf, unitOrder } = opts;
  const cur = progress && progress.unit;
  if (!unitOf || !unitOrder || !cur) return true;
  const top = unitOrder(cur);
  if (typeof top !== 'number' || !Number.isFinite(top)) return true;
  return (rule.words || []).every(x => {
    const u = unitOf(x.w);
    if (!u) return true;                       // a primary-school word, or not in the book
    const o = unitOrder(u);
    return typeof o !== 'number' || !Number.isFinite(o) || o <= top;
  });
}

export function weekRule(now = new Date(), progress = {}, opts = {}) {
  const rules = opts.rules || phonicsRules();
  if (!rules.length) return null;
  const state = cleanState(opts.state || (progress && progress.phonics));
  const key = weekKey(now);
  const fixed = state.weeks[key] && rules.find(r => r.id === state.weeks[key]);
  if (fixed) return fixed;
  let pool = rules.filter(r => available(r, progress || {}, opts));
  if (opts.skipReview) pool = [...pool.filter(r => !r.review), ...pool.filter(r => r.review)];
  if (!pool.length) return null;
  const done = id => !!state.done[id];
  const review = !opts.skipReview && pool.find(r => r.review && !done(r.id));
  if (review) return review;
  const flagged = pool.filter(r => !done(r.id) && (+state.flagged[r.id] || 0) > 0)
    .sort((a, b) => (+state.flagged[b.id] || 0) - (+state.flagged[a.id] || 0) || pool.indexOf(a) - pool.indexOf(b));
  if (flagged.length) return flagged[0];
  const fresh = pool.find(r => !done(r.id));
  if (fresh) return fresh;
  // every rule done once: the one flagged most since, else the one practised longest ago, not last week's
  const lastWeek = Object.keys(state.weeks).filter(k => k < key).sort().pop();
  const last = lastWeek ? state.weeks[lastWeek] : '';
  const again = pool.filter(r => r.id !== last || pool.length === 1);
  const hot = again.filter(r => (+state.flagged[r.id] || 0) > 0).sort((a, b) => (+state.flagged[b.id] || 0) - (+state.flagged[a.id] || 0));
  if (hot.length) return hot[0];
  return again.slice().sort((a, b) => String((state.done[a.id] || {}).at || '').localeCompare(String((state.done[b.id] || {}).at || '')) || pool.indexOf(a) - pool.indexOf(b))[0];
}

export function weekInfo(now = new Date(), state = {}) {
  const s = cleanState(state);
  const key = weekKey(now);
  const keys = Object.keys(s.weeks).filter(k => k <= key);
  if (!s.weeks[key]) keys.push(key);
  return { key, n: [...new Set(keys)].sort().indexOf(key) + 1 };
}

// ---------------------------------------------------------------- state (kv 'phonics.state')

const stamp = now => ymd(now instanceof Date ? now : new Date(now || Date.now()));

export function assignWeek(state, now = new Date(), ruleId) {
  const s = cleanState(state);
  if (!ruleId) return s;
  s.weeks[weekKey(now)] = ruleId;
  const keys = Object.keys(s.weeks).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete s.weeks[k];
  s.updated = stamp(now);
  return s;
}

export function markDone(state, ruleId, now = new Date(), { right = 0, total = 0 } = {}) {
  const s = cleanState(state);
  if (!ruleId) return s;
  const prev = s.done[ruleId] || {};
  s.done[ruleId] = { at: stamp(now), right: +right || 0, total: +total || 0, n: (+prev.n || 0) + 1 };
  delete s.flagged[ruleId];
  if (!s.weeks[weekKey(now)]) s.weeks[weekKey(now)] = ruleId;
  s.updated = stamp(now);
  return s;
}

export function noteMiss(state, ruleId, now = new Date()) {
  const s = cleanState(state);
  if (!ruleId) return s;
  s.flagged[ruleId] = (+s.flagged[ruleId] || 0) + 1;
  s.updated = stamp(now);
  return s;
}

export function readState(kv) {
  try { return cleanState(kv && kv.peek ? kv.peek(PHONICS_KEY, null) : null); } catch (e) { return blank(); }
}

export async function recordMiss({ kv, word, wrong, now = new Date() } = {}) {
  const m = missRule(word, wrong);
  if (!m) return null;
  if (kv && kv.set) { try { await kv.set(PHONICS_KEY, noteMiss(readState(kv), m.rule, now)); } catch (e) { /* the hint still shows */ } }
  return m.hint;
}
