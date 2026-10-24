// 拍课本（DESIGN 6.2，v1）：家长在家长区拍一页课本（目录页或单元词汇表页），前端缩图转 JPEG，百炼 qwen3.8-flash
// 看图按固定 JSON 回答，进确认页逐行核对后，写进课本数据。和导入单元包同一条路（CONTRACTS 5.2、5.3）：
// 词条经 words.importData（emma-export 形状，带 unit、order、unit_title、unit_order、tier、required、source），
// 单元表写 kv 'textbook'，再 ctx.reloadCurriculum()。照片只在内存里，确认或放弃以后丢掉，不存进任何地方。
// 负责：拍课本 agent（capture.js、ui-capture.js、css/capture.css、tests/capture.test.mjs）。
//
// 导出
//   CAPTURE_MODEL 'qwen3.8-flash'；MAX_SIDE 1600；JPEG_QUALITY 0.8；TIMEOUT_MS；PAGE_TYPES、PAGE_LABEL
//   fitSize(w, h, max) -> { width, height }          长边缩到 max 以内，不放大
//   imageToJpeg(file, { maxSide, quality }) -> Promise<{ dataUrl, width, height, bytes }>   浏览器才能用
//   SYSTEM_PROMPT、userPrompt({ units })             固定 JSON 的提示词
//   visionBody(model, dataUrl, text) -> body          OpenAI 兼容 chat/completions：image_url 是 data:image/jpeg;base64，
//                                                     开 JSON 模式，enable_thinking: false
//   unitIdOf(x) -> 'S' | 'U3' | null                   0 / 'Starter' / 'Unit 3' / 'U3' / 3 都认
//   unitTitleOf(id, title) -> 'Unit 3 Family ties'
//   normalizeResult(raw) -> CaptureResult             模型回的 JSON 收成固定形状（容错：键名、大小写、重复词）
//     CaptureResult = { pageType: 'toc'|'vocab'|'grammar'|'other', unit: { id, title } | null,
//                       units: [{ id, title, order }], words: [{ w, pos, cn, unclear }] }
//   mockResult(kind) -> 模型回的那种 JSON（模拟模式用，假的，和课本无关）；kind 'vocab'（默认）或 'toc'
//   recognize({ dataUrl, settings, budget, fetchImpl, signal, sleep, timeoutMs, units, mockKind }) ->
//     Promise<{ result, model, usage, yuan, mock }>   一次识别；错误抛 ai.js 的 AIError（code 同 CONTRACTS 9.9）
//   tierOfWord(word, curriculum) -> 'primary' | 'required' | 'recognize' | null
//   tierText(word, curriculum) -> '小学词' | '课标词 · 要会写' | '超纲 · 只要认得' | ''
//   planVocab({ rows, unitId, unitTitle, textbook, curriculum, getEntry, now }) -> Plan   纯函数，确认页“存”之前算好
//   planToc({ rows, textbook, now }) -> Plan
//     Plan = { kind, unit?, textbook, data?（emma-export，只有 vocab 有）, counts }
//   saveCapture(ctx, plan, { dryRun }) -> Promise<counts>   写词条、kv 'textbook'，重载课标；dryRun（模拟模式）什么都不写
//
// 记账：ai.js 的 askJSON 只收文字，所以这里自己发请求（Key 从 settings.apiKey 取）。花费类别 'photo'：
//   发之前 budget.blockReason('photo')，回来按 usage budget.record(usage, 'photo', model)，百炼“预算用完”的 429
//   budget.markExhausted()，不重试。budget.wrapFetch 只给 TTS 记账，这里用不上。
// 写进数据的新字段（都不破坏老数据）：
//   kv 'textbook'.units[i].words[j] 多 pos、source: 'photo'、cn_source: 'photo'；units[i] 多 source: 'photo'、photoAt、pages；
//   kv 'textbook' 多 photoAt、toc: [{ id, title, order }]（拍过目录页才有）
//   词条多 book_pos（书上的词性），source: 'photo'，history 里那条 { at, query, source: 'photo' }
import { API_URL } from './config.js';
import { AIError, parseJSON } from './ai.js';
import { isBudgetExhausted } from './budget.js';
import { normWord, defaultUnitOrder } from './curriculum.js';
import { slugify, localIso } from './words.js';
import { EXPORT_FORMAT } from './db.js';

export const CAPTURE_MODEL = 'qwen3.8-flash';
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.8;
export const TIMEOUT_MS = 90000;
export const RETRY_DELAYS = [2000];
export const MAX_WORDS = 150;
export const PAGE_TYPES = ['toc', 'vocab', 'grammar', 'other'];
export const PAGE_LABEL = { toc: '目录', vocab: '单元词汇表', grammar: '语法页', other: '其他' };
export const SOURCE = 'photo';

const sleepMs = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- the photo

export function fitSize(w, h, max = MAX_SIDE) {
  w = Math.max(0, Math.round(Number(w) || 0)); h = Math.max(0, Math.round(Number(h) || 0));
  if (!w || !h) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// <img> first: Safari draws it with the photo's EXIF rotation applied; createImageBitmap only as a fallback.
async function decodeImage(file) {
  if (typeof Image === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      if (img.decode) await img.decode();
      else await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); });
      if (img.naturalWidth && img.naturalHeight) return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch (e) { /* try the other way */ }
    URL.revokeObjectURL(url);
  }
  if (typeof createImageBitmap === 'function') {
    const bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { src: bm, w: bm.width, h: bm.height, done: () => { if (bm.close) bm.close(); } };
  }
  throw new Error('这台设备读不了这张照片');
}

export async function imageToJpeg(file, { maxSide = MAX_SIDE, quality = JPEG_QUALITY } = {}) {
  let d = null;
  try { d = await decodeImage(file); } catch (e) { throw new Error('这张照片打不开，换一张再试。'); }
  try {
    const { width, height } = fitSize(d.w, d.h, maxSide);
    if (!width) throw new Error('这张照片打不开，换一张再试。');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(d.src, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    canvas.width = 0; canvas.height = 0;   // iOS keeps canvas memory until the size drops
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return { dataUrl, width, height, bytes: Math.round(b64.length * 3 / 4) };
  } finally { if (d && d.done) d.done(); }
}

// ---------------------------------------------------------------- the prompt (fixed JSON)

export const SYSTEM_PROMPT = `你帮家长把一页初一英语课本（外研版七年级）的照片抄成数据。只看照片，只抄书上印着的字。
先判断这一页是什么：
- "toc"：目录页（列出 Starter、Unit 1、Unit 2……和各单元的标题）
- "vocab"：单元词汇表页（一个个英文词或短语，后面跟词性和中文）
- "grammar"：语法页
- "other"：别的页
只回一个 JSON 对象，形状固定：
{
  "page_type": "toc" | "vocab" | "grammar" | "other",
  "unit": {"number": 3, "title": "单元标题"} 或 null,
  "units": [{"number": 0, "title": "Starter 后面的标题"}, {"number": 1, "title": "单元标题"}],
  "words": [{"en": "英文词或短语", "pos": "adj.", "cn": "书上的中文", "unclear": false}]
}
规则：
- unit：词汇表页和语法页属于哪个单元。Starter 的 number 是 0。看不出来就写 null。title 不带“Unit 3”这几个字。
- units：只有目录页才填，按书上的顺序；别的页给空数组。
- words：只有词汇表页才填，按书上的顺序，一个词一项；别的页给空数组。
- en 照书上的拼写和大小写抄，短语整个抄（比如 in fact）。不写音标。
- pos 照书上的缩写抄（n. v. adj. adv. prep. pron. conj. num. art. interj.）；书上没写就给空字符串。
- cn 照书上的中文原样抄，几个意思之间的分号也照抄。不要自己翻译，不要补书上没有的意思。
- 看不清、拍糊、被挡住、被切掉一半的那一项：能看到多少写多少，unclear 写 true。没把握的字母不要猜。
- 不要输出 JSON 以外的任何文字。`;

export function userPrompt({ units = [] } = {}) {
  const known = (units || []).filter(u => u && u.id).map(u => u.title || u.id);
  return ['把这一页课本照片抄成上面那种 JSON。',
    known.length ? `这本书已经知道的单元：${known.join('；')}。` : ''].filter(Boolean).join('\n');
}

export function visionBody(model, dataUrl, text) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text }] },
    ],
    response_format: { type: 'json_object' },
    enable_thinking: false,
  };
}

// ---------------------------------------------------------------- what the model said -> one fixed shape

const ONE_LINE = s => String(s ?? '').replace(/[\u0000-\u001f​-‍⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();

export function unitIdOf(x) {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'object') return unitIdOf(x.number ?? x.id ?? x.unit ?? null);
  if (typeof x === 'number') return Number.isInteger(x) && x >= 0 && x < 40 ? (x === 0 ? 'S' : 'U' + x) : null;
  const s = ONE_LINE(x).toLowerCase();
  if (/^(s|starter)\b/.test(s)) return 'S';
  const m = s.match(/^(?:u|unit|module|m)?\s*(\d{1,2})$/) || s.match(/^(?:unit|u)\s*(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 0 ? 'S' : n < 40 ? 'U' + n : null;
}

// 'U3' + 'Family ties' -> 'Unit 3 Family ties'; a title that already starts with the unit name is kept as it is
export function unitTitleOf(id, title = '') {
  const base = id === 'S' ? 'Starter' : /^U\d+$/.test(String(id)) ? 'Unit ' + String(id).slice(1) : String(id || '');
  const t = ONE_LINE(title).replace(/^["“”']+|["“”']+$/g, '');
  if (!t) return base;
  if (t.toLowerCase().startsWith(base.toLowerCase())) return t;
  return base + ' ' + t;
}

function pageTypeOf(v, words, units) {
  const s = ONE_LINE(v).toLowerCase();
  if (/^(toc|contents?|table of contents|目录)/.test(s)) return 'toc';
  if (/^(vocab|vocabulary|word ?list|words|单元词汇|词汇|单词表)/.test(s)) return 'vocab';
  if (/^(grammar|语法)/.test(s)) return 'grammar';
  if (/^(other|其他|别的)/.test(s)) return 'other';
  if (words.length) return 'vocab';
  if (units.length) return 'toc';
  return 'other';
}

const truthy = v => v === true || v === 1 || /^(true|yes|1|是)$/i.test(String(v ?? '').trim());
// a word with a ? or a placeholder in it is something the model could not read
const looksUnclear = w => /[?？□■_…]|\.\.\./.test(w);
export const cleanWord = w => ONE_LINE(w).replace(/[’‘`]/g, "'").replace(/^[\d.\s、]+(?=[A-Za-z])/, '').replace(/[,;，；。]+$/, '');
const cleanPos = p => ONE_LINE(p).replace(/[（(]|[)）]/g, '').slice(0, 24);
const cleanCn = c => ONE_LINE(c).slice(0, 80);

export function normalizeResult(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const list = [o.words, o.vocabulary, o.items, o.entries].find(Array.isArray) || [];
  const words = [];
  const seen = new Set();
  for (const x of list) {
    if (words.length >= MAX_WORDS) break;
    const item = typeof x === 'string' ? { en: x } : x && typeof x === 'object' ? x : null;
    if (!item) continue;
    const w = cleanWord(item.en ?? item.word ?? item.w ?? item.english ?? '');
    const cn = cleanCn(item.cn ?? item.zh ?? item.chinese ?? item.meaning ?? '');
    if (!w && !cn) continue;
    const k = normWord(w);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    words.push({ w, pos: cleanPos(item.pos ?? item.part_of_speech ?? ''), cn, unclear: !w || truthy(item.unclear ?? item.uncertain ?? item.blurry) || looksUnclear(w) || !/[A-Za-z]/.test(w) });
  }
  const unitsIn = [o.units, o.contents, o.toc].find(Array.isArray) || [];
  const units = [];
  for (const u of unitsIn) {
    const id = unitIdOf(u && typeof u === 'object' ? (u.number ?? u.id ?? u.unit ?? u.name) : u);
    if (!id || units.some(x => x.id === id)) continue;
    const t = u && typeof u === 'object' ? (u.title ?? u.name ?? '') : '';
    units.push({ id, title: unitTitleOf(id, typeof t === 'string' ? t : ''), order: defaultUnitOrder(id) });
  }
  units.sort((a, b) => a.order - b.order);
  let unit = null;
  const u = o.unit;
  const uid = unitIdOf(u && typeof u === 'object' ? (u.number ?? u.id ?? null) : u);
  if (uid) unit = { id: uid, title: unitTitleOf(uid, u && typeof u === 'object' && typeof u.title === 'string' ? u.title : '') };
  return { pageType: pageTypeOf(o.page_type ?? o.pageType ?? o.type, words, units), unit, units, words };
}

// Mock mode: a made-up vocabulary page (everyday primary-school words, nothing from the textbook), one unclear row;
// kind 'toc': a made-up contents page.
export function mockResult(kind = 'vocab') {
  if (kind === 'toc') {
    return { page_type: 'toc', unit: null, words: [], units: [{ number: 0, title: '' }, { number: 1, title: 'My new school' },
      { number: 2, title: 'Fun time' }, { number: 3, title: 'My family' }, { number: 4, title: '模拟单元' }] };
  }
  return {
    page_type: 'vocab',
    unit: { number: 9, title: '模拟单元' },
    units: [],
    words: [
      { en: 'desk', pos: 'n.', cn: '书桌', unclear: false },
      { en: 'ruler', pos: 'n.', cn: '尺子', unclear: false },
      { en: 'quiet', pos: 'adj.', cn: '安静的', unclear: false },
      { en: 'pencil box', pos: '', cn: '铅笔盒', unclear: false },
      { en: 'win?ow', pos: 'n.', cn: '窗户', unclear: true },
      { en: 'often', pos: 'adv.', cn: '经常', unclear: false },
    ],
  };
}

// ---------------------------------------------------------------- one recognition request

const keyOk = k => /^[\x21-\x7e]+$/.test(k);
const errText = data => {
  const e = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error : data) : {};
  return { code: String(e.code || e.type || ''), message: String(e.message || '').slice(0, 200) };
};
class Retry extends Error {}

function httpFail(status, data, model) {
  const { code, message } = errText(data);
  const blob = (code + ' ' + message).toLowerCase();
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalidapikey')) return new AIError('百炼 API Key 不对或已失效：在家长区的“Key”里重新填。', 'badkey');
  if (blob.includes('arrearage') || blob.includes('overdue') || blob.includes('good standing')) return new AIError('百炼账户欠费或预算用完了，去百炼控制台看一下。', 'billing');
  if (blob.includes('data_inspection') || blob.includes('datainspection')) return new AIError('照片没通过百炼的安全检查。换个角度只拍词表，再试一次。', 'inspection');
  if (blob.includes('model_not_found') || blob.includes('not exist') || blob.includes('not found')) return new AIError(`模型“${model}”用不了：这个 Key 可能没开通它。`, 'model');
  if (status === 400 && /image|url|vision|multimodal|picture/.test(blob)) return new AIError(`模型“${model}”没收下这张照片（${message || code || '400'}）。重拍一张试试。`, 'model');
  if (status === 403) return new AIError(`百炼拒绝了请求（403）：${message || code || '没有权限'}。检查 Key 的模型权限和预算上限。`, 'forbidden');
  return new AIError(`百炼返回 ${status}：${message || code || '没有详情'}`, 'http');
}

export async function recognize({ dataUrl, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs,
  timeoutMs = TIMEOUT_MS, units = [], model = CAPTURE_MODEL, mockKind = 'vocab' } = {}) {
  const s = settings || {};
  if (signal && signal.aborted) throw new AIError('已取消', 'abort');
  if (s.mock) {
    await sleep(900);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上百炼：网络不通（模拟断网）。', 'network');
    return { result: normalizeResult(mockResult(mockKind)), model, usage: null, yuan: 0, mock: true };
  }
  const key = String(s.apiKey || '');
  if (!key) throw new AIError('还没填百炼 API Key：先在家长区上面的“Key”里填好，再来拍。', 'nokey');
  if (!keyOk(key)) throw new AIError('百炼 API Key 格式不对：在家长区的“Key”里重新粘贴。', 'badkey');
  if (!dataUrl || !/^data:image\/jpeg;base64,/.test(dataUrl)) throw new AIError('照片还没准备好，再拍一次。', 'empty');
  const why = budget && budget.blockReason ? budget.blockReason('photo') : '';
  if (why === 'month') throw new AIError('今天已经收到过百炼的“预算用完”（429），App 今天不再发请求。到百炼控制台调好预算后，在家长区点“再试”。', 'budget');
  if (why) throw new AIError('今天的花费到了 App 里设的上限，明天再拍，或者在家长区调高上限。', 'budget-day');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const body = JSON.stringify(visionBody(model, dataUrl, userPrompt({ units })));

  async function once() {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res, data;
    try {
      res = await doFetch(API_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
      data = await res.json().catch(() => null);
    } catch (e) {
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
      if (timedOut) throw new AIError(`百炼 ${Math.round(timeoutMs / 1000)} 秒没回，网络可能太慢。再试一次。`, 'timeout');
      throw new Retry('network');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (!res.ok) {
      if (res.status === 429 && isBudgetExhausted(429, data)) {
        if (budget && budget.markExhausted) { try { budget.markExhausted(); } catch (e) { /* bookkeeping only */ } }
        throw new AIError('百炼返回 429：这个 Key 的月预算用完了。到百炼控制台调预算，或者等下个月。', 'budget');
      }
      if (res.status === 429) throw new Retry('429');
      if (res.status >= 500) throw new Retry('5xx:' + res.status);
      throw httpFail(res.status, data, model);
    }
    let yuan = 0;
    const usage = (data && data.usage) || null;
    if (usage && budget && budget.record) { try { yuan = budget.record(usage, 'photo', model) || 0; } catch (e) { /* never fails a call */ } }
    const choice = data && data.choices && data.choices[0];
    if (choice && choice.finish_reason === 'length') throw new AIError('这一页的字太多，回答被截断了。靠近一点，分两次拍上半页和下半页。', 'truncated');
    const content = String((choice && choice.message && choice.message.content) || '').trim();
    if (!content) throw new Retry('empty');
    let obj;
    try { obj = parseJSON(content); } catch (e) { throw new Retry('json'); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Retry('json');
    return { result: normalizeResult(obj), model, usage, yuan, mock: false };
  }

  let last = null;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try { return await once(); } catch (e) {
      if (!(e instanceof Retry)) throw e;
      last = e;
      if (e.message === 'network' && globalThis.navigator && navigator.onLine === false) break;
      if (i < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[i]);
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    }
  }
  const m = last ? last.message : '';
  if (m === '429') throw new AIError('百炼限流了（请求太频繁），稍等一会儿再拍。', 'ratelimit');
  if (m.startsWith('5xx:')) throw new AIError(`百炼服务出错（${m.slice(4)}），稍后再试。`, 'server');
  if (m === 'empty') throw new AIError('百炼返回了空内容，再拍一次。', 'empty');
  if (m === 'json') throw new AIError('识别结果不完整，再拍一次。', 'incomplete');
  throw new AIError('连不上百炼：网络不通，或者请求被拦截了（开着 VPN 可以关掉再试）。', 'network');
}

// ---------------------------------------------------------------- the confirm page -> what gets written

export function tierOfWord(word, curriculum) {
  if (!curriculum || typeof curriculum.isRequired !== 'function') return null;
  try {
    if (curriculum.isPrimary && curriculum.isPrimary(word)) return 'primary';
    return curriculum.isRequired(word) ? 'required' : 'recognize';
  } catch (e) { return null; }
}
export function tierText(word, curriculum) {
  const t = tierOfWord(word, curriculum);
  return t === 'primary' ? '小学词' : t === 'required' ? '课标词 · 要会写' : t === 'recognize' ? '超纲 · 只要认得' : '';
}

const cloneJSON = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const isPhrase = w => /\s/.test(normWord(w));
// rows the confirm page keeps: not deleted, has an English word, and nothing still marked unclear
export const keptRows = rows => (rows || []).filter(r => r && !r.deleted && normWord(cleanWord(r.w)) && !r.unclear);

// rows: [{ w, pos, cn, unclear, deleted }] from the confirm page. textbook: kv 'textbook' now (or null).
// getEntry(slug) -> the local entry or undefined (counts only). Words already in this unit are updated in place,
// new ones go to the end; words this page moves here leave the other units' draft lists (a photo beats the draft).
export function planVocab({ rows, unitId, unitTitle = '', textbook = null, curriculum = null, getEntry = () => undefined, now = new Date() } = {}) {
  if (!unitId) throw new Error('先选这一页是哪个单元。');
  const at = localIso(now);
  const tb = cloneJSON(textbook && typeof textbook === 'object' ? textbook : {}) || {};
  tb.units = Array.isArray(tb.units) ? tb.units.filter(u => u && u.id != null) : [];
  let unit = tb.units.find(u => String(u.id) === unitId);
  const fresh = !unit;
  if (!unit) {
    unit = { id: unitId, title: unitTitle || unitTitleOf(unitId), order: defaultUnitOrder(unitId), words: [] };
    tb.units.push(unit);
  }
  unit.words = Array.isArray(unit.words) ? unit.words.filter(x => x && x.w) : [];
  const keep = keptRows(rows);
  const counts = { saved: 0, added: 0, updated: 0, same: 0, moved: 0, newEntries: 0, oldEntries: 0,
    skippedUnclear: (rows || []).filter(r => r && !r.deleted && r.unclear).length,
    deleted: (rows || []).filter(r => r && r.deleted).length };
  const keys = new Set();
  const saved = [];
  for (const r of keep) {
    const w = cleanWord(r.w);
    const k = normWord(w);
    if (keys.has(k)) continue;
    keys.add(k);
    const pos = cleanPos(r.pos), cn = cleanCn(r.cn);
    const i = unit.words.findIndex(x => normWord(x.w) === k);
    const next = { w, ...(cn ? { cn } : {}), ...(pos ? { pos } : {}), ...(isPhrase(w) ? { phrase: true } : {}), cn_source: SOURCE, source: SOURCE };
    if (i < 0) { unit.words.push(next); counts.added++; }
    else {
      const old = unit.words[i];
      const merged = { ...old, ...next };
      if (!cn && old.cn) merged.cn = old.cn;   // the page had no Chinese for it: keep what was there
      if (!cn && old.cn && old.cn_source) merged.cn_source = old.cn_source;
      const changed = (merged.w !== old.w) || (merged.cn || '') !== (old.cn || '') || (merged.pos || '') !== (old.pos || '');
      unit.words[i] = merged;
      if (changed) counts.updated++; else counts.same++;
    }
    saved.push({ w, cn, pos });
  }
  counts.saved = saved.length;
  // the same word in another unit's draft list moves here
  for (const u of tb.units) {
    if (u === unit || !Array.isArray(u.words)) continue;
    const before = u.words.length;
    u.words = u.words.filter(x => !(x && keys.has(normWord(x.w)) && x.source !== SOURCE));
    counts.moved += before - u.words.length;
  }
  if (fresh && unitTitle) unit.title = unitTitle;
  unit.source = SOURCE;
  unit.photoAt = now.toISOString();
  unit.pages = (Number(unit.pages) || 0) + (saved.length ? 1 : 0);
  tb.units.sort((a, b) => (a.order ?? defaultUnitOrder(a.id)) - (b.order ?? defaultUnitOrder(b.id)));
  tb.photoAt = now.toISOString();
  if (!tb.importedAt) tb.importedAt = now.toISOString();

  const unitOrder = unit.order ?? defaultUnitOrder(unitId);
  const entries = saved.map(({ w, cn, pos }) => {
    const slug = slugify(w);
    const local = getEntry(slug);
    if (local) counts.oldEntries++; else counts.newEntries++;
    const order = unit.words.findIndex(x => normWord(x.w) === normWord(w)) + 1;
    const tier = tierOfWord(w, curriculum);
    const e = {
      slug, headword: w, favorited: true, favorited_at: at, created: at, updated: at,
      history: [{ at, query: w, source: SOURCE }],
      unit: unitId, unit_title: unit.title, unit_order: unitOrder, order,
      source: SOURCE,
    };
    // no AI explanation yet: the word page fills it on first open. A word that already has one keeps it, and the
    // book's Chinese replaces its short meaning (without needs_core, importData lets the newer brief_cn win)
    const hasCore = !!(local && Array.isArray(local.senses) && local.senses.length && !local.needs_core);
    if (!hasCore) e.needs_core = true;
    if (cn) e.brief_cn = cn;
    if (pos) e.book_pos = pos;
    if (tier) { e.tier = tier; e.required = tier !== 'recognize'; }
    if (isPhrase(w)) e.phrase = true;
    return e;
  });
  const data = { format: EXPORT_FORMAT, version: 1, source: SOURCE, exported_at: now.toISOString(), entries, zh: [] };
  return { kind: 'vocab', unit: { id: unitId, title: unit.title }, textbook: tb, data, counts };
}

// rows: [{ id, title, deleted }] from the confirm page. Titles of units already on the iPad follow the contents page;
// units not imported yet are only remembered in textbook.toc (no empty units in the word lists).
export function planToc({ rows, textbook = null, now = new Date() } = {}) {
  const tb = cloneJSON(textbook && typeof textbook === 'object' ? textbook : {}) || {};
  tb.units = Array.isArray(tb.units) ? tb.units.filter(u => u && u.id != null) : [];
  const toc = [];
  const counts = { listed: 0, renamed: 0, deleted: (rows || []).filter(r => r && r.deleted).length };
  for (const r of rows || []) {
    if (!r || r.deleted) continue;
    const id = unitIdOf(r.id);
    if (!id || toc.some(x => x.id === id)) continue;
    const title = unitTitleOf(id, r.title);
    toc.push({ id, title, order: defaultUnitOrder(id) });
    const u = tb.units.find(x => String(x.id) === id);
    if (u && u.title !== title) { u.title = title; counts.renamed++; }
  }
  toc.sort((a, b) => a.order - b.order);
  counts.listed = toc.length;
  tb.toc = toc;
  tb.photoAt = now.toISOString();
  return { kind: 'toc', textbook: tb, counts };
}

// Writes a plan the way the unit-pack import does: entries first (words.importData merges, never deletes), then
// kv 'textbook', then the curriculum reload. dryRun (mock mode): nothing is written.
export async function saveCapture(ctx, plan, { dryRun = false } = {}) {
  if (!plan || !plan.textbook) throw new Error('没有要存的内容。');
  if (dryRun) return { ...plan.counts, dryRun: true };
  if (plan.kind === 'vocab' && plan.data && plan.data.entries.length) await ctx.words.importData(plan.data);
  await ctx.kv.set('textbook', plan.textbook);
  if (ctx.reloadCurriculum) await ctx.reloadCurriculum();
  return { ...plan.counts, dryRun: false };
}
