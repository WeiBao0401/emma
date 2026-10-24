// 周小结、课后算账和“老师记得的你”（DESIGN 9 周小结草图、3.3 课后算账、3.6、3.9 v1；teacher-memory 4.2、8.1）。
// 负责：周小结 agent（weekly.js、ui-weekly.js、css/weekly.css、tests/weekly.test.mjs）。
// 状态：v1 做完：一周（周一到周日）的小结、课后算账写 kv、“老师记得的你”四段（只写正面和中性的事实，模板句，
// 不调模型）、“这不对”。家长区的完整笔记本、规则观察 R1-R7、每周反思是 v2。
//
// 纯函数，不碰 DOM。数据从参数进来：kv 是 ctx.kv（peek / get / set / keys），events 是事件数组（ctx.events.query 读出来的）。
//
// 导出（小结）
//   weekOf(now) -> { from, to, key }          now 所在的一周：from 周一、to 周日（'YYYY-MM-DD'），key = from
//   weekByKey(key) / shiftWeek(week, n)        按周一的日期取一周；前后挪 n 周
//   rangeCn(week) -> '10 月 19 日到 25 日'      跨月写成 '10 月 26 日到 11 月 1 日'
//   lessonDaysIn(kv, events, from, to) -> ['YYYY-MM-DD']   做过课的日子：kv 'day:' 有做完的格子，或者 session_end 完成了
//   writtenWords(events, week, { known }) -> { rule: 'strict' | 'spelled' | '', slugs, met: { slug: 'YYYY-MM-DD' } }
//       “会写了”（DESIGN 5.8 的判据，见下）这周新达到的词；一个都没有时退一步：这周拼对过 2 次以上的词（rule 'spelled'）
//   metDays(events) -> { slug: 'YYYY-MM-DD' }  每个词第一次达到“会写了”的那天
//   progressHighlight(events, week, { tags, wordOf }) -> { tag, short, text } | null   进步最大的一处
//   talkTopic({ answers, week, now, teach, teacherName }) -> string    可以聊的（按钮问题的回答，没有就用固定话题）
//   parentTip({ days, written, progress, wordOf }) -> string           提醒家长：夸具体的努力，不问分数
//   buildWeekly({ kv, events, now, week, unitTitle, wordOf, tags, known }) -> Weekly   见下
//   shareText(weekly, { withFile }) -> string   “发给家长”分享的文字
//   newWeeklyWeek(kv, now) -> key | ''          首页该不该出“这周小结”：周日 18:00 起是这一周；周一、周二还没看过的话
//                                               是上一周；那周至少做过一天课，看过（kv 'weekly.seen'）就不再出
//   hasNewWeekly(kv, now) -> bool               = !!newWeeklyWeek(kv, now)，首页（ui-home.js）用
//   defaultWeek(kv, now) -> week                打开小结默认看哪周：有新的看新的；周一、周二这周还没课看上一周；否则这周
//   markSeen(kv, key, now) -> Promise           看过了（kv 'weekly.seen' = { week, at }，只往后挪）
//
//   Weekly = { week, name, title: 'Emma 这一周', range, days: { n, goal, minutes, list },
//              rows: [{ id: 'days' | 'written' | 'progress' | 'unit', label, value, text }], topic, tip, written, progress }
//   不放分数、缺口统计、每题对错（DESIGN 9）。
//
// 导出（课后算账，teacher-memory 4.2 的第 1 步：只更新统计，不改旋钮）
//   sessionStats(events, sid) -> SessionStat | null    一节课的统计（纯函数）
//   addToTally(tally, stat, now) -> tally              并进 kv 'weekly.tally'（纯函数）：留 TALLY_DAYS 天的课，周汇总重算
//   settleLesson({ kv, events, now }, { sid, end }) -> Promise<SessionStat | null>
//       上课收尾时调用（ui-lesson.js 的 wrap / quit 记完 session_end 以后）：读这节课的事件、算统计、写 kv。
//       end 是刚记的 session_end 事件（ctx.events.log 不等写完，读的时候可能还没进库，就用这个补上）。不抛错。
//   catchUp({ kv, events, now }) -> Promise<number>    没算过的课补算（最近 14 天），返回补了几节；小结页打开时调用
//   rememberWritten(kv, met) -> Promise                 “会写了”的日子记进 tally.written（早的那天为准），事件清掉以后也认
//
//   kv 'weekly.tally' = { version: 1, updated, sessions: { sid: SessionStat }, weeks: { 周一: WeekStat }, written: { slug: 日期 } }
//   SessionStat = { sid, day, at, hour, kind, light, min, completed, steps, n, right, rate, medianMs,
//                   byMode: { mc4: { n, right, rate, medianMs } }, feel, skip, flag, hints }
//     n / right / rate：首答（first_try 不是 false）的题数、答对数、正确率；用时超过 60 秒按 60 秒算
//   WeekStat = { days, sessions, minutes, n, right, rate, byMode }
//
// 导出（老师记得的你，teacher-memory 8.1）
//   memoryOf({ kv, events, now, wordOf, unitTitle, unitOf, tags, written }) -> { date, sections }
//     sections 顺序固定：steady 你已经稳的（放最前）、likes 你喜欢的、rhythm 你的节奏、plan 下周我们这样试。
//     每段 { id, title, lines: [{ id, sig, text, section, disputable }], empty }。句子全是这里预写的模板，只填程序算的数和词。
//     你已经稳的：误解标签之前出现过、这两周有 ≥5 次机会 0 次出现（R8）；听写全对（R10）；这周新会写（R9）；某个单元的词这两周都认出来了
//     你喜欢的：按钮问题的回答；自己查过的英文词（events 'lookup'，有的话）
//     你的节奏：常在几点上课、一节几分钟；哪天常做轻松版；一共上了几天；她回答过的节奏类问题
//     下周我们这样试：只写 plan.js 本来就会做的事（期中范围先练、听写过的词热身再练），计划的口吻
//   hideDisputed(memory, disputes) -> memory    去掉她点过“这不对”的条目
//   isHidden(line, disputes) -> bool            “别记这个”永远不再出；“不对”“我变了”在这句话的内容变了以前不再出
//   DISPUTE_CHOICES                            [{ id: 'wrong', zh: '不对' }, { id: 'changed', zh: '我变了' }, { id: 'forget', zh: '别记这个' }]
//   dispute({ kv, events, now }, line, choice) -> Promise   写 kv 'weekly.disputes' { line_id: { choice, sig, section, at } }，
//                                                          记 events { type: 'dispute', step: 'weekly', line_id, choice, about }
//
// “会写了”的判据（DESIGN 5.8）：跨天 3 次客观题答对，间隔至少 2 天，其中至少 1 次在新句子或拼写里。这里这样算：
//   - 每个词按天看：那天第一次客观作答（answer 的 mc4 / listen / tiles / keys / cloze / order / paper，dictation，spell）
//     答对了，这天就算一次；'card' 闪卡是她自己评的，不算。
//   - 连着攒到 3 天，第一天到第三天至少隔 2 天；其中至少一天在拼写或新句子里也答对了（tiles / keys / paper / cloze /
//     order、纸笔听写、spell、故事题 'ep:'）。中间哪天第一次就错了，从头攒。
//   - 达到的那天算“会写了”的日子。第 7、21 天复查、错了退回“在练”是 v2 的事。
//   数据不够时（v1 刚开始，字母块拼写还没上线，几乎没有拼写记录）这周可能一个都没有，就退一步写“这周拼对过 2 次以上”的词，
//   标题也跟着换，不叫“会写了”。
//
// 依赖：无（纯函数）。ui-weekly.js 读事件、画页面；ui-lesson.js 收尾时调 settleLesson；ui-home.js 用 hasNewWeekly。

export const TALLY_KEY = 'weekly.tally';
export const SEEN_KEY = 'weekly.seen';
export const DISPUTE_KEY = 'weekly.disputes';
export const ASK_KEY = 'ask.answers';
export const TALLY_DAYS = 90;            // per-lesson stats kept this long; week rollups stay
export const TALLY_WEEKS = 30;
export const NEW_FROM_HOUR = 18;         // Sunday from 18:00 the home page may show “这周小结”
export const HISTORY_DAYS = 56;          // how far back ui-weekly reads events for one week's page
export const MS_CAP = 60000;

export const OBJECTIVE_MODES = ['mc4', 'listen', 'tiles', 'keys', 'cloze', 'order', 'paper'];
export const WRITE_MODES = ['tiles', 'keys', 'paper', 'cloze', 'order'];
export const WORD_TAGS = ['form', 'category', 'meaning', 'sound'];

// grammar tags (curriculum/tags.json) said the way the summary says them: “my 和 mine：上周常混，这周没再错”
export const TAG_SHORT = {
  he_she: 'he 和 she', subj_obj: 'I 和 me', poss_adj_vs_pron: 'my 和 mine', obj_vs_poss: 'me 和 my',
  there_have: 'there be 和 have', there_be_agree: 'there is 和 there are', poss_s_missing: "名词所有格的 's",
  poss_of_overuse: "'s 和 of", be_missing: 'be 动词', be_plus_verb: 'be 动词后面的词', plural_missing: '名词复数',
  uncountable_plural: '不可数名词', third_s_missing: '三单 -s', do_does: 'do 和 does',
};

export const DISPUTE_CHOICES = [{ id: 'wrong', zh: '不对' }, { id: 'changed', zh: '我变了' }, { id: 'forget', zh: '别记这个' }];

// ---- the button questions (curriculum/questions.json ids; tests check every key exists there)
// 你喜欢的
export const LIKE_LINES = {
  'q-like-one:cats': '你说你喜欢猫', 'q-like-one:music': '你说你喜欢音乐', 'q-like-one:sports': '你说你喜欢运动',
  'q-like-one:drawing': '你说你喜欢画画',
  'q-story-kind:secret': '你更想读神秘案件那种故事', 'q-story-kind:school': '你更想读校园日常的故事',
  'q-story-kind:animal': '你更想读动物冒险的故事', 'q-story-kind:magic': '你更想读魔法奇遇的故事',
  'q-fav-part:cards': '你最喜欢单词卡这一部分', 'q-fav-part:listen': '你最喜欢听的部分', 'q-fav-part:write': '你最喜欢写单词',
  'q-fav-part:story': '你最喜欢故事',
  'q-most-fun:listen': '你觉得听音选词最好玩', 'q-most-fun:read': '你觉得看词选意思最好玩', 'q-most-fun:spell': '你觉得拼单词最好玩',
  'q-most-fun:paper': '你觉得在纸上写最好玩',
  'q-what-helps:again': '你说再听一遍最能帮到你', 'q-what-helps:zh': '你说看中文最能帮到你', 'q-what-helps:hint': '你说一点提示最能帮到你',
  'q-listen-first:yes': '做题前你喜欢先听一遍', 'q-listen-first:no': '你喜欢直接开始做题', 'q-listen-first:some': '做题前先不先听，你看情况定',
  'q-more-english:more': '你想让老师多说点英语', 'q-more-english:same': '老师现在说的英语，你觉得正好',
  'q-need-zh:no': '你说不看中文也看得懂',
};
// 你的节奏
export const RHYTHM_LINES = {
  'q-study-time:before-dinner': '你说喜欢晚饭前学', 'q-study-time:after-dinner': '你说喜欢晚饭后学',
  'q-study-time:before-bed': '你说喜欢睡觉前学', 'q-study-time:morning': '你说喜欢早上学',
  'q-lesson-length:short': '你说课有点短', 'q-lesson-length:right': '你说课的长短正好', 'q-lesson-length:long': '你说课有点长',
  'q-weekend-length:long': '周末你想上长一点的课', 'q-weekend-length:short': '周末你想上短一点的课', 'q-weekend-length:two': '周末的课你想分两次做',
  'q-feel-english:better': '你说现在觉得英语比以前好了',
};
// 可以聊的：家长问她的一句，从她的回答来
export const TOPICS = {
  'q-like-one:cats': '如果养一只猫，你想给它起什么英文名字？',
  'q-like-one:music': '最近喜欢听哪首歌？里面有你听得懂的英文词吗？',
  'q-like-one:sports': '你最喜欢哪项运动？它用英语怎么说？',
  'q-like-one:drawing': '最近画了什么？画里的东西用英语怎么说？',
  'q-story-kind:secret': '如果你来写一个神秘故事，谜底会是什么？',
  'q-story-kind:school': '这周学校里有什么好玩的事？',
  'q-story-kind:animal': '如果能和一种动物去冒险，你选哪种？',
  'q-story-kind:magic': '如果你会一个魔法，你想用它做什么？',
  'q-fav-part:cards': '这周学的词里，哪个最好记？',
  'q-fav-part:listen': '老师读的英语里，你最喜欢听哪一句？',
  'q-fav-part:write': '这周写对的词里，你最得意哪一个？',
  'q-fav-part:story': '你最想读一个什么样的故事？',
  'q-most-fun:listen': '读一个英语词给我听，我来猜意思。',
  'q-most-fun:read': '考考我：这周学的一个词是什么意思？',
  'q-most-fun:spell': '考考我：出一个词让我拼一拼。',
  'q-most-fun:paper': '给我出一个词，我在纸上写，你来对答案。',
};
export const FIXED_TOPICS = [
  '这周学的词里，你能教我一个吗？',
  '这周哪天的课最轻松？',
  '用英语说一样你今天看到的东西，我来猜。',
  '这周学的词里，哪个最好记？',
];

const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayOf(d); };
export const dayDiff = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
const evDay = e => String((e && e.at) || '').slice(0, 10);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const round3 = x => Math.round(x * 1000) / 1000;
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const byAt = (a, b) => String(a.at || '').localeCompare(String(b.at || '')) || ((a.id || 0) - (b.id || 0));
const sorted = events => (Array.isArray(events) ? events.filter(e => e && e.at) : []).slice().sort(byAt);
const nowOf = now => (typeof now === 'function' ? now() : now instanceof Date ? now : new Date());
const isoLocal = d => {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};

// ---------------------------------------------------------------- weeks

export function weekOf(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const from = dayOf(d);
  return { from, to: addDays(from, 6), key: from };
}
export const weekByKey = key => (isDay(key) ? weekOf(parseDay(key)) : weekOf(new Date()));
export const shiftWeek = (week, n) => weekByKey(addDays(week.from, 7 * n));
const inWeek = (day, week) => day >= week.from && day <= week.to;

export function mdCn(day) {
  const [, m, d] = String(day).split('-').map(Number);
  return `${m} 月 ${d} 日`;
}
export function rangeCn(week) {
  const [, m1] = week.from.split('-').map(Number);
  const [, m2, d2] = week.to.split('-').map(Number);
  return m1 === m2 ? `${mdCn(week.from)}到 ${d2} 日` : `${mdCn(week.from)}到 ${m2} 月 ${d2} 日`;
}

// kv 'day:' records with a done cell (ui-home.js lessonDays reads the same), plus completed lessons in the events
export function lessonDaysIn(kv, events = [], from = '0000-00-00', to = '9999-99-99') {
  const set = new Set();
  if (kv && kv.keys) {
    for (const k of kv.keys('day:')) {
      const d = k.slice(4);
      const r = kv.peek(k, null);
      if (isDay(d) && d >= from && d <= to && r && r.cells && Object.values(r.cells).some(Boolean)) set.add(d);
    }
  }
  for (const e of events || []) {
    if (e && e.type === 'session_end' && e.completed !== false && e.step !== 'dictation') {
      const d = evDay(e);
      if (isDay(d) && d >= from && d <= to) set.add(d);
    }
  }
  return [...set].sort();
}
function minutesIn(kv, from, to) {
  let m = 0;
  if (!kv || !kv.keys) return 0;
  for (const k of kv.keys('day:')) {
    const d = k.slice(4);
    const r = kv.peek(k, null);
    if (isDay(d) && d >= from && d <= to && r && Number.isFinite(r.minutes)) m += r.minutes;
  }
  return Math.round(m);
}

// ---------------------------------------------------------------- attempts per word per day

// One objective try at a word: { slug, day, at, correct, write }
function attemptOf(e) {
  if (!e || !e.slug || typeof e.correct !== 'boolean') return null;
  if (e.type === 'answer') {
    if (!OBJECTIVE_MODES.includes(e.mode)) return null;
    const write = WRITE_MODES.includes(e.mode) || /^ep:/.test(String(e.item || ''));
    return { slug: e.slug, day: evDay(e), at: e.at, correct: e.correct, write, first: e.first_try !== false };
  }
  if (e.type === 'dictation' || e.type === 'spell') return { slug: e.slug, day: evDay(e), at: e.at, correct: e.correct, write: true, first: true };
  return null;
}
// slug -> [{ day, ok, write }] ascending: ok = the day's first objective try was right; write = a writing try that day was right
function daysBySlug(events) {
  const map = new Map();
  for (const e of sorted(events)) {
    const a = attemptOf(e);
    if (!a || !isDay(a.day)) continue;
    if (!map.has(a.slug)) map.set(a.slug, new Map());
    const days = map.get(a.slug);
    if (!days.has(a.day)) days.set(a.day, { day: a.day, ok: a.correct, write: false, writeTried: false });
    const rec = days.get(a.day);
    // the first writing try of the day decides the writing part
    if (a.write && !rec.writeTried) { rec.writeTried = true; rec.write = a.correct; }
  }
  const out = new Map();
  for (const [slug, days] of map) out.set(slug, [...days.values()].sort((x, y) => x.day.localeCompare(y.day)));
  return out;
}

export function metDays(events = []) {
  const out = {};
  for (const [slug, days] of daysBySlug(events)) {
    let chain = [];
    for (const d of days) {
      if (!d.ok) { chain = []; continue; }
      chain.push(d);
      if (chain.length >= 3 && dayDiff(chain[0].day, d.day) >= 2 && chain.some(c => c.write)) { out[slug] = d.day; break; }
    }
  }
  return out;
}

// known: { slug: day } already counted earlier (kv weekly.tally.written); those are not new this week
export function writtenWords(events = [], week, { known = {} } = {}) {
  const met = metDays(events);
  for (const [slug, day] of Object.entries(known || {})) if (isDay(day) && (!met[slug] || day < met[slug])) met[slug] = day;
  const strict = Object.keys(met).filter(s => inWeek(met[s], week)).sort((a, b) => met[a].localeCompare(met[b]) || a.localeCompare(b));
  if (strict.length) return { rule: 'strict', slugs: strict, met };
  // not enough data yet: spelled right at least twice this week
  const count = new Map();
  for (const e of sorted(events)) {
    const a = attemptOf(e);
    if (a && a.write && a.correct && a.first && inWeek(a.day, week)) count.set(a.slug, (count.get(a.slug) || 0) + 1);
  }
  const spelled = [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  return { rule: spelled.length ? 'spelled' : '', slugs: spelled, met };
}

// ---------------------------------------------------------------- misconceptions

const tagTable = tags => (tags && tags.tags ? tags.tags : tags || {});
const isWordTag = (tag, tags) => WORD_TAGS.includes(tag) || (tagTable(tags)[tag] || {}).kind === 'word';
// what a misconception is about: a grammar point for 'g:<point>:<n>' items, the word otherwise
function groundOf(e) {
  const item = String(e.item || '');
  if (/^g:/.test(item)) return item.split(':').slice(0, 2).join(':');
  return e.slug ? 'w:' + e.slug : item;
}
const answersOf = events => sorted(events).filter(e => e.type === 'answer' && typeof e.correct === 'boolean');
// tag -> { n, grounds: Set, pairs: Map('slug|other' -> n) }
function tagHits(answers) {
  const out = new Map();
  for (const e of answers) {
    if (e.correct || !e.misconception) continue;
    const t = e.misconception;
    if (!out.has(t)) out.set(t, { n: 0, grounds: new Set(), pairs: new Map() });
    const r = out.get(t);
    r.n++;
    r.grounds.add(groundOf(e));
    const other = e.distractor || e.choice_slug;
    if (e.slug && other && other !== e.slug) { const k = e.slug + '|' + other; r.pairs.set(k, (r.pairs.get(k) || 0) + 1); }
  }
  return out;
}
function tagLabel(tag, hit, { tags, wordOf }) {
  const w = s => (wordOf ? wordOf(s) : s) || s;
  if (isWordTag(tag, tags)) {
    const top = [...hit.pairs].sort((a, b) => b[1] - a[1])[0];
    if (top) { const [a, b] = top[0].split('|'); return { short: `${w(a)} 和 ${w(b)}`, pair: true }; }
    const g = [...hit.grounds][0] || '';
    return { short: g.startsWith('w:') ? w(g.slice(2)) : ((tagTable(tags)[tag] || {}).zh || tag), pair: false };
  }
  const short = TAG_SHORT[tag] || (tagTable(tags)[tag] || {}).zh || tag;
  return { short, pair: / 和 /.test(short) };
}

// A tag she chose often last week (≥2) that did not come back this week, with at least 2 chances on the same words or
// grammar points. Falls back to a word missed last week and answered right this week.
export function progressHighlight(events = [], week, { tags = {}, wordOf = null } = {}) {
  const last = shiftWeek(week, -1);
  const all = answersOf(events);
  const lastA = all.filter(e => inWeek(evDay(e), last));
  const thisA = all.filter(e => inWeek(evDay(e), week));
  let best = null;
  for (const [tag, hit] of tagHits(lastA)) {
    if (hit.n < 2) continue;
    const onGround = thisA.filter(e => hit.grounds.has(groundOf(e)));
    const again = isWordTag(tag, tags) ? onGround.filter(e => e.misconception === tag).length : thisA.filter(e => e.misconception === tag).length;
    if (onGround.length < 2 || again) continue;
    if (!best || hit.n > best.hit.n || (hit.n === best.hit.n && onGround.length > best.chances)) best = { tag, hit, chances: onGround.length };
  }
  if (best) {
    const { short, pair } = tagLabel(best.tag, best.hit, { tags, wordOf });
    return { tag: best.tag, short, text: `${short}：上周${pair ? '常混' : '常错'}，这周没再错` };
  }
  // a word: first try wrong last week (at least twice), right this week, not wrong this week
  const wrongLast = new Map();
  for (const e of lastA) if (!e.correct && e.first_try !== false && e.slug) wrongLast.set(e.slug, (wrongLast.get(e.slug) || 0) + 1);
  const cand = [...wrongLast].filter(([s, n]) => n >= 2 &&
    thisA.some(e => e.slug === s && e.correct && e.first_try !== false) &&
    !thisA.some(e => e.slug === s && !e.correct && e.first_try !== false)).sort((a, b) => b[1] - a[1]);
  if (!cand.length) return null;
  const w = (wordOf ? wordOf(cand[0][0]) : cand[0][0]) || cand[0][0];
  return { tag: null, short: w, text: `${w}：上周还没记住，这周答对了` };
}

// ---------------------------------------------------------------- topic and tip

const answerList = answers => Object.entries(answers || {})
  .filter(([, a]) => a && !a.skipped && a.answer && a.answer !== 'skip' && a.answer !== 'none' && (!a.who || a.who === 'emma'))
  .map(([qid, a]) => ({ qid, answer: a.answer, at: String(a.at || ''), day: a.day || String(a.at || '').slice(0, 10) }))
  .sort((a, b) => b.at.localeCompare(a.at));

export function talkTopic({ answers = {}, week, teach = '', teacherName = '' } = {}) {
  const list = answerList(answers).filter(a => TOPICS[a.qid + ':' + a.answer]);
  const fresh = list.find(a => inWeek(a.day, week)) || list.find(a => a.day >= addDays(week.from, -7) && a.day <= week.to);
  if (fresh) return TOPICS[fresh.qid + ':' + fresh.answer];
  if (teach) return `你能教我写 ${teach} 吗？`;
  const fixed = teacherName ? [...FIXED_TOPICS, `你给老师起名叫“${teacherName}”，为什么叫这个名字？`] : FIXED_TOPICS;
  const i = Math.abs(Math.round(parseDay(week.from) / (7 * 864e5))) % fixed.length;
  return fixed[i];
}

export function parentTip({ days = { n: 0, goal: 0 }, written = { rule: '', slugs: [] }, progress = null, wordOf = null } = {}) {
  const w = s => (wordOf ? wordOf(s) : s) || s;
  if (!days.n) return '这周还没上课。先聊聊，不加量，不问分数。';
  if (days.n <= 1 && (days.goal || 0) >= 2) return `这周做了 ${days.n} 天。先聊聊，不加量，不问分数。`;
  let ex = '';
  if (written.slugs && written.slugs.length) ex = written.rule === 'strict' ? `${w(written.slugs[0])} 这周会写了` : `${w(written.slugs[0])} 这周拼对了好几次`;
  else if (progress) ex = `${progress.short} 这周没再错`;
  else ex = `这周坚持了 ${days.n} 天`;
  return `夸具体的努力，比如“${ex}”。不问分数。`;
}

// ---------------------------------------------------------------- the week

export function buildWeekly({ kv, events = [], now = new Date(), week = null, unitTitle = id => id, wordOf = null, tags = {}, known = null } = {}) {
  const t = nowOf(now);
  const wk = week || weekOf(t);
  const profile = (kv && kv.peek('profile', {})) || {};
  const name = String(profile.name || '').trim() || 'Emma';
  const goal = Number(profile.weeklyGoal) || 0;
  const w = s => (wordOf ? wordOf(s) : s) || s;
  const list = lessonDaysIn(kv, events, wk.from, wk.to);
  const days = { n: list.length, goal, minutes: minutesIn(kv, wk.from, wk.to), list };
  const tally = (kv && kv.peek(TALLY_KEY, null)) || {};
  const written = writtenWords(events, wk, { known: known || tally.written || {} });
  const progress = progressHighlight(events, wk, { tags, wordOf });
  const rows = [];
  let daysText = `做了 ${days.n} 天`;
  if (goal) daysText += `（她定的目标是 ${goal} 天）`;
  if (days.minutes) daysText += `，一共约 ${days.minutes} 分钟`;
  rows.push({ id: 'days', label: '这周', value: daysText, text: daysText });
  if (written.slugs.length) {
    const shown = written.slugs.slice(0, 6).map(w);
    const more = written.slugs.length > 6 ? ` 等 ${written.slugs.length} 个` : '';
    const label = written.rule === 'strict' ? `新会写的 ${written.slugs.length} 个词` : `这周拼对过两次以上的 ${written.slugs.length} 个词`;
    const value = shown.join(' · ') + more;
    rows.push({ id: 'written', label, value, text: `${label}：${value}`, words: shown });
  }
  if (progress) rows.push({ id: 'progress', label: '进步最大', value: progress.text, text: `进步最大：${progress.text}` });
  const pr = (kv && kv.peek('progress', {})) || {};
  if (pr.unit) {
    let value = unitTitle(pr.unit) || pr.unit;
    const upd = String(pr.updated || '').slice(0, 10);
    if (isDay(upd) && inWeek(upd, wk)) value += `（${mdCn(upd)}更新）`;
    rows.push({ id: 'unit', label: '课本进度', value, text: `课本进度：${value}` });
  }
  const answers = (kv && kv.peek(ASK_KEY, {})) || {};
  const topic = talkTopic({ answers, week: wk, teach: written.rule === 'strict' && written.slugs.length ? w(written.slugs[0]) : '', teacherName: profile.teacherName || '' });
  const tip = parentTip({ days, written, progress, wordOf });
  return { week: wk, name, title: `${name} 这一周`, range: rangeCn(wk), days, rows, topic, tip, written, progress };
}

export function shareText(weekly, { withFile = false } = {}) {
  const lines = [`${weekly.title}（${weekly.range}）`];
  for (const r of weekly.rows) lines.push('· ' + r.text);
  lines.push(`可以聊的：“${weekly.topic}”`);
  lines.push(`提醒：${weekly.tip}`);
  if (withFile) lines.push('附件是这台 iPad 上的学习备份，存到“文件”里就好。');
  return lines.join('\n');
}

// ---------------------------------------------------------------- the home page entry

const seenWeek = kv => { const s = kv && kv.peek(SEEN_KEY, null); return (s && s.week) || ''; };
export function newWeeklyWeek(kv, now = new Date()) {
  const wk = weekOf(now);
  const dow = now.getDay();
  let cand = '';
  if (dow === 0 && now.getHours() >= NEW_FROM_HOUR) cand = wk.key;
  else if (dow === 1 || dow === 2) cand = shiftWeek(wk, -1).key;
  if (!cand) return '';
  if (seenWeek(kv) >= cand) return '';
  const w = weekByKey(cand);
  return lessonDaysIn(kv, [], w.from, w.to).length ? cand : '';
}
export const hasNewWeekly = (kv, now = new Date()) => !!newWeeklyWeek(kv, now);

export function defaultWeek(kv, now = new Date()) {
  const fresh = newWeeklyWeek(kv, now);
  if (fresh) return weekByKey(fresh);
  const wk = weekOf(now);
  const dow = now.getDay();
  if ((dow === 1 || dow === 2) && !lessonDaysIn(kv, [], wk.from, wk.to).length) return shiftWeek(wk, -1);
  return wk;
}

export async function markSeen(kv, key, now = new Date()) {
  if (!kv || !isDay(key) || seenWeek(kv) >= key) return;
  try { await kv.set(SEEN_KEY, { week: key, at: now.toISOString() }); } catch (e) { console.warn('weekly: seen:', (e && e.message) || e); }
}

// ---------------------------------------------------------------- 课后算账

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function rateBlock(list) {
  const right = list.filter(e => e.correct === true).length;
  const ms = list.map(e => e.ms).filter(x => Number.isFinite(x) && x > 0).map(x => Math.min(x, MS_CAP));
  return { n: list.length, right, rate: list.length ? round3(right / list.length) : null, medianMs: median(ms) };
}

export function sessionStats(events = [], sid) {
  if (!sid) return null;
  const list = sorted(events).filter(e => e.sid === sid);
  if (!list.length) return null;
  const start = list.find(e => e.type === 'session_start') || null;
  const ends = list.filter(e => e.type === 'session_end');
  const end = ends[ends.length - 1] || null;
  const first = list.filter(e => e.type === 'answer' && typeof e.correct === 'boolean' && e.first_try !== false);
  const byMode = {};
  for (const m of new Set(first.map(e => e.mode || 'other'))) byMode[m] = rateBlock(first.filter(e => (e.mode || 'other') === m));
  const at0 = (start || list[0]).at;
  const spanMin = Math.max(0, Math.round((Date.parse(list[list.length - 1].at) - Date.parse(at0)) / 60000)) || 0;
  const hourOf = s => Number(String(s).slice(11, 13));
  return {
    sid, day: evDay(start || list[0]), at: at0,
    hour: start && Number.isFinite(start.hour) ? start.hour : hourOf(at0),
    kind: (start && start.kind) || (end && end.kind) || '',
    light: !!((start && start.light) || (start && start.kind === 'easy')),
    min: end && Number.isFinite(end.min) ? end.min : spanMin,
    completed: !!end && end.completed !== false,
    steps: (end && Array.isArray(end.steps_done) ? end.steps_done : []).slice(),
    ...rateBlock(first),
    byMode,
    feel: list.filter(e => e.type === 'feel').length,
    skip: list.filter(e => e.type === 'skip').length,
    flag: list.filter(e => e.type === 'flag').length,
    hints: list.filter(e => e.type === 'hint').length,
  };
}

function weekRollup(sessions) {
  const by = {};
  for (const s of sessions) {
    if (!s || !isDay(s.day)) continue;
    const key = weekByKey(s.day).key;
    (by[key] = by[key] || []).push(s);
  }
  const out = {};
  for (const [key, list] of Object.entries(by)) {
    const n = list.reduce((a, s) => a + (s.n || 0), 0), right = list.reduce((a, s) => a + (s.right || 0), 0);
    const byMode = {};
    for (const s of list) for (const [m, b] of Object.entries(s.byMode || {})) {
      const x = byMode[m] = byMode[m] || { n: 0, right: 0 };
      x.n += b.n || 0; x.right += b.right || 0;
    }
    for (const x of Object.values(byMode)) x.rate = x.n ? round3(x.right / x.n) : null;
    out[key] = { days: new Set(list.filter(s => s.completed).map(s => s.day)).size, sessions: list.length,
      minutes: list.reduce((a, s) => a + (s.min || 0), 0), n, right, rate: n ? round3(right / n) : null, byMode };
  }
  return out;
}

export function addToTally(tally, stat, now = new Date()) {
  const t = tally && typeof tally === 'object' ? tally : {};
  const out = { version: 1, sessions: { ...(t.sessions || {}) }, weeks: { ...(t.weeks || {}) }, written: { ...(t.written || {}) } };
  if (stat && stat.sid) out.sessions[stat.sid] = stat;
  const cut = addDays(dayOf(now), -TALLY_DAYS);
  for (const [sid, s] of Object.entries(out.sessions)) if (!s || !isDay(s.day) || s.day < cut) delete out.sessions[sid];
  const fresh = weekRollup(Object.values(out.sessions));
  // weeks whose lessons were trimmed keep their old rollup
  for (const [k, v] of Object.entries(fresh)) out.weeks[k] = v;
  const keys = Object.keys(out.weeks).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - TALLY_WEEKS))) delete out.weeks[k];
  out.updated = now.toISOString();
  return out;
}

export async function settleLesson({ kv, events, now = () => new Date() } = {}, { sid, end = null } = {}) {
  try {
    if (!kv || !events || !sid) return null;
    const t = nowOf(now);
    let list = await events.query({ since: addDays(dayOf(t), -2), limit: 100000 });
    list = (list || []).filter(e => e && e.sid === sid);
    if (end && end.type === 'session_end' && !list.some(e => e.type === 'session_end' && e.at === end.at)) {
      list.push({ ...end, sid, at: end.at || isoLocal(t) });
    }
    const stat = sessionStats(list, sid);
    if (!stat) return null;
    const tally = await kv.get(TALLY_KEY, null);
    await kv.set(TALLY_KEY, addToTally(tally, stat, t));
    return stat;
  } catch (e) {
    console.warn('weekly: settle:', (e && e.message) || e);
    return null;
  }
}

export async function catchUp({ kv, events, now = () => new Date() } = {}) {
  try {
    if (!kv || !events) return 0;
    const t = nowOf(now);
    const list = (await events.query({ since: addDays(dayOf(t), -14), limit: 100000 })) || [];
    const tally = (await kv.get(TALLY_KEY, null)) || {};
    const have = tally.sessions || {};
    const sids = new Set(list.filter(e => e && e.sid && (e.type === 'session_start' || e.type === 'session_end')).map(e => e.sid));
    let next = tally, added = 0;
    for (const sid of sids) {
      const old = have[sid];
      const hasEnd = list.some(e => e.sid === sid && e.type === 'session_end');
      if (old && (old.completed || !hasEnd)) continue;
      const stat = sessionStats(list, sid);
      if (!stat) continue;
      next = addToTally(next, stat, t);
      added++;
    }
    if (added) await kv.set(TALLY_KEY, next);
    return added;
  } catch (e) {
    console.warn('weekly: catch up:', (e && e.message) || e);
    return 0;
  }
}

export async function rememberWritten(kv, met = {}) {
  try {
    const tally = (await kv.get(TALLY_KEY, null)) || {};
    const written = { ...(tally.written || {}) };
    let changed = false;
    for (const [slug, day] of Object.entries(met || {})) {
      if (isDay(day) && (!written[slug] || day < written[slug])) { written[slug] = day; changed = true; }
    }
    if (changed) await kv.set(TALLY_KEY, { version: 1, sessions: {}, weeks: {}, ...tally, written });
  } catch (e) { console.warn('weekly: written:', (e && e.message) || e); }
}

// ---------------------------------------------------------------- 老师记得的你

const line = (section, id, text, disputable = true) => ({ id, sig: text, text, section, disputable });

function hourCn(h) {
  if (h < 5) return `凌晨 ${h} 点`;
  if (h < 12) return `上午 ${h} 点`;
  if (h === 12) return '中午 12 点';
  if (h < 18) return `下午 ${h - 12} 点`;
  return `晚上 ${h - 12} 点`;
}

function steadyLines({ events, today, wordOf, unitTitle, unitOf, tags, written }) {
  const out = [];
  const w = s => (wordOf ? wordOf(s) : s) || s;
  const since = addDays(today, -13);
  const all = answersOf(events).filter(e => evDay(e) <= today);
  const before = all.filter(e => evDay(e) < since);
  const recent = all.filter(e => evDay(e) >= since);
  // R8: a tag seen before, ≥5 chances in the last two weeks, none chosen
  const cands = [];
  for (const [tag, hit] of tagHits(before)) {
    const onGround = recent.filter(e => hit.grounds.has(groundOf(e)));
    const again = isWordTag(tag, tags) ? onGround.some(e => e.misconception === tag) : recent.some(e => e.misconception === tag);
    if (onGround.length >= 5 && !again) cands.push({ tag, hit, n: onGround.length });
  }
  cands.sort((a, b) => b.n - a.n);
  for (const c of cands.slice(0, 2)) {
    const { short, pair } = tagLabel(c.tag, c.hit, { tags, wordOf });
    const word = isWordTag(c.tag, tags);
    out.push(line('steady', 'steady:tag:' + c.tag, word && pair ? `${short}：这两周 ${c.n} 次都分清了` : `${short}：这两周 ${c.n} 道全对`));
  }
  // R10: a paper dictation all right (the first pass of that evening, at least 3 words)
  const dict = sorted(events).filter(e => e.type === 'dictation' && typeof e.correct === 'boolean' && (e.pass || 'main') === 'main' && evDay(e) >= since && evDay(e) <= today);
  const byNight = new Map();
  for (const e of dict) { const k = evDay(e) + '|' + (e.sid || ''); if (!byNight.has(k)) byNight.set(k, new Map()); const m = byNight.get(k); if (!m.has(e.slug)) m.set(e.slug, e.correct); }
  const nights = [...byNight].filter(([, m]) => m.size >= 3 && [...m.values()].every(Boolean)).sort((a, b) => b[0].localeCompare(a[0]));
  if (nights.length) {
    const [k, m] = nights[0];
    out.push(line('steady', 'steady:dictation:' + k.slice(0, 10), `${mdCn(k.slice(0, 10))}听写 ${m.size} 个，全对`));
  }
  // R9: new written words this week (three or more)
  if (written && written.slugs.length >= 3) {
    const shown = written.slugs.slice(0, 4).map(w).join('、');
    out.push(line('steady', 'steady:written', written.rule === 'strict'
      ? `这周新会写 ${written.slugs.length} 个词：${shown}` : `这周拼对了好几次：${shown}`));
  }
  // a unit's words all recognised in the last two weeks (first tries, at least 5 words)
  const byUnit = new Map();
  const wrongSlugs = new Set(recent.filter(e => !e.correct && e.first_try !== false).map(e => e.slug));
  for (const e of recent) {
    if (!e.correct || e.first_try === false || !e.slug || wrongSlugs.has(e.slug)) continue;
    const u = e.unit || (unitOf ? unitOf(e.slug) : '') || '';
    if (!u) continue;
    if (!byUnit.has(u)) byUnit.set(u, new Set());
    byUnit.get(u).add(e.slug);
  }
  const units = [...byUnit].filter(([, s]) => s.size >= 5).sort((a, b) => b[1].size - a[1].size);
  for (const [u, s] of units.slice(0, 2)) {
    out.push(line('steady', 'steady:unit:' + u, `${unitTitle(u) || u} 的 ${s.size} 个词，这两周都认出来了`));
  }
  return out.slice(0, 4);
}

function likeLines({ kv, events, today }) {
  const out = [];
  const answers = answerList((kv && kv.peek(ASK_KEY, {})) || {});
  const seen = new Set();
  for (const a of answers) {
    const text = LIKE_LINES[a.qid + ':' + a.answer];
    if (!text || seen.has(a.qid)) continue;
    seen.add(a.qid);
    out.push(line('likes', 'ask:' + a.qid, text));
  }
  // English words she looked up herself (when lookups are logged as events)
  const since = addDays(today, -13);
  const looked = [];
  for (const e of sorted(events).reverse()) {
    if (e.type !== 'lookup' || evDay(e) < since || evDay(e) > today) continue;
    if (e.source === 'textbook') continue;
    const q = String(e.query || '').trim().toLowerCase();
    if (/^[a-z][a-z'-]{1,19}$/.test(q) && !looked.includes(q)) looked.push(q);
    if (looked.length >= 3) break;
  }
  if (looked.length) out.push(line('likes', 'lookup:recent', `你自己查过 ${looked.join('、')}`));
  return out.slice(0, 3);
}

function rhythmLines({ kv, events, today }) {
  const out = [];
  const since = addDays(today, -13);
  const tally = (kv && kv.peek(TALLY_KEY, null)) || {};
  let sessions = Object.values(tally.sessions || {}).filter(s => s && s.completed && s.day >= since && s.day <= today);
  if (sessions.length < 3) {
    // not settled yet: read the lessons straight from the events
    const sids = new Set(sorted(events).filter(e => e.type === 'session_end' && e.completed !== false && evDay(e) >= since && evDay(e) <= today).map(e => e.sid).filter(Boolean));
    sessions = [...sids].map(sid => sessionStats(events, sid)).filter(Boolean);
  }
  if (sessions.length >= 3) {
    const h = median(sessions.map(s => s.hour).filter(Number.isFinite));
    const m = median(sessions.map(s => s.min).filter(x => Number.isFinite(x) && x > 0));
    if (Number.isFinite(h)) {
      const text = `常在${hourCn(h)}前后上课` + (Number.isFinite(m) && m > 0 ? `，一节约 ${m} 分钟` : '');
      out.push(line('rhythm', 'rhythm:time', text));
    }
  }
  // a weekday she often took the light lesson (last three weeks)
  const lightBy = new Map();
  if (kv && kv.keys) {
    for (const k of kv.keys('day:')) {
      const d = k.slice(4);
      const r = kv.peek(k, null);
      if (isDay(d) && d >= addDays(today, -20) && d <= today && r && r.light) { const wd = parseDay(d).getDay(); lightBy.set(wd, (lightBy.get(wd) || 0) + 1); }
    }
  }
  const lightDay = [...lightBy].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  if (lightDay) out.push(line('rhythm', 'rhythm:light', `${WEEKDAY[lightDay[0]]}常做轻松版`));
  // what she said about her rhythm
  const answers = answerList((kv && kv.peek(ASK_KEY, {})) || {});
  const seen = new Set();
  for (const a of answers) {
    const text = RHYTHM_LINES[a.qid + ':' + a.answer];
    if (!text || seen.has(a.qid)) continue;
    seen.add(a.qid);
    out.push(line('rhythm', 'ask:' + a.qid, text));
  }
  const total = lessonDaysIn(kv, events, '0000-00-00', today).length;
  if (total >= 2) out.push(line('rhythm', 'rhythm:total', `到现在一共上了 ${total} 天课`));
  return out.slice(0, 3);
}

function planLines({ kv, events, today, written }) {
  const out = [];
  const pr = (kv && kv.peek('progress', {})) || {};
  if (isDay(pr.examDate)) {
    const n = dayDiff(today, pr.examDate);
    // Emma reads this page too: no countdown on the child side (DESIGN 6.4), only what the lessons will do
    if (n >= 2 && n <= 21) out.push(line('plan', 'plan:exam', '期中前这些天，热身先练期中范围里的词', false));
    if (n >= 1 && n <= 7) out.push(line('plan', 'plan:exam-eve', '考试前一天做轻松版，早点休息', false));
  }
  const since = addDays(today, -6);
  if (sorted(events).some(e => e.type === 'dictation' && evDay(e) >= since && evDay(e) <= today)) {
    out.push(line('plan', 'plan:dictation', '纸上听写过的词，热身里会再练一练', false));
  }
  if (written && written.rule === 'strict' && written.slugs.length) out.push(line('plan', 'plan:written', '这周会写的词，过几天热身里再见', false));
  if (!out.length) out.push(line('plan', 'plan:steady', '下周照常：先热身，再收尾', false));
  return out.slice(0, 2);
}

export const SECTION_TITLES = { steady: '你已经稳的', likes: '你喜欢的', rhythm: '你的节奏', plan: '下周我们这样试' };
export const SECTION_EMPTY = {
  steady: '多上几节课，老师会把你稳了的地方写在这里。',
  likes: '收尾时老师问你的问题，你的回答会写在这里。',
  rhythm: '上过几节课以后，这里写你常在什么时候学。',
  plan: '',
};

// date: the day the page is about (the week's Sunday, or today when the week is still going)
export function memoryOf({ kv, events = [], now = new Date(), date = '', wordOf = null, unitTitle = id => id, unitOf = null, tags = {}, written = null } = {}) {
  const t = nowOf(now);
  const today = isDay(date) && date < dayOf(t) ? date : dayOf(t);
  const wk = weekOf(parseDay(today));
  const wr = written || writtenWords(events, wk, { known: ((kv && kv.peek(TALLY_KEY, null)) || {}).written || {} });
  const lists = {
    steady: steadyLines({ events, today, wordOf, unitTitle, unitOf, tags, written: wr }),
    likes: likeLines({ kv, events, today }),
    rhythm: rhythmLines({ kv, events, today }),
    plan: planLines({ kv, events, today, written: wr }),
  };
  return {
    date: today,
    title: `老师记得的你 · ${mdCn(today)}`,
    sections: Object.keys(SECTION_TITLES).map(id => ({ id, title: SECTION_TITLES[id], lines: lists[id], empty: SECTION_EMPTY[id] })),
  };
}

export function isHidden(l, disputes = {}) {
  const d = disputes && disputes[l.id];
  if (!d) return false;
  if (d.choice === 'forget') return true;
  return d.sig === l.sig;
}
export function hideDisputed(memory, disputes = {}) {
  return { ...memory, sections: memory.sections.map(s => ({ ...s, lines: s.lines.filter(l => !isHidden(l, disputes)) })) };
}

export async function dispute({ kv, events, now = () => new Date() } = {}, l, choice) {
  if (!l || !l.id || !DISPUTE_CHOICES.some(c => c.id === choice)) return null;
  const t = nowOf(now);
  const rec = { choice, sig: l.sig, section: l.section, at: t.toISOString() };
  try {
    const all = (await kv.get(DISPUTE_KEY, {})) || {};
    all[l.id] = rec;
    await kv.set(DISPUTE_KEY, all);
  } catch (e) { console.warn('weekly: dispute:', (e && e.message) || e); }
  // events.js lists 'dispute' from v1 (teacher-memory 2.1); an older events.js returns null here and the kv record still hides it
  try { if (events && events.log) await events.log({ type: 'dispute', step: 'weekly', line_id: l.id, choice, about: l.section }); }
  catch (e) { /* recording never blocks */ }
  return rec;
}
