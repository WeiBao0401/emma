// 语音输入（问老师的“按住说话”，PLAN-tonight 第 3 项）：按住说话，问题变成文字放进输入框，她看一眼再发。
// 她可能中文夹英文地说（“there be 是什么意思”），所以识别时带上她在学的英文词当上下文。
// 负责：语音输入（voice-input.js、voice-stream.js、tests/voice-input.test.mjs、tests/voice-stream.test.mjs、research/09-voice-input.md）。
//
// 两条线（settings.asrProvider：'auto' | 'bailian' | 'doubao'；auto = 填了豆包的 Access Token 或新版 API Key 就用豆包，否则百炼）
//   豆包（0.6 起，豆包流式语音识别 2.0）：按住时边说边出字。voice-stream.js 的 createDoubaoStream 连
//     wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async，凭据走网址参数（浏览器的 WebSocket 带不了请求头）：
//     旧版控制台 doubaoAppId（APP ID）+ doubaoToken（Access Token）→ api_app_key / api_access_key；新版控制台只有 API Key，
//     放进 doubaoToken、App ID 空着 → api_key。资源 ID 是 doubaoCluster，空着就是 DOUBAO_RESOURCE（volc.seedasr.sauc.duration）；
//     填的是录音文件识别的资源（volc.bigasr.auc_turbo 这类）时流式不用它，照样用 2.0 的。/sauc/bigmodel 不收这个资源（10-25 实测）。
//     onPartial 每次给从按下到现在的整句，ui-chat 直接填进输入框。豆包的费用在火山引擎那边算，App 里不记。
//   流式失败（鉴权、没开通、网络、超时、服务繁忙）自动换一条线听写，不用她再说一遍：voice-stream 录到的整段 16 kHz 音频
//     （st.wav()）交给百炼整段识别（有百炼 Key 时）；没有百炼 Key 就交给豆包录音文件极速版（DOUBAO_FLASH_URL，要在控制台另开通）。
//     换的时候用 ctx.toast 说一句 VOICE_COPY.fallback（“换个方式听写。”）。麦克风被拒不换。
//   百炼：DashScope 同步识别 qwen-audio-3.0-asr-flash（BAILIAN_ASR_URL，CORS 对 weibao0401.github.io 放行，Key 用 settings.apiKey），
//     MediaRecorder 录好整段，在本机转成 16 kHz 单声道 WAV 再发，0.00022 元/秒，记进 budget 的 'asr'。上下文放一条 input_text
//     （400 字以内），音频放最后一条。
//   豆包录音文件极速版（只当兜底）：POST DOUBAO_FLASH_URL，一次请求直接回结果。CORS 是 *，放行 X-Api-App-Key、X-Api-Access-Key、
//     X-Api-Resource-Id、X-Api-Request-Id、X-Api-Sequence；新版 API Key 走网址参数 api_key（X-Api-Key 头不在放行表里）。
//
// 导出
//   createVoiceInput(ctx, deps?) -> { available(), supported(), start({ lang, onPartial }), stop() -> Promise<string>, cancel(), state(), info() }
//     ui-chat.js 通过 ctx.voiceInput 用：按下 start（在 pointerdown 里直接调，前面不能有 await：流式的 AudioContext 要在点按里建；
//     要麦克风权限，第一次会弹框），说话时 onPartial(整句) 边说边给，松开 stop（返回最终整句，没听到返回 ''），误触或离开页面 cancel。
//     最长录 MAX_MS，到了自动停，松开时照样识别已录的。
//     模拟模式不录音、不联网：豆包线（没有指定百炼时）假装边说边出字，一个字一个词地给 onPartial；stop() 回一句假问题。
//     ?mock=offline 时假装流式说到一半断了，松开时说“换个方式听写。”再给整句（演示兜底）。
//     出错时 err.kid 是给她看的一句（VOICE_COPY，“家长”换成家长区设的称呼）；麦克风被拒绝时 err.name 'NotAllowedError'。
//     info()：最近一次 { provider, stream, fellBack（'' | 'bailian' | 'doubao-flash'）, reason（中文原因码，比如“鉴权失败”）, ms }，
//     家长区想显示“上次用的哪条线”可以读（不含凭据）。
//     deps（测试用）：getUserMedia、MediaRecorder、fetchImpl、toWav、blobToDataUrl、now、sleep、every(fn, ms) -> 停止函数、
//       createStream（换掉 createDoubaoStream）、WebSocketImpl、AudioContextImpl、streamMedia（流式的音源，比如 pcmSource）、streamOptions
//   纯函数（Node 测试用）：asrRoute(settings)、fallbackRoute(settings)、pickMime(isTypeSupported)、formatOf(mime)、
//     resampleMono(channels, from, to)、encodeWav(samples, rate)、contextText({ kv, progress })、bailianBody(route, dataUrl, format, context)、
//     parseBailian(json)、doubaoRequest(route, base64, format, requestId)、parseDoubao(status, headers, json)、voiceError(code, parentName)、
//     mockPieces(line)
//   常量：ASR_DEFAULTS、BAILIAN_ASR_URL、BAILIAN_ASR_MODEL、ASR_PRICE_PER_SEC、DOUBAO_URL、DOUBAO_RESOURCE、DOUBAO_FLASH_URL、
//     DOUBAO_FLASH_RESOURCE、MAX_MS、MIN_MS、VOICE_COPY、MOCK_LINES
// 依赖：ai.js（AIError）、voice-stream.js（createDoubaoStream）。ctx 用到：settings()、mockForced()、budget（blockReason / record）、
//   kv（peek）、parentName()、toast(msg, ms)。

import { AIError } from './ai.js';
import { createDoubaoStream, STREAM_URL, STREAM_RESOURCE } from './voice-stream.js';

export const ASR_DEFAULTS = { asrProvider: 'auto', doubaoAppId: '', doubaoToken: '', doubaoCluster: '' };
export const BAILIAN_ASR_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const BAILIAN_ASR_MODEL = 'qwen-audio-3.0-asr-flash';
export const ASR_PRICE_PER_SEC = 0.00022;
// 豆包流式语音识别 2.0（the 豆包 route; DOUBAO_RESOURCE is the default for doubaoCluster, shown in the parent area)
export const DOUBAO_URL = STREAM_URL;
export const DOUBAO_RESOURCE = STREAM_RESOURCE;
// 豆包录音文件极速版: only a fallback when the stream fails and there is no Bailian Key
export const DOUBAO_FLASH_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export const DOUBAO_FLASH_RESOURCE = 'volc.bigasr.auc_turbo';
export const MAX_MS = 60000;
export const MIN_MS = 400;
export const TIMEOUT_MS = 30000;
export const BUDGET_KIND = 'asr';
const RATE = 16000;
const CONTEXT_CAP = 380;
const MOCK_STEP_MS = 170;
// same-origin worklet (the CSP blocks voice-stream's Blob URL one; without either it falls back to ScriptProcessor)
const WORKLET_URL = (() => { try { return new URL('./pcm-tap-worklet.js', import.meta.url).href; } catch (e) { return ''; } })();

// what she sees; “家长” becomes the name the parent area set
export const VOICE_COPY = {
  notready: '语音输入还没准备好，告诉家长。先打字问吧。',
  nodevice: '这台 iPad 现在录不了音，先打字问吧。',
  'budget-day': '今天的老师额度用完了，先打字问吧。',
  budget: '这个月的老师额度用完了，告诉家长。先打字问吧。',
  network: '语音这会儿连不上，先打字问吧。',
  offline: '现在没连网，先打字问吧。',
  timeout: '网有点慢，没听完，再说一次或者打字问吧。',
  ratelimit: '语音这会儿有点忙，等一下再说。',
  server: '语音这会儿有点忙，等一下再说。',
  badkey: '语音输入出了点问题，告诉家长。先打字问吧。',
  forbidden: '语音输入出了点问题，告诉家长。先打字问吧。',
  model: '语音输入出了点问题，告诉家长。先打字问吧。',
  format: '这段声音没认出来，再按住说一次。',
  http: '没听清，再按住说一次。',
  fallback: '换个方式听写。',
};
export const MOCK_LINES = ['there be 和 have 有什么区别？', 'seldom 是什么意思？', '怎么记住 Unit 3 的单词？'];

const clean = v => String(v == null ? '' : v).replace(/[\s​-‍⁠﻿]/g, '');
// 录音文件识别的资源（volc.bigasr.auc_turbo、volc.bigasr.auc）流式不收；流式的都带 .sauc.
const isFileResource = r => /(^|\.)auc(\.|_|$)/i.test(r || '');
// ?mock=offline (app.js keeps it out of ctx.settings): the mock stream drops half way, to show the fallback
const mockOffline = () => { try { return /[?&]mock=offline(&|$)/.test(String((globalThis.location && globalThis.location.search) || '')); } catch (e) { return false; } };
const call = (fn, ...a) => { try { if (typeof fn === 'function') fn(...a); } catch (e) { /* the page's callback never stops recognition */ } };

// ---------------------------------------------------------------- pure helpers

export function asrRoute(s = {}) {
  s = s || {};
  const want = s.asrProvider === 'bailian' || s.asrProvider === 'doubao' ? s.asrProvider : 'auto';
  const token = clean(s.doubaoToken);
  const appId = clean(s.doubaoAppId);
  const provider = want === 'auto' ? (token ? 'doubao' : 'bailian') : want;
  if (provider === 'doubao') {
    const cluster = clean(s.doubaoCluster);
    return { provider, name: '豆包', stream: true, url: DOUBAO_URL, ready: !!token, appId, token, mode: appId ? 'app' : 'apikey',
      resource: cluster && !isFileResource(cluster) ? cluster : DOUBAO_RESOURCE, model: 'doubao-seedasr-stream' };
  }
  const key = clean(s.apiKey);
  return { provider: 'bailian', name: '百炼', stream: false, url: BAILIAN_ASR_URL, ready: !!key, key, model: BAILIAN_ASR_MODEL };
}

// where a failed 豆包 stream goes with the audio it already has: Bailian when its Key is in, else 豆包's 录音文件极速版
export function fallbackRoute(s = {}) {
  s = s || {};
  const b = asrRoute({ ...s, asrProvider: 'bailian' });
  if (b.ready) return b;
  const d = asrRoute({ ...s, asrProvider: 'doubao' });
  if (!d.ready) return null;
  const cluster = clean(s.doubaoCluster);
  return { ...d, name: '豆包', stream: false, url: DOUBAO_FLASH_URL, resource: isFileResource(cluster) ? cluster : DOUBAO_FLASH_RESOURCE,
    model: 'doubao-bigasr-flash' };
}

// iPad Safari records audio/mp4 (AAC); Chrome webm/opus. Either is decoded to WAV before sending.
export function pickMime(isTypeSupported = () => false) {
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (isTypeSupported(m)) return m; } catch (e) { /* next */ }
  }
  return '';
}
export function formatOf(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('aac')) return 'aac';
  return m.includes('mp4') || m.includes('m4a') ? 'mp4' : 'wav';
}

// several channels -> one, then linear interpolation to the target rate
export function resampleMono(channels = [], from = RATE, to = RATE) {
  const list = (channels || []).filter(c => c && c.length);
  if (!list.length) return new Float32Array(0);
  const len = list[0].length;
  const mono = new Float32Array(len);
  for (const c of list) for (let i = 0; i < len; i++) mono[i] += (c[i] || 0) / list.length;
  if (!from || from === to) return mono;
  const outLen = Math.max(1, Math.floor(len * to / from));
  const out = new Float32Array(outLen);
  const step = from / to;
  for (let i = 0; i < outLen; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    const a = mono[Math.min(j, len - 1)], b = mono[Math.min(j + 1, len - 1)];
    out[i] = a + (b - a) * f;
  }
  return out;
}

// PCM 16-bit mono WAV
export function encodeWav(samples, rate = RATE) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] || 0));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}

// The English words she is learning (textbook units up to the current one, newest first) so the recognizer writes
// “seldom” instead of a Chinese homophone. At most CONTEXT_CAP characters (Bailian keeps 400; 豆包 takes it as dialog context).
export function contextText({ kv = null, progress = null } = {}) {
  const head = '初一学生在问英语老师问题，中文里会夹英文单词和句子，比如 there be、am、is、are、have、has、Unit 3。';
  let words = [];
  try {
    const tb = kv && kv.peek ? kv.peek('textbook', null) : null;
    const units = ((tb && tb.units) || []).filter(u => u && Array.isArray(u.words)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const cur = (progress && progress.unit) || '';
    const upto = cur && units.some(u => u.id === cur) ? units.slice(0, units.findIndex(u => u.id === cur) + 1) : units;
    for (const u of upto.reverse()) for (const w of u.words) { const t = String((w && w.w) || '').trim(); if (t && /^[A-Za-z][A-Za-z' .-]*$/.test(t)) words.push(t); }
  } catch (e) { words = []; }
  let text = head;
  const seen = new Set();
  for (const w of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const next = text + (seen.size === 1 ? '可能说到的词：' : '、') + w;
    if (next.length > CONTEXT_CAP) break;
    text = next;
  }
  return text;
}

export function bailianBody(route, dataUrl, format = 'wav', context = '') {
  const messages = [];
  if (context) messages.push({ role: 'user', content: [{ type: 'input_text', text: String(context).slice(0, 400) }] });
  messages.push({ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUrl } }] });
  const parameters = { format, language_hints: ['zh', 'en'] };
  if (format === 'wav') parameters.sample_rate = RATE;
  return { model: route.model || BAILIAN_ASR_MODEL, input: { messages }, parameters };
}
// output.text (the documented place); a choices-shaped answer is read too
export function parseBailian(j) {
  const o = (j && j.output) || {};
  if (typeof o.text === 'string') return o.text.trim();
  if (o.sentence && typeof o.sentence.text === 'string') return o.sentence.text.trim();
  const c = o.choices && o.choices[0] && o.choices[0].message && o.choices[0].message.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.map(x => (x && x.text) || '').join('').trim();
  return '';
}

// 录音文件极速版 (the route from fallbackRoute)
export function doubaoRequest(route, base64, format = 'wav', requestId = '') {
  const resource = route.resource && isFileResource(route.resource) ? route.resource : DOUBAO_FLASH_RESOURCE;
  const headers = { 'Content-Type': 'application/json', 'X-Api-Resource-Id': resource,
    'X-Api-Request-Id': requestId || uuid(), 'X-Api-Sequence': '-1' };
  let url = route.url && /^https:/.test(route.url) ? route.url : DOUBAO_FLASH_URL;
  if (route.mode === 'app') { headers['X-Api-App-Key'] = route.appId; headers['X-Api-Access-Key'] = route.token; }
  else url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(route.token) + '&api_resource_id=' + encodeURIComponent(resource);
  const audio = { data: base64 };
  if (format === 'wav' || format === 'mp3' || format === 'ogg') audio.format = format;
  const body = { user: { uid: route.appId || 'emma' }, audio, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true } };
  return { url, headers, body };
}
// The status code is the X-Api-Status-Code header (20000000 ok, 20000003 silence); errors also come as { header: { code } }.
export function parseDoubao(status, headers = {}, j = null) {
  const get = k => (headers && typeof headers.get === 'function' ? headers.get(k) : headers && (headers[k] || headers[k.toLowerCase()])) || '';
  let code = Number(get('X-Api-Status-Code') || (j && j.header && j.header.code) || 0);
  if (!code && Number(status) === 200) code = 20000000;
  if (code === 20000000) return { text: String((j && j.result && j.result.text) || '').trim(), seconds: Number((j && j.audio_info && j.audio_info.duration) || 0) / 1000 };
  if (code === 20000003 || code === 45000002) return { text: '', silent: true };
  const msg = String(get('X-Api-Message') || (j && j.header && j.header.message) || '');
  let err = 'http';
  if (code === 45000151) err = 'format';
  else if (code >= 45000000 && code < 46000000 && /key|token|grant|auth|resource|access|permission/i.test(msg)) err = 'badkey';
  else if (Number(status) === 401 || Number(status) === 403) err = 'badkey';
  else if (Number(status) === 429) err = 'ratelimit';
  else if (code >= 55000000 || Number(status) >= 500) err = 'server';
  return { error: err, code, message: msg || `豆包语音 ${status} ${code || ''}`.trim() };
}

export function voiceError(code, parentName = '家长') {
  const kid = (VOICE_COPY[code] || VOICE_COPY.http).replace(/家长/g, parentName || '家长');
  return kid;
}

// mock streaming: an English word (with the space before it) or one Chinese character / mark at a time
export function mockPieces(line) {
  return String(line || '').match(/\s*[A-Za-z0-9']+|\s*[^\sA-Za-z0-9']/g) || [];
}

function uuid() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* below */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${h()}-${h()}${h()}${h()}`;
}

// ---------------------------------------------------------------- browser glue (replaceable in tests)

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const everyMs = (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); };

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('read'));
    fr.readAsDataURL(blob);
  });
}

// decode what MediaRecorder gave (mp4 / webm) and re-encode as 16 kHz mono WAV
async function toWav(blob) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) throw new Error('no AudioContext');
  const buf = await blob.arrayBuffer();
  const ac = new AC();
  try {
    const ab = await new Promise((resolve, reject) => {
      const p = ac.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
    const ch = [];
    for (let i = 0; i < ab.numberOfChannels; i++) ch.push(ab.getChannelData(i));
    const mono = resampleMono(ch, ab.sampleRate, RATE);
    return { blob: new Blob([encodeWav(mono, RATE)], { type: 'audio/wav' }), seconds: ab.duration };
  } finally { try { if (ac.close) ac.close(); } catch (e) { /* fine */ } }
}

function kidErr(code, ctx, cause = null) {
  const parent = (() => { try { return ctx && ctx.parentName ? ctx.parentName() : '家长'; } catch (e) { return '家长'; } })();
  const e = cause instanceof AIError ? cause : new AIError((cause && cause.message) || code, code);
  e.code = code;
  e.kid = voiceError(code, parent);
  if (cause && cause.reason && !e.reason) e.reason = cause.reason;
  return e;
}
function micDenied() { const x = new Error('mic'); x.name = 'NotAllowedError'; return x; }

export function createVoiceInput(ctx = {}, deps = {}) {
  const nav = globalThis.navigator || {};
  const getUserMedia = deps.getUserMedia || (nav.mediaDevices && nav.mediaDevices.getUserMedia ? c => nav.mediaDevices.getUserMedia(c) : null);
  const Recorder = deps.MediaRecorder || globalThis.MediaRecorder || null;
  const fetchImpl = deps.fetchImpl || ((...a) => globalThis.fetch(...a));
  const wav = deps.toWav || toWav;
  const toDataUrl = deps.blobToDataUrl || blobToDataUrl;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || sleepMs;
  const every = deps.every || everyMs;
  const makeStream = deps.createStream || createDoubaoStream;
  const settings = () => { try { return (ctx.settings && ctx.settings()) || {}; } catch (e) { return {}; } };
  const mock = () => { const s = settings(); try { return !!s.mock || !!(ctx.mockForced && ctx.mockForced()); } catch (e) { return !!s.mock; } };
  const notice = msg => { try { if (ctx.toast) ctx.toast(msg, 2200); } catch (e) { /* only a hint */ } };
  let rec = null;        // recorder: { t0, stream, recorder, chunks, done, mime, route, timer }; stream: { kind: 'stream', st, ... }; mock: { mock: true, ... }
  let mockN = 0;
  let state = 'idle';    // 'idle' | 'recording' | 'recognizing'
  let last = null;       // info(): which way the last one went

  const canStream = () => !!deps.createStream || typeof (deps.WebSocketImpl || globalThis.WebSocket) === 'function';
  const supported = () => mock() || !!(getUserMedia && (Recorder || canStream()));

  function release(r) {
    if (!r) return;
    clearTimeout(r.timer);
    try { if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop(); } catch (e) { /* stopped */ }
    try { for (const t of (r.stream && r.stream.getTracks ? r.stream.getTracks() : [])) t.stop(); } catch (e) { /* gone */ }
  }
  function budgetBlock(route) {
    if (!route || route.provider !== 'bailian' || !ctx.budget || !ctx.budget.blockReason) return null;
    const why = ctx.budget.blockReason(BUDGET_KIND);
    return why ? kidErr(why === 'month' ? 'budget' : 'budget-day', ctx) : null;
  }
  const progressNow = () => { try { return ctx.kv && ctx.kv.peek ? ctx.kv.peek('progress', null) : null; } catch (e) { return null; } };

  // Not async before the stream starts: the stream's AudioContext has to be made inside the tap (iPad Safari).
  async function start(opts = {}) {
    if (rec) cancel();
    const onPartial = opts && typeof opts.onPartial === 'function' ? opts.onPartial : null;
    if (mock()) { startMock(onPartial); return; }
    if (!getUserMedia) throw kidErr('nodevice', ctx);
    const route = asrRoute(settings());
    if (!route.ready) throw kidErr('notready', ctx);
    if (route.provider === 'doubao') {
      if (canStream()) return startStream(route, onPartial);
      const fb = fallbackRoute(settings());
      if (!fb) throw kidErr('nodevice', ctx);
      return startRecorder(fb);
    }
    return startRecorder(route);
  }

  // ---------------------------------------------------------------- 豆包 streaming
  function streamOptions(route) {
    const o = { url: route.url, resourceId: route.resource, contextText: contextText({ kv: ctx.kv, progress: progressNow() }), maxMs: MAX_MS, uid: 'emma',
      workletUrl: WORKLET_URL };
    if (route.mode === 'app') { o.appId = route.appId; o.accessToken = route.token; } else o.apiKey = route.token;
    // only what tests inject: by default voice-stream reads the browser's own (and builds the AudioContext in the tap)
    if (deps.streamMedia) o.getMedia = deps.streamMedia;
    if (deps.WebSocketImpl) o.WebSocketImpl = deps.WebSocketImpl;
    if (deps.AudioContextImpl) o.AudioContextImpl = deps.AudioContextImpl;
    if (deps.fetchImpl) o.fetchImpl = deps.fetchImpl;
    if (deps.streamOptions) Object.assign(o, deps.streamOptions);
    return o;
  }

  async function startStream(route, onPartial) {
    const st = makeStream(streamOptions(route));
    const r = { kind: 'stream', t0: now(), route, st, partial: '' };
    rec = r;
    state = 'recording';
    try {
      await st.start({ onPartial: t => { if (rec !== r) return; r.partial = String(t || ''); call(onPartial, r.partial); } });
    } catch (e) {
      if (rec !== r) return;                       // cancelled or released meanwhile
      rec = null;
      state = 'idle';
      if (e && e.name === 'NotAllowedError') throw micDenied();
      // the stream could not even start (no WebSocket, the audio graph would not build): record the whole question instead
      const fb = e && e.fallback ? fallbackRoute(settings()) : null;
      if (fb) {
        const blocked = budgetBlock(fb);
        if (blocked) throw blocked;
        notice(VOICE_COPY.fallback);
        return startRecorder(fb, { fellBack: fb.provider === 'bailian' ? 'bailian' : 'doubao-flash', reason: (e && e.reason) || '' });
      }
      throw kidErr(e && VOICE_COPY[e.code] ? e.code : 'nodevice', ctx, e);
    }
  }

  async function stopStream(r) {
    const ms = now() - r.t0;
    if (ms < MIN_MS) { try { r.st.cancel(); } catch (e) { /* gone */ } state = 'idle'; return ''; }
    state = 'recognizing';
    try {
      const text = String((await r.st.stop()) || '').trim();
      last = { provider: 'doubao', stream: true, fellBack: '', reason: '', ms };
      return text;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw micDenied();
      return await fallBack(r, e, ms);
    } finally { state = 'idle'; }
  }

  // the stream broke (auth, not opened, network, timeout, busy): the same audio goes to the other line, she does not say it again
  async function fallBack(r, e, ms) {
    const code = e && VOICE_COPY[e.code] ? e.code : 'network';
    const fb = e && e.fallback !== false ? fallbackRoute(settings()) : null;
    let buf = null;
    try { buf = r.st.wav(); } catch (x) { buf = null; }
    const bytes = buf ? Math.max(0, buf.byteLength - 44) : 0;
    if (!fb || !bytes) throw kidErr(code, ctx, e);
    const seconds = bytes / (RATE * 2);
    if (seconds * 1000 < MIN_MS) return '';
    const blocked = budgetBlock(fb);
    if (blocked) throw blocked;
    console.warn('voice: 豆包流式没成，换', fb.name, (e && (e.reason || e.message)) || e);
    last = { provider: 'doubao', stream: true, fellBack: fb.provider === 'bailian' ? 'bailian' : 'doubao-flash', reason: (e && e.reason) || '', ms };
    notice(VOICE_COPY.fallback);
    return recognize(new Blob([buf], { type: 'audio/wav' }), fb, seconds, true);
  }

  // ---------------------------------------------------------------- mock (no microphone, no network)
  function startMock(onPartial) {
    const s = settings();
    const r = { mock: true, t0: now(), line: MOCK_LINES[mockN % MOCK_LINES.length], stream: s.asrProvider !== 'bailian', broke: !!s.mockFail || mockOffline(), stopTick: null };
    rec = r;
    state = 'recording';
    if (!r.stream || !onPartial) return;
    const pieces = mockPieces(r.line);
    const upto = r.broke ? Math.max(1, Math.floor(pieces.length / 2)) : pieces.length;   // ?mock=offline: the line drops half way
    let n = 0;
    r.stopTick = every(() => {
      if (rec !== r) return;
      if (n < upto) { n++; call(onPartial, pieces.slice(0, n).join('')); }
      if (n >= upto && r.stopTick) { r.stopTick(); r.stopTick = null; }
    }, MOCK_STEP_MS);
  }
  async function stopMock(r) {
    if (r.stopTick) { r.stopTick(); r.stopTick = null; }
    state = 'recognizing';
    const heard = now() - r.t0 >= MIN_MS;
    if (heard && r.stream && r.broke) notice(VOICE_COPY.fallback);
    await sleep(r.stream && !r.broke ? 150 : 350);
    state = 'idle';
    if (!heard) return '';
    mockN++;
    last = { provider: r.stream ? 'doubao' : 'bailian', stream: r.stream, fellBack: r.stream && r.broke ? 'bailian' : '', reason: r.broke ? '连不上' : '', ms: now() - r.t0, mock: true };
    return r.line;
  }

  // ---------------------------------------------------------------- whole-question recording (Bailian, or after the stream failed to start)
  // via: { fellBack, reason } when this replaces a 豆包 stream that could not start
  async function startRecorder(route, via = null) {
    if (!getUserMedia || !Recorder) throw kidErr('nodevice', ctx);
    const blocked = budgetBlock(route);
    if (blocked) throw blocked;
    const r = { mock: false, t0: now(), route, via, chunks: [], stream: null, recorder: null };
    rec = r;
    let stream;
    try {
      stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (rec === r) rec = null;
      state = 'idle';
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw micDenied();
      throw kidErr('nodevice', ctx, e);
    }
    if (rec !== r) { try { for (const t of stream.getTracks()) t.stop(); } catch (e) { /* gone */ } return; }   // cancelled meanwhile
    r.stream = stream;
    const mime = pickMime(m => (Recorder.isTypeSupported ? Recorder.isTypeSupported(m) : false));
    try { r.recorder = mime ? new Recorder(stream, { mimeType: mime }) : new Recorder(stream); } catch (e) { r.recorder = new Recorder(stream); }
    r.mime = r.recorder.mimeType || mime || '';
    r.done = new Promise(resolve => {
      r.recorder.ondataavailable = ev => { if (ev && ev.data && ev.data.size) r.chunks.push(ev.data); };
      r.recorder.onstop = () => resolve();
      r.recorder.onerror = () => resolve();
    });
    r.recorder.start();
    state = 'recording';
    r.timer = setTimeout(() => { try { if (r.recorder.state === 'recording') r.recorder.stop(); } catch (e) { /* fine */ } }, MAX_MS);
  }

  async function stop() {
    const r = rec;
    rec = null;
    if (!r) { state = 'idle'; return ''; }
    if (r.mock) return stopMock(r);
    if (r.kind === 'stream') return stopStream(r);
    const ms = now() - r.t0;
    clearTimeout(r.timer);
    try { if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop(); } catch (e) { /* stopped */ }
    await Promise.race([r.done, sleep(3000)]);
    release(r);
    if (ms < MIN_MS || !r.chunks.length) { state = 'idle'; return ''; }
    state = 'recognizing';
    try {
      last = r.via ? { provider: 'doubao', stream: true, fellBack: r.via.fellBack, reason: r.via.reason, ms }
        : { provider: r.route.provider, stream: false, fellBack: '', reason: '', ms };
      return await recognize(new Blob(r.chunks, { type: r.mime || 'audio/mp4' }), r.route, Math.min(ms, MAX_MS) / 1000);
    } finally { state = 'idle'; }
  }

  function cancel() {
    const r = rec;
    rec = null;
    state = 'idle';
    if (!r) return;
    if (r.mock) { if (r.stopTick) { r.stopTick(); r.stopTick = null; } return; }
    if (r.kind === 'stream') { try { r.st.cancel(); } catch (e) { /* gone */ } return; }
    release(r);
  }

  async function post(url, init) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : 0;
    try {
      return await fetchImpl(url, { ...init, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      if (ctrl && ctrl.signal.aborted) throw kidErr('timeout', ctx, e);
      throw kidErr(nav.onLine === false ? 'offline' : 'network', ctx, e);
    } finally { clearTimeout(t); }
  }

  // one whole question; isWav: already 16 kHz mono WAV (the stream's audio), no decoding
  async function recognize(raw, route, seconds, isWav = false, context = null) {
    let audio = raw, format = isWav ? 'wav' : formatOf(raw.type);
    if (!isWav) {
      try { const w = await wav(raw); if (w && w.blob) { audio = w.blob; format = 'wav'; if (w.seconds) seconds = w.seconds; } } catch (e) { console.warn('voice: wav', (e && e.message) || e); }
    }
    const dataUrl = await toDataUrl(audio);
    if (route.provider === 'doubao') {
      const { url, headers, body } = doubaoRequest(route, dataUrl.slice(dataUrl.indexOf(',') + 1), format);
      const res = await post(url, { method: 'POST', headers, body: JSON.stringify(body) });
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      const out = parseDoubao(res.status, res.headers, j);
      if (out.error) throw kidErr(out.error, ctx, new Error(out.message));
      return out.text;
    }
    const body = bailianBody(route, dataUrl, format, context === null ? contextText({ kv: ctx.kv, progress: progressNow() }) : context);
    const res = await post(route.url, { method: 'POST', headers: { Authorization: 'Bearer ' + route.key, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
      body: JSON.stringify(body) });
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok) {
      const msg = String((j && (j.message || j.code)) || res.status);
      let code = res.status === 401 ? 'badkey' : res.status === 403 ? 'forbidden' : res.status === 429 ? 'ratelimit' : res.status >= 500 ? 'server' : 'http';
      if (res.status === 400 && /format|audio|decode/i.test(msg)) code = 'format';
      if (res.status === 400 && /model/i.test(msg) && /not|exist|access/i.test(msg)) code = 'model';
      if (res.status === 429 && /预算|budget/i.test(msg)) { code = 'budget'; try { if (ctx.budget && ctx.budget.markExhausted) ctx.budget.markExhausted(); } catch (e) { /* fine */ } }
      throw kidErr(code, ctx, new Error(`百炼语音识别 ${res.status} ${msg}`));
    }
    const secs = Number((j && j.usage && (j.usage.duration || j.usage.seconds)) || seconds || 0);
    try { if (ctx.budget && ctx.budget.record) ctx.budget.record({ seconds: secs }, BUDGET_KIND, route.model); } catch (e) { /* never blocks */ }
    return parseBailian(j);
  }

  // 0.8.0 读出来的“老师听听”: a clip already recorded (rec.js, audio/mp4 or webm) as one whole recognition. Bailian first
  // (fallbackRoute), else 豆包's 录音文件极速版. lang 'en': no context at all, so the recognizer does not “fill in” the
  // sentence she was reading and a word she skipped still shows as skipped.
  async function transcribe(blob, opts = {}) {
    if (!blob || !blob.size) throw kidErr('format', ctx);
    const route = fallbackRoute(settings());
    if (!route) throw kidErr('notready', ctx);
    const blocked = budgetBlock(route);
    if (blocked) throw blocked;
    const t0 = now();
    const text = await recognize(blob, route, 0, false, opts && opts.lang === 'en' ? '' : null);
    last = { provider: route.provider, stream: false, via: 'transcribe', ms: now() - t0 };
    return String(text || '').trim();
  }

  return {
    available: supported,
    supported,
    start,
    stop,
    cancel,
    transcribe,
    state: () => state,
    info: () => (last ? { ...last } : null),
  };
}
