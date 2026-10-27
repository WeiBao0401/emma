// 分享给妈妈（0.9.4）：把今天学了什么做成一张卡片图，调起 iPad 的分享面板，她在里面选微信发给妈妈。
// 负责：分享 agent（share.js、css/share.css、tests/share.test.mjs）；首页的入口在 ui-home.js（按需 import）。
//
// 导出
//   summarize({ events, entries, kv, now, cardTitle?, name? }) -> Summary     纯函数，不调模型
//     events     今天的事件（events.query({ since: 今天 })；别的日子的会被滤掉）
//     entries    words.all() 的词条
//     kv         ctx.kv（只用 peek / keys，算连续几天）
//     cardTitle  语法卡 id -> 名字（grammar.js content().card(id).title）；不给就不列语法卡
//     Summary = { date: 'YYYY-MM-DD', name, words, wrote, newWords: [{ w, zh }], newCount, reads, grammar: [名字],
//                 minutes, streak?, answered, line }
//       words     练了几个词：今天作答过的词（四选一、听音、字母块、键盘、句子里回想、闪卡、纸笔、错题再考），
//                 加上评过分（review）、听写过（dictation）的词，按 slug 去重
//       wrote     写对几个：写的题型（tiles / keys / cloze / paper）里有一次干净的写对（first_try 不是 false、
//                 没看提示、没被揭晓答案），或者听写打了勾
//       newWords  今天新学的词：第一次评分（entry.reviews[0]）是今天的词，最多 6 个，按先后；newCount 是一共几个
//       reads     读了几篇：每日阅读（read_time daily）和故事（read_time 'ep:<集>'），读完的，按篇去重
//       grammar   练过的语法卡名（mode 'grammar' 的作答里的 card，对比小卡不算），最多 3 个
//       minutes   大约学了几分钟：事件之间不超过 5 分钟的间隔加起来（读一篇时用 read_time 的 ms），
//                 和每节课 session_end 的 min（每节最多算 40）取大的
//       streak    连着几天（今天算一天），2 天以上才有：kv 'day:' 有做完的格子、'dictation:' 有轮次、'daily:' 有读过的篇
//       answered  今天作答过的题数（首答），只用来判断“今天做过东西”
//       line      老师的一句话：按数字挑一句真诚的夸奖或鼓励（teacherLine）
//   hasActivity(summary) -> bool   今天做过东西（练过词、写过、读过、练过语法或做过题）
//   teacherLine(summary) -> string  纯函数，按顺序挑第一条对得上的
//   shareText(summary) -> string    发文字时的那一段
//   todaySummary(ctx, now?) -> Promise<Summary>   查今天的事件、词条、语法卡名再 summarize
//   doneToday(ctx, now?) -> Promise<bool>         首页用：今天做过东西才显示入口
//   drawCard(g, summary, { serif, sans })         在 1080×1350 的 2D 画布上画卡片（测试里传假的 g）
//   cardFile(summary, { doc }) -> Promise<File | null>   画好转成 PNG；没有 canvas、toBlob、File 时返回 null
//   shareToday(ctx, { now, summary, file, nav, doc }) -> Promise<{ ok, via: 'files' | 'text' | 'clipboard' | 'none',
//                                                                   cancelled?, empty?, again? }>
//     1. 有图且 navigator.canShare({ files }) → navigator.share({ files: [png], title })
//     2. 不能分享文件 → navigator.share({ title, text })
//     3. 都不行 → 复制到剪贴板，提示“已复制，打开微信粘贴给妈妈”
//     她点了取消（AbortError）不报错、不提示；NotAllowedError（点完等太久，iPad 不让弹）提示再点一次
//     nav、doc 默认是 navigator、document，测试里注入假的
//   shareButton(ctx, { scope = 'today' } = {}) -> HTMLElement
//     按钮“分享给妈妈”；一出来就在后台把今天的卡片画好（点了马上弹面板）；今天还什么都没做时字换成
//     “先学一会儿再分享”，点了也只提示这一句
//
// 用到的 ctx：events.query、words.all、kv（peek、keys）、toast、busy（分享面板开着时别自动更新）。
// 不写 kv，不记事件。卡片的颜色是固定的米黄底、深蓝字（发出去的图不跟着深色模式变）。
import { h } from './ui-dom.js';

export const TITLE = 'Emma 今天学英语';
export const SIGN = 'Emma 的英语老师';
export const WHO = '妈妈';
export const BUTTON_TEXT = '分享给' + WHO;
export const EMPTY_TEXT = '先学一会儿再分享';
export const COPIED_TEXT = `已复制，打开微信粘贴给${WHO}`;
export const AGAIN_TEXT = `准备好了，再点一次“${BUTTON_TEXT}”。`;
export const FAIL_TEXT = `这台 iPad 现在分享不了。可以截个屏发给${WHO}。`;
export const CARD_W = 1080;
export const CARD_H = 1350;
export const NEW_MAX = 6;
export const GRAMMAR_MAX = 3;
export const COLORS = { bg: '#F6EFDD', ink: '#1F3152', muted: '#56637A', faint: '#8B94A3', rule: 'rgba(31,49,82,.18)', accent: '#2F4A7A' };
const FALLBACK_SERIF = 'ui-serif, "New York", Georgia, "PingFang SC", serif';
const FALLBACK_SANS = '-apple-system, "PingFang SC", system-ui, sans-serif';

const WORD_MODES = new Set(['mc4', 'listen', 'tiles', 'keys', 'cloze', 'card', 'paper', 'mistake']);
const WRITE_MODES = new Set(['tiles', 'keys', 'cloze', 'paper']);
const GAP_MS = 5 * 60000;          // a longer gap between two events is a break
const SESSION_CAP = 40;            // one lesson counts at most 40 minutes (the iPad may have been left open)
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const str = x => (x === null || x === undefined ? '' : String(x));
const arr = x => (Array.isArray(x) ? x : []);
const obj = x => (x && typeof x === 'object' ? x : {});
const peek = (kv, k, d) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, d) : d; } catch (e) { return d; } };
const keysOf = (kv, p) => { try { return kv && typeof kv.keys === 'function' ? arr(kv.keys(p)) : []; } catch (e) { return []; } };
const timeOf = e => { const t = Date.parse(str(e && e.at)); return Number.isFinite(t) ? t : NaN; };

// ---------------------------------------------------------------- the numbers

// “n. 夹克；短上衣” -> “夹克”
export function shortZh(s) {
  let t = str(s).replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:(?:[a-z]+\.\s*)(?:[&/]\s*)?)+/i, '').trim();
  t = t.split(/[；;，,/｜|]/)[0].trim();
  return t.length > 10 ? t.slice(0, 10) + '…' : t;
}
// grammar card titles for a mum: “can：会、能……” -> “can 的用法”, “be 动词 am / is / are” -> “be 动词”
export function shortTitle(t) {
  let s = str(t).trim();
  if (!s) return '';
  const colon = s.indexOf('：');
  if (colon > 0) { const head = s.slice(0, colon).trim(); s = /[一-鿿]/.test(head) ? head : head + ' 的用法'; }
  if (s.length > 12) { const m = s.match(/^(.*?[一-鿿]+)\s/); if (m) s = m[1]; }
  return s;
}

function activeDays(kv) {
  const set = new Set();
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
  for (const k of keysOf(kv, 'day:')) {
    const r = obj(peek(kv, k, null));
    if (ok(k.slice(4)) && Object.values(obj(r.cells)).some(Boolean)) set.add(k.slice(4));
  }
  for (const k of keysOf(kv, 'dictation:')) {
    const r = obj(peek(kv, k, null));
    if (ok(k.slice(10)) && arr(r.rounds).length) set.add(k.slice(10));
  }
  for (const k of keysOf(kv, 'daily:')) {
    const r = obj(peek(kv, k, null));
    if (ok(k.slice(6)) && arr(r.pieces).some(p => p && p.read)) set.add(k.slice(6));
  }
  return set;
}
function streakOf(kv, now) {
  const days = activeDays(kv);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 1;                                   // today counts: she did something
  for (;;) {
    d.setDate(d.getDate() - 1);
    if (!days.has(dayOf(d))) break;
    n++;
    if (n > 999) break;
  }
  return n;
}

function readKey(e) {
  if (!e || e.type !== 'read_time' || e.completed === false) return '';
  const item = str(e.item);
  if (e.daily || item.startsWith('daily:')) return e.fallback === 'story' && e.episode ? 'ep:' + e.episode : item || 'daily:' + str(e.episode);
  return /^ep:[^:]+$/.test(item) ? item : '';
}

function minutesOf(list) {
  const times = list.map(e => ({ t: timeOf(e), e })).filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  let active = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i].t - times[i - 1].t;
    const ms = Number(times[i].e.ms) || 0;
    if (gap <= GAP_MS) active += gap;
    else if (times[i].e.type === 'read_time' && ms > 0) active += Math.min(ms, gap);
  }
  let lessons = 0;
  for (const e of list) if (e.type === 'session_end' && Number(e.min) > 0) lessons += Math.min(Number(e.min), SESSION_CAP);
  const m = Math.round(Math.max(active / 60000, lessons));
  return Math.min(m, 300);
}

export function summarize({ events = [], entries = [], kv = null, now = new Date(), cardTitle = null, name = '' } = {}) {
  const date = dayOf(now);
  const list = arr(events).filter(e => e && typeof e === 'object' && str(e.at).slice(0, 10) === date);
  const words = new Set(), wrote = new Set(), reads = new Set(), cards = [], items = new Set();
  let tried = 0, right = 0;
  for (const e of list) {
    const slug = str(e.slug);
    if (e.type === 'answer') {
      if (e.first_try !== false && typeof e.correct === 'boolean') {
        items.add(str(e.item) || `${e.mode}:${slug}:${items.size}`);
        tried++; if (e.correct) right++;
      }
      if (slug && WORD_MODES.has(e.mode)) words.add(slug);
      if (slug && WRITE_MODES.has(e.mode) && e.correct === true && e.first_try !== false && !(Number(e.hint_level) > 0) && !e.revealed) wrote.add(slug);
      if (e.mode === 'grammar' && e.card && e.kind !== 'contrast' && typeof cardTitle === 'function') {
        let t = '';
        try { t = shortTitle(cardTitle(String(e.card))); } catch (err) { t = ''; }
        if (t && !cards.includes(t)) cards.push(t);
      }
    } else if (e.type === 'review' && slug) {
      words.add(slug);
    } else if (e.type === 'dictation' && slug) {
      words.add(slug);
      if (e.correct === true) wrote.add(slug);
    }
    const r = readKey(e);
    if (r) reads.add(r);
  }
  // new today: the first rating of the word was today (an imported card with older reps is not new)
  const fresh = [];
  for (const e of arr(entries)) {
    if (!e || !e.headword) continue;
    const revs = arr(e.reviews);
    const first = revs[0] && str(revs[0].at);
    if (!first || first.slice(0, 10) !== date) continue;
    if ((Number(obj(e.fsrs).reps) || 0) > revs.length) continue;
    fresh.push({ at: first, w: str(e.headword).trim(), zh: shortZh(e.brief_cn || e.cn || '') });
  }
  fresh.sort((a, b) => a.at.localeCompare(b.at));
  const out = {
    date,
    name: str(name).trim() || 'Emma',
    words: words.size,
    wrote: wrote.size,
    newWords: fresh.slice(0, NEW_MAX).map(({ w, zh }) => ({ w, zh })),
    newCount: fresh.length,
    reads: reads.size,
    grammar: cards.slice(0, GRAMMAR_MAX),
    minutes: list.length ? minutesOf(list) : 0,
    answered: items.size,
  };
  // first-try accuracy only steers the teacher's line; it is not shown
  Object.defineProperty(out, 'tried', { value: tried, enumerable: false });
  Object.defineProperty(out, 'rate', { value: tried ? right / tried : null, enumerable: false });
  const active = hasActivity(out);
  if (active) {
    if (!out.minutes) out.minutes = 1;
    const s = streakOf(kv, now);
    if (s >= 2) out.streak = s;
  }
  out.line = active ? teacherLine(out) : '';
  return out;
}

export function hasActivity(s) {
  const x = obj(s);
  return (x.words || 0) + (x.wrote || 0) + (x.reads || 0) + arr(x.grammar).length + (x.answered || 0) + (x.newCount || 0) > 0;
}

// the teacher's one line to mum: the first rule that fits; honest numbers, no big words
export function teacherLine(s) {
  const x = obj(s);
  const wrote = x.wrote || 0, reads = x.reads || 0, streak = x.streak || 0, words = x.words || 0, minutes = x.minutes || 0;
  const fresh = x.newCount || arr(x.newWords).length;
  const tried = x.tried || 0;
  const rate = typeof x.rate === 'number' ? x.rate : null;
  if (wrote >= 10) return `今天写对了 ${wrote} 个词。会写比认得难，她是一个字母一个字母拼出来的。`;
  if (streak >= 7) return `已经连着学了 ${streak} 天。每天都来，比一次学很多更管用。`;
  if (reads >= 2) return `今天读完了 ${reads} 篇英语短文。读得多了，阅读题就不怕了。`;
  if (fresh >= 4) return `今天认识了 ${fresh} 个新词。明天我再考考她，帮她记牢。`;
  if (rate !== null && tried >= 8 && rate < 0.5) return '今天错的不少。错的词我都记下了，明天先帮她练这些。';
  if (wrote >= 3) return `今天写对了 ${wrote} 个词。能写出来，才算真记住了。`;
  if (reads === 1) return '今天读完了一篇英语短文。肯读完，就是进步。';
  if (arr(x.grammar).length) return `今天练了“${x.grammar[0]}”。这个点我会隔几天再带她练一次。`;
  if (streak >= 3) return `连着学了 ${streak} 天。每天一点点，慢慢就扎实了。`;
  if (words >= 10) return `今天练了 ${words} 个词。词就是这样一遍一遍记住的。`;
  if (minutes >= 15) return `今天学了约 ${minutes} 分钟。坚持下去，会越来越轻松。`;
  return '今天学了一会儿。每天一点点，就会慢慢好起来。';
}

export function dateLine(date) {
  const m = str(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${+m[2]} 月 ${+m[3]} 日 · ${WEEK[d.getDay()]}`;
}

// the number lines, as runs of text and big numbers (the card) or plain sentences (the text)
export function statRows(s) {
  const x = obj(s);
  const rows = [];
  if (x.words) rows.push([{ t: '练了 ' }, { n: x.words }, { t: ' 个词' }, ...(x.wrote ? [{ t: '，写对 ' }, { n: x.wrote }, { t: ' 个' }] : [])]);
  else if (x.wrote) rows.push([{ t: '写对 ' }, { n: x.wrote }, { t: ' 个词' }]);
  if (x.reads) rows.push([{ t: '读了 ' }, { n: x.reads }, { t: ' 篇短文' }]);
  if (x.minutes) rows.push([{ t: '学了约 ' }, { n: x.minutes }, { t: ' 分钟' }, ...(x.streak ? [{ t: '，连续 ' }, { n: x.streak }, { t: ' 天' }] : [])]);
  else if (x.streak) rows.push([{ t: '连续 ' }, { n: x.streak }, { t: ' 天' }]);
  return rows;
}
const rowText = row => row.map(r => ('n' in r ? String(r.n) : r.t)).join('');
const grammarText = s => (arr(s.grammar).length ? '练了语法：' + s.grammar.map(g => `“${g}”`).join('、') : '');
const newLabel = s => (s.newCount > arr(s.newWords).length ? `今天新学的 ${s.newCount} 个词` : '今天新学的词');

export function shareText(s) {
  const x = obj(s);
  const L = [`${x.name || 'Emma'} 今天学英语（${dateLine(x.date) || x.date || ''}）`];
  for (const row of statRows(x)) L.push(rowText(row) + '。');
  const g = grammarText(x);
  if (g) L.push(g + '。');
  if (arr(x.newWords).length) L.push(newLabel(x) + '：' + x.newWords.map(w => (w.zh ? `${w.w} ${w.zh}` : w.w)).join('、'));
  if (x.line) L.push('老师说：' + x.line);
  L.push(`（${SIGN}）`);
  return L.join('\n');
}

// ---------------------------------------------------------------- reading what the app knows

async function grammarTitles() {
  try {
    const G = await import('./grammar.js');
    const c = G && typeof G.content === 'function' ? G.content() : null;
    if (!c || typeof c.card !== 'function') return null;
    return id => { const card = c.card(id); return card ? card.title || '' : ''; };
  } catch (e) { return null; }
}

export async function todaySummary(ctx, now = new Date()) {
  const c = obj(ctx);
  let events = [];
  try { events = c.events && typeof c.events.query === 'function' ? await c.events.query({ since: dayOf(now), limit: 20000 }) : []; }
  catch (e) { events = []; }
  let entries = [];
  try { entries = c.words && typeof c.words.all === 'function' ? c.words.all() : []; } catch (e) { entries = []; }
  const name = obj(peek(c.kv, 'profile', {})).name || '';
  return summarize({ events, entries, kv: c.kv, now, cardTitle: await grammarTitles(), name });
}

export async function doneToday(ctx, now = new Date()) {
  try { return hasActivity(await todaySummary(ctx, now)); } catch (e) { return false; }
}

// ---------------------------------------------------------------- the card

const setFont = (g, weight, px, family) => { g.font = `${weight} ${px}px ${family}`; };
const widthOf = (g, s) => { try { return Number(g.measureText(s).width) || 0; } catch (e) { return 0; } };
// break between words for English, anywhere for Chinese
export function wrapText(g, text, maxW, maxLines = 3) {
  const tokens = str(text).match(/[A-Za-z0-9'’.\-]+|\s+|./gu) || [];
  const lines = [];
  let cur = '';
  for (const tok of tokens) {
    const next = cur + tok;
    if (!cur || widthOf(g, next) <= maxW) { cur = next; continue; }
    lines.push(cur.trimEnd());
    cur = tok.trimStart();
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur.trimEnd());
  else if (cur && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last && widthOf(g, last + '…') > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines.filter(Boolean);
}
function fit(g, text, maxW) {
  let s = str(text);
  if (widthOf(g, s) <= maxW) return s;
  while (s && widthOf(g, s + '…') > maxW) s = s.slice(0, -1);
  return s ? s + '…' : '';
}

export function drawCard(g, s, { serif = FALLBACK_SERIF, sans = FALLBACK_SANS } = {}) {
  const x = obj(s);
  const W = CARD_W, H = CARD_H, M = 96, R = W - M;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, W, H);
  // a short accent line, the title, the date, a hairline
  g.fillStyle = COLORS.accent;
  g.fillRect(M, 100, 64, 6);
  g.fillStyle = COLORS.ink;
  setFont(g, 600, 84, serif);
  g.fillText(fit(g, `${x.name || 'Emma'} 今天学英语`, R - M), M, 200);
  g.fillStyle = COLORS.muted;
  setFont(g, 400, 36, sans);
  g.fillText(dateLine(x.date), M, 258);
  g.fillStyle = COLORS.rule;
  g.fillRect(M, 304, R - M, 2);
  let y = 306;
  // the numbers: sentences with the numbers big
  for (const row of statRows(x)) {
    y += 104;
    let cx = M;
    for (const run of row) {
      if ('n' in run) { setFont(g, 600, 80, serif); g.fillStyle = COLORS.accent; }
      else { setFont(g, 400, 42, sans); g.fillStyle = COLORS.ink; }
      const t = 'n' in run ? String(run.n) : run.t;
      g.fillText(t, cx, y);
      cx += widthOf(g, t);
    }
  }
  const gt = grammarText(x);
  if (gt) {
    setFont(g, 400, 38, sans);
    g.fillStyle = COLORS.ink;
    for (const l of wrapText(g, gt, R - M, 2)) { y += 60; g.fillText(l, M, y); }
  }
  // the bottom first: the signature, then the teacher's line above it
  const footY = H - 64;
  g.fillStyle = COLORS.faint;
  setFont(g, 400, 28, sans);
  g.textAlign = 'right';
  g.fillText(SIGN, R, footY);
  g.textAlign = 'left';
  const lh = 58;
  setFont(g, 400, 42, sans);
  const tl = x.line ? wrapText(g, x.line, R - M - 36, 3) : [];
  const tTop = footY - 60 - tl.length * lh;
  if (tl.length) {
    g.fillStyle = COLORS.accent;
    g.fillRect(M, tTop + 10, 5, tl.length * lh - 12);
    g.fillStyle = COLORS.ink;
    tl.forEach((l, i) => g.fillText(l, M + 36, tTop + (i + 1) * lh - 14));
  }
  // the new words, two columns, as many rows as fit between the numbers and the teacher's line
  const fresh = arr(x.newWords);
  if (fresh.length && y + 160 < tTop) {
    y += 32;
    g.fillStyle = COLORS.rule;
    g.fillRect(M, y, R - M, 2);
    y += 52;
    g.fillStyle = COLORS.muted;
    setFont(g, 400, 32, sans);
    g.fillText(newLabel(x), M, y);
    const gap = 40, colW = (R - M - gap) / 2, rowH = 76;
    for (let i = 0; i < fresh.length; i += 2) {
      if (y + rowH > tTop - 30) break;
      y += rowH;
      for (let j = 0; j < 2 && i + j < fresh.length; j++) {
        const w = fresh[i + j];
        const cx = M + j * (colW + gap);
        let px = 52;
        setFont(g, 500, px, serif);
        while (px > 34 && widthOf(g, w.w) > colW * 0.72) { px -= 2; setFont(g, 500, px, serif); }
        const word = fit(g, w.w, colW);
        g.fillStyle = COLORS.ink;
        g.fillText(word, cx, y);
        const ww = widthOf(g, word);
        if (w.zh && ww + 18 < colW) {
          setFont(g, 400, 32, sans);
          g.fillStyle = COLORS.muted;
          const zh = fit(g, w.zh, colW - ww - 18);
          if (zh) g.fillText(zh, cx + ww + 18, y);
        }
      }
    }
  }
}

function cssVar(doc, name) {
  try {
    const v = getComputedStyle(doc.documentElement).getPropertyValue(name);
    return str(v).trim();
  } catch (e) { return ''; }
}
const later = (ms, v) => new Promise(res => setTimeout(() => res(v), ms));

export async function cardFile(s, { doc = globalThis.document } = {}) {
  let canvas = null;
  try {
    if (!doc || typeof doc.createElement !== 'function') return null;
    canvas = doc.createElement('canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const g = canvas.getContext('2d');
    if (!g || typeof g.fillText !== 'function') return null;
    const fonts = { serif: cssVar(doc, '--serif') || FALLBACK_SERIF, sans: cssVar(doc, '--sans') || FALLBACK_SANS };
    // the Chinese face is a local() font: ask for it once so the first card is not drawn in the fallback
    try { if (doc.fonts && typeof doc.fonts.load === 'function') await Promise.race([Promise.all([doc.fonts.load(`600 84px ${fonts.serif}`, '今天'), doc.fonts.load(`400 42px ${fonts.sans}`, '今天')]), later(400)]); }
    catch (e) { /* draw with what is there */ }
    drawCard(g, s, fonts);
    if (typeof canvas.toBlob !== 'function') return null;
    const blob = await Promise.race([new Promise(res => { try { canvas.toBlob(b => res(b || null), 'image/png'); } catch (e) { res(null); } }), later(5000, null)]);
    if (!blob || typeof File !== 'function') return null;
    return new File([blob], `emma-${obj(s).date || 'today'}.png`, { type: 'image/png' });
  } catch (e) {
    console.warn('share: card:', (e && e.message) || e);
    return null;
  } finally {
    // iPad Safari keeps canvas memory until the size goes back to 0
    try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch (e) { /* fine */ }
  }
}

// ---------------------------------------------------------------- sharing

async function tryShare(nav, data) {
  try { await nav.share(data); return 'ok'; }
  catch (e) {
    const n = e && e.name;
    if (n === 'AbortError') return 'cancelled';
    if (n === 'NotAllowedError') return 'again';
    console.warn('share:', (e && e.message) || e);
    return 'failed';
  }
}
function canShareFiles(nav, file) {
  try { return !!(file && nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })); }
  catch (e) { return false; }
}
async function copyText(nav, doc, text) {
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') { await nav.clipboard.writeText(text); return true; }
  } catch (e) { /* try the old way */ }
  try {
    if (!doc || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function' || !doc.body) return false;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    doc.body.append(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}

export async function shareToday(ctx, { now = new Date(), summary = null, file, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const c = obj(ctx);
  const say = msg => { try { if (typeof c.toast === 'function') c.toast(msg, 2800); } catch (e) { /* fine */ } };
  let s = summary;
  if (!s) { try { s = await todaySummary(c, now); } catch (e) { s = null; } }
  if (!s || !hasActivity(s)) { say(EMPTY_TEXT); return { ok: false, via: 'none', empty: true }; }
  const text = shareText(s);
  const busy = typeof c.busy === 'function';
  if (busy) { try { c.busy(+1); } catch (e) { /* fine */ } }
  try {
    const png = file !== undefined ? file : await cardFile(s, { doc });
    const hasShare = !!(nav && typeof nav.share === 'function');
    const tries = [];
    if (canShareFiles(nav, png)) tries.push(['files', { files: [png], title: TITLE }]);
    if (hasShare) tries.push(['text', { title: TITLE, text }]);
    for (const [via, data] of tries) {
      const r = await tryShare(nav, data);
      if (r === 'ok') return { ok: true, via };
      if (r === 'cancelled') return { ok: false, via, cancelled: true };
      if (r === 'again') { say(AGAIN_TEXT); return { ok: false, via, again: true }; }
    }
    if (await copyText(nav, doc, text)) { say(COPIED_TEXT); return { ok: true, via: 'clipboard' }; }
    say(FAIL_TEXT);
    return { ok: false, via: 'none' };
  } finally {
    if (busy) { try { c.busy(-1); } catch (e) { /* fine */ } }
  }
}

// the card drawn ahead (the button is drawn with the home page): a tap shares it at once, while the iPad still
// counts the tap as hers; one card at a time, kept while the numbers stay the same
let warm = { key: '', day: '', at: 0, summary: null, file: null, job: null };
const WARM_MS = 2 * 60000;
function warmUp(ctx, now = new Date()) {
  if (warm.job) return warm.job;
  warm.job = (async () => {
    try {
      const s = await todaySummary(ctx, now);
      if (!hasActivity(s)) { warm = { ...warm, key: '', day: s.date, at: Date.now(), summary: s, file: null }; return warm; }
      const key = JSON.stringify(s);
      const file = key === warm.key && warm.file ? warm.file : await cardFile(s);
      warm = { ...warm, key, day: s.date, at: Date.now(), summary: s, file };
      return warm;
    } catch (e) { return warm; }
    finally { warm.job = null; }
  })();
  return warm.job;
}
export function resetWarm() { warm = { key: '', day: '', at: 0, summary: null, file: null, job: null }; }

function shareIcon() {
  try {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of ['M12 3.6v11', 'M8.2 7.2 12 3.6l3.8 3.6', 'M8.6 10.4H7.2c-.9 0-1.6.7-1.6 1.6v6.4c0 .9.7 1.6 1.6 1.6h9.6c.9 0 1.6-.7 1.6-1.6V12c0-.9-.7-1.6-1.6-1.6h-1.4']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  } catch (e) { return null; }
}

export function shareButton(ctx, { scope = 'today' } = {}) {
  const label = h('span', { className: 'share-label', text: BUTTON_TEXT });
  const btn = h('button', { type: 'button', className: 'text-btn accent share-btn', dataset: { scope } }, shareIcon(), label);
  let busyNow = false;
  const born = Date.now();          // a card drawn before this button (an older page) may miss what she just did
  const setEmpty = on => {
    btn.classList.toggle('share-empty', on);
    label.textContent = on ? EMPTY_TEXT : BUTTON_TEXT;
  };
  btn.addEventListener('click', async () => {
    if (busyNow) return;
    busyNow = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const day = dayOf(new Date());
      const fresh = warm.summary && warm.day === day && warm.at >= born && Date.now() - warm.at < WARM_MS && !warm.job;
      const r = fresh
        ? await shareToday(ctx, { summary: warm.summary, file: warm.file || undefined })
        : await shareToday(ctx);
      setEmpty(!!(r && r.empty));
    } catch (e) {
      console.warn('share:', (e && e.message) || e);
    } finally {
      busyNow = false;
      btn.removeAttribute('aria-busy');
    }
  });
  // look once in the background: nothing yet today shows the hint; otherwise draw the card ahead
  setTimeout(() => {
    warmUp(ctx).then(w => { if (w && w.summary) setEmpty(!hasActivity(w.summary)); }, () => {});
  }, 300);
  return btn;
}
