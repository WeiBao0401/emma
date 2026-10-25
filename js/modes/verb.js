// 找动词（design/teacher-next.md 3.2）：热身里每天 1 道，读和语法之间的桥。从期中番外里挑一句主干清楚的句子
// （stories.json 每句的 trunk：主语 + 动词），她点出动词。第一次做时老师先说一句“英语每句话都要有一个动词，is 也算。”
// 点错第 1 次：主语加底色，说“先找谁，紧跟着说‘是’或‘干什么’的就是动词”；点错第 2 次：标出动词，讲这句的主干。
// 不进 FSRS，进度只在 kv 'verb.state'。样式 css/verb.css（类名 vb-）。负责：接线（0.5.0，第 3 批）。
//
// 导出
//   KV_KEY = 'verb.state'、MODE = 'verb'、FIRST_LINE、SECONDS = 20（plan 算时长）、RECENT_DAYS = 14
//   candidates(content) -> [Cand]   Cand = { id: 'v:<集>:<句>', ep, n, i, en, zh, subject, verb, note, tags, be, answer: [token 下标], tokens }
//       verb 是要点的那几个词（is not 里只算 is，there is 里只算 is，comes out 里只算 comes）；trunkVerb 是主干原文（反馈里显示它）
//       只要陈述句（主语在前、动词跟在后面；问句和 there be 不出）：有主语、动词在句子里找得到、动词的几个词挨在一起、没有 it's 这类合在一个词里的、没有第二个分句，3 到 10 个词
//       主干外面还有动词的不出（0.5.1）：带祈使的（Look, she is ...）、动词后面还有 to + 动词的（wants to protect、need volunteers to look after），见 SKIP
//   readVerbState(kv | 值) -> { v: 1, items: { id: { n, last, ok, clean } }, first: 'YYYY-MM-DD' | '', updated }   坏数据读成空的
//   verbItems(kv, now, { content, progress, n = 1 }) -> [id]   今天出哪几句：她读完的那几集里的句子先；没做过的先，
//       隔天交替出 be 动词的句子和别的动词；最近 14 天第一次就点对的不再出。同一天、同样的进度，结果一样
//   resolveVerb(id, content) -> Cand | null
//   applyVerb(state, { id, clean, now }) -> state
//   renderVerb(container, ctx, { items, sid, step = 'warmup', onDone, autoNextMs = 1400, content? }) -> { el, onKey, stop }
//       一句一句做。onDone({ results: [{ id, item, clean, grade }] })。ctx 用到 kv、events.log、say（可以没有）
//
// 事件：answer { item: 'v:<集>:<句>', mode: 'verb', step, sid, choice（她点的词）, correct, first_try, ms, hint_level,
//   misconception: null（0.5.1 起不带误解标签：点错一个词说明不了她漏 be）, point: 'g:be' | '' , done?, grade? }；hint { item, mode: 'verb', level }
import { h } from '../ui-dom.js';
import * as R from '../reader.js';

export const KV_KEY = 'verb.state';
export const MODE = 'verb';
export const SECONDS = 20;
export const RECENT_DAYS = 14;
export const FIRST_LINE = '英语每句话都要有一个动词，is 也算。';
const BE = new Set(['am', 'is', 'are', 'was', 'were', "'m", "'s", "'re", 'be']);
// words inside the trunk's verb that are not the verb itself (is not, there is): never the answer
// out / back / up / away / down after the verb (comes out, come back) are not the verb either: tapping them is a miss
const NOT_VERB = new Set(['not', 'there', "n't", 'never', 'out', 'back', 'up', 'away', 'down']);
// a sentence with another verb outside its trunk would mark that verb wrong (审稿 0.5.1): “Look, she is carrying ...”
// (Look is a verb too, the way Help is), “She wants to protect ...”, “We need volunteers to look after her.”
const SKIP = new Set(['v:ep3:4', 'v:ep5:18', 'v:ep6:7']);
// after “to”, these start a place or a person (to the window, to her), not a second verb (to protect)
const TO_NOT_VERB = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'us', 'them', 'it', 'you',
  'this', 'that', 'school', 'bed', 'home', 'class', 'work']);

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day, n) => { const [y, m, d] = String(day).split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12)); };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayNum = now => Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
const low = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'");

// one sentence -> a candidate, or null when its trunk is not a plain “who + verb” she can point at
function candOf(ep, s) {
  if (!s || !s.trunk || !s.trunk.subject || !s.trunk.verb || s.trunk.kind || (s.trunk.also && s.trunk.also.length)) return null;
  if (SKIP.has(`v:${ep.id}:${s.i}`) || (s.tags || []).includes('imperative')) return null;
  let t = null;
  try { t = R.trunkOf(s); } catch (e) { t = null; }
  if (!t || !t.found) return null;
  const words = t.tokens.filter(x => x.word);
  if (words.length < 3 || words.length > 10 || words.some(x => x.parts)) return null;
  const vIdx = t.tokens.map((x, k) => (x.word && x.role === 'verb' ? k : -1)).filter(k => k >= 0);
  if (!vIdx.length) return null;
  // the verb's words side by side (a space between them is fine): “is sleeping”, not “Did ... forget”
  for (let a = vIdx[0]; a <= vIdx[vIdx.length - 1]; a++) if (t.tokens[a].word && t.tokens[a].role !== 'verb') return null;
  const answer = vIdx.filter(k => !NOT_VERB.has(low(t.tokens[k].text)));
  if (!answer.length) return null;
  // to + a verb after the trunk's verb (wants to protect): a second verb she would be told is not one
  const wIdx = t.tokens.map((x, k) => (x.word ? k : -1)).filter(k => k > vIdx[vIdx.length - 1]);
  for (let j = 0; j + 1 < wIdx.length; j++) {
    const w = t.tokens[wIdx[j + 1]].text;
    if (low(t.tokens[wIdx[j]].text) === 'to' && !TO_NOT_VERB.has(low(w)) && !/^[A-Z]/.test(w)) return null;
  }
  // “who” first, then the verb right after (the hint says so): no questions (Is your bag ...?), no there be
  const sIdx = t.tokens.map((x, k) => (x.word && x.role === 'subject' ? k : -1)).filter(k => k >= 0);
  if (!sIdx.length || sIdx[0] > answer[0] || (s.tags || []).includes('there_be')) return null;
  const verbWords = answer.map(k => low(t.tokens[k].text));
  return {
    id: `v:${ep.id}:${s.i}`, ep: ep.id, n: ep.n, i: s.i, en: s.en, zh: s.zh || '', subject: t.subject,
    verb: answer.map(k => t.tokens[k].text).join(' '), trunkVerb: t.verb || answer.map(k => t.tokens[k].text).join(' '), note: t.note || '', tags: (s.tags || []).slice(),
    be: verbWords.some(w => BE.has(w)), answer, tokens: t.tokens,
  };
}

export function candidates(c = R.content()) {
  if (!c || !Array.isArray(c.episodes)) return [];
  const out = [];
  for (const ep of c.episodes) for (const s of ep.sentences || []) { const x = candOf(ep, s); if (x) out.push(x); }
  return out;
}

export function readVerbState(x) {
  let raw = x;
  try { if (x && typeof x.peek === 'function') raw = x.peek(KV_KEY, null); } catch (e) { raw = null; }
  const out = { v: 1, items: {}, first: '', updated: '' };
  if (!raw || typeof raw !== 'object') return out;
  if (isDay(raw.first)) out.first = raw.first;
  if (typeof raw.updated === 'string') out.updated = raw.updated;
  for (const [id, r] of Object.entries(raw.items && typeof raw.items === 'object' ? raw.items : {})) {
    if (!/^v:/.test(id) || !r || typeof r !== 'object') continue;
    out.items[id] = { n: Math.max(0, Number(r.n) || 0), last: isDay(r.last) ? r.last : '', clean: !!r.clean };
  }
  return out;
}

export function applyVerb(state, { id, clean = false, now = new Date() } = {}) {
  const s = readVerbState(state);
  const day = dayOf(now);
  const prev = s.items[id] || { n: 0, last: '', clean: false };
  s.items[id] = { n: prev.n + 1, last: day, clean: !!clean };
  if (!s.first) s.first = day;
  s.updated = now.toISOString();
  return s;
}

export function resolveVerb(id, c = R.content()) {
  const m = String(id || '').match(/^v:(.+):(\d+)$/);
  if (!m || !c || typeof c.episode !== 'function') return null;
  const ep = c.episode(m[1]);
  const s = ep && ep.sentences.find(x => x.i === Number(m[2]));
  return ep && s ? candOf(ep, s) : null;
}

// which sentences today: from the episodes she has read (the whole set before she has read any), not-yet-done first,
// a be sentence one day and another verb the next; a sentence she got right first time in the last 14 days rests
export function verbItems(kv, now = new Date(), { content: c = R.content(), progress = null, n = 1 } = {}) {
  if (n <= 0) return [];
  const all = candidates(c);
  if (!all.length) return [];
  const st = readVerbState(kv);
  const today = dayOf(now);
  let prog = progress;
  if (!prog) { try { prog = R.readProgress(kv); } catch (e) { prog = null; } }
  const read = new Set(Object.entries((prog && prog.episodes) || {}).filter(([, e]) => e && (e.done || e.started)).map(([id]) => id));
  // today's picks stay today's picks once she has done them (a second lesson the same day gets new ones)
  const fresh = x => { const r = st.items[x.id]; return !r || (!(r.clean && r.last >= addDays(today, -RECENT_DAYS)) && r.last !== today); };
  const pool = (read.size ? all.filter(x => read.has(x.ep)) : all).filter(fresh);
  const rest = all.filter(x => fresh(x) && !pool.includes(x));
  const seen = x => (st.items[x.id] ? 1 : 0);
  const wantBe = dayNum(now) % 2 === 0;
  const rank = list => list.slice().sort((a, b) => seen(a) - seen(b) || (a.be === wantBe ? 0 : 1) - (b.be === wantBe ? 0 : 1)
    || ((a.n * 100 + a.i + dayNum(now) * 7) % 97) - ((b.n * 100 + b.i + dayNum(now) * 7) % 97));
  return [...rank(pool), ...rank(rest)].slice(0, n).map(x => x.id);
}

// ---------------------------------------------------------------- the screen

export function renderVerb(container, ctx = {}, { items = [], sid = '', step = 'warmup', onDone = () => {}, autoNextMs = 1400, content: c0 = null } = {}) {
  const el = h('div', { className: 'vb' });
  container.replaceChildren(el);
  let stopped = false, timer = 0, keyFn = null;
  const results = [];
  const log = ev => { try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, ...ev }) : null; } catch (e) { return null; } };
  const kvSet = v => { try { const r = ctx.kv && ctx.kv.set ? ctx.kv.set(KV_KEY, v) : null; if (r && r.catch) r.catch(() => {}); } catch (e) { /* keep going */ } };
  // the names she picked for the girl and the cat
  const named = (() => { try { return c0 || R.contentWith(ctx.kv && ctx.kv.peek ? ctx.kv.peek(R.NAMES_KEY, null) : null) || R.content(); } catch (e) { return c0 || R.content(); } })();
  const queue = (items || []).map(id => resolveVerb(typeof id === 'string' ? id : id && id.id, named)).filter(Boolean);
  const finish = () => { if (stopped) return; stopped = true; clearTimeout(timer); onDone({ results }); };
  if (!queue.length) { setTimeout(finish, 0); return { el, onKey() {}, stop() { stopped = true; } }; }

  function draw(x) {
    const st = readVerbState(ctx.kv);
    const firstEver = !st.first;
    const t0 = Date.now();
    let tries = 0, level = 0, done = false;
    const verbAt = new Set(x.answer);
    const feedback = h('p', { className: 'vb-feedback', role: 'status', 'aria-live': 'polite' });
    const hint = h('p', { className: 'vb-hint', hidden: true });
    const nextBtn = h('button', { type: 'button', className: 'btn vb-next', text: '下一个', hidden: true, on: { click: () => next() } });
    const chips = new Map();
    const line = h('p', { className: 'vb-line', lang: 'en' }, x.tokens.map((t, k) => {
      if (!t.word) return t.text;
      const b = h('button', { type: 'button', className: 'vb-w', text: t.text, on: { click: () => pick(k) } });
      chips.set(k, b);
      return b;
    }));
    const showVerb = cls => { for (const k of verbAt) chips.get(k).classList.add(cls); };
    const showSubject = () => { x.tokens.forEach((t, k) => { if (t.word && t.role === 'subject') chips.get(k).classList.add('subj'); }); };
    function end(clean, grade) {
      done = true;
      for (const b of chips.values()) b.disabled = true;
      results.push({ id: x.id, item: x.id, clean, grade });
      kvSet(applyVerb(readVerbState(ctx.kv), { id: x.id, clean, now: new Date() }));
      if (clean) { el.classList.add('is-right'); timer = setTimeout(next, autoNextMs); }
      nextBtn.hidden = false;
    }
    function pick(k) {
      if (done || stopped) return;
      const b = chips.get(k);
      if (!b || b.disabled) return;
      tries++;
      const ok = verbAt.has(k);
      const word = x.tokens[k].text;
      const ev = { type: 'answer', item: x.id, mode: MODE, choice: word, correct: ok, first_try: tries === 1, ms: Date.now() - t0, hint_level: level,
        misconception: null, point: x.be ? 'g:be' : '', episode: x.ep };
      if (ok) {
        const grade = tries === 1 ? 3 : 2;
        log({ ...ev, done: true, grade });
        showVerb('right');
        feedback.textContent = (tries === 1 ? '对了。' : '对了，找到了。') + `谁 = ${x.subject}，动词 = ${x.trunkVerb}。`;
        end(tries === 1, grade);
        return;
      }
      b.classList.add('wrong');
      b.disabled = true;
      if (level === 0) {
        level = 1;
        log(ev);
        log({ type: 'hint', item: x.id, mode: MODE, level: 1, hint_level: 1, auto: true });
        showSubject();
        hint.textContent = `先找“谁”：${x.subject}。紧跟着说“是”或者“干什么”的那个词，就是动词。`;
        hint.hidden = false;
        return;
      }
      level = 2;
      log({ ...ev, done: true, grade: 1 });
      log({ type: 'hint', item: x.id, mode: MODE, level: 2, hint_level: 2, auto: true });
      showVerb('reveal');
      hint.textContent = `动词是 ${x.trunkVerb}。${x.note}`;
      feedback.textContent = '';
      end(false, 1);
    }
    function next() {
      if (stopped || !done) return;
      clearTimeout(timer);
      queue.shift();
      if (queue.length) draw(queue[0]); else finish();
    }
    keyFn = ev => { if (done && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); next(); } };
    el.classList.remove('is-right');
    el.replaceChildren(...[
      h('p', { className: 'vb-title small', text: '找动词' }),
      firstEver ? h('p', { className: 'vb-first', text: FIRST_LINE }) : null,
      h('p', { className: 'vb-ask', text: '点出这句话里的动词。' }),
      line,
      x.zh ? h('p', { className: 'vb-zh small', lang: 'zh-CN', text: x.zh }) : null,
      hint, feedback,
      h('div', { className: 'btn-row' }, nextBtn),
    ].filter(Boolean));
  }
  draw(queue[0]);
  return { el, onKey: ev => { if (keyFn) keyFn(ev); }, stop() { stopped = true; clearTimeout(timer); } };
}
