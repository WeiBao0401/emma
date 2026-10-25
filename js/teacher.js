// 老师的笔记本，第一块（design/teacher-next.md 6.3、6.4、6.5）：
//   1 “我问过的”：问老师讲过的点（老师回答最后那行 META 的 point / words）记进 kv 'teacher.asked'；讲完隔 2 天、5 天在热身里
//     各出一道对应的小题再考（askedReviewItems 给 plan）。做对了算真懂；做错了，下次她打开问老师，老师主动提一句
//     “上次讲的 X，换个讲法再说一遍”（retellOffer、retellAsk：换角度，对的和错的放在一起比，换新例子）。
//   2 每周想一次（thinkWeek）：每周第一次开课时（maybeThinkWeek，不挡课，后台跑）把上一周的证据压成一段摘要（作答、读的求助、
//     问老师、她自己说的、听写错词），发给问老师同一条线路的模型（Poe 填好走 GPT，否则百炼 qwen3.8-max），让它像资深老师一样写：
//     这周哪里进步了、哪里还卡着、下周怎么教（只能从现有内容里挑，最多 3 条）。存 kv 'teacher.week:<那周的周一>'，
//     并更新 kv 'teacher.stuck'（问老师的提示词会读它）。家长区看全文（ui-teacher.js）；孩子只看正面的一句（kidWeekLine）。
// 负责：问老师 agent（chat.js、chat-prompt.js、ui-chat.js、teacher.js、ui-teacher.js、css/chat.css、css/teacher.css）。
//
// 导出（常量）
//   ASKED_KEY 'teacher.asked'；STUCK_KEY 'teacher.stuck'；WEEK_PREFIX 'teacher.week:'；REVIEW_AFTER [2, 5]（讲完第几天再考）
//   STALE_DAYS 4（到期 4 天还没考到就往下走）；ASKED_MAX 40；RETELL_MAX 2（同一个点最多换讲法两次）；STUCK_MAX 5；NEXT_MAX 3
//   BUDGET_KIND 'reflect'（每周想一次的花费类别）；WEEK_KEEP 12（周想法留几周）；READ_ADJUST、TRANSFORM（下周怎么教的可选项）
//   WEEK_ASK、WEEK_ASK_OPTIONS（问老师里每周问一次“这周哪里最卡？”的按钮）
// 导出（日子）dayOf、addDays、daysBetween、mondayOf
// 导出（“我问过的”，纯函数，Node 里测）
//   emptyAsked()、normAsked(raw)、readAsked(kv)   kv 读不到、坏数据都读成空的
//   normPoint(p) -> 'there_be' | ''               认 'g:there_be'、'there be'；只认 chat-prompt.js POINTS 里的
//   askedKeys(meta) -> [{ key, type, point?, slug?, word?, label }]   这次回答讲到的点：point 一个；kind 是 word / pronounce 的
//       取 words 第 1 个，sentence / homework 取前 2 个；grammar / method / other 的 words 是例句里的词，不记
//   noteAsked(state, { meta, text, now, msg }) -> { state, keys }   记下讲过的点（同一天讲几次只算一次）：排在讲完第 2、5 天再考
//   pointCard(point, content?) -> { card, questions } | null   这个语法点对应的语法卡和题（卡的 points 先，再看题的 point；
//       subject_pronoun 当 personal_pronoun；article、preposition 这类没有卡的返回 null）
//   askedReviewItems(kv, now, { content, max = 2, grammar = 1, words = 1 }) -> [AskedItem]   今天热身里再考哪几道（给 plan）
//       AskedItem = { type: 'grammar', item: 'g:<卡>:<题>', card, qid, family, unit, point, mode: 'grammar', kind: 'practice', asked: key, label }
//                 | { type: 'word', slug, word, asked: key, label }
//       语法点：从那张卡的备用题里挑同一个语法点、她没做过的（按 key 和到期日固定，同一天结果一样）；做过一道就不再出，等 settle。
//       单词：给 slug，plan 只在单词本里有这个词时才放进热身。到期 STALE_DAYS 天还没考到就不再出。等着换讲法的不出。
//   settleAsked(state, { events, kv, content, now }) -> { state, changed: [key] }   热身做完以后对账：
//       语法点看事件（answer，mode grammar 或 order，done 那条，point 对得上，到期那天以后）或 kv 'grammar:<卡>' 里这个点的题；
//       单词看事件（answer 的 slug、first_try，或者听写）。第一次就对（grade 3）算对，进下一档；两档都对 closed 'learned'。
//       错了：记下哪道题、她选了什么、答案是什么，等着在问老师里换讲法（retell）；换过 RETELL_MAX 次还错，closed 'dropped'
//       （留给每周想一次，进“她卡在哪”）。到期过了 STALE_DAYS 天还没考到：记 skipped，往下走一档。
//   retellOffer(state, now) -> Entry | null   要在问老师里主动提的那一个（最近的一个，14 天以内）
//   retellAsk(entry) -> 发给模型的话（换个讲法的要求和她错的那道题）；retellLabel(entry) -> '上次讲的 there be，换个讲法再说一遍'
//   applyRetell(state, key, { accepted, now }) -> state   她点了“好，再讲一遍”（重新从今天起排 2、5 天）或“先不用”（照样再考）
//   askedLines(state, now) -> [句]   给问老师的提示词：讲过又错了的（要换讲法）、讲过以后都做对了的
//   askedSummary(state, now) -> [{ key, label, status, text }]   家长区看：status 'wait' | 'retell' | 'learned' | 'dropped' | 'stale'
// 导出（有状态）
//   syncAsked(app, { now }) -> Promise<state>   读事件对账，有变化写回 kv（问老师打开时、开课时、每周想一次以前调）
//   markRetell(kv, key, { accepted, now }) -> Promise<state>
// 导出（每周想一次）
//   lessonDaysIn(kv, from, to) -> ['YYYY-MM-DD']   kv 'day:<日子>' 有做完的格子的那几天
//   summarizeWeek(events, { kv, from, to, now, curriculum, words, lines, reader, triage }) -> Evidence   纯函数，见下
//   weekEvidence(app, { from, to, now, events }) -> Promise<Evidence>   读事件、阅读器的 triageSummary（有就用）
//   evidenceText(ev) -> string   发给模型、家长区“老师看到的”都用这段
//   buildMenu({ grammar, stories, order, transform }) -> [{ id, kind, label }]   下周怎么教的可选项：语法卡 card:<id>、阅读方法 method:<集>、
//       阅读调法 read:<id>（6.2 的调法）、连词成句 order:<句型>、句型转换 transform:<kind>（modes/order.js transformContent 的 kinds；
//       没读到就用 TRANSFORM 里的四类）
//   WEEK_SYSTEM；weekPrompt(ev, menu, { name }) -> 发给模型的那段
//   parseWeek(raw, menu, { now }) -> { progress, stuck, next, kid } | null   只认清单里的 id，最多 3 条；kid 只留正面的
//   mockWeek(ev, menu) -> 同形   模拟模式的假结果（不花钱）
//   mergeStuck(prev, stuck, { week, now }) -> kv 'teacher.stuck' 的新值（别的来源写的条目留着）
//   readWeek(kv, monday)、weekKeys(kv)、latestWeek(kv, { ok })
//   thinkWeek(app, { now, manual, from, to, fetchImpl, sleep }) -> Promise<WeekRecord>   想一次（家长区的按钮也走这里）；
//       失败抛 AIError（code 同 CONTRACTS 9.9，message 给家长看），已有的好结果不会被错误盖掉
//   maybeThinkWeek(app, { now, fetchImpl }) -> Promise<WeekRecord | null>   每周第一次开课时调，不用 await：上一周上过课、
//       还没想过（或者只想过半周）才想；失败一天最多再试一次、一周最多 3 次
//   kidWeekLine(kv, now) -> '' | '这周我们一起练……'   孩子端只显示这一句（上一周想的，说成“这周”）
//   weekRow(kv, now) -> { label, sub, value }   家长区那一行的字
//
// kv（都随备份导出；读不到、坏了都当空）
//   'teacher.asked' = { v: 1, items: { key: Entry }, updated }
//     Entry = { key: 'g:there_be' | 'w:carry', type: 'point' | 'word', point? | slug?、word?, label, q（她当时问的，前 40 字）, msg,
//               first, last（最近一次讲的那天）, n（讲过几天）, step（0 等第 2 天，1 等第 5 天）, due: 'YYYY-MM-DD' | '',
//               results: [{ day, ok, step, item?, skipped? }], retell: { day, item, stem, choice, answer, done?, declined? } | null,
//               retells, closed: '' | 'learned' | 'dropped', checks: { right, wrong }（问老师里小题答对答错）, updated }
//   'teacher.week:<周一>' = WeekRecord { v: 1, week, from, to, at, complete（整周都过完了才想的）, manual, model, provider, mock?,
//               days（上了几天课）, evidence（evidenceText）, progress: [{ text, evidence }], stuck: [{ text, evidence, point, words }],
//               next: [{ id, label, why }], kid, error?, detail?, tries? }   出错又没有好结果时只记 error / detail / tries
//   'teacher.stuck' = { v: 1, at, week, items: [{ text, evidence, since, point, words, source: 'week', week }], updated }
//               最多 5 条；source 不是 'week' 的条目（以后本机规则写的）原样留着
// 事件：不加新类型。“这周哪里最卡？”记 ask { step: 'chat', qid: 'chat_week', who: 'emma', answer, about: 'week_stuck:<id>' }（ui-chat.js）
// 依赖：grammar.js、events.js（isoLocal）、ai.js（AIError）、words.js（slugify）、chat-prompt.js（POINTS、POINT_LABEL、KIND_LABEL）；
//   想一次时按需 import chat.js（chatRoute、streamChat）、reader.js、modes/order.js，所以 chat.js 能静态 import 本文件，不会循环。

import * as G from './grammar.js';
import { isoLocal } from './events.js';
import { AIError } from './ai.js';
import { slugify } from './words.js';
import { POINTS, POINT_LABEL, KIND_LABEL } from './chat-prompt.js';

export const ASKED_KEY = 'teacher.asked';
export const STUCK_KEY = 'teacher.stuck';
export const WEEK_PREFIX = 'teacher.week:';
export const REVIEW_AFTER = [2, 5];
export const STALE_DAYS = 4;
export const ASKED_MAX = 40;
export const RETELL_MAX = 2;
export const STUCK_MAX = 5;
export const NEXT_MAX = 3;
export const BUDGET_KIND = 'reflect';
export const WEEK_KEEP = 12;
const OFFER_DAYS = 14;
const WEEK_TRIES = 3;

// ---------------------------------------------------------------- days (local)

const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : new Date(x));
export const dayOf = x => { const d = toDate(x); return isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12));
}
export function daysBetween(a, b) {
  const t = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 864e5);
}
export function mondayOf(x) {
  const day = isDay(x) ? x : dayOf(x);
  const [y, m, d] = day.split('-').map(Number);
  return addDays(day, -((new Date(y, m - 1, d, 12).getDay() + 6) % 7));
}
const md = day => String(day || '').slice(5, 10);
const evDay = e => (e && /^\d{4}-\d{2}-\d{2}/.test(String(e.at)) ? String(e.at).slice(0, 10) : dayOf(e && e.at));
const str = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const safe = (f, d = null) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
// curly quotes, no dashes as pauses (CLAUDE.md 写作)
const tidy = s => str(s, 400).replace(/\s*[—–]+\s*/g, '，').replace(/「/g, '“').replace(/」/g, '”').replace(/，，/g, '，').replace(/^，|，$/g, '');
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }

// ---------------------------------------------------------------- “我问过的”: state

export const emptyAsked = () => ({ v: 1, items: {}, updated: '' });

const RESULT_FIELDS = ['day', 'ok', 'step', 'item', 'skipped'];
function normEntry(key, x) {
  if (!x || typeof x !== 'object') return null;
  const type = /^g:./.test(key) ? 'point' : /^w:./.test(key) ? 'word' : '';
  if (!type) return null;
  const out = { key, type, label: str(x.label, 40) || key.slice(2).replace(/_/g, ' '), q: str(x.q, 40), msg: str(x.msg, 40),
    first: isDay(x.first) ? x.first : '', last: isDay(x.last) ? x.last : '', n: Math.max(0, num(x.n)),
    step: Math.min(REVIEW_AFTER.length, Math.max(0, num(x.step))), due: isDay(x.due) ? x.due : '',
    results: (Array.isArray(x.results) ? x.results : []).filter(r => r && isDay(r.day)).slice(-8)
      .map(r => Object.fromEntries(RESULT_FIELDS.filter(k => r[k] !== undefined && r[k] !== null && r[k] !== '').map(k => [k, r[k]]))),
    retell: x.retell && typeof x.retell === 'object' && isDay(x.retell.day) ? { ...x.retell } : null,
    retells: Math.max(0, num(x.retells)), closed: ['learned', 'dropped'].includes(x.closed) ? x.closed : '',
    checks: { right: Math.max(0, num(x.checks && x.checks.right)), wrong: Math.max(0, num(x.checks && x.checks.wrong)) },
    updated: str(x.updated, 40) };
  if (!out.first) out.first = out.last;
  if (type === 'point') out.point = key.slice(2);
  else { out.slug = key.slice(2); out.word = str(x.word, 40) || out.slug; }
  return out;
}
export function normAsked(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const items = {};
  for (const [k, v] of Object.entries(r.items && typeof r.items === 'object' ? r.items : {})) { const e = normEntry(k, v); if (e) items[k] = e; }
  return { v: 1, items, updated: str(r.updated, 40) };
}
export const readAsked = kv => normAsked(safe(() => kv.peek(ASKED_KEY, null)));

export function normPoint(p) {
  const s = String(p ?? '').trim().toLowerCase().replace(/^g:/, '').replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  return POINTS.includes(s) ? s : '';
}
const SKIP_WORDS = new Set(['a', 'an', 'the', 'is', 'am', 'are', 'be', 'i', 'you', 'it', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'he', 'she',
  'we', 'they', 'this', 'that', 'yes', 'no', 'not', 'do', 'does']);
const WORD_TAKE = { word: 1, pronounce: 1, sentence: 2, homework: 2 };
export function askedKeys(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const out = [];
  const p = normPoint(m.point);
  if (p) out.push({ key: 'g:' + p, type: 'point', point: p, label: POINT_LABEL[p] || p.replace(/_/g, ' ') });
  const take = WORD_TAKE[m.kind] || 0;
  let n = 0;
  for (const raw of Array.isArray(m.words) ? m.words : []) {
    if (n >= take) break;
    const w = String(raw ?? '').trim().toLowerCase().replace(/[’‘]/g, "'");
    if (!/^[a-z][a-z' -]{0,30}$/.test(w) || SKIP_WORDS.has(w)) continue;
    const slug = slugify(w);
    if (out.some(x => x.key === 'w:' + slug)) continue;
    out.push({ key: 'w:' + slug, type: 'word', slug, word: w, label: w });
    n++;
  }
  return out;
}

function trimAsked(items) {
  const list = Object.values(items);
  if (list.length <= ASKED_MAX) return items;
  // closed ones go first, then the ones explained longest ago
  list.sort((a, b) => (a.closed ? 0 : 1) - (b.closed ? 0 : 1) || String(a.last).localeCompare(String(b.last)));
  for (const e of list.slice(0, list.length - ASKED_MAX)) delete items[e.key];
  return items;
}

export function noteAsked(state, { meta = null, text = '', now = new Date(), msg = '' } = {}) {
  const st = normAsked(clone(state));
  const day = dayOf(now);
  const keys = askedKeys(meta);
  for (const k of keys) {
    const e = st.items[k.key] || normEntry(k.key, { label: k.label, word: k.word, first: day });
    e.label = k.label;
    if (e.last !== day) {
      e.n++;
      e.last = day;
      e.step = 0;
      e.due = addDays(day, REVIEW_AFTER[0]);
      e.closed = '';
      // she asked about it again: the teacher explains it again (the prompt tells it to change the approach)
      if (e.retell && !e.retell.done && !e.retell.declined) { e.retell.done = day; e.retells++; }
    }
    if (text) e.q = str(text, 40);
    if (msg) e.msg = str(msg, 40);
    if (k.type === 'point' && meta && (meta.check === 'right' || meta.check === 'wrong')) e.checks[meta.check]++;
    e.updated = isoLocal(toDate(now));
    st.items[k.key] = e;
  }
  if (keys.length) { trimAsked(st.items); st.updated = isoLocal(toDate(now)); }
  return { state: st, keys: keys.map(k => k.key) };
}

// ---------------------------------------------------------------- which grammar card and questions a point has

const POINT_ALIAS = { subject_pronoun: 'personal_pronoun', be_agree: 'be' };
const plainQs = card => [...(card.questions || []), ...(card.spares || [])].filter(q => q && !q.isVariant);
export function pointCard(point, c = G.content()) {
  const p = normPoint(point) || String(point || '').replace(/^g:/, '');
  if (!p || !c || !Array.isArray(c.cards)) return null;
  const gp = 'g:' + p;
  let card = c.cards.find(cd => (cd.points || []).includes(gp)) || null;
  let qs = card ? plainQs(card).filter(q => q.point === gp) : [];
  if (card && !qs.length) qs = plainQs(card);
  if (!card) {
    for (const cd of c.cards) { const m = plainQs(cd).filter(q => q.point === gp); if (m.length) { card = cd; qs = m; break; } }
  }
  if (!card && POINT_ALIAS[p]) return pointCard(POINT_ALIAS[p], c);
  return card && qs.length ? { card, questions: qs } : null;
}

const cardState = (gs, id) => (gs && gs.cards && gs.cards[id]) || null;
// a question of this point answered on or after `from` (kv 'grammar:<card>' keeps the last day and grade of each one)
function answeredSince(gs, pc, from) {
  const st = cardState(gs, pc.card.id);
  const items = (st && st.items) || {};
  const hit = pc.questions.filter(q => items[q.id] && isDay(items[q.id].last) && items[q.id].last >= from);
  if (!hit.length) return null;
  hit.sort((a, b) => String(items[a.id].last).localeCompare(String(items[b.id].last)));
  const q = hit[0], it = items[q.id];
  return { day: it.last, ok: !!it.clean || it.grade === 3, item: q.item, q };
}

function pickQuestion(e, c, gs) {
  const pc = pointCard(e.point, c);
  if (!pc) return null;
  const st = cardState(gs, pc.card.id);
  const items = (st && st.items) || {};
  const flagged = new Set((st && st.flagged) || []);
  let pool = pc.questions.filter(q => !flagged.has(q.id));
  const spares = pool.filter(q => q.spare);
  if (spares.length) pool = spares;
  const fresh = pool.filter(q => !items[q.id]);
  if (fresh.length) return fresh[hash(`${e.key}|${e.due}|${e.n}`) % fresh.length];
  pool = pool.slice().sort((a, b) => String(items[a.id].last).localeCompare(String(items[b.id].last)) || String(a.id).localeCompare(String(b.id)));
  return pool[0] || null;
}

const waitingRetell = e => !!(e.retell && !e.retell.done && !e.retell.declined);
const openDue = (e, day) => !e.closed && e.due && e.due <= day && !waitingRetell(e);

export function askedReviewItems(kv, now = new Date(), { content = null, max = 2, grammar: maxG = 1, words: maxW = 1 } = {}) {
  const st = readAsked(kv);
  const day = dayOf(now);
  const c = content || safe(() => G.content());
  const gs = c ? safe(() => G.grammarState(kv, c)) : null;
  const due = Object.values(st.items).filter(e => openDue(e, day) && daysBetween(e.due, day) <= STALE_DAYS)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)) || String(a.key).localeCompare(String(b.key)));
  const out = [];
  let nG = 0, nW = 0;
  for (const e of due) {
    if (out.length >= max) break;
    if (e.type === 'point') {
      if (!c || nG >= maxG) continue;
      const pc = pointCard(e.point, c);
      if (!pc || answeredSince(gs, pc, e.due)) continue;   // done already: settleAsked writes it down
      const q = pickQuestion(e, c, gs);
      if (!q) continue;
      out.push({ type: 'grammar', item: q.item, card: q.card, qid: q.id, family: q.family, unit: q.unit, point: q.point, mode: 'grammar',
        kind: 'practice', asked: e.key, label: e.label });
      nG++;
    } else {
      if (nW >= maxW) continue;
      out.push({ type: 'word', slug: e.slug, word: e.word, asked: e.key, label: e.label });
      nW++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- settling: did she get it right when it came back?

const GRADED_MODES = new Set(['grammar', 'order', 'transform']);
const WORD_MODES = new Set(['mc4', 'tiles', 'listen', 'keys', 'card', 'cloze']);
function evidenceFor(e, { events, gs, c, from }) {
  const list = (events || []).filter(x => x && evDay(x) >= from);
  if (e.type === 'point') {
    const gp = 'g:' + e.point;
    const pc = c ? pointCard(e.point, c) : null;
    const cardId = pc ? pc.card.id : '';
    const onlyCard = pc && !pc.questions.some(q => q.point === gp);   // a card-level point (present_simple): any of its questions
    const hit = list.filter(x => x.type === 'answer' && GRADED_MODES.has(x.mode) && x.done &&
      (x.point === gp || (onlyCard && x.card === cardId)));
    if (hit.length) {
      const d = hit[0];
      const first = list.find(x => x.type === 'answer' && x.item === d.item && x.first_try !== false) || d;
      const q = c && /^g:/.test(String(d.item)) ? safe(() => G.resolveWarmItem(d.item, c)) : null;
      const ok = d.grade !== undefined ? d.grade === 3 : !!(d.correct && d.first_try !== false);
      return { day: evDay(d), ok, item: d.item, choice: first.correct ? '' : str(first.choice, 60), stem: q ? str(q.stem || q.ask, 120) : '',
        answer: q ? str(q.answer, 60) : '' };
    }
    if (pc) {
      const k = answeredSince(gs, pc, from);
      if (k) return { day: k.day, ok: k.ok, item: k.item, choice: '', stem: str(k.q.stem || k.q.ask, 120), answer: str(k.q.answer, 60) };
    }
    return null;
  }
  const hit = list.find(x => x.slug === e.slug && ((x.type === 'answer' && x.first_try !== false && (!x.mode || WORD_MODES.has(x.mode))) || x.type === 'dictation'));
  if (!hit) return null;
  return { day: evDay(hit), ok: !!hit.correct, item: hit.item || 'w:' + e.slug, choice: hit.correct ? '' : str(hit.choice, 60), stem: '',
    answer: '', word: e.word };
}

export function settleAsked(state, { events = [], kv = null, content = null, now = new Date() } = {}) {
  const st = normAsked(clone(state));
  const day = dayOf(now);
  const c = content || safe(() => G.content());
  const gs = kv && c ? safe(() => G.grammarState(kv, c)) : null;
  const changed = [];
  for (const e of Object.values(st.items)) {
    if (!openDue(e, day)) continue;
    const ev = evidenceFor(e, { events, gs, c, from: e.due });
    if (ev) {
      e.results.push({ day: ev.day, ok: ev.ok, step: e.step, item: ev.item });
      e.results = e.results.slice(-8);
      if (ev.ok) {
        e.step++;
        if (e.step >= REVIEW_AFTER.length) { e.closed = 'learned'; e.due = ''; }
        else { const d = addDays(e.last, REVIEW_AFTER[e.step]); e.due = d > ev.day ? d : addDays(ev.day, 1); }
      } else if (e.retells >= RETELL_MAX) {
        e.closed = 'dropped';
        e.due = '';
      } else {
        e.retell = { day: ev.day, item: ev.item, stem: ev.stem, choice: ev.choice, answer: ev.answer };
        e.due = '';
      }
    } else if (daysBetween(e.due, day) > STALE_DAYS) {
      // no lesson brought it back in time: move on without a result
      e.results.push({ day, ok: false, step: e.step, skipped: true });
      e.results = e.results.slice(-8);
      e.step++;
      if (e.step >= REVIEW_AFTER.length) { e.due = ''; e.closed = e.results.some(r => r.ok) ? 'learned' : 'dropped'; }
      else { const d = addDays(e.last, REVIEW_AFTER[e.step]); e.due = d > day ? d : addDays(day, 1); }
    } else continue;
    e.updated = isoLocal(toDate(now));
    changed.push(e.key);
  }
  if (changed.length) st.updated = isoLocal(toDate(now));
  return { state: st, changed };
}

export async function syncAsked(app, { now = new Date() } = {}) {
  const kv = app.kv;
  const st = readAsked(kv);
  const day = dayOf(now);
  const open = Object.values(st.items).filter(e => openDue(e, day));
  if (!open.length) return st;
  const since = open.map(e => e.due).sort()[0];
  let events = [];
  try { events = (await app.events.query({ since, type: ['answer', 'dictation'] })) || []; } catch (e) { events = []; }
  const res = settleAsked(st, { events, kv, now });
  if (res.changed.length) { try { await kv.set(ASKED_KEY, res.state); } catch (e) { /* next time */ } }
  return res.state;
}

// ---------------------------------------------------------------- telling it again another way

export function retellOffer(state, now = new Date()) {
  const day = dayOf(now);
  const list = Object.values(normAsked(state).items).filter(e => !e.closed && waitingRetell(e) && daysBetween(e.retell.day, day) <= OFFER_DAYS);
  list.sort((a, b) => String(b.retell.day).localeCompare(String(a.retell.day)) || String(a.key).localeCompare(String(b.key)));
  return list[0] || null;
}
export const retellLabel = e => `上次讲的 ${e.label}，换个讲法再说一遍`;

export function retellAsk(e) {
  const r = (e && e.retell) || {};
  const asked = e.q ? `（我当时问的是“${e.q}”）` : '';
  if (e.type === 'word') {
    return `上次你给我讲过单词 ${e.word || e.label}${asked}。这几天热身里又考到它，我没做对` + (r.choice ? `（我选了 ${r.choice}）` : '') +
      '。请换一种办法帮我记住它：不要重复上次的说法；先说它在课本里的意思，再和一个容易混的词放在一起比一比，' +
      '给一个新的、只用我学过的词的例句；讲完再出一道小题考我。';
  }
  const miss = r.stem ? `题目是 ${r.stem}` + (r.choice ? `，我选了 ${r.choice}` : '') + (r.answer ? `，正确答案是 ${r.answer}` : '') : '';
  return `上次你给我讲过“${e.label}”${asked}。这几天热身里又考到这个点，我做错了${miss ? '：' + miss : ''}。` +
    '请换一种讲法再讲一遍：不要重复上次的说法；把对的和错的放在一起对比，说清楚区别在哪；举两个新的例子，只用我学过的词；讲完再出一道小题考我。';
}

export function applyRetell(state, key, { accepted = true, now = new Date() } = {}) {
  const st = normAsked(clone(state));
  const e = st.items[key];
  if (!e || !e.retell) return st;
  const day = dayOf(now);
  if (accepted) e.retell.done = day; else e.retell.declined = day;
  e.retells++;
  // either way it comes back in the warm-up: two days after the new explanation (or after she said not now)
  e.last = day;
  e.step = 0;
  e.due = addDays(day, REVIEW_AFTER[0]);
  e.updated = isoLocal(toDate(now));
  st.updated = e.updated;
  return st;
}
export async function markRetell(kv, key, { accepted = true, now = new Date() } = {}) {
  const st = applyRetell(readAsked(kv), key, { accepted, now });
  try { await kv.set(ASKED_KEY, st); } catch (e) { /* the question still goes */ }
  return st;
}

// lines for the chat prompt (chat.js gatherContext): what came back wrong (tell it another way) and what stuck
export function askedLines(state, now = new Date(), { max = 4 } = {}) {
  const day = dayOf(now);
  const all = Object.values(normAsked(state).items);
  const out = [];
  const wrong = all.filter(e => e.retell && daysBetween(e.retell.day, day) <= OFFER_DAYS)
    .sort((a, b) => String(b.retell.day).localeCompare(String(a.retell.day)));
  for (const e of wrong) {
    if (out.length >= max) break;
    const r = e.retell;
    const what = r.stem ? `（${r.stem}` + (r.choice ? ` 她选了 ${r.choice}` : '') + (r.answer ? `，答案是 ${r.answer}` : '') + '）' : r.choice ? `（她选了 ${r.choice}）` : '';
    out.push(`${e.type === 'word' ? '单词 ' : ''}${e.label}：${md(e.first || e.last)} 讲过，${md(r.day)} 热身里再考做错了${what}。` +
      (r.done ? `${md(r.done)} 换讲法又讲过一次。` : '') + '再讲这个点要换讲法：举不同的例子，从对比的角度讲。');
  }
  const good = all.filter(e => e.closed === 'learned' && e.results.some(r => r.ok) && daysBetween(e.results[e.results.length - 1].day, day) <= OFFER_DAYS);
  for (const e of good) {
    if (out.length >= max) break;
    out.push(`${e.type === 'word' ? '单词 ' : ''}${e.label}：${md(e.first || e.last)} 讲过，隔几天再考都做对了。可以具体夸她。`);
  }
  return out;
}

export function askedSummary(state, now = new Date()) {
  const day = dayOf(now);
  const all = Object.values(normAsked(state).items).sort((a, b) => String(b.last).localeCompare(String(a.last)));
  return all.slice(0, 12).map(e => {
    const last = e.results[e.results.length - 1];
    let status = 'wait', text = '';
    if (e.closed === 'learned') { status = 'learned'; text = '隔几天再考都做对了'; }
    else if (e.closed === 'dropped') { status = 'dropped'; text = '换讲法以后还是错，交给每周想一次'; }
    else if (waitingRetell(e)) { status = 'retell'; text = `${md(e.retell.day)} 再考做错了，等她打开问老师换个讲法`; }
    else if (e.due) {
      status = daysBetween(e.due, day) > STALE_DAYS ? 'stale' : 'wait';
      text = (last && last.ok ? `${md(last.day)} 再考做对了，` : '') + (e.due <= day ? '今天在热身里再考' : `${md(e.due)} 在热身里再考`);
    }
    return { key: e.key, label: (e.type === 'word' ? '单词 ' : '') + e.label, status, text: `${md(e.first || e.last)} 讲过` + (e.n > 1 ? `（问了 ${e.n} 天）` : '') + (text ? '，' + text : '') };
  });
}

// ---------------------------------------------------------------- 每周想一次: what the week shows

export function lessonDaysIn(kv, from, to) {
  let keys = [];
  try { keys = kv.keys('day:'); } catch (e) { keys = []; }
  return keys.map(k => k.slice(4)).filter(d => isDay(d) && d >= from && d <= to).filter(d => {
    const rec = safe(() => kv.peek('day:' + d, null));
    return !!(rec && rec.cells && Object.values(rec.cells).some(Boolean));
  }).sort();
}

const MODE_ZH = { mc4: '认词四选一', tiles: '字母块拼写', listen: '听音选词', keys: '键盘拼写', cloze: '填空', grammar: '语法题', read: '读后题',
  order: '连词成句', card: '闪卡', paper: '纸笔', transform: '句型转换', verb: '找动词' };
const WORD_TAGS = new Set(['form', 'category', 'meaning', 'sound']);
// 0.5.0: on a sentence with a trunk the first tap of 看不懂 shows the trunk, the second the chunks and key words
const HELP_ZH = { 1: '要看主干或断句', 2: '要看断句或关键词', 3: '要看整句中文' };
const SKILL_ZH = { detail: '找细节', infer: '想一想', main: '这集讲什么', word: '词的意思', meaning: '看前后句猜词义', cloze: '用目标词填空',
  ref: '指的是谁', order: '先后顺序', who: '谁说的', tf: '对还是错', locate: '点出答案句', refer: '指代' };
export const WEEK_ASK = '这周学下来，哪里最卡？';
const HARD_ZH = { words: '生词太多', sentences: '句子太长看不懂', find: '找不到答案', ok: '都还好' };
export const WEEK_ASK_OPTIONS = [
  { id: 'words', label: '生词多' }, { id: 'sentence', label: '句子看不懂' }, { id: 'grammar', label: '语法题' },
  { id: 'method', label: '题不会找' }, { id: 'fine', label: '都还行' },
];
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const bump = (map, k, by = 1) => map.set(k, (map.get(k) || 0) + by);

export function summarizeWeek(events = [], { kv = null, from = '', to = '', now = new Date(), curriculum = null, words = null, lines = null,
  reader = null, triage = null, asked = null } = {}) {
  const evs = (events || []).filter(e => e && (!from || evDay(e) >= from) && (!to || evDay(e) <= to));
  const tagZh = t => safe(() => curriculum && curriculum.tags && curriculum.tags[t] && curriculum.tags[t].zh) ||
    safe(() => { const c = G.content(); return c && c.tagName ? c.tagName(t) : ''; }) || t;
  const pointZh = p => { const id = String(p || '').replace(/^g:/, ''); return POINT_LABEL[id] || safe(() => curriculum && curriculum.grammarName && curriculum.grammarName('g:' + id)) || id; };
  const wordOf = slug => safe(() => { const e = words && words.get && words.get(slug); return e && e.headword; }) || String(slug || '').replace(/-/g, ' ');

  // answers: first tries only
  const byMode = new Map(), right = new Map(), tags = new Map(), pts = new Map(), ptsWrong = new Map(), wrongWords = new Map(), skills = new Map(), skillsWrong = new Map();
  for (const e of evs) {
    if (e.type !== 'answer' || e.first_try === false) continue;
    const m = e.mode || 'mc4';
    bump(byMode, m);
    if (e.correct) bump(right, m);
    if (!e.correct && e.misconception && !WORD_TAGS.has(e.misconception)) bump(tags, e.misconception);
    if (m === 'grammar' && e.point) { bump(pts, e.point); if (!e.correct) bump(ptsWrong, e.point); }
    if (!e.correct && e.slug && WORD_MODES.has(m)) bump(wrongWords, e.slug);
    if (m === 'read' && (e.qtype || e.skill)) { const k = e.qtype || e.skill; bump(skills, k); if (!e.correct) bump(skillsWrong, k); }
  }
  const answers = {
    byMode: [...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([mode, n]) => ({ mode, name: MODE_ZH[mode] || mode, n, right: right.get(mode) || 0 })),
    misconceptions: top(tags, 5).map(([tag, n]) => ({ tag, zh: tagZh(tag), n })),
    grammar: top(pts, 6).map(([point, n]) => ({ point, label: pointZh(point), n, wrong: ptsWrong.get(point) || 0 })),
    wrongWords: top(wrongWords, 8).map(([slug, n]) => ({ slug, w: wordOf(slug), n })),
  };

  // reading: the reader's own triage when it has one, the raw help counts always
  const helps = { 1: 0, 2: 0, 3: 0 };
  const hardS = new Map();
  let lookups = 0;
  const looked = new Map();
  for (const e of evs) {
    if (e.type === 'read_help' && (e.kind || 'sentence') === 'sentence') {
      const lv = Math.min(3, Math.max(1, num(e.level, 1)));
      helps[lv]++;
      const k = `${e.episode || ''}|${e.sentence}`;
      const prev = hardS.get(k);
      if (!prev || prev.level < lv) hardS.set(k, { ep: e.episode, i: num(e.sentence), level: lv, point: e.point || '' });
    }
    if (e.type === 'lookup' && (e.from === 'story' || e.from === 'read')) { lookups++; if (e.query) bump(looked, str(e.query, 30).toLowerCase()); }
  }
  const sentenceEn = (ep, i) => safe(() => {
    const c = reader && reader.content ? reader.content() : null;
    const x = c && c.episode ? c.episode(ep) : null;
    const s = x && (x.sentences || []).find(y => y.i === i);
    return s ? s.en : '';
  }) || '';
  const reading = {
    helps, lookups, looked: top(looked, 8).map(([w]) => w),
    hard: [...hardS.values()].sort((a, b) => b.level - a.level || String(a.ep).localeCompare(String(b.ep)) || a.i - b.i).slice(0, 3)
      .map(x => ({ ...x, en: sentenceEn(x.ep, x.i), point: x.point ? pointZh(x.point) : '' })),
    bySkill: [...skills.entries()].map(([k, n]) => ({ skill: k, name: SKILL_ZH[k] || k, n, wrong: skillsWrong.get(k) || 0 })),
    triage: triage || null,
  };

  // 问老师
  const kinds = new Map(), cpts = new Map();
  const questions = [];
  let checkR = 0, checkW = 0, flags = 0, nChat = 0;
  for (const e of evs) {
    if (e.type === 'flag' && e.reason === 'chat') flags++;
    if (e.type !== 'ask' || e.step !== 'chat' || e.qid === 'chat_week') continue;
    if (e.check === 'right') checkR++;
    if (e.check === 'wrong') checkW++;
    if (e.followup) continue;
    nChat++;
    bump(kinds, e.kind || 'other');
    if (e.point) bump(cpts, e.point);
    if (e.q && questions.length < 12) questions.push({ q: str(e.q, 40), topic: str(e.topic, 30), day: evDay(e) });
  }
  const st = asked || (kv ? readAsked(kv) : emptyAsked());
  const reviews = [];
  for (const e of Object.values(st.items)) {
    for (const r of e.results) if ((!from || r.day >= from) && (!to || r.day <= to) && !r.skipped) reviews.push({ label: (e.type === 'word' ? '单词 ' : '') + e.label, ok: !!r.ok, day: r.day });
  }
  const chat = {
    n: nChat, byKind: top(kinds, 7).map(([kind, n]) => ({ kind, label: KIND_LABEL[kind] || kind, n })),
    points: top(cpts, 4).map(([point, n]) => ({ point, label: pointZh(point), n })),
    questions: questions.slice(-3), checks: { right: checkR, wrong: checkW }, flags, reviews: reviews.sort((a, b) => a.day.localeCompare(b.day)).slice(-6),
  };

  // what she said herself (the buttons after a story, 这周哪里最卡, the first week's questions)
  const said = new Map();
  for (const e of evs) {
    if (e.type !== 'ask' || (e.step === 'chat' && e.qid !== 'chat_week') || !e.qid || e.answer === 'skip') continue;
    let label = '';
    if (e.qid === 'chat_week') label = `${WEEK_ASK}${(WEEK_ASK_OPTIONS.find(o => o.id === e.answer) || {}).label || e.answer}`;
    else if (e.qid === ((reader && reader.HARD_QID) || 'read_hard')) {
      const o = ((reader && reader.HARD_OPTIONS) || []).find(x => x.id === e.answer);
      label = `读完问“今天哪里最难？”：${(o && o.zh) || HARD_ZH[e.answer] || e.answer}`;
    } else {
      const q = safe(() => lines && lines.question ? lines.question(e.qid) : null);
      const opt = q && Array.isArray(q.options) ? q.options.find(o => o.id === e.answer) : null;
      label = q ? `${str(q.zh || q.en, 30)}：${str((opt && (opt.zh || opt.en)) || e.about || e.answer, 30)}` : `${e.qid}：${str(e.about || e.answer, 40)}`;
    }
    bump(said, label);
  }

  // dictation
  const dWrong = new Map();
  let dN = 0;
  for (const e of evs) if (e.type === 'dictation') { dN++; if (e.correct === false && e.slug) bump(dWrong, e.slug); }

  const days = kv && from && to ? lessonDaysIn(kv, from, to) : [];
  let cards = [];
  try {
    const c = G.content();
    if (c && kv) cards = (G.summary(G.grammarState(kv, c), toDate(now), { content: c, tags: curriculum && curriculum.tags }) || [])
      .filter(s => s.status && s.status !== 'new').map(s => ({ title: s.title, status: s.status }));
  } catch (e) { cards = []; }
  const stuckBefore = kv ? readStuck(kv).items.map(x => x.text).slice(0, STUCK_MAX) : [];
  return {
    from, to, days: days.length, lessonDays: days, answers, reading, chat,
    said: top(said, 6).map(([label, n]) => ({ label, n })),
    dictation: { n: dN, wrong: top(dWrong, 12).map(([slug]) => wordOf(slug)) },
    cards, stuckBefore,
  };
}

const STATUS_ZH = { learning: '在学', practicing: '在练', steady: '练稳了' };
export function evidenceText(ev) {
  const x = ev || {};
  const L = [];
  L.push(`时间：${x.from || '?'} 到 ${x.to || '?'}，上了 ${x.days || 0} 天课。`);
  const a = x.answers || {};
  L.push('【作答（第一次就答对的 / 一共）】');
  if ((a.byMode || []).length) L.push('- ' + a.byMode.map(m => `${m.name} ${m.right} / ${m.n}`).join('；'));
  else L.push('- 这周没有作答记录');
  if ((a.misconceptions || []).length) L.push('- 选错时常见的误解：' + a.misconceptions.map(m => `${m.zh}（${m.n} 次）`).join('、'));
  if ((a.grammar || []).length) L.push('- 语法题按语法点：' + a.grammar.map(g => `${g.label} 错 ${g.wrong} / ${g.n}`).join('；'));
  if ((a.wrongWords || []).length) L.push('- 第一次答错的词：' + a.wrongWords.map(w => `${w.w}（${w.n} 次）`).join('、'));
  const r = x.reading || {};
  L.push('【读的时候求助】');
  const h = r.helps || {};
  const helpN = num(h[1]) + num(h[2]) + num(h[3]);
  L.push(helpN || r.lookups ? `- 点“看不懂”：${[1, 2, 3].map(k => `${HELP_ZH[k]} ${num(h[k])} 次`).join('、')}；在故事里点词 ${num(r.lookups)} 次` +
    ((r.looked || []).length ? `（${r.looked.join('、')}）` : '') : '- 这周读故事没有求助记录');
  for (const s of r.hard || []) L.push(`- 卡住的句子：${s.en ? '“' + s.en + '”' : `第 ${s.ep} 集第 ${s.i} 句`}（${s.stepZh || HELP_ZH[s.level] || '点过看不懂'}${s.point ? '，' + s.point : ''}）`);
  if ((r.bySkill || []).length) L.push('- 读后题按题型（错 / 做）：' + r.bySkill.map(b => `${b.name} ${b.wrong} / ${b.n}`).join('；'));
  if (r.triage) L.push('- 阅读器的分诊：' + triageText(r.triage));
  const c = x.chat || {};
  L.push('【问老师】');
  if (c.n) {
    L.push(`- 问了 ${c.n} 个问题：` + (c.byKind || []).map(k => `${k.label} ${k.n}`).join('、') + ((c.points || []).length ? `；讲到的语法点：${c.points.map(p => `${p.label} ${p.n} 次`).join('、')}` : ''));
    for (const q of c.questions || []) L.push(`- 原问题：“${q.q}”（${q.topic || '别的'}，${md(q.day)}）`);
  } else L.push('- 这周没有问');
  if (num(c.checks && c.checks.right) || num(c.checks && c.checks.wrong)) L.push(`- 老师出的确认小题：答对 ${c.checks.right} 次，答错 ${c.checks.wrong} 次`);
  if (c.flags) L.push(`- 点了“和学校讲的不一样” ${c.flags} 次`);
  if ((c.reviews || []).length) L.push('- 讲过以后隔几天再考：' + c.reviews.map(v => `${v.label} ${md(v.day)} ${v.ok ? '对了' : '错了'}`).join('；'));
  if ((x.said || []).length) { L.push('【她自己说的】'); for (const s of x.said) L.push(`- ${s.label}` + (s.n > 1 ? `（${s.n} 次）` : '')); }
  const d = x.dictation || {};
  if (d.n) { L.push('【听写】'); L.push(`- 打了 ${d.n} 个勾` + ((d.wrong || []).length ? `，写错的词：${d.wrong.join('、')}` : '，都写对了')); }
  if ((x.cards || []).length) L.push('【语法卡】' + x.cards.map(k => `${k.title}：${STATUS_ZH[k.status] || k.status}`).join('；'));
  if ((x.stuckBefore || []).length) L.push('【上次记下的卡点】' + x.stuckBefore.join('；'));
  return L.join('\n');
}
function triageText(t) {
  if (typeof t === 'string') return str(t, 300);
  if (t && typeof t === 'object' && typeof t.line === 'string') {
    // reader.js triageSummary: one line, then the sentences she got stuck on and the words she tapped
    const bits = [str(t.line, 200)];
    const ss = (Array.isArray(t.sentences) ? t.sentences : []).slice(0, 3).map(x => (x && x.en ? `“${str(x.en, 80)}”` + (x.n ? `（第 ${x.n} 集）` : '') : '')).filter(Boolean);
    if (ss.length) bits.push('卡住的句子：' + ss.join(' '));
    if (Array.isArray(t.words) && t.words.length) bits.push('点过的词：' + t.words.slice(0, 8).join('、'));
    if (t.agree === false) bits.push('她自己说的和数据不一样');
    return bits.join('；').slice(0, 500);
  }
  if (Array.isArray(t)) return t.slice(0, 6).map(v => (typeof v === 'string' ? str(v, 80) : str(JSON.stringify(v), 80))).join('；');
  const parts = [];
  for (const [k, v] of Object.entries(t || {})) {
    if (typeof v === 'number') parts.push(`${k} ${v}`);
    else if (typeof v === 'string') parts.push(`${k}：${str(v, 60)}`);
    else if (Array.isArray(v)) parts.push(`${k}：${v.slice(0, 3).map(y => (typeof y === 'string' ? str(y, 50) : str((y && (y.en || y.text || y.label)) || JSON.stringify(y), 50))).join(' / ')}`);
    else if (v && typeof v === 'object') parts.push(`${k}：${str(JSON.stringify(v), 80)}`);
  }
  return parts.join('；').slice(0, 400);
}

// ---------------------------------------------------------------- 下周怎么教: what the teacher may pick from

export const READ_ADJUST = [
  { id: 'read:split', label: '阅读调法：读前先示范拆一句同类的句子，这类句子先显示断句' },
  { id: 'read:question_first', label: '阅读调法：先给问题再读，提示先说“找题目里的关键词”' },
  { id: 'read:refer', label: '阅读调法：每集加一道指代题（she、it 指谁）' },
  { id: 'read:words_first', label: '阅读调法：读的时候查过的小学词进热身，读前先见一面' },
  { id: 'read:listen', label: '阅读调法：多听着读，不加长度' },
  { id: 'read:shorter', label: '阅读调法：下一集短一点，题减到 2 道' },
];
// the kinds in curriculum/transform.json (modes/order.js transformContent); used when that file did not load
export const TRANSFORM = [
  { id: 'transform:yn_q', label: '句型转换：一般疑问句（变成一般疑问句）' },
  { id: 'transform:neg', label: '句型转换：否定句（变成否定句）' },
  { id: 'transform:wh_q', label: '句型转换：特殊疑问句（对划线部分提问）' },
  { id: 'transform:third', label: '句型转换：主语换成三单' },
];
export function buildMenu({ grammar = null, stories = null, order = null, transform = null } = {}) {
  const out = [];
  const g = grammar || safe(() => G.content());
  for (const card of (g && g.cards) || []) out.push({ id: 'card:' + card.id, kind: 'card', label: `语法卡：${card.title}` });
  for (const ep of (stories && stories.episodes) || []) {
    const t = ep.tip || ep.method;
    if (t && t.title) out.push({ id: 'method:' + ep.id, kind: 'method', label: `阅读方法：${t.title}（第 ${ep.n} 集）` });
  }
  out.push(...READ_ADJUST.map(x => ({ ...x, kind: 'read' })));
  for (const [id, p] of Object.entries((order && order.patterns) || {})) if (p && p.name) out.push({ id: 'order:' + id, kind: 'order', label: `连词成句：${p.name}` });
  const kinds = transform && transform.kinds && typeof transform.kinds === 'object' ? Object.entries(transform.kinds).filter(([, k]) => k && k.name) : [];
  if (kinds.length) for (const [id, k] of kinds) out.push({ id: 'transform:' + id, kind: 'transform', label: `句型转换：${k.name}` + (k.task && k.task !== k.name ? `（${k.task}）` : '') });
  else out.push(...TRANSFORM.map(x => ({ ...x, kind: 'transform' })));
  return out;
}

export const WEEK_SYSTEM = `你是一位教了二十年初中英语的老师，在给自己的学生写每周的教学笔记。
她在北京上初一，课本是外研版（2024 新版）七年级上册，期中考 Starter 到 Unit 3。她英语基础弱：阅读常常看不懂，语法没学明白，单词量不够。
下面是 App 记下的她这一周的证据，只有数字和她的原话，没有判断。请你看着证据写判断：

1. progress：她这周哪里进步了。1 到 3 条，每条具体到语法点、词或句型，写出证据（比如“be 动词：热身 4 道都第一次就对”）。证据不够就少写，不要编。
2. stuck：哪里还卡着。1 到 3 条，具体到语法点、词、句型或读题的方法，每条写出证据。不同来源对得上的（作答错 there be，问老师也问 there be）更有把握。只出现一次的不算卡点。
3. next：下周怎么教。最多 3 条，只能从“可选的教法”里挑，写它的 id，最该先做的放前面；每条一句话说为什么，对着哪个卡点。
4. kid：给她看的一句话，用“下周我们一起练”开头，只说要一起练的具体内容，语气温和，不提错、不会、差，30 个字以内。

只输出一个 JSON 对象，不要别的字，不要代码块：
{"progress":[{"text":"…","evidence":"…"}],"stuck":[{"text":"…","evidence":"…","point":"there_be","words":["carry"]}],"next":[{"id":"card:there_be","why":"…"}],"kid":"下周我们一起练……"}
point 从这些里选一个，不是语法就写 ""：${POINTS.join('、')}。words 最多 3 个英文单词，没有就写 []。
中文用弯引号“ ”，不用破折号。`;

export function weekPrompt(ev, menu, { name = 'Emma' } = {}) {
  return [`学生：${name}`, '', '【这一周的证据】', evidenceText(ev), '', '【可选的教法】（next 只能写这里的 id）',
    ...(menu || []).map(m => `- ${m.id}：${m.label}`)].join('\n');
}

const NEG = /不会|不懂|没懂|错|差|弱|卡|不好|粗心|退步|问题|不行/;
function kidLineOf(raw, next, menu) {
  let s = tidy(raw).replace(/^["“]|["”]$/g, '');
  if (s && !/^(下周|这周)/.test(s)) s = '下周我们一起练' + s.replace(/^我们一起练/, '');
  if (!s || NEG.test(s) || s.length > 40) {
    const first = (next || [])[0];
    const item = first && (menu || []).find(m => m.id === first.id);
    const what = item ? item.label.replace(/^[^：]+：/, '').replace(/（第 \d+ 集）$/, '') : '';
    s = what ? `下周我们一起练“${what.slice(0, 18)}”，一步一步来。` : '下周我们一起接着练，一步一步来。';
  }
  if (!/[。！？]$/.test(s)) s += '。';
  return s;
}

export function parseWeek(raw, menu = [], { now = new Date() } = {}) {
  const s = String(raw ?? '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o = null;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const items = v => (Array.isArray(v) ? v : v ? [v] : []);
  const line = x => (typeof x === 'string' ? { text: tidy(x) } : x && typeof x === 'object' ? { text: tidy(x.text || x.what || ''), evidence: tidy(x.evidence || x.why || '') } : null);
  const progress = items(o.progress).map(line).filter(x => x && x.text).slice(0, 3).map(x => ({ text: x.text.slice(0, 100), evidence: (x.evidence || '').slice(0, 140) }));
  const stuck = items(o.stuck).map(x => {
    const l = line(x);
    if (!l || !l.text) return null;
    const words = (x && Array.isArray(x.words) ? x.words : []).map(w => String(w ?? '').trim().toLowerCase()).filter(w => /^[a-z][a-z' -]{0,30}$/.test(w)).slice(0, 3);
    return { text: l.text.slice(0, 100), evidence: (l.evidence || '').slice(0, 140), point: normPoint(x && x.point), words };
  }).filter(Boolean).slice(0, STUCK_MAX);
  const ids = new Map((menu || []).map(m => [m.id, m]));
  const seen = new Set();
  const next = items(o.next).map(x => (typeof x === 'string' ? { id: x } : x)).filter(x => x && ids.has(String(x.id).trim()))
    .filter(x => { const id = String(x.id).trim(); if (seen.has(id)) return false; seen.add(id); return true; })
    .slice(0, NEXT_MAX).map(x => ({ id: String(x.id).trim(), label: ids.get(String(x.id).trim()).label, why: tidy(x.why || x.reason || '').slice(0, 120) }));
  if (!progress.length && !stuck.length && !next.length) return null;
  return { progress, stuck, next, kid: kidLineOf(o.kid, next, menu) };
}

export function mockWeek(ev, menu = []) {
  const a = (ev && ev.answers) || {};
  const best = (a.byMode || []).filter(m => m.n >= 3).sort((x, y) => y.right / y.n - x.right / x.n)[0];
  const progress = best ? [{ text: `${best.name}，第一次就答对的多了`, evidence: `这周 ${best.right} / ${best.n}（模拟模式，假的）` }]
    : [{ text: `这周上了 ${(ev && ev.days) || 0} 天课`, evidence: '模拟模式，假的' }];
  const g = (a.grammar || []).filter(x => x.wrong).sort((x, y) => y.wrong - x.wrong)[0];
  const tag = (a.misconceptions || [])[0];
  const stuck = g ? [{ text: `${g.label} 还不稳`, evidence: `语法题错 ${g.wrong} / ${g.n}（模拟模式，假的）`, point: normPoint(g.point), words: [] }]
    : tag ? [{ text: `${tag.zh} 还会选错`, evidence: `这周 ${tag.n} 次（模拟模式，假的）`, point: '', words: [] }]
      : [{ text: '证据还不够，下周再看', evidence: '模拟模式，假的', point: '', words: [] }];
  const card = g ? pointCard(g.point) : null;
  const pick = [card ? 'card:' + card.card.id : '', (menu.find(m => m.kind === 'method') || {}).id, 'read:split'].filter(id => id && menu.some(m => m.id === id));
  const next = [...new Set(pick)].slice(0, 2).map(id => ({ id, label: menu.find(m => m.id === id).label, why: '模拟模式，假的' }));
  const what = next[0] ? next[0].label.replace(/^[^：]+：/, '').replace(/（第 \d+ 集）$/, '').slice(0, 16) : '读故事';
  return { progress, stuck, next, kid: kidLineOf('下周我们一起练' + (/^[A-Za-z]/.test(what) ? ' ' : '') + what + '。', next, menu) };
}

// ---------------------------------------------------------------- kv for the week

export function normStuck(raw) {
  const r = raw && typeof raw === 'object' ? raw : Array.isArray(raw) ? { items: raw } : {};
  const items = (Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [])
    .map(x => (typeof x === 'string' ? { text: str(x, 120) } : x && typeof x === 'object' ? { ...x, text: str(x.text || x.label || x.what, 120) } : null))
    .filter(x => x && x.text);
  return { v: 1, at: str(r.at, 40), week: isDay(r.week) ? r.week : '', items, updated: str(r.updated, 40) };
}
export const readStuck = kv => normStuck(safe(() => kv.peek(STUCK_KEY, null)));

export function mergeStuck(prev, stuck = [], { week = '', now = new Date() } = {}) {
  const old = normStuck(prev);
  const others = old.items.filter(x => x.source && x.source !== 'week');
  const fresh = (stuck || []).slice(0, STUCK_MAX).map(x => {
    const same = old.items.find(o => (x.point && o.point === x.point) || o.text === x.text);
    return { text: x.text, evidence: x.evidence || '', since: (same && isDay(same.since) && same.since) || week || dayOf(now),
      point: x.point || '', words: x.words || [], source: 'week', week };
  });
  const at = isoLocal(toDate(now));
  return { v: 1, at, week, items: [...fresh, ...others].slice(0, STUCK_MAX), updated: at };
}

export const weekKeys = kv => safe(() => kv.keys(WEEK_PREFIX).filter(k => isDay(k.slice(WEEK_PREFIX.length))).sort(), []);
export function readWeek(kv, monday) {
  const r = safe(() => kv.peek(WEEK_PREFIX + monday, null));
  return r && typeof r === 'object' ? r : null;
}
const good = r => !!(r && !r.error && (Array.isArray(r.progress) || Array.isArray(r.stuck) || Array.isArray(r.next)));
export function latestWeek(kv, { ok = true } = {}) {
  for (const k of weekKeys(kv).reverse()) { const r = readWeek(kv, k.slice(WEEK_PREFIX.length)); if (r && (!ok || good(r))) return r; }
  return null;
}

export function kidWeekLine(kv, now = new Date()) {
  const thisMon = mondayOf(now);
  const r = latestWeek(kv);
  if (!r || !r.kid || !isDay(r.week)) return '';
  if (daysBetween(r.week, thisMon) > 7) return '';   // only last week's or this week's
  // a think about last week is read in this week: “下周” becomes “这周”
  return r.week < thisMon ? String(r.kid).replace(/^下周/, '这周') : String(r.kid);
}

export function weekRow(kv, now = new Date()) {
  const r = latestWeek(kv);
  if (!r) return { label: '老师每周想一次', sub: '每周第一次上课时，老师把上一周的作答、读的求助、问过的问题想一遍', value: '还没想过' };
  const first = (r.stuck || [])[0];
  return { label: '老师每周想一次', sub: first ? `还卡着：${first.text}` : (r.progress || [])[0] ? `进步了：${r.progress[0].text}` : '看看老师怎么想的',
    value: `${md(r.from)} 那周` };
}

// ---------------------------------------------------------------- thinking about the week

async function loadMods() {
  const [C, R, O] = await Promise.all([import('./chat.js'), import('./reader.js').catch(() => null), import('./modes/order.js').catch(() => null)]);
  return { C, R, O };
}
function settingsOf(app, C) {
  let s = {};
  try { s = (app.settings && app.settings()) || {}; } catch (e) { s = {}; }
  let forced = false;
  try { forced = !!(app.mockForced && app.mockForced()); } catch (e) { forced = false; }
  return { ...(C.CHAT_DEFAULTS || {}), ...s, mock: !!s.mock || forced };
}

export async function weekEvidence(app, { from, to, now = new Date(), events = null, reader = null } = {}) {
  let evs = events;
  if (!evs) { try { evs = (await app.events.query({ since: from, until: to })) || []; } catch (e) { evs = []; } }
  let R = reader;
  if (!R) { try { R = await import('./reader.js'); } catch (e) { R = null; } }
  let triage = null;
  if (R && typeof R.triageSummary === 'function') {
    // reader.js: triageSummary(kv, { now, days }) counts the last `days` days up to `now`
    const end = to < dayOf(now) ? new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)), 23, 59) : toDate(now);
    try { triage = await R.triageSummary(app.kv, { now: end, days: daysBetween(from, to) + 1, events: evs }); } catch (e) { triage = null; }
  }
  return summarizeWeek(evs, { kv: app.kv, from, to, now, curriculum: app.curriculum, words: app.words, lines: app.lines, reader: R, triage });
}

const busy = new Map();   // week -> promise (one think at a time per week)

export async function thinkWeek(app, { now = new Date(), manual = false, from = '', to = '', fetchImpl = null, sleep } = {}) {
  const kv = app.kv;
  const today = dayOf(now);
  if (!from) {
    from = mondayOf(today);
    to = today;
    // early in a week with nothing yet: think about last week instead
    if (!lessonDaysIn(kv, from, to).length && !safe(() => kv.keys('chat:').some(k => k.slice(5) >= from), false)) { from = addDays(from, -7); to = addDays(from, 6); }
  }
  if (!to) to = addDays(from, 6);
  const week = mondayOf(from);
  if (busy.has(week)) return busy.get(week);
  const job = (async () => {
    const { C, R, O } = await loadMods();
    try { await syncAsked(app, { now }); } catch (e) { /* the week still gets thought about */ }
    const ev = await weekEvidence(app, { from, to, now, reader: R });
    const menu = buildMenu({ grammar: safe(() => G.content()), stories: R && R.content ? safe(() => R.content()) : null, order: O && O.content ? safe(() => O.content()) : null,
      transform: O && O.transformContent ? safe(() => O.transformContent()) : null });
    const s = settingsOf(app, C);
    const prev = readWeek(kv, week);
    const base = { v: 1, week, from, to, at: isoLocal(toDate(now)), complete: to >= addDays(week, 6) && today > to, manual: !!manual,
      days: ev.days, evidence: evidenceText(ev) };
    let out = null, model = '', provider = '', mock = false;
    try {
      if (s.mock) { out = mockWeek(ev, menu); model = 'mock'; mock = true; }
      else {
        const route = C.chatRoute(s, { image: false });
        if (!route.url || !route.key) throw new AIError(route.provider === 'poe' ? '问老师设成了 Poe，但还没填中转站地址和 Poe Key。' : '还没填百炼 API Key：先在家长区填好。', 'nokey');
        const why = app.budget && app.budget.blockReason ? app.budget.blockReason(BUDGET_KIND) : '';
        if (why) throw new AIError(why === 'month' ? '今天已经收到过百炼的“预算用完”（429），今天不再发请求。' : '今天的花费到了上限，明天再想。', why === 'month' ? 'budget' : 'budget-day');
        const name = str(safe(() => (kv.peek('profile', {}) || {}).name), 20) || 'Emma';
        const messages = [{ role: 'system', content: WEEK_SYSTEM }, { role: 'user', content: weekPrompt(ev, menu, { name }) }];
        const res = await C.streamChat({ route, messages, fetchImpl, budget: app.budget, ...(sleep ? { sleep } : {}) });
        model = res.model || route.model;
        provider = route.provider;
        try { if (app.budget && app.budget.record) app.budget.record(res.usage || C.estimateUsage(messages, res.text), BUDGET_KIND, model); } catch (e) { /* bookkeeping only */ }
        out = parseWeek(res.text, menu, { now });
        if (!out) throw new AIError('老师写的周想法读不出来，再试一次。', 'incomplete');
      }
    } catch (err) {
      // a good earlier result is never replaced by an error
      if (!good(prev)) {
        const fail = { ...base, error: (err && err.code) || 'http', detail: str((err && err.message) || err, 200), tries: num(prev && prev.tries) + 1 };
        try { await kv.set(WEEK_PREFIX + week, fail); } catch (e) { /* bookkeeping only */ }
      }
      throw err;
    }
    const rec = { ...base, model, provider, ...(mock ? { mock: true } : {}), ...out };
    await kv.set(WEEK_PREFIX + week, rec);
    try { await kv.set(STUCK_KEY, mergeStuck(safe(() => kv.peek(STUCK_KEY, null)), out.stuck, { week, now })); } catch (e) { /* next week */ }
    // keep the last WEEK_KEEP weeks
    try { for (const k of weekKeys(kv).slice(0, -WEEK_KEEP)) await kv.delete(k); } catch (e) { /* next time */ }
    return rec;
  })();
  busy.set(week, job);
  try { return await job; } finally { busy.delete(week); }
}

// the first lesson of a week: think about last week in the background (never in the way of the lesson)
export function maybeThinkWeek(app, { now = new Date(), fetchImpl = null } = {}) {
  const kv = app.kv;
  const today = dayOf(now);
  const last = addDays(mondayOf(today), -7);
  const rec = readWeek(kv, last);
  if (rec && good(rec) && rec.complete) return Promise.resolve(null);
  if (rec && rec.error && (num(rec.tries) >= WEEK_TRIES || dayOf(rec.at) === today)) return Promise.resolve(null);
  const lastEnd = addDays(last, 6);
  const chatDays = safe(() => kv.keys('chat:').map(k => k.slice(5)).filter(d => isDay(d) && d >= last && d <= lastEnd), []);
  if (!lessonDaysIn(kv, last, lastEnd).length && !chatDays.length) return Promise.resolve(null);
  return thinkWeek(app, { now, from: last, to: lastEnd, fetchImpl }).catch(err => {
    console.warn('teacher: weekly think:', (err && err.message) || err);
    return null;
  });
}
