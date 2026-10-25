// 本机录音（roadmap-gaps 4“读出来”、DESIGN 5.7）：她按住读一句，松开就能回放自己的声音，再和老师的范读对比。
// 录音只存在这台 iPad 上（IndexedDB 单独的库 emma-rec），不上传，留 KEEP_DAYS 天、最多 MAX_CLIPS 段，多了先删最旧的。
// 只有她点了“老师听听”（可选），这一段才交给语音识别（ctx.voiceInput.transcribe，见 wip/b6/gaps-c-needs.md），只标出漏读的词，不打分。
// 负责：读出来（rec.js、ui-readaloud.js、css/readaloud.css、tests/gaps-c.test.mjs）。
//
// 导出
//   DB_NAME = 'emma-rec'、STORE = 'clips'、KEEP_DAYS = 7、MAX_CLIPS = 30、MAX_MS = 20000（一句最长录 20 秒，到了自动停）、MIN_MS = 350
//   pickRecMime(isTypeSupported) -> mime   iPad Safari 先用 audio/mp4（AAC），Chrome 用 webm / opus；都不认返回 ''（交给浏览器默认）
//   keepPlan(clips, now, { days, max }) -> { keep: [clip], drop: [id] }   纯函数：超过 days 天的、超出 max 段的（旧的先删）
//   createClipStore({ indexedDB }) -> Store = { put(clip), get(id), list(), del(id), prune(now) -> 删了几段, clear() }
//     没有 IndexedDB（私密浏览、Node 测试）就存在内存里，关掉页面就没了。clip = { id, at（ISO）, item, en, ms, mime, blob, size }
//   createRecorder({ getUserMedia, MediaRecorder, now, setTimeout, clearTimeout }) -> Recorder
//     Recorder = { supported(), open() -> Promise（要麦克风，第一次会弹框；同一次读出来只要一次）, start() -> Promise, stop() -> Promise<{ blob, mime, ms }>,
//                  cancel(), release()（关麦克风）, state(): 'idle' | 'opening' | 'recording' | 'stopping' }
//     麦克风被拒绝：抛 err.name 'NotAllowedError'，err.kid 是给她看的一句。
//   createRec(ctx, deps?) -> Rec   给 ui-readaloud.js：录音 + 存 + 回放
//     Rec = { supported(), mock(), start(), stop({ item, en }) -> Promise<Clip | null>（太短返回 null）, cancel(), play(clip) -> Promise（放完 resolve）,
//             stopPlay(), release(), prune(), store }
//     模拟模式（?mock=1）不开麦克风：stop 给一段没有声音的假录音（blob null），play 按时长等一下。
//   missedWords(target, heard) -> { missed: [词], ok: bool, matched, total, unsure }   “老师听听”：把识别出来的文字和原句逐词对齐（最长公共子序列），
//     只报原句里没听到的词；don't / do not、two / 2、Mia's / Mia 算一样。对上的不到一半（unsure: true）就不报，说“没听清”，免得冤枉她。
//   REC_COPY：给她看的几句（不提 Key、模型）
// 依赖：无（ctx 只用 settings()、mockForced()）。

export const DB_NAME = 'emma-rec';
export const STORE = 'clips';
export const KEEP_DAYS = 7;
export const MAX_CLIPS = 30;
export const MAX_MS = 20000;
export const MIN_MS = 350;

export const REC_COPY = {
  denied: '麦克风没打开。可以只跟着读出声，读完点“读好了”。',
  nodevice: '这台设备录不了音。可以只跟着读出声。',
  short: '按住按钮再读，读完再松开。',
  failed: '这次没录上，再按住读一次。',
};

export function pickRecMime(isTypeSupported = () => false) {
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (isTypeSupported(m)) return m; } catch (e) { /* next */ }
  }
  return '';
}

const DAY_MS = 86400000;
export function keepPlan(clips = [], now = new Date(), { days = KEEP_DAYS, max = MAX_CLIPS } = {}) {
  const t = (now instanceof Date ? now : new Date(now)).getTime();
  const fresh = [], drop = [];
  for (const c of clips) {
    const at = Date.parse(c && c.at);
    if (!c || !c.id || !Number.isFinite(at) || t - at > days * DAY_MS) { if (c && c.id) drop.push(c.id); continue; }
    fresh.push(c);
  }
  fresh.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const c of fresh.slice(max)) drop.push(c.id);
  return { keep: fresh.slice(0, max), drop };
}

// ---------------------------------------------------------------- where the clips live
function memoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    put: async c => { m.set(c.id, c); return c.id; },
    get: async id => m.get(id) || null,
    list: async () => [...m.values()],
    del: async id => { m.delete(id); },
    clear: async () => { m.clear(); },
  };
}
function idbStore(idb) {
  let dbp = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      }).catch(e => { dbp = null; throw e; });
    }
    return dbp;
  };
  const run = (mode, fn) => open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const st = tx.objectStore(STORE);
    let out;
    const req = fn(st);
    if (req) req.onsuccess = () => { out = req.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
  return {
    kind: 'idb',
    put: c => run('readwrite', st => st.put(c)),
    get: id => run('readonly', st => st.get(id)).then(x => x || null),
    list: () => run('readonly', st => st.getAll()).then(x => x || []),
    del: id => run('readwrite', st => st.delete(id)),
    clear: () => run('readwrite', st => st.clear()),
  };
}
export function createClipStore({ indexedDB: idb = globalThis.indexedDB } = {}) {
  const mem = memoryStore();
  let base = idb && typeof idb.open === 'function' ? idbStore(idb) : mem;
  // private mode / blocked storage: fall back to memory for the rest of this visit
  const guard = name => async (...a) => {
    try { return await base[name](...a); } catch (e) { if (base === mem) throw e; base = mem; return mem[name](...a); }
  };
  const store = { put: guard('put'), get: guard('get'), list: guard('list'), del: guard('del'), clear: guard('clear') };
  store.kind = () => base.kind;
  store.prune = async (now = new Date(), opts = {}) => {
    const { drop } = keepPlan(await store.list(), now, opts);
    for (const id of drop) await store.del(id);
    return drop.length;
  };
  return store;
}

// ---------------------------------------------------------------- the microphone
function denied(e) {
  const x = new Error((e && e.message) || 'mic');
  x.name = 'NotAllowedError';
  x.kid = REC_COPY.denied;
  return x;
}
export function createRecorder(deps = {}) {
  const nav = globalThis.navigator || {};
  const getUserMedia = deps.getUserMedia || (nav.mediaDevices && nav.mediaDevices.getUserMedia ? c => nav.mediaDevices.getUserMedia(c) : null);
  const Recorder = deps.MediaRecorder || globalThis.MediaRecorder || null;
  const now = deps.now || (() => Date.now());
  const later = deps.setTimeout || ((f, ms) => setTimeout(f, ms));
  const cancelLater = deps.clearTimeout || (t => clearTimeout(t));
  let stream = null, opening = null, rec = null, state = 'idle';
  const supported = () => !!(getUserMedia && Recorder);

  async function open() {
    if (stream) return stream;
    if (!supported()) { const e = new Error('nodevice'); e.kid = REC_COPY.nodevice; throw e; }
    if (!opening) {
      state = 'opening';
      opening = getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        .then(s => { stream = s; return s; })
        .catch(e => { throw e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? denied(e) : Object.assign(e || new Error('mic'), { kid: REC_COPY.nodevice }); })
        .finally(() => { opening = null; if (state === 'opening') state = 'idle'; });
    }
    return opening;
  }
  async function start() {
    if (rec) return;
    const s = await open();
    const mime = pickRecMime(m => (Recorder.isTypeSupported ? Recorder.isTypeSupported(m) : false));
    let r;
    try { r = mime ? new Recorder(s, { mimeType: mime }) : new Recorder(s); } catch (e) { r = new Recorder(s); }
    const cur = { r, chunks: [], t0: now(), mime: r.mimeType || mime || 'audio/mp4', done: null, timer: 0 };
    cur.done = new Promise(resolve => { r.onstop = () => resolve(); r.onerror = () => resolve(); });
    r.ondataavailable = ev => { if (ev && ev.data && ev.data.size !== 0) cur.chunks.push(ev.data); };
    rec = cur;
    state = 'recording';
    r.start();
    cur.timer = later(() => { try { if (r.state === 'recording') r.stop(); } catch (e) { /* stopped */ } }, MAX_MS);
  }
  async function stop() {
    const cur = rec;
    if (!cur) return null;
    state = 'stopping';
    cancelLater(cur.timer);
    try { if (cur.r.state !== 'inactive') cur.r.stop(); } catch (e) { /* stopped */ }
    await cur.done;
    rec = null;
    state = 'idle';
    const ms = Math.max(0, now() - cur.t0);
    const Blob0 = globalThis.Blob;
    const blob = cur.chunks.length ? (Blob0 ? new Blob0(cur.chunks, { type: cur.mime }) : cur.chunks[0]) : null;
    return { blob, mime: cur.mime, ms };
  }
  function cancel() {
    const cur = rec;
    rec = null;
    state = 'idle';
    if (!cur) return;
    cancelLater(cur.timer);
    try { if (cur.r.state !== 'inactive') cur.r.stop(); } catch (e) { /* stopped */ }
  }
  function release() {
    cancel();
    try { for (const t of (stream && stream.getTracks ? stream.getTracks() : [])) t.stop(); } catch (e) { /* gone */ }
    stream = null;
  }
  return { supported, open, start, stop, cancel, release, state: () => state };
}

// ---------------------------------------------------------------- record, keep, play back
let seq = 0;
const clipId = t => `c${t.toString(36)}${(++seq).toString(36)}`;
export function createRec(ctx = {}, deps = {}) {
  const settings = () => { try { return (ctx.settings && ctx.settings()) || {}; } catch (e) { return {}; } };
  const mock = () => { try { return !!settings().mock || !!(ctx.mockForced && ctx.mockForced()); } catch (e) { return false; } };
  const now = deps.now || (() => Date.now());
  const recorder = deps.recorder || createRecorder(deps);
  const store = deps.store || createClipStore(deps);
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  let mockT0 = 0, audio = null, url = '', playDone = null;
  let pruned = false;

  async function prune() { try { return await store.prune(new Date(now())); } catch (e) { return 0; } }
  async function start() {
    if (!pruned) { pruned = true; prune(); }
    if (mock()) { mockT0 = now(); return; }
    await recorder.start();
  }
  async function stop({ item = '', en = '' } = {}) {
    let got;
    if (mock()) { if (!mockT0) return null; got = { blob: null, mime: 'audio/mp4', ms: now() - mockT0 }; mockT0 = 0; }
    else got = await recorder.stop();
    if (!got || got.ms < MIN_MS) return null;
    const t = now();
    const clip = { id: clipId(t), at: new Date(t).toISOString(), item: String(item || ''), en: String(en || ''), ms: Math.round(got.ms),
      mime: got.mime || '', blob: got.blob || null, size: (got.blob && got.blob.size) || 0, mock: mock() || undefined };
    if (clip.blob) { try { await store.put(clip); } catch (e) { /* played from memory this time */ } }
    return clip;
  }
  function cancel() { mockT0 = 0; try { recorder.cancel(); } catch (e) { /* fine */ } }
  function stopPlay() {
    try { if (audio) audio.pause(); } catch (e) { /* fine */ }
    if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* fine */ } }
    audio = null; url = '';
    if (playDone) { const f = playDone; playDone = null; f(); }
  }
  function play(clip) {
    stopPlay();
    if (!clip) return Promise.resolve();
    const Audio0 = deps.Audio || globalThis.Audio;
    if (!clip.blob || !Audio0 || typeof URL === 'undefined' || !URL.createObjectURL) return sleep(Math.min(clip.ms || 0, MAX_MS));
    return new Promise(resolve => {
      playDone = resolve;
      url = URL.createObjectURL(clip.blob);
      audio = new Audio0(url);
      const end = () => { if (playDone === resolve) stopPlay(); };
      audio.onended = end;
      audio.onerror = end;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(end);
    });
  }
  function release() { stopPlay(); cancel(); try { recorder.release(); } catch (e) { /* fine */ } }
  return {
    supported: () => mock() || recorder.supported(),
    mock, start, stop, cancel, play, stopPlay, release, prune, store,
    open: () => (mock() ? Promise.resolve() : recorder.open()),
  };
}

// ---------------------------------------------------------------- 老师听听: which words of the sentence were not heard
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function wordsOf(text) {
  const s = String(text || '').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\bcan't\b/g, 'can not').replace(/\bwon't\b/g, 'will not').replace(/n't\b/g, ' not')
    .replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'ll\b/g, ' will').replace(/'ve\b/g, ' have').replace(/'d\b/g, ' would')
    .replace(/'s\b/g, '').replace(/s'(?=\s|$)/g, 's').replace(/\bcannot\b/g, 'can not');
  return (s.match(/[a-z]+|\d+/g) || []).map(w => (/^\d+$/.test(w) && Number(w) <= 20 ? NUM[Number(w)] : w));
}
// the words as written (Don't, Mia's) with the pieces wordsOf makes from each, so a missed piece reports the written word
function writtenPieces(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d+/g)) for (const p of wordsOf(m[0])) out.push({ p, w: m[0] });
  return out;
}
export function missedWords(target, heard) {
  const t = writtenPieces(target);
  const h = wordsOf(heard);
  const n = t.length, m = h.length;
  if (!n) return { missed: [], ok: true, matched: 0, total: 0, unsure: false };
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = t[i].p === h[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (t[i].p === h[j]) { hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const matched = hit.filter(Boolean).length;
  const unsure = matched < Math.ceil(n / 2);
  const missed = [];
  if (!unsure) for (let i = 0; i < n; i++) if (!hit[i] && !missed.includes(t[i].w)) missed.push(t[i].w);
  return { missed, ok: !unsure && !missed.length, matched, total: n, unsure };
}
