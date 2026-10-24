// Device check page UI (DESIGN.md 10.2). The verdicts and the copied text come from logic.js.
// Rules: no network (CSP connect-src 'self'), no model, no key; storage only in the "emma-check" IndexedDB database
// and "emma-check." localStorage keys. It never opens the app's "emma" database.
import * as L from './logic.js';

// ---------------------------------------------------------------- small helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'text') el.textContent = v;
    else if (k === 'className') el.className = v;
    else if (k === 'hidden') el.hidden = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} ${ms / 1000} 秒没有响应`)), ms))]);
const errText = e => (e && (e.name && e.name !== 'Error' ? e.name + '：' : '') + (e.message || '')) || String(e);
const short = iso => { try { const d = new Date(iso); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } catch (_) { return String(iso); } };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(L.LS + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(L.LS + k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(L.LS + k); } catch (_) {} },
};
// the attributes the app's spelling fields use: no autocorrect, no capitals, no spell check, no autofill
const QUIET = { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' };

// ---------------------------------------------------------------- environment
const ua = L.parseUA(navigator.userAgent, navigator.maxTouchPoints || 0);
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const fromApp = (() => {
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.origin === location.origin && !r.pathname.includes('/check')) sessionStorage.setItem(L.LS + 'fromApp', '1');
    return sessionStorage.getItem(L.LS + 'fromApp') === '1';
  } catch (_) { return false; }
})();
const modeText = standalone ? (fromApp ? '主屏幕 App（从 Emma 的英语老师 的家长区进来）' : '主屏幕 App（“Emma 体检”图标）') : 'Safari 标签页';
function featAtLeast() {
  try {
    if (CSS.supports('anchor-name: --a') || CSS.supports('animation-timeline: scroll()')) return '26';
    if ('cookieStore' in window) return '18.4';
  } catch (_) {}
  return '';
}
let realVersion = null;

// ---------------------------------------------------------------- results and rendering
const results = {};
const HAND = new Set(L.ITEMS.filter(i => i.group === 'hand').map(i => i.key));
const loadedAt = Date.now();
const els = {};

function set(key, status, detail, extra) {
  const prev = results[key] || {};
  results[key] = { status, detail, extra: extra === undefined ? (prev.extra || []) : extra, at: Date.now() };
  paint(key);
  if (HAND.has(key) && status !== 'run') {
    const keep = {};
    for (const k of HAND) if (results[k] && results[k].status !== 'todo') keep[k] = results[k];
    ls.set('results', keep);
  }
}
function paint(key) {
  const e = els[key], r = results[key];
  if (!e || !r) return;
  e.chip.className = 'chip ' + r.status;
  e.chip.textContent = L.STATUS[r.status] || r.status;
  e.detail.textContent = r.detail || '';
  e.extra.textContent = (r.extra || []).join('\n');
  e.extra.hidden = !(r.extra && r.extra.length);
  e.earlier.hidden = !(r.at && r.at < loadedAt);
  if (r.at && r.at < loadedAt) e.earlier.textContent = `这是上次测的结果（${short(r.at)}）。要重测就再做一次`;
  paintSummary();
}
function paintSummary() {
  const c = L.counts(results);
  const box = document.getElementById('summary');
  box.replaceChildren(
    h('span', {}, h('b', { text: String(c.pass) }), ' 项通过'),
    h('span', {}, h('b', { text: String(c.fail) }), ' 项不通过'),
    h('span', {}, h('b', { text: String(c.look) }), ' 项要人看一眼'),
    h('span', {}, h('b', { text: String(c.todo + c.run) }), ' 项没测'),
  );
}
function buildItems() {
  for (const it of L.ITEMS) {
    const chip = h('span', { className: 'chip todo', text: L.STATUS.todo });
    const detail = h('p', { className: 'detail' });
    const extra = h('p', { className: 'extra', hidden: true });
    const earlier = h('p', { className: 'earlier', hidden: true });
    const ctrl = h('div', { className: 'ctrl' });
    const sec = h('section', { className: 'item', id: 'it-' + it.key },
      h('div', { className: 'item-head' }, h('h3', { className: 'item-title', text: it.title }), chip),
      h('p', { className: 'why', text: it.why }), detail, extra, earlier, ctrl);
    document.getElementById(it.group).append(sec);
    els[it.key] = { sec, chip, detail, extra, earlier, ctrl };
    results[it.key] = { status: 'todo', detail: '还没测', extra: [] };
    paint(it.key);
  }
  const saved = ls.get('results', {});
  for (const k of HAND) if (saved[k] && L.STATUS[saved[k].status]) { results[k] = saved[k]; paint(k); }
}
const ask = (key, buttons) => h('div', { className: 'row' }, buttons.map(([label, fn, primary]) => h('button', { type: 'button', className: primary ? 'primary' : '', text: label, on: { click: fn } })));

// ---------------------------------------------------------------- 系统版本
function checkVersion() {
  const v = L.versionVerdict(ua, { atLeast: featAtLeast() }, ls.get('os', ''));
  realVersion = v.version;
  set('version', v.status, v.detail, [`UA：${ua.device} · 系统号 ${ua.os || '无'}${ua.frozen ? '（26 起冻结，不准）' : ''} · Safari ${ua.safari || '无'}`]);
  paintWake();
}
function versionCtrl() {
  const input = h('input', { ...QUIET, className: 'field small', inputmode: 'decimal', placeholder: '比如 26.1', 'aria-label': 'iPadOS 版本' });
  const form = h('div', { className: 'row', hidden: true }, input,
    h('button', { type: 'button', text: '用这个版本', on: { click: () => { ls.set('os', input.value.trim()); checkVersion(); } } }),
    h('button', { type: 'button', className: 'text', text: '清掉', on: { click: () => { ls.del('os'); input.value = ''; checkVersion(); } } }));
  const open = h('button', { type: 'button', className: 'text', text: '版本不对？手动填', on: { click: () => { form.hidden = false; open.hidden = true; input.focus(); } } });
  els.version.ctrl.append(open, form);
  input.value = ls.get('os', '');
  // when the UA cannot tell, the field is open right away
  if (!L.versionVerdict(ua, { atLeast: featAtLeast() }, '').version || input.value) { form.hidden = false; open.hidden = true; }
}

// ---------------------------------------------------------------- 从主屏幕打开
function checkStandalone() {
  if (standalone) set('standalone', 'pass', fromApp ? '从 App 的家长区进来，和 App 用同一个主屏幕窗口；页面正常显示，没有白屏' : '从主屏幕图标打开（独立窗口）；页面正常显示，没有白屏');
  else set('standalone', 'fail', '现在在 Safari 标签页里。照最上面第 1 步从主屏幕打开，结果才准');
}

// ---------------------------------------------------------------- 本机数据库（只开 emma-check）
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(L.DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('bulk')) db.createObjectStore('bulk', { keyPath: 'id' });
    };
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('数据库被占用'));
  });
}
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('写入被中止'));
  });
}
let launches = [];
async function checkIDB() {
  set('idb', 'run', '检测中');
  if (!('indexedDB' in window) || !window.indexedDB) return set('idb', 'fail', '这个系统没有 IndexedDB');
  let db;
  try {
    db = await withTimeout(openDB(), 5000, '打开数据库');
    const now = new Date();
    launches = (await withTimeout(tx(db, 'kv', 'readonly', s => s.get('launches')), 5000, '读取')) || [];
    const first = !results.idb.extra.length;   // count this open once, not on every 重新检测
    if (first || !launches.length) {
      launches.push({ at: now.toISOString(), standalone, online: navigator.onLine });
      launches = launches.slice(-50);
      await withTimeout(tx(db, 'kv', 'readwrite', s => s.put(launches, 'launches')), 5000, '写入');
    }
    const token = Math.random().toString(36).slice(2);
    await withTimeout(tx(db, 'kv', 'readwrite', s => s.put({ token, at: now.toISOString() }, 'probe')), 5000, '写入');
    const back = await withTimeout(tx(db, 'kv', 'readonly', s => s.get('probe')), 5000, '读回');
    // about the size of a real word list: 500 records of about 2 KB
    const filler = 'x'.repeat(2000);
    const t0 = performance.now();
    await withTimeout(tx(db, 'bulk', 'readwrite', s => { s.clear(); for (let i = 0; i < 500; i++) s.put({ id: 'w' + i, w: 'word' + i, body: filler }); }), 20000, '批量写入');
    const t1 = performance.now();
    const n = await withTimeout(tx(db, 'bulk', 'readonly', s => s.count()), 5000, '计数');
    await withTimeout(tx(db, 'bulk', 'readwrite', s => s.clear()), 5000, '清理');
    db.close();
    const ok = back && back.token === token && n === 500;
    const ms = Math.round(t1 - t0);
    const prev = launches.length > 1 ? launches[launches.length - 2] : null;
    const opens = `第 ${launches.length} 次打开本页` + (prev ? `，上次 ${short(prev.at)}：关掉再开数据还在` : '。上滑关掉再打开一次，这里应该变成第 2 次');
    const offline = launches.filter(l => !l.online && l.standalone).length;
    const extra = [opens + (offline ? ` · 断网时打开过 ${offline} 次` : '')];
    if (!ok) return set('idb', 'fail', `写进去读不回来（读回 ${back ? '有' : '无'}，计数 ${n}）`, extra);
    set('idb', ms > 5000 ? 'look' : 'pass', `读写正常 · 写 500 条约 1 MB 用时 ${ms} ms` + (ms > 5000 ? ' · 偏慢' : ''), extra);
  } catch (e) {
    try { if (db) db.close(); } catch (_) {}
    const stall = /没有响应/.test(String(e && e.message));
    set('idb', 'fail', errText(e) + (stall ? ' · iPadOS 26 有数据库卡住的已知问题：上滑关掉本页再开；还卡就重启 iPad' : ''));
  }
}

// ---------------------------------------------------------------- persist() 和配额
async function checkPersist() {
  set('persist', 'run', '检测中');
  const st = navigator.storage;
  let v;
  if (!st || typeof st.persist !== 'function') v = L.persistVerdict({ supported: false });
  else {
    try {
      let persisted = typeof st.persisted === 'function' ? await withTimeout(st.persisted(), 5000, '查询') : false;
      if (!persisted) persisted = await withTimeout(st.persist(), 8000, '申请');
      const e = typeof st.estimate === 'function' ? await withTimeout(st.estimate(), 5000, '配额') : {};
      v = L.persistVerdict({ supported: true, persisted, usage: e.usage, quota: e.quota, standalone });
    } catch (e) { v = L.persistVerdict({ supported: true, error: errText(e) }); }
  }
  set('persist', v.status, v.detail);
}

// ---------------------------------------------------------------- Service Worker
async function checkSW() {
  set('sw', 'run', '检测中');
  if (!('serviceWorker' in navigator)) return set('sw', 'fail', '这个系统没有 Service Worker');
  try {
    const reg = await withTimeout(navigator.serviceWorker.register('./sw.js'), 10000, '注册');
    await withTimeout(navigator.serviceWorker.ready, 10000, '启用');
    // first open: sw.js calls clients.claim(), so control arrives a moment later
    for (let i = 0; i < 15 && !navigator.serviceWorker.controller; i++) await sleep(200);
    let files = 0;
    try { files = (await (await caches.open('emma-check-' + L.CHECK_VERSION)).keys()).length; } catch (_) {}
    const scope = reg.scope.replace(location.origin, '');
    if (navigator.serviceWorker.controller) set('sw', 'pass', `已接管本页，本机存了 ${files} 个文件：断网也能打开 · 作用域 ${scope}`);
    else set('sw', 'todo', `已注册，还没接管（第一次打开属正常）· 上滑关掉本页再打开，这里应该变成通过 · 作用域 ${scope}`);
  } catch (e) { set('sw', 'fail', errText(e)); }
}

// ---------------------------------------------------------------- 屏幕常亮
let lock = null, wakeTried = false, wakeGranted = false, wakeErr = '', wakeConfirm = '';
async function requestWake() {
  wakeTried = true;
  if (!('wakeLock' in navigator)) return paintWake();
  try {
    lock = await navigator.wakeLock.request('screen');
    wakeGranted = true; wakeErr = '';
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { wakeErr = errText(e); }
  paintWake();
}
function paintWake() {
  if (!els.wake || !wakeTried) return;
  const v = L.wakeVerdict({ supported: 'wakeLock' in navigator, ok: wakeGranted, error: wakeErr, version: realVersion, standalone, confirm: wakeConfirm });
  set('wake', v.status, v.detail);
  wakeRetry.hidden = wakeGranted || !('wakeLock' in navigator);
  wakeAsk.hidden = !wakeGranted;
}
const wakeRetry = h('button', { type: 'button', text: '再试一次', hidden: true, on: { click: requestWake } });
const wakeAsk = ask('wake', [['屏幕一直亮着', () => { wakeConfirm = 'on'; paintWake(); }], ['还是黑了', () => { wakeConfirm = 'off'; paintWake(); }]]);
wakeAsk.hidden = true;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeGranted && !lock) requestWake(); });
// some systems only grant the lock after a tap: try again on the first tap anywhere
document.addEventListener('pointerdown', () => { if (wakeTried && !wakeGranted && 'wakeLock' in navigator) requestWake(); }, { once: true });

// ---------------------------------------------------------------- 横竖屏宽度
const seen = {};
function measure() {
  const w = Math.round(window.innerWidth), hh = Math.round(window.innerHeight);
  seen[w > hh ? 'landscape' : 'portrait'] = { w, h: hh };
  const v = L.screenVerdict(seen);
  set('screen', v.status, v.detail);
}
let measureT = 0;
const remeasure = () => { clearTimeout(measureT); measureT = setTimeout(measure, 400); };

// ---------------------------------------------------------------- 拍照（不上传）
function cameraCtrl() {
  // a label around the file input: a real tap on it opens the camera, no scripted click needed
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', className: 'file' });
  const thumb = h('img', { className: 'thumb', alt: '刚拍的照片', hidden: true });
  let url = '', base = '';
  const q = ask('camera', [
    ['直接开了相机', () => { set('camera', 'pass', base + ' · 点按钮直接开了相机'); q.hidden = true; }],
    ['先弹了选择菜单', () => { set('camera', 'pass', base + ' · 点按钮先弹了“拍照 / 照片图库”菜单'); q.hidden = true; }],
  ]);
  q.hidden = true;
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    set('camera', 'run', '正在读照片');
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      base = `拿到照片 ${img.naturalWidth} × ${img.naturalHeight}，${L.fmtBytes(f.size)}，${f.type || '格式不明'}。只在本页显示，不上传`;
      thumb.src = url; thumb.hidden = false;
      set('camera', 'pass', base + ' · 下面选一下点按钮后发生了什么');
      q.hidden = false;
    };
    img.onerror = () => set('camera', 'look', `拿到一个文件（${L.fmtBytes(f.size)}，${f.type || '格式不明'}），但显示不出来`);
    img.src = url;
    input.value = '';
  });
  els.camera.ctrl.append(
    h('div', { className: 'row' }, h('label', { className: 'filebtn' }, input, '拍一张')),
    q, thumb);
}

// ---------------------------------------------------------------- 麦克风（录 3 秒、回放）
const PERM = { granted: '已允许（不会弹框）', prompt: '要问（会弹框）', denied: '已拒绝', asked: '弹了框', silent: '没弹框' };
async function micPermission() {
  try { if (navigator.permissions && navigator.permissions.query) return (await withTimeout(navigator.permissions.query({ name: 'microphone' }), 2000, '权限')).state; } catch (_) {}
  return '';
}
function micCtrl() {
  const btn = h('button', { type: 'button', className: 'primary', text: '录 3 秒' });
  const audio = h('audio', { controls: true, hidden: true, playsinline: true });
  let base = '', extra = [];
  const heard = ask('mic', [
    ['听到了，声音清楚', () => { set('mic', 'pass', base + ' · 回放听到了', extra); heard.hidden = true; }],
    ['没声音 / 听不清', () => { set('mic', 'fail', base + ' · 回放没声音或听不清', extra); heard.hidden = true; }],
  ]);
  heard.hidden = true;
  const popped = ask('mic', [
    ['刚才弹了权限框', () => notePerm('asked')], ['没弹框', () => notePerm('silent')],
  ]);
  popped.hidden = true;
  function notePerm(p) {
    const hist = ls.get('mic', []);
    if (hist.length) { hist[hist.length - 1].perm = p; ls.set('mic', hist); }
    popped.hidden = true;
    extra = permLines(hist);
    set('mic', results.mic.status, results.mic.detail, extra);
  }
  function permLines(hist) {
    const cur = hist[hist.length - 1], prev = hist[hist.length - 2];
    const out = [`这次开始前：${PERM[cur && cur.perm] || '不知道'}`];
    if (prev) out.push(`上次（${short(prev.at)}）开始前：${PERM[prev.perm] || '不知道'}`);
    out.push('隔天再录一次：那时还是“要问”或“弹了框”，说明权限隔天还会弹');
    return out;
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true; heard.hidden = true; popped.hidden = true;
    try {
      const before = await micPermission();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return set('mic', 'fail', '这个系统没有 getUserMedia');
      set('mic', 'run', '正在请求麦克风');
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { return set('mic', 'fail', e && e.name === 'NotAllowedError' ? '麦克风被拒绝了。到“设置 → 隐私与安全性 → 麦克风”或“设置 → Safari → 麦克风”改成允许' : errText(e)); }
      const stopAll = () => stream.getTracks().forEach(t => t.stop());
      if (typeof window.MediaRecorder !== 'function') { stopAll(); return set('mic', 'fail', '麦克风能用，但没有 MediaRecorder，录不了'); }
      const can = m => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } };
      const mime = L.pickMime(can);
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      rec.start();
      for (let n = 3; n > 0; n--) { set('mic', 'run', `录音中，说一句话 · ${n}`); await sleep(1000); }
      rec.stop();
      await withTimeout(stopped, 4000, '停止录音').catch(() => {});
      stopAll();
      const type = rec.mimeType || mime || '';
      const blob = new Blob(chunks, type ? { type } : {});
      if (!blob.size) return set('mic', 'fail', `录到的是空的（格式 ${type || '默认'}）`);
      audio.src = URL.createObjectURL(blob); audio.hidden = false;
      const hist = ls.get('mic', []);
      hist.push({ at: new Date().toISOString(), perm: before });
      ls.set('mic', hist.slice(-10));
      const webm = can('audio/webm;codecs=opus') ? '支持' : '不支持';
      base = `录到 ${L.fmtBytes(blob.size)}，格式 ${type || '默认'} · webm/opus ${webm}`;
      extra = permLines(hist).concat('能录的格式：' + (L.MIME_CANDIDATES.filter(can).join('、') || '都不认'));
      set('mic', 'look', base + ' · 点播放听一下，再选下面一个', extra);
      heard.hidden = false;
      popped.hidden = !!before;   // no Permissions API: ask Wei whether the prompt showed
    } catch (e) { set('mic', 'fail', errText(e)); }
    finally { btn.disabled = false; btn.textContent = '再录一次'; }
  });
  els.mic.ctrl.append(h('div', { className: 'row' }, btn), audio, popped, heard);
}

// ---------------------------------------------------------------- 系统语音
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;
let enVoices = [];
async function loadVoices() {
  if (!('speechSynthesis' in window)) return [];
  let v = speechSynthesis.getVoices();
  for (let i = 0; i < 10 && !v.length; i++) { await sleep(200); v = speechSynthesis.getVoices(); }
  return v.filter(x => /^en[-_]/i.test(x.lang) && !NOVELTY.test(x.name))
    .sort((a, b) => (b.lang === 'en-US') - (a.lang === 'en-US') || (b.name === 'Samantha') - (a.name === 'Samantha'));
}
function ttsCtrl() {
  const sel = h('select', { 'aria-label': '选一个英文语音' });
  const btn = h('button', { type: 'button', className: 'primary', text: '读一句' });
  let who = '';
  const q = ask('tts', [
    ['听到了', () => { set('tts', 'pass', `能出声（${who}）· 英文语音 ${enVoices.length} 个`); q.hidden = true; }],
    ['没声音', () => { set('tts', 'fail', `没听到声音（${who}）。先确认音量和静音，再试一次`); q.hidden = true; }],
  ]);
  q.hidden = true;
  btn.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return set('tts', 'fail', '这个系统没有 speechSynthesis');
    const voice = enVoices.find(v => v.name === sel.value);
    who = voice ? `${voice.name} ${voice.lang}` : '默认语音';
    const u = new SpeechSynthesisUtterance('Hello Emma. Nice to meet you. Ready for today?');
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = 0.9;
    let started = false;
    u.onstart = () => { started = true; set('tts', 'run', `正在读（${who}）`); };
    u.onend = () => { set('tts', 'look', `${who} 读完了。听到了吗？`); q.hidden = false; };
    u.onerror = e => { set('tts', 'fail', `出错：${e.error || '不明'}（${who}）`); q.hidden = false; };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(() => { if (!started) { set('tts', 'look', `4 秒还没开始读（${who}）。听到了吗？没有的话看一下音量和静音`); q.hidden = false; } }, 4000);
  });
  els.tts.ctrl.append(h('div', { className: 'row' }, sel, btn), q);
  loadVoices().then(v => {
    enVoices = v;
    for (const x of v) sel.append(h('option', { value: x.name, text: `${x.name} · ${x.lang}` }));
    sel.hidden = !v.length;
    if (!('speechSynthesis' in window)) set('tts', 'fail', '这个系统没有 speechSynthesis');
    else if (results.tts.status === 'todo') set('tts', 'todo', v.length ? `有 ${v.length} 个英文语音。先把音量调大、关掉静音，点“读一句”` : '没找到英文语音，点“读一句”试试默认语音');
  });
}

// ---------------------------------------------------------------- 键盘联想条
function keyboardCtrl() {
  const K = L.KEYBOARD_WORD;
  const kb = ls.get('kb', { suggest: '', typed: '' });
  const input = h('input', { ...QUIET, className: 'field', 'aria-label': '键盘测试', placeholder: '点这里打字' });
  input.value = kb.typed || '';
  const update = () => {
    kb.typed = input.value;
    ls.set('kb', kb);
    const v = L.keyboardVerdict(kb);
    if (!kb.suggest && !v.auto && !kb.typed) return;
    set('keyboard', v.status, v.detail, kb.typed ? [`输入框里：“${kb.typed}”`] : []);
  };
  input.addEventListener('input', update);
  els.keyboard.ctrl.append(
    h('ol', { className: 'howto' },
      h('li', { text: `点下面的框，慢慢打 ${K.prefix}，看键盘上方那一条（接了外接键盘时在屏幕底部）有没有出现 beautiful 这样的完整单词` }),
      h('li', { text: '选下面一个按钮' }),
      h('li', { text: `清空，再打 ${K.wrong} 按空格，看会不会被改成 ${K.right}（这一步自动判断）` })),
    input,
    ask('keyboard', [
      ['没有候选词', () => { kb.suggest = 'none'; update(); }],
      ['出现了候选词', () => { kb.suggest = 'shown'; update(); }],
      ['清空', () => { input.value = ''; input.focus(); update(); }],
    ]));
}

// ---------------------------------------------------------------- Apple Pencil 随手写
function pencilCtrl() {
  const vals = ls.get('pencil', {});
  const inputs = [], res = [];
  const grid = h('div', { className: 'pen' });
  L.PENCIL_WORDS.forEach((w, i) => {
    const input = h('input', { ...QUIET, className: 'field', 'aria-label': `照着写 ${w.wrong}` });
    input.value = vals[w.wrong] || '';
    const r = h('div', { className: 'res' });
    input.addEventListener('input', update);
    inputs.push(input); res.push(r);
    grid.append(h('div', { className: 'wrong' }, w.wrong, h('small', { text: `故意写错（对的是 ${w.right}）` })), input, r);
  });
  function update() {
    const rows = L.PENCIL_WORDS.map((w, i) => ({ ...w, got: inputs[i].value }));
    for (const r of rows) vals[r.wrong] = r.got;
    ls.set('pencil', vals);
    const v = L.pencilVerdict(rows);
    v.rows.forEach((r, i) => { res[i].className = 'res ' + r.result; res[i].textContent = r.result === 'empty' ? '' : L.WORD_RESULT[r.result]; });
    set('pencil', v.status, v.detail);
  }
  els.pencil.ctrl.append(
    h('ol', { className: 'howto' },
      h('li', { text: '先确认“设置 → Apple Pencil → 随手写”是开着的' }),
      h('li', { text: '用笔直接在每个框里照着写左边这个错的词。一个字母一个字母写清楚，别纠正它' }),
      h('li', { text: '写完一个再写下一个。结果自动判断' })),
    grid,
    h('div', { className: 'row' }, h('button', { type: 'button', className: 'text', text: '没有 Apple Pencil，跳过', on: { click: () => set('pencil', 'skip', '没有 Apple Pencil，没测') } })));
  if (Object.values(vals).some(Boolean)) update();
}

// ---------------------------------------------------------------- 复制结果
function reportNow() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
  const more = [
    `语言 ${navigator.language || '?'} · 时区 ${tz || '?'} · 联网 ${navigator.onLine ? '是' : '否'}`,
    `英文语音 ${enVoices.length} 个：` + (enVoices.slice(0, 10).map(v => `${v.name}(${v.lang})`).join('、') || '无'),
    '打开记录：' + (launches.slice(-5).map(l => `${short(l.at)}${l.standalone ? '' : '（Safari）'}${l.online ? '' : '（断网）'}`).join('、') || '无'),
  ];
  return L.reportText(results, {
    at: L.fmtLocal(new Date()),
    href: location.origin + location.pathname,
    mode: modeText,
    ua: navigator.userAgent,
    screen: `screen ${screen.width} × ${screen.height} @${window.devicePixelRatio || 1}x · 现在窗口 ${window.innerWidth} × ${window.innerHeight}`,
    more,
  });
}
async function copyResult() {
  const text = reportNow();
  const out = document.getElementById('out'), note = document.getElementById('copyNote'), btn = document.getElementById('copy');
  out.value = text; out.hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '已复制';
    note.textContent = '已复制，可以粘贴给 Claude 了。下面是同一段文字。';
  } catch (_) {
    out.focus(); out.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    note.textContent = ok ? '已复制，可以粘贴给 Claude 了。' : '没能自动复制：长按下面的文字，全选后复制。';
  }
  setTimeout(() => { btn.textContent = '复制结果'; }, 2500);
}

// ---------------------------------------------------------------- boot
function runAuto() {
  checkVersion(); checkStandalone(); measure();
  checkIDB(); checkPersist(); checkSW(); requestWake();
}
function boot() {
  buildItems();
  versionCtrl();
  els.wake.ctrl.append(h('div', { className: 'row' }, wakeRetry), wakeAsk);
  cameraCtrl(); micCtrl(); ttsCtrl(); keyboardCtrl(); pencilCtrl();
  if (fromApp) document.getElementById('back').hidden = false;
  document.getElementById('foot').textContent = `体检 v${L.CHECK_VERSION} · ${location.host}${location.pathname}`;
  document.getElementById('copy').addEventListener('click', copyResult);
  document.getElementById('rerun').addEventListener('click', runAuto);
  document.getElementById('clear').addEventListener('click', () => {
    for (const k of ['results', 'kb', 'pencil', 'mic', 'os']) ls.del(k);
    location.reload();
  });
  window.addEventListener('resize', remeasure);
  window.addEventListener('orientationchange', remeasure);

  const mode = document.getElementById('mode');
  if (standalone) {
    mode.hidden = false; mode.className = 'banner ok';
    mode.textContent = fromApp ? '从 Emma 的英语老师 里打开的，和 App 在同一个主屏幕窗口里。' : '已从主屏幕图标打开。';
    runAuto();
    return;
  }
  // In a Safari tab only the light checks run, so nothing slows down Safari's “添加到主屏幕”.
  mode.hidden = false; mode.className = 'banner';
  mode.textContent = '现在在 Safari 标签页里。先照第 1 步从主屏幕打开，结果才准。';
  mode.append(' ', h('button', { type: 'button', className: 'text', text: '仍然在这里测', on: { click: e => { e.target.remove(); checkIDB(); checkPersist(); checkSW(); requestWake(); } } }));
  checkVersion(); checkStandalone(); measure();
  for (const k of ['idb', 'persist', 'sw', 'wake']) set(k, 'todo', '从主屏幕打开后自动测');
}

// a newer sw.js took over (new cache name): reload once so the page matches its files
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
}
boot();
