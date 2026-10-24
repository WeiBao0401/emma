// 英语小对话句库（DESIGN 2.5、3.5；teacher-memory 7）：老师打招呼、问一个按钮问题、夸她、说再见。句子全部预写，
// 程序只挑编号；中文字幕见过 5 次、她一次没点“看中文”就默认收起。
// 负责：英语小对话 agent（lines.js、web/curriculum/lines.json、questions.json、intake.json）。
//
// 数据（公开，Claude 预写、Wei 过目）
//   web/curriculum/lines.json：{ version, lines: [{ id, scene, en, zh, words: [...], slots?: ['name'], when? }], questions: [] }
//     scene：'open' 打开时 | 'ask' 引出按钮问题 | 'praise' 夸她（{word}） | 'close' 收尾 | 'back' 漏了一天回来
//            | 'late' 21:00 以后 | 'easy' 轻松版 | 'dictation' 听写前后（when.phase：'before' / 'after'）
//            另认别名 'welcome_back' = 'back'、'light' = 'easy'
//     en 不超过 8 个词，只用她认识的词（tests/lines.test.mjs 粗检）；{name}、{word}、{minutes} 由 ctx 填，ctx 里没有就不挑这句
//     when（可选）：{ hour: [起, 止) } 按 ctx.hour（默认现在几点）；其他键：true 要 ctx 里有值且不为 0，false 要没有，
//                   其他值要相等。例如 { phase: 'after', wrong: true }
//   web/curriculum/questions.json：{ version, buttons: { none, skip }, questions: [{ id, day, pool, about, to, en, zh, words,
//                   options: [{ id, en, zh, about }], none: true | false | { en, zh, about } }] }
//     day 1-5 是第一周的按钮问题；pool 'weekly' 的 day 为 null，第 2 周起由周反思按 id 挑
//   web/curriculum/intake.json：家长开机问卷的题目（家长区读；回答存 kv 'parent.intake'，形状见文件里的 rules）
//
// 导出
//   SCENES、SCENE_ALIASES、ZH_FADE_AFTER = 5、FILE（lines.json）、QUESTIONS_FILE、INTAKE_FILE
//   createLines({ data, questions, kv, now, fetchJSON }) -> Lines
//     data       lines.json 的内容；data.questions 也认（老格式和测试用）
//     questions  questions.json 的内容（或一个数组）；没给、又给了 fetchJSON 时，load() 自己去读 QUESTIONS_FILE
//   Lines：
//     load() -> Promise                        读 kv 'lines.seen'（还有 questions.json，见上）
//     pick(scene, ctx) -> Line | null          ctx: { name: 'Emma', word?, minutes?, hour?: 默认现在, phase?, recent?: [id], ... }
//         Line = { id, scene, en, zh, showZh }  en / zh 已填好；轮换：先挑没见过的，再挑最久没见的，不和 ctx.recent、
//                                              上一次挑的重复（这个场景只剩一句时除外）
//     markSeen(id) -> void                     显示过一次（异步写 kv）
//     tapZh(id) / markZhTapped(id) -> void     她点了“看中文”（以后这句一直带中文）
//     shouldShowZh(id) -> bool                 见过不到 ZH_FADE_AFTER 次，或者点过“看中文”，就显示中文
//     questionsForDay(n) -> Question | null    第一周第 n 天（1 起，1-5 有）的按钮问题
//     question(id) -> Question | null          按 id 取（周反思挑的 qid）
//     weekly() -> [Question]                   第 2 周起的问题池
//         Question = { id, day, pool, about, to, en, zh, showZh,
//                      options: [{ id, en, zh, about, kind: 'answer' | 'none' }],   “都不是”（有的话）排在最后
//                      skip: { id: 'skip', en: 'Not now', zh: '先跳过', about: null, kind: 'skip' } }   跳过单独放，界面自己摆
//     answerEvent(q, optionId, extra?) -> event   { type: 'ask', qid, who: 'emma', answer, about, ...extra }，交给 ctx.events.log
//     all() -> { lines, questions }
//   kv 'lines.seen' = { id: { n: 见过几次, zh: 点过“看中文”, last: ISO } }（句子和问题共用）
//
// 依赖：无 DOM。kv 是 app.js 的 { get, set }；fetchJSON 是 app.js 的同名函数。

export const SCENES = ['open', 'ask', 'praise', 'close', 'back', 'late', 'easy', 'dictation'];
export const SCENE_ALIASES = { welcome_back: 'back', light: 'easy' };
export const ZH_FADE_AFTER = 5;
export const FILE = 'curriculum/lines.json';
export const QUESTIONS_FILE = 'curriculum/questions.json';
export const INTAKE_FILE = 'curriculum/intake.json';
const SEEN_KEY = 'lines.seen';

// Shown when the bank has nothing for a scene (a broken or missing file)
const FALLBACK = {
  open: { id: 'fallback-open', en: 'Hi {name}!', zh: '嗨 {name}！' },
  ask: { id: 'fallback-ask', en: 'One question for you.', zh: '问你一个问题。' },
  praise: { id: 'fallback-praise', en: 'Well done!', zh: '做得好！' },
  close: { id: 'fallback-close', en: 'See you tomorrow!', zh: '明天见！' },
  back: { id: 'fallback-back', en: 'Welcome back!', zh: '欢迎回来！' },
  late: { id: 'fallback-late', en: "It's late. Let's do a short one.", zh: '有点晚了，我们做一节短的。' },
  easy: { id: 'fallback-easy', en: 'Short is good, too!', zh: '短一点也很好！' },
  dictation: { id: 'fallback-dictation', en: 'Take your time.', zh: '慢慢来。' },
};
const BUTTONS = {
  none: { id: 'none', en: 'Not these', zh: '都不是', about: null },
  skip: { id: 'skip', en: 'Not now', zh: '先跳过', about: null },
};

const slotsOf = l => [...new Set([...`${l.en || ''} ${l.zh || ''}`.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
const has = v => v != null && v !== '' && v !== false && v !== 0;
const fill = (s, ctx) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (has(ctx[k]) ? String(ctx[k]) : m));

// a line's optional `when` against ctx (see the header)
function whenOK(when, ctx) {
  if (!when || typeof when !== 'object') return true;
  for (const [k, want] of Object.entries(when)) {
    const v = ctx[k];
    if (Array.isArray(want)) { const n = Number(v); if (v == null || !Number.isFinite(n) || n < want[0] || n >= want[1]) return false; }
    else if (want === true) { if (!has(v)) return false; }
    else if (want === false) { if (has(v)) return false; }
    else if (v !== want) return false;
  }
  return true;
}

export function createLines({ data = {}, questions: qdata = null, kv = null, now = () => new Date(), fetchJSON = null } = {}) {
  const lines = Array.isArray(data && data.lines) ? data.lines.filter(l => l && l.id && l.scene) : [];
  let questions = [];
  let buttons = { ...BUTTONS };
  function setQuestions(src) {
    const list = [].concat(Array.isArray(data && data.questions) ? data.questions : [],
      Array.isArray(src) ? src : (src && Array.isArray(src.questions) ? src.questions : []));
    const ids = new Set();
    questions = list.filter(q => q && q.id && !ids.has(q.id) && ids.add(q.id));
    const b = src && !Array.isArray(src) && src.buttons;
    if (b) buttons = { none: { ...BUTTONS.none, ...(b.none || {}), id: 'none' }, skip: { ...BUTTONS.skip, ...(b.skip || {}), id: 'skip' } };
  }
  setQuestions(qdata);

  let seen = {};               // kv 'lines.seen': { id: { n, zh, last } }
  const used = new Map();      // id -> ms it was last picked or seen in this session (strictly increasing)
  const lastPick = new Map();  // scene -> id picked last time
  let tick = 0;
  const stamp = () => (tick = Math.max(now().getTime(), tick + 1));

  async function load() {
    try { const v = kv && (await kv.get(SEEN_KEY)); seen = v && typeof v === 'object' ? v : {}; } catch (e) { seen = {}; }
    if (fetchJSON && !qdata) {
      try { setQuestions(await fetchJSON(QUESTIONS_FILE)); } catch (e) { console.warn('questions:', (e && e.message) || e); }
    }
  }
  const save = () => {
    if (!kv) return;
    Promise.resolve().then(() => kv.set(SEEN_KEY, seen)).catch(e => console.warn('lines:', (e && e.message) || e));
  };

  const shouldShowZh = id => { const s = seen[id]; return !s || !!s.zh || (s.n || 0) < ZH_FADE_AFTER; };
  const lastUsed = id => Math.max(used.get(id) || 0, (seen[id] && Date.parse(seen[id].last)) || 0);

  function pick(scene, ctx = {}) {
    const sc = SCENE_ALIASES[scene] || scene;
    const c = { name: 'Emma', hour: now().getHours(), ...ctx };
    const pool = lines.filter(l => l.scene === sc && whenOK(l.when, c) && slotsOf(l).every(k => has(c[k])));
    const recent = new Set([].concat(c.recent || []));
    if (pool.length > 1 && lastPick.has(sc)) recent.add(lastPick.get(sc));
    const order = pool.map((l, i) => ({ l, i, r: recent.has(l.id) ? 1 : 0, t: lastUsed(l.id) }))
      .sort((a, b) => a.r - b.r || a.t - b.t || a.i - b.i);
    const fb = FALLBACK[sc];
    const l = order.length ? order[0].l : (fb && slotsOf(fb).every(k => has(c[k])) ? fb : null);
    if (!l) return null;
    used.set(l.id, stamp());
    lastPick.set(sc, l.id);
    return { id: l.id, scene: sc, en: fill(l.en, c), zh: fill(l.zh, c), showZh: shouldShowZh(l.id) };
  }

  function markSeen(id) {
    if (!id) return;
    const s = seen[id] || (seen[id] = { n: 0, zh: false });
    s.n = (s.n || 0) + 1;
    s.last = now().toISOString();
    used.set(id, stamp());
    save();
  }
  function tapZh(id) {
    if (!id) return;
    const s = seen[id] || (seen[id] = { n: 0, zh: false });
    s.zh = true;
    save();
  }

  function normalize(q) {
    if (!q) return null;
    const opt = (o, kind) => ({ id: String(o.id), en: o.en || '', zh: o.zh || '', about: o.about ?? (Array.isArray(o.tags) ? o.tags[0] ?? null : null), kind });
    const options = (q.options || []).filter(o => o && o.id != null).map(o => opt(o, 'answer'));
    if (q.none) options.push(opt({ ...buttons.none, ...(typeof q.none === 'object' ? q.none : {}), id: 'none' }, 'none'));
    return { id: q.id, day: q.day ?? null, pool: q.pool || (q.day ? 'week1' : 'weekly'), about: q.about || null, to: q.to || null,
      en: q.en || '', zh: q.zh || '', showZh: shouldShowZh(q.id), options, skip: opt(buttons.skip, 'skip') };
  }
  const questionsForDay = n => normalize(questions.find(q => q.day != null && Number(q.day) === Number(n)));
  const question = id => normalize(questions.find(q => q.id === id));
  const weekly = () => questions.filter(q => (q.pool || (q.day ? 'week1' : 'weekly')) === 'weekly').map(normalize);

  function answerEvent(q, optionId, extra = {}) {
    const qq = q && typeof q === 'object' ? q : question(q);
    const qid = qq ? qq.id : String(q);
    const o = qq && qq.options ? qq.options.find(x => x.id === optionId) : null;
    return { type: 'ask', qid, who: 'emma', answer: optionId, about: o ? o.about : null, ...extra };
  }

  return { load, pick, markSeen, tapZh, markZhTapped: tapZh, shouldShowZh, questionsForDay, question, weekly, answerEvent,
    all: () => ({ lines, questions }) };
}
