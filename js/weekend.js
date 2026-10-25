// 周末课完整版（DESIGN 2.4，design/roadmap-gaps.md 第 2 项）。纯逻辑，ui-lesson.js 用。
// 周末是一周的收口，在平时的四格上加三样：
//   本周语法 10 题：周末第一节不是句型转换的课，写几个词格换成 10 道语法卡整题（sprint.js cardQuizItems：她这几周错过的点先出，
//     一类最多 2 道，带提示阶梯），一周一次
//   本周 10 词纸上写：收尾页一个按钮，进纸笔听写（ui-dictation.js 的 { week: true, words }）：老师读中文、她写、自己打勾；
//     错的打开“写得出”线，下周热身里拼（dictation.js saveDictation 照旧）
//   下周想练什么：收尾页四个按钮，一周问一次，记 kv 和一条 ask 事件（每周想一次会读到）
//   读一段：周末不缩短；番外读完了，每日阅读的周末那篇长一级（daily-read.js gatherMaterial）
// 轻松版、第一节课、小卷日、考前一天不加。
// 负责：接线（0.8.0）。
//
// kv 'weekend:<那周的周一>' = { v: 1, week, grammar: '' | 日子, paper: '' | 日子, wish: '' | WISH id, updated }，随备份走
//
// 导出
//   isWeekend(now) -> bool
//   weekKey(now) -> 'weekend:<周一>'；readWeekend(kv, now) -> 记录（没有就是空的）
//   fullDay(plan, now) -> bool        今天加周末那几样（周末、不是轻松版 / 第一节课 / 小卷日 / 考前一天）
//   wantsGrammar(plan, kv, now) -> bool   今天的写几个词换成本周语法 10 题
//   weekGrammarCell(cell, items) -> 写几个词格（mode 'quiz'，quiz.kind 'weekend'，只有语法题）
//   weekWords(events, entryOf, now, { n = 10 }) -> [slug]   这周练过的词，错得多的先；只要单词本里有的
//   WISH_OPTIONS、wishEvent(id)、mark(kv, part, value, now)
//   GRAMMAR_N = 10、PAPER_N = 10

export const GRAMMAR_N = 10;
export const PAPER_N = 10;
export const KEY_PREFIX = 'weekend:';
export const WISH_OPTIONS = [
  { id: 'read', zh: '多读故事' },
  { id: 'words', zh: '多练单词' },
  { id: 'grammar', zh: '多练语法' },
  { id: 'speak', zh: '多读出声' },
];

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const arr = x => (Array.isArray(x) ? x : []);
function mondayOf(now) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d); }

export const isWeekend = (now = new Date()) => [0, 6].includes(new Date(now).getDay());
export const weekKey = (now = new Date()) => KEY_PREFIX + mondayOf(now);
export function readWeekend(kv, now = new Date()) {
  let r = null;
  try { r = kv && kv.peek ? kv.peek(weekKey(now), null) : null; } catch (e) { r = null; }
  const o = r && typeof r === 'object' ? r : {};
  return { v: 1, week: mondayOf(now), grammar: String(o.grammar || ''), paper: String(o.paper || ''), wish: String(o.wish || ''), updated: String(o.updated || '') };
}
export async function mark(kv, part, value, now = new Date()) {
  const r = readWeekend(kv, now);
  r[part] = value === undefined ? dayOf(now) : value;
  r.updated = new Date(now).toISOString();
  try { await kv.set(weekKey(now), r); } catch (e) { /* bookkeeping only */ }
  return r;
}

export function fullDay(plan, now = new Date()) {
  if (!plan || !isWeekend(now)) return false;
  if (plan.light || plan.first || plan.quizDay || plan.quiz) return false;
  const wc = arr(plan.cells).find(c => c && c.id === 'wrap');
  return !(wc && wc.line);   // the night before the exam: the wrap cell carries 今天早点睡。
}
export function wantsGrammar(plan, kv, now = new Date()) {
  if (!fullDay(plan, now)) return false;
  const w = arr(plan.cells).find(c => c && c.id === 'write');
  if (w && w.mode === 'transform' && w.status === 'ready') return false;   // Saturday's 句型转换 stays
  const r = readWeekend(kv, now);
  return !r.grammar || r.grammar === dayOf(now);
}
export function weekGrammarCell(cell, items) {
  const grammar = arr(items).slice(0, GRAMMAR_N);
  if (!grammar.length) return cell;
  const quiz = { id: 'weekend:' + dayOf(new Date()), kind: 'weekend', title: '本周语法 10 题', spell: [], items: [], grammar,
    minutes: Math.max(3, Math.round(grammar.length * 0.5)) };
  return { ...(cell || { id: 'write' }), status: 'ready', mode: 'quiz', quiz, items: [], minutes: quiz.minutes, note: quiz.title };
}

const WORD_TYPES = new Set(['answer', 'review', 'spell', 'dictation']);
export function weekWords(events = [], entryOf = () => null, now = new Date(), { n = PAPER_N } = {}) {
  const from = mondayOf(now);
  const tally = new Map();
  for (const e of arr(events)) {
    if (!e || !e.slug || !WORD_TYPES.has(e.type) || String(e.at || '').slice(0, 10) < from) continue;
    const t = tally.get(e.slug) || { n: 0, wrong: 0, last: '' };
    t.n++;
    if (e.correct === false || (typeof e.rating === 'number' && e.rating <= 1)) t.wrong++;
    if (String(e.at) > t.last) t.last = String(e.at);
    tally.set(e.slug, t);
  }
  return [...tally].filter(([slug]) => { const e = entryOf(slug); return !!(e && e.favorited && e.headword && !/\s/.test(e.headword)); })
    .sort((a, b) => b[1].wrong - a[1].wrong || b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
    .slice(0, n).map(([slug]) => slug);
}
export const wishEvent = id => ({ type: 'ask', qid: 'weekend_next', who: 'emma', answer: id, about: 'week', step: 'wrap' });
