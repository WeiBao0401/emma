// 老师想到的落到课上（design/roadmap-gaps.md 第 1 项，teacher-next 6.2）。纯函数，app.js planState 里调，结果改 plan 的
// state（grammarFocus、weakCards、knobs.read），不碰 plan.js 自己的规则；家长区按 plan.tune 看调了什么、因为哪条信号。
// 负责：接线（0.8.0）。
//
// 读四样（都可以没有）：
//   1. 每周想一次的“下周怎么教”（teacher.js latestWeek：kv 'teacher.week:<周一>' 的 next，只认上周和这周想的）
//        card:<卡>        这张卡提前（weakCards，grammar.js nextCard 按“地基探针看出不会”排到前面）
//        read:shorter     读一段短一点，题减到 2 道（knobs.read.short）
//        read:split       长句先标主干（knobs.read.autoTrunk）
//        read:words_first 读前多见 2 个目标词（knobs.read.preteachDelta）
//        别的（阅读方法、指代题、听着读、连词成句、句型转换）现在课上没有对应的开关，不调，也不写进 tune
//   2. “她卡在哪”（kv 'teacher.stuck'）带语法点的条目：这个点的卡提前（grammarFocus）
//   3. 读的求助分诊（reader.js triageSummary 的 adjust）：卡在词 → 读前多见 1 个目标词；卡在句子 → 长句先标主干
//   4. 近 7 天指代题（answer qtype 'refer'）错 2 次以上 → 代词卡提前
// 一次最多调 3 处（teacher-next 6.2 护栏），时长、新词上限这些 plan.js 照旧管。
//
// 导出
//   teacherTune({ week, stuck, triage, referWrong, now }) -> { cards: [卡 id], points: [语法点], read: { short?, autoTrunk?, preteachDelta? }, why: [{ id, why }] }
//   applyKnobs(knobs, tune) -> 新的 knobs（她自己说的难度在前：她说“太简单”时不替她缩短；只加不减）
//   referWrongCount(events, now) -> number   近 7 天指代题第一次就错的次数
//   WEEK_FRESH_DAYS = 7、MAX_TUNES = 3

export const WEEK_FRESH_DAYS = 7;
export const MAX_TUNES = 3;
const REFER_MIN = 2;

const arr = x => (Array.isArray(x) ? x : []);
const obj = x => (x && typeof x === 'object' ? x : {});
const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(now) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d); }
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

export function referWrongCount(events = [], now = new Date()) {
  const from = dayOf(new Date(now.getTime() - 6 * 864e5));
  const seen = new Set();
  let n = 0;
  for (const e of arr(events)) {
    if (!e || e.type !== 'answer' || e.qtype !== 'refer' || String(e.at || '').slice(0, 10) < from) continue;
    if (seen.has(e.item)) continue;   // the first answer to each question only
    seen.add(e.item);
    if (e.correct === false) n++;
  }
  return n;
}

export function teacherTune({ week = null, stuck = null, triage = null, referWrong = 0, now = new Date() } = {}) {
  const out = { cards: [], points: [], read: {}, why: [] };
  const add = (id, why, fn) => { if (out.why.length >= MAX_TUNES || out.why.some(x => x.id === id)) return; fn(); out.why.push({ id, why }); };
  // 1 the weekly think (last week's or this week's)
  const w = obj(week);
  const fresh = /^\d{4}-\d{2}-\d{2}$/.test(String(w.week || '')) && daysBetween(w.week, mondayOf(now)) <= WEEK_FRESH_DAYS;
  if (fresh) {
    for (const x of arr(w.next)) {
      const id = String((x && x.id) || '');
      const because = '老师每周想一次定的' + (x.why ? `（${String(x.why).slice(0, 40)}）` : '');
      if (id.startsWith('card:')) { const c = id.slice(5); add('teacher:' + id, `${because}：先上“${String(x.label || c).replace(/^语法卡：/, '')}”`, () => out.cards.push(c)); }
      else if (id === 'read:shorter') add('teacher:' + id, `${because}：读一段短一点，题减到 2 道`, () => { out.read.short = true; });
      else if (id === 'read:split') add('teacher:' + id, `${because}：长句先标出主干`, () => { out.read.autoTrunk = true; });
      else if (id === 'read:words_first') add('teacher:' + id, `${because}：读前多见 2 个目标词`, () => { out.read.preteachDelta = (out.read.preteachDelta || 0) + 2; });
    }
  }
  // 2 where she is stuck, with a grammar point
  for (const it of arr(obj(stuck).items)) {
    const p = String((it && it.point) || '');
    if (!p || out.points.includes(p)) continue;
    add('stuck:' + p, `她卡在“${String(it.text || p).slice(0, 30)}”：这个点的语法卡排到前面`, () => out.points.push(p));
  }
  // 3 the reading triage
  const adj = obj(obj(triage).adjust);
  if (adj.preteach) add('triage:words', '读的时候多卡在词上：读前多见 1 个目标词', () => { out.read.preteachDelta = (out.read.preteachDelta || 0) + 1; });
  if (adj.trunkFirst && !out.read.autoTrunk) add('triage:sentences', '读的时候多卡在句子上：长句先标出主干', () => { out.read.autoTrunk = true; });
  // 4 指代题
  if (referWrong >= REFER_MIN && !out.cards.includes('pronoun')) add('refer', `这周指代题错了 ${referWrong} 次：代词卡排到前面`, () => out.cards.push('pronoun'));
  return out;
}

export function applyKnobs(knobs, tune) {
  const t = obj(tune);
  const r = obj(t.read);
  if (!Object.keys(r).length) return knobs;
  const k = { ...obj(knobs) };
  const read = { ...obj(k.read) };
  const level = Number(obj(k.levels).read) || 0;
  // she said reading is too easy: the teacher does not make it shorter or mark trunks for her
  if (r.short && level <= 0) read.short = true;
  if (r.autoTrunk && level <= 0) read.autoTrunk = true;
  if (r.preteachDelta) read.preteachDelta = (Number(read.preteachDelta) || 0) + r.preteachDelta;
  k.read = read;
  return k;
}
