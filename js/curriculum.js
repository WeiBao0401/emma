// 课标词表和课本单元词（DESIGN 5.1、5.4、6.8）：哪个词是小学 505 词、哪个在课标 1600 词表里（必会，要会写）、
// 课本里属于哪个单元、单元的先后，以及前置关系表。
// 负责：课标数据 agent（curriculum.js、web/curriculum/standard-words.json、kebiao.json、prereq.json、tags.json，
// 生成脚本 tools/build_curriculum.mjs）。
//
// 两层数据，分开放：
//   公开（进仓库）web/curriculum/standard-words.json  启动时读的紧凑索引（约 20 KB）：
//                   { version, source, counts, primary: [505 个词], junior: [1095 个词], listed: [另列的数词、月份星期、国家],
//                     forms: { 其他写法或变化形式: 原词 } }   例：an → a，children → child，went → go，color → colour
//                 web/curriculum/kebiao.json          详表，按需加载（loadDetails）：{ version, source, counts,
//                   words: [{ w, level: 2|3, forms?, pos?: ['n.', ...], group?: 'numbers'|'calendar'|'places', dict?, nodict? }] }
//                 web/curriculum/prereq.json          前置关系表（DESIGN 5.4）{ version, prereq: { 'g:there_be': ['g:be_agree', ...] },
//                   names: { id: 中文名 }, units: { U2: ['g:there_be', ...] }, tags: { id: [误解标签] } }
//                 web/curriculum/tags.json            误解标签表 { version, tags: { id: { zh, kind } } }
//   私有（只在 iPad 上）课本单元和单元词，来自 Wei 的课本导入（private/ 里的 emma-export 文件），两处都认：
//                 kv 'textbook'  { book, units: [{ id: 'S', title, order: 0, words: [{ w, cn?, phrase? }] }], importedAt }
//                 导入的词条    entries 上的 unit、order（单元里第几个）、unit_order、unit_title、brief_cn、phrase
//                 两处都有时 kv 'textbook' 优先（顺序、标题），词条补上它没有的单元和词。
//
// 导出
//   loadCurriculum({ fetchJSON, kv, entries?, lemma?, dict? }) -> Promise<Curriculum>
//       启动时调用一次；文件或 kv 读不到就用空数据，不抛错。entries 是词条数组或返回数组的函数（ctx.words.all）；
//       lemma(word) -> 原形或 null（ECDICT 的词形表，ctx.dict.lemma）；给 dict 等于给 lemma: w => dict.lemma(w)。
//   createCurriculum({ standard, prereq, tags, textbook, entries, lemma, details, fetchJSON }) -> Curriculum   纯函数，Node 测试直接用
//   Curriculum（app.js 放在 ctx.curriculum）:
//     isPrimary(word) -> bool          课标二级（小学）505 词（含变化形式：children、went）
//     isRequired(word) -> bool         课标三级 1600 词（含 505 和另列的数词、月份星期）：必会词，开“写得出”线；不在表里的课本词只认读。
//                                      课标不列短语，所以每个词都在课标里的短语（in fact、get lost）也算必会
//     levelOf(word) -> 2 | 3 | null    2 小学词，3 初中词（含另列），null 不在课标里（短语也是 null）
//     baseOf(word) -> string | null    课标里的原词（apples → apple，went → go），不在课标里为 null
//     tierOf(word) -> 'primary' | 'required' | 'recognize' | 'extra'
//                                      primary 小学词；required 课本里的必会词；recognize 课本里的认读词；extra 课外词
//     unitOf(word) -> unit id | null   课本里第一次出现的单元（'S'、'U1'…）；课外词为 null
//     unitWords(unit) -> [{ w, cn?, phrase? }]   这个单元的词，按课本顺序
//     units() -> [{ id, title, order, count }]   按课本顺序
//     unitOrder(unit) -> number        排序用；不认识的单元排最后
//     unitTitle(unit) -> string
//     prereq                           前置关系表 { item: [item...] }（和 prereq.json 的 prereq 同形）
//     grammar(unit) -> [item]          这个单元的语法点（prereq.json 的 units）
//     foundations(unitOrItem) -> [item]   要先稳的地基：前置关系往下找到底，去重，近的在前
//     grammarName(item) -> string      中文名
//     tags                             误解标签表 { id: { zh, kind } }
//     hasTextbook() -> bool            Wei 的课本导入过没有（kv 或词条里有单元）
//     counts() -> { primary, junior, listed }
//     standardWords() -> [word]        课标全部词（505 + 初中 1095 + 另列），四选一补干扰项用（modes/choice.js fillerFor）
//     refresh()                        词条变了（导入课本以后）重建单元索引；app.js 的 reloadCurriculum 也行
//     loadDetails() -> Promise<kebiao | null>   按需读 kebiao.json（词性等），读过就缓存
//     detail(word) -> { w, level, forms?, pos?, group? } | null   loadDetails 之后才有，之前为 null
//     posOf(word) -> ['n.', ...] | null          同上
//
// 词的写法：一律小写、去两头空格比较（normWord）。短语按整串比较。
// 词形：先查原词，再查课标括号里的写法（forms），再问 lemma（ECDICT），最后试规则变化（-s、-es、-ies、-ed、-ing、's）。
// 派生词（nervously、sunlight）不算课标词：只认读，课本导入文件里另有 derived_from 提示。
// 依赖：无（纯数据）。kv 是 app.js 的 { get(key) }。

export const normWord = w => String(w ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

export const FILES = { standard: 'curriculum/standard-words.json', prereq: 'curriculum/prereq.json', tags: 'curriculum/tags.json' };
export const DETAIL_FILE = 'curriculum/kebiao.json';

const DEFAULT_TITLES = { S: 'Starter' };
export const defaultUnitOrder = id => (id === 'S' ? 0 : /^U(\d+)$/.test(String(id)) ? +String(id).slice(1) : 100);
const defaultTitle = id => DEFAULT_TITLES[id] || (/^U(\d+)$/.test(String(id)) ? 'Unit ' + String(id).slice(1) : String(id));

// Regular inflections -> candidate base forms, most likely first. Only checked against the curriculum lists,
// so a wrong guess ("bus" -> "bu") never matches anything.
export function inflectionBases(word) {
  const w = normWord(word);
  const out = [];
  const add = x => { if (x && x.length >= 2 && x !== w && !out.includes(x)) out.push(x); };
  const dbl = s => (/([b-df-hj-np-tv-z])\1$/.test(s) ? s.slice(0, -1) : null);
  if (w.endsWith("'s")) add(w.slice(0, -2));
  if (w.endsWith("s'")) add(w.slice(0, -1));
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ves$/.test(w)) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe'); }
  if (/(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2));
  if (/[^s]s$/.test(w)) add(w.slice(0, -1));
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ed$/.test(w)) { const s = w.slice(0, -2); add(s); add(w.slice(0, -1)); add(dbl(s)); }
  if (/ing$/.test(w)) { const s = w.slice(0, -3); add(s); add(s + 'e'); add(dbl(s)); if (/y$/.test(s)) add(s.slice(0, -1) + 'ie'); }
  if (/ier$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/iest$/.test(w)) add(w.slice(0, -4) + 'y');
  if (/([b-df-hj-np-tv-z])\1er$/.test(w)) add(w.slice(0, -3));
  if (/([b-df-hj-np-tv-z])\1est$/.test(w)) add(w.slice(0, -4));
  return out;
}

export function createCurriculum({ standard = {}, prereq = {}, tags = {}, textbook = null, entries = null, lemma = null, details = null, fetchJSON = null } = {}) {
  const primary = new Set((standard.primary || []).map(normWord));
  const junior = new Set((standard.junior || []).map(normWord));
  const listed = new Set((standard.listed || []).map(normWord));
  const forms = new Map(Object.entries(standard.forms || {}).map(([f, b]) => [normWord(f), normWord(b)]));
  const known = k => primary.has(k) || junior.has(k) || listed.has(k);
  const lemmaOf = w => { if (typeof lemma !== 'function') return null; try { const l = lemma(w); return l ? normWord(l) : null; } catch (e) { return null; } };

  // word -> the curriculum headword it counts as (cached: wordsForPlan asks for every word in the library)
  const baseCache = new Map();
  function baseOf(word) {
    const k = normWord(word);
    if (!k) return null;
    if (baseCache.has(k)) return baseCache.get(k);
    let b = null;
    if (known(k)) b = k;
    else if (forms.has(k) && known(forms.get(k))) b = forms.get(k);
    else {
      for (const c of [lemmaOf(k), ...inflectionBases(k)]) {
        if (!c) continue;
        if (known(c)) { b = c; break; }
        if (forms.has(c) && known(forms.get(c))) { b = forms.get(c); break; }
      }
    }
    // a miss is not cached while a lemma function is in play: ctx.dict loads after the curriculum and answers later
    if (b || typeof lemma !== 'function') {
      if (baseCache.size > 20000) baseCache.clear();
      baseCache.set(k, b);
    }
    return b;
  }
  const isPrimary = w => { const b = baseOf(w); return !!b && primary.has(b); };
  // 课标不列短语（附录 3 说明 8）：每个词都在课标里的短语（in fact、get lost）算必会；连字符词（paper-cutting）不算
  const phraseOk = w => { const k = normWord(w); return / /.test(k) && k.split(' ').every(p => !!baseOf(p)); };
  const isRequired = w => !!baseOf(w) || phraseOk(w);
  const levelOf = w => { const b = baseOf(w); return !b ? null : primary.has(b) ? 2 : 3; };

  // ---- units: kv 'textbook' first, then the unit fields on imported entries
  let units = [], unitIndex = new Map(), orderIndex = new Map();
  function build() {
    const byId = new Map();
    const tb = textbook && Array.isArray(textbook.units) ? textbook.units : [];
    for (const u of tb) {
      if (!u || u.id == null) continue;
      const id = String(u.id);
      if (!byId.has(id)) byId.set(id, { id, title: u.title || defaultTitle(id), order: u.order ?? defaultUnitOrder(id), words: [], keys: new Set() });
      const cur = byId.get(id);
      for (const x of u.words || []) {
        const k = normWord(x && x.w);
        if (!k || cur.keys.has(k)) continue;
        cur.keys.add(k); cur.words.push({ ...x });
      }
    }
    const list = typeof entries === 'function' ? safe(entries) : entries;
    const fromEntries = (Array.isArray(list) ? list : []).filter(e => e && e.unit && e.headword)
      .sort((a, b) => (a.order ?? 1e6) - (b.order ?? 1e6));
    for (const e of fromEntries) {
      const id = String(e.unit);
      if (!byId.has(id)) byId.set(id, { id, title: defaultTitle(id), order: defaultUnitOrder(id), words: [], keys: new Set(), fromEntries: true });
      const cur = byId.get(id);
      // a unit known only from entries takes its title and order from the first entry that has them
      if (cur.fromEntries && e.unit_title && !cur.titled) { cur.title = e.unit_title; cur.titled = true; }
      if (cur.fromEntries && e.unit_order != null && !cur.ordered) { cur.order = e.unit_order; cur.ordered = true; }
      const k = normWord(e.headword);
      if (cur.keys.has(k)) continue;
      cur.keys.add(k);
      const x = { w: e.headword };
      if (e.brief_cn) x.cn = e.brief_cn;
      if (e.phrase || /\s/.test(k)) x.phrase = true;
      cur.words.push(x);
    }
    units = [...byId.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    unitIndex = new Map(); orderIndex = new Map();
    units.forEach((u, i) => {
      orderIndex.set(u.id, i);
      for (const x of u.words) { const k = normWord(x.w); if (!unitIndex.has(k)) unitIndex.set(k, u.id); }
    });
  }
  build();

  const unitOf = w => unitIndex.get(normWord(w)) || null;
  const pq = (prereq && prereq.prereq) || {};
  function foundations(x) {
    const start = pq[x] ? [x] : grammar(x);
    const out = [], seen = new Set(start);
    let frontier = start;
    while (frontier.length) {
      const next = [];
      for (const it of frontier) for (const p of pq[it] || []) if (!seen.has(p)) { seen.add(p); out.push(p); next.push(p); }
      frontier = next;
    }
    return out;
  }
  function grammar(unit) { const u = prereq && prereq.units; return u && Array.isArray(u[unit]) ? u[unit].slice() : []; }

  // ---- the detailed table, on demand
  let detailIndex = null, detailLoading = null;
  function indexDetails(d) {
    detailIndex = new Map();
    for (const r of (d && Array.isArray(d.words) ? d.words : [])) if (r && r.w) detailIndex.set(normWord(r.w), r);
    return d;
  }
  if (details) indexDetails(details);
  function loadDetails() {
    if (detailIndex) return Promise.resolve(details);
    if (!detailLoading) {
      detailLoading = (async () => {
        try { details = fetchJSON ? await fetchJSON(DETAIL_FILE) : null; } catch (e) { console.warn('curriculum:', DETAIL_FILE, (e && e.message) || e); details = null; }
        if (details) indexDetails(details); else detailLoading = null;
        return details;
      })();
    }
    return detailLoading;
  }
  const detail = w => { if (!detailIndex) return null; const b = baseOf(w); const r = b && detailIndex.get(b); return r ? { ...r } : null; };

  return {
    isPrimary,
    isRequired,
    levelOf,
    baseOf,
    unitOf,
    tierOf: w => (isPrimary(w) ? 'primary' : unitOf(w) ? (isRequired(w) ? 'required' : 'recognize') : 'extra'),
    unitWords: unit => { const u = units.find(x => x.id === unit); return u ? u.words.map(x => ({ ...x })) : []; },
    units: () => units.map(u => ({ id: u.id, title: u.title, order: u.order, count: u.words.length })),
    unitOrder: unit => (orderIndex.has(unit) ? orderIndex.get(unit) : 1e6),
    unitTitle: unit => { const u = units.find(x => x.id === unit); return u ? u.title : defaultTitle(unit); },
    prereq: pq,
    grammar,
    foundations,
    grammarName: id => ((prereq && prereq.names) || {})[id] || String(id || '').replace(/^g:/, ''),
    tags: (tags && tags.tags) || {},
    hasTextbook: () => units.length > 0,
    counts: () => ({ primary: primary.size, junior: junior.size, listed: listed.size }),
    standardWords: () => [...primary, ...junior, ...listed],
    refresh: () => { build(); },
    loadDetails,
    detail,
    posOf: w => { const r = detail(w); return r && r.pos ? r.pos.slice() : null; },
  };
}

function safe(fn) { try { return fn(); } catch (e) { return []; } }

export async function loadCurriculum({ fetchJSON, kv, entries = null, lemma = null, dict = null } = {}) {
  const get = async f => { try { return (await fetchJSON(f)) || {}; } catch (e) { console.warn('curriculum:', f, (e && e.message) || e); return {}; } };
  const [standard, prereq, tags] = await Promise.all([get(FILES.standard), get(FILES.prereq), get(FILES.tags)]);
  let textbook = null;
  try { textbook = kv ? await kv.get('textbook') : null; } catch (e) { textbook = null; }
  const lem = lemma || (dict && typeof dict.lemma === 'function' ? w => dict.lemma(w) : null);
  return createCurriculum({ standard, prereq, tags, textbook, entries, lemma: lem, fetchJSON });
}
