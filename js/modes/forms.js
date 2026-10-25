// 变形配对（design/teacher-next.md 第 5 节，DESIGN 5.6）：认识 see 不等于认识 saw。热身里每天 1 组：原形和变形连线（4 对），
// 或者四选一（3 道：“saw 是过去式。它原来是哪个词？”）。故事和课文里变形词很多，读的时候认不出就整句断掉。
// 内容在 curriculum/forms.json（66 对，名词复数 / 三单 / 过去式，带中文说明、一句规律和一个例句）；只出她学过的原形
// （pool：单词本里的词和小学 505 词，摸底说“没学过”的不算）。不进 FSRS，进度只在 kv 'forms.state'。
// 负责：单词从认得到会用（teacher-next 第 5 节，第 4 批）。样式在 css/cloze.css（类名 forms-）。
//
// 一组怎么走
//   连线：左边原形（带中文），右边变形（打乱）。先点一边、再点另一边；连对了两个都锁住，变形下面出“复数”“三单”“过去式”。
//   连错了：按先点的那个词给一句提示（“要找 child（孩子）的复数：不止一个的时候怎么说。”）；同一个词错第 2 次，老师替她连上
//   （这一对 grade 1）。4 对都连上以后，逐对看一遍规律和例句（例句能听），点“下一个”结束。
//   四选一：大字写变形和它是什么（“saw 是过去式”），选原形。错 1 次：划掉那个，提示“saw 是‘看见’的过去式。”；
//   错 2 次：标出答案。做对了出规律和例句。
//   评分（每一对）：第一次就对 3；错过一次再对 2；老师替她连上、或者错两次 1。
//   哪几对：上次没一次做对的（第二天起）先出；再出没见过的，每组尽量混着复数、三单、过去式（先复数和三单，期中范围里的）；
//   14 天内一次就对的歇着。同一天、同样的进度，结果一样。连线和四选一隔天换（第一次是连线；她学过的原形不到 4 对时用四选一）。
//
// 导出
//   FILE = 'curriculum/forms.json'、KV_KEY = 'forms.state'、MODE = 'forms'、SECONDS = 45（plan 算时长）
//   MATCH_N = 4、MC4_N = 3、MIN_PAIRS = 3、REST_DAYS = 14、KIND_ORDER = ['plural', 'third', 'past']、KIND_ZH
//   createForms(data) -> Content = { version, kinds: { plural: { zh, say, hint } }, pairs: [Pair], pair(id), byKind(kind) }
//     Pair = { id, kind, kindZh, base, form, lemma（is / are 是 be）, baseZh, rule, ex, exZh, source: 'kebiao' | 'rule' }
//   setForms(data)、forms()、loadForms({ fetchJSON })（读不到抛错，app 接住就算了：热身不出变形配对）
//   poolOf(pool) -> (word) => bool   pool 可以是词的数组、词条数组（headword）、Set 或函数
//   poolFrom(app) -> (word) => bool   单词本里的词 + curriculum.isPrimary 的小学词，去掉 kv 'screen:505' 里点了“没学过”的
//   knownPairs(pool, content?) -> [Pair]   原形（lemma 或 base）她学过的
//   readFormsState(kv | 值) -> { v: 1, items: { id: { n, last, clean, miss } }, first, updated }   坏数据读成空的
//   applyForms(state, { id, clean, now }) -> state   miss 是连着没一次做对的次数（做对清零）
//   formsItems(kv, now, { pool, content, kind }) -> { kind: 'match' | 'mc4', items: [pair id] } | null   今天这组（给 plan）
//   distractorsFor(pair, content, { pool, rng, n = 3 }) -> [原形]   同一类的别的原形；能变出同一个变形的原形不放（was 不会配 is 以外的 am）
//   makeForms(pool, { kv, now, kind, content, rng }) -> FormsGroup | null   纯函数
//     FormsGroup = { kind: 'match', pairs: [Pair], left: [Pair]（原形的顺序）, right: [Pair]（变形打乱） }
//                | { kind: 'mc4', pairs: [Pair], questions: [{ pair, options: [原形]（打乱）, answer: 原形 }] }
//   groupOf({ kind, items } | [id], { content, pool, rng }) -> FormsGroup | null   plan 给的 id 变回一组
//   renderForms(container, ctx, { items（formsItems 的返回值，或 id 数组）, kind?, group?, pool?, sid, step = 'warmup', onDone,
//                 autoNextMs = 1800, content?, rng? }) -> { el, onKey, stop }
//     没给 items / group 时自己按 poolFrom(ctx) 出今天这组。onDone({ kind, results: [{ id, item: 'f:<id>', grade, clean }] })
//     ctx 用到 kv（'forms.state'、'story:names'、'screen:505'）、events.log、say（可以没有）、words.favorites、curriculum（poolFrom）
//
// 事件：answer { item: 'f:<pair id>', mode: 'forms', step, sid, choice（她连上 / 选的那个词）, correct, first_try, ms, hint_level,
//   misconception: null, kind（plural / third / past）, base, form, group: 'match' | 'mc4', done?, grade? }（每连一次、每选一次一条；
//   这一对结束的那条带 done、grade）；hint { item, mode: 'forms', level, hint_level, auto: true }。不带 slug：不算进单词的“会写了”。
import { h, icon } from '../ui-dom.js';
import * as R from '../reader.js';

export const FILE = 'curriculum/forms.json';
export const KV_KEY = 'forms.state';
export const MODE = 'forms';
export const SECONDS = 45;
export const MATCH_N = 4;
export const MC4_N = 3;
export const MIN_PAIRS = 3;
export const REST_DAYS = 14;
export const KIND_ORDER = ['plural', 'third', 'past'];
export const KIND_ZH = { plural: '复数', third: '三单', past: '过去式' };
const KIND_DEFAULT = {
  plural: { zh: '复数', say: '不止一个', hint: '要找它的复数：不止一个的时候怎么说。' },
  third: { zh: '三单', say: 'he、she、it 后面用', hint: '要找它的三单：主语是 he、she、it（一个人、一只猫）时用的那个。' },
  past: { zh: '过去式', say: '说已经发生的事', hint: '要找它的过去式：说已经发生的事时用的那个。' },
};

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day, n) => { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayNum = now => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
const low = s => String(s ?? '').trim().toLowerCase();
const str = x => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const arr = x => (Array.isArray(x) ? x : []);
const hashOf = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// a fixed shuffle for the day (the same group looks the same if she comes back to it)
const seeded = seed => { let x = (seed >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };

// ---------------------------------------------------------------- content

export function createForms(data) {
  const d = data && typeof data === 'object' ? data : {};
  const kinds = {};
  for (const k of KIND_ORDER) kinds[k] = { ...KIND_DEFAULT[k], ...((d.kinds && d.kinds[k]) || {}) };
  const pairs = [];
  const seen = new Set();
  for (const raw of arr(d.pairs)) {
    if (!raw || !raw.id || seen.has(raw.id) || !kinds[raw.kind] || !raw.base || !raw.form) continue;
    seen.add(raw.id);
    pairs.push({
      id: str(raw.id), kind: raw.kind, kindZh: kinds[raw.kind].zh, base: str(raw.base), form: str(raw.form), lemma: str(raw.lemma) || str(raw.base),
      baseZh: str(raw.base_zh), rule: str(raw.rule), ex: str(raw.ex), exZh: str(raw.ex_zh), source: str(raw.source),
    });
  }
  const byId = new Map(pairs.map(p => [p.id, p]));
  return { version: d.version || 1, kinds, pairs, pair: id => byId.get(str(id).replace(/^f:/, '')) || null, byKind: k => pairs.filter(p => p.kind === k) };
}
let cached = null;
export function setForms(data) { cached = data ? createForms(data) : null; return cached; }
export function forms() { return cached; }
export async function loadForms({ fetchJSON } = {}) {
  if (cached) return cached;
  if (typeof fetchJSON !== 'function') throw new Error('forms: no fetchJSON');
  return setForms(await fetchJSON(FILE));
}

// ---------------------------------------------------------------- what she has learned

export function poolOf(pool) {
  if (typeof pool === 'function') return w => { try { return !!pool(low(w)); } catch (e) { return false; } };
  const set = new Set();
  const list = pool instanceof Set ? [...pool] : arr(pool);
  for (const x of list) {
    const w = typeof x === 'string' ? x : x && (x.headword || x.w || x.word);
    if (w) set.add(low(w));
  }
  return w => set.has(low(w));
}

// her word book and the primary-school words, minus the ones she said she never learned (505 摸底, kv 'screen:505')
export function poolFrom(app = {}) {
  const book = new Set();
  try { for (const e of (app.words && typeof app.words.favorites === 'function' ? app.words.favorites() : []) || []) if (e && e.headword) book.add(low(e.headword)); } catch (e) { /* no word book */ }
  let no = new Set();
  try {
    const s = app.kv && typeof app.kv.peek === 'function' ? app.kv.peek('screen:505', null) : null;
    no = new Set(Object.entries((s && s.words && typeof s.words === 'object') ? s.words : {}).filter(([, x]) => x && x.a === 'new').map(([w]) => low(w)));
  } catch (e) { no = new Set(); }
  const cur = app.curriculum;
  return w => {
    const x = low(w);
    if (book.has(x)) return true;
    if (no.has(x)) return false;
    try { return !!(cur && typeof cur.isPrimary === 'function' && cur.isPrimary(x)); } catch (e) { return false; }
  };
}

export function knownPairs(pool, c = forms()) {
  if (!c) return [];
  const has = poolOf(pool);
  return c.pairs.filter(p => has(p.lemma) || has(p.base));
}

// ---------------------------------------------------------------- progress (kv 'forms.state')

export function readFormsState(x) {
  let raw = x;
  try { if (x && typeof x.peek === 'function') raw = x.peek(KV_KEY, null); } catch (e) { raw = null; }
  const out = { v: 1, items: {}, first: '', updated: '' };
  if (!raw || typeof raw !== 'object') return out;
  if (isDay(raw.first)) out.first = raw.first;
  if (typeof raw.updated === 'string') out.updated = raw.updated;
  for (const [id, r] of Object.entries(raw.items && typeof raw.items === 'object' ? raw.items : {})) {
    if (!id || !r || typeof r !== 'object') continue;
    out.items[id] = { n: Math.max(0, Number(r.n) || 0), last: isDay(r.last) ? r.last : '', clean: !!r.clean, miss: Math.max(0, Number(r.miss) || 0) };
  }
  return out;
}

export function applyForms(state, { id, clean = false, now = new Date() } = {}) {
  const s = readFormsState(state);
  const day = dayOf(now);
  const prev = s.items[id] || { n: 0, last: '', clean: false, miss: 0 };
  s.items[id] = { n: prev.n + 1, last: day, clean: !!clean, miss: clean ? 0 : prev.miss + 1 };
  if (!s.first) s.first = day;
  s.updated = now.toISOString();
  return s;
}

// ---------------------------------------------------------------- today's group (pure)

// 0 missed last time (from the next day on), 1 never seen, 2 right but a while ago, 3 right lately, 9 done today
function bucketOf(p, st, today) {
  const r = st.items[p.id];
  if (!r || !r.n) return 1;
  if (r.last === today) return 9;
  if (!r.clean) return 0;
  return r.last < addDays(today, -REST_DAYS) ? 2 : 3;
}

export function formsItems(kv, now = new Date(), { pool, content: c = forms(), kind = null } = {}) {
  if (!c) return null;
  const known = knownPairs(pool, c);
  if (known.length < MIN_PAIRS) return null;
  const st = readFormsState(kv);
  const today = dayOf(now);
  const k = kind === 'match' || kind === 'mc4' ? kind
    : known.length >= MATCH_N && (!st.first || dayNum(now) % 2 === 0) ? 'match' : 'mc4';
  const n = k === 'match' ? MATCH_N : MC4_N;
  const turn = dayNum(now);
  const order = new Map(c.pairs.map((p, i) => [p.id, i]));
  const ranked = known.map(p => ({ p, b: bucketOf(p, st, today) })).filter(x => x.b < 9)
    .sort((a, b) => a.b - b.b || (a.b === 0 ? (st.items[b.p.id].miss - st.items[a.p.id].miss) : 0)
      || (a.b === 1 ? KIND_ORDER.indexOf(a.p.kind) - KIND_ORDER.indexOf(b.p.kind) : 0)
      || (a.b >= 2 ? st.items[a.p.id].last.localeCompare(st.items[b.p.id].last) : 0)
      || (((order.get(a.p.id) + turn * 7) % 997) - ((order.get(b.p.id) + turn * 7) % 997)));
  const picked = [];
  const bases = new Set(), formsSeen = new Set();
  const fits = p => !bases.has(low(p.base)) && !formsSeen.has(low(p.form)) && !bases.has(low(p.form)) && !formsSeen.has(low(p.base));
  const take = p => { picked.push(p); bases.add(low(p.base)); formsSeen.add(low(p.form)); };
  // the ones she missed come back first
  for (const x of ranked) if (picked.length < n && x.b === 0 && fits(x.p)) take(x.p);
  // then from the best bucket left, the kinds in turn (plural, third, past) so one group mixes them
  for (let slot = 0; picked.length < n; slot++) {
    const avail = ranked.filter(x => !picked.includes(x.p) && fits(x.p));
    if (!avail.length) break;
    const top = avail[0].b;
    const want = KIND_ORDER[slot % KIND_ORDER.length];
    const best = avail.find(x => x.b === top && x.p.kind === want)
      || avail.find(x => x.b === top && !picked.some(p => p.kind === x.p.kind)) || avail[0];
    take(best.p);
  }
  if (picked.length < Math.min(n, MIN_PAIRS)) return null;
  return { kind: k, items: picked.map(p => p.id) };
}

export function distractorsFor(pair, c = forms(), { pool = null, rng = Math.random, n = 3 } = {}) {
  if (!pair || !c) return [];
  const has = pool ? poolOf(pool) : () => true;
  // a base that also turns into this form (am -> was) or is the form itself is never a wrong option
  const sameForm = new Set(c.pairs.filter(p => low(p.form) === low(pair.form)).map(p => low(p.base)));
  const seen = new Set([low(pair.base), low(pair.form)]);
  const cands = [];
  for (const p of c.pairs) {
    const b = low(p.base);
    if (p.kind !== pair.kind || seen.has(b) || sameForm.has(b)) continue;
    seen.add(b);
    cands.push(p.base);
  }
  const score = w => (has(w) ? 0 : 2) + (low(w)[0] === low(pair.base)[0] || low(w)[0] === low(pair.form)[0] ? 0 : 1);
  const shuffled = shuffle(cands, rng);
  return shuffled.sort((a, b) => score(a) - score(b)).slice(0, n);
}

export function groupOf(spec, { content: c = forms(), pool = null, rng = Math.random } = {}) {
  if (!c || !spec) return null;
  const ids = Array.isArray(spec) ? spec : arr(spec.items);
  const pairs = ids.map(id => c.pair(typeof id === 'string' ? id : id && id.id)).filter(Boolean);
  if (!pairs.length) return null;
  const kind = (!Array.isArray(spec) && (spec.kind === 'match' || spec.kind === 'mc4')) ? spec.kind : pairs.length >= MATCH_N ? 'match' : 'mc4';
  if (kind === 'match' && pairs.length >= 2) {
    let right = shuffle(pairs, rng);
    for (let k = 0; k < 6 && right.every((p, i) => p === pairs[i]); k++) right = shuffle(pairs, rng);
    if (right.every((p, i) => p === pairs[i])) right.push(right.shift());
    return { kind: 'match', pairs, left: pairs.slice(), right };
  }
  return {
    kind: 'mc4', pairs,
    questions: pairs.map(p => ({ pair: p, options: shuffle([p.base, ...distractorsFor(p, c, { pool, rng })], rng), answer: p.base })),
  };
}

export function makeForms(pool, { kv = null, now = new Date(), kind = null, content: c = forms(), rng = null } = {}) {
  const pick = formsItems(kv, now, { pool, content: c, kind });
  if (!pick) return null;
  return groupOf(pick, { content: c, pool, rng: rng || seeded(dayNum(now) * 31 + hashOf(pick.items.join(','))) });
}

// ---------------------------------------------------------------- the screen

// the names she picked for the girl and the cat go into the examples (Mia, Momo, Lucy, Tom, Snowy)
function nameSwap(kv) {
  let picked = {};
  try { picked = R.cleanNames(kv && typeof kv.peek === 'function' ? kv.peek(R.NAMES_KEY, null) : null) || {}; } catch (e) { picked = {}; }
  let list = [];
  try { list = (R.content() && R.content().names) || []; } catch (e) { list = []; }
  const swaps = arr(list).filter(n => n && n.replaceable !== false && n.name && picked[n.key] && picked[n.key] !== n.name)
    .map(n => [new RegExp(`(?<![A-Za-z])${n.name}(?![A-Za-z])`, 'g'), picked[n.key]]);
  return s => swaps.reduce((x, [re, to]) => x.replace(re, to), str(s));
}

export function renderForms(container, ctx = {}, { items = null, kind = null, group = null, pool = null, sid = '', step = 'warmup', onDone = () => {},
  autoNextMs = 1800, content: c0 = null, rng = Math.random } = {}) {
  const el = h('div', { className: 'forms' });
  container.replaceChildren(el);
  const c = c0 || forms();
  let stopped = false, timer = 0, keyFn = null;
  const results = [];
  const log = ev => { try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, ...ev }) : null; } catch (e) { return null; } };
  const speak = (text, btn) => { if (text && ctx.say) { try { ctx.say(text, btn || null); } catch (e) { /* sound is optional */ } } };
  const save = (id, clean) => {
    try {
      const v = applyForms(readFormsState(ctx.kv), { id, clean, now: new Date() });
      const r = ctx.kv && ctx.kv.set ? ctx.kv.set(KV_KEY, v) : null;
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* keep going */ }
  };
  const sw = nameSwap(ctx.kv);
  let g = group;
  if (!g && c) {
    const spec = items ? (Array.isArray(items) ? { kind, items } : { kind: kind || items.kind, items: items.items }) : null;
    try { g = spec ? groupOf(spec, { content: c, pool, rng }) : makeForms(pool || poolFrom(ctx), { kv: ctx.kv, now: new Date(), kind, content: c }); } catch (e) { g = null; }
  }
  const finish = () => { if (stopped) return; stopped = true; clearTimeout(timer); onDone({ kind: g ? g.kind : '', results }); };
  if (!g || !g.pairs || !g.pairs.length) { setTimeout(finish, 0); return { el, onKey() {}, stop() { stopped = true; } }; }
  const kindOf = p => (c && c.kinds[p.kind]) || KIND_DEFAULT[p.kind] || { zh: p.kindZh, say: '', hint: '' };
  const evOf = (p, extra) => ({ type: 'answer', item: 'f:' + p.id, mode: MODE, misconception: null, kind: p.kind, base: p.base, form: p.form, group: g.kind, ...extra });
  const exLine = p => (p.ex ? h('p', { className: 'forms-ex', lang: 'en' }, h('span', { text: sw(p.ex) }),
    h('button', { type: 'button', className: 'say forms-say', 'aria-label': '听例句', on: { click: ev => speak(sw(p.ex), ev.currentTarget) } }, icon('speak'))) : null);
  const exZh = p => (p.exZh ? h('p', { className: 'forms-ex-zh small', lang: 'zh-CN', text: sw(p.exZh) }) : null);

  if (g.kind === 'match') drawMatch(); else drawMc4(0);
  return { el, onKey: ev => { if (keyFn) keyFn(ev); }, stop() { stopped = true; clearTimeout(timer); } };

  // ------------------------------------------------ 连线
  function drawMatch() {
    const t0 = Date.now();
    const state = new Map(g.pairs.map(p => [p.id, { tries: 0, miss: 0, done: false, grade: 0 }]));
    let sel = null;   // { side: 'base' | 'form', id }
    const hint = h('p', { className: 'forms-hint', hidden: true, role: 'note' });
    const feedback = h('p', { className: 'forms-feedback', role: 'status', 'aria-live': 'polite' });
    const review = h('div', { className: 'forms-review', hidden: true });
    const nextBtn = h('button', { type: 'button', className: 'btn forms-next', text: '下一个', hidden: true, on: { click: () => finish() } });
    const btns = { base: new Map(), form: new Map() };
    const left = g.left.map(p => {
      const b = h('button', { type: 'button', className: 'forms-chip forms-base', on: { click: () => pick('base', p.id) } },
        h('span', { className: 'forms-w', lang: 'en', text: p.base }), p.baseZh ? h('span', { className: 'forms-zh', lang: 'zh-CN', text: p.baseZh }) : null);
      btns.base.set(p.id, b);
      return b;
    });
    const right = g.right.map(p => {
      const tag = h('span', { className: 'forms-tag', lang: 'zh-CN', hidden: true, text: kindOf(p).zh });
      const b = h('button', { type: 'button', className: 'forms-chip forms-form', on: { click: () => pick('form', p.id) } },
        h('span', { className: 'forms-w', lang: 'en', text: p.form }), tag);
      b.tag = tag;
      btns.form.set(p.id, b);
      return b;
    });
    const mark = () => {
      for (const side of ['base', 'form']) for (const [id, b] of btns[side]) {
        const s = state.get(id);
        if (sel && sel.side === side && sel.id === id) b.classList.add('sel'); else b.classList.remove('sel');
        b.disabled = s.done;
      }
    };
    // a joined pair: the form moves into its base's row, so she sees which went with which
    const rightCol = h('div', { className: 'forms-col forms-right', role: 'group', 'aria-label': '变出来的样子' }, right);
    const rightOrder = g.right.map(p => p.id);
    const lock = (p, how) => {
      const s = state.get(p.id);
      s.done = true;
      for (const side of ['base', 'form']) { const b = btns[side].get(p.id); b.classList.add(how); b.disabled = true; }
      const f = btns.form.get(p.id);
      if (f.tag) f.tag.hidden = false;
      const row = g.left.findIndex(x => x.id === p.id), now = rightOrder.indexOf(p.id);
      const before = rightOrder.join(',');
      if (row >= 0 && now >= 0 && row !== now) [rightOrder[row], rightOrder[now]] = [rightOrder[now], rightOrder[row]];
      // the ones still open must not all sit next to their own base (that would give them away): turn them round by one
      const open = g.left.map((x, i) => i).filter(i => !state.get(g.left[i].id).done);
      if (open.length >= 2 && open.every(i => rightOrder[i] === g.left[i].id)) {
        const ids = open.map(i => rightOrder[i]);
        open.forEach((i, k) => { rightOrder[i] = ids[(k + 1) % ids.length]; });
      }
      if (rightOrder.join(',') !== before) rightCol.replaceChildren(...rightOrder.map(id => btns.form.get(id)));
      speak(p.form);
    };
    function pick(side, id) {
      if (stopped || state.get(id).done) return;
      if (!sel || sel.side === side) { sel = sel && sel.id === id && sel.side === side ? null : { side, id }; mark(); return; }
      const first = sel;
      const p = g.pairs.find(x => x.id === first.id);
      const other = side === 'base' ? g.pairs.find(x => x.id === id).base : g.pairs.find(x => x.id === id).form;
      sel = null;
      const s = state.get(p.id);
      s.tries++;
      const ok = first.id === id;
      const ev = evOf(p, { choice: other, correct: ok, first_try: s.tries === 1, ms: Date.now() - t0, hint_level: Math.min(1, s.miss) });
      if (ok) {
        s.grade = s.miss === 0 ? 3 : 2;
        log({ ...ev, done: true, grade: s.grade });
        lock(p, 'right');
        results.push({ id: p.id, item: 'f:' + p.id, grade: s.grade, clean: s.miss === 0 });
        save(p.id, s.miss === 0);
        hint.hidden = true;
        feedback.textContent = `对了。${p.base} → ${p.form}：${kindOf(p).zh}。`;
      } else {
        s.miss++;
        const wrongBtn = btns[side].get(id);
        wrongBtn.classList.add('wrong');
        setTimeout(() => wrongBtn.classList.remove('wrong'), 700);
        feedback.textContent = '';
        if (s.miss >= 2) {
          // twice on the same word: the teacher joins it up
          s.grade = 1;
          log({ ...ev, done: true, grade: 1 });
          log({ type: 'hint', item: 'f:' + p.id, mode: MODE, level: 2, hint_level: 2, auto: true });
          lock(p, 'reveal');
          results.push({ id: p.id, item: 'f:' + p.id, grade: 1, clean: false });
          save(p.id, false);
          hint.textContent = `老师帮你连上了：${p.base} → ${p.form}。${p.rule}`;
        } else {
          log(ev);
          log({ type: 'hint', item: 'f:' + p.id, mode: MODE, level: 1, hint_level: 1, auto: true });
          hint.textContent = first.side === 'base'
            ? `要找 ${p.base}${p.baseZh ? '（' + p.baseZh + '）' : ''}的${kindOf(p).zh}：${kindOf(p).say}。`
            : `${p.form} 是一个词的${kindOf(p).zh}（${kindOf(p).say}）。它原来是哪个词？`;
        }
        hint.hidden = false;
      }
      mark();
      if ([...state.values()].every(x => x.done)) done();
    }
    function done() {
      clearTimeout(timer);
      const clean = results.filter(r => r.clean).length;
      feedback.textContent = clean === g.pairs.length ? '都连对了。再看一眼它们怎么变的。' : '都连上了。再看一眼它们怎么变的。';
      hint.hidden = true;
      review.replaceChildren(...g.pairs.map(p => h('div', { className: 'forms-row' },
        h('p', { className: 'forms-pair', lang: 'en' }, `${p.base} → ${p.form}`, h('span', { className: 'forms-tag', lang: 'zh-CN', text: kindOf(p).zh })),
        p.rule ? h('p', { className: 'forms-rule', lang: 'zh-CN', text: p.rule }) : null, exLine(p), exZh(p))));
      review.hidden = false;
      nextBtn.hidden = false;
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
    }
    keyFn = ev => { if (!nextBtn.hidden && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); finish(); } };
    el.replaceChildren(
      h('p', { className: 'forms-title small', text: '变形配对' }),
      h('p', { className: 'forms-ask', text: '把原来的词和它变出来的样子连起来。' }),
      h('p', { className: 'forms-how small', text: '先点左边的词，再点右边它变出来的样子。' }),
      h('div', { className: 'forms-board' }, h('div', { className: 'forms-col forms-left', role: 'group', 'aria-label': '原来的词' }, left), rightCol),
      hint, feedback, review, h('div', { className: 'btn-row' }, nextBtn),
    );
    mark();
  }

  // ------------------------------------------------ 四选一
  function drawMc4(i) {
    const qn = g.questions[i];
    if (!qn) { finish(); return; }
    const p = qn.pair;
    const t0 = Date.now();
    let tries = 0, done = false;
    const hint = h('p', { className: 'forms-hint', hidden: true, role: 'note' });
    const feedback = h('p', { className: 'forms-feedback', role: 'status', 'aria-live': 'polite' });
    const more = h('div', { className: 'forms-more', hidden: true });
    const nextBtn = h('button', { type: 'button', className: 'btn forms-next', text: i + 1 < g.questions.length ? '下一个' : '好了', hidden: true, on: { click: () => next() } });
    const opts = new Map();
    const optBtns = qn.options.map(w => {
      const b = h('button', { type: 'button', className: 'forms-opt', lang: 'en', text: w, on: { click: () => choose(w) } });
      opts.set(w, b);
      return b;
    });
    function end(grade) {
      done = true;
      for (const b of opts.values()) b.disabled = true;
      opts.get(qn.answer).classList.add(grade === 1 ? 'reveal' : 'right');
      results.push({ id: p.id, item: 'f:' + p.id, grade, clean: grade === 3 });
      save(p.id, grade === 3);
      more.replaceChildren(...[p.rule ? h('p', { className: 'forms-rule', lang: 'zh-CN', text: p.rule }) : null, exLine(p), exZh(p)].filter(Boolean));
      more.hidden = false;
      nextBtn.hidden = false;
      speak(p.form);
      if (grade === 3) timer = setTimeout(next, autoNextMs + 1200);
    }
    function choose(w) {
      if (done || stopped) return;
      const b = opts.get(w);
      if (!b || b.disabled) return;
      tries++;
      const ok = w === qn.answer;
      const ev = evOf(p, { choice: w, correct: ok, first_try: tries === 1, ms: Date.now() - t0, hint_level: Math.min(2, tries - 1) });
      if (ok) {
        const grade = tries === 1 ? 3 : 2;
        log({ ...ev, done: true, grade });
        hint.hidden = true;
        feedback.textContent = `对了。${p.base} → ${p.form}：${kindOf(p).zh}。`;
        end(grade);
        return;
      }
      b.classList.add('wrong');
      b.disabled = true;
      if (tries === 1) {
        log(ev);
        log({ type: 'hint', item: 'f:' + p.id, mode: MODE, level: 1, hint_level: 1, auto: true });
        hint.textContent = p.baseZh ? `${p.form} 是“${p.baseZh}”的${kindOf(p).zh}。` : `${p.form} 是${kindOf(p).zh}（${kindOf(p).say}）。`;
        hint.hidden = false;
        return;
      }
      log({ ...ev, done: true, grade: 1 });
      log({ type: 'hint', item: 'f:' + p.id, mode: MODE, level: 2, hint_level: 2, auto: true });
      hint.textContent = `是 ${p.base}。${p.base} → ${p.form}：${kindOf(p).zh}。`;
      feedback.textContent = '';
      end(1);
    }
    function next() {
      if (stopped || !done) return;
      clearTimeout(timer);
      drawMc4(i + 1);
    }
    keyFn = ev => {
      if (done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); return; }
      const n = Number(ev.key);
      if (!done && n >= 1 && n <= qn.options.length) { ev.preventDefault(); choose(qn.options[n - 1]); }
    };
    el.replaceChildren(
      h('p', { className: 'forms-title small', text: '变形配对' }),
      h('p', { className: 'forms-big', lang: 'en', text: p.form }),
      h('p', { className: 'forms-ask', text: `是${kindOf(p).zh}（${kindOf(p).say}）。它原来是哪个词？` }),
      h('div', { className: 'forms-options' }, optBtns),
      hint, feedback, more, h('div', { className: 'btn-row' }, nextBtn),
    );
  }
}
