// 进新单元（DESIGN 6.2、6.3，roadmap-gaps 3）：她在“我”或家长区把进度改到新单元，或者到了家长填的“下个单元开始日”
// （kv progress.nextFrom），弹一次“进 Unit X 了”：提示拍本单元词汇表、第 5、6 单元顺序不确定时问一句“植物还是动物”、
// 预习这单元要用的语法卡（先打地基）和 5 个新词。这个文件是纯逻辑（不碰 DOM），画界面在 ui-unit-flow.js（类名 uf-）。
// 负责：语法卡 agent（unit-flow.js、ui-unit-flow.js、css/unit-flow.css、tests/gaps-b.test.mjs）。
//
// 什么时候弹（dueUnit）
//   kv 'unit.flow' 记着 base（上一次已经知道的单元）和 shown（哪个单元哪天弹过）。第一次跑（没有这个键）只记下她现在的单元，
//   不弹（iPad 上已经在学的单元不算“进新单元”）。之后：
//   1 progress.unit 比 base 靠后，而且这个单元没弹过 → 弹（reason 'progress'）。往回改不弹，只把 base 跟过去。
//   2 今天到了 progress.nextFrom，下一个单元没弹过 → 弹（reason 'date'），弹的时候把 progress.unit 改成这个单元、清掉 nextFrom。
//      nextFor 记着 nextFrom 是给哪个单元填的（setNextFrom 写）；进度已经改过、nextFor 对不上了，这个日子作废。
//   每个单元只弹一次（打开就记 shown，关掉 App 也不再弹）。
//
// 导出
//   KV = 'unit.flow'（grammar.js UNIT_FLOW_KV）；BOOK_UNITS = ['S', 'U1' … 'U6']；ORDER_TEXT（问“植物还是动物”的那句）
//   normFlow(raw) / readFlow(kv) -> Flow = { v: 1, base, shown: { 单元: 'YYYY-MM-DD' }, order56: '' | 'plants' | 'animals', asked, updated }
//     order56：第 5 单元是哪个话题（她翻目录答的）；grammar.js topicUnits 读它
//   unitList(curriculum) -> ['S', 'U1', …]   课本里的单元按先后（curriculum.units() 加上整本书的 Starter 到 Unit 6）
//   nextUnitOf(unit, curriculum) -> 下一个单元 id | null
//   dueUnit(kv, now, { curriculum }) -> { unit, reason: 'progress' | 'date', base } | { init: true, base } | null
//     init：还没有 kv 'unit.flow'，调用方（syncFlow）记下 base 就行
//   syncFlow(kv, now, { curriculum }) -> Promise<Due | null>   第一次记 base；往回改跟上 base；该弹的返回 { unit, reason, base }
//   unitIntro(kv, unitId, { curriculum, grammar, now }) -> Intro   “进 Unit X 了”这一页要放的东西：
//     Intro = { unit, name: 'Unit 5', title: 课本上的标题（没有就 ''）,
//               photo: { need, words: 已有几个词, photoAt } ,             need：这单元还没按照片核对过（没有词，或词不是拍来的）
//               order: { ask, text, unit, choices: [{ id: 'plants', label: '植物' }, { id: 'animals', label: '动物' }] } | null,
//               cards: grammar.js unitCards 的 { cards, foundations, note }（语法卡没读到时是空的）,
//               words: [{ w, cn, phrase? }]（最多 5 个：先课标必会、不是小学词的，按书上的顺序）, wordsNote }
//   markShown(kv, { unit, reason }, now, { curriculum }) -> Promise<Flow>   记下弹过；reason 'date' 时把 progress.unit 改过去、清掉 nextFrom
//   answerOrder(kv, { unit, topic }, now) -> Promise<Flow>   她说这个单元（U5 或 U6）是植物 / 动物 → order56
//   setNextFrom(kv, day, now, { curriculum }) -> Promise<{ progress, error }>   家长区 / “我”填“下个单元哪天开始”；'' 清掉。
//     写 progress.nextFrom 和 nextFor（填的时候的下一个单元）；日子格式不对或已经过去了给 error（一句中文）
//   nextFromText(progress, { title }) -> “Unit 5 11 月 20 日开始” | ''
//   introEvent / orderEvent：记的事件（type 'ask'，who 'emma'，step 'unit'）
//     进单元：{ type: 'ask', qid: 'unit_intro', who: 'emma', answer: 'seen' | 'photo' | 'card', about: 'unit:<id>', unit, reason, step: 'unit' }
//     植物还是动物：{ type: 'ask', qid: 'unit_order', who: 'emma', answer: 'plants' | 'animals' | 'skip', about: 'unit:<id>', unit, step: 'unit' }
import * as G from './grammar.js';

export const KV = G.UNIT_FLOW_KV;
export const BOOK_UNITS = ['S', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'];
export const ORDER_TEXT = '下一单元是植物还是动物？翻一下目录。';
const ORDER_TEXT_HERE = '这个单元是植物还是动物？翻一下目录。';
export const WORDS_MAX = 5;

const pad = n => String(n).padStart(2, '0');
const dayOf = (d = new Date()) => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const isoOf = d => (d instanceof Date ? d : new Date(d)).toISOString();
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const peek = (kv, k, d = null) => { try { const v = kv && kv.peek ? kv.peek(k, d) : d; return v === undefined || v === null ? d : v; } catch (e) { return d; } };
const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
export const unitName = id => { const s = String(id || ''); if (/^s/i.test(s)) return 'Starter'; const m = s.match(/(\d+)/); return m ? `Unit ${m[1]}` : s; };
const defaultRank = id => (id === 'S' ? 0 : /^U(\d+)$/.test(String(id)) ? +String(id).slice(1) : 100);

// ---------------------------------------------------------------- kv 'unit.flow'

export function normFlow(raw) {
  const r = obj(raw);
  const shown = {};
  for (const [k, v] of Object.entries(obj(r.shown))) if (isDay(String(v).slice(0, 10))) shown[k] = String(v).slice(0, 10);
  return { v: 1, base: typeof r.base === 'string' ? r.base : '', shown, order56: ['plants', 'animals'].includes(r.order56) ? r.order56 : '',
    asked: isDay(r.asked) ? r.asked : '', updated: r.updated || null };
}
export function readFlow(kv) { const raw = peek(kv, KV, null); return raw ? normFlow(raw) : null; }

// ---------------------------------------------------------------- units in book order

export function unitList(curriculum) {
  const list = safe(() => (curriculum && curriculum.units ? curriculum.units() : []), []) || [];
  const order = new Map();
  for (const id of BOOK_UNITS) order.set(id, defaultRank(id));
  for (const u of list) if (u && u.id) order.set(String(u.id), Number.isFinite(u.order) ? u.order : defaultRank(u.id));
  return [...order.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(x => x[0]);
}
const rankIn = (list, id) => { const i = list.indexOf(String(id || '')); return i < 0 ? -1 : i; };
export function nextUnitOf(unit, curriculum) {
  const list = unitList(curriculum);
  const i = rankIn(list, unit);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}

// ---------------------------------------------------------------- when

export function dueUnit(kv, now = new Date(), { curriculum = null } = {}) {
  const progress = obj(peek(kv, 'progress', {}));
  const cur = String(progress.unit || '');
  const flow = readFlow(kv);
  if (!flow) return { init: true, base: cur };
  const list = unitList(curriculum);
  const today = dayOf(now);
  if (cur && !flow.shown[cur] && flow.base && rankIn(list, cur) > rankIn(list, flow.base)) return { unit: cur, reason: 'progress', base: flow.base };
  const next = cur ? nextUnitOf(cur, curriculum) : null;
  const from = String(progress.nextFrom || '').slice(0, 10);
  const forOk = !progress.nextFor || progress.nextFor === next;
  if (next && isDay(from) && today >= from && forOk && !flow.shown[next]) return { unit: next, reason: 'date', base: cur };
  return null;
}

// first run: remember where she is (no popup); went back: base follows; otherwise what is due
export async function syncFlow(kv, now = new Date(), { curriculum = null } = {}) {
  const due = dueUnit(kv, now, { curriculum });
  if (due && due.init) {
    await kv.set(KV, { ...normFlow({}), base: due.base, updated: isoOf(now) });
    return null;
  }
  if (due) return due;
  const flow = readFlow(kv);
  const cur = String(obj(peek(kv, 'progress', {})).unit || '');
  if (flow && cur && cur !== flow.base) {
    const list = unitList(curriculum);
    // went back, or a unit already shown, or no base yet: just follow
    if (!flow.base || rankIn(list, cur) < rankIn(list, flow.base) || flow.shown[cur]) await kv.set(KV, { ...flow, base: cur, updated: isoOf(now) });
  }
  return null;
}

// ---------------------------------------------------------------- what the page shows

function textbookUnit(kv, id) {
  const tb = obj(peek(kv, 'textbook', {}));
  return (Array.isArray(tb.units) ? tb.units : []).find(u => u && String(u.id) === String(id)) || null;
}
export function unitIntro(kv, unitId, { curriculum = null, grammar = null, now = new Date() } = {}) {
  const unit = String(unitId || '');
  const tbu = textbookUnit(kv, unit);
  const fromCur = safe(() => (curriculum && curriculum.unitTitle ? curriculum.unitTitle(unit) : ''), '') || '';
  let title = (tbu && tbu.title) || fromCur || '';
  title = String(title).replace(new RegExp('^\\s*' + unitName(unit).replace(/\s+/g, '\\s*') + '\\s*', 'i'), '').trim();
  if (title === unit || title === unitName(unit)) title = '';
  // the vocabulary: from kv textbook (private, on the iPad) or the curriculum's unit index
  let words = safe(() => (curriculum && curriculum.unitWords ? curriculum.unitWords(unit) : []), []) || [];
  if (!words.length && tbu) words = (tbu.words || []).slice();
  const photoWords = words.filter(w => w && (w.source === 'photo' || w.cn_source === 'photo')).length;
  const photo = { need: !(tbu && tbu.source === 'photo') && !(words.length && photoWords === words.length), words: words.length, photoAt: (tbu && tbu.photoAt) || null };
  // which topic is this unit: only asked for the two units whose order the sources disagree on
  const tb = peek(kv, 'textbook', null);
  const flow = readFlow(kv);
  const ct = grammar || G.content();
  const tu = G.topicUnits({ textbook: tb, flow, content: ct });
  const slots = Object.values((ct && ct.topics) || G.DEFAULT_TOPICS).map(t => t.unit);
  const order = slots.includes(unit) && !tu.certain
    ? { ask: true, unit, text: unit === slots.slice().sort()[0] ? ORDER_TEXT : ORDER_TEXT_HERE,
      choices: [{ id: 'plants', label: '植物' }, { id: 'animals', label: '动物' }] }
    : null;
  const gstate = G.grammarState(kv, ct || undefined);
  const cards = ct ? G.unitCards(unit, gstate, { content: ct }) : { unit, topic: null, cards: [], foundations: [], note: '' };
  // five new words: the ones the standard asks her to know first (not primary-school words, not phrases), in book order
  const isPrimary = w => safe(() => !!(curriculum && curriculum.isPrimary && curriculum.isPrimary(w)), false);
  const isRequired = w => safe(() => (curriculum && curriculum.isRequired ? !!curriculum.isRequired(w) : true), true);
  const clean = words.filter(x => x && x.w && !x.phrase && !/\s/.test(String(x.w).trim()) && !/\.$/.test(String(x.w)) && !isPrimary(x.w));
  const firstPick = clean.filter(x => isRequired(x.w));
  const picked = [...firstPick, ...clean.filter(x => !firstPick.includes(x))].slice(0, WORDS_MAX).map(x => ({ w: x.w, cn: x.cn || '' }));
  const wordsNote = picked.length ? '' : '拍了本单元的词汇表，这里就有新词。';
  return { unit, name: unitName(unit), title, photo, order, cards, words: picked, wordsNote, at: dayOf(now) };
}

// ---------------------------------------------------------------- writes

export async function markShown(kv, { unit, reason = 'progress' } = {}, now = new Date(), { curriculum = null } = {}) {
  const flow = readFlow(kv) || normFlow({});
  const id = String(unit || '');
  if (!id) return flow;
  const out = { ...flow, base: id, shown: { ...flow.shown, [id]: dayOf(now) }, updated: isoOf(now) };
  await kv.set(KV, out);
  const progress = obj(peek(kv, 'progress', {}));
  const used = progress.nextFrom && (!progress.nextFor || progress.nextFor === id);
  if (reason === 'date' || used) {
    const p = { ...progress, updated: isoOf(now) };
    if (reason === 'date') { p.unit = id; p.unitFrom = 'nextFrom'; }
    if (used) { delete p.nextFrom; delete p.nextFor; }
    await kv.set('progress', p);
  }
  return out;
}

export async function answerOrder(kv, { unit, topic } = {}, now = new Date(), { content = null } = {}) {
  const flow = readFlow(kv) || normFlow({});
  const ct = content || G.content();
  const defs = (ct && ct.topics) || G.DEFAULT_TOPICS;
  const keys = Object.keys(defs);
  if (!keys.includes(topic)) return flow;
  const slots = keys.map(k => defs[k].unit).sort((a, b) => defaultRank(a) - defaultRank(b));
  // the question is about this unit; order56 says which topic the first of the two units is
  const first = String(unit) === slots[0] ? topic : keys.find(k => k !== topic) || topic;
  const out = { ...flow, order56: first, asked: dayOf(now), updated: isoOf(now) };
  await kv.set(KV, out);
  return out;
}

export async function setNextFrom(kv, day, now = new Date(), { curriculum = null } = {}) {
  const d = String(day || '').trim();
  const progress = obj(peek(kv, 'progress', {}));
  if (d && !isDay(d)) return { progress: null, error: '这个日子看不懂，再选一次。' };
  if (d && d < dayOf(now)) return { progress: null, error: '这天已经过去了，选下个单元开始的那天。' };
  const p = { ...progress, updated: isoOf(now) };
  if (d) { p.nextFrom = d; const n = progress.unit ? nextUnitOf(progress.unit, curriculum) : null; if (n) p.nextFor = n; else delete p.nextFor; }
  else { delete p.nextFrom; delete p.nextFor; }
  await kv.set('progress', p);
  return { progress: p, error: '' };
}

export function nextFromText(progress = {}, { title = unitName } = {}) {
  const p = obj(progress);
  const d = String(p.nextFrom || '').slice(0, 10);
  if (!isDay(d)) return '';
  const when = `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日开始`;
  return p.nextFor ? `${safe(() => title(p.nextFor), p.nextFor)} ${when}` : `下个单元 ${when}`;
}

export const introEvent = (unit, answer = 'seen', reason = '') => ({ type: 'ask', qid: 'unit_intro', who: 'emma', answer, about: 'unit:' + unit, unit, step: 'unit', ...(reason ? { reason } : {}) });
export const orderEvent = (unit, answer) => ({ type: 'ask', qid: 'unit_order', who: 'emma', answer, about: 'unit:' + unit, unit, step: 'unit' });
