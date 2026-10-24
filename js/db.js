// IndexedDB "emma" v1 (words, events, kv, notebook...) and "emma-audio" v1 (Qwen voice clips) + import/export.
// Nothing here touches indexedDB at import time, so the pure helpers (merge, export format, gzip) can be tested in Node.
// Store layout and the kv key names: js/CONTRACTS.md.
import { DB_NAME, DB_VERSION, AUDIO_DB_NAME, AUDIO_DB_VERSION, DB_TIMEOUT_MS, LOG_CAP, DEFAULT_SETTINGS, DEFAULT_MODELS, OLD_DEFAULT_MODEL, OLD_DEFAULT_VOICE, POE_DEFAULT_MODELS, POE_ENABLED } from './config.js';
import { fromSM2, newCard } from './fsrs.js';
import { CORE_KEYS } from './prompts.js';

// Deliberately different from Wei's dictionary ("wordcoach-export"): neither app takes the other's files.
export const EXPORT_FORMAT = 'emma-export';

// ---------------------------------------------------------------- IndexedDB with timeouts
// iOS 26 can stall IndexedDB requests forever; every operation gets a timeout, then one retry on a fresh connection.

// Every store the app will need from v0 to v2, created once at version 1 so the version never has to go up
// (DESIGN 10.1, teacher-memory 2.1). Only the missing ones are created.
//   entries   {slug, headword, ...}            words: lookups, the library, textbook words (words.js)
//   zh        {key, query, options, ...}       Chinese -> English cache
//   log       autoIncrement                    lookup log (words.js, capped at LOG_CAP)
//   meta      out-of-line keys                 the dictionary layer's own small values (dailyNew, lastExport)
//   events    autoIncrement, indexes at/type/slug   answer events and the rest (events.js)
//   kv        {key, value, updated}            settings, parent data, line counts, dictation records (CONTRACTS.md)
//   notebook  {id, ...}                        the teacher's notebook and its snapshots (v2)
//   jobs      {id, kind, status, ...}          weekly reflection and other request states (v2)
//   predictions {id, ...}                      per-item predictions (teacher-memory 10)
//   outbox    {id, ...}                        what was sent to a model, shown in the parent area (teacher-memory 9.2)
export const STORES = ['entries', 'zh', 'log', 'meta', 'events', 'kv', 'notebook', 'jobs', 'predictions', 'outbox'];
export function upgradeDB(db) {
  const has = n => db.objectStoreNames.contains(n);
  if (!has('entries')) db.createObjectStore('entries', { keyPath: 'slug' });
  if (!has('zh')) db.createObjectStore('zh', { keyPath: 'key' });
  if (!has('log')) db.createObjectStore('log', { autoIncrement: true });
  if (!has('meta')) db.createObjectStore('meta');
  if (!has('events')) {
    const ev = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
    ev.createIndex('at', 'at');
    ev.createIndex('type', 'type');
    ev.createIndex('slug', 'slug');
  }
  if (!has('kv')) db.createObjectStore('kv', { keyPath: 'key' });
  if (!has('notebook')) db.createObjectStore('notebook', { keyPath: 'id' });
  if (!has('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
  if (!has('predictions')) db.createObjectStore('predictions', { keyPath: 'id', autoIncrement: true });
  if (!has('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
}
// The clip database: {key, voice, text, type, bytes: ArrayBuffer, size, used, at}, with an index for LRU trimming.
export function upgradeAudioDB(db) {
  if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'key' }).createIndex('lru', ['used', 'size']);
}

// One connection per database, opened on first use and reopened after a reset.
function connection(name, version, upgrade) {
  let promise = null;
  // A database already at a higher version (written by a newer build, then rolled back) is opened at the version it
  // has instead of failing with VersionError: the stores this build uses are all still there.
  const attempt = (resolve, reject, withVersion) => {
    const req = withVersion ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); promise = null; };
      db.onclose = () => { promise = null; };
      resolve(db);
    };
    req.onerror = () => {
      const err = req.error;
      if (withVersion && err && err.name === 'VersionError') { attempt(resolve, reject, false); return; }
      promise = null;
      reject(err);
    };
    req.onblocked = () => { promise = null; reject(new Error('数据库被另一个窗口占用了')); };
  };
  return {
    open() {
      if (!promise) promise = new Promise((resolve, reject) => attempt(resolve, reject, true));
      return promise;
    },
    reset() {
      const p = promise;
      promise = null;
      if (p) p.then(db => { try { db.close(); } catch (e) { /* ignore */ } }, () => {});
    },
  };
}
const wordsDB = connection(DB_NAME, DB_VERSION, upgradeDB);
const audioDB = connection(AUDIO_DB_NAME, AUDIO_DB_VERSION, upgradeAudioDB);

export class DBError extends Error {
  constructor(message) { super(message); this.name = 'DBError'; }
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => { onTimeout && onTimeout(); reject(new DBError('timeout')); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}

// fn(stores) queues requests and returns a value or a function to read results after completion.
function runOnce(conn, storeNames, mode, fn, ms) {
  let tx = null;
  const work = conn.open().then(db => new Promise((resolve, reject) => {
    tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries([].concat(storeNames).map(n => [n, tx.objectStore(n)]));
    let out;
    try { out = fn(stores); } catch (e) { try { tx.abort(); } catch (_) { /* ignore */ } reject(e); return; }
    tx.oncomplete = () => resolve(typeof out === 'function' ? out() : out);
    tx.onerror = () => reject(tx.error || new Error('transaction error'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  }));
  return withTimeout(work, ms, () => { try { tx && tx.abort(); } catch (e) { /* ignore */ } });
}

async function runOn(conn, storeNames, mode, fn, ms = DB_TIMEOUT_MS) {
  try {
    return await runOnce(conn, storeNames, mode, fn, ms);
  } catch (e) {
    conn.reset();
    try {
      return await runOnce(conn, storeNames, mode, fn, ms);
    } catch (e2) {
      conn.reset();
      if (e2 instanceof DBError) throw new DBError('本机数据库没有响应（iOS 26 的已知问题）：上滑关掉 App 再打开。');
      throw new DBError('本机数据库出错：' + (e2 && e2.message || e2));
    }
  }
}

const run = (...a) => runOn(wordsDB, ...a);
const runAudio = (...a) => runOn(audioDB, ...a);
const reqResult = req => () => req.result;

export const idbStore = {
  open: () => run('meta', 'readonly', s => reqResult(s.meta.count())),
  loadEntries: () => run('entries', 'readonly', s => reqResult(s.entries.getAll()), DB_TIMEOUT_MS * 3),
  putEntry: e => run('entries', 'readwrite', s => { s.entries.put(e); }),
  putEntries: list => run('entries', 'readwrite', s => { for (const e of list) s.entries.put(e); }, DB_TIMEOUT_MS * 4),
  getZh: key => run('zh', 'readonly', s => reqResult(s.zh.get(key))),
  putZh: z => run('zh', 'readwrite', s => { s.zh.put(z); }),
  putZhMany: list => run('zh', 'readwrite', s => { for (const z of list) s.zh.put(z); }),
  getAllZh: () => run('zh', 'readonly', s => reqResult(s.zh.getAll())),
  countZh: () => run('zh', 'readonly', s => reqResult(s.zh.count())),
  getMeta: key => run('meta', 'readonly', s => reqResult(s.meta.get(key))),
  setMeta: (key, value) => run('meta', 'readwrite', s => { s.meta.put(value, key); }),
  countLog: () => run('log', 'readonly', s => reqResult(s.log.count())),
  // Qwen voice clips (tts.js), in the "emma-audio" database. audioIndex reads keys only (no audio bytes):
  // [[key, used, size], ...]
  getAudio: key => runAudio('audio', 'readonly', s => reqResult(s.audio.get(key))),
  putAudio: rec => runAudio('audio', 'readwrite', s => { s.audio.put(rec); }),
  deleteAudio: keys => runAudio('audio', 'readwrite', s => { for (const k of keys) s.audio.delete(k); }),
  countAudio: () => runAudio('audio', 'readonly', s => reqResult(s.audio.count())),
  audioIndex: () => runAudio('audio', 'readonly', s => {
    const out = [];
    const r = s.audio.index('lru').openKeyCursor();
    r.onsuccess = () => { const c = r.result; if (c) { out.push([c.primaryKey, c.key[0], c.key[1]]); c.continue(); } };
    return () => out;
  }),
  // ---- kv (settings, parent data, counts; key names in CONTRACTS.md). Records are {key, value, updated}.
  kvGet: key => run('kv', 'readonly', s => { const r = s.kv.get(key); return () => (r.result ? r.result.value : undefined); }),
  kvSet: (key, value) => run('kv', 'readwrite', s => { s.kv.put({ key, value, updated: new Date().toISOString() }); }),
  kvDelete: key => run('kv', 'readwrite', s => { s.kv.delete(key); }),
  kvAll: () => run('kv', 'readonly', s => reqResult(s.kv.getAll())),
  // ---- events (events.js owns the record shape). addEvent resolves to the new id.
  addEvent: rec => run('events', 'readwrite', s => reqResult(s.events.add(rec))),
  // [lo, hi] are ISO strings on the "at" index; either may be '' for open ends. Oldest first, at most `limit`.
  eventsBetween: (lo = '', hi = '', limit = 5000) => run('events', 'readonly', s => {
    const range = lo && hi ? IDBKeyRange.bound(lo, hi) : lo ? IDBKeyRange.lowerBound(lo) : hi ? IDBKeyRange.upperBound(hi) : null;
    return reqResult(s.events.index('at').getAll(range, limit));
  }, DB_TIMEOUT_MS * 3),
  eventsBy: (index, value, limit = 5000) => run('events', 'readonly', s => reqResult(s.events.index(index).getAll(value, limit)), DB_TIMEOUT_MS * 3),
  countEvents: () => run('events', 'readonly', s => reqResult(s.events.count())),
  deleteEventsBefore: iso => run('events', 'readwrite', s => {
    const r = s.events.index('at').openCursor(IDBKeyRange.upperBound(iso, true));
    r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } };
  }, DB_TIMEOUT_MS * 3),
  // ---- the other keyPath stores (notebook, jobs, predictions, outbox): plain get / put / all / delete
  get: (name, key) => run(name, 'readonly', s => reqResult(s[name].get(key))),
  put: (name, rec) => run(name, 'readwrite', s => reqResult(s[name].put(rec))),
  all: (name) => run(name, 'readonly', s => reqResult(s[name].getAll()), DB_TIMEOUT_MS * 3),
  del: (name, key) => run(name, 'readwrite', s => { s[name].delete(key); }),
  async addLog(rec) {
    const n = await run('log', 'readwrite', s => { s.log.add(rec); return reqResult(s.log.count()); });
    if (n > LOG_CAP) {
      const extra = n - LOG_CAP;
      await run('log', 'readwrite', s => {
        const r = s.log.getAllKeys(null, extra);
        r.onsuccess = () => { for (const k of r.result) s.log.delete(k); };
      });
    }
  },
};

// ---------------------------------------------------------------- settings (pure)

// Saved settings (kv "settings") -> the settings the app runs with. Returns { settings, migrated }; when migrated is
// true the caller writes settings back. Models (SPEC 2.4): modelsChosen is set once a model is changed in 我的. While
// it is false the profile follows DEFAULT_MODELS, so a later change of the defaults reaches it on the next launch;
// once it is true the saved models are kept. Settings saved before v0.4 have no modelsChosen: there, three
// OLD_DEFAULT_MODEL (qwen-plus, or missing) count as never changed, and any other model as picked by hand.
export function loadSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return { settings: base, migrated: false };
  const keys = Object.keys(DEFAULT_MODELS);
  const stored = saved.models && typeof saved.models === 'object' ? saved.models : {};
  const kept = {};
  for (const k of keys) if (typeof stored[k] === 'string' && stored[k].trim()) kept[k] = stored[k].trim();
  const hasFlag = typeof saved.modelsChosen === 'boolean';
  const chosen = hasFlag ? saved.modelsChosen : !keys.every(k => !kept[k] || kept[k] === OLD_DEFAULT_MODEL);
  const models = chosen ? { ...DEFAULT_MODELS, ...kept } : { ...DEFAULT_MODELS };
  // written back when the models changed, or to record modelsChosen on settings saved before it existed
  const migrated = !hasFlag || keys.some(k => stored[k] !== models[k]);
  // Poe (v0.6): any model slot left empty falls back to the Poe default; an unknown provider reads as Bailian
  const poeSaved = saved.poeModels && typeof saved.poeModels === 'object' ? saved.poeModels : {};
  const poeModels = { ...POE_DEFAULT_MODELS };
  for (const k of keys) if (typeof poeSaved[k] === 'string' && poeSaved[k].trim()) poeModels[k] = poeSaved[k].trim();
  // v0 runs on Bailian only (config POE_ENABLED): a saved 'poe' is read as Bailian until the switch is turned on
  const provider = POE_ENABLED && saved.provider === 'poe' ? 'poe' : 'bailian';
  // voice (v0.1.6): a voice never picked by hand follows DEFAULT_SETTINGS.qwenVoice (Ava since 10-24); the old default
  // Jennifer saved before voiceChosen existed counts as never picked, any other saved voice as picked
  const vHas = typeof saved.voiceChosen === 'boolean';
  const vChosen = vHas ? saved.voiceChosen : (!!saved.qwenVoice && saved.qwenVoice !== OLD_DEFAULT_VOICE);
  const qwenVoice = vChosen && saved.qwenVoice ? saved.qwenVoice : DEFAULT_SETTINGS.qwenVoice;
  const voiceMoved = !vHas || saved.qwenVoice !== qwenVoice;
  return { settings: { ...base, ...saved, modelsChosen: chosen, models, poeModels, provider, qwenVoice, voiceChosen: vChosen }, migrated: migrated || voiceMoved };
}

// ---------------------------------------------------------------- import / export (pure)

const byAt = (a, b) => String(a.at || '').localeCompare(String(b.at || ''));

function unionBy(a, b, keyFn) {
  const seen = new Map();
  for (const x of [...(a || []), ...(b || [])]) {
    if (!x || typeof x !== 'object') continue;
    const k = keyFn(x);
    if (!seen.has(k)) seen.set(k, x);
  }
  return [...seen.values()].sort(byAt);
}
const histKey = h => `${h.at}|${h.query || ''}`;
const reviewKey = r => `${r.at}|${r.mode || ''}`;

// Fill fsrs for an entry that has none: from an old SM-2 srs, or a fresh card if it is favorited.
export function ensureFsrs(e, now = new Date()) {
  if (e.fsrs) return e;
  const conv = fromSM2(e.srs);
  if (conv) e.fsrs = conv;
  else if (e.favorited) e.fsrs = newCard(now);
  return e;
}

const arr = x => (Array.isArray(x) ? x : []);

// Two notes -> one, losing nothing: keep the one that contains the other; else both, newer first.
export function mergeNotes(newerNote, olderNote) {
  const a = String(newerNote || ''), b = String(olderNote || '');
  if (!a || b.includes(a)) return b || a;
  if (!b || a.includes(b)) return a;
  return a + '\n' + b;
}

// Merge one incoming entry into the local one (same slug). Never deletes anything.
export function mergeEntry(local, incoming, now = new Date()) {
  if (!local) {
    const e = structuredCloneSafe(incoming);
    for (const k of ['history', 'reviews']) if (e[k] != null) e[k] = arr(e[k]).filter(x => x && typeof x === 'object');
    return ensureFsrs(e, now);
  }
  const incNewer = String(incoming.updated || '') > String(local.updated || '');
  const [older, newer] = incNewer ? [local, incoming] : [incoming, local];
  const out = { ...older };
  for (const [k, v] of Object.entries(newer)) if (v !== null && v !== undefined) out[k] = v;
  // a placeholder without a core (needs_core, e.g. a textbook word) with a newer `updated` must not wipe an AI core
  if (newer.needs_core && !older.needs_core && Array.isArray(older.senses) && older.senses.length) {
    for (const k of CORE_KEYS) if (older[k] != null) out[k] = older[k];
    out.needs_core = false;
  }
  out.slug = local.slug;
  const created = [local.created, incoming.created].filter(Boolean).map(String).sort();
  if (created.length) out.created = created[0];
  out.history = unionBy(arr(local.history), arr(incoming.history), histKey);
  out.reviews = unionBy(arr(local.reviews), arr(incoming.reviews), reviewKey);
  if (!out.reviews.length && !local.reviews && !incoming.reviews) delete out.reviews;
  const fav = !!(local.favorited || incoming.favorited);
  out.favorited = fav;
  const favAts = [local.favorited_at, incoming.favorited_at].filter(Boolean).sort();
  if (favAts.length) out.favorited_at = favAts[0];
  out.fsrs = local.fsrs || incoming.fsrs || null;
  if (!out.fsrs) delete out.fsrs;
  out.srs = local.srs || incoming.srs;
  if (!out.srs) delete out.srs;
  // an empty note on the newer side must not wipe the other side's note (SPEC 4.3)
  if ('note' in local || 'note' in incoming) out.note = mergeNotes(newer.note, older.note);
  return ensureFsrs(out, now);
}

export function stableJSON(x) {
  if (Array.isArray(x)) return '[' + x.map(stableJSON).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableJSON(x[k])).join(',') + '}';
  }
  return JSON.stringify(x === undefined ? null : x);
}

function structuredCloneSafe(x) {
  return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

export function validateExport(data) {
  if (!data || typeof data !== 'object') throw new Error('文件内容不是 Emma 的英语老师的备份格式。');
  if (data.format !== EXPORT_FORMAT) throw new Error('这不是 Emma 的英语老师的备份文件（缺少 format: emma-export）。');
  if (!Array.isArray(data.entries)) throw new Error('导出文件里没有词条列表。');
  if (data.version > 1) throw new Error(`导出文件版本 ${data.version} 太新了，先更新 App。`);
  return data;
}

// Plan an import against the local data. Returns the entries/zh to write and counts.
export function planImport(localEntries, localZhKeys, data, now = new Date()) {
  validateExport(data);
  const puts = [];
  let added = 0, merged = 0, unchanged = 0, skipped = 0;
  for (const inc of data.entries) {
    if (!inc || typeof inc !== 'object' || !inc.slug || typeof inc.slug !== 'string' || !inc.headword) { skipped++; continue; }
    const local = localEntries.get(inc.slug);
    let next;
    // one malformed record is skipped, it does not block the whole restore
    try { next = mergeEntry(local, inc, now); } catch (e) { skipped++; continue; }
    if (!local) { added++; puts.push(next); continue; }
    if (stableJSON(next) === stableJSON(local)) unchanged++;
    else { merged++; puts.push(next); }
  }
  const zhPuts = [];
  for (const z of Array.isArray(data.zh) ? data.zh : []) {
    if (!z || !z.query || !Array.isArray(z.options)) continue;
    if (z.key && !localZhKeys.has(z.key)) zhPuts.push(z);
  }
  return { puts, zhPuts, counts: { added, merged, unchanged, skipped, zhAdded: zhPuts.length, total: data.entries.length } };
}

// kv (optional): the kv records worth keeping in a backup (CONTRACTS.md "备份"); events and the notebook join later.
export function buildExport({ entries, zh, kv, source = 'ipad', now = new Date() }) {
  const out = { format: EXPORT_FORMAT, version: 1, source, exported_at: now.toISOString(), entries, zh };
  if (kv) out.kv = kv;
  return out;
}

export async function gzipJSON(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Accepts .json or .json.gz bytes (detected by the gzip magic number, not the file name).
export async function parseExportBytes(buf) {
  let bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('这台设备不支持解压 .gz，请用 .json 文件。');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  let text = new TextDecoder().decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON。'); }
  return validateExport(data);
}
