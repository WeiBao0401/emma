// 接着练（Wei 10-25，第 6 批）：“今天的课”是推荐路线，不是门。课上完了（或者还没上），她随时能再练一小轮，
// 不限次数；老师在最上面推荐一件她现在最需要的事。这个文件是纯逻辑（不碰 DOM），界面在 ui-practice.js，样式 css/practice.css（类名 pr-）。
// 负责：接着练 agent（practice.js、ui-practice.js、css/practice.css、tests/practice.test.mjs）。
//
// 一小轮（3-5 分钟），每种都复用现成的题型和排序：
//   words     练我不熟的词：快忘的（FSRS 现在记得的概率低于 wordbook FADE_R）、忘过的、最近答错的、还在 Learning 的，6 个，
//             题型按 wordbook.pickModes 轮着来（四选一 / 听音 / 字母块 / 句子里回想）。答错的评 1 分进 FSRS（明天热身先出）；
//             本来就到期的、答对了也评分（一下就对 3，有提示 2）；没到期又答对的不评分，免得打乱复习。
//   mistakes  错题再练：没攻克的错题，到期的先，再是最久没考的；每道出一道新题（mistakes.js reviewQuestion），
//             到期的算进日程（answerReview 自己判断 counted）。
//   grammar   语法闯关：她选一张卡，或“老师帮我选”（grammarAuto：刚错过的 → 到期复习 → 最近的误解对上的卡 → 在练的 → nextCard）。
//             卡还没上第 1 天就上第 1 天（renderGrammarCard）；第 1 天做完、第 2 天要等到第 1 天以后；都上过了出 4 道（grammarItems），
//             错了照常进 grammar.js 的 1、3、7 天复习。
//   read      再读一篇：每日阅读（daily-read.js，另一个 agent 在写，有就先用它）→ 期中阅读小篇（她这里读得最早的）→ 读过的番外再读
//             （最久没读的）→ 下一集番外（今天的课还没上时不抢课里那一集）。
//   dictation / revise / chat   听写、复习考试、问老师：直接跳到那一页（ctx.go），不算一小轮。
//
// 推荐（recommendNext）按她现在最需要的排：
//   1 离考试 3 天以内，或“我要复习考试”今天还有一份没做 → revise
//   2 今天、昨天刚错过的语法点（kv grammar:* 的 reviews.miss） → grammar（那张卡）
//   3 今天到期的错题 → mistakes
//   4 快忘的词 3 个以上 → words
//   5 今天还没读过（课里的读一段、每日阅读、这里的再读一篇都算读过） → read
//   6 没攻克的错题 → mistakes；7 到期的语法复习、最近常错的误解 → grammar；8 不熟的词 → words；9 再读一篇
//   刚做完的那一种（exclude）往后放，除非没别的可推。
//
// 今天累计（kv day:<今天>.minutes 加这里每一轮的时长）到 NUDGE_MIN 分钟，老师温和地提醒一次“今天够了，明天见”，不锁。
//
// kv 'practice:YYYY-MM-DD'（新键，随备份走）
//   { v: 1, day, rounds: [{ kind, at, ms, n, right, ref?, slugs? }], ms, nudged: '' | ISO }   rounds 最多 60 条；留 30 天（trimOld）
//
// 事件（只加不改，CONTRACTS 第 6 节）：每一轮 session_start { kind: 'practice', practice: <kind>, hour } 和
//   session_end { min, steps_done: [<kind>], completed, practice: <kind> }；题目照各题型原来的格式记，step 一律 'practice'（新值）。
//
// 导出
//   KV_PREFIX = 'practice:'、kvKey(day)、NUDGE_MIN = 40、ROUND_WORDS = 6、ROUND_MISTAKES = 3、ROUND_GRAMMAR = 4、STEP = 'practice'、
//   KINDS、ENTRY_ZH、ROUND_KINDS（在这里做的一小轮）、LINK_KINDS（跳到别的页）、MAX_ROUNDS、KEEP_DAYS
//   dayOf(date)、readDay(kv, now)、lessonMinutes(kv, now)、todayMinutes(kv, now) -> 分钟、noteRound(kv, round, now) -> Promise<Day>、
//   shouldNudge(kv, now)、markNudged(kv, now)、lessonDone(kv, now)、readToday(kv, now, { daily })、trimOld(kv, now)
//   weakWords(entries, now, { max, exclude, events }) -> [slug]、fadingWords(entries, now) -> [slug]
//   cardName(card)、grammarMissed(kv, now, { content, days }) -> [{ cardId, n, last }]、grammarDue(kv, now, { content }) -> [cardId]
//   grammarAuto(kv, now, { content, events }) -> { cardId, reason, why } | null
//   cardRound(state, now) -> { cardId, part } | { cardId, items: true }（这张卡这一轮怎么做）
//   grammarItems(card, state, now, { n }) -> [WarmItem]
//   cardList(kv, now, { content }) -> [{ id, title, status, statusZh, missed, due }]
//   openMistakes(kv, now, { bank, max, exclude }) -> [ReviewItem]（mistakes.js 的形状）
//   readOptions(kv, now, { stories, passages, daily, lessonDone }) -> [{ kind: 'daily' | 'passage' | 'episode', id, label, again?, minutes }]
//   examGap(progress, now) -> 天数 | null
//   recommendNext(ctx, now, { exclude, events, content, stories, passages, bank, daily }) -> Rec
//     Rec = { kind, title, why, cta, minutes, params }；params 给 ui-practice 的 start(kind, params)（grammar 带 cardId，read 带 option）
//   feedbackLine(kind, result) -> { head, detail }   一轮做完给她的一句具体反馈（见各 kind）
import { retrievability, State } from './fsrs.js';
import * as G from './grammar.js';
import * as M from './mistakes.js';
import * as RV from './review.js';
import { FADE_R } from './wordbook.js';

export const KV_PREFIX = 'practice:';
export const kvKey = day => KV_PREFIX + day;
export const STEP = 'practice';
export const NUDGE_MIN = 40;
export const ROUND_WORDS = 6;
export const ROUND_MISTAKES = 3;
export const ROUND_GRAMMAR = 4;
export const MAX_ROUNDS = 60;
export const KEEP_DAYS = 30;
export const KINDS = ['read', 'words', 'mistakes', 'grammar', 'dictation', 'revise', 'chat'];
export const ENTRY_ZH = { read: '再读一篇', words: '练我不熟的词', mistakes: '错题再练', grammar: '语法闯关', dictation: '听写', revise: '复习考试', chat: '问老师' };
export const ROUND_KINDS = ['read', 'words', 'mistakes', 'grammar'];
export const LINK_KINDS = { dictation: 'dictation', revise: 'revise', chat: 'chat' };

const pad = n => String(n).padStart(2, '0');
const toDate = v => (v instanceof Date ? v : new Date(v == null ? Date.now() : v));
export const dayOf = x => { const d = toDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (day, n) => { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); };
const arr = v => (Array.isArray(v) ? v : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = v => (Number.isFinite(+v) ? +v : 0);
const safe = (f, d) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
const peek = (kv, k, d) => safe(() => (kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d), d);
const keysOf = (kv, p) => safe(() => (kv && typeof kv.keys === 'function' ? kv.keys(p) : []), []);
const isoLocal = d => { const t = toDate(d); return `${dayOf(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; };

// ---------------------------------------------------------------- today's time

export function readDay(kv, now = new Date()) {
  const day = dayOf(now);
  const r = obj(peek(kv, kvKey(day), null));
  const rounds = arr(r.rounds).filter(x => x && typeof x === 'object' && x.kind).slice(-MAX_ROUNDS);
  return { v: 1, day, rounds, ms: Math.max(0, num(r.ms) || rounds.reduce((a, x) => a + Math.max(0, num(x.ms)), 0)), nudged: typeof r.nudged === 'string' ? r.nudged : '' };
}
export const lessonMinutes = (kv, now = new Date()) => Math.max(0, num(obj(peek(kv, 'day:' + dayOf(now), null)).minutes));
export const todayMinutes = (kv, now = new Date()) => Math.round(lessonMinutes(kv, now) + readDay(kv, now).ms / 60000);
export const lessonDone = (kv, now = new Date()) => !!obj(obj(peek(kv, 'day:' + dayOf(now), null)).cells).wrap;

export async function noteRound(kv, round = {}, now = new Date()) {
  const d = readDay(kv, now);
  const ms = Math.max(0, Math.min(num(round.ms), 60 * 60000));   // a tab left open overnight is not an hour of practice
  const rec = { kind: String(round.kind || ''), at: isoLocal(now), ms, n: num(round.n), right: num(round.right) };
  if (round.ref) rec.ref = String(round.ref);
  if (Array.isArray(round.slugs) && round.slugs.length) rec.slugs = round.slugs.map(String).slice(0, 20);
  const out = { ...d, rounds: [...d.rounds, rec].slice(-MAX_ROUNDS), ms: d.ms + ms };
  try { await kv.set(kvKey(d.day), out); } catch (e) { /* the round still counts on screen */ }
  return out;
}
export const shouldNudge = (kv, now = new Date()) => todayMinutes(kv, now) >= NUDGE_MIN && !readDay(kv, now).nudged;
export async function markNudged(kv, now = new Date()) {
  const d = readDay(kv, now);
  const out = { ...d, nudged: d.nudged || isoLocal(now) };
  try { await kv.set(kvKey(d.day), out); } catch (e) { /* ignore */ }
  return out;
}
export async function trimOld(kv, now = new Date()) {
  const floor = addDays(dayOf(now), -KEEP_DAYS);
  let n = 0;
  for (const k of keysOf(kv, KV_PREFIX)) {
    const d = k.slice(KV_PREFIX.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < floor) { try { await kv.delete(k); n++; } catch (e) { /* ignore */ } }
  }
  return n;
}

// did she read anything today: the lesson's 读一段, a round of 再读一篇 here, or today's daily reading
export function readToday(kv, now = new Date(), { daily = null } = {}) {
  if (obj(obj(peek(kv, 'day:' + dayOf(now), null)).cells).read) return true;
  if (readDay(kv, now).rounds.some(r => r.kind === 'read' && r.n > 0)) return true;
  return !!(daily && daily.done);
}

// ---------------------------------------------------------------- words

const fsrsOf = e => (e && e.fsrs && typeof e.fsrs === 'object' ? e.fsrs : null);
const seenCard = c => !!(c && c.state !== State.New && c.last_review);
const lastRating = e => { const r = arr(e && e.reviews); return r.length ? num(r[r.length - 1].rating) : 0; };

export function fadingWords(entries = [], now = new Date()) {
  const t = toDate(now);
  return arr(entries).filter(e => e && e.favorited && seenCard(fsrsOf(e)) && retrievability(fsrsOf(e), t) < FADE_R)
    .sort((a, b) => retrievability(fsrsOf(a), t) - retrievability(fsrsOf(b), t)).map(e => e.slug);
}

// the ones she is least sure of: fading, forgotten before, still learning, rated hard last time, or wrong in the last 3 days
// (events). Words practised in a round today already go to the back, so 再来一轮 gives new ones while there are any.
export function weakWords(entries = [], now = new Date(), { max = ROUND_WORDS, exclude = [], events = [] } = {}) {
  const t = toDate(now);
  const since = addDays(dayOf(t), -3);
  const wrong = new Map();
  for (const ev of arr(events)) {
    if (!ev || ev.type !== 'answer' || ev.correct !== false || !ev.slug) continue;
    if (String(ev.at || '').slice(0, 10) < since) continue;
    wrong.set(ev.slug, (wrong.get(ev.slug) || 0) + 1);
  }
  const skip = new Set(arr(exclude));
  const scored = [];
  for (const e of arr(entries)) {
    if (!e || !e.favorited || !e.slug) continue;
    const c = fsrsOf(e);
    const seen = seenCard(c);
    if (!seen && !wrong.has(e.slug)) continue;   // never met: that is new-word work for the lesson, not practice
    const r = seen ? retrievability(c, t) : 0;
    let score = 0;
    if (seen && r < FADE_R) score += 3 + (FADE_R - r) * 10;
    if (c && num(c.lapses) > 0) score += 2 + Math.min(3, num(c.lapses));
    if (c && (c.state === State.Learning || c.state === State.Relearning)) score += 2;
    const lr = lastRating(e);
    if (lr && lr <= 2) score += 2;
    score += 3 * Math.min(3, wrong.get(e.slug) || 0);
    if (score <= 0) continue;
    scored.push({ slug: e.slug, score, r, again: skip.has(e.slug) });
  }
  scored.sort((a, b) => (a.again - b.again) || b.score - a.score || a.r - b.r || a.slug.localeCompare(b.slug));
  return scored.slice(0, max).map(x => x.slug);
}

// ---------------------------------------------------------------- grammar

export const cardName = card => String((card && (card.title || card.id)) || '').split('：')[0];
const STATUS_ZH = { new: '还没学', learning: '在学', practicing: '在练', steady: '练稳了' };
const cardsOf = c => arr(c && c.cards);
const stateOf = (kv, id) => G.normState(peek(kv, G.kvKey(id), null), id);

// a question she got wrong today or yesterday (the miss day of a review) on each card, most first
export function grammarMissed(kv, now = new Date(), { content = null, days = 1 } = {}) {
  const c = content || G.content();
  const from = addDays(dayOf(now), -days);
  const out = [];
  for (const card of cardsOf(c)) {
    const s = stateOf(kv, card.id);
    const misses = s.reviews.filter(r => r && r.miss && r.miss >= from);
    if (misses.length) out.push({ cardId: card.id, n: misses.length, last: misses.map(r => r.miss).sort().pop() });
  }
  return out.sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
}
export function grammarDue(kv, now = new Date(), { content = null } = {}) {
  const c = content || G.content();
  const today = dayOf(now);
  return cardsOf(c).filter(card => stateOf(kv, card.id).reviews.some(r => r && r.due && r.due <= today)).map(card => card.id);
}

// the card whose mistakes (fixes, or a wrong option's tag in its questions) she made most in the last 21 days
function cardForTags(c, hits) {
  let best = null, bestN = 0;
  for (const card of cardsOf(c)) {
    const tags = new Set(arr(card.fixes));
    for (const q of [...arr(card.questions), ...arr(card.spares)]) for (const t of Object.values(obj(q && q.wrong))) if (t) tags.add(t);
    const n = [...tags].reduce((a, t) => a + num(hits[t]), 0);
    if (n > bestN) { best = card; bestN = n; }
  }
  return best ? { card: best, n: bestN } : null;
}

export function grammarAuto(kv, now = new Date(), { content = null, events = [] } = {}) {
  const c = content || G.content();
  if (!c || !cardsOf(c).length) return null;
  const missed = grammarMissed(kv, now, { content: c });
  if (missed.length) {
    const card = c.card(missed[0].cardId);
    return { cardId: card.id, reason: 'missed', why: `${missed[0].last === dayOf(now) ? '今天' : '昨天'}${cardName(card)}错了 ${missed[0].n} 道，趁热换几个句子再练。` };
  }
  const due = grammarDue(kv, now, { content: c });
  if (due.length) { const card = c.card(due[0]); return { cardId: card.id, reason: 'due', why: `${cardName(card)}有错过的题到日子了，换个句子再考一次。` }; }
  const gstate = safe(() => G.grammarState(kv, c), { cards: {} });
  const hits = safe(() => G.misconceptionHits({ ...gstate, grammar: gstate, events: arr(events) }, now, { content: c }), {});
  const t = cardForTags(c, hits);
  if (t && t.n >= 2) return { cardId: t.card.id, reason: 'tags', why: `最近几次在${cardName(t.card)}上容易选错，再练几道。` };
  const practicing = cardsOf(c).filter(card => G.cardStatus(stateOf(kv, card.id), now) === 'practicing');
  if (practicing.length) {
    const last = card => Object.values(stateOf(kv, card.id).items).map(x => x && x.last).filter(Boolean).sort().pop() || '';
    const card = practicing.sort((a, b) => last(a).localeCompare(last(b)))[0];
    return { cardId: card.id, reason: 'practice', why: `${cardName(card)}还没练稳，再来几道。` };
  }
  const nx = safe(() => G.nextCard({ grammar: gstate, progress: peek(kv, 'progress', {}) }, now, { content: c }), null);
  if (nx && c.card(nx.cardId)) return { cardId: nx.cardId, reason: 'next', why: nx.why || `学一张新卡：${cardName(c.card(nx.cardId))}。` };
  const any = cardsOf(c)[0];
  return { cardId: any.id, reason: 'any', why: `${cardName(any)}再练几道。` };
}

// how this card's round goes: its first day if not learned yet; its second day once the first was done before today;
// otherwise a few questions
export function cardRound(state, now = new Date()) {
  const s = G.normState(state);
  const day = dayOf(now);
  const p1 = s.parts['1'] || {}, p2 = s.parts['2'] || {};
  if (!p1.done) return { cardId: s.card, part: 1 };
  if (!p2.done && p1.done < day) return { cardId: s.card, part: 2 };
  return { cardId: s.card, items: true };
}

// up to n questions from one card: the due reviews (a fresh spare of the same family), then the ones she got wrong
// (not clean), then spares she has not seen, then whatever she did longest ago. Only the parts she has started, so a
// round never gives away the second day before it is taught. Same day, same progress: same list.
export function grammarItems(card, state, now = new Date(), { n = ROUND_GRAMMAR } = {}) {
  if (!card) return [];
  const s = G.normState(state, card.id);
  const day = dayOf(now);
  const started = new Set(['1', '2'].filter(p => s.parts[p] && (s.parts[p].started || s.parts[p].done || arr(s.parts[p].answered).length)));
  const flagged = new Set(arr(s.flagged));
  const okQ = q => q && !flagged.has(q.id) && !q.isVariant;
  const mains = arr(card.questions).filter(q => okQ(q) && (!q.part || started.has(String(q.part))));
  const spares = arr(card.spares).filter(okQ);
  const out = [];
  const used = new Set();
  const item = (q, kind = 'practice', of = undefined) => {
    used.add(q.id);
    const w = { item: q.item || `g:${card.id}:${q.id}`, card: card.id, qid: q.id, kind, family: q.family, unit: card.unit, mode: 'grammar' };
    if (of) w.of = of;
    out.push(w);
  };
  for (const r of s.reviews.filter(r => r && r.due && r.due <= day).sort((a, b) => a.due.localeCompare(b.due))) {
    if (out.length >= n) break;
    const served = new Set(arr(r.served));
    const q = spares.find(x => x.family === r.family && !served.has(x.id) && !used.has(x.id)) ||
      mains.find(x => x.family === r.family && x.id !== r.id && !used.has(x.id));
    if (q) item(q, 'review', r.id);
  }
  const lastOf = q => (s.items[q.id] && s.items[q.id].last) || '';
  const wrong = mains.filter(q => s.items[q.id] && !s.items[q.id].clean && s.items[q.id].last !== day).sort((a, b) => lastOf(a).localeCompare(lastOf(b)));
  const fresh = spares.filter(q => !s.items[q.id]);
  const old = [...mains, ...spares].filter(q => s.items[q.id] && s.items[q.id].last !== day).sort((a, b) => lastOf(a).localeCompare(lastOf(b)) || a.id.localeCompare(b.id));
  // one family at a time, so four questions are not four of the same thing
  const pickFrom = list => {
    const fams = new Set(out.map(x => x.family));
    const q = list.find(x => !used.has(x.id) && !fams.has(x.family)) || list.find(x => !used.has(x.id));
    if (q) item(q);
    return !!q;
  };
  for (const list of [wrong, fresh, old, mains]) while (out.length < n && pickFrom(list)) { /* keep picking */ }
  return out.slice(0, n);
}

export function cardList(kv, now = new Date(), { content = null } = {}) {
  const c = content || G.content();
  const missed = new Map(grammarMissed(kv, now, { content: c }).map(x => [x.cardId, x.n]));
  const due = new Set(grammarDue(kv, now, { content: c }));
  return cardsOf(c).map(card => {
    const status = G.cardStatus(stateOf(kv, card.id), now);
    return { id: card.id, title: cardName(card), label: card.label || '', status, statusZh: STATUS_ZH[status] || '', missed: missed.get(card.id) || 0, due: due.has(card.id) };
  });
}

// ---------------------------------------------------------------- mistakes

// every mistake not conquered yet: the ones due today first (they count for the schedule), then the one tested longest ago
export function openMistakes(kv, now = new Date(), { bank = null, max = ROUND_MISTAKES, exclude = [] } = {}) {
  const b = bank || safe(() => M.bank(), null);
  const skip = new Set(arr(exclude));
  const lastOf = r => (arr(r.reviews).map(x => x && x.day).filter(Boolean).sort().pop()) || String(r.created || '');
  const list = safe(() => M.loadAll(kv), []).filter(r => r && !r.mastered && !r.dropped);
  const today = dayOf(now);
  // tested today already and not due: later in the list, so 再来一轮 gives the others first
  const rank = r => (M.isDue(r, now) ? 0 : skip.has(r.id) || lastOf(r).slice(0, 10) === today ? 2 : 1);
  list.sort((a, c) => rank(a) - rank(c) || lastOf(a).localeCompare(lastOf(c)));
  const out = [];
  for (const r of list) {
    if (out.length >= max) break;
    const q = safe(() => M.reviewQuestion(r, b, { now }), null);
    if (!q) continue;
    const label = safe(() => M.topicOf(r, b).label, '') || r.topic || '';
    out.push({ type: 'mistake', id: r.id, item: `mx:${r.id}:${q.id}`, qid: q.id, question: q, label, step: r.step, due: r.due, mode: M.MODE });
  }
  return out;
}

// ---------------------------------------------------------------- reading

// what 再读一篇 can open, best first. daily = what daily-read.js says about today's reading ({ id, title, minutes, done })
export function readOptions(kv, now = new Date(), { stories = null, passages = [], daily = null, lessonDone: lessonIsDone = false } = {}) {
  const out = [];
  const pr = readDay(kv, now).rounds;
  const mine = new Map();   // id -> last day read here
  for (const k of keysOf(kv, KV_PREFIX)) for (const r of arr(obj(peek(kv, k, null)).rounds)) if (r && r.kind === 'read' && r.ref) {
    const d = String(r.at || '').slice(0, 10);
    if (!mine.has(r.ref) || mine.get(r.ref) < d) mine.set(r.ref, d);
  }
  const readHereToday = id => pr.some(r => r.kind === 'read' && r.ref === id);
  if (daily && daily.id && !daily.done) out.push({ kind: 'daily', id: String(daily.id), label: daily.title || '今天的阅读', minutes: num(daily.minutes) || 5 });
  const exam = obj(obj(peek(kv, 'exam.reading', null)).done);
  const last = id => [mine.get(id) || '', exam[id] || ''].sort().pop();
  const ps = arr(passages).filter(p => p && p.id && !readHereToday(p.id)).sort((a, b) => last(a.id).localeCompare(last(b.id)));
  const prog = obj(peek(kv, 'story:progress', null));
  const eps = obj(prog.episodes);
  const doneEps = arr(stories && stories.episodes).filter(ep => ep && eps[ep.id] && eps[ep.id].done && !readHereToday(ep.id));
  const epLast = ep => [eps[ep.id].done, ...arr(eps[ep.id].again), mine.get(ep.id) || ''].filter(Boolean).sort().pop() || '';
  doneEps.sort((a, b) => epLast(a).localeCompare(epLast(b)));
  for (const p of ps.slice(0, 3)) out.push({ kind: 'passage', id: p.id, label: p.label || '期中阅读', minutes: num(p.minutes) || 5 });
  for (const ep of doneEps.slice(0, 3)) out.push({ kind: 'episode', id: ep.id, label: `再读番外第 ${ep.n} 集`, again: true, minutes: 5 });
  // the next episode belongs to the lesson until the lesson is done
  const next = arr(stories && stories.episodes).find(ep => ep && !(eps[ep.id] && eps[ep.id].done));
  if (next && lessonIsDone && !readHereToday(next.id)) out.push({ kind: 'episode', id: next.id, label: `番外第 ${next.n} 集`, minutes: 6 });
  return out;
}

// ---------------------------------------------------------------- recommend

export function examGap(progress, now = new Date()) {
  const d = progress && String(progress.examDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
  const [y, m, dd] = d.split('-').map(Number);
  const t = toDate(now);
  const gap = Math.round((new Date(y, m - 1, dd) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
  return gap >= 0 ? gap : null;
}

const entriesOf = ctx => safe(() => (ctx.words && typeof ctx.words.favorites === 'function' ? ctx.words.favorites() : []), []);

export function recommendNext(ctx = {}, now = new Date(), { exclude = [], events = [], content = null, stories = null, passages = [], bank = null, daily = null } = {}) {
  const kv = ctx.kv;
  const ex = new Set(arr(exclude));
  const c = content || safe(() => G.content(), null);
  const list = [];
  const add = (kind, title, why, minutes, params = {}) => list.push({ kind, title, why, cta: kind in LINK_KINDS ? '去看看' : `开始 · 约 ${minutes} 分钟`, minutes, params });

  // 1 the exam is close
  const gap = examGap(peek(kv, 'progress', {}), now);
  const plan = safe(() => RV.activePlan(kv, now), null);
  const pi = plan ? safe(() => RV.todayIndex(plan, now), -1) : -1;
  if (plan && pi >= 0 && plan.days[pi] && plan.days[pi].day <= dayOf(now)) {
    add('revise', '接着复习考试', safe(() => RV.summaryLine(plan, pi), '') || '今天还有一份复习没做。', Math.max(5, num(plan.days[pi].minutes)));
  } else if (gap !== null && gap <= 3) {
    add('revise', gap === 0 ? '考前看一眼' : '复习一下要考的单元', gap === 0 ? '今天考试，看一眼最要紧的词和语法。' : `还有 ${gap} 天考试，按要考的单元复习一份。`, gap === 0 ? 5 : 15);
  }
  // 2 a grammar point she just missed
  const missed = grammarMissed(kv, now, { content: c });
  if (missed.length && c && c.card(missed[0].cardId)) {
    const card = c.card(missed[0].cardId);
    add('grammar', `再练 ${ROUND_GRAMMAR} 道${cardName(card)}`, `${missed[0].last === dayOf(now) ? '今天' : '昨天'}错了 ${missed[0].n} 道，趁热换几个句子再练。`, 4, { cardId: card.id });
  }
  // 3 mistakes due today
  const ms = safe(() => M.summary(kv, now), { open: 0, due: 0 });
  if (ms.due > 0) add('mistakes', `再考 ${Math.min(ms.due, ROUND_MISTAKES)} 道错题`, `有 ${ms.due} 道错题今天到日子了，做对两次就攻克。`, 3);
  // 4 words about to slip
  const entries = entriesOf(ctx);
  const fading = fadingWords(entries, now);
  if (fading.length >= 3) add('words', `练 ${Math.min(ROUND_WORDS, fading.length)} 个快忘的词`, `有 ${fading.length} 个词快忘了，现在练一下最省力。`, 4);
  // 5 no reading yet today
  const lessonIsDone = lessonDone(kv, now);
  const opts = readOptions(kv, now, { stories, passages, daily, lessonDone: lessonIsDone });
  if (!readToday(kv, now, { daily }) && opts.length) add('read', opts[0].kind === 'daily' ? `读${opts[0].label}` : opts[0].label, '今天还没读英语，读一篇，做几道题。', opts[0].minutes, { option: opts[0] });
  // 6-9 the rest
  if (ms.open > ms.due && ms.open > 0) add('mistakes', '错题再练一道', `错题本里还有 ${ms.open} 道没攻克，换一道新题练练。`, 3);
  const auto = grammarAuto(kv, now, { content: c, events });
  const autoOk = auto && auto.reason !== 'missed' && c && c.card(auto.cardId);
  const addAuto = () => add('grammar', `语法闯关：${cardName(c.card(auto.cardId))}`, auto.why, 4, { cardId: auto.cardId });
  if (autoOk && ['due', 'tags', 'practice'].includes(auto.reason)) addAuto();
  const weak = weakWords(entries, now, { events });
  if (weak.length && fading.length < 3) add('words', `练 ${weak.length} 个不熟的词`, '这几个词前面错过或者忘过，再见一面。', 4);
  if (readToday(kv, now, { daily }) && opts.length) add('read', opts[0].kind === 'daily' ? `读${opts[0].label}` : opts[0].label, '再读一篇，换个故事练读题。', opts[0].minutes, { option: opts[0] });
  // a new card (nextCard) last: free practice is for what she has met
  if (autoOk && !['due', 'tags', 'practice'].includes(auto.reason)) addAuto();
  if (!list.length) add('chat', '问老师一个问题', '今天要练的都练过了。有不懂的就问老师。', 3);
  const pick = list.find(r => !ex.has(r.kind)) || list[0];
  return pick;
}

// ---------------------------------------------------------------- feedback

const joinWords = ws => arr(ws).filter(Boolean).slice(0, 4).join('、');

// result per kind:
//   words     { right: [词], again: [词] }
//   grammar   { name, n, right, fuzzy, failed, part? }
//   mistakes  { n, right, conquered, left }（left：还差几次攻克，最少的那道）
//   read      { label, n, right, done }
export function feedbackLine(kind, r = {}) {
  if (kind === 'words') {
    const right = arr(r.right), again = arr(r.again), n = right.length + again.length;
    if (!n) return { head: '这一轮没练到词。', detail: '' };
    if (!again.length) return { head: `${n} 个词都一下就对。`, detail: '这几个记得牢，过几天再见。' };
    return { head: `${n} 个词，${right.length} 个一下就对。`, detail: `${joinWords(again)}还要再看，明天热身里先出${again.length > 1 ? '它们' : '它'}。` };
  }
  if (kind === 'grammar') {
    const n = num(r.n), right = num(r.right), failed = num(r.failed), fuzzy = num(r.fuzzy);
    const name = r.name || '语法';
    if (!n) return { head: '这一轮没有题。', detail: '' };
    const head = r.part ? `${name}第 ${r.part} 天的 ${n} 道做完了。` : `${name} ${n} 道，${right} 道一下就对。`;
    if (!failed && !fuzzy) return { head: r.part ? head : `${name} ${n} 道全对，一个提示都没看。`, detail: r.part ? `${right} 道一下就对。` : '这张卡越来越稳了。' };
    const parts = [];
    if (r.part) parts.push(`${right} 道一下就对`);
    if (fuzzy) parts.push(`${fuzzy} 道看了提示改对`);
    if (failed) parts.push(`${failed} 道还没过`);
    return { head, detail: `${parts.join('，')}。错的那几道 1 天后换个句子再考。` };
  }
  if (kind === 'mistakes') {
    const n = num(r.n), right = num(r.right);
    if (!n) return { head: '错题本里没有能再练的题。', detail: '拍一道新的错题，老师帮你讲。' };
    const head = right === n ? `${n} 道错题全做对了。` : `${n} 道错题，做对 ${right} 道。`;
    const detail = r.conquered ? `攻克了 ${r.conquered} 道。` : right < n ? '错的那道明天再考一道新题。' : r.left === 1 ? '再做对 1 次就攻克。' : '到日子再考，做对两次就攻克。';
    return { head, detail };
  }
  if (kind === 'read') {
    if (!r.done) return { head: '这一篇先读到这儿。', detail: '' };
    const n = num(r.n), right = num(r.right);
    return { head: `读完${r.label || '一篇'}。`, detail: n ? (right === n ? `${n} 道题都一下就对。` : `${n} 道题，${right} 道一下就对。`) : '' };
  }
  return { head: '练完了。', detail: '' };
}
