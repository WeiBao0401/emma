// 英语小对话句库（DESIGN 2.5）：老师打招呼、问一个按钮问题、夸她、说再见。句子全部预写，程序只挑编号；
// 中文字幕见过 5 次、她一次没点“看中文”就默认收起。
// 负责：英语小对话 agent（lines.js、web/curriculum/lines.json）。
// 状态：骨架。函数签名已定；句库是空的占位，pick 先返回一句固定的兜底话。
//
// 句库 web/curriculum/lines.json（公开，Claude 预写、Wei 过目）：
//   { version, lines: [{ id, scene, en, zh, words: [...], slots?: ['word'] }],
//     questions: [{ id, day, en, zh, options: [{ id, en, zh, tags: [...] }] }] }
//   scene：'open' 打开时 | 'ask' 一个问题 | 'praise' 夸她（v1） | 'close' 收尾 | 'back' 漏了一天回来 | 'late' 21:00 以后
//   en 不超过 8 个词，只用她认识的词；slots 里的 {word} 由 ctx 填
//
// 导出
//   SCENES
//   ZH_FADE_AFTER = 5                         见过几次后默认收起中文
//   createLines({ data, kv, now }) -> { load, pick, markSeen, tapZh, shouldShowZh, questionsForDay, all }
//     load() -> Promise                        读 kv 'lines.seen'
//     pick(scene, ctx) -> Line | null          ctx: { name: 'Emma', word?, day?: 第几天(1 起), hour?, recent?: [id] }
//         Line = { id, scene, en, zh, showZh }  en / zh 已填好 slots；同一场景尽量不和 ctx.recent 重复
//     markSeen(id) -> void                     显示过一次（异步写 kv）
//     tapZh(id) -> void                        她点了“看中文”（以后这句一直带中文）
//     shouldShowZh(id) -> bool                 见过不到 ZH_FADE_AFTER 次，或者点过“看中文”，就显示中文
//     questionsForDay(n) -> Question | null     第一周第 n 天（1-5）的按钮问题；回答记 events 'ask'（qid、who:'emma'、answer）
//     all() -> { lines, questions }
//
// 依赖：kv 是 app.js 的 { get, set }；data 是 lines.json 的内容（app.js 用 fetchJSON 读好传进来）。

export const SCENES = ['open', 'ask', 'praise', 'close', 'back', 'late'];
export const ZH_FADE_AFTER = 5;
export const FILE = 'curriculum/lines.json';

// Shown when the bank has nothing for a scene (the stub, or a broken file)
const FALLBACK = {
  open: { id: 'fallback-open', en: 'Hi {name}!', zh: '嗨 {name}！' },
  close: { id: 'fallback-close', en: 'See you tomorrow!', zh: '明天见！' },
};

const fill = (s, ctx) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (ctx && ctx[k] != null ? String(ctx[k]) : m));

export function createLines({ data = {}, kv = null, now = () => new Date() } = {}) {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const questions = Array.isArray(data.questions) ? data.questions : [];
  let seen = {};   // { id: { n, zh: bool, last } }

  async function load() {
    try { seen = (kv && (await kv.get('lines.seen'))) || {}; } catch (e) { seen = {}; }
  }
  const save = () => { if (kv) kv.set('lines.seen', seen).catch(e => console.warn('lines:', (e && e.message) || e)); };

  const shouldShowZh = id => { const s = seen[id]; return !s || s.zh || (s.n || 0) < ZH_FADE_AFTER; };

  function pick(scene, ctx = {}) {
    const c = { name: 'Emma', ...ctx };
    const pool = lines.filter(l => l.scene === scene);
    const recent = new Set(c.recent || []);
    const l = pool.find(x => !recent.has(x.id)) || pool[0] || FALLBACK[scene];
    if (!l) return null;
    return { id: l.id, scene, en: fill(l.en, c), zh: fill(l.zh, c), showZh: shouldShowZh(l.id) };
  }

  function markSeen(id) {
    const s = seen[id] || (seen[id] = { n: 0, zh: false });
    s.n++;
    s.last = now().toISOString();
    save();
  }
  function tapZh(id) {
    const s = seen[id] || (seen[id] = { n: 0, zh: false });
    s.zh = true;
    save();
  }

  const questionsForDay = n => questions.find(q => Number(q.day) === Number(n)) || null;

  return { load, pick, markSeen, tapZh, shouldShowZh, questionsForDay, all: () => ({ lines, questions }) };
}
