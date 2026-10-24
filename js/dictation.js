// 明天有听写，纸笔版（DESIGN 5.3）：选单元、勾掉老师没划的词、选老师的考法；千问读，她写在纸上；写完出答案，
// 她自己逐个打勾；错的马上再写一轮；10 分钟后或睡前首页提醒再写一次错的；第二天早上首页“出门前看一眼”；
// 写错过的词打开“写得出”线，进之后几天的热身。这个文件只管逻辑（纯函数和一个小状态机），界面在 ui-dictation.js。
// 负责：题型 agent（modes/choice.js、dictation.js）。
//
// 导出
//   METHODS = [['zh2en', '读中文写英文'], ['en2en', '读英文写英文'], ['phrase', '短语'], ['en2zh', '英译汉']]；METHOD_LABEL
//   REMIND_AFTER_MIN = 10、BEDTIME_HOUR = 21、MORNING_UNTIL_HOUR = 12；recordKey(day) -> 'dictation:<day>'
//   promptFor(word, method) -> { say, lang, show, answer }
//     word = { slug, w(英文), cn(中文) }；say 是要朗读的文字，show 是屏幕上显示的提示
//     zh2en 读中文、显示中文、写英文；en2en 读英文、不显示、写英文；phrase 读短语的中文、写英文短语（没有中文就读英文）；
//     en2zh 读英文、不显示、写中文。没有中文的词，zh2en 退回读英文
//   buildDictation({ unit, words, method, exclude, include, isRequired, shuffle, rng }) -> Plan   纯函数
//     words：这个单元的词（curriculum.unitWords 的 { w, cn, phrase? }，或带 slug / tier 的词条都行）
//     默认选当前单元的必会词（tier 是 required / primary，或 isRequired(w) 为真）；课标表还没有数据时全选。
//     phrase 只出短语，其余三种只出单词。exclude 去掉（老师没划的），include 加回认读词
//     Plan = { unit, method, label, candidates: [{ slug, w, cn, phrase, required, on }], items: [Item], order: [slug],
//              counts: { all, on } }
//     Item = { n, slug, w, cn, say, lang, show, answer, repeat: 2, pauseMs }   按 items 的顺序朗读，每个读两遍
//   createDictation({ words, method, unit, now, rounds, kind, sid }) -> Dictation
//     Dictation = {
//       method, unit, kind ('main' 第一轮 | 'retry' 马上再写 | 'tonight' 睡前那次), sid, words,
//       index, phase: 'writing' | 'checking' | 'done',
//       current() -> word | null, prompt() -> promptFor(current), next() -> word | null, back(),   听写阶段：一个一个读
//       progress() -> { n, total, phase, round, kind }
//       finishWriting(),                     写完了，进入对答案
//       answers() -> [{ slug, w, cn, answer, mark: true | false | null }]   对答案那页的列表
//       mark(slug, ok), markAll(ok),         她自己打勾 / 打叉（全部打完进 done；done 以后还能改，点错了能改回来）
//       marks() -> { slug: bool }, wrong() -> [word], check() -> selfCheck 的结果
//       event(slug) -> events 'dictation' 的字段（ui-dictation 记 ctx.events.log；round = 这一天的第几轮）
//       retryRound() -> Dictation | null,    只拿错的马上再来一轮（没有错的返回 null）
//       round() -> Round, record() -> DictationRecord
//     }
//   selfCheck(results, words?) -> { right: [slug], wrong: [slug], unmarked: [slug], total, score, allRight }
//     results：{ slug: bool }，或 [{ slug, ok | correct }]，或一个 Dictation
//   DictationRecord（kv 'dictation:<YYYY-MM-DD>'，同一天多轮放在 rounds 里，日期是做听写的那天，也就是考的前一天）：
//     { date, unit, method, words: [slug], info: { slug: { w, cn } },
//       rounds: [{ at, sid, kind, unit, method, words: [slug], marks: { slug: bool } }],
//       done,          第一轮对完了（app.js 的 dictationTonight 看它）
//       wrong: [slug], 今天写错过的（睡前那次和第二天早上都只放这些；马上再写那一轮的不重复算）
//       remindAt?,     第一轮对完 10 分钟以后，首页提醒再写一次错的
//       eveningDone?, morningDone?,   睡前那次写完了 / 早上看过了（tonightDone 是 eveningDone 的旧名，也认）
//       write: [slug], 要开“写得出”线的词（= wrong）；writeOpened: [slug] 已经在词条上打开的 }
//     ui-dictation 另存的 items: [{ slug, w, cn }] 这里也认（和 info 一样用来找词的拼写和中文）
//   mergeRecord(prev, rec) -> DictationRecord    同一天再存一次：按 sid 换掉这一次的轮次，别的保留
//   reminders(record, now) -> { tonight: bool, morning: bool }   首页要不要放“再写一次错的” / “出门前看一眼”
//   reminderState(record, now) -> { tonight: Reminder | null, morning: Reminder | null }
//     Reminder = { date, key, label, minutes, words: [{ slug, w, cn }] }
//   homeReminders(kv, now) -> 同上，自己读今天和昨天的 kv（kv.peek 同步）
//   tonightDictation(record, { now }) -> Dictation | null   睡前再写一次错的（ui-dictation 的 params.retry）
//   morningList(record, method?) -> [{ slug, w, cn, answer }]   出门前看一眼
//   markTonightDone(record) / markMorningDone(record) -> 新的 record（eveningDone / morningDone 为 true）
//   markEvent({ slug, ok, method, unit, round, pass }) -> events 'dictation' 的字段
//     round 是第几轮（数字），pass 是 'main' | 'retry' | 'tonight'
//   openWriteLine(words, slugs, now) -> Promise<[slug]>   给词条打开“写得出”线：words.patch(slug, { write: true,
//     write_at, write_from: 'dictation' })；词条不在或 words.patch 还没有就跳过
//   saveDictation({ kv, d, words, now }) -> Promise<DictationRecord>   合并同一天的记录、写 kv、打开“写得出”线
//
// 依赖：words.js（slugify）。朗读走 ctx.say，事件由 ui-dictation 记（markEvent / d.event(slug) 拼好字段）。
import { slugify } from './words.js';

export const METHODS = [['zh2en', '读中文写英文'], ['en2en', '读英文写英文'], ['phrase', '短语'], ['en2zh', '英译汉']];
export const METHOD_LABEL = Object.fromEntries(METHODS);
export const REMIND_AFTER_MIN = 10;
export const BEDTIME_HOUR = 21;
export const MORNING_UNTIL_HOUR = 12;
export const recordKey = day => 'dictation:' + day;

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocal = d => {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const yesterdayOf = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return dayOf(x); };
const uniq = list => [...new Set(list)];

export function promptFor(word, method = 'zh2en') {
  const w = (word && word.w) || '', cn = (word && word.cn) || '';
  if (method === 'en2en') return { say: w, lang: 'en', show: '', answer: w };
  if (method === 'en2zh') return { say: w, lang: 'en', show: '', answer: cn };
  if (!cn) return { say: w, lang: 'en', show: '', answer: w };
  return { say: cn, lang: 'zh-CN', show: cn, answer: w };   // zh2en and phrase
}

const isPhrase = x => !!x.phrase || /\s/.test(x.w);
function item(x) {
  if (!x) return null;
  const w = String(x.w || x.headword || x.word || '').trim();
  if (!w) return null;
  return { slug: x.slug || slugify(w), w, cn: String(x.cn || x.brief_cn || '').trim(), phrase: isPhrase({ phrase: x.phrase, w }), tier: x.tier || '' };
}
// about 4 seconds plus a little per letter (Chinese characters take longer to write)
const pauseFor = (answer, method) => Math.min(15000, 4000 + [...String(answer)].length * (method === 'en2zh' ? 1200 : 450));

export function buildDictation({ unit = '', words = [], method = 'zh2en', exclude = [], include = [], isRequired, shuffle = false, rng = Math.random } = {}) {
  if (!METHOD_LABEL[method]) method = 'zh2en';
  const seen = new Set();
  const all = [];
  for (const x of words || []) { const it = item(x); if (it && !seen.has(it.slug)) { seen.add(it.slug); all.push(it); } }
  const kind = all.filter(x => (method === 'phrase' ? x.phrase : !x.phrase));
  const reqOf = x => (method === 'phrase' ? true : x.tier ? x.tier === 'required' || x.tier === 'primary' : typeof isRequired === 'function' ? !!isRequired(x.w) : true);
  // the curriculum list may still be empty: then nothing counts as required and the whole unit is on
  const anyReq = kind.some(reqOf);
  const out = new Set(exclude), add = new Set(include);
  const candidates = kind.map(x => {
    const required = anyReq ? reqOf(x) : true;
    return { slug: x.slug, w: x.w, cn: x.cn, phrase: x.phrase, required, on: (required || add.has(x.slug)) && !out.has(x.slug) };
  });
  let chosen = candidates.filter(c => c.on);
  if (shuffle) {
    chosen = chosen.slice();
    for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  }
  const items = chosen.map((c, i) => {
    const p = promptFor(c, method);
    return { n: i + 1, slug: c.slug, w: c.w, cn: c.cn, ...p, repeat: 2, pauseMs: pauseFor(p.answer, method) };
  });
  return { unit, method, label: METHOD_LABEL[method], candidates, items, order: items.map(x => x.slug), counts: { all: candidates.length, on: items.length } };
}

export function selfCheck(results, words) {
  let marks = {};
  if (results && typeof results.marks === 'function') { marks = results.marks(); if (!words) words = results.words; }
  else if (Array.isArray(results)) for (const r of results) { if (r && r.slug) marks[r.slug] = !!('ok' in r ? r.ok : r.correct); }
  else if (results && typeof results === 'object') for (const [k, v] of Object.entries(results)) marks[k] = !!v;
  const slugs = words ? words.map(w => (typeof w === 'string' ? w : w.slug)) : Object.keys(marks);
  const right = slugs.filter(s => marks[s] === true);
  const wrong = slugs.filter(s => marks[s] === false);
  const unmarked = slugs.filter(s => !(s in marks));
  const total = slugs.length;
  return { right, wrong, unmarked, total, score: total ? right.length / total : 0, allRight: total > 0 && right.length === total };
}

export function markEvent({ slug, ok, method, unit, round, pass = 'main' } = {}) {
  const ev = { type: 'dictation', step: 'dictation', item: 'w:' + slug, slug, correct: !!ok, mode: 'paper', choice: method, pass };
  if (round) ev.round = round;
  if (unit) ev.unit = unit;
  return ev;
}

let sidN = 0;
export function createDictation({ words = [], method = 'zh2en', unit = '', now = () => new Date(), rounds = [], kind = 'main', sid, info = {} } = {}) {
  const list = words.map(item).filter(Boolean).map(x => ({ slug: x.slug, w: x.w, cn: x.cn }));
  // every word's spelling and meaning, earlier rounds included, so a record saved from a retry round knows them all
  const allInfo = { ...info };
  for (const w of list) allInfo[w.slug] = { w: w.w, cn: w.cn };
  const id = sid || `${isoLocal(now())}#${++sidN}`;
  const startedAt = isoLocal(now());
  const marks = {};
  let checkedAt = '';
  let index = 0;
  let phase = list.length ? 'writing' : 'done';
  const allMarked = () => list.every(w => w.slug in marks);
  const d = {
    method, unit, kind, sid: id, words: list,
    get index() { return index; },
    get phase() { return phase; },
    current: () => (phase === 'writing' ? list[index] || null : null),
    prompt: () => { const w = d.current(); return w ? promptFor(w, method) : null; },
    progress: () => ({ n: Math.min(index + 1, list.length), total: list.length, phase, round: rounds.length + 1, kind }),
    next() { if (phase !== 'writing') return null; if (index < list.length - 1) index++; else d.finishWriting(); return d.current(); },
    back() { if (phase === 'writing' && index > 0) index--; },
    finishWriting() { if (phase === 'writing') phase = 'checking'; },
    answers: () => list.map(w => ({ ...w, answer: promptFor(w, method).answer, mark: w.slug in marks ? marks[w.slug] : null })),
    mark(slug, ok) {
      if (phase === 'writing' || !list.some(w => w.slug === slug)) return;
      marks[slug] = !!ok;
      if (allMarked()) { phase = 'done'; if (!checkedAt) checkedAt = isoLocal(now()); }
    },
    markAll(ok) { for (const w of list) d.mark(w.slug, ok); },
    marks: () => ({ ...marks }),
    wrong: () => list.filter(w => marks[w.slug] === false),
    check: () => selfCheck(marks, list),
    event: slug => markEvent({ slug, ok: marks[slug], method, unit, round: rounds.length + 1, pass: kind }),
    retryRound() {
      const bad = d.wrong();
      return bad.length ? createDictation({ words: bad, method, unit, now, rounds: [...rounds, d.round()], kind: kind === 'tonight' ? 'tonight' : 'retry', sid: id, info: allInfo }) : null;
    },
    round: () => ({ at: checkedAt || startedAt, sid: id, kind, unit, method, words: list.map(w => w.slug), marks: { ...marks } }),
    record: () => deriveRecord({ date: dayOf(now()), info: { ...allInfo }, rounds: [...rounds, d.round()] }),
  };
  return d;
}

const complete = r => (r.words || []).length > 0 && r.words.every(s => s in (r.marks || {}));
const wrongIn = r => (r.words || []).filter(s => (r.marks || {})[s] === false);

// the derived fields come from the rounds; flags that only the home page sets (tonightDone, morningDone) are kept
function deriveRecord(base) {
  const rounds = (base.rounds || []).slice();
  const mains = rounds.filter(r => r.kind === 'main' || !r.kind);
  const lastMain = mains[mains.length - 1] || rounds[0] || {};
  const wrong = uniq(rounds.filter(r => r.kind !== 'retry').flatMap(wrongIn));
  const checked = mains.filter(complete);
  const lastChecked = checked[checked.length - 1];
  const rec = {
    ...base,
    date: base.date,
    unit: lastMain.unit ?? base.unit ?? '',
    method: lastMain.method || base.method || 'zh2en',
    words: lastMain.words ? lastMain.words.slice() : [],
    rounds,
    done: !!lastChecked && complete(lastMain),
    wrong,
    write: wrong.slice(),
  };
  const t = lastChecked && wrong.length ? new Date(lastChecked.at) : null;
  rec.remindAt = t && !isNaN(t) ? isoLocal(new Date(t.getTime() + REMIND_AFTER_MIN * 60e3)) : undefined;
  if (rounds.some(r => r.kind === 'tonight' && complete(r))) rec.eveningDone = true;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}

export function mergeRecord(prev, rec) {
  if (!rec) return prev || null;
  if (!prev || prev.date !== rec.date) return rec;
  const sids = new Set(rec.rounds.map(r => r.sid));
  return deriveRecord({
    ...prev, ...rec,
    info: { ...(prev.info || {}), ...(rec.info || {}) },
    rounds: [...(prev.rounds || []).filter(r => !sids.has(r.sid)), ...rec.rounds],
    eveningDone: !!(prev.eveningDone || prev.tonightDone || rec.eveningDone) || undefined,
    morningDone: !!(prev.morningDone || rec.morningDone) || undefined,
    writeOpened: uniq([...(prev.writeOpened || []), ...(rec.writeOpened || [])]),
  });
}

function wordsOf(record, slugs) {
  const info = { ...Object.fromEntries((Array.isArray(record.items) ? record.items : []).filter(x => x && x.slug).map(x => [x.slug, x])), ...(record.info || {}) };
  return slugs.map(s => ({ slug: s, w: (info[s] || {}).w || s.replace(/-/g, ' '), cn: (info[s] || {}).cn || '' }));
}
const eveningDoneOf = r => !!(r.eveningDone || r.tonightDone);
const wrongOf = record => (record && Array.isArray(record.wrong) ? record.wrong : record && Array.isArray(record.rounds) ? uniq(record.rounds.filter(r => r.kind !== 'retry').flatMap(wrongIn)) : []);
function remindAtOf(record) {
  if (record.remindAt) return new Date(record.remindAt);
  const main = (record.rounds || []).filter(r => (r.kind === 'main' || !r.kind) && complete(r)).pop();
  const t = main ? new Date(main.at) : null;
  return t && !isNaN(t) ? new Date(t.getTime() + REMIND_AFTER_MIN * 60e3) : null;
}

export function reminderState(record, now = new Date()) {
  const out = { tonight: null, morning: null };
  if (!record || !record.date) return out;
  const wrong = wrongOf(record);
  if (!wrong.length) return out;
  const today = dayOf(now);
  if (record.date === today && !eveningDoneOf(record)) {
    const at = remindAtOf(record);
    if (at && now.getTime() >= at.getTime()) {
      out.tonight = { date: record.date, key: recordKey(record.date), label: now.getHours() >= BEDTIME_HOUR ? '睡前再写一次错的' : '再写一次错的',
        minutes: 1, words: wordsOf(record, wrong) };
    }
  }
  if (record.date === yesterdayOf(now) && !record.morningDone && now.getHours() < MORNING_UNTIL_HOUR) {
    out.morning = { date: record.date, key: recordKey(record.date), label: '出门前看一眼', minutes: 2, words: wordsOf(record, wrong) };
  }
  return out;
}

export function reminders(record, now = new Date()) {
  const s = reminderState(record, now);
  return { tonight: !!s.tonight, morning: !!s.morning };
}

export function homeReminders(kv, now = new Date()) {
  const peek = k => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, null) : null; } catch (e) { return null; } };
  const t = reminderState(peek(recordKey(dayOf(now))), now);
  const y = reminderState(peek(recordKey(yesterdayOf(now))), now);
  return { tonight: t.tonight, morning: y.morning };
}

export function tonightDictation(record, { now = () => new Date() } = {}) {
  const wrong = wrongOf(record);
  if (!wrong.length) return null;
  return createDictation({ words: wordsOf(record, wrong), method: record.method || 'zh2en', unit: record.unit || '', now, kind: 'tonight', info: record.info || {} });
}

export const morningList = (record, method = (record && record.method) || 'zh2en') =>
  (record ? wordsOf(record, wrongOf(record)) : []).map(w => ({ ...w, answer: promptFor(w, method).answer }));

export const markTonightDone = record => (record ? { ...record, eveningDone: true } : record);
export const markMorningDone = record => (record ? { ...record, morningDone: true } : record);

const localIso = d => isoLocal(d).slice(0, 19);
export async function openWriteLine(words, slugs = [], now = new Date()) {
  const opened = [];
  if (!words || typeof words.get !== 'function') return opened;
  for (const slug of uniq(slugs)) {
    try {
      const e = words.get(slug);
      if (!e) continue;
      if (e.write) { opened.push(slug); continue; }
      if (typeof words.patch !== 'function') continue;
      await words.patch(slug, { write: true, write_at: localIso(now), write_from: 'dictation' });
      opened.push(slug);
    } catch (err) { /* the record keeps the slug in write; the next save tries again */ }
  }
  return opened;
}

export async function saveDictation({ kv, d, words, now = new Date() } = {}) {
  const rec = d.record();
  const key = recordKey(rec.date);
  let prev = null;
  try { prev = kv && kv.get ? await kv.get(key, null) : null; } catch (e) { prev = null; }
  const merged = mergeRecord(prev, rec);
  const todo = merged.write.filter(s => !(merged.writeOpened || []).includes(s));
  if (todo.length) merged.writeOpened = uniq([...(merged.writeOpened || []), ...(await openWriteLine(words, todo, now))]);
  if (!merged.writeOpened) merged.writeOpened = [];
  try { if (kv && kv.set) await kv.set(key, merged); } catch (e) { /* a failed save must not stop the dictation */ }
  return merged;
}
