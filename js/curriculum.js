// 课标词表和课本单元词（DESIGN 5.1、6.8）：哪个词是小学 505 词、哪个在课标 1600 词表里（必会，要会写）、
// 课本里属于哪个单元、单元的先后，以及前置关系表。
// 负责：课标数据 agent（curriculum.js、web/curriculum/standard-words.json、prereq.json、tags.json、tools/ 里的生成脚本）。
// 状态：骨架。函数签名已定，数据文件是空的占位；负责的 agent 填数据、补实现。
//
// 两层数据，分开放：
//   公开（进仓库）web/curriculum/standard-words.json  { version, source, primary: [505 个词], junior: [1095 个词] }
//                 web/curriculum/prereq.json          { version, prereq: { 'g:there_be': ['g:be'], ... } }
//                 web/curriculum/tags.json            误解标签表 { version, tags: { id: { zh, kind } } }
//   私有（只在 iPad 上，kv 'textbook'）课本单元和单元词，由 Wei 拍的词汇表在电脑上识别后导入，绝不进仓库：
//                 { book: '外研版七上', units: [{ id: 'S', title: 'Starter', order: 0, words: [{ w, cn?, phrase? }] }], importedAt }
//
// 导出
//   loadCurriculum({ fetchJSON, kv }) -> Promise<Curriculum>   启动时调用一次；文件或 kv 读不到就用空数据，不抛错
//   createCurriculum({ standard, prereq, tags, textbook }) -> Curriculum   纯函数，Node 测试直接用
//   Curriculum（app.js 放在 ctx.curriculum）:
//     isPrimary(word) -> bool          课标二级（小学）505 词
//     isRequired(word) -> bool         课标三级 1600 词（含 505）：必会词，开“写得出”线；不在表里的课本词只认读
//     tierOf(word) -> 'primary' | 'required' | 'recognize' | 'extra'
//                                      primary 小学词；required 课本里的必会词；recognize 课本里的认读词；extra 课外词
//     unitOf(word) -> unit id | null   课本里第一次出现的单元（'S'、'U1'…）；课外词为 null
//     unitWords(unit) -> [{ w, cn?, phrase? }]   这个单元的词，按课本顺序
//     units() -> [{ id, title, order, count }]   按课本顺序
//     unitOrder(unit) -> number        排序用；不认识的单元排最后
//     prereq                           前置关系表 { item: [item...] }（和 prereq.json 同形）
//     tags                             误解标签表 { id: { zh, kind } }
//     hasTextbook() -> bool            Wei 的课本导入过没有
//
// 词的写法：一律小写、去两头空格比较（normWord）。短语按整串比较。
// 依赖：无（纯数据）。kv 是 app.js 的 { get(key) }。

export const normWord = w => String(w ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

export const FILES = { standard: 'curriculum/standard-words.json', prereq: 'curriculum/prereq.json', tags: 'curriculum/tags.json' };

export function createCurriculum({ standard = {}, prereq = {}, tags = {}, textbook = null } = {}) {
  const primary = new Set((standard.primary || []).map(normWord));
  const junior = new Set((standard.junior || []).map(normWord));
  const units = (textbook && Array.isArray(textbook.units) ? textbook.units : []).slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const unitIndex = new Map();
  units.forEach((u, i) => { for (const x of u.words || []) { const k = normWord(x.w); if (k && !unitIndex.has(k)) unitIndex.set(k, u.id); } unitIndex.set('#' + u.id, i); });

  const isPrimary = w => primary.has(normWord(w));
  const isRequired = w => primary.has(normWord(w)) || junior.has(normWord(w));
  const unitOf = w => unitIndex.get(normWord(w)) || null;
  return {
    isPrimary,
    isRequired,
    unitOf,
    tierOf: w => (isPrimary(w) ? 'primary' : unitOf(w) ? (isRequired(w) ? 'required' : 'recognize') : 'extra'),
    unitWords: unit => { const u = units.find(x => x.id === unit); return u ? (u.words || []).map(x => ({ ...x })) : []; },
    units: () => units.map(u => ({ id: u.id, title: u.title || u.id, order: u.order ?? 0, count: (u.words || []).length })),
    unitOrder: unit => (unitIndex.has('#' + unit) ? unitIndex.get('#' + unit) : 1e6),
    prereq: (prereq && prereq.prereq) || {},
    tags: (tags && tags.tags) || {},
    hasTextbook: () => units.length > 0,
  };
}

export async function loadCurriculum({ fetchJSON, kv } = {}) {
  const get = async f => { try { return (await fetchJSON(f)) || {}; } catch (e) { console.warn('curriculum:', f, (e && e.message) || e); return {}; } };
  const [standard, prereq, tags] = await Promise.all([get(FILES.standard), get(FILES.prereq), get(FILES.tags)]);
  let textbook = null;
  try { textbook = kv ? await kv.get('textbook') : null; } catch (e) { textbook = null; }
  return createCurriculum({ standard, prereq, tags, textbook });
}
