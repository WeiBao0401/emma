// 孩子端“我”：她自己设进度、说喜好、给难度反馈、开课前选今天先练什么（Wei 10-25：互动太流程化，要让她自己参与）。
// 这里只有逻辑，没有 DOM（界面在 ui-kid-me.js，样式 css/kid-me.css，类名 km-）。负责：孩子端“我” agent（第 5 批）。
//
// kv 键（只加不改，都随备份走）
//   'progress'    和家长区同一个键、同一个形状 { unit, examFrom, examTo, examDate, updated }。她改的那次另带 by: 'emma'
//                 （家长区改的不带，或者接线以后带 'parent'）。updated 用 ISO 时间，备份恢复照旧“新的赢”（ui-parent mergeProgress）
//   'kid.prefs'   { v: 1, topics: [id], stories: [id], storyNote, quiz: [id], teacherName, updated }。teacherName 同时写进
//                 'profile'.teacherName（问老师的提示词、上课的称呼原来就读那里），两处一致
//   'kid.level'   难度 { v: 1, parts: { warmup | read | write | grammar: { level, run: { choice, n }, last, changed, log: [{ at, choice, from, level }] } }, updated }
//                 log 每部分最多 20 条。level 在 -1..+2（LEVEL_MIN..LEVEL_MAX）
//   'kid.today'   今天先练什么 { v: 1, date: 'YYYY-MM-DD', choice, at }，只有 date 是今天才算数
//
// 事件（新类型 'feedback'，要接线加进 events.js EVENT_TYPES，见 wip/b5/kid-me-needs.md；没加之前 events.log 返回 null，kv 照样记）
//   { type: 'feedback', step, part, choice: 'easy' | 'ok' | 'hard', level（这次以后的等级）, prev, changed, from: 'button' | 'chat',
//     sid?, item?, mode?, text?（from chat 时她说的话，前 40 个字） }
//   开课前选今天先练什么记 { type: 'ask', qid: 'today', who: 'emma', answer: choice, about: 'today:<choice>', step: 'warmup', sid? }
//
// 导出（细节见各函数上面的注释）
//   PREFS_KEY、TODAY_KEY、LEVEL_KEY、PROGRESS_KEY、PARTS、PART_ZH、PART_STEP、LEVEL_MIN、LEVEL_MAX、DECAY_DAYS、
//   FEEDBACK_CHOICES、TOPICS、STORY_KINDS、QUIZ_KINDS、TEACHER_SUGGEST、TODAY_CHOICES
//   ymd(date)、readProgress(kv)、progressPatch(cur, patch, { order, now })、saveProgress(kv, patch, { order, now })、
//   progressText(progress, { title })、unitChoices(curriculum)
//   readPrefs(kv)、normPrefs(raw)、savePrefs(kv, patch, now)、prefsForPrompt(kv)、storyBrief(kv)
//   readLevels(kv)、levelOf(rec, now)、difficulty(kv, now) -> { warmup, read, write, grammar }、levelZh(n)、
//   applyFeedback(rec, choice, { now, from })、recordFeedback(ctx, { part, choice, from, now, sid, item, mode, text })、
//   resetLevels(kv, now)、knobs(levels)、knobsFor(kv, now)
//   todayChoice(kv, now) -> choice id | ''、setTodayChoice(kv, choice, now)、needsTodayAsk(kv, now, { first })、
//   todayMix(choice, { examSet })、shiftMinutes(cells, choice, { limit, ready, examSet })、todayEvent(choice, sid)
//   parseFeedbackText(text) -> null | { choice, part, parts, reply, strength }、applyChatFeedback(ctx, text, now)

export const PREFS_KEY = 'kid.prefs';
export const TODAY_KEY = 'kid.today';
export const LEVEL_KEY = 'kid.level';
export const PROGRESS_KEY = 'progress';

// ---------------------------------------------------------------- 小工具
const pad = n => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const iso = now => (now instanceof Date ? now : new Date(now)).toISOString();
const peek = (kv, k, d) => { try { const v = kv && kv.peek ? kv.peek(k, d) : d; return v === undefined || v === null ? d : v; } catch (e) { return d; } };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clean = (s, max = 40) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const DAY = 86400000;
const daysBetween = (a, b) => Math.floor((localMid(b) - localMid(a)) / DAY);
function localMid(d) { const x = d instanceof Date ? d : new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); }

// ---------------------------------------------------------------- 1. 她自己设进度（kv 'progress'，和家长区同一个）
export function readProgress(kv) { return { ...obj(peek(kv, PROGRESS_KEY, {})) }; }

// cur: 现在的 progress；patch 只认 unit、examDate、examFrom、examTo（'' 是清掉）。order(id) 给单元先后，范围反了自动调过来。
// 返回 { progress, error }：error 是给她看的一句（日期格式不对、考试日已经过去了），有 error 时 progress 是 null
export function progressPatch(cur = {}, patch = {}, { order = null, now = new Date() } = {}) {
  const out = { ...obj(cur) };
  const p = obj(patch);
  if ('unit' in p) out.unit = clean(p.unit, 12);
  if ('examDate' in p) {
    const d = String(p.examDate || '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { progress: null, error: '这个日子看不懂，再选一次。' };
    if (d && d < ymd(now)) return { progress: null, error: '这天已经过去了，选考试那天。' };
    out.examDate = d;
  }
  if ('examFrom' in p) out.examFrom = clean(p.examFrom, 12);
  if ('examTo' in p) out.examTo = clean(p.examTo, 12);
  if (out.examFrom && !out.examTo) out.examTo = out.examFrom;
  if (out.examTo && !out.examFrom) out.examFrom = out.examTo;
  if (order && out.examFrom && out.examTo) {
    let a = 0, b = 0;
    try { a = order(out.examFrom); b = order(out.examTo); } catch (e) { a = b = 0; }
    if (a > b) [out.examFrom, out.examTo] = [out.examTo, out.examFrom];
  }
  out.updated = iso(now);
  out.by = 'emma';
  return { progress: out, error: '' };
}
export async function saveProgress(kv, patch, { order = null, now = new Date() } = {}) {
  const r = progressPatch(readProgress(kv), patch, { order, now });
  if (r.progress) await kv.set(PROGRESS_KEY, r.progress);
  return r;
}
// curriculum.units() -> [{ id, title, count, order }]，坏的去掉，按 order 排
export function unitChoices(curriculum) {
  let list = [];
  try { list = (curriculum && curriculum.units ? curriculum.units() : []) || []; } catch (e) { list = []; }
  return list.filter(u => u && u.id).map((u, i) => ({ id: u.id, title: clean(u.title || u.id, 40), count: Number(u.count) || 0, order: Number.isFinite(u.order) ? u.order : i }))
    .sort((a, b) => a.order - b.order);
}
// 一句话：“学到 Unit 2 · 11 月 6 日考 Starter 到 Unit 2”
export function progressText(p = {}, { title = id => id } = {}) {
  const parts = [];
  if (p.unit) parts.push(`学到 ${title(p.unit)}`);
  if (p.examDate || p.examFrom) {
    const range = p.examFrom && p.examTo ? (p.examFrom === p.examTo ? title(p.examFrom) : `${title(p.examFrom)} 到 ${title(p.examTo)}`) : '';
    const day = p.examDate ? `${Number(p.examDate.slice(5, 7))} 月 ${Number(p.examDate.slice(8, 10))} 日考` : '考';
    parts.push(range ? `${day} ${range}` : day);
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------- 2. 喜好（kv 'kid.prefs'）
export const TOPICS = [
  { id: 'cats', zh: '猫' }, { id: 'animals', zh: '小动物' }, { id: 'food', zh: '好吃的' }, { id: 'school', zh: '学校和朋友' },
  { id: 'family', zh: '家里的事' }, { id: 'sports', zh: '运动' }, { id: 'music', zh: '音乐' }, { id: 'art', zh: '画画' },
  { id: 'games', zh: '游戏' }, { id: 'travel', zh: '出去玩' }, { id: 'nature', zh: '天气和自然' }, { id: 'science', zh: '好奇的科学' },
];
export const STORY_KINDS = [
  { id: 'cat_adventure', zh: '猫的冒险' }, { id: 'school_life', zh: '校园日常' }, { id: 'mystery', zh: '找线索破案' },
  { id: 'magic', zh: '魔法和奇幻' }, { id: 'funny', zh: '好笑的故事' }, { id: 'friends', zh: '朋友之间' }, { id: 'animals_talk', zh: '会说话的动物' },
];
export const QUIZ_KINDS = [
  { id: 'mc4', zh: '四选一' }, { id: 'spell', zh: '拼单词' }, { id: 'listen', zh: '听音选词' }, { id: 'order', zh: '连词成句' },
  { id: 'read', zh: '读故事答题' }, { id: 'grammar', zh: '语法小题' }, { id: 'cloze', zh: '句子里填词' },
];
export const TEACHER_SUGGEST = ['Miss Cat', 'Mimi 老师', '猫老师', 'Miss Li'];
const ids = (list, allowed, max) => {
  const ok = new Set(allowed.map(x => x.id));
  return [...new Set((Array.isArray(list) ? list : []).filter(x => ok.has(x)))].slice(0, max);
};
export function normPrefs(raw) {
  const r = obj(raw);
  return {
    v: 1,
    topics: ids(r.topics, TOPICS, 6),
    stories: ids(r.stories, STORY_KINDS, 4),
    storyNote: clean(r.storyNote, 60),
    quiz: ids(r.quiz, QUIZ_KINDS, 4),
    teacherName: clean(r.teacherName, 16),
    updated: r.updated || '',
  };
}
export function readPrefs(kv) {
  const p = normPrefs(peek(kv, PREFS_KEY, {}));
  if (!p.teacherName) p.teacherName = clean(obj(peek(kv, 'profile', {})).teacherName, 16);
  return p;
}
// 合并 patch 写 'kid.prefs'；改了老师名字顺手写 'profile'.teacherName（问老师、上课都读那里）
export async function savePrefs(kv, patch = {}, now = new Date()) {
  const next = normPrefs({ ...readPrefs(kv), ...obj(patch), updated: iso(now) });
  await kv.set(PREFS_KEY, next);
  if ('teacherName' in obj(patch) && next.teacherName) {
    const prof = obj(peek(kv, 'profile', {}));
    if (prof.teacherName !== next.teacherName) await kv.set('profile', { ...prof, teacherName: next.teacherName });
  }
  return next;
}
const zhOf = (list, id) => (list.find(x => x.id === id) || {}).zh || '';
// 给问老师的提示词：一小节，没有喜好就是 ''。chat-prompt.js 原样拼进去（见 needs）
export function prefsForPrompt(kv) {
  const p = readPrefs(kv);
  const lines = [];
  if (p.topics.length) lines.push(`她喜欢的话题：${p.topics.map(id => zhOf(TOPICS, id)).join('、')}。举例子尽量用这些。`);
  if (p.stories.length || p.storyNote) lines.push(`她想读的故事：${[...p.stories.map(id => zhOf(STORY_KINDS, id)), p.storyNote].filter(Boolean).join('、')}。`);
  if (p.quiz.length) lines.push(`她喜欢的题：${p.quiz.map(id => zhOf(QUIZ_KINDS, id)).join('、')}。最后那道小题尽量出这种。`);
  return lines.length ? '她自己说的喜好（她在“我”页面选的）：\n' + lines.join('\n') : '';
}
// 给以后现写故事（v2）：{ topics: [中文], kinds: [中文], note, words: [英文提示词] }
const TOPIC_EN = { cats: 'cat', animals: 'animal', food: 'food', school: 'school', family: 'family', sports: 'sport', music: 'music', art: 'draw', games: 'game', travel: 'park', nature: 'weather', science: 'why' };
export function storyBrief(kv) {
  const p = readPrefs(kv);
  return {
    topics: p.topics.map(id => zhOf(TOPICS, id)),
    kinds: p.stories.map(id => zhOf(STORY_KINDS, id)),
    note: p.storyNote,
    words: p.topics.map(id => TOPIC_EN[id]).filter(Boolean),
  };
}

// ---------------------------------------------------------------- 3. 难度反馈（kv 'kid.level'）
export const PARTS = ['warmup', 'read', 'write', 'grammar'];
export const PART_ZH = { warmup: '热身', read: '读一段', write: '写几个词', grammar: '语法卡' };
// 事件的 step：语法卡在“写几个词”里画，step 还是 write；单独打开的语法卡是 grammar
export const PART_STEP = { warmup: 'warmup', read: 'read', write: 'write', grammar: 'write' };
export const LEVEL_MIN = -1;
export const LEVEL_MAX = 2;
export const DECAY_DAYS = 7;
export const UP_AFTER = 2;     // 连着 2 次“太简单”升一级
export const DOWN_AFTER = 1;   // 1 次“太难”就降一级（基础弱，先让她跟得上）
export const LOG_MAX = 20;
export const FEEDBACK_CHOICES = [
  { id: 'easy', zh: '太简单' },
  { id: 'ok', zh: '正好' },
  { id: 'hard', zh: '太难' },
];
const clampLevel = n => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(Number(n) || 0)));
const normPart = r => {
  const x = obj(r);
  const run = obj(x.run);
  return {
    level: clampLevel(x.level),
    run: { choice: run.choice === 'easy' || run.choice === 'hard' ? run.choice : '', n: Math.max(0, Number(run.n) || 0) },
    last: typeof x.last === 'string' ? x.last : '',
    changed: typeof x.changed === 'string' ? x.changed : '',
    log: Array.isArray(x.log) ? x.log.filter(e => e && e.at).slice(-LOG_MAX) : [],
  };
};
export function readLevels(kv) {
  const raw = obj(peek(kv, LEVEL_KEY, {}));
  const parts = {};
  for (const p of PARTS) parts[p] = normPart(obj(raw.parts)[p]);
  return { v: 1, parts, updated: raw.updated || '' };
}
// 过一周没反馈慢慢回 0：从最后一次反馈（或上次变动）算起，每满 7 天往 0 走一级
export function levelOf(rec, now = new Date()) {
  const r = normPart(rec);
  if (!r.level) return 0;
  const since = [r.last, r.changed].filter(Boolean).sort().pop();
  if (!since) return r.level;
  const steps = Math.floor(daysBetween(new Date(since), now) / DECAY_DAYS);
  if (steps <= 0) return r.level;
  return r.level > 0 ? Math.max(0, r.level - steps) : Math.min(0, r.level + steps);
}
export function difficulty(kv, now = new Date()) {
  const L = readLevels(kv);
  const out = {};
  for (const p of PARTS) out[p] = levelOf(L.parts[p], now);
  return out;
}
export function levelZh(n) {
  return n <= -1 ? '简单一点' : n === 0 ? '正好' : n === 1 ? '难一点' : '挑战';
}
// 一次反馈算进一部分：先按衰减落到现在的等级，再看连着几次。返回新的 rec 和 { prev, level, changed }
export function applyFeedback(rec, choice, { now = new Date(), from = 'button' } = {}) {
  const r = normPart(rec);
  const prev = levelOf(r, now);
  let level = prev;
  let run = { ...r.run };
  if (choice === 'easy') {
    run = run.choice === 'easy' ? { choice: 'easy', n: run.n + 1 } : { choice: 'easy', n: 1 };
    if (run.n >= UP_AFTER) { level = clampLevel(prev + 1); run = { choice: '', n: 0 }; }
  } else if (choice === 'hard') {
    run = run.choice === 'hard' ? { choice: 'hard', n: run.n + 1 } : { choice: 'hard', n: 1 };
    if (run.n >= DOWN_AFTER) { level = clampLevel(prev - 1); run = { choice: '', n: 0 }; }
  } else {
    run = { choice: '', n: 0 };
  }
  const at = iso(now);
  const changed = level !== prev;
  const next = {
    level, run, last: at, changed: changed || prev !== r.level ? at : r.changed,
    log: [...r.log, { at, choice, from, level }].slice(-LOG_MAX),
  };
  return { rec: next, prev, level, changed };
}
// ctx 要 kv，可以有 events（log、sessionId）。part 不认识时返回 null。写 kv 'kid.level'，记事件 'feedback'
export async function recordFeedback(ctx, { part, choice, from = 'button', now = new Date(), sid = '', item = '', mode = '', text = '' } = {}) {
  if (!PARTS.includes(part) || !FEEDBACK_CHOICES.some(c => c.id === choice)) return null;
  const kv = ctx && ctx.kv;
  if (!kv) return null;
  const L = readLevels(kv);
  const res = applyFeedback(L.parts[part], choice, { now, from });
  L.parts[part] = res.rec;
  L.updated = iso(now);
  await kv.set(LEVEL_KEY, L);
  let s = sid;
  if (!s) { try { s = ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''; } catch (e) { s = ''; } }
  const ev = { type: 'feedback', step: PART_STEP[part], part, choice, level: res.level, prev: res.prev, changed: res.changed, from,
    ...(s ? { sid: s } : {}), ...(item ? { item } : {}), ...(mode ? { mode } : {}), ...(text ? { text: clean(text, 40) } : {}) };
  try { if (ctx.events && ctx.events.log) await ctx.events.log(ev); } catch (e) { /* 记录失败不卡她 */ }
  return { part, choice, prev: res.prev, level: res.level, changed: res.changed, event: ev };
}
export async function resetLevels(kv, now = new Date()) {
  const L = readLevels(kv);
  const at = iso(now);
  for (const p of PARTS) L.parts[p] = { ...L.parts[p], level: 0, run: { choice: '', n: 0 }, changed: at };
  L.updated = at;
  await kv.set(LEVEL_KEY, L);
  return L;
}

// 各部分的等级怎么变成 plan.js 的旋钮。plan.js 只读这个对象（数字和开关），不自己解释等级。
// levels: difficulty(kv) 的返回值（缺的部分当 0）。每个数都是“在原来基础上加几”，plan 自己再套上限（见 needs）
export function knobs(levels = {}) {
  const L = p => clampLevel(obj(levels)[p]);
  const w = L('warmup'), r = L('read'), wr = L('write'), g = L('grammar');
  return {
    levels: { warmup: w, read: r, write: wr, grammar: g },
    warmup: {
      // 四选一换成拼写：字母块张数上限加几（-1 = 今天不出字母块）；句子里回想加几张
      tilesDelta: w <= -1 ? -99 : w === 1 ? 2 : w >= 2 ? 4 : 0,
      clozeDelta: w <= -1 ? -99 : w === 1 ? 1 : w >= 2 ? 2 : 0,
      // 干扰项：'far' 意思差得远（别的单元、别的词性），'near' 同单元同词性、长得像的先
      distractor: w <= -1 ? 'far' : w >= 1 ? 'near' : 'normal',
      // 新词数（newPerDay）加几，plan 再套 MAX_NEW_PER_DAY（+2 时允许到 MAX_NEW_PER_DAY + 1）
      newDelta: w <= -1 ? -1 : w >= 1 ? 1 : 0,
      newCapBonus: w >= 2 ? 1 : 0,
      // 地基探针：跳过她已经稳了的块（weakFoundations 里 steady 的），探针少一道；太难时探针只 1 道、摸底减到 tight
      skipSteadyProbes: w >= 1,
      probeDelta: w >= 1 ? -1 : w <= -1 ? -1 : 0,
      screenTight: w <= -1,
      // 第一张放最有把握的（现在就是）；太难时前 3 张都放有把握的
      sureFirst: w <= -1 ? 3 : 1,
    },
    read: {
      short: r <= -1,                 // 太难：轻松版那 2 道题（reader.js shortQuestions）
      autoTrunk: r <= -1,             // 太难：长句先自动标主干
      preteachDelta: r <= -1 ? 2 : 0, // 太难：读前见一面多 2 个目标词
      challenge: r >= 1 ? (r >= 2 ? 2 : 1) : 0,   // 读完加几道挑战题（推断题 / 变式题，见 needs）
      selfFirst: r >= 2,              // 挑战：先自己读一遍再听
      minutesDelta: r >= 1 ? 1 : r <= -1 ? -1 : 0,
    },
    write: {
      itemsDelta: wr <= -1 ? -1 : wr === 1 ? 1 : wr >= 2 ? 2 : 0,   // 写几个词 3 个句子 / 拼写个数加几
      hintStart: wr <= -1 ? 1 : 0,   // 太难：第一次就给第 1 级提示
      chunks: wr <= -1 ? 'syllable' : wr >= 2 ? 'letter' : '',       // 字母块：太难按音节，挑战按字母
      noFirstLetter: wr >= 2,        // 句子里回想不给首字母
    },
    grammar: {
      altFirst: g <= -1,             // 太难：先上第二讲法
      fewer: g <= -1 ? 2 : 0,        // 一份少几道
      autoHint: g <= -1,             // 第一次答错就自动出第 1 级提示（现在要错两次）
      skipClean: g >= 1,             // 第一次就干净做对过的练习题不再出
      variants: g >= 1 ? 1 : 0,      // 多一道变式题
      contrast: g >= 2,              // 挑战：再加一张对比小卡、句型转换代替一道选择
      warmDelta: g >= 1 ? 1 : g <= -1 ? -1 : 0,   // 热身里语法题加几（plan 套 0..3）
    },
  };
}
export const knobsFor = (kv, now = new Date()) => knobs(difficulty(kv, now));

// ---------------------------------------------------------------- 4. 上课开头先问她（kv 'kid.today'）
export const TODAY_CHOICES = [
  { id: 'plan', zh: '按老师的安排' },
  { id: 'words', zh: '多练单词' },
  { id: 'read', zh: '多读故事' },
  { id: 'grammar', zh: '练语法' },
  { id: 'exam', zh: '复习考试' },
];
export function todayChoice(kv, now = new Date()) {
  const t = obj(peek(kv, TODAY_KEY, {}));
  return t.date === ymd(now) && TODAY_CHOICES.some(c => c.id === t.choice) ? t.choice : '';
}
export async function setTodayChoice(kv, choice, now = new Date()) {
  if (!TODAY_CHOICES.some(c => c.id === choice)) return null;
  const rec = { v: 1, date: ymd(now), choice, at: iso(now) };
  await kv.set(TODAY_KEY, rec);
  return rec;
}
// 第一节课、今天已经选过、考前小卷日（那天的课是定好的）不问
export function needsTodayAsk(kv, now = new Date(), { first = false, quizDay = false } = {}) {
  return !first && !quizDay && !todayChoice(kv, now);
}
export const todayEvent = (choice, sid = '') => ({ type: 'ask', qid: 'today', who: 'emma', answer: choice, about: 'today:' + choice, step: 'warmup', ...(sid ? { sid } : {}) });

// 每个选择怎么调配比（plan.js 读）。上学日总时长不变：多给的分钟从别的格子挪过来（shiftMinutes）。
//   favor: 多给哪一格；from: 从哪几格挪（按先后）；还有各格的具体做法
export function todayMix(choice, { examSet = false } = {}) {
  const c = choice === 'exam' && !examSet ? 'plan' : choice;
  const base = { id: c || 'plan', asked: choice || '', favor: '', shift: 0, from: [], warmup: {}, read: {}, write: {}, note: '' };
  if (!c || c === 'plan') return { ...base, note: choice === 'exam' ? '还没设考试，今天先按老师的安排。' : '' };
  if (c === 'words') return { ...base, favor: 'warmup', shift: 3, from: ['read', 'write'],
    warmup: { capDelta: 4, tilesDelta: 1 }, read: { short: true }, write: { mode: 'spell' }, note: '今天多练单词。' };
  if (c === 'read') return { ...base, favor: 'read', shift: 3, from: ['warmup', 'write'],
    warmup: { capDelta: -4, minCards: 8 }, read: { short: false, challenge: 1, again: true }, write: { itemsDelta: -1 }, note: '今天多读一点故事。' };
  if (c === 'grammar') return { ...base, favor: 'write', shift: 2, from: ['warmup', 'read'],
    warmup: { grammarDelta: 1, capDelta: -3 }, read: { short: true }, write: { mode: 'grammar', fallback: 'transform' }, note: '今天多练语法。' };
  return { ...base, id: 'exam', favor: 'warmup', shift: 2, from: ['read'],
    warmup: { keysFirst: true, pullDelta: 3 }, read: { passage: true, short: true }, write: { mode: 'spell', keysOnly: true }, note: '今天复习考试的范围。' };
}
// cells: { warmup, read, write, wrap } 分钟（plan 算出来的）；ready: 哪几格今天要上。返回挪过以后的目标分钟，总和不变（不超 limit）。
// 每格最少：热身 3、读一段 2、写几个词 2、收尾不动。被挪的格不在 ready 里就跳过；favor 不在 ready 里就原样返回
export const MIN_MINUTES = { warmup: 3, read: 2, write: 2, wrap: 1 };
export function shiftMinutes(cells = {}, choice = 'plan', { limit = Infinity, ready = null, examSet = false } = {}) {
  const mix = todayMix(choice, { examSet });
  const out = {};
  for (const k of ['warmup', 'read', 'write', 'wrap']) out[k] = Math.max(0, Number(obj(cells)[k]) || 0);
  const on = k => (ready ? ready.includes(k) : out[k] > 0);
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (!mix.favor || !on(mix.favor)) return { ...out, total, mix };
  let need = mix.shift;
  for (const k of mix.from) {
    if (!need || !on(k)) continue;
    const can = Math.max(0, out[k] - MIN_MINUTES[k]);
    const take = Math.min(can, need);
    out[k] -= take; out[mix.favor] += take; need -= take;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum > limit) out[mix.favor] -= sum - limit;
  return { ...out, total: Object.values(out).reduce((a, b) => a + b, 0), mix };
}

// ---------------------------------------------------------------- 5. 问老师里说“太简单了”“想难一点”
// 只认说“难度”的话，不认“讲简单一点”（那是要老师换个讲法）、“这题简单吗”（问题）。
// 返回 null 或 { choice: 'easy' | 'hard' | 'ok', part: 部分 | ''（没说哪部分）, parts: [部分]（''时是全部）, reply, strength: 1 | 2 }
const PART_WORDS = [
  ['warmup', /热身|单词|生词|认词|四选一|选择题/],
  ['read', /故事|读一段|阅读|读的|课文|小篇/],
  ['write', /拼写|拼单词|拼词|写几个词|写单词|连词成句|句型转换|默写/],
  ['grammar', /语法/],
];
const EXPLAIN = /(讲|说|解释|教|告诉我)[^。！？!?]{0,6}(简单|容易|简单点|浅)|(简单|通俗)(地|的)?(讲|说|解释)|用简单的/;
const QUESTION = /(简单|容易|难)[吗么嘛]|难不难|简不简单|容不容易|是不是(很|太)?(简单|难)|(哪个|什么|怎么)[^。！？]{0,4}(简单|难)/;
const EASY = [
  /太(简单|容易|轻松|小儿科)/, /(好|真|超|很|特别|有点)(简单|容易)/, /简单(死|爆)了/, /没(有)?(什么)?挑战/,
  /(想|要|能|可以|来|再)[^。！？]{0,3}难(一)?(点|些)/, /难度(高|加|大)(一)?(点|些)/, /加(点|些)?难度/, /(来|给我|出)[^。！？]{0,3}难(的|题)/,
  /(一点|一点儿|根本)(都|也)?不难|^(这|它|题|都)?(也)?不难/, /(都|全)会了/, /too easy|\bharder\b/i, /有挑战(性)?(一)?(点|些)/,
];
const HARD = [
  /太难(?![过受看吃听])/, /(好|真|超|很|特别|有点|有些)难(?![过受看吃听度吗])/, /难死了/, /跟不上/, /(想|要|能|可以)[^。！？]{0,3}(简单|容易)(一)?(点|些)/,
  /简单(一)?(点|些)的题/, /too hard|\beasier\b/i, /降低难度|难度(低|降|小)(一)?(点|些)/,
];
const OK = [/(难度)?(正好|刚好|刚刚好|合适)/, /不难也不简单/, /just right/i];
export function parseFeedbackText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  if (EXPLAIN.test(t)) return null;
  if (QUESTION.test(t)) return null;
  const parts = PART_WORDS.filter(([, re]) => re.test(t)).map(([p]) => p);
  const part = parts.length === 1 ? parts[0] : '';
  let choice = '';
  const easy = EASY.some(re => re.test(t));
  const hard = HARD.some(re => re.test(t.replace(/不(太)?难/g, '')));
  if (OK.some(re => re.test(t)) && !/太/.test(t)) choice = 'ok';
  else if (/不(太|是很)?(简单|容易)/.test(t) && !easy) choice = 'hard';
  else if (easy && hard) return null;   // “单词太简单，语法太难”：分不清就不改
  else if (easy) choice = 'easy';
  else if (hard) choice = 'hard';
  if (!choice) return null;
  const strength = /太|死了|根本|超|特别|再|一点(也|都)/.test(t) ? 2 : 1;
  const where = part ? PART_ZH[part] : '';
  const reply = choice === 'easy' ? `好，${where ? where + '的' : '以后的'}题我出难一点。`
    : choice === 'hard' ? `好，${where ? where + '的' : '以后的'}题我先放简单一点，我们慢慢来。`
      : '好，那就保持这样。';
  return { choice, part, parts: part ? [part] : PARTS.slice(), reply, strength };
}
// 问老师用：认出来就记反馈（from 'chat'），返回 { reply, parsed, results } 或 null。
// 没说哪部分：强的（“太简单了”）算进全部 4 部分；弱的（“有点难”）只记进 warmup（她最常做的）
export async function applyChatFeedback(ctx, text, now = new Date()) {
  const parsed = parseFeedbackText(text);
  if (!parsed) return null;
  const targets = parsed.part ? [parsed.part] : parsed.strength >= 2 ? PARTS : ['warmup'];
  const results = [];
  for (const part of targets) {
    // 问老师里说一次“太简单了”就当说了两次（她特意说出来的），直接升一级
    const once = await recordFeedback(ctx, { part, choice: parsed.choice, from: 'chat', now, text });
    if (once && parsed.choice === 'easy' && parsed.strength >= 2 && !once.changed) {
      const again = await recordFeedback(ctx, { part, choice: 'easy', from: 'chat', now, text });
      results.push(again || once);
    } else if (once) results.push(once);
  }
  return { reply: parsed.reply, parsed, results };
}
