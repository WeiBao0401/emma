// 家长区（DESIGN 9）：从“单词”页右上角“家长”进来，先输 4 位数字码（防误操作，不是保密）。里面放：装机清单（第一次
// 打开前）、课本进度和期中日期范围、今日和本月估算花费、每天费用上限、百炼 Key 和“测一下连接”、家长称呼、开机问卷，
// 然后是 ui-me.js 的几组（查词与复习、数据：导入单元包或备份、导出备份；高级：模型和测速；关于：版本号、体检页）。
// 负责：家长区 UI agent（ui-parent.js、ui-onboard.js、ui-me.js、css/parent.css、css/onboard.css）。
//
// 导出
//   createParentView(ctx) -> { show(params), hide(), onChange(), holding() }
//     渲染进 #tab-parent。params.open：解锁后直接展开的一行（'key'、'import'、'unit'、'exam'、'outline'、'intake'、'cap'…）。
//     holding()：这一页有没导完的备份或导入，自动更新会等它。
//     hide()：离开家长区（app.js 换路由时调用）就重新上锁。
//   纯函数（Node 测试用）：weakPin、makePin、checkPin、mergeTextbook、mergeProgress、exportKv、planKvImport、eventKey、newEvents、
//     intakeItems、visibleItems、answerOf、intakeFilled、pickMulti、intakeSideEffects、yuan、parentNameOf、
//     outlineIndex、splitOutline、matchOutline、outlineRecord、outlineSlugs（复习提纲，v1）
//
// 用到的 ctx：kv.peek / set / keys、budget.today / month、settings / saveSettings、curriculum.units / unitOrder /
//   hasTextbook、reloadCurriculum、events.query / count / log、applyTheme、go、toast。
// kv 'parent.pin'：{ salt, hash }（4 位码加盐的 SHA-256，不存明文）。家长一离开就重新上锁：换到别的页、App 退到后台、
//   点“交给 Emma”、5 分钟没操作。忘了码：输百炼 Key 的最后 4 位就能重设（Emma 不知道 Key）；还没填 Key 时，
//   交给 Emma 之前可以直接重设，交给她以后不行（只提示先填 Key）。
// 开机问卷：题目在公开的 curriculum/intake.json（另一个 agent 写的，形状见文件里的 rules），回答存 kv 'parent.intake'
//   { version: 1, at, updated, answers: { 题 id: 值 } }，写一项存一项，可以分几次填。题的 to 指向 progress.* 和
//   profile.parentCall 的，填的时候顺手写进 kv 'progress' 和 'profile'；问卷里这几题显示的也是 progress 里现在的值。
// kv 'profile'.parentCall：Emma 看到的“家长”二字换成这个（默认“家长”，和 intake.json 的 parent_call 一致）。
// 备份（CONTRACTS 5.1）：kv 里除 settings 和 parent.pin 以外的键，加全部 events。恢复（5.2）：textbook 按单元合并，
//   progress 新的赢，其余 kv 只补本机没有的键（budget 不恢复），events 按 eventKey 合并（本机已有的那条不重复导入）。
// 需要留意：查词时碰到让人担心的话题，查词页只记一条 events { type: 'flag', reason: 'care' }（不存她写了什么），
//   这里列出最近 30 天的次数。
// v1（期中季，DESIGN 6.2、6.4、9）：
//   复习提纲重点词：从已导入的课本单元里点选，或粘贴一串词自动匹配（matchOutline：逗号、顿号、换行隔开，夹着的中文
//     不管，短语整串认，词形按 curriculum.baseOf 还原），存 kv 'outline'（OUTLINE_KEY，形状见 outlineRecord）。
//     读它的是 plan.js（期中前这些词排在前面、练拼写）。
//   拍课本：一行入口，go('capture')（ui-capture.js 的页面）；这周小结：一行入口，go('weekly')（ui-weekly.js）。
//     两个页面是别的 agent 写的；nav.js 里还没有这个路由时，这一行灰着写“下一版”。离开家长区照样上锁。
//   开机问卷“听写怎么考”下面写明“明天有听写”现在的默认考法（ui-dictation.js intakeMethod，有 intake.js 时按它的）。
import { h, icon, toast, dateCn } from './ui-dom.js';
import { createMeTab } from './ui-me.js';
import { pageShell } from './ui-entry.js';
import { accentOf, cleanName, DEFAULT_PARENT_NAME } from './ui-onboard.js';
import { ROUTES } from './nav.js';
import { slugify } from './words.js';
import { normWord } from './curriculum.js';
import { METHOD_LABEL } from './dictation.js';
import { intakeMethod } from './ui-dictation.js';
import { optionalModule } from './ui-home.js';

export const PIN_LEN = 4;
export const PARENT_NAMES = ['妈妈', '爸爸', '家长'];
const MAX_WRONG = 5;
const WAIT_MS = 30000;
const IDLE_MS = 5 * 60 * 1000;   // the unlocked area locks again after 5 minutes without a tap
const FLAG_DAYS = 30;
export const KIND_LABEL = { lookup: '查词', tts: '朗读', hint: '提示讲解', story: '故事', reflect: '每周反思', photo: '拍照识别', other: '其他' };
export const EXPORT_SKIP = ['settings', 'parent.pin'];            // never leave the iPad in a backup
const RESTORE_SKIP = new Set(['settings', 'parent.pin', 'budget']);
const KV_LABEL = { profile: '名字和主题色', onboard: '第一次打开', 'parent.intake': '开机问卷', 'lines.seen': '英语小对话' };
const kvLabel = k => KV_LABEL[k] || (k.startsWith('day:') ? '每天的课' : k.startsWith('dictation:') ? '听写' : k);

export const INTAKE_FILE = 'curriculum/intake.json';

// ---------------------------------------------------------------- pure helpers

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function fnv1a(s) {
  let x = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) { x ^= c; x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16).padStart(8, '0');
}
export const validPin = code => new RegExp(`^\\d{${PIN_LEN}}$`).test(String(code));
// 0000, 1234, 9876: the first codes anyone tries
export function weakPin(code) {
  const d = String(code).split('').map(Number);
  if (d.every(x => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]);
  return steps.every(s => s === 1) || steps.every(s => s === -1);
}
async function hashWith(fnv, code, salt) {
  const text = `emma-parent-pin:${salt}:${code}`;
  const subtle = !fnv && globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) return hex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return 'fnv1a:' + fnv1a(text);
}
export function newSalt() {
  const a = new Uint8Array(8);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return hex(a);
}
// { salt, hash }; SHA-256 where the browser has it (https, localhost), a plain hash otherwise (still no clear text)
export async function makePin(code, salt = newSalt()) {
  const fnv = !(globalThis.crypto && globalThis.crypto.subtle);
  return { salt, hash: await hashWith(fnv, code, salt) };
}
export async function checkPin(rec, code) {
  if (!rec || !rec.salt || !rec.hash || !validPin(code)) return false;
  const fnv = String(rec.hash).startsWith('fnv1a:');
  if (!fnv && !(globalThis.crypto && globalThis.crypto.subtle)) return false;
  return (await hashWith(fnv, code, rec.salt)) === rec.hash;
}

// A later unit pack may carry only the new unit: units merge by id, the incoming one wins.
export function mergeTextbook(local, incoming, now = new Date()) {
  const units = new Map(((local && local.units) || []).filter(u => u && u.id).map(u => [u.id, u]));
  for (const u of (incoming && incoming.units) || []) if (u && u.id) units.set(u.id, u);
  const list = [...units.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { ...(local || {}), ...(incoming || {}), units: list, importedAt: now.toISOString() };
}
// The newer progress wins; nothing local yet: take the incoming one. null: keep the local one.
export function mergeProgress(local, incoming, now = new Date()) {
  if (!incoming || typeof incoming !== 'object') return null;
  const has = local && typeof local === 'object' && Object.keys(local).length > 0;
  if (!has) return { ...incoming, updated: incoming.updated || now.toISOString() };
  if (incoming.updated && (!local.updated || String(incoming.updated) > String(local.updated))) return { ...local, ...incoming };
  return null;
}
// kv for a backup: everything but EXPORT_SKIP. pairs: [[key, value], ...]
export function exportKv(pairs) {
  const out = {};
  for (const [k, v] of pairs) if (!EXPORT_SKIP.includes(k) && v !== undefined) out[k] = v;
  return out;
}
// What an import writes into kv. local: { key: value } now on the iPad. -> { writes: { key: value }, notes: [text], kept }
export function planKvImport(local = {}, incoming = {}, now = new Date()) {
  const writes = {};
  const notes = [];
  const has = k => Object.prototype.hasOwnProperty.call(local, k) && local[k] !== undefined;
  if (incoming.textbook && Array.isArray(incoming.textbook.units) && incoming.textbook.units.length) {
    const tb = mergeTextbook(local.textbook, incoming.textbook, now);
    writes.textbook = tb;
    notes.push(`课本${tb.book ? ' ' + tb.book : ''}：${tb.units.map(u => u.title || u.id).join('、')}（共 ${tb.units.length} 个单元）`);
  }
  if (incoming.progress) {
    const p = mergeProgress(local.progress, incoming.progress, now);
    if (p) {
      writes.progress = p;
      const units = ((writes.textbook || local.textbook || {}).units) || [];
      const title = id => ((units.find(u => u.id === id) || {}).title) || id;
      const bits = [p.unit ? '正在学 ' + title(p.unit) : '', p.examDate ? `期中 ${p.examDate}` : ''].filter(Boolean);
      notes.push('课本进度' + (bits.length ? '：' + bits.join('，') : ''));
    }
  }
  const restored = new Set();
  let kept = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'textbook' || k === 'progress' || RESTORE_SKIP.has(k) || v === undefined) continue;
    if (has(k)) { kept++; continue; }
    writes[k] = v;
    restored.add(kvLabel(k));
  }
  if (restored.size) notes.push([...restored].join('、'));
  return { writes, notes, kept };
}
// ---- the intake form (curriculum/intake.json)
export const intakeItems = schema => ((schema && schema.sections) || []).flatMap(sec => (sec.items || []).map(it => ({ ...it, section: sec.id })));
const blank = v => (Array.isArray(v) ? !v.some(x => String(x ?? '').trim()) : !String(v ?? '').trim());
// show_if { platform: 'other' }: shown while that question has that value
export function visibleItems(schema, answers = {}) {
  return intakeItems(schema).filter(it => !it.show_if || Object.entries(it.show_if).every(([k, v]) => {
    const a = answers[k];
    return Array.isArray(a) ? a.includes(v) : a === v;
  }));
}
// what the form shows for one question: the progress and the parent name come from where they live now
// useDefault false: a question nobody answered stays empty even if the file gives it a default (for counting)
export function answerOf(item, answers = {}, { progress = {}, profile = {} } = {}, { useDefault = true } = {}) {
  const opts = (item.options || []).map(o => o.id);
  if (item.to === 'progress.unit' && progress.unit) return progress.unit;
  if (item.to === 'progress.examDate' && progress.examDate) return progress.examDate;
  if (/progress\.examFrom/.test(item.to || '') && progress.examFrom && progress.examTo) {
    const a = opts.indexOf(progress.examFrom), b = opts.indexOf(progress.examTo);
    if (a >= 0 && b >= 0) return opts.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  if (item.to === 'profile.parentCall' && profile.parentCall) return profile.parentCall;
  const v = answers[item.id];
  if (v !== undefined && v !== null && !blank(v)) return v;
  return useDefault && item.default !== undefined && item.type !== 'text' ? item.default : item.type === 'multi' ? [] : (item.count > 1 ? [] : '');
}
export function intakeFilled(schema, answers = {}, where = {}) {
  const items = visibleItems(schema, answers);
  return { filled: items.filter(it => !blank(answerOf(it, answers, where, { useDefault: false }))).length, total: items.length };
}
// multi: exclusive options clear the others (and the other way round); max_pick drops the oldest
export function pickMulti(item, cur = [], id) {
  const ex = item.exclusive || [];
  let next = cur.includes(id) ? cur.filter(x => x !== id) : ex.includes(id) ? [id] : [...cur.filter(x => !ex.includes(x)), id];
  if (item.max_pick && next.length > item.max_pick) next = next.slice(next.length - item.max_pick);
  return next;
}
// kv writes an answer implies (intake.json "to"): { progress?: patch, profile?: patch }
export function intakeSideEffects(item, value) {
  const to = item.to || '';
  const opts = (item.options || []).map(o => o.id);
  if (to === 'progress.unit') return value && value !== 'unknown' ? { progress: { unit: value } } : {};
  if (to === 'progress.examDate') return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || value === '' ? { progress: { examDate: value || '' } } : {};
  if (/progress\.examFrom/.test(to)) {
    const list = (Array.isArray(value) ? value : []).filter(x => x !== 'unknown').sort((a, b) => opts.indexOf(a) - opts.indexOf(b));
    return { progress: { examFrom: list[0] || '', examTo: list[list.length - 1] || '' } };
  }
  if (to === 'profile.parentCall') return { profile: { parentCall: cleanName(value, 10) } };
  return {};
}
// Restoring a backup merges the learning records: an event already on this iPad (same time, type, lesson and item)
// is not written twice, so the teacher's notebook and the weekly reflection keep both sides.
export const eventKey = ev => `${ev.at}|${ev.type}|${ev.sid || ''}|${ev.item || ev.slug || ''}`;
export function newEvents(local, incoming) {
  const seen = new Set((Array.isArray(local) ? local : []).filter(Boolean).map(eventKey));
  const out = [];
  for (const ev of Array.isArray(incoming) ? incoming : []) {
    if (!ev || typeof ev !== 'object' || !ev.type) continue;
    const k = eventKey(ev);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ev);
  }
  return out;
}
export function yuan(x) {
  const v = Number(x) || 0;
  if (v <= 0) return '0 元';
  if (v < 0.005) return '不到 0.01 元';
  return v.toFixed(2) + ' 元';
}
const capText = c => String(Math.round((Number(c) || 0) * 10) / 10);
export const parentNameOf = profile => cleanName((profile && profile.parentCall) || '', 10) || DEFAULT_PARENT_NAME;

// ---- 复习提纲重点词 (v1, DESIGN 6.4): kv 'outline'
// { version: 1, slugs: [slug], words: [{ slug, w, unit }], at, updated }. slugs follow the textbook order; words keeps
// the spelling and the unit for whoever reads it. Only words of imported textbook units are kept.
export const OUTLINE_KEY = 'outline';
// every textbook word once: normWord(w) -> { slug, w, cn, unit, order, uorder, required }; the first unit it is in wins
export function outlineIndex(curriculum) {
  const idx = new Map();
  let us = [];
  try { us = (curriculum && curriculum.units && curriculum.units()) || []; } catch (e) { us = []; }
  for (const u of us) {
    let ws = [];
    try { ws = curriculum.unitWords(u.id) || []; } catch (e) { ws = []; }
    ws.forEach((x, i) => {
      const w = String((x && x.w) || '').trim();
      const k = normWord(w);
      if (!w || idx.has(k)) return;
      let required = false;
      try { required = !!(curriculum.isRequired && curriculum.isRequired(w)); } catch (e) { required = false; }
      idx.set(k, { slug: slugify(w), w, cn: String(x.cn || ''), unit: u.id, order: i, uorder: u.order ?? 0, required });
    });
  }
  return idx;
}
// pasted text -> English runs: split on lines, commas and Chinese punctuation; the Chinese in between is dropped
export function splitOutline(text) {
  const out = [];
  for (const chunk of String(text || '').split(/[\n\r,，、;；/|]+/)) {
    for (const m of chunk.matchAll(/[A-Za-z][A-Za-z'’ .-]*/g)) {
      const t = m[0].replace(/[\s.-]+$/, '').trim();
      if (t) out.push(t);
    }
  }
  return out;
}
// a run is a word or a phrase as a whole, else the longest phrases first, else single words; forms go back to the base
export function matchOutline(text, idx, baseOf = null) {
  const found = new Map();
  const missing = [];
  const look = t => {
    const k = normWord(t);
    if (idx.has(k)) return idx.get(k);
    if (typeof baseOf === 'function') {
      try { const b = baseOf(k); if (b && idx.has(normWord(b))) return idx.get(normWord(b)); } catch (e) { /* no base */ }
    }
    return null;
  };
  for (const run of splitOutline(text)) {
    const whole = look(run);
    if (whole) { found.set(whole.slug, whole); continue; }
    const parts = normWord(run).split(' ').filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      let n = Math.min(4, parts.length - i);
      let hit = null;
      for (; n >= 1; n--) { hit = look(parts.slice(i, i + n).join(' ')); if (hit) break; }
      if (hit) { found.set(hit.slug, hit); i += n; } else { missing.push(parts[i]); i++; }
    }
  }
  return { matched: [...found.values()], unmatched: [...new Set(missing)] };
}
export const outlineSlugs = rec => (rec && Array.isArray(rec.slugs) ? rec.slugs.filter(s => typeof s === 'string' && s) : []);
export function outlineRecord(prev, slugs, idx, now = new Date()) {
  const bySlug = new Map([...idx.values()].map(x => [x.slug, x]));
  const list = [...new Set(slugs)].map(s => bySlug.get(s)).filter(Boolean)
    .sort((a, b) => a.uorder - b.uorder || a.order - b.order);
  const t = now.toISOString();
  return { version: 1, slugs: list.map(x => x.slug), words: list.map(x => ({ slug: x.slug, w: x.w, unit: x.unit })),
    at: (prev && prev.at) || t, updated: t };
}

// ---------------------------------------------------------------- the view

export function createParentView(ctx) {
  const root = document.getElementById('tab-parent');
  root.replaceChildren();
  const gateBox = h('div', { className: 'parent-gate-box' });
  const settingsBox = h('div', { className: 'parent-settings', hidden: true });
  root.append(gateBox, settingsBox);
  const back = { label: '单词', onClick: () => ctx.go('lib') };

  let unlocked = false;
  let pending = {};
  let me = null;
  let outlineUnit = '';          // the unit shown in the outline panel
  let outlineNote = '';          // what the last paste matched
  let intakeMod = null;          // intake.js, once loaded (written in parallel; optional)
  let captureMod = null;         // ui-capture.js: photoStatus for the 拍课本 row
  optionalModule('./intake.js').then(m => { intakeMod = m; });
  optionalModule('./ui-capture.js').then(m => { captureMod = m; });

  // ---------------------------------------------------------------- kv
  const peek = (k, d) => { const v = ctx.kv.peek(k, d); return v === undefined || v === null ? d : v; };
  const progress = () => peek('progress', {});
  const profile = () => peek('profile', {});
  const intake = () => peek('parent.intake', { version: 1, answers: {} });
  // the intake questions: a public file, fetched once (the service worker caches it with the shell)
  let schema = null;
  let schemaError = '';
  fetch(INTAKE_FILE).then(r => { if (!r.ok) throw new Error(`${INTAKE_FILE} ${r.status}`); return r.json(); })
    .then(d => { schema = d; if (me && unlocked) me.render(); }, e => { schemaError = (e && e.message) || String(e); console.warn('intake:', schemaError); });
  const intakeCount = () => intakeFilled(schema, intake().answers || {}, { progress: progress(), profile: profile() });
  const saveProgress = patch => ctx.kv.set('progress', { ...progress(), ...patch, updated: new Date().toISOString() });
  const saveProfile = patch => ctx.kv.set('profile', { ...profile(), ...patch });
  const units = () => { try { return ctx.curriculum.units() || []; } catch (e) { return []; } };
  const unitTitle = id => ((units().find(u => u.id === id) || {}).title) || id || '';
  const order = id => { try { return ctx.curriculum.unitOrder(id); } catch (e) { return 0; } };
  const save = (p, msg) => p.then(() => { if (msg) toast(msg); }, e => toast('没存上：' + ((e && e.message) || e), 3500));

  // ---------------------------------------------------------------- gate: set the code, enter it, reset it
  const gate = pageShell(ctx, { back });
  gate.barEl.hidden = true;
  gate.el.classList.add('no-bar', 'me-page', 'parent-gate');
  gate.setTitle('家长区', false, 'zh-CN');
  gateBox.append(gate.el);
  let mode = 'enter';   // 'set1' | 'set2' | 'enter' | 'reset'
  let digits = '';
  let first = '';
  let msg = '';
  let wrong = 0;
  let waitUntil = 0;
  let checking = false;
  let shake = false;

  function press(d) {
    if (checking || Date.now() < waitUntil || digits.length >= PIN_LEN) return;
    digits += d;
    msg = '';
    renderGate();
    if (digits.length === PIN_LEN) setTimeout(submit, 120);   // let the fourth dot show
  }
  function del() { if (checking) return; digits = digits.slice(0, -1); renderGate(); }
  function fail(text) { msg = text; digits = ''; shake = true; renderGate(); shake = false; }

  async function submit() {
    const code = digits;
    if (mode === 'set1') {
      if (weakPin(code)) { fail('太好猜了，换一个。别用 1234、0000 这种。'); return; }
      first = code; digits = ''; mode = 'set2'; renderGate(); return;
    }
    if (mode === 'set2') {
      if (code !== first) { mode = 'set1'; first = ''; fail('两次不一样，重新设一次。'); return; }
      checking = true;
      try {
        await ctx.kv.set('parent.pin', await makePin(code));
        toast('数字码设好了');
        unlock();
      } catch (e) { mode = 'set1'; fail('没存上：' + ((e && e.message) || e)); }
      finally { checking = false; }
      return;
    }
    checking = true;
    const ok = await checkPin(peek('parent.pin', null), code).catch(() => false);
    checking = false;
    if (ok) { wrong = 0; unlock(); return; }
    wrong++;
    if (wrong >= MAX_WRONG) {
      wrong = 0;
      waitUntil = Date.now() + WAIT_MS;
      setTimeout(() => { msg = ''; renderGate(); }, WAIT_MS + 50);
      fail('错了 5 次，30 秒后再试。');
      return;
    }
    fail('不对，再试一次。');
  }

  function unlock() {
    unlocked = true;
    digits = ''; first = ''; msg = '';
    openSettings(pending);
    touch();
    window.scrollTo(0, 0);
  }

  // locked again whenever the parent leaves: another page, the app in the background, “交给 Emma”, 5 minutes idle
  let idleTimer = 0;
  function lock() {
    clearTimeout(idleTimer);
    if (!unlocked) return;
    unlocked = false;
    pending = {};
    showGate();
  }
  function touch() {
    clearTimeout(idleTimer);
    if (unlocked) idleTimer = setTimeout(lock, IDLE_MS);
  }
  for (const t of ['pointerdown', 'keydown', 'input', 'wheel']) root.addEventListener(t, touch, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lock(); });

  function resetPanel() {
    const key = ctx.settings().apiKey || '';
    const doReset = async () => {
      await ctx.kv.delete('parent.pin').catch(() => {});
      mode = 'set1'; digits = ''; msg = '';
      toast('数字码清掉了，设一个新的');
      renderGate();
    };
    const cancel = h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { mode = 'enter'; renderGate(); } } });
    // once Emma has the iPad, a reset without the Key would let her in: only the Key's last 4 digits reset the code
    if (!key && (peek('onboard', {}) || {}).handed) {
      return [h('p', { className: 'small', text: '请家长先填 Key 再重设。' }),
        h('p', { className: 'small', text: '已经交给 Emma 了，没有百炼 Key 就不能在这里重设数字码。' }),
        h('div', { className: 'btn-row parent-center' }, cancel)];
    }
    if (!key) {
      return [h('p', { className: 'small', text: '还没填百炼 Key，可以直接重设。' }),
        h('div', { className: 'btn-row parent-center' },
          h('button', { type: 'button', className: 'btn', text: '重设数字码', on: { click: doReset } }),
          h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { mode = 'enter'; renderGate(); } } }))];
    }
    const input = h('input', { type: 'text', className: 'field parent-last4', maxLength: 4, autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', placeholder: '最后 4 位', 'aria-label': '百炼 Key 的最后 4 位' });
    requestAnimationFrame(() => input.focus());
    return [
      h('p', { className: 'small', text: '输入百炼 Key 的最后 4 位，就能重设数字码。Key 在百炼控制台的“API Key”页能看到。' }),
      input,
      h('div', { className: 'btn-row parent-center' },
        h('button', { type: 'button', className: 'btn', text: '重设', on: { click: () => {
          if (input.value.trim() === key.slice(-4)) doReset();
          else { input.value = ''; toast('不对，再看一下 Key 的最后 4 位'); }
        } } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { mode = 'enter'; renderGate(); } } }))];
  }

  function renderGate() {
    const waiting = Date.now() < waitUntil;
    const title = { set1: '设一个 4 位数字码', set2: '再输一次', enter: '输入家长数字码', reset: '忘了数字码' }[mode];
    const sub = mode === 'set1' ? '防止 Emma 误点进来改设置。不是密码，别用银行卡密码。'
      : mode === 'set2' ? '确认一下刚才的 4 位。' : mode === 'enter' ? '这一页给家长用。' : '';
    const kids = [h('h1', { className: 'page-title', text: '家长区' }), h('p', { className: 'parent-gate-title serif', text: title }),
      sub ? h('p', { className: 'small', text: sub }) : null];
    if (mode === 'reset') kids.push(...resetPanel());
    else {
      kids.push(
        h('div', { className: 'parent-dots' + (shake ? ' shake' : ''), 'aria-label': `已输入 ${digits.length} 位`, role: 'img' },
          Array.from({ length: PIN_LEN }, (_, i) => h('span', { className: 'parent-dot' + (i < digits.length ? ' on' : '') }))),
        h('p', { className: 'small parent-msg' + (msg ? ' danger' : ''), role: msg ? 'alert' : null, text: msg || '' }),
        h('div', { className: 'parent-keypad', role: 'group', 'aria-label': '数字键' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => key(d)),
          mode === 'enter' ? h('button', { type: 'button', className: 'parent-key fn', text: '忘了', on: { click: () => { mode = 'reset'; digits = ''; msg = ''; renderGate(); } } })
            : mode === 'set2' ? h('button', { type: 'button', className: 'parent-key fn', text: '重来', on: { click: () => { mode = 'set1'; first = ''; digits = ''; renderGate(); } } })
              : h('span'),
          key('0'),
          h('button', { type: 'button', className: 'parent-key fn', 'aria-label': '删掉一位', on: { click: del } }, icon('back'))));
    }
    gate.body.replaceChildren(h('div', { className: 'parent-gate-inner' + (waiting ? ' waiting' : '') }, ...kids.filter(Boolean)));
    function key(d) { return h('button', { type: 'button', className: 'parent-key num', text: d, disabled: waiting, on: { click: () => press(d) } }); }
  }

  document.addEventListener('keydown', ev => {
    if (unlocked || mode === 'reset' || gateBox.hidden || ctx.currentRoute() !== 'parent') return;
    if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); del(); }
  });

  function showGate() {
    gateBox.hidden = false;
    settingsBox.hidden = true;
    mode = peek('parent.pin', null) ? 'enter' : 'set1';
    digits = ''; first = ''; msg = '';
    renderGate();
  }

  // ---------------------------------------------------------------- 装机清单 (until Emma's first open is done)
  // kv 'onboard'.handed: the first open now goes to Emma's part (ui-onboard.js); until then it asks for the parent
  async function handOver() {
    await ctx.kv.set('onboard', { ...peek('onboard', {}), handed: new Date().toISOString() }).catch(() => {});
    lock();
    ctx.go('onboard');
  }
  function setupGroup(kit) {
    if ((peek('onboard', {}) || {}).done) return null;
    const s = ctx.settings();
    const p = progress();
    const n = intakeCount();
    const hasBook = (() => { try { return ctx.curriculum.hasTextbook(); } catch (e) { return false; } })();
    const items = [
      ['家长数字码', true, '设好了', ''],
      ['百炼 Key', !!s.apiKey, s.apiKey ? '····' + s.apiKey.slice(-4) : '还没填', 'key'],
      ['课本（单元包）', hasBook, hasBook ? `${units().length} 个单元` : '还没导入', 'import'],
      ['课本进度', !!p.unit, p.unit ? unitTitle(p.unit) : '还没设', 'unit'],
      ['期中日期和范围', !!p.examDate, p.examDate ? dateCn(p.examDate) : '还没设', 'exam'],
      ['开机问卷', n.filled > 0, schema ? `填了 ${n.filled} / ${n.total}` : '还没填', 'intake'],
      ['家长称呼', true, parentNameOf(profile()), 'pname'],
    ];
    const rows = items.map(([label, done, value, target]) => h('li', { className: 'srow' + (target ? ' go' : '') },
      h(target ? 'button' : 'div', { type: target ? 'button' : null, className: 'srow-head', on: target ? { click: () => kit.open(target) } : null },
        h('span', { className: 'parent-tick' + (done ? ' on' : '') }, done ? icon('check') : null),
        h('span', { className: 'k' }, h('b', { text: label })), h('span', { className: 'v', text: value }), icon('chev', 'chev' + (target ? '' : ' none')))));
    const missing = [!s.apiKey ? 'Key 还没填，查词先只用离线词典；交给她以后忘了数字码也没法重设' : '', !hasBook ? '课本还没导入，复习里只有她查过的词' : ''].filter(Boolean);
    return h('section', { className: 'sgroup parent-setup' },
      h('h2', { className: 'sec-h', text: '装机清单' }),
      h('p', { className: 'small', text: '这些在 Emma 第一次打开前由家长弄好。点一行就到那一项。' }),
      h('ul', { className: 'rows' }, ...rows),
      missing.length ? h('p', { className: 'small parent-warn', text: missing.join('；') + '。' }) : null,
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '都好了，交给 Emma', on: { click: handOver } })),
      h('p', { className: 'small foot', text: '交给她以后，她会看到老师和她的约定，给老师起名字，定每周目标，然后上第一节课。这一组就不再显示。' }));
  }

  // ---------------------------------------------------------------- 学到哪: the unit and the midterm
  function unitPanel(kit) {
    return () => {
      const list = units();
      if (!list.length) return [h('p', { className: 'small', text: '还没导入课本。先在下面“数据 → 导入文件”里导入单元包。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '去导入', on: { click: () => kit.open('import') } }))];
      const cur = progress().unit || '';
      return [h('p', { className: 'small', text: '她现在课上学到哪个单元。之前的单元进复习，新词从这个单元出。' }),
        h('div', { className: 'choices', role: 'radiogroup', 'aria-label': '课本进度' }, ...list.map(u => h('button', { type: 'button',
          className: 'choice' + (cur === u.id ? ' on' : ''), role: 'radio', 'aria-checked': String(cur === u.id),
          on: { click: () => save(saveProgress({ unit: u.id }), `课本进度：${u.title}`).then(() => kit.render()) } },
        h('span', { className: 'choice-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'choice-main' }, h('span', { className: 'choice-title', text: u.title }), h('span', { className: 'choice-sub', text: `${u.count} 个词` })))))];
    };
  }
  function examPanel(kit) {
    return () => {
      const p = progress();
      const list = units();
      const date = h('input', { type: 'date', className: 'field', value: p.examDate || '', 'aria-label': '期中日期' });
      const pick = (val, label) => {
        const s = h('select', { className: 'select', 'aria-label': label, disabled: !list.length });
        s.append(h('option', { value: '', text: list.length ? '选单元' : '先导入课本' }));
        for (const u of list) s.append(h('option', { value: u.id, text: u.title }));
        s.value = list.some(u => u.id === val) ? val : '';
        return s;
      };
      const from = pick(p.examFrom || (list[0] && list[0].id), '期中范围从');
      const to = pick(p.examTo || p.unit, '期中范围到');
      return [
        h('p', { className: 'small', text: '问老师要期中的日期和范围。考前两周起，范围里的必会词会多练一些。' }),
        h('label', { className: 'parent-label', text: '日期' }), date,
        h('label', { className: 'parent-label', text: '范围' }),
        h('div', { className: 'parent-range' }, from, h('span', { className: 'small', text: '到' }), to),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '保存', on: { click: () => {
            let a = from.value, b = to.value;
            if (a && b && order(a) > order(b)) [a, b] = [b, a];
            save(saveProgress({ examDate: date.value || '', examFrom: a, examTo: b }), '期中日期和范围存好了').then(() => { kit.openRows.delete('exam'); kit.render(); });
          } } }),
          h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { kit.openRows.delete('exam'); kit.render(); } } }),
          p.examDate || p.examFrom ? h('button', { type: 'button', className: 'text-btn danger', text: '清除', on: { click: () =>
            save(saveProgress({ examDate: '', examFrom: '', examTo: '' }), '已清除').then(() => kit.render()) } }) : null)];
    };
  }
  function examValue() {
    const p = progress();
    if (!p.examDate && !p.examFrom) return '还没设';
    const range = p.examFrom && p.examTo ? (p.examFrom === p.examTo ? unitTitle(p.examFrom) : `${unitTitle(p.examFrom)} 到 ${unitTitle(p.examTo)}`) : '';
    return [p.examDate ? dateCn(p.examDate) : '', range].filter(Boolean).join(' · ');
  }
  // ---------------------------------------------------------------- 复习提纲重点词 (v1)
  const outline = () => peek(OUTLINE_KEY, null);
  const outlineValue = () => { const n = outlineSlugs(outline()).length; return n ? `${n} 个` : '还没选'; };
  function outlinePanel(kit) {
    return () => {
      const list = units();
      if (!list.length) return [h('p', { className: 'small', text: '还没导入课本。先在下面“数据 → 导入文件”里导入单元包。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '去导入', on: { click: () => kit.open('import') } }))];
      const idx = outlineIndex(ctx.curriculum);
      const chosen = new Set(outlineSlugs(outline()));
      const p = progress();
      if (!list.some(u => u.id === outlineUnit)) outlineUnit = [p.examTo, p.unit].find(id => list.some(u => u.id === id)) || list[list.length - 1].id;
      const inUnit = [...idx.values()].filter(x => x.unit === outlineUnit).sort((a, b) => a.order - b.order);
      const summary = () => {
        if (!chosen.size) return '还没选。';
        const per = list.map(u => [u, [...idx.values()].filter(x => x.unit === u.id && chosen.has(x.slug)).length]).filter(([, n]) => n);
        return `选了 ${chosen.size} 个：` + per.map(([u, n]) => `${u.title || u.id} ${n}`).join(' · ');
      };
      const sumEl = h('p', { className: 'small parent-outline-sum', text: summary() });
      const store = () => save(ctx.kv.set(OUTLINE_KEY, outlineRecord(outline(), [...chosen], idx))).then(() => {
        sumEl.textContent = summary();
        const v = root.querySelector('[data-row="outline"] .v');
        if (v) v.textContent = outlineValue();
      });
      const wordBtn = x => {
        const b = h('button', { type: 'button', className: 'parent-ow' + (x.required ? ' req' : ''), 'aria-pressed': String(chosen.has(x.slug)) },
          h('span', { className: 'w', lang: 'en', text: x.w }), x.cn ? h('span', { className: 'cn', text: x.cn }) : null);
        b.addEventListener('click', () => {
          if (chosen.has(x.slug)) chosen.delete(x.slug); else chosen.add(x.slug);
          b.setAttribute('aria-pressed', String(chosen.has(x.slug)));
          store();
        });
        return b;
      };
      const grid = h('div', { className: 'parent-ow-grid', role: 'group', 'aria-label': '这个单元的词' }, ...inUnit.map(wordBtn));
      const bulk = on => () => {
        for (const x of inUnit) if (!on) chosen.delete(x.slug); else if (x.required) chosen.add(x.slug);
        store().then(() => kit.render());
      };
      const area = h('textarea', { className: 'parent-area', rows: 3, maxLength: 4000, placeholder: '例如：strict, carry, seldom, look after',
        'aria-label': '粘贴复习提纲上的词', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      const doMatch = () => {
        const text = area.value.trim();
        if (!text) { toast('先粘贴提纲上的词'); return; }
        const r = matchOutline(text, idx, w => { try { return ctx.curriculum.baseOf(w); } catch (e) { return null; } });
        for (const x of r.matched) chosen.add(x.slug);
        outlineNote = `匹配上 ${r.matched.length} 个。` + (r.unmatched.length ? `没找到：${r.unmatched.slice(0, 20).join('、')}${r.unmatched.length > 20 ? ' 等' : ''}（不在已导入的单元里）。` : '');
        store().then(() => kit.render());
      };
      return [
        h('p', { className: 'small', text: '老师的复习提纲或听写本上的重点词。期中前，这些词复习时排在前面，还要练拼写。没选的话，用期中范围最后一个单元的必会词。' }),
        sumEl,
        h('label', { className: 'parent-label', text: '粘贴一串词' }),
        area,
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '自动匹配', on: { click: doMatch } })),
        outlineNote ? h('p', { className: 'small parent-outline-note', role: 'status', text: outlineNote }) : null,
        h('label', { className: 'parent-label', text: '或者从单元里点选' }),
        h('div', { className: 'parent-pills', role: 'radiogroup', 'aria-label': '单元' }, ...list.map(u => h('button', { type: 'button',
          className: 'parent-pill' + (u.id === outlineUnit ? ' on' : ''), role: 'radio', 'aria-checked': String(u.id === outlineUnit), text: u.title || u.id,
          on: { click: () => { outlineUnit = u.id; outlineNote = ''; kit.render(); } } }))),
        h('div', { className: 'btn-row parent-ow-bulk' },
          h('button', { type: 'button', className: 'text-btn accent', text: '选上这个单元的必会词', on: { click: bulk(true) } }),
          h('button', { type: 'button', className: 'text-btn', text: '这个单元都不选', on: { click: bulk(false) } })),
        inUnit.length ? grid : h('p', { className: 'small', text: '这个单元还没有词。' }),
        h('p', { className: 'small parent-q-foot', text: '加粗的是必会词。点一下选上，再点一下去掉，改了马上存。' }),
        chosen.size ? h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn danger', text: '全部清掉', on: { click: () => {
          if (typeof confirm === 'function' && !confirm('清掉选好的全部重点词？')) return;
          chosen.clear();
          outlineNote = '';
          store().then(() => kit.render());
        } } })) : null,
      ].filter(Boolean);
    };
  }

  // ---------------------------------------------------------------- pages other agents draw (v1): 拍课本, 这周小结
  // Leaving for them locks this area like any other page; their back goes to 家长区 again.
  function pageRow(kit, route, label, sub, btn, value = null) {
    if (!ROUTES[route]) return kit.row({ label, sub, value: '下一版', cls: 'parent-off' });
    return kit.row({ label, sub, value, right: h('button', { type: 'button', className: 'text-btn accent', text: btn, on: { click: () => ctx.go(route) } }) });
  }
  const photoValue = () => { try { return captureMod && captureMod.photoStatus ? captureMod.photoStatus(peek('textbook', null)) : null; } catch (e) { return null; } };

  function planGroup(kit) {
    const p = progress();
    return kit.group('学到哪', [
      kit.row({ key: 'unit', label: '课本进度', sub: '从已导入的单元里选', value: p.unit ? unitTitle(p.unit) : '还没设', panel: unitPanel(kit) }),
      kit.row({ key: 'exam', label: '期中', sub: '日期和范围', value: examValue(), panel: examPanel(kit) }),
      kit.row({ key: 'outline', label: '复习提纲重点词', sub: '从课本单元里点选，或粘贴一串词', value: outlineValue(), panel: outlinePanel(kit) }),
      pageRow(kit, 'capture', '拍课本', '拍一页词汇表，识别出来核对后再存。别拍到封面上的名字和班级。', '去拍', photoValue()),
    ]);
  }

  // ---------------------------------------------------------------- 花费
  const kindsText = byKind => Object.entries(byKind || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${KIND_LABEL[k] || k} ${yuan(v).replace(' 元', '')}`).join(' · ');
  function capPanel() {
    const num = h('span', { className: 'num step-n', text: capText(ctx.settings().dailyCapYuan) + ' 元' });
    const step = d => async () => {
      const v = Math.max(0.5, Math.min(10, Math.round(((Number(ctx.settings().dailyCapYuan) || 1.5) + d) * 10) / 10));
      await ctx.saveSettings({ dailyCapYuan: v });
      num.textContent = capText(v) + ' 元';
      const val = root.querySelector('[data-row="cap"] .v');
      if (val) val.textContent = capText(v) + ' 元';
    };
    return [h('p', { className: 'small', text: '每次加减 0.5 元。平常一天大约 0.05 元；上限防的是程序出错一直调用。' }),
      h('div', { className: 'stepper' },
        h('button', { type: 'button', className: 'step', 'aria-label': '减少', on: { click: step(-0.5) } }, icon('minus')), num,
        h('button', { type: 'button', className: 'step', 'aria-label': '增加', on: { click: step(0.5) } }, icon('plus')))];
  }
  function moneyGroup(kit) {
    let t = { total: 0, byKind: {} }, m = { total: 0, byKind: {} };
    try { t = ctx.budget.today(); m = ctx.budget.month(); } catch (e) { /* budget not loaded */ }
    const cap = ctx.settings().dailyCapYuan;
    // Bailian said the key's own budget (set in its console) is used up: no more calls today; 再试 lifts it (budget.js)
    const out = !!(ctx.budget.exhausted && ctx.budget.exhausted());
    return kit.group('花费', [
      out ? kit.row({ label: '百炼说这个 Key 的预算用完了', sub: '今天不再发请求，明天会再试一次。在百炼控制台调了预算以后点“再试”。', cls: 'parent-money danger',
        right: h('button', { type: 'button', className: 'text-btn accent', text: '再试', on: { click: () => { ctx.budget.clearExhausted(); toast('好了，下一次查词会再试'); kit.render(); } } }) }) : null,
      kit.row({ label: '今天', sub: kindsText(t.byKind) || '今天还没花钱', value: yuan(t.total), cls: 'parent-money' }),
      kit.row({ label: '本月', sub: kindsText(m.byKind) || '这个月还没花钱', value: yuan(m.total), cls: 'parent-money' }),
      kit.row({ key: 'cap', label: '每天上限', sub: '到了上限，当天只留离线词典、复习和已经备好的内容', value: capText(cap) + ' 元', panel: capPanel }),
    ], '按每次返回的用量估算，以百炼账单为准。');
  }

  // ---------------------------------------------------------------- 关于 Emma: what she calls you, the intake form
  // the name lives in profile.parentCall; the intake answer parent_call is kept the same
  async function setParentCall(v) {
    const name = cleanName(v, 10);
    await saveProfile({ parentCall: name });
    const rec = intake();
    const now = new Date().toISOString();
    await ctx.kv.set('parent.intake', { version: 1, at: rec.at || now, updated: now, answers: { ...(rec.answers || {}), parent_call: name } });
    return name;
  }
  function namePanel(kit) {
    return () => {
      const cur = parentNameOf(profile());
      const input = h('input', { type: 'text', className: 'field', maxLength: 10, placeholder: '自己写，比如“老妈”', autocomplete: 'off', 'aria-label': '家长称呼' });
      const pick = async v => {
        if (!cleanName(v, 10)) { toast('先写一个称呼'); return; }
        await save(setParentCall(v).then(n => { toast(`Emma 看到的“家长”会写成“${n}”`); }));
        kit.openRows.delete('pname');
        kit.render();
      };
      return [h('p', { className: 'small', text: 'Emma 看到“告诉家长”这类话时，“家长”换成这个称呼。' }),
        h('div', { className: 'choices', role: 'radiogroup', 'aria-label': '家长称呼' }, ...PARENT_NAMES.map(n => h('button', { type: 'button',
          className: 'choice' + (cur === n ? ' on' : ''), role: 'radio', 'aria-checked': String(cur === n), on: { click: () => pick(n) } },
        h('span', { className: 'choice-dot', 'aria-hidden': 'true' }), h('span', { className: 'choice-main' }, h('span', { className: 'choice-title', text: n }))))),
        input,
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '用这个', on: { click: () => pick(input.value) } }))];
    };
  }

  // One question per block. Pills save on tap (and redraw, for show_if and the rows above); text saves when it loses focus.
  function intakePanel(kit) {
    return () => {
      if (!schema) return [h('p', { className: 'small' + (schemaError ? ' danger' : ' dots'),
        text: schemaError ? `问卷没载入（${schemaError}）。连上网后再打开这一行。` : '正在载入问卷' })];
      const rec = intake();
      const answers = { ...(rec.answers || {}) };
      const where = () => ({ progress: progress(), profile: profile() });
      async function store(item, value, redraw = false) {
        answers[item.id] = value;
        const now = new Date().toISOString();
        try {
          await ctx.kv.set('parent.intake', { version: 1, at: rec.at || now, updated: now, answers });
          rec.at = rec.at || now;
          const fx = intakeSideEffects(item, value);
          if (fx.progress) await saveProgress(fx.progress);
          if (fx.profile) await saveProfile(fx.profile);
          toast('存好了', 1200);
        } catch (e) { toast('没存上：' + ((e && e.message) || e), 3500); }
        if (redraw) kit.render();
      }
      const pills = (it, isOn, onTap) => h('div', { className: 'parent-pills', role: it.type === 'multi' ? 'group' : 'radiogroup', 'aria-label': it.label },
        ...(it.options || []).map(o => h('button', { type: 'button', className: 'parent-pill' + (isOn(o.id) ? ' on' : ''),
          role: it.type === 'multi' ? 'checkbox' : 'radio', 'aria-checked': String(isOn(o.id)), text: o.zh, on: { click: () => onTap(o.id) } })));
      function question(it) {
        const cur = answerOf(it, answers, where());
        let ctl;
        if (it.type === 'single') ctl = pills(it, id => cur === id, id => store(it, cur === id ? '' : id, true));
        else if (it.type === 'multi') {
          const arr = Array.isArray(cur) ? cur : [];
          ctl = pills(it, id => arr.includes(id), id => store(it, pickMulti(it, arr, id), true));
        } else if ((it.count || 1) > 1) {
          const vals = Array.from({ length: it.count }, (_, i) => String((Array.isArray(cur) ? cur[i] : '') || ''));
          const ph = i => (Array.isArray(it.placeholder) ? it.placeholder[i] : it.placeholder) || '';
          ctl = h('div', { className: 'parent-three' }, ...vals.map((v, i) => h('input', { type: 'text', className: 'field', maxLength: it.max || 40, value: v,
            placeholder: ph(i), 'aria-label': `${it.label}，第 ${i + 1} 个`, on: { change: ev => { vals[i] = ev.target.value.trim(); store(it, vals.slice()); } } })));
        } else if (it.format === 'date') {
          ctl = h('input', { type: 'date', className: 'field', value: String(cur || ''), 'aria-label': it.label, on: { change: ev => store(it, ev.target.value) } });
        } else if ((it.max || 0) >= 100) {
          ctl = h('textarea', { className: 'parent-area', rows: 3, maxLength: it.max, placeholder: it.placeholder || '', 'aria-label': it.label,
            on: { change: ev => store(it, ev.target.value.trim()) } });
          ctl.value = String(cur || '');
        } else {
          ctl = h('input', { type: 'text', className: 'field', maxLength: it.max || 60, value: String(cur || ''), placeholder: it.placeholder || '', 'aria-label': it.label,
            on: { change: ev => store(it, ev.target.value.trim()) } });
        }
        // what the answer does today: the dictation page's default way (ui-dictation.js reads the same rule)
        let effect = null;
        if (it.to === 'dictation.method' || it.id === 'dictation_way') {
          const m = intakeMethod({ ...rec, answers }, intakeMod);
          effect = h('p', { className: 'small parent-q-effect', text: m ? `“明天有听写”默认用：${METHOD_LABEL[m]}。` : '没选的话，“明天有听写”默认读中文写英文。' });
        } else if (it.id === 'mistakes') effect = reviewEffect();
        return h('div', { className: 'parent-q', dataset: { q: it.id } },
          h('p', { className: 'parent-q-label', text: it.label }), it.help ? h('p', { className: 'small', text: it.help }) : null, ctl, effect);
      }
      const shown = visibleItems(schema, answers);
      const blocks = [];
      for (const sec of schema.sections || []) {
        const items = shown.filter(it => it.section === sec.id);
        if (!items.length) continue;
        blocks.push(h('h3', { className: 'parent-q-sec', text: sec.title }), ...items.map(question));
      }
      return [
        ...(schema.intro || []).map(t => h('p', { className: 'small', text: t })),
        schema.notice ? h('p', { className: 'small parent-warn', text: schema.notice }) : null,
        h('p', { className: 'small', text: '写好一项就存一项，可以分几次填完。回答只存在这台 iPad 里。' }),
        ...blocks,
        rec.updated ? h('p', { className: 'small parent-q-foot', text: '上次改：' + dateCn(rec.updated) }) : null].filter(Boolean);
    };
  }

  // the mistakes answer as intake.js reads it: which words go first into the review, which are not in the textbook
  function reviewEffect() {
    if (!intakeMod || typeof intakeMod.intakeDefaults !== 'function') return null;
    let r = null;
    try {
      const entries = ctx.words && ctx.words.all ? ctx.words.all() : undefined;
      r = (intakeMod.intakeDefaults(ctx.kv, { entries, curriculum: ctx.curriculum }) || {}).review || null;
    } catch (e) { r = null; }
    if (!r) return null;
    const list = (a, n) => a.slice(0, n).join('、') + (a.length > n ? ` 等 ${a.length} 个` : '');
    const words = (r.words || []).filter(x => x && x.from === 'mistakes').map(x => x.w);
    const parts = [words.length ? `先复习：${list(words, 12)}。` : '', (r.outside || []).length ? `不在已导入的课本里：${list(r.outside, 8)}（不进复习）。` : ''].filter(Boolean);
    return parts.length ? h('p', { className: 'small parent-q-effect', text: parts.join('') }) : null;
  }

  function emmaGroup(kit) {
    const n = intakeCount();
    return kit.group('关于 Emma', [
      pageRow(kit, 'weekly', '这周小结', '每周日晚上出：她这周练了什么，可以和她聊什么', '打开'),
      kit.row({ key: 'pname', label: '家长称呼', sub: 'Emma 看到的“家长”二字', value: parentNameOf(profile()), panel: namePanel(kit) }),
      kit.row({ key: 'intake', label: '开机问卷', sub: `约 ${(schema && schema.minutes) || 10} 分钟：她喜欢什么、最近的分数、学校怎么考`,
        value: !schema ? '' : n.filled ? `填了 ${n.filled} / ${n.total}` : '还没填', panel: intakePanel(kit) }),
    ], '问卷是老师认识她的起点。家长的说法先当“待确认”，老师会用她做题的记录慢慢核对。');
  }

  // ---------------------------------------------------------------- 需要留意: lookups that touched a worrying topic
  // ui-look.js logs { type: 'flag', reason: 'care' } and nothing about what she typed; read each time the area opens
  let flags = [];
  function loadFlags() {
    const since = new Date(Date.now() - FLAG_DAYS * 864e5);
    Promise.resolve().then(() => ctx.events.query({ type: 'flag', since, limit: 1e6 })).then(list => {
      flags = (list || []).filter(e => e && e.reason === 'care');
      if (me && unlocked) me.render();
    }, () => {});
  }
  function careGroup(kit) {
    if (!flags.length) return null;
    const last = String(flags[flags.length - 1].at || '').slice(0, 10);
    return kit.group('需要留意', [
      kit.row({ label: `最近 ${FLAG_DAYS} 天 ${flags.length} 次`, sub: '她查词时写到了让人担心的话题（伤害自己、暴力、性、毒品或很难过）。老师没有讲，只请她去找家人聊聊。',
        value: last ? '最近 ' + dateCn(last) : '', cls: 'parent-care' }),
    ], '她写了什么没有存下来。找个轻松的时候问问她。');
  }

  // ---------------------------------------------------------------- backup and import hooks (ui-me.js calls these)
  const localKv = () => { const o = {}; for (const k of ctx.kv.keys('')) o[k] = ctx.kv.peek(k); return o; };
  const localEvents = () => ctx.events.query({ limit: 1e6 }).catch(() => []);
  const hooks = {
    async exportExtra() {
      const kv = exportKv(ctx.kv.keys('').map(k => [k, ctx.kv.peek(k)]));
      let events = [];
      try { events = await ctx.events.query({ limit: 1e6 }); } catch (e) { console.warn('backup events:', (e && e.message) || e); }
      return { kv, events };
    },
    async previewExtra(data) {
      const out = [];
      // the builder's unit packs from a third-party list (source 'textbook-draft'): not for Emma until checked
      if (data && data.source === 'textbook-draft') out.push('这是从第三方资料整理的课本词表草稿，中文还没和课本核对。核对过课本以前，先别给 Emma 用。');
      const plan = planKvImport(localKv(), (data && data.kv) || {});
      if (plan.notes.length) out.push('还会写进：' + plan.notes.join('；') + '。');
      if (plan.kept) out.push('这台 iPad 上已经有的设置保留不动。');
      const evs = Array.isArray(data && data.events) ? data.events : [];
      if (evs.length) {
        const fresh = newEvents(await localEvents(), evs);
        out.push(`学习记录 ${evs.length} 条，合并 ${fresh.length} 条新的。`);
      }
      return out;
    },
    async afterImport(data) {
      const out = [];
      try {
        const plan = planKvImport(localKv(), (data && data.kv) || {});
        for (const [k, v] of Object.entries(plan.writes)) await ctx.kv.set(k, v);
        if (plan.notes.length) out.push('已写进：' + plan.notes.join('；') + '。');
        if (plan.writes.textbook) await ctx.reloadCurriculum();
        if (plan.writes.profile) ctx.applyTheme(accentOf(plan.writes.profile.theme));
        const evs = Array.isArray(data && data.events) ? data.events : [];
        if (evs.length) {
          let c = 0;
          for (const ev of newEvents(await localEvents(), evs)) if (await ctx.events.log(ev)) c++;
          out.push(`学习记录合并了 ${c} 条新的。`);
        }
      } catch (e) {
        out.push('单词导进去了，课本和设置没写全：' + ((e && e.message) || e));
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- the page
  const layout = kit => {
    const name = parentNameOf(profile());
    return [
      h('h1', { className: 'page-title', text: '家长区' }),
      h('p', { className: 'small parent-intro', text: name === DEFAULT_PARENT_NAME ? '这一页给家长用，进来要输数字码。' : `这一页给家长用。Emma 看到的“家长”会写成“${name}”。` }),
      setupGroup(kit),
      careGroup(kit),
      planGroup(kit),
      moneyGroup(kit),
      kit.ai(),
      kit.poe(),
      emmaGroup(kit),
      kit.study(),
      kit.data(),
      kit.advanced(),
      kit.about(),
    ];
  };

  function openSettings(params = {}) {
    gateBox.hidden = true;
    settingsBox.hidden = false;
    if (!me) me = createMeTab(ctx, { root: settingsBox, back, layout, hooks });
    me.show(params || {});
    loadFlags();
  }

  return {
    show(params = {}) {
      pending = params || {};
      if (!unlocked) { showGate(); return; }
      openSettings(pending);
      touch();
    },
    hide: lock,
    onChange() { if (me && unlocked) me.onChange(); },
    holding: () => !!(me && me.holding()),
  };
}
