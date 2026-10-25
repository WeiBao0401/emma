// 错题本（第 5 个标签“错题”，Wei 10-25）：她拍一道或一页题（作业、卷子、练习册），老师认出来、讲清楚、收进错题本，
// 过 1、3、7 天出一道同考点的新题再考，做对两次算“攻克”。
// 一道题这样来：拍照 → 前端缩图（capture.js imageToJpeg；另缩一张小图当缩略图存）→ 视觉模型认成一道道题（recognizeQuestions：
// 题干、选项、她写的答案、老师自己做出来的正确答案、考点）→ 她看一眼、可以改、勾要收的题 → 存进 kv 'mistake:<id>'
// → 打开一道：老师讲（explainMistake：先结论、再为什么、一个只用她学过的词的例子、最后一道类似的新题；同一次回答顺手出 3 道
// 变式留着再考用，答案和题一起生成，模型自己再做一遍写进 check，程序再查一遍）→ 讲完还不懂，接着到问老师里问（askText）。
// 这个文件是纯逻辑（不碰 DOM），Node 里直接测。界面在 ui-mistakes.js，样式 css/mistakes.css（类名 mx-）。
// 负责：错题 agent（mistakes.js、ui-mistakes.js、css/mistakes.css、tests/mistakes.test.mjs）。
//
// ---------------------------------------------------------------- 导出
//   KV_PREFIX 'mistake:'；kvKey(id)；REVIEW_DAYS [1, 3, 7]；WIN_TARGET 2；THUMB_MAX_BYTES 200 KB；MAX_ITEMS 12（一张照片最多收几道）
//   OCR_KIND 'photo'（看图）、EXPLAIN_KIND 'chat'（讲题和出变式，算进问老师那一类）；STEP 'mistakes'；MODE 'mistake'
//   dayOf(x)、addDays(day, n)
//   bankFrom({ grammar, probes, tags }) -> Bank   grammar.json / probes.json / tags.json 收成一个题库（同考点的现成题，再考时用）
//     Bank = { questions: [Q], cards: { id: { id, title, unit, points } }, pointCard: { 'g:x': cardId }, tagCard: { tag: cardId },
//              tags: { tag: 中文 }, points: { 'g:x': 中文 } }
//   setBank(bank) / bank() / loadBank({ fetchJSON }) -> Bank   启动时读一次（读不到就是空题库，只用模型出的变式）
//   Q（一道选择题，再考、讲题里的新题都是这个形状）= { id, stem（含 ____ 的英文句子，或中文问题）, zh, options: [2-4], answer（options 之一）,
//     explain, source: 'model' | 'bank' | 'self', tags, points, card? }
//   normQ(raw, { source, id }) -> Q | null；checkQ(q) -> [问题]（空 = 过了：答案在选项里、选项不重复、模型自己做的 check 对得上）
//   topicOf(rec, bank) -> { key, label, card }   这道题归哪个考点（先语法卡，再误解标签，再模型写的考点，最后“其他”）
//   topics(bank) -> [{ key, label }]   确认页“考点”下拉的选项
//   OCR_SYSTEM、ocrUserText({ bank, units, unit })；normalizeItems(raw, bank) -> [Item]
//     Item = { no, kind: 'choice' | 'fill' | 'other', stem, options, her, answer, ok: true | false | null, zh, points, tags, topic, unit, unsure }
//     ok 由程序定：她的答案和正确答案都有时比一比（选择题认 A/B/C/D 和选项原文），模型说的只在比不了时用
//   recognizeQuestions({ dataUrl, settings, budget, fetchImpl, signal, sleep, bank, units, unit }) -> Promise<{ items, unclear, model, mock }>
//   EXPLAIN_SYSTEM、explainUserText(rec, { unit, bank })；normalizeExplain(raw, rec) -> Explain
//     Explain = { conclusion, why: [句], example: { en, zh } | null, practice: Q | null, variants: [Q], dropped（被程序拦下的几道）, at, model }
//   explainMistake({ rec, settings, budget, fetchImpl, signal, sleep, unit, bank }) -> Promise<{ explain, model, mock }>
//   makeRecord({ item, thumb, now, id, mock, source }) -> Record；newId(now)；normRecord(raw) -> Record | null
//   withExplain(rec, explain, now) -> Record（变式并进 variants）
//   loadAll(kv) -> [Record]（新的在前，移出错题本的不算）；loadRecord(kv, id)；saveRecord(kv, rec)；dropRecord(rec, now)
//   isDue(rec, now)、isMastered(rec)、dueLabel(rec, now) -> '今天再考' | '明天再考' | '10-28 再考' | '攻克了'
//   reviewQuestion(rec, bank, { now }) -> Q | null   再考出哪道：没用过的模型变式 → 题库里同误解标签的 → 同语法点的 → 讲题时那道新题
//   applyReview(rec, { qid, correct, now, counted }) -> Record   counted 为假（还没到日子她自己点了“再练一道”）只记下来，不动日程
//   groupRecords(list, bank, { by: 'topic' | 'unit' }) -> [{ key, label, list, open, mastered }]   没攻克的多的组在前
//   mistakeReviewItems(kv, now, { bank, max = 2 }) -> [ReviewItem]   给热身：今天到期的错题各出一道新题
//     ReviewItem = { type: 'mistake', id, item: 'mx:<id>:<qid>', qid, question: Q, label, step, due, mode: 'mistake' }
//   answerReview(kv, item, correct, now) -> Promise<Record | null>   热身里答完一道：读、applyReview、写回
//   summary(kv, now) -> { total, open, mastered, due }
//   askText(rec) -> { ask, send }   接着问老师：ctx.go('chat', { ask, send })
//   sameAnswer(a, b)、letterOf(i)、thumbOk(img) -> dataUrl | ''
//   mockItems()、mockExplain(rec)   模拟模式的假题（原创，只用她认识的词）
//
// ---------------------------------------------------------------- kv 'mistake:<id>'（新键，随备份导出）
//   Record = { v: 1, id, created, updated, source: 'photo' | 'mock', mock?, thumb: 'data:image/jpeg;base64,…' | '',
//              q: { kind, stem, options, her, answer, ok, zh, unsure }, points: ['g:x'], tags: [误解标签], topic（模型写的考点中文）, unit,
//              explain: Explain | null, variants: [Q],
//              base（日程从哪天算，'YYYY-MM-DD'）, step（0 等第 1 天，1 等第 3 天，2 起等第 7 天以后每 7 天）, due（'YYYY-MM-DD' | null）,
//              wins（再考做对几次）, misses, mastered（'YYYY-MM-DD' | ''）, dropped（'YYYY-MM-DD' | ''，移出错题本，不删）,
//              reviews: [{ day, at, qid, ok, step, counted }] }
//   id = 'm<YYYYMMDD-HHMMSS>-<n>'；照片原图不存，只存一张小缩略图（≤ 200 KB，一般 30 KB 左右）
//
// ---------------------------------------------------------------- 日程（做对两次算攻克）
//   收进来的那天是 base：第 1、3、7 天各考一道新题（晚做了就从做的那天往后排，至少隔 1 天），7 天以后每 7 天一次直到攻克。
//   做对：wins + 1，wins 到 2 就攻克（mastered = 那天，due = null）；做错：misses + 1，明天再考一道，step 不往前走。
//
// ---------------------------------------------------------------- 事件（只加不改，CONTRACTS 第 6 节）
//   answer { item: 'mx:<id>:<qid>', mode: 'mistake', step: 'mistakes' | 'warmup', kind: 'review' | 'practice' | 'explain',
//            choice, correct, first_try, ms, hint_level: 0, misconception（选错时是这道错题的第一个误解标签）, point, card, mistake: id }
//   ask    { qid: 'mistake', who: 'emma', step: 'mistakes', item: 'mx:<id>', about: 'mistake:<考点 key>', answer: 'saved' | 'skip' }
// 依赖：ai.js（AIError）、textread.js（callJSON、visionRoute、textRoute：和课文陪读同一条看图 / 写内容的线路）、capture.js（unitIdOf）、
// words.js（slugify，拍听写本对词用）。
import { AIError } from './ai.js';
import { callJSON, visionRoute, textRoute } from './textread.js';
import { unitIdOf } from './capture.js';
import { slugify, localIso } from './words.js';

export const KV_PREFIX = 'mistake:';
export const kvKey = id => KV_PREFIX + String(id || '');
export const REVIEW_DAYS = [1, 3, 7];
export const LATER_DAYS = 7;
export const WIN_TARGET = 2;
export const THUMB_MAX_BYTES = 200 * 1024;
export const MAX_ITEMS = 12;
export const OCR_KIND = 'photo';
export const EXPLAIN_KIND = 'chat';
export const STEP = 'mistakes';
export const MODE = 'mistake';
export const OCR_TIMEOUT_MS = 90000;
export const EXPLAIN_TIMEOUT_MS = 120000;

// ---------------------------------------------------------------- small helpers

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const ONE = s => String(s ?? '').replace(/[\u0000-\u001f​-‍⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();
const EN = s => ONE(s).replace(/[’‘`]/g, "'");
const arr = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : new Date(x));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return dayOf(x);
}
const isoLocal = x => {
  const d = toDate(x);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};
const hash = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
export const letterOf = i => 'ABCD'[i] || '';
const BLANK = '____';
// answers compare loosely: case, end punctuation, curly quotes, extra spaces, "A." in front
const norm = s => EN(s).toLowerCase().replace(/^[（(]?[a-d][)）.、:：]\s*/i, '').replace(/[.。!！?？,，;；\s]+$/g, '').replace(/\s+/g, ' ').trim();
export function sameAnswer(a, b) {
  const x = norm(a), y = norm(b);
  return !!x && x === y;
}
// "B" / "b" / "(B)" -> index into options; an option's own text also counts
function optionIndex(v, options) {
  const s = ONE(v);
  if (!s) return -1;
  const m = s.match(/^[（(]?([A-Da-d])[)）.、:：]?$/);
  if (m) { const i = 'abcd'.indexOf(m[1].toLowerCase()); return i < options.length ? i : -1; }
  return options.findIndex(o => sameAnswer(o, s));
}
const stripLetter = s => ONE(s).replace(/^[（(]?[A-Da-d][)）.、:：]\s*/, '');

// ---------------------------------------------------------------- the bank: questions already written for the same point

let cachedBank = null;
export function setBank(b) { cachedBank = b || null; return cachedBank; }
export function bank() { return cachedBank; }
export async function loadBank({ fetchJSON } = {}) {
  const get = async f => { try { return await fetchJSON(f); } catch (e) { return null; } };
  const [grammar, probes, tags] = await Promise.all([get('curriculum/grammar.json'), get('curriculum/probes.json'), get('curriculum/tags.json')]);
  return setBank(bankFrom({ grammar, probes, tags }));
}

function shuffled(list, seed) {
  const out = list.slice();
  let x = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; const j = x % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function bankQ(raw, { id, card, points, unit }) {
  const r = obj(raw);
  const wrong = obj(r.wrong);
  const answer = EN(r.answer);
  if (!answer) return null;
  const others = Object.keys(wrong).map(EN).filter(w => w && !sameAnswer(w, answer));
  if (!others.length) return null;
  const options = shuffled([answer, ...others.slice(0, 3)], id);
  let stem = '';
  if (r.kind === 'pick') stem = ONE(r.ask);
  else stem = EN(r.stem) + (r.cue ? `（${ONE(r.cue)}）` : '');
  if (!stem) return null;
  const hints = arr(r.hints).map(ONE).filter(Boolean);
  return {
    id, stem, zh: ONE(r.zh), options, answer, explain: ONE(r.explain) || hints[hints.length - 1] || '',
    source: 'bank', tags: [...new Set(Object.values(wrong).map(String))], points: arr(points), card: card || '', unit: unit || null,
  };
}

export function bankFrom({ grammar = null, probes = null, tags = null } = {}) {
  const b = { questions: [], cards: {}, pointCard: {}, tagCard: {}, tags: {}, points: {} };
  for (const [k, v] of Object.entries(obj(obj(tags).tags))) b.tags[k] = ONE(obj(v).zh) || k;
  const names = obj(obj(grammar).names);
  for (const c of arr(obj(grammar).cards)) {
    if (!c || !c.id) continue;
    b.cards[c.id] = { id: c.id, title: ONE(c.title), unit: c.unit || null, points: arr(c.points) };
    for (const p of arr(c.points)) { if (!b.pointCard[p]) b.pointCard[p] = c.id; if (!b.points[p]) b.points[p] = ONE(names[p]) || ONE(c.title); }
    const fam = obj(c.families);
    const qs = [...arr(c.questions), ...arr(c.spares)];
    for (const q of qs) {
      if (!q || !q.id) continue;
      const point = (fam[q.family] && fam[q.family].point) || arr(c.points)[0];
      const one = bankQ(q, { id: `g:${c.id}:${q.id}`, card: c.id, points: [point], unit: c.unit });
      if (one) b.questions.push(one);
      if (q.variant) { const v = bankQ(q.variant, { id: `g:${c.id}:${q.id}v`, card: c.id, points: [point], unit: c.unit }); if (v) b.questions.push(v); }
      for (const t of Object.values(obj(q.wrong))) if (b.tags[t] !== undefined && !b.tagCard[t] && point === arr(c.points)[0]) b.tagCard[t] = c.id;
    }
    for (const q of qs) for (const t of Object.values(obj(q && q.wrong))) if (!b.tagCard[t]) b.tagCard[t] = c.id;
  }
  const blocks = {};
  for (const bl of arr(obj(probes).blocks)) if (bl && bl.id) blocks[bl.id] = bl;
  for (const p of arr(obj(probes).probes)) {
    const bl = blocks[p && p.block];
    if (!p || !p.id || !bl) continue;
    const one = bankQ(p, { id: `pb:${p.id}`, card: bl.card || '', points: [bl.point], unit: null });
    if (one) b.questions.push(one);
    if (bl.point && !b.points[bl.point]) b.points[bl.point] = ONE(bl.name);
    if (bl.point && bl.card && !b.pointCard[bl.point]) b.pointCard[bl.point] = bl.card;
  }
  return b;
}
const emptyBank = () => bankFrom({});

// ---------------------------------------------------------------- one choice question (the shape every review uses)

export function normQ(raw, { source = 'model', id = '' } = {}) {
  const r = obj(raw);
  const options = [];
  for (const o of arr(r.options)) { const s = stripLetter(EN(o)); if (s && !options.some(x => sameAnswer(x, s))) options.push(s); }
  let answer = EN(r.answer);
  const i = optionIndex(answer, options);
  if (i >= 0) answer = options[i];
  const stem = EN(r.stem || r.ask || r.question);
  if (!stem || options.length < 2) return null;
  const q = {
    id: ONE(r.id) || id, stem, zh: ONE(r.zh), options: options.slice(0, 4), answer, explain: ONE(r.explain || r.why),
    source, tags: arr(r.tags).map(String), points: arr(r.points || r.point).map(String).filter(Boolean), card: ONE(r.card),
  };
  if (r.check !== undefined) q.check = EN(r.check);
  return q;
}

export function checkQ(q) {
  const out = [];
  if (!q) return ['没有题'];
  if (!q.stem) out.push('没有题干');
  if (q.options.length < 2 || q.options.length > 4) out.push('选项要 2 到 4 个');
  if (!q.options.some(o => sameAnswer(o, q.answer))) out.push('答案不在选项里');
  if (new Set(q.options.map(norm)).size !== q.options.length) out.push('选项重复');
  if (q.check !== undefined && q.check !== '') {
    const ci = optionIndex(q.check, q.options);
    if (!(ci >= 0 ? sameAnswer(q.options[ci], q.answer) : sameAnswer(q.check, q.answer))) out.push('模型自己再做一遍，答案对不上');
  }
  if (/[_]{2,}/.test(q.stem) && (q.stem.match(/_{2,}/g) || []).length > 1) out.push('空不止一个');
  return out;
}

// ---------------------------------------------------------------- 考点

export function topicOf(rec, b = cachedBank) {
  const B = b || emptyBank();
  const r = obj(rec);
  for (const p of arr(r.points)) {
    const card = B.pointCard[p];
    if (card && B.cards[card]) return { key: 'card:' + card, label: B.cards[card].title, card };
  }
  for (const t of arr(r.tags)) {
    const card = B.tagCard[t];
    if (card && B.cards[card]) return { key: 'card:' + card, label: B.cards[card].title, card };
    if (B.tags[t]) return { key: 'tag:' + t, label: B.tags[t], card: '' };
  }
  for (const p of arr(r.points)) if (B.points[p]) return { key: 'point:' + p, label: B.points[p], card: '' };
  const t = ONE(r.topic);
  if (t) return { key: 'topic:' + t, label: t, card: '' };
  return { key: 'other', label: '其他', card: '' };
}

export function topics(b = cachedBank) {
  const B = b || emptyBank();
  const out = Object.values(B.cards).map(c => ({ key: 'card:' + c.id, label: c.title, point: c.points[0] || '' }));
  out.push({ key: 'word', label: '单词和词义', point: '' });
  out.push({ key: 'other', label: '其他', point: '' });
  return out;
}

// ---------------------------------------------------------------- 1. the photo -> questions

export const OCR_SYSTEM = `你帮一个初一学生（北京，外研版七年级上册，英语基础弱）看一张英语作业、卷子或练习册的照片。照片里可能有一道题，也可能有一页题。
做三件事：
1. 把每道题原样抄下来：题号、题干、选项（选择题）。看不清的字写 [?]，不要猜。
2. 认出她自己写的答案（手写的字母、填的词、圈的选项）。认不出就写 ""，不要猜。
3. 你自己认真做一遍每道题，写出正确答案；做完再检查一遍。拿不准就把 unsure 写 true。
只回一个 JSON 对象，形状固定：
{
  "items": [
    {
      "no": "3",
      "type": "choice" | "fill" | "other",
      "stem": "题干原文，空用 ____ 表示",
      "options": ["选项原文，不带 A. B.", "..."],
      "her": "她写的答案：选择题写字母 A/B/C/D，填空写她填的词；认不出写 \\"\\"",
      "answer": "正确答案：选择题写字母，填空写词",
      "ok": true | false | null,
      "zh": "这道题的意思，一句简单中文",
      "point": "考的语法点，从给你的清单里选一个，没有合适的写 \\"\\"",
      "tags": ["她如果错了，错在哪类误解，从给你的清单里选 0 到 2 个"],
      "topic": "考点，几个字的中文，比如“be 动词”“名词复数”“单词词义”",
      "unit": "第几单元，看得出来就写 U1、U2，看不出写 null",
      "unsure": false
    }
  ],
  "unclear": "整张照片哪里看不清，一句话；都清楚写 \\"\\""
}
规则：
- 只收英语题。一页最多 12 道，按题号顺序。阅读理解只收题目，不抄文章。
- 写作、翻译整句这类没有唯一答案的题，type 写 "other"，answer 写一个参考答案。
- 正确答案以你自己做的为准，不要照抄她的答案，也不要照抄照片上别人写的批改。`;

export function ocrUserText({ bank: b = cachedBank, units = [], unit = '' } = {}) {
  const B = b || emptyBank();
  const points = Object.entries(B.points).map(([k, v]) => `${k}（${v}）`);
  const tags = Object.entries(B.tags).map(([k, v]) => `${k}（${v}）`);
  const u = arr(units).map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  return [
    unit ? `她现在学到 ${unit}。` : '',
    u.length ? `课本单元：${u.join('、')}。` : '',
    points.length ? `语法点清单：${points.join('；')}。` : '',
    tags.length ? `误解标签清单：${tags.join('；')}。` : '',
    '看照片，按上面的格式回 JSON。',
  ].filter(Boolean).join('\n');
}

export function normalizeItems(raw, b = cachedBank) {
  const B = b || emptyBank();
  const list = arr(obj(raw).items || (Array.isArray(raw) ? raw : []));
  const out = [];
  for (const it of list) {
    if (out.length >= MAX_ITEMS) break;
    const r = obj(it);
    const options = arr(r.options).map(o => stripLetter(EN(o))).filter(Boolean).slice(0, 6);
    let kind = ['choice', 'fill', 'other'].includes(r.type) ? r.type : options.length >= 2 ? 'choice' : 'fill';
    if (kind === 'choice' && options.length < 2) kind = 'fill';
    const stem = EN(r.stem);
    if (!stem && !options.length) continue;
    const pick = v => { if (kind !== 'choice') return EN(v); const i = optionIndex(v, options); return i >= 0 ? options[i] : EN(v); };
    const her = pick(r.her);
    const answer = pick(r.answer);
    let ok = typeof r.ok === 'boolean' ? r.ok : null;
    if (her && answer && kind !== 'other') ok = sameAnswer(her, answer);
    if (!her) ok = typeof r.ok === 'boolean' ? r.ok : null;
    const point = ONE(r.point);
    const points = point && (B.points[point] || B.pointCard[point]) ? [point] : [];
    const tags = arr(r.tags).map(t => ONE(t)).filter(t => B.tags[t] !== undefined).slice(0, 2);
    out.push({
      no: ONE(r.no) || String(out.length + 1), kind, stem, options: kind === 'choice' ? options : [], her, answer, ok,
      zh: ONE(r.zh), points, tags, topic: ONE(r.topic), unit: unitIdOf(r.unit), unsure: r.unsure === true || /\[\?\]/.test(stem),
    });
  }
  return out;
}

export async function recognizeQuestions({ dataUrl, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs,
  bank: b = cachedBank, units = [], unit = '' } = {}) {
  const s = settings || {};
  if (s.mock) {
    await sleep(600);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上：网络不通（模拟断网）。', 'network');
    return { items: normalizeItems(mockItems(), b), unclear: '', model: 'mock', mock: true };
  }
  if (!dataUrl || !/^data:image\/(jpeg|png);base64,/.test(dataUrl)) throw new AIError('照片还没准备好，再拍一次。', 'empty');
  const route = visionRoute(s);
  const r = await callJSON({ route, system: OCR_SYSTEM, user: ocrUserText({ bank: b, units, unit }), image: dataUrl, kind: OCR_KIND,
    budget, fetchImpl, signal, sleep, timeoutMs: OCR_TIMEOUT_MS });
  const items = normalizeItems(r.obj, b);
  if (!items.length) throw new AIError('这张照片里没认出英语题。拍正、拍清楚，再试一次。', 'empty');
  return { items, unclear: ONE(r.obj.unclear), model: r.model, mock: false };
}

// ---------------------------------------------------------------- 2. the teacher explains it (and writes the review questions)

export const EXPLAIN_SYSTEM = `你是一个初一女生（北京，外研版七年级上册，英语基础弱）的私人英语老师。她拍了一道题，你给她讲清楚。
讲法固定四步：
1. conclusion：先一句话说结论（这道题选什么 / 填什么，为什么一句话说透）。
2. why：再讲为什么，1 到 3 句简单中文，一次只讲一个点；她选错了，先说她为什么会那样想，再说对的想法。
3. example：举一个例句，只用她学过的词（小学词和七上 Starter 到她现在这个单元的词），附中文。
4. practice：出一道类似的新题让她做，考同一个点，换一个句子，四选一，只有一个空。
另外再出 3 道 variants，也是同一个点的新题（隔几天再考她用），句子都不一样，也不要和原题、practice 一样。
每道新题：先自己做一遍，把你做出来的答案写进 check；answer 必须是 options 里的一个，而且只有它对。
只回一个 JSON 对象：
{
  "conclusion": "一句话",
  "why": ["一句", "一句"],
  "example": {"en": "英文例句", "zh": "中文"},
  "practice": {"stem": "含 ____ 的英文句子", "zh": "这句的中文", "options": ["...", "...", "...", "..."], "answer": "options 之一", "explain": "为什么，一句", "check": "你自己做出来的答案"},
  "variants": [同上的 3 道]
}
规则：中文用弯引号“ ”，不用破折号；不提分数、不说“很简单”；拿不准就在 conclusion 里说“这题老师也拿不准”。`;

export function explainUserText(rec, { unit = '', bank: b = cachedBank } = {}) {
  const r = obj(rec), q = obj(r.q);
  const t = topicOf(r, b);
  const lines = [
    unit ? `她现在学到 ${unit}。` : '',
    `题目：${q.stem || ''}`,
    q.options && q.options.length ? `选项：${q.options.map((o, i) => `${letterOf(i)}. ${o}`).join('  ')}` : '',
    q.her ? `她的答案：${q.her}` : '她没写答案（或认不出）。',
    q.answer ? `正确答案：${q.answer}` : '',
    q.zh ? `题意：${q.zh}` : '',
    `考点：${t.label}${arr(r.points).length ? `（${arr(r.points).join('、')}）` : ''}`,
    arr(r.tags).length ? `她可能的误解：${arr(r.tags).map(x => (b && b.tags[x]) || x).join('、')}` : '',
    q.ok === true ? '她这道做对了，但想再弄明白。' : '',
    '按格式回 JSON。',
  ];
  return lines.filter(Boolean).join('\n');
}

export function normalizeExplain(raw, rec = null) {
  const r = obj(raw);
  const base = obj(obj(rec).q);
  const dropped = [];
  const seen = new Set(base.stem ? [norm(base.stem)] : []);
  const take = (x, id) => {
    const q = normQ(x, { source: 'model', id });
    if (!q) { dropped.push({ id, what: '形状不对' }); return null; }
    const p = checkQ(q);
    if (seen.has(norm(q.stem))) p.push('和别的题一样');
    if (p.length) { dropped.push({ id, what: p.join('；') }); return null; }
    seen.add(norm(q.stem));
    q.tags = arr(obj(rec).tags).slice(); q.points = arr(obj(rec).points).slice();
    delete q.check;
    return q;
  };
  const ex = obj(r.example);
  const out = {
    conclusion: ONE(r.conclusion),
    why: arr(r.why).map(ONE).filter(Boolean).slice(0, 4),
    example: EN(ex.en) ? { en: EN(ex.en), zh: ONE(ex.zh) } : null,
    practice: r.practice ? take(r.practice, 'p1') : null,
    variants: arr(r.variants).slice(0, 5).map((v, i) => take(v, 'v' + (i + 1))).filter(Boolean),
    dropped,
  };
  if (typeof r.why === 'string' && !out.why.length) out.why = [ONE(r.why)];
  return out;
}

export async function explainMistake({ rec, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs, unit = '', bank: b = cachedBank } = {}) {
  const s = settings || {};
  if (s.mock) {
    await sleep(700);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上：网络不通（模拟断网）。', 'network');
    return { explain: { ...normalizeExplain(mockExplain(rec), rec), model: 'mock' }, model: 'mock', mock: true };
  }
  const route = textRoute(s);
  const r = await callJSON({ route, system: EXPLAIN_SYSTEM, user: explainUserText(rec, { unit, bank: b }), kind: EXPLAIN_KIND,
    budget, fetchImpl, signal, sleep, timeoutMs: EXPLAIN_TIMEOUT_MS });
  const explain = normalizeExplain(r.obj, rec);
  if (!explain.conclusion) throw new AIError('老师的讲解不完整，再试一次。', 'incomplete');
  return { explain: { ...explain, model: r.model }, model: r.model, mock: false };
}

// ---------------------------------------------------------------- records

let idN = 0;
export function newId(now = new Date()) {
  const d = toDate(now);
  idN = (idN + 1) % 1000;
  return `m${dayOf(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${idN}`;
}

export function thumbOk(img) {
  const url = typeof img === 'string' ? img : img && img.dataUrl;
  if (!url || !/^data:image\/jpeg;base64,/.test(url)) return '';
  const bytes = Math.round((url.length - url.indexOf(',') - 1) * 3 / 4);
  return bytes <= THUMB_MAX_BYTES ? url : '';
}

export function makeRecord({ item, thumb = '', now = new Date(), id = '', mock = false, source = 'photo' } = {}) {
  const it = obj(item);
  const day = dayOf(now);
  return {
    v: 1, id: id || newId(now), created: isoLocal(now), updated: isoLocal(now), source: mock ? 'mock' : source, mock: !!mock || undefined,
    thumb: thumbOk(thumb),
    q: { kind: it.kind || 'fill', stem: EN(it.stem), options: arr(it.options).map(EN), her: EN(it.her), answer: EN(it.answer),
      ok: typeof it.ok === 'boolean' ? it.ok : null, zh: ONE(it.zh), unsure: !!it.unsure, no: ONE(it.no) },
    points: arr(it.points).map(String), tags: arr(it.tags).map(String), topic: ONE(it.topic), unit: it.unit || null,
    explain: null, variants: [],
    base: day, step: 0, due: addDays(day, REVIEW_DAYS[0]), wins: 0, misses: 0, mastered: '', dropped: '', reviews: [],
  };
}

export function normRecord(raw) {
  const r = obj(raw);
  if (!r.id || !r.q || typeof r.q !== 'object') return null;
  const q = obj(r.q);
  const day = String(r.base || r.created || '').slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return null;
  const qs = list => arr(list).map(x => normQ(x, { source: (x && x.source) || 'model', id: x && x.id })).filter(Boolean);
  const ex = r.explain && typeof r.explain === 'object' ? {
    conclusion: ONE(r.explain.conclusion), why: arr(r.explain.why).map(ONE).filter(Boolean),
    example: r.explain.example && r.explain.example.en ? { en: EN(r.explain.example.en), zh: ONE(r.explain.example.zh) } : null,
    practice: r.explain.practice ? normQ(r.explain.practice, { source: 'model', id: 'p1' }) : null,
    variants: qs(r.explain.variants), dropped: arr(r.explain.dropped), at: r.explain.at || '', model: ONE(r.explain.model),
  } : null;
  return {
    v: 1, id: String(r.id), created: String(r.created || day), updated: String(r.updated || r.created || day),
    source: r.source === 'mock' ? 'mock' : 'photo', mock: r.mock ? true : undefined, thumb: thumbOk(r.thumb),
    q: { kind: ['choice', 'fill', 'other'].includes(q.kind) ? q.kind : 'fill', stem: EN(q.stem), options: arr(q.options).map(EN), her: EN(q.her),
      answer: EN(q.answer), ok: typeof q.ok === 'boolean' ? q.ok : null, zh: ONE(q.zh), unsure: !!q.unsure, no: ONE(q.no) },
    points: arr(r.points).map(String), tags: arr(r.tags).map(String), topic: ONE(r.topic), unit: r.unit || null,
    explain: ex, variants: qs(r.variants),
    base: day, step: Math.max(0, Number(r.step) || 0), due: r.due === null ? null : String(r.due || addDays(day, REVIEW_DAYS[0])),
    wins: Math.max(0, Number(r.wins) || 0), misses: Math.max(0, Number(r.misses) || 0),
    mastered: String(r.mastered || ''), dropped: String(r.dropped || ''),
    reviews: arr(r.reviews).filter(x => x && x.day).map(x => ({ day: String(x.day), at: String(x.at || ''), qid: String(x.qid || ''), ok: !!x.ok, step: Number(x.step) || 0, counted: x.counted !== false })),
  };
}

export function withExplain(rec, explain, now = new Date()) {
  const r = normRecord(rec);
  if (!r || !explain) return r;
  const ex = { ...explain, at: isoLocal(now) };
  const have = new Set(r.variants.map(v => norm(v.stem)));
  const variants = r.variants.slice();
  let n = variants.length;
  for (const v of arr(explain.variants)) if (!have.has(norm(v.stem))) { have.add(norm(v.stem)); variants.push({ ...v, id: 'v' + (++n) }); }
  return { ...r, explain: ex, variants, updated: isoLocal(now) };
}

export function dropRecord(rec, now = new Date()) { return { ...rec, dropped: dayOf(now), updated: isoLocal(now) }; }

export function loadRecord(kv, id) {
  try { return normRecord(kv.peek(kvKey(id), null)); } catch (e) { return null; }
}
export function loadAll(kv, { dropped = false } = {}) {
  let keys = [];
  try { keys = kv.keys(KV_PREFIX); } catch (e) { keys = []; }
  const out = [];
  for (const k of keys) {
    let r = null;
    try { r = normRecord(kv.peek(k, null)); } catch (e) { r = null; }
    if (r && (dropped || !r.dropped)) out.push(r);
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
export async function saveRecord(kv, rec) {
  const r = normRecord(rec);
  if (!r) throw new Error('bad mistake record');
  const out = { ...r };
  if (!out.mock) delete out.mock;
  await kv.set(kvKey(r.id), out);
  return out;
}

// ---------------------------------------------------------------- schedule

export const isMastered = rec => !!(rec && rec.mastered);
export function isDue(rec, now = new Date()) {
  if (!rec || rec.mastered || rec.dropped || !rec.due) return false;
  return rec.due <= dayOf(now);
}
export function dueLabel(rec, now = new Date()) {
  if (!rec) return '';
  if (rec.mastered) return '攻克了';
  if (!rec.due) return '';
  const today = dayOf(now);
  if (rec.due <= today) return '今天再考';
  if (rec.due === addDays(today, 1)) return '明天再考';
  return `${rec.due.slice(5)} 再考`;
}

function nextDue(rec, step, day) {
  const gap = step < REVIEW_DAYS.length ? REVIEW_DAYS[step] : REVIEW_DAYS[REVIEW_DAYS.length - 1] + LATER_DAYS * (step - REVIEW_DAYS.length + 1);
  const planned = addDays(rec.base, gap);
  const soonest = addDays(day, 1);
  return planned > soonest ? planned : soonest;
}

export function applyReview(rec, { qid = '', correct = false, now = new Date(), counted = true } = {}) {
  const r = normRecord(rec);
  if (!r) return r;
  const day = dayOf(now);
  const take = counted && !r.mastered;
  const reviews = [...r.reviews, { day, at: isoLocal(now), qid: String(qid), ok: !!correct, step: r.step, counted: take }].slice(-30);
  const out = { ...r, reviews, updated: isoLocal(now) };
  if (!take) return out;
  if (correct) {
    out.wins = r.wins + 1;
    if (out.wins >= WIN_TARGET) { out.mastered = day; out.due = null; return out; }
    out.step = r.step + 1;
    out.due = nextDue(r, out.step, day);
  } else {
    out.misses = r.misses + 1;
    out.due = addDays(day, 1);
  }
  return out;
}

// ---------------------------------------------------------------- which question to ask next time

export function reviewQuestion(rec, b = cachedBank, { now = new Date() } = {}) {
  const r = normRecord(rec);
  if (!r) return null;
  const B = b || emptyBank();
  const used = new Set(r.reviews.map(x => x.qid));
  const own = norm(r.q.stem);
  const fresh = q => q && !used.has(q.id) && norm(q.stem) !== own;
  const v = r.variants.find(fresh);
  if (v) return v;
  const seed = r.id + ':' + r.reviews.length;
  const pickFrom = list => { const l = list.filter(fresh); return l.length ? l[hash(seed) % l.length] : null; };
  if (r.tags.length) { const q = pickFrom(B.questions.filter(q => q.tags.some(t => r.tags.includes(t)))); if (q) return q; }
  if (r.points.length) { const q = pickFrom(B.questions.filter(q => q.points.some(p => r.points.includes(p)))); if (q) return q; }
  const t = topicOf(r, B);
  if (t.card) { const q = pickFrom(B.questions.filter(q => q.card === t.card)); if (q) return q; }
  const p = r.explain && r.explain.practice;
  if (p && fresh({ ...p, id: 'p1' })) return { ...p, id: 'p1' };
  // nothing new: the original question itself, if it is a choice question we can check
  if (r.q.kind === 'choice' && r.q.options.length >= 2 && r.q.options.some(o => sameAnswer(o, r.q.answer)) && !used.has('self')) {
    return { id: 'self', stem: r.q.stem, zh: r.q.zh, options: r.q.options.slice(0, 4), answer: r.q.answer, explain: r.explain ? r.explain.conclusion : '', source: 'self', tags: r.tags, points: r.points };
  }
  return null;
}

// ---------------------------------------------------------------- the book

export function groupRecords(list, b = cachedBank, { by = 'topic' } = {}) {
  const groups = new Map();
  for (const r of arr(list)) {
    if (!r || r.dropped) continue;
    let key, label;
    if (by === 'unit') { key = r.unit || 'none'; label = r.unit ? (r.unit === 'S' ? 'Starter' : `Unit ${String(r.unit).replace(/^U/, '')}`) : '没写单元'; }
    else { const t = topicOf(r, b); key = t.key; label = t.label; }
    if (!groups.has(key)) groups.set(key, { key, label, list: [], open: 0, mastered: 0 });
    const g = groups.get(key);
    g.list.push(r);
    if (r.mastered) g.mastered++; else g.open++;
  }
  const out = [...groups.values()];
  for (const g of out) g.list.sort((a, b2) => (!!a.mastered - !!b2.mastered) || String(b2.created).localeCompare(String(a.created)));
  if (by === 'unit') return out.sort((a, b2) => (a.key === 'none') - (b2.key === 'none') || String(a.key).localeCompare(String(b2.key), 'en', { numeric: true }));
  return out.sort((a, b2) => b2.open - a.open || b2.list.length - a.list.length || a.label.localeCompare(b2.label));
}

export function summary(kv, now = new Date()) {
  const list = loadAll(kv);
  return { total: list.length, open: list.filter(r => !r.mastered).length, mastered: list.filter(r => r.mastered).length, due: list.filter(r => isDue(r, now)).length };
}

export function mistakeReviewItems(kv, now = new Date(), { bank: b = cachedBank, max = 2 } = {}) {
  const due = loadAll(kv).filter(r => isDue(r, now)).sort((a, b2) => String(a.due).localeCompare(String(b2.due)) || String(a.created).localeCompare(String(b2.created)));
  const out = [];
  for (const r of due) {
    if (out.length >= max) break;
    const q = reviewQuestion(r, b, { now });
    if (!q) continue;
    out.push({ type: 'mistake', id: r.id, item: `mx:${r.id}:${q.id}`, qid: q.id, question: q, label: topicOf(r, b).label, step: r.step, due: r.due, mode: MODE });
  }
  return out;
}

export async function answerReview(kv, item, correct, now = new Date()) {
  const id = item && (item.id || String(item.item || '').split(':')[1]);
  const rec = loadRecord(kv, id);
  if (!rec) return null;
  const next = applyReview(rec, { qid: item.qid, correct, now, counted: isDue(rec, now) });
  return saveRecord(kv, next);
}

// ---------------------------------------------------------------- keep asking in 问老师

export function askText(rec) {
  const r = obj(rec), q = obj(r.q);
  const opts = arr(q.options).length ? ' ' + q.options.map((o, i) => `${letterOf(i)}. ${o}`).join('  ') : '';
  const ask = `这道题我还想问问：${q.stem || ''}`.slice(0, 120);
  const ex = r.explain || {};
  const send = [
    '我拍的一道错题，老师刚才讲过了，我还有点不懂，想接着问。',
    `题目：${q.stem || ''}${opts}`,
    q.her ? `我的答案：${q.her}` : '',
    q.answer ? `正确答案：${q.answer}` : '',
    ex.conclusion ? `老师刚才说：${ex.conclusion}` : '',
    arr(ex.why).length ? `为什么：${arr(ex.why).join(' ')}` : '',
    '请换个说法再给我讲讲，最后出一道小题考考我。',
  ].filter(Boolean).join('\n');
  return { ask, send };
}

// ---------------------------------------------------------------- 拍听写本（roadmap-gaps 6，0.7.2）
// 老师批改过的听写本（或单词小测）拍一张：模型认出她写的每个词和老师的批改（打叉、打勾、改过的写法），程序对上单词本里的词。
// 她看一眼、可以改、勾要收的（打叉的默认勾上）→ 确认：这些词打开“写得出”线（words.patch，write_from 'school'），
// 记进 kv 'mistake.dictation'，第二天起热身里拼一次（dictWarmSlugs 给 plan.js；拼对一次或过了 3 天就不再排）。
// “会写了”的词被老师打了叉，同时退回“在练”（encounters.js markBack，ui-mistakes 调）。
//   DICT_KEY 'mistake.dictation'；DICT_WARM_DAYS 3；DICT_MAX 40；DICT_SYSTEM、dictUserText({ units, unit, words })
//   normalizeDictation(raw) -> [DictItem]
//     DictItem = { no, her（她写的）, answer（正确拼写：老师改的，或者照中文 / 课本该写的词）, cn, mark: 'wrong' | 'right' | 'none', unsure }
//   matchDictation(items, { entries, unitWords }) -> [DictItem + { slug, headword, inBook, keep }]   对上单词本的词；keep = 打叉的
//   recognizeDictation({ dataUrl, settings, budget, fetchImpl, signal, sleep, units, unit, words }) -> Promise<{ items, unclear, model, mock }>
//   readDict(kv) -> DictState；noteDictation(state, { items, now, id, mock }) -> DictState（items 是她确认收的，只记有 slug 的）
//   dictWarmSlugs(kv | state, now, { events, max = 6 }) -> [slug]   第二天起热身要拼的；收进来那天不排；拼对过一次（那天以后）或者过了 3 天就不排
//   dictPlaceholder(item, now) -> emma-export（一个占位词条，source 'school'）
//   saveDictation({ kv, words, items, now, unit, mock }) -> Promise<{ state, opened, added, skipped, page }>   确认收：不在单词本的先加、
//     打开“写得出”线（words.patch，write_from 'school'；已经开着的不改来源）、写 kv；模拟模式不写词条也不写 kv
//   dictEvent(item, { now, page }) -> events 'dictation' 的字段：{ type: 'dictation', slug, correct: false, mode: 'paper', pass: 'school',
//     source: 'photo', step: 'mistakes', her, answer, page }（wordbook 的 dictWrong、teacher 的错词都认 dictation 事件）
//   kv 'mistake.dictation'（新键，随备份导出；照片不存）= { v: 1, pages: [{ id, day, at, unit, mock?, words: [{ slug, w, her, cn }] }]（最近 30 页）,
//     warm: { slug: { day: 收进来那天, page } }, updated }
export const DICT_KEY = 'mistake.dictation';
export const DICT_WARM_DAYS = 3;
export const DICT_MAX = 40;

export const DICT_SYSTEM = `你帮一个初一学生（北京，外研版七年级上册，英语基础弱）看一张英语听写本或单词小测的照片，上面有老师的批改。
做三件事：
1. 按顺序找出她写的每个英文单词或短语，原样抄下来（拼错了也照抄，不要改）。看不清的字母写 ?。
2. 看老师的批改：这个词旁边打了叉、圈出来、划线、旁边写了正确写法，算 wrong；打了勾算 right；没批改算 none。
3. 写出这个词正确的拼写：老师改过就照老师改的；没改就按旁边的中文或你能判断的意思写正确的词。拿不准把 unsure 写 true。
只回一个 JSON 对象：
{
  "items": [
    { "no": "1", "her": "她写的原样", "answer": "正确拼写", "cn": "旁边的中文（没有写 \\"\\"）", "mark": "wrong" | "right" | "none", "unsure": false }
  ],
  "unclear": "照片哪里看不清，一句话；都清楚写 \\"\\""
}
规则：只收英文词和短语，一页最多 40 个；不要编没写的词；正确拼写只写词本身，不带中文、不带序号。`;

export function dictUserText({ units = [], unit = '', words = [] } = {}) {
  const u = arr(units).map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  const list = arr(words).map(w => (typeof w === 'string' ? w : w && (w.w || w.headword))).filter(Boolean).slice(0, 120);
  return [
    unit ? `她现在学到 ${unit}。` : '',
    u.length ? `课本单元：${u.join('、')}。` : '',
    list.length ? `这几个单元要会写的词（正确拼写多半是其中一个）：${list.join(', ')}。` : '',
    '看照片，按上面的格式回 JSON。',
  ].filter(Boolean).join('\n');
}

const MARKS = new Set(['wrong', 'right', 'none']);
export function normalizeDictation(raw) {
  const list = arr(obj(raw).items || (Array.isArray(raw) ? raw : []));
  const out = [];
  for (const it of list) {
    if (out.length >= DICT_MAX) break;
    const r = obj(it);
    const her = EN(r.her);
    const answer = EN(r.answer).replace(/^\d+[.)、]\s*/, '');
    if (!her && !answer) continue;
    let mark = MARKS.has(r.mark) ? r.mark : 'none';
    out.push({ no: ONE(r.no) || String(out.length + 1), her, answer: answer || her, cn: ONE(r.cn), mark, unsure: r.unsure === true || /\?/.test(her + answer) });
  }
  return out;
}

const wordKey = s => EN(s).toLowerCase().replace(/[.。!！?？,，;；]+$/g, '').replace(/\s+/g, ' ').trim();
export function matchDictation(items, { entries = [], unitWords = [] } = {}) {
  const byWord = new Map();
  for (const e of arr(entries)) {
    if (!e || !e.slug) continue;
    const k = wordKey(e.headword || e.slug.replace(/-/g, ' '));
    if (k && !byWord.has(k)) byWord.set(k, e);
  }
  const book = new Map();
  for (const w of arr(unitWords)) { const k = wordKey(w && (w.w || w.headword)); if (k && !book.has(k)) book.set(k, w); }
  return arr(items).map(it => {
    const k = wordKey(it.answer);
    const e = byWord.get(k) || null;
    const b = book.get(k) || null;
    return { ...it, slug: e ? e.slug : slugify(k), headword: e ? (e.headword || k) : (b && b.w) || k, cn: it.cn || (b && b.cn) || ONE(e && e.brief_cn) || '',
      inBook: !!e, keep: it.mark === 'wrong' };
  });
}

export async function recognizeDictation({ dataUrl, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs,
  units = [], unit = '', words = [] } = {}) {
  const s = settings || {};
  if (s.mock) {
    await sleep(600);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上：网络不通（模拟断网）。', 'network');
    return { items: normalizeDictation(mockDictation()), unclear: '', model: 'mock', mock: true };
  }
  if (!dataUrl || !/^data:image\/(jpeg|png);base64,/.test(dataUrl)) throw new AIError('照片还没准备好，再拍一次。', 'empty');
  const route = visionRoute(s);
  const r = await callJSON({ route, system: DICT_SYSTEM, user: dictUserText({ units, unit, words }), image: dataUrl, kind: OCR_KIND,
    budget, fetchImpl, signal, sleep, timeoutMs: OCR_TIMEOUT_MS });
  const items = normalizeDictation(r.obj);
  if (!items.length) throw new AIError('这张照片里没认出听写的词。拍正、拍清楚，再试一次。', 'empty');
  return { items, unclear: ONE(r.obj.unclear), model: r.model, mock: false };
}

export function normDict(raw) {
  const r = obj(raw);
  const pages = arr(r.pages).filter(p => p && p.id && /^\d{4}-\d\d-\d\d$/.test(String(p.day || ''))).map(p => ({
    id: String(p.id), day: String(p.day), at: String(p.at || ''), unit: p.unit || null, ...(p.mock ? { mock: true } : {}),
    words: arr(p.words).filter(w => w && w.slug).map(w => ({ slug: String(w.slug), w: EN(w.w), her: EN(w.her), cn: ONE(w.cn) })),
  })).slice(-30);
  const warm = {};
  for (const [slug, w] of Object.entries(obj(r.warm))) if (w && /^\d{4}-\d\d-\d\d$/.test(String(w.day || ''))) warm[slug] = { day: String(w.day), page: String(w.page || '') };
  return { v: 1, pages, warm, updated: String(r.updated || '') };
}
export function readDict(kv) { try { return normDict(kv.peek(DICT_KEY, null)); } catch (e) { return normDict(null); } }

export function noteDictation(state, { items = [], now = new Date(), id = '', mock = false, unit = null } = {}) {
  const s = normDict(state);
  const day = dayOf(now);
  const pid = id || 'd' + newId(now).slice(1);
  const words = arr(items).filter(x => x && x.slug).map(x => ({ slug: String(x.slug), w: EN(x.headword || x.answer), her: EN(x.her), cn: ONE(x.cn) }));
  if (!words.length) return s;
  s.pages = [...s.pages, { id: pid, day, at: isoLocal(now), unit, ...(mock ? { mock: true } : {}), words }].slice(-30);
  for (const w of words) s.warm[w.slug] = { day, page: pid };
  s.updated = isoLocal(now);
  return s;
}

export function dictWarmSlugs(src, now = new Date(), { events = [], max = 6 } = {}) {
  const s = src && typeof src.peek === 'function' ? readDict(src) : normDict(src);
  const today = dayOf(now);
  const spelledOk = new Map();   // slug -> days she spelled it right
  for (const e of arr(events)) {
    if (!e || e.correct !== true || !e.at) continue;
    const isSpellEv = e.type === 'dictation' || (e.type === 'answer' && ['tiles', 'keys', 'cloze', 'paper'].includes(e.mode) && !(Number(e.hint_level) > 0));
    if (!isSpellEv) continue;
    const slug = e.slug || (String(e.item || '').startsWith('w:') ? String(e.item).slice(2) : '');
    if (!slug) continue;
    if (!spelledOk.has(slug)) spelledOk.set(slug, []);
    spelledOk.get(slug).push(dayOf(e.at));
  }
  return Object.entries(s.warm)
    .filter(([slug, w]) => w.day < today && addDays(w.day, DICT_WARM_DAYS) >= today && !arr(spelledOk.get(slug)).some(d => d > w.day))
    .sort((a, b) => a[1].day.localeCompare(b[1].day) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([slug]) => slug);
}

export function dictEvent(item, { page = '' } = {}) {
  const it = obj(item);
  return { type: 'dictation', slug: String(it.slug || ''), correct: false, first_try: true, mode: 'paper', pass: 'school', source: 'photo', step: STEP,
    her: EN(it.her), answer: EN(it.headword || it.answer), page: String(page || ''), item: 'w:' + String(it.slug || '') };
}

// a word from the dictation photo that is not in her wordbook yet: a placeholder entry (like the reader and 摸底 do),
// its explanation comes the first time she opens it (needs_core)
export function dictPlaceholder(item, now = new Date()) {
  const it = obj(item);
  const at = localIso(toDate(now));
  const w = wordKey(it.headword || it.answer);
  const e = { slug: String(it.slug || slugify(w)), headword: w, brief_cn: ONE(it.cn), cn_source: 'school', needs_core: true,
    favorited: true, favorited_at: at, created: at, updated: at, note: '', history: [{ at, query: w, source: 'school' }] };
  return { format: 'emma-export', version: 1, source: 'school', exported_at: toDate(now).toISOString(), entries: [e], zh: [] };
}

// 确认收：没在单词本的先加进去，打开“写得出”线，记进 kv 'mistake.dictation'。words 是 ctx.words（get、patch、importData）。
// -> { state, opened: [slug], added: [slug], skipped: [slug], page }
export async function saveDictation({ kv, words: W = null, items = [], now = new Date(), unit = null, mock = false } = {}) {
  const keep = arr(items).filter(x => x && x.slug && wordKey(x.headword || x.answer));
  const opened = [], added = [], skipped = [];
  const day = dayOf(now);
  for (const it of keep) {
    if (mock || !W) { skipped.push(it.slug); continue; }
    let e = null;
    try { e = typeof W.get === 'function' ? W.get(it.slug) : null; } catch (err) { e = null; }
    if (!e && typeof W.importData === 'function') {
      try { await W.importData(dictPlaceholder(it, now)); added.push(it.slug); e = typeof W.get === 'function' ? W.get(it.slug) : null; } catch (err) { e = null; }
    }
    if (!e || typeof W.patch !== 'function') { skipped.push(it.slug); continue; }
    try { await W.patch(it.slug, { write: true, write_at: e.write_at || day, write_from: e.write ? (e.write_from || 'school') : 'school' }); opened.push(it.slug); }
    catch (err) { skipped.push(it.slug); }
  }
  const pid = 'd' + newId(now).slice(1);
  let state = noteDictation(kv ? readDict(kv) : null, { items: keep, now, id: pid, mock, unit });
  if (!mock && kv && typeof kv.set === 'function' && keep.length) { try { await kv.set(DICT_KEY, state); } catch (err) { /* kv full */ } }
  return { state, opened, added, skipped, page: pid };
}

export function mockDictation() {
  return {
    items: [
      { no: '1', her: 'frend', answer: 'friend', cn: '朋友', mark: 'wrong' },
      { no: '2', her: 'teacher', answer: 'teacher', cn: '老师', mark: 'right' },
      { no: '3', her: 'shcool', answer: 'school', cn: '学校', mark: 'wrong' },
      { no: '4', her: 'apple', answer: 'apple', cn: '苹果', mark: 'right' },
      { no: '5', her: 'classrom', answer: 'classroom', cn: '教室', mark: 'wrong' },
    ],
    unclear: '',
  };
}

// ---------------------------------------------------------------- mock (original sentences, only words she knows)

export function mockItems() {
  return {
    items: [
      { no: '1', type: 'choice', stem: 'My sister ____ a cat.', options: ['have', 'has', 'is', 'are'], her: 'A', answer: 'B', ok: false,
        zh: '我姐姐有一只猫。', point: 'g:third_s', tags: ['third_s_missing'], topic: '三单 -s', unit: 'U2' },
      { no: '2', type: 'choice', stem: 'There ____ two books on the desk.', options: ['is', 'are', 'am', 'be'], her: 'B', answer: 'B', ok: true,
        zh: '桌子上有两本书。', point: 'g:there_be', tags: [], topic: 'there be', unit: 'U2' },
      { no: '3', type: 'fill', stem: 'This is ____ (I) pencil.', options: [], her: 'me', answer: 'my', ok: false,
        zh: '这是我的铅笔。', point: 'g:possessive_pronoun', tags: ['obj_vs_poss'], topic: '物主代词', unit: 'U1' },
    ],
    unclear: '',
  };
}

export function mockExplain(rec) {
  const r = obj(rec);
  const third = arr(r.points).includes('g:third_s') || arr(r.tags).includes('third_s_missing');
  if (third) {
    return {
      conclusion: '选 has。主语 My sister 是“一个人”，have 要变成 has。',
      why: ['你选了 have，是因为“有”就是 have，这个想法没错。', '可是一个人（he、she、my sister）做主语的时候，have 要换成 has。'],
      example: { en: 'Tom has a dog.', zh: '汤姆有一只狗。' },
      practice: { stem: 'My friend ____ a red bike.', zh: '我朋友有一辆红色的自行车。', options: ['have', 'has', 'is', 'are'], answer: 'has', explain: 'my friend 是一个人，用 has。', check: 'has' },
      variants: [
        { stem: 'Lucy ____ two pens.', zh: '露西有两支钢笔。', options: ['have', 'has', 'is', 'am'], answer: 'has', explain: 'Lucy 是一个人，用 has。', check: 'has' },
        { stem: 'He ____ a big bag.', zh: '他有一个大书包。', options: ['has', 'have', 'are', 'am'], answer: 'has', explain: 'he 用 has。', check: 'has' },
        { stem: 'I ____ a new ruler.', zh: '我有一把新尺子。', options: ['has', 'have', 'is', 'are'], answer: 'have', explain: 'I 用 have，不用 has。', check: 'have' },
      ],
    };
  }
  return {
    conclusion: '填 my。“我的”后面跟着名词 pencil，用 my。',
    why: ['你写了 me，me 是“我”放在动词后面的样子，比如 help me。', '这里说的是“谁的”铅笔，要用 my。'],
    example: { en: 'This is my book.', zh: '这是我的书。' },
    practice: { stem: 'That is ____ bag. (she)', zh: '那是她的书包。', options: ['she', 'her', 'hers', 'he'], answer: 'her', explain: '“她的”后面跟名词 bag，用 her。', check: 'her' },
    variants: [
      { stem: 'Is this ____ ruler? (you)', zh: '这是你的尺子吗？', options: ['you', 'your', 'yours', 'me'], answer: 'your', explain: '后面有名词 ruler，用 your。', check: 'your' },
      { stem: '____ name is Mike. (he)', zh: '他的名字叫迈克。', options: ['He', 'Him', 'His', 'Her'], answer: 'His', explain: '“他的”名字，用 His。', check: 'His' },
      { stem: 'We love ____ teacher. (we)', zh: '我们爱我们的老师。', options: ['we', 'us', 'our', 'ours'], answer: 'our', explain: '后面有名词 teacher，用 our。', check: 'our' },
    ],
  };
}
