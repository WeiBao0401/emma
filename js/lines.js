// 英语小对话句库（DESIGN 2.5、3.5；teacher-memory 7）：老师打招呼、问一个按钮问题、夸她、说再见。句子全部预写，
// 程序只挑编号；中文字幕见过 5 次、她一次没点“看中文”就默认收起。
// 负责：英语小对话 agent（lines.js、web/curriculum/lines.json、questions.json、intake.json；家长问卷的默认值在 intake.js）。
// v1：夸她分语气（tone）、期中季场景 exam、轻松版按原因（when.reason）、听写分六段（when.phase）、“这周”的按钮问题。
//
// 数据（公开，Claude 预写、Wei 过目）
//   web/curriculum/lines.json：{ version, lines: [{ id, scene, en, zh, words: [...], slots?: ['name'], when?, tone? }], questions: [] }
//     scene：'open' 打开时 | 'ask' 引出按钮问题 | 'praise' 夸她（{word}） | 'close' 收尾 | 'back' 漏了一天回来
//            | 'late' 21:00 以后 | 'easy' 轻松版 | 'dictation' 明天有听写 | 'exam' 期中季
//            另认别名 'welcome_back' = 'back'、'light' = 'easy'
//     en 不超过 8 个词，只用她认识的词（tests/lines.test.mjs 粗检）；{name}、{word}、{minutes} 由 ctx 填，ctx 里没有就不挑这句
//     when（可选）：{ hour: [起, 止) } 按 ctx.hour（默认现在几点）；其他键：true 要 ctx 里有值且不为 0，false 要没有，
//                   其他值要相等。例如 { phase: 'after', wrong: true }
//       praise 认的键：spelled（拼对的）、wrote（纸上写对的）、heard（听音选对的）、again（之前错过、这次对了）、
//                      firstTry（第一次就对）、hard（对她难的词）、lastWeek（上周难、这周对了，周小结用）
//       easy：reason = plan.lightReason（'late' / 'exam' / 'dictation' / 'comeback' / 'chosen'）或 'busy'（家长问卷的忙日子）
//       dictation：phase = 'before' 开始前 | 'during' 一个个读 | 'after' 对完答案（再带 wrong: 错的个数 / perfect: true）
//                  | 'retry' 马上再写错的 | 'tonight' 睡前那次 | 'morning' 出门前看一眼
//       exam：exam = examPhase(progress, now)：'season' | 'quiz' | 'eve' | 'day' | 'done'（见下）
//     tone（可选，praise 用）：['specific' 说出做对了什么 | 'self' 和她以前比 | 'short' 一句短的 | 'fact' 只说事实，不加夸词]
//   web/curriculum/questions.json：{ version, buttons: { none, skip }, questions: [{ id, day, pool, about, to, en, zh, words,
//                   requires?, options: [{ id, en, zh, about, requires? }], options_from?, none: true | false | { en, zh, about } }] }
//     day 1-5 是第一周的按钮问题；pool 'weekly' 的 day 为 null，第 2 周起每周最多一个（weeklyQuestion）
//     requires：题或选项要这些功能上线才出（'story' 'grammar' 'listen' 'tiles' 'dictation'），由调用方用 features 告诉 lines
//     options_from：{ source: 'words' | 'episodes', about, min, max }，选项由调用方现给（这周的词 / 这周的集）
//   web/curriculum/intake.json：家长开机问卷的题目（家长区读；回答存 kv 'parent.intake'，读法见 intake.js）
//
// 导出
//   SCENES、SCENE_ALIASES、ZH_FADE_AFTER = 5、FILE（lines.json）、QUESTIONS_FILE、INTAKE_FILE、FEATURES、TONES
//   EXAM_SEASON_DAYS = 14、EXAM_PHASES、examGap(progress | 'YYYY-MM-DD', now) -> 天数 | null、examPhase(progress, now) -> 段 | ''
//     离考试 4-14 天 'season'（期中季）| 2-3 天 'quiz'（考前小卷）| 1 天 'eve'（只推轻松版、早点睡）| 当天 'day'
//     | 考完 1-3 天 'done'；其余、没填日期返回 ''。孩子看到的句子不说还剩几天（DESIGN 6.4）
//   weekStart(date) -> Date   这周一 0 点（本地）
//   createLines({ data, questions, kv, now, fetchJSON }) -> Lines
//     data       lines.json 的内容；data.questions 也认（老格式和测试用）
//     questions  questions.json 的内容（或一个数组）；没给、又给了 fetchJSON 时，load() 自己去读 QUESTIONS_FILE
//   Lines：
//     load() -> Promise                        读 kv 'lines.seen'（还有 questions.json，见上）
//     pick(scene | [scene], ctx) -> Line | null
//         ctx: { name: 'Emma', word?, minutes?, hour?: 默认现在, phase?, reason?, exam?, tone?: 'fact' | ['specific', 'self'],
//                recent?: [id], ... }
//         几个场景一起给（['exam', 'open']）就从它们的句子里一起轮换；ctx.tone 给了，先挑带这个 tone 的句子，没有就照常挑
//         Line = { id, scene, en, zh, showZh }  en / zh 已填好；轮换：先挑没见过的，再挑最久没见的，不和 ctx.recent、
//                                              上一次挑的重复（只剩一句时除外）
//     markSeen(id) -> void                     显示过一次（异步写 kv）
//     tapZh(id) / markZhTapped(id) -> void     她点了“看中文”（以后这句一直带中文）
//     shouldShowZh(id) -> bool                 见过不到 ZH_FADE_AFTER 次，或者点过“看中文”，就显示中文
//     questionsForDay(n) -> Question | null    第一周第 n 天（1 起，1-5 有）的按钮问题
//     question(id, opts?) -> Question | null   按 id 取（周反思挑的 qid）。opts = { features, words, episodes }：
//         features 已上线的功能（数组或 Set）；requires 不满足的题返回 null、选项去掉，剩下不到 2 个选项也返回 null
//         words [{ slug, w, cn }] / episodes [{ id, en, zh }]：options_from 的题用它们做选项（id 'w:<slug>' / 'ep:<id>'）；
//         words 也可以按题分开给：{ hard_word: [这周错过的词], good_word: [这周答对的词] }（键是 options_from.about）
//     weekly(opts?) -> [Question]              第 2 周起的问题池里现在能问的（opts 同上）
//     weeklyQuestion({ asked?, now?, dayN?, features?, words?, episodes? }) -> Question | null
//         这周（周一起）还没问过任何按钮问题、而且不是第一周（dayN 不到 6 返回 null）时挑一个：先挑没问过的，“这周”的问题
//         （about 以 'week.' 开头）优先，其余按问过的先后；asked 不给就读 kv 'ask.answers'（kv.peek）
//         Question = { id, day, pool, about, to, en, zh, showZh,
//                      options: [{ id, en, zh, about, kind: 'answer' | 'none' }],   “都不是”（有的话）排在最后
//                      skip: { id: 'skip', en: 'Not now', zh: '先跳过', about: null, kind: 'skip' } }   跳过单独放，界面自己摆
//     answerEvent(q, optionId, extra?) -> event   { type: 'ask', qid, who: 'emma', answer, about, ...extra }，交给 ctx.events.log
//     all() -> { lines, questions }
//   kv 'lines.seen' = { id: { n: 见过几次, zh: 点过“看中文”, last: ISO } }（句子和问题共用）
//
// 依赖：无 DOM。kv 是 app.js 的 { get, set, peek }；fetchJSON 是 app.js 的同名函数。

export const SCENES = ['open', 'ask', 'praise', 'close', 'back', 'late', 'easy', 'dictation', 'exam'];
export const SCENE_ALIASES = { welcome_back: 'back', light: 'easy' };
export const ZH_FADE_AFTER = 5;
export const FILE = 'curriculum/lines.json';
export const QUESTIONS_FILE = 'curriculum/questions.json';
export const INTAKE_FILE = 'curriculum/intake.json';
export const FEATURES = ['story', 'grammar', 'listen', 'tiles', 'dictation'];
export const TONES = ['specific', 'self', 'short', 'fact'];
export const EXAM_SEASON_DAYS = 14;
export const EXAM_PHASES = ['season', 'quiz', 'eve', 'day', 'done'];
const SEEN_KEY = 'lines.seen';
const ASK_KEY = 'ask.answers';

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
  exam: { id: 'fallback-exam', en: 'A little review every day helps.', zh: '每天复习一点，很有用。' },
};
const BUTTONS = {
  none: { id: 'none', en: 'Not these', zh: '都不是', about: null },
  skip: { id: 'skip', en: 'Not now', zh: '先跳过', about: null },
};

const slotsOf = l => [...new Set([...`${l.en || ''} ${l.zh || ''}`.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
const has = v => v != null && v !== '' && v !== false && v !== 0;
const fill = (s, ctx) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (has(ctx[k]) ? String(ctx[k]) : m));
const sceneOf = s => SCENE_ALIASES[s] || s;
const listOf = v => (v instanceof Set ? [...v] : [].concat(v ?? [])).filter(x => x != null && x !== '');

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

// ---------------------------------------------------------------- exam season (DESIGN 6.4)

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export function examGap(progress, now = new Date()) {
  const s = typeof progress === 'string' ? progress : progress && progress.examDate;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const exam = new Date(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(exam.getTime())) return null;
  return Math.round((exam - midnight(new Date(now))) / 864e5);
}
export function examPhase(progress, now = new Date()) {
  const gap = examGap(progress, now);
  if (gap === null || gap > EXAM_SEASON_DAYS || gap < -3) return '';
  if (gap >= 4) return 'season';
  if (gap >= 2) return 'quiz';
  if (gap === 1) return 'eve';
  if (gap === 0) return 'day';
  return 'done';
}
export function weekStart(date = new Date()) {
  const d = midnight(new Date(date));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ---------------------------------------------------------------- lines

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
  const lastPick = new Map();  // scene (or 'a+b' for several) -> id picked last time
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
    const scenes = [...new Set(listOf(scene).map(sceneOf))];
    if (!scenes.length) return null;
    const key = scenes.join('+');
    const c = { name: 'Emma', hour: now().getHours(), ...ctx };
    let pool = lines.filter(l => scenes.includes(l.scene) && whenOK(l.when, c) && slotsOf(l).every(k => has(c[k])));
    // the tone she likes (intake.js praise.tone): a preference, never an empty pool
    const tones = listOf(c.tone);
    if (tones.length) {
      const toned = pool.filter(l => Array.isArray(l.tone) && l.tone.some(t => tones.includes(t)));
      if (toned.length) pool = toned;
    }
    const recent = new Set(listOf(c.recent));
    if (pool.length > 1 && lastPick.has(key)) recent.add(lastPick.get(key));
    const order = pool.map((l, i) => ({ l, i, r: recent.has(l.id) ? 1 : 0, t: lastUsed(l.id) }))
      .sort((a, b) => a.r - b.r || a.t - b.t || a.i - b.i);
    let l = order.length ? order[0].l : null;
    let sc = l ? l.scene : scenes[0];
    if (!l) {
      for (const s of scenes) {
        const fb = FALLBACK[s];
        if (fb && slotsOf(fb).every(k => has(c[k]))) { l = fb; sc = s; break; }
      }
    }
    if (!l) return null;
    used.set(l.id, stamp());
    lastPick.set(key, l.id);
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

  // ---------------------------------------------------------------- button questions

  const poolOf = q => q.pool || (q.day ? 'week1' : 'weekly');
  const allowed = (req, feats) => listOf(req).every(r => feats.has(r));
  // options a caller hands in: this week's words or episodes (questions.json options_from)
  function dynamicOptions(from, o) {
    let src = from.source === 'episodes' ? o.episodes : o.words;
    // words can come per question kind: { hard_word: [...wrong this week], good_word: [...right this week] }
    if (src && !Array.isArray(src) && typeof src === 'object') src = src[from.about] || src.default || [];
    const out = [];
    const ids = new Set();
    for (const x of Array.isArray(src) ? src : []) {
      if (!x || typeof x !== 'object') continue;
      const opt = from.source === 'episodes'
        ? (x.id != null ? { id: `ep:${x.id}`, en: x.en || x.title || '', zh: x.zh || '', about: `${from.about || 'episode'}:${x.id}` } : null)
        : (x.slug ? { id: `w:${x.slug}`, en: x.w || x.headword || x.slug, zh: x.cn || x.brief_cn || '', about: `${from.about || 'word'}:${x.slug}` } : null);
      if (!opt || !opt.en || ids.has(opt.id)) continue;
      ids.add(opt.id);
      out.push(opt);
    }
    return out.slice(0, Number(from.max) > 0 ? Number(from.max) : 4);
  }

  // all: true keeps every static option (answerEvent, all()); otherwise requires / options_from apply
  function normalize(q, o = {}) {
    if (!q) return null;
    const feats = new Set(listOf(o.features));
    if (!o.all && !allowed(q.requires, feats)) return null;
    const opt = (x, kind) => ({ id: String(x.id), en: x.en || '', zh: x.zh || '', about: x.about ?? (Array.isArray(x.tags) ? x.tags[0] ?? null : null), kind });
    let src = (q.options || []).filter(x => x && x.id != null && (o.all || allowed(x.requires, feats)));
    if (q.options_from && !o.all) src = src.concat(dynamicOptions(q.options_from, o));
    const options = src.map(x => opt(x, 'answer'));
    const conditional = !!q.options_from || (q.options || []).some(x => x && x.requires);
    const min = Math.max(2, Number(q.options_from && q.options_from.min) || 0);
    if (!o.all && conditional && options.length < min) return null;
    if (q.none) options.push(opt({ ...buttons.none, ...(typeof q.none === 'object' ? q.none : {}), id: 'none' }, 'none'));
    return { id: q.id, day: q.day ?? null, pool: poolOf(q), about: q.about || null, to: q.to || null,
      en: q.en || '', zh: q.zh || '', showZh: shouldShowZh(q.id), options, skip: opt(buttons.skip, 'skip') };
  }
  const questionsForDay = n => normalize(questions.find(q => q.day != null && Number(q.day) === Number(n)));
  const question = (id, o = {}) => normalize(questions.find(q => q.id === id), o);
  const weekly = (o = {}) => questions.filter(q => poolOf(q) === 'weekly').map(q => normalize(q, o)).filter(Boolean);

  function weeklyQuestion({ asked = null, now: at = null, dayN = null, features = null, words = null, episodes = null } = {}) {
    if (dayN != null && Number(dayN) <= 5) return null;
    let answers = asked;
    if (!answers) { try { answers = kv && kv.peek ? kv.peek(ASK_KEY, {}) : {}; } catch (e) { answers = {}; } }
    answers = answers && typeof answers === 'object' ? answers : {};
    const ws = weekStart(at ? new Date(at) : now()).getTime();
    const when = a => (a && a.at ? Date.parse(a.at) || 0 : 0);
    if (Object.values(answers).some(a => when(a) >= ws)) return null;
    const cands = questions.map((q, i) => ({ q, i })).filter(x => poolOf(x.q) === 'weekly')
      .map(x => ({ ...x, nq: normalize(x.q, { features, words, episodes }), t: when(answers[x.q.id]), wk: /^week\./.test(x.q.about || '') ? 0 : 1 }))
      .filter(x => x.nq);
    cands.sort((a, b) => (a.t ? 1 : 0) - (b.t ? 1 : 0) || a.t - b.t || a.wk - b.wk || a.i - b.i);
    return cands.length ? cands[0].nq : null;
  }

  function answerEvent(q, optionId, extra = {}) {
    const qq = q && typeof q === 'object' ? q : normalize(questions.find(x => x.id === q), { all: true });
    const qid = qq ? qq.id : String(q);
    const o = qq && qq.options ? qq.options.find(x => x.id === optionId) : null;
    let about = o ? o.about : null;
    // a word or an episode the caller handed in, answered by id only
    if (!o && typeof optionId === 'string' && /^(w|ep):/.test(optionId)) {
      const raw = questions.find(x => x.id === qid);
      if (raw && raw.options_from) about = `${raw.options_from.about || 'word'}:${optionId.replace(/^(w|ep):/, '')}`;
    }
    return { type: 'ask', qid, who: 'emma', answer: optionId, about, ...extra };
  }

  return { load, pick, markSeen, tapZh, markZhTapped: tapZh, shouldShowZh, questionsForDay, question, weekly, weeklyQuestion, answerEvent,
    all: () => ({ lines, questions }) };
}
