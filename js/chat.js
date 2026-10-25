// 问老师（自由对话，PLAN-tonight 第 2 项，design/teacher-next.md 6.1、6.4）：她什么都能问，老师按“讲清楚”来答。
// 这个文件是逻辑：存对话、拼上下文、调模型（流式）、记事件。画界面在 ui-chat.js，提示词在 chat-prompt.js。
// 负责：问老师 agent（chat.js、chat-prompt.js、ui-chat.js、css/chat.css、tests/chat.test.mjs）。
//
// 导出（常量）
//   KV_PREFIX 'chat:'；KEEP_DAYS 30；THREAD_GAP_MS（隔 3 小时再问算新问题）；CONTEXT_MESSAGES 12、CONTEXT_CHARS 8000（发给模型的历史）
//   BUDGET_KIND 'chat'（budget.js 的 KINDS 还没有它时记进 'other'）；CHAT_DEFAULTS（设置键的缺省值，接线以后以 config.js 为准）
//   BAILIAN_VISION_MODEL 'qwen3.8-flash'：百炼的对话模型看不了图时，带图的那一轮改用它
//   POE_MAX_TOKENS；FIRST_BYTE_MS、VISION_FIRST_BYTE_MS、STALL_MS；RETRY_DELAYS
//   QUICK（老师回答下面的三个按钮）、RECHECK（“和学校讲的不一样”）、examples(unitLabel)（第一次打开的示例问题）
// 导出（纯函数，Node 里测）
//   chatRoute(settings, { image }) -> { provider: 'bailian' | 'poe', name, url, key, model, asked?, relay }
//       settings.chatProvider：'auto'（填了中转站地址和 Poe Key 就用 Poe，否则百炼）| 'bailian' | 'poe'
//       百炼：config API_URL，Key 用 settings.apiKey，model 用 chatModelBailian（默认 qwen3.8-max），带图时换 BAILIAN_VISION_MODEL
//       Poe：settings.poeUrl（中转站，ai.js normalizePoeUrl）+ '/chat/completions'，Key 用 poeKey，model 用 chatModelPoe（默认 gpt-5.4）
//   requestBody(route, messages, { stream }) -> body   OpenAI 兼容；百炼 enable_thinking:false、stream_options.include_usage；Poe 给 max_tokens
//   buildMessages(system, history, images, { maxMessages, maxChars }) -> messages   history 是存下来的消息（同一个问题线），
//       最新一张照片以 image_url 的 data URL 发；更早的照片只写一句“发过一张照片”
//   createSSEParser(onData) -> { push(text), end() }；deltaOf(obj) -> { text, finish, usage, error }
//   streamChat({ route, messages, fetchImpl, signal, onDelta(piece, all), budget, stream, sleep }) -> Promise<{ text, usage, finish, streamed, model }>
//       流式（SSE 逐字给 onDelta）；服务器不给流就按一次的 JSON 读；400 说不支持 stream 就改非流式再发一次。
//       出字以前的网络错、429、5xx 重试一次；出字以后断了抛 AIError（code 'truncated' / 'timeout'），err.partial 是已经出来的字。
//       错误一律 ai.js 的 AIError，code 同 CONTRACTS 9.9；err.message 给家长看，孩子看的走 ctx.kidError
//   estimateUsage(messages, text) -> { prompt_tokens, completion_tokens, estimated: true }   接口没回 usage 时记账用
//   visibleText(raw)、parseMeta(raw)、splitMeta(raw) -> { text, meta }   去掉老师最后那行 <<<META {...}>>>（流式时没出完的半截也藏住）
//   normMeta(obj) -> { kind, point, words, check }；topicOf(text, { image }) -> 同形（模型没给 META 时程序自己判断）
//   topicLabel(meta) -> '语法 · there be' | '单词 · carry' | '作业题' ...
//   formatBlocks(text) -> [{ type: 'p', lines: [Span[]] } | { type: 'ul', items: [Span[]] } | { type: 'ol', items: [{ n, spans }] }]
//       Span = { text, bold }。只认 **加粗**、“- ”列表、“1. ”编号、换行和空行（界面用 h() 拼，不用 innerHTML）
//   tokens(text) -> [{ s, en }]   英文单词单独一段（界面上可以点）
//   speakable(text) -> string     “听一遍”读的英文部分（例句优先，中文不读；写着“不对”“错的”“不说”的那一行不读，免得把错句读给她听）
//   gatherContext(app, { now, exclude, events, focus }) -> Promise<ChatContext>   给 chat-prompt.js buildSystemPrompt 的她的情况（见那边注释）
//       focus：这次问到的语法点（focusPoints），对应语法卡的规则原文放进提示词（focusCards）；另带 teacher.js askedLines（“我问过的”）
//   focusPoints(user, history) -> ['there_be', ...]   这次问的、这个问题线上老师刚讲的、读句子时句子里的语法点
//   focusCards(points, content?) -> [{ title, unit, rule, table, examples }]   最多 2 张
//   讲对（design/teacher-next.md 6.4）：老师答完，程序查英文例句里她不认识的词（knownChecker、offList）；超过 OFF_MAX（2）个，
//       带着这几个词请老师整段重写一次（simplifyAsk），重写的替换原来的（消息上记 simplified: [词]）；重写失败就留原来的。
//       带照片的那一轮、模拟模式、课标词表没读到时不查。
//   knownChecker(app, ctx, { extra }) -> (word) => bool | null   她认识的：小学 505（含变化形式）、学到当前单元的课本词、
//       单词本里的词、她自己在这个问题里写过的词、讲的那个词；课本没导入时课标 1600 词也算
//   offList(text, known) -> [词]   回答里英文例句（3 个词以上的一段）里她不认识的词；人名、后面括号写了中文的词不算
//   simplifyAsk(words) -> 发给老师的“换简单的词重写”那句
//   missLines(events, { wordOf, tagName })、intakeInfo(rec)、grammarCards(kv, now, unitId, curriculum)、recentAsks(kv, { exclude })
//   mockAnswer(text, { image, quick })、mockStream(text, { image, quick, onDelta, signal, sleep })   模拟模式的假老师（也是一字字出）；
//       quick 'retell' 是“上次讲的 X，换个讲法再说一遍”（teacher.js retellAsk）
//   “我问过的”：老师每答完一次，把 META 的 point / words 记进 kv 'teacher.asked'（teacher.js noteAsked；“和学校讲的不一样”那次不记）
//   dayKey(date)、ymd(date)、isDayKey(key)、normDay(rec, date)
// 导出（有状态）
//   createChat(app, { fetchImpl, now, sleep }) -> {
//     messages() -> 今天的消息（数组，按时间）；thread() -> 现在这个问题的线 id；isBusy()
//     send({ text, image?, send?, quick? }, { onUpdate(msg) }) -> Promise<teacherMsg | null>
//         text 是气泡上显示的字；send 是发给模型的字（快捷按钮用，不给就是 text）；image 是 data:image/jpeg;base64（只在内存，不存）
//     retry(teacherId, { onUpdate }) -> Promise<teacherMsg | null>   没讲完或出错的那条再来一次
//     stop()；newThread()；flag(teacherId) -> Promise   “和学校讲的不一样”：记 flag 事件，消息上记 flagged
//     history({ days }) -> [{ date, messages }]   前几天的（新的在前，不含今天）；image(id) -> data URL | null
//   }
//
// 存储（kv，随备份导出）：'chat:YYYY-MM-DD' = { version: 1, date, messages: [Message] }，留最近 KEEP_DAYS 天。
//   Message = { id, role: 'user' | 'assistant', text, at, thread, send?, quick?, image?: true（发过照片；照片本身不存）,
//               reply_to?, meta?: { kind, point, words, check }, model?, provider?, error?, stopped?, flagged?,
//               simplified?: [词]（例句里她不认识的词太多，老师换简单的词重写过） }
//   正在重写时老师消息上有 simplifying: true（只在内存，界面写一句“老师在把例句换成你学过的词”）
//   出错又没出字的老师消息只在内存（再试一次时去掉），不存。
// 事件（events.js 'ask'，每个问题一条，老师回答完再记）：
//   { type: 'ask', step: 'chat', qid: 'chat', who: 'emma', item: 'chat:<消息 id>', about: 'chat:<kind>', kind, point: 'g:<点>' | '',
//     words, topic（topicLabel）, check, followup（快捷按钮 id 或 ''）, image, unit, q（问题前 60 个字）, ok, code?, model?, provider?, retry? }
//   “和学校讲的不一样”记 { type: 'flag', step: 'chat', reason: 'chat', item: 'chat:<老师消息 id>', kind, point }
// 依赖：config.js（API_URL、POE_DIRECT_URL）、ai.js（AIError、normalizePoeUrl）、budget.js（isBudgetExhausted）、events.js（isoLocal）、
//   curriculum.js（defaultUnitOrder、inflectionBases）、grammar.js（content、grammarState、summary）、teacher.js（“我问过的”、pointCard）、
//   words.js（slugify）、chat-prompt.js。
import { API_URL, POE_DIRECT_URL } from './config.js';
import { AIError, normalizePoeUrl } from './ai.js';
import { isBudgetExhausted } from './budget.js';
import { isoLocal } from './events.js';
import { defaultUnitOrder, inflectionBases } from './curriculum.js';
import * as G from './grammar.js';
import * as T from './teacher.js';
import * as S from './screen.js';
import { slugify } from './words.js';
import { buildSystemPrompt, KINDS, KIND_LABEL, POINTS, POINT_LABEL, CHECKS, META_OPEN, META_CLOSE } from './chat-prompt.js';

export const KV_PREFIX = 'chat:';
export const KEEP_DAYS = 30;
export const THREAD_GAP_MS = 3 * 3600e3;
export const CONTEXT_MESSAGES = 12;
export const CONTEXT_CHARS = 8000;
export const BUDGET_KIND = 'chat';
export const CHAT_DEFAULTS = { chatProvider: 'auto', chatModelBailian: 'qwen3.8-max', chatModelPoe: 'gpt-5.4' };
export const BAILIAN_VISION_MODEL = 'qwen3.8-flash';
export const POE_MAX_TOKENS = 6000;
export const FIRST_BYTE_MS = 45000;
export const VISION_FIRST_BYTE_MS = 90000;
export const STALL_MS = 30000;
export const RETRY_DELAYS = [1500];
const PHOTO_TEXT = '这是我拍的一道题。';
const OLD_PHOTO = '（我之前发过一张照片，现在看不到了。）';
const MISS_DAYS = 21;
export const OFF_MAX = 2;
const safe = (f, d = null) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };

export const QUICK = [
  { id: 'again', label: '还是不懂', send: '我还是不太懂。换一个更简单的说法，拆小一点再讲一次。' },
  { id: 'example', label: '再举个例子', send: '再举一个例子，只用我学过的词。' },
  { id: 'quiz', label: '出道题考考我', send: '出一道题考考我，就一道。我做完你再告诉我对不对。' },
];
export const RECHECK = { id: 'recheck', label: '和学校讲的不一样',
  send: '这和学校老师讲的不一样。请你再仔细检查一遍刚才讲的，以课本和学校老师为准。有错的话，直接说哪里错了，再把对的讲清楚。' };
// the three examples on an empty page; fill: put the text in the box for her to finish (she pastes or types the sentence)
export const examples = unitLabel => [
  { text: 'there be 和 have 有什么区别？' },
  { text: '这句话什么意思：……', fill: '这句话什么意思：' },
  { text: `怎么记住 ${unitLabel || 'Unit 3'} 的单词？` },
];

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
export const ymd = d => { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const dayKey = d => KV_PREFIX + ymd(d);
export const isDayKey = k => /^chat:\d{4}-\d{2}-\d{2}$/.test(String(k));
const md = date => String(date || '').slice(5, 10);
const shortUnit = id => (id === 'S' ? 'Starter' : /^U(\d+)$/.test(String(id)) ? 'Unit ' + String(id).slice(1) : String(id || ''));

// ---------------------------------------------------------------- who answers

const bailianSees = m => m === BAILIAN_VISION_MODEL || /(^|-)vl(-|$)|omni|qvq/i.test(String(m));

export function chatRoute(s = {}, { image = false } = {}) {
  s = s || {};
  const poeBase = normalizePoeUrl(s.poeUrl) || '';
  const poeKey = String(s.poeKey || '').trim();
  const poeReady = !!poeBase && !!poeKey;
  const want = s.chatProvider === 'poe' || s.chatProvider === 'bailian' ? s.chatProvider : 'auto';
  const provider = want === 'auto' ? (poeReady ? 'poe' : 'bailian') : want;
  if (provider === 'poe') {
    return { provider, name: 'Poe', url: poeBase ? poeBase + '/chat/completions' : '', key: poeKey,
      model: clean(s.chatModelPoe) || CHAT_DEFAULTS.chatModelPoe, relay: !!poeBase && poeBase !== POE_DIRECT_URL };
  }
  const asked = clean(s.chatModelBailian) || CHAT_DEFAULTS.chatModelBailian;
  const model = image && !bailianSees(asked) ? BAILIAN_VISION_MODEL : asked;
  return { provider, name: '百炼', url: API_URL, key: String(s.apiKey || '').trim(), model, asked, relay: false };
}

export function requestBody(route, messages, { stream = true } = {}) {
  const body = { model: route.model, messages, stream: !!stream };
  if (route.provider === 'poe') body.max_tokens = POE_MAX_TOKENS;
  else {
    body.enable_thinking = false;
    body.temperature = 0.5;
    if (stream) body.stream_options = { include_usage: true };
  }
  return body;
}

// ---------------------------------------------------------------- what the model gets

const userText = m => clean(m.send || m.text) ? String(m.send || m.text).trim() : (m.image ? PHOTO_TEXT : '');

export function buildMessages(system, history = [], images = new Map(), { maxMessages = CONTEXT_MESSAGES, maxChars = CONTEXT_CHARS } = {}) {
  const usable = (history || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && !m.pending && (m.role === 'user' ? (userText(m) || m.image) : clean(m.text)));
  // newest first until the window is full; the window starts with her message
  const picked = [];
  let chars = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    const len = (m.role === 'user' ? userText(m) : String(m.text)).length;
    if (picked.length && (picked.length >= maxMessages || chars + len > maxChars)) break;
    picked.unshift(m);
    chars += len;
  }
  while (picked.length > 1 && picked[0].role !== 'user') picked.shift();
  // only the newest photo still in memory goes along
  let photoId = '';
  for (let i = picked.length - 1; i >= 0; i--) if (picked[i].role === 'user' && picked[i].image) { photoId = images && images.get && images.get(picked[i].id) ? picked[i].id : ''; break; }
  const out = [{ role: 'system', content: system }];
  for (const m of picked) {
    if (m.role === 'assistant') { push(out, 'assistant', String(m.text).trim()); continue; }
    let text = userText(m);
    if (m.image && m.id !== photoId) text = OLD_PHOTO + (clean(m.send || m.text) ? '\n' + text : '');
    if (m.image && m.id === photoId) push(out, 'user', [{ type: 'text', text }, { type: 'image_url', image_url: { url: images.get(m.id) } }]);
    else push(out, 'user', text);
  }
  return out;
}
// two of her messages in a row (a reply that failed) become one
function push(out, role, content) {
  const last = out[out.length - 1];
  if (last && last.role === role && role !== 'system') {
    const parts = c => (Array.isArray(c) ? c : [{ type: 'text', text: c }]);
    if (typeof last.content === 'string' && typeof content === 'string') last.content += '\n' + content;
    else last.content = [...parts(last.content), ...parts(content)];
    return;
  }
  out.push({ role, content });
}

// ---------------------------------------------------------------- streaming

export function createSSEParser(onData) {
  let buf = '';
  const line = l => {
    if (!l.startsWith('data:')) return;
    const d = l.slice(5).trim();
    if (!d) return;
    if (d === '[DONE]') { onData(null, true); return; }
    let obj;
    try { obj = JSON.parse(d); } catch (e) { return; }
    onData(obj, false);
  };
  return {
    push(text) {
      buf += String(text ?? '');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); line(l); }
    },
    end() { const l = buf.replace(/\r$/, ''); buf = ''; if (l) line(l); },
  };
}

const contentText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('') : '');

export function deltaOf(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const ch = Array.isArray(o.choices) ? o.choices[0] : null;
  const d = (ch && (ch.delta || ch.message)) || {};
  return { text: contentText(d.content), finish: (ch && ch.finish_reason) || '', usage: o.usage || null,
    error: o.error ? (typeof o.error === 'object' ? o.error : { message: String(o.error) }) : null };
}

class Retry extends Error {}
class NoStream extends Error {}
const keyOk = k => /^[\x21-\x7e]+$/.test(k);
const errText = data => {
  const e = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error : data) : {};
  return { code: String(e.code || e.type || ''), message: String(e.message || '').slice(0, 200) };
};
const abortErr = partial => Object.assign(new AIError('已取消', 'abort'), { partial: partial || '' });

function httpFail(status, data, route) {
  const { code, message } = errText(data);
  const blob = (code + ' ' + message).toLowerCase();
  const n = route.name;
  if (route.relay && status === 404 && !message) return new AIError('中转站返回 404：地址里的暗号不对，到家长区重新粘贴中转站地址。', 'badkey');
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalidapikey')) return new AIError(`${n} 的 Key 不对或已失效：到家长区重新填。`, 'badkey');
  if (blob.includes('arrearage') || blob.includes('overdue') || blob.includes('good standing')) return new AIError('百炼账户欠费或预算用完了，去百炼控制台看一下。', 'billing');
  if (route.provider === 'poe' && (status === 402 || blob.includes('insufficient') || blob.includes('points'))) return new AIError('Poe 积分用完了，到 poe.com 看一下。', 'billing');
  if (blob.includes('model_not_found') || blob.includes('does not exist') || blob.includes('not exist') || blob.includes('not_found_error')) {
    return new AIError(`问老师用的模型“${route.model}”用不了：到家长区换一个。`, 'model');
  }
  if (blob.includes('data_inspection') || blob.includes('datainspection')) return new AIError('内容没通过百炼的安全检查。', 'inspection');
  if (status === 400 && /image|vision|multimodal|picture|url/.test(blob)) return new AIError(`模型“${route.model}”没收下这张照片（${message || code || '400'}）。`, 'model');
  if (status === 403) return new AIError(`${n}拒绝了请求（403）：${message || code || '没有权限'}。`, 'forbidden');
  return new AIError(`${n}返回 ${status}：${message || code || '没有详情'}`, 'http');
}

const offline = () => !!(globalThis.navigator && navigator.onLine === false);

export async function streamChat({ route, messages, fetchImpl = null, signal = null, onDelta = () => {}, budget = null, stream = true,
  sleep = sleepMs, firstByteMs = 0, stallMs = STALL_MS, retries = RETRY_DELAYS } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const hasImage = messages.some(m => Array.isArray(m.content) && m.content.some(p => p && p.type === 'image_url'));
  const waitMs = firstByteMs || (hasImage ? VISION_FIRST_BYTE_MS : FIRST_BYTE_MS);
  let text = '';

  async function once(useStream) {
    const ctrl = new AbortController();
    let timer = null, why = '';
    const arm = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
    const onAbort = () => { why = 'abort'; ctrl.abort(); };
    if (signal) { if (signal.aborted) throw abortErr(text); signal.addEventListener('abort', onAbort, { once: true }); }
    arm(waitMs, 'timeout');
    try {
      let res;
      try {
        res = await doFetch(route.url, { method: 'POST', signal: ctrl.signal,
          headers: { Authorization: 'Bearer ' + route.key, 'Content-Type': 'application/json', Accept: useStream ? 'text/event-stream' : 'application/json' },
          body: JSON.stringify(requestBody(route, messages, { stream: useStream })) });
      } catch (e) {
        if (why === 'abort') throw abortErr(text);
        if (why === 'timeout') throw new AIError(`${route.name} ${Math.round(waitMs / 1000)} 秒没回，网络可能太慢。`, 'timeout');
        throw new Retry('network');
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 429 && isBudgetExhausted(429, data)) {
          if (budget && budget.markExhausted) { try { budget.markExhausted(); } catch (e) { /* bookkeeping only */ } }
          throw new AIError('百炼返回 429：这个 Key 的月预算用完了。到百炼控制台调预算，或者等下个月。', 'budget');
        }
        if (res.status === 429) throw new Retry('429');
        if (res.status >= 500) throw new Retry('5xx:' + res.status);
        if (useStream && res.status === 400 && /stream/i.test(errText(data).message + ' ' + errText(data).code)) throw new NoStream('stream');
        throw httpFail(res.status, data, route);
      }
      const ct = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';
      if (useStream && res.body && typeof res.body.getReader === 'function' && !/json/i.test(ct)) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let usage = null, finish = '', streamErr = null, done = false;
        const parser = createSSEParser((obj, end) => {
          if (end) { done = true; return; }
          const d = deltaOf(obj);
          if (d.error) streamErr = d.error;
          if (d.usage) usage = d.usage;
          if (d.finish) finish = d.finish;
          if (d.text) { text += d.text; try { onDelta(d.text, text); } catch (e) { /* the screen never stops the answer */ } }
        });
        arm(stallMs, 'stall');
        try {
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            arm(stallMs, 'stall');
            parser.push(typeof value === 'string' ? value : dec.decode(value, { stream: true }));
            if (done) break;
          }
          parser.push(dec.decode());
          parser.end();
        } catch (e) {
          if (why === 'abort') throw abortErr(text);
          if (!text) throw new Retry('network');
          throw Object.assign(new AIError(why === 'stall' ? `${route.name}中途不出字了。` : `${route.name}中途断了。`, why === 'stall' ? 'timeout' : 'truncated'), { partial: text });
        }
        if (streamErr && !text) throw httpFail(400, { error: streamErr }, route);
        if (streamErr) throw Object.assign(new AIError(`${route.name}中途报错：${errText({ error: streamErr }).message}`, 'truncated'), { partial: text });
        if (!text) throw new Retry('empty');
        return { text, usage, finish, streamed: true, model: route.model };
      }
      let data;
      try { data = await res.json(); } catch (e) { if (why === 'abort') throw abortErr(text); throw new Retry('json'); }
      const ch = data && Array.isArray(data.choices) ? data.choices[0] : null;
      const t = contentText(ch && ch.message && ch.message.content);
      if (!t.trim()) throw new Retry('empty');
      text = t;
      try { onDelta(t, t); } catch (e) { /* as above */ }
      return { text, usage: (data && data.usage) || null, finish: (ch && ch.finish_reason) || '', streamed: false, model: (data && data.model) || route.model };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  let useStream = !!stream;
  let last = null;
  for (let i = 0; ; i++) {
    try { return await once(useStream); } catch (e) {
      if (e instanceof NoStream && useStream) { useStream = false; i--; continue; }
      if (!(e instanceof Retry)) throw e;
      last = e;
      if (i >= retries.length || (e.message === 'network' && offline())) break;
      await sleep(retries[i]);
      if (signal && signal.aborted) throw abortErr(text);
    }
  }
  const m = last ? last.message : '';
  if (m === '429') throw new AIError(`${route.name}限流了（请求太频繁），稍等一会儿再问。`, 'ratelimit');
  if (m.startsWith('5xx:')) throw new AIError(`${route.name}服务出错（${m.slice(4)}），稍后再试。`, 'server');
  if (m === 'empty') throw new AIError(`${route.name}返回了空内容。`, 'empty');
  if (m === 'json') throw new AIError(`${route.name}的回答读不出来。`, 'incomplete');
  throw new AIError(route.provider === 'poe' ? '连不上中转站：网络不通，或者中转站地址不对。' : '连不上百炼：网络不通，或者请求被拦截了（开着 VPN 可以关掉再试）。', offline() ? 'offline' : 'network');
}

const charsOf = c => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((n, p) => n + (p && typeof p.text === 'string' ? p.text.length : 0), 0) : 0);
export function estimateUsage(messages = [], text = '') {
  let chars = 0, photos = 0;
  for (const m of messages || []) {
    chars += charsOf(m && m.content);
    if (m && Array.isArray(m.content)) photos += m.content.filter(p => p && p.type === 'image_url').length;
  }
  return { prompt_tokens: Math.round(chars * 0.7) + photos * 1200, completion_tokens: Math.round(String(text || '').length * 0.9), estimated: true };
}

// ---------------------------------------------------------------- the teacher's hidden last line

export function visibleText(raw) {
  let s = String(raw ?? '');
  const i = s.indexOf('<<<');
  if (i >= 0) s = s.slice(0, i);
  else s = s.replace(/<{1,2}$/, '');   // the marker is still arriving
  return s.replace(/\n?`{3}[a-z]*\s*$/i, '').replace(/\s+$/, '');
}

const WORD_RE = /^[a-z][a-z' -]{0,30}$/;
export function normMeta(o) {
  const x = o && typeof o === 'object' ? o : {};
  const kind = KINDS.includes(x.kind) ? x.kind : 'other';
  let point = String(x.point ?? '').trim().toLowerCase().replace(/^g:/, '').replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  if (point.length > 30 || point === 'other' || point === 'none') point = '';
  const words = [...new Set((Array.isArray(x.words) ? x.words : []).map(w => String(w ?? '').trim().toLowerCase().replace(/[’‘]/g, "'"))
    .filter(w => WORD_RE.test(w)))].slice(0, 5);
  const check = CHECKS.includes(x.check) ? x.check : 'none';
  return { kind, point, words, check };
}

export function parseMeta(raw) {
  const s = String(raw ?? '');
  const i = s.indexOf(META_OPEN);
  if (i < 0) return null;
  const a = s.indexOf('{', i), b = s.indexOf('}', a);
  if (a < 0 || b < 0) return null;
  try { return normMeta(JSON.parse(s.slice(a, b + 1).replace(/[“”]/g, '"'))); } catch (e) { return null; }
}
export const splitMeta = raw => ({ text: visibleText(raw), meta: parseMeta(raw) });

// ---------------------------------------------------------------- topics without the model (fallback, and her earlier questions)

const POINT_CUES = [
  [/there\s*(?:be|is|are|was|were)\b/i, 'there_be'],
  [/how\s+(?:many|much)/i, 'how_many_much'],
  [/所有格|['’]s\b|名词所有/i, 'possessive_s'],
  [/物主代词|\b(?:mine|yours|hers|ours|theirs)\b/i, 'possessive_pronoun'],
  [/代词|主格|宾格|\b(?:him|them|us)\b/i, 'personal_pronoun'],
  [/三单|第三人称|\bdoes\b|\bdoesn['’]t\b/i, 'third_s'],
  [/一般现在时/, 'present_simple'],
  [/现在进行时|进行时/, 'present_continuous'],
  [/频度副词|\b(?:always|usually|often|sometimes|never|seldom)\b/i, 'freq_adverb'],
  [/不可数|可数/, 'countable'],
  [/复数|单数/, 'plural'],
  [/be\s*动词|\b(?:am|is|are)\b/i, 'be'],
  [/冠词|\ba\b.*\ban\b|\ban\b.*\ba\b/i, 'article'],
  [/介词|\b(?:in|on|under|at)\b.*(?:区别|什么时候|怎么用)/i, 'preposition'],
  [/\bcan\b|\bcan['’]t\b/i, 'can'],
];
const STOP = new Set(['a', 'an', 'the', 'is', 'am', 'are', 'be', 'and', 'or', 'unit', 'starter', 'i', 'it', 'to', 'of']);

export function topicOf(text, { image = false } = {}) {
  const s = String(text ?? '');
  const words = [...new Set((s.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).map(w => w.toLowerCase().replace(/’/g, "'")))].filter(w => w.length > 1 && !STOP.has(w));
  const grammarAsk = /语法|区别|什么时候用|怎么用|为什么用|用.{0,6}还是|规则|时态/.test(s) || /there\s*be/i.test(s);
  let kind = 'other', point = '';
  if (image || /作业|这道题|这题|这几道|选什么|填什么|选哪个|答案|第\s*\d+\s*[题小]|练习/.test(s)) kind = 'homework';
  else if (/怎么读|发音|读音|音标|重音|怎么念/.test(s)) kind = 'pronounce';
  else if (/怎么记|怎么背|背单词|记不住|怎么学|方法|提高|怎么复习|阅读.*(?:怎么|办法)|怎么做阅读/.test(s)) kind = 'method';
  else if (/句话|这句|句子|这段|看不懂|翻译|课文/.test(s)) kind = 'sentence';
  for (const [re, id] of POINT_CUES) if (re.test(s)) { point = id; break; }
  if (kind === 'other' && point && (grammarAsk || words.length <= 3)) kind = 'grammar';
  if (kind === 'other' && words.length && /意思|单词|这个词|怎么拼|拼写|什么词/.test(s)) kind = 'word';
  if (kind === 'other' && words.length === 1 && s.replace(/[A-Za-z'’\s?？。.]/g, '').length <= 6) kind = 'word';
  // a point read from a few English words is only trusted for a grammar question or a homework item
  if (kind !== 'grammar' && kind !== 'homework') point = '';
  return { kind, point, words: words.slice(0, 5), check: 'none' };
}

export function topicLabel(meta) {
  const m = meta && typeof meta === 'object' ? meta : { kind: 'other' };
  const k = KIND_LABEL[m.kind] || KIND_LABEL.other;
  if (m.point && (m.kind === 'grammar' || m.kind === 'homework' || m.kind === 'sentence')) return `${k} · ${POINT_LABEL[m.point] || m.point}`;
  if ((m.kind === 'word' || m.kind === 'pronounce') && m.words && m.words[0]) return `${k} · ${m.words[0]}`;
  return k;
}

// ---------------------------------------------------------------- simple formatting (no HTML)

function spansOf(s) {
  const out = [];
  const str = String(s ?? '').replace(/`/g, '');
  const parts = str.split('**');
  // an odd count means a ** still open (streaming): the rest is bold
  parts.forEach((p, i) => { if (p) out.push({ text: p.replace(/__(.+?)__/g, '$1'), bold: i % 2 === 1 }); });
  return out;
}

export function formatBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const t = raw.trim();
    if (!t || /^[-*_]{3,}$/.test(t)) { cur = null; continue; }
    let m;
    if ((m = t.match(/^[-*•·]\s+(.*)$/))) {
      if (!cur || cur.type !== 'ul') { cur = { type: 'ul', items: [] }; blocks.push(cur); }
      cur.items.push(spansOf(m[1]));
    } else if ((m = t.match(/^(\d{1,2})[.、)）]\s*(.+)$/))) {
      if (!cur || cur.type !== 'ol') { cur = { type: 'ol', items: [] }; blocks.push(cur); }
      cur.items.push({ n: Number(m[1]), spans: spansOf(m[2]) });
    } else if ((m = t.match(/^#{1,6}\s+(.*)$/))) {
      cur = { type: 'p', lines: [[{ text: m[1].replace(/\*\*/g, ''), bold: true }]] };
      blocks.push(cur);
      cur = null;
    } else {
      if (!cur || cur.type !== 'p') { cur = { type: 'p', lines: [] }; blocks.push(cur); }
      cur.lines.push(spansOf(t.replace(/^>\s?/, '')));
    }
  }
  return blocks;
}

export function tokens(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    if (m.index > last) out.push({ s: s.slice(last, m.index), en: false });
    out.push({ s: m[0], en: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ s: s.slice(last), en: false });
  return out;
}

// The English she should hear: example sentences first; single words only when there is no sentence.
// Lines that show a wrong sentence (换个讲法 compares right and wrong: “不对：There is two cats.”) are never read aloud.
const WRONG_LINE = /不对|错误|错的|错：|✗|×|❌|不能说|不说/;
export function speakable(text, cap = 1200) {
  const s = visibleText(text).split('\n').filter(l => !WRONG_LINE.test(l)).join('\n').replace(/\*\*/g, '').replace(/[’‘]/g, "'").replace(/_{2,}|＿+/g, ' blank ').replace(/\s\/\s/g, ' ').replace(/·/g, '');
  const segs = s.split(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef“”\n]+/)
    .map(x => x.replace(/\s+/g, ' ').replace(/^[\s\-–•*\d.、)(:/=]+/, '').replace(/[\s(:/=-]+$/, '').trim())
    .filter(x => /[A-Za-z]{2,}/.test(x));
  const count = x => (x.match(/[A-Za-z]+/g) || []).length;
  const seen = new Set();
  const uniq = a => a.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const sentences = uniq(segs.filter(x => count(x) >= 3));
  const end = x => (/[.?!]$/.test(x) ? x : x + '.');
  const out = sentences.length ? sentences.map(end).join(' ') : uniq(segs).join(', ');
  return out.slice(0, cap).trim();
}

// ---------------------------------------------------------------- what the teacher knows about her

const WORD_TAGS = new Set(['form', 'category', 'meaning', 'sound']);
const STATUS_ZH = { new: '还没开始', learning: '在学', practicing: '在练', steady: '练稳了' };
const INTAKE_ITEMS = [['likes', '她喜欢的'], ['dislikes', '她不太喜欢的'], ['scores', '最近的英语分数'], ['mistakes', '最近的错题或听写错词'],
  ['teacher', '学校老师说过的问题'], ['on_mistake', '做错题的时候她通常']];
const OPTION_ZH = { on_mistake: { retry: '再试一次', skip: '想跳过', upset: '着急', ask: '来问人' } };

export function missLines(events = [], { wordOf = s => s, tagName = t => t, max = 8 } = {}) {
  const tagN = new Map(), wordN = new Map();
  for (const e of events || []) {
    if (!e || e.correct !== false || e.first_try === false) continue;   // a second try at the same question counts once
    if (e.type !== 'answer' && e.type !== 'dictation') continue;
    const t = e.misconception;
    if (t && !WORD_TAGS.has(t) && e.type === 'answer') tagN.set(t, (tagN.get(t) || 0) + 1);
    else if (e.slug) wordN.set(e.slug, (wordN.get(e.slug) || 0) + 1);
  }
  const sorted = m => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const out = [];
  for (const [t, n] of sorted(tagN).slice(0, 5)) out.push(`${tagName(t) || t}（最近 3 周错了 ${n} 次）`);
  for (const [slug, n] of sorted(wordN)) {
    if (out.length >= max) break;
    if (n < 2) break;
    out.push(`单词 ${wordOf(slug) || slug}（最近 3 周错了 ${n} 次）`);
  }
  return out.slice(0, max);
}

// kv 'parent.intake' -> lines for the prompt, plus the two answers that change how the teacher talks
export function intakeInfo(rec) {
  const a = rec && typeof rec === 'object' ? (rec.answers && typeof rec.answers === 'object' ? rec.answers : rec) : {};
  const text = v => (Array.isArray(v) ? v.filter(x => x != null && String(x).trim()).map(String).join('，') : v == null ? '' : String(v)).trim();
  const lines = [];
  for (const [id, label] of INTAKE_ITEMS) {
    let v = a[id];
    if (OPTION_ZH[id]) v = (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => OPTION_ZH[id][x]).filter(Boolean);
    const t = text(v);
    if (t) lines.push({ label, value: t });
  }
  const one = v => (Array.isArray(v) ? v[0] : v);
  const praise = ['specific', 'short', 'dislike'].includes(one(a.on_praise)) ? one(a.on_praise) : '';
  const phonics = ['yes', 'some', 'not_yet'].includes(one(a.phonics)) ? one(a.phonics) : '';
  return { lines, praise, phonics };
}

function unitOrderOf(cur, id) {
  try { const n = cur && cur.unitOrder ? cur.unitOrder(id) : NaN; if (Number.isFinite(n) && n < 100) return n; } catch (e) { /* default below */ }
  return defaultUnitOrder(id);
}

export function grammarCards(kv, now = new Date(), unitId = '', cur = null) {
  let c = null;
  try { c = G.content(); } catch (e) { c = null; }
  if (!c || !Array.isArray(c.cards)) return [];
  let sum = [];
  try { sum = G.summary(G.grammarState(kv, c), now, { content: c, tags: cur && cur.tags }) || []; } catch (e) { sum = []; }
  const byId = new Map(sum.map(s => [s.id, s]));
  const lim = unitId ? unitOrderOf(cur, unitId) : Infinity;
  return c.cards
    .filter(card => unitOrderOf(cur, card.unit) <= lim || (byId.get(card.id) && byId.get(card.id).status !== 'new'))
    .slice(0, 8)
    .map(card => {
      const s = byId.get(card.id);
      return { title: card.title, unit: shortUnit(card.unit), status: (s && STATUS_ZH[s.status]) || '',
        rule: (Array.isArray(card.rule) ? card.rule : []).slice(0, 4), tags: ((s && s.tags) || []).slice(0, 2).map(t => t.zh || t.tag) };
    });
}

const short = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n) + '…' : t; };
export function recentAsks(kv, { exclude = '', max = 3 } = {}) {
  let keys = [];
  try { keys = kv.keys(KV_PREFIX).filter(isDayKey).sort().reverse(); } catch (e) { keys = []; }
  const out = [];
  for (const k of keys) {
    let rec = null;
    try { rec = kv.peek(k, null); } catch (e) { rec = null; }
    const msgs = normDay(rec, k.slice(KV_PREFIX.length)).messages;
    for (let i = msgs.length - 1; i >= 0 && out.length < max; i--) {
      const m = msgs[i];
      if (m.role !== 'user' || m.quick || m.id === exclude || !(clean(m.text) || m.image)) continue;
      const reply = msgs.find(x => x.role === 'assistant' && x.reply_to === m.id && x.meta);
      const meta = (reply && reply.meta) || topicOf(m.text, { image: m.image });
      out.push(`${topicLabel(meta)}：“${short(m.text || '（一张照片）', 30)}”（${md(rec && rec.date || k.slice(KV_PREFIX.length))}）`);
    }
    if (out.length >= max) break;
  }
  return out;
}

// kv 'teacher.stuck' (teacher.js mergeStuck): each line with its evidence; old shapes (strings, bare arrays) read too
const stuckLines = v => (Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : [])
  .map(x => (typeof x === 'string' ? x : !x ? '' : clean(x.text || x.label || x.what || '') + (clean(x.text || x.label || x.what || '') && clean(x.evidence) ? `（${clean(x.evidence)}）` : '')))
  .map(clean).filter(Boolean).slice(0, 5);

// ---------------------------------------------------------------- 讲对: the grammar card for the point she asks about

export function focusPoints(user = {}, history = []) {
  const text = String((user && (user.send || user.text)) || '');
  const out = [];
  const t = topicOf(text, { image: !!(user && user.image) });
  if (t.point) out.push(t.point);
  // a follow-up in the same thread (还是不懂, 再举个例子, her answer): the point the teacher was on
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === 'assistant' && m.meta && m.meta.point) { out.push(m.meta.point); break; }
  }
  // a sentence she cannot read: the grammar in it
  if (t.kind === 'sentence') for (const [re, id] of POINT_CUES) if (re.test(text)) { out.push(id); break; }
  return [...new Set(out.map(p => T.normPoint(p)).filter(Boolean))];
}

export function focusCards(points = [], c = null) {
  const ct = c || safe(() => G.content());
  if (!ct) return [];
  const out = [];
  const seen = new Set();
  for (const p of points || []) {
    const pc = T.pointCard(p, ct);
    if (!pc || seen.has(pc.card.id)) continue;
    seen.add(pc.card.id);
    const card = pc.card;
    out.push({ title: card.title, unit: shortUnit(card.unit), rule: (Array.isArray(card.rule) ? card.rule : []).slice(0, 8),
      table: card.table && Array.isArray(card.table.head) ? card.table : null,
      examples: (Array.isArray(card.examples) ? card.examples : []).slice(0, 3).map(e => ({ en: e.en, zh: e.zh })) });
    if (out.length >= 2) break;
  }
  return out;
}

// ---------------------------------------------------------------- 讲对: example sentences only with words she knows

const NAMES = new Set(['tom', 'lily', 'lucy', 'mike', 'mia', 'leo', 'kitty', 'momo', 'snowy', 'emma', 'amy', 'sam', 'ben', 'tony', 'betty', 'peter',
  'jack', 'kate', 'jim', 'ann', 'john', 'mary', 'alice', 'bob', 'david', 'linda', 'daming', 'lingling', 'wang', 'li', 'zhang', 'chen', 'liu',
  'ms', 'mr', 'mrs', 'miss', 'beijing', 'china', 'english', 'chinese', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const CONTRACT = { "can't": 'can', "won't": 'will', "don't": 'do', "doesn't": 'does', "didn't": 'did', "isn't": 'is', "aren't": 'are',
  "wasn't": 'was', "weren't": 'were', "haven't": 'have', "hasn't": 'has', "i'm": 'i', "let's": 'let' };
const plainWord = w => { const x = String(w || '').toLowerCase().replace(/[’‘]/g, "'"); return CONTRACT[x] || x.replace(/'(s|re|m|ll|ve|d)$/, '').replace(/'$/, ''); };

export function knownChecker(app, ctx = {}, { extra = [] } = {}) {
  const cur = app && app.curriculum;
  if (!cur || typeof cur.isPrimary !== 'function') return null;
  const counts = safe(() => (cur.counts ? cur.counts() : null));
  if (counts && !counts.primary) return null;   // the word lists did not load: cannot tell
  const v = (ctx && ctx.vocab) || {};
  const book = new Set();
  for (const w of v.words || []) for (const p of String(w).toLowerCase().split(/[\s/]+/)) if (p) book.add(p.replace(/[^a-z'-]/g, ''));
  const noBook = !(Number(v.textbook) > 0);
  const ex = new Set();
  for (const w of extra || []) for (const p of String(w || '').toLowerCase().match(/[a-z][a-z'’-]*/g) || []) ex.add(plainWord(p));
  const yes = w => !!w && (book.has(w) || ex.has(w) || NAMES.has(w) || !!safe(() => cur.isPrimary(w)) || (noBook && !!safe(() => cur.isRequired && cur.isRequired(w))));
  // primary words the 505 check found she does not know yet (0.5.0) do not count as known, unless she used them herself
  const unknown = new Set((Array.isArray(v.unknown) ? v.unknown : []).map(x => plainWord(x)).filter(Boolean));
  return word => {
    const w = plainWord(word);
    if (!w || w.length < 2 || /\d/.test(w)) return true;
    if (unknown.has(w) && !ex.has(w)) return false;
    if (yes(w)) return true;
    const bases = [safe(() => cur.baseOf && cur.baseOf(w)), ...safe(() => inflectionBases(w), [])].filter(Boolean);
    if (bases.some(yes)) return true;
    return !!safe(() => { const e = app.words && app.words.get && app.words.get(slugify(w)); return e && e.favorited; });
  };
}

// the English example sentences (a run of 3 words or more between Chinese); a word with its Chinese in brackets right after is fine
export function offList(text, known) {
  if (typeof known !== 'function') return [];
  const out = [];
  const add = w => { const k = plainWord(w); if (!out.includes(k)) out.push(k); };
  // pen·cil is one word; /ˈpensl/ (phonetics) is not English to check
  const body = visibleText(text).replace(/\*\*/g, '').replace(/[’‘]/g, "'").replace(/_{2,}|＿+/g, ' ').replace(/[·•]/g, '').replace(/\/[^/\n]{1,30}\//g, ' ');
  for (const line of body.split('\n')) {
    const s = line.replace(/([A-Za-z][A-Za-z'-]*)\s*[（(][^）)]*[\u4e00-\u9fff][^）)]*[）)]/g, ' it ');
    for (const seg of s.split(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef“”"：:；;（）()]+/)) {
      const toks = [...seg.matchAll(/[A-Za-z][A-Za-z'-]*/g)];
      if (toks.length < 3) continue;
      for (const m of toks) {
        for (const part of m[0].split('-').filter(Boolean)) {
          const before = seg.slice(0, m.index);
          const start = !/[A-Za-z]/.test(before) || /[.?!]\s*$/.test(before);
          if (/^[A-Z]/.test(part) && part !== 'I' && !start) continue;   // a name inside a sentence
          if (/^[A-Z]{2,4}$/.test(part)) continue;                          // OK, TV
          if (!known(part)) add(part);
        }
      }
    }
  }
  return out.slice(0, 8);
}

export const simplifyAsk = words => `（这条是 App 写给老师的，不是她说的。）刚才的英文例句里有几个词她可能还不认识：${words.join('、')}。` +
  '请把刚才的回答整段重写一遍：结论、讲法和最后的小问题都不变，只把英文例句换成她认识的词（小学词和她学过的课本词）；实在要用的词，后面用括号写中文。' +
  `直接写重写后的回答，开头不要说“好的”。最后一行照样写 ${META_OPEN} {...}${META_CLOSE}。`;
const herWords = history => (history || []).filter(m => m && m.role === 'user').map(m => String(m.send || m.text || '')).join(' ');
const focusWords = focus => (focus || []).map(g => [...(g.examples || []).map(e => e.en), ...(g.rule || [])].join(' ')).join(' ');

export async function gatherContext(app, { now = new Date(), exclude = '', events = null, focus = [] } = {}) {
  const kv = app.kv;
  const peek = (k, d) => { try { return kv.peek(k, d); } catch (e) { return d; } };
  const profile = peek('profile', {}) || {};
  const progress = peek('progress', {}) || {};
  const cur = app.curriculum || null;
  const title = id => { try { return (cur && cur.unitTitle && cur.unitTitle(id)) || shortUnit(id); } catch (e) { return shortUnit(id); } };
  const unit = progress.unit ? { id: progress.unit, title: title(progress.unit) } : null;
  const range = progress.examFrom || progress.examTo
    ? [progress.examFrom, progress.examTo].filter(Boolean).map(shortUnit).filter((x, i, a) => a.indexOf(x) === i).join(' 到 ') : '';
  const exam = progress.examDate || range ? { date: progress.examDate || '', range } : null;

  // the words she has met: primary 505 and the textbook units up to where the class is
  let vocab = null;
  try {
    let primary = 505;
    try { const c = cur && cur.counts ? cur.counts() : null; if (c && c.primary) primary = c.primary; } catch (e) { /* 505 */ }
    let units = [];
    try { units = (cur && cur.units ? cur.units() : []) || []; } catch (e) { units = []; }
    const lim = progress.unit ? unitOrderOf(cur, progress.unit) : Infinity;
    const upto = units.filter(u => (Number.isFinite(u.order) ? u.order : unitOrderOf(cur, u.id)) <= lim);
    const words = [];
    const seen = new Set();
    for (const u of upto) {
      let ws = [];
      try { ws = cur.unitWords(u.id) || []; } catch (e) { ws = []; }
      for (const w of ws) { const t = clean(w && w.w); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); words.push(t); } }
    }
    vocab = { primary, textbook: words.length, upTo: upto.length ? shortUnit(upto[upto.length - 1].id) : '', words };
  } catch (e) { vocab = { primary: 505, textbook: 0, upTo: '', words: [] }; }
  // 0.5.0: the primary words the 505 check found she does not know (screen.js unknownPrimary): kept out of examples
  try { if (S.content()) vocab.unknown = S.unknownPrimary(kv).slice(0, 40); } catch (e) { /* no list */ }

  let evs = events;
  if (!evs) {
    try { evs = await app.events.query({ since: new Date(now.getTime() - MISS_DAYS * 864e5), type: ['answer', 'dictation'] }); } catch (e) { evs = []; }
  }
  const wordOf = slug => { try { const e = app.words && app.words.get(slug); return (e && e.headword) || slug; } catch (e) { return slug; } };
  const tagName = t => {
    try { const x = cur && cur.tags && cur.tags[t]; if (x && x.zh) return x.zh; } catch (e) { /* next */ }
    try { const c = G.content(); if (c && c.tagName) return c.tagName(t) || t; } catch (e) { /* the id */ }
    return t;
  };
  const intake = intakeInfo(peek('parent.intake', null));
  return {
    now, name: clean(profile.name) || 'Emma', teacherName: clean(profile.teacherName),
    unit, exam, vocab,
    misses: missLines(evs || [], { wordOf, tagName }),
    grammar: grammarCards(kv, now, progress.unit || '', cur),
    intake: intake.lines, praise: intake.praise, phonics: intake.phonics,
    recent: recentAsks(kv, { exclude }),
    stuck: stuckLines(peek('teacher.stuck', null)),
    asked: safe(() => T.askedLines(T.readAsked(kv), now), []),
    focus: safe(() => focusCards(focus), []),
  };
}

// ---------------------------------------------------------------- the pretend teacher (?mock=1)

const META = o => `\n${META_OPEN} ${JSON.stringify(o)}>>>`;
export function mockAnswer(text, { image = false, quick = '' } = {}) {
  const s = String(text ?? '');
  if (quick === 'again') {
    return '**先只看一件事：说的是“哪里有”，还是“谁有”。**\n\n- 哪里有：用 **There is**。There is a cat on the bed.（床上有一只猫。）\n- 谁有：用 **have / has**。Tom has a cat.（Tom 有一只猫。）\n\n你来试试：___ a pen in my bag.（我包里有一支笔。）填 There is 还是 I have？' + META({ kind: 'grammar', point: 'there_be', words: [], check: 'none' });
  }
  if (quick === 'example') return '**再来一个：**\n\nThere are two cats in the box.（盒子里有两只猫。）\n\n这里是 two cats，两只，所以用 **are**。' + META({ kind: 'grammar', point: 'there_be', words: ['box'], check: 'none' });
  if (quick === 'quiz') return '**来一道：**\n\nThere ___ a book on the desk.（桌子上有一本书。）\n\n填 is 还是 are？' + META({ kind: 'grammar', point: 'there_be', words: ['book', 'desk'], check: 'none' });
  if (quick === 'retell') {
    return '**换个角度：把对的和不对的放在一起比。**\n\n- 对：There **are** two cats.（有两只猫。）\n- 不对：There is two cats.（two cats 是两只，不能用 is。）\n\n先看后面是一个还是几个，再选 is 或 are。\n\n你来试试：There ___ three books on the desk.（桌子上有三本书。）填 is 还是 are？' +
      META({ kind: 'grammar', point: 'there_be', words: [], check: 'none' });
  }
  if (quick === 'recheck') return '**我又核对了一遍，刚才讲的没有错。**\n\n如果学校老师讲的不一样，以学校老师为准。你可以把老师的原话告诉我，我们一起对一下。' + META({ kind: 'other', point: '', words: [], check: 'none' });
  if (/^\s*(?:is|are|has|have|there is|i have)\s*[.。]?\s*$/i.test(s)) {
    const good = /^\s*(?:is|has|there is)\s*[.。]?\s*$/i.test(s);
    return (good ? `**对，是 ${s.trim()}。**\n\n你看出来了：这里说的是一个东西，所以用单数。` : `**这里要用 is。**\n\n后面是 a book，一本书，只有一个，所以用 is。`) +
      META({ kind: 'grammar', point: 'there_be', words: [], check: good ? 'right' : 'wrong' });
  }
  if (image) return '**我看到这张照片了。**\n\n你想问哪一道？先告诉我题号，再说说你是怎么想的，我们一步步来。' + META({ kind: 'homework', point: '', words: [], check: 'none' });
  if (/there\s*be/i.test(s) && /have/i.test(s)) {
    return '**there be 说“某个地方有什么”，have 说“谁有什么”。**\n\n先看句子在说地方，还是在说人：\n\n- 说地方：**There is** a cat in my room.（我房间里有一只猫。）\n- 说人：**I have** a cat.（我有一只猫。）\n\n小问题：___ a book on the desk.（桌子上有一本书。）填 There is 还是 I have？' +
      META({ kind: 'grammar', point: 'there_be', words: ['have'], check: 'none' });
  }
  if (/怎么记|怎么背|记住/.test(s)) {
    return '**每天只记 5 个，第二天先考自己，再记新的。**\n\n1. 看一个词，读出声，按音节拍手：pen·cil。\n2. 盖住英文，看中文写一遍。\n3. 写错的那个，明天第一个再写。\n\n今天就试 5 个。你想从哪 5 个开始？' + META({ kind: 'method', point: '', words: [], check: 'none' });
  }
  if (/什么意思|看不懂|这句/.test(s)) {
    return '**先把这句发给我，我们一块一块拆。**\n\n拆句子分三步：先用 / 断开，再找“谁 + 做什么”，最后看生词。\n\n比如：My cat / is / on the bed.（我的猫在床上。）主干是 My cat is。' + META({ kind: 'sentence', point: '', words: [], check: 'none' });
  }
  return '**这是模拟模式的老师，不花钱，回答是假的。**\n\n真的老师会先一句话回答你，再讲为什么，举个例子，最后问你一个小问题，看你懂了没有。' + META({ kind: 'other', point: '', words: [], check: 'none' });
}

export async function mockStream(text, { image = false, quick = '', onDelta = () => {}, signal = null, sleep = sleepMs, step = 24, size = 5 } = {}) {
  const full = mockAnswer(text, { image, quick });
  let out = '';
  await sleep(300);
  for (let i = 0; i < full.length; i += size) {
    if (signal && signal.aborted) throw abortErr(out);
    const piece = full.slice(i, i + size);
    out += piece;
    try { onDelta(piece, out); } catch (e) { /* as streamChat */ }
    await sleep(step);
  }
  return { text: out, usage: null, finish: 'stop', streamed: true, model: 'mock', mock: true };
}

// ---------------------------------------------------------------- storage

const ROLES = ['user', 'assistant'];
const KEEP_FIELDS = ['id', 'role', 'text', 'at', 'thread', 'send', 'quick', 'image', 'reply_to', 'meta', 'model', 'provider', 'error', 'stopped', 'flagged', 'retry', 'simplified'];
function normMsg(m) {
  if (!m || typeof m !== 'object' || !ROLES.includes(m.role) || !m.id) return null;
  const out = {};
  for (const k of KEEP_FIELDS) if (m[k] !== undefined && m[k] !== null && m[k] !== '' && m[k] !== false) out[k] = m[k];
  out.text = typeof m.text === 'string' ? m.text : '';
  out.thread = String(m.thread || 't0');
  if (out.meta) out.meta = normMeta(out.meta);
  return out;
}
export function normDay(rec, date = '') {
  const r = rec && typeof rec === 'object' ? rec : {};
  const messages = (Array.isArray(r.messages) ? r.messages : Array.isArray(rec) ? rec : []).map(normMsg).filter(Boolean);
  return { version: 1, date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : date, messages };
}

let idN = 0;
const newId = p => p + Date.now().toString(36) + (++idN).toString(36) + Math.random().toString(36).slice(2, 5);

export function createChat(app, { fetchImpl = null, now = () => new Date(), sleep = sleepMs } = {}) {
  const kv = app.kv;
  const images = new Map();       // message id -> data URL, this session only
  let date = '', msgs = [], thread = '';
  let busy = false, ctrl = null, pruned = false;

  const settingsNow = () => {
    let s = {};
    try { s = (app.settings && app.settings()) || {}; } catch (e) { s = {}; }
    let forced = false;
    try { forced = !!(app.mockForced && app.mockForced()); } catch (e) { forced = false; }
    return { ...CHAT_DEFAULTS, ...s, mock: !!s.mock || forced };
  };
  function loadDay() {
    date = ymd(now());
    let rec = null;
    try { rec = kv.peek(dayKey(date), null); } catch (e) { rec = null; }
    msgs = normDay(rec, date).messages;
    const last = msgs[msgs.length - 1];
    thread = last && now() - new Date(last.at) < THREAD_GAP_MS ? last.thread : newId('t');
  }
  loadDay();
  function ensureDay() { if (ymd(now()) !== date) loadDay(); }

  async function save() {
    const rec = { version: 1, date, messages: msgs.filter(m => !m.transient).map(normMsg).filter(Boolean) };
    try { await kv.set(dayKey(date), rec); } catch (e) { console.warn('chat: save failed:', (e && e.message) || e); }
    if (!pruned) {
      pruned = true;
      const cut = ymd(new Date(now().getTime() - KEEP_DAYS * 864e5));
      try { for (const k of kv.keys(KV_PREFIX)) if (isDayKey(k) && k.slice(KV_PREFIX.length) < cut) await kv.delete(k); } catch (e) { /* next time */ }
    }
  }
  const log = async ev => { try { if (app.events && app.events.log) await app.events.log(ev); } catch (e) { /* never blocks */ } };

  async function logAsk(user, teacher, { retry = false } = {}) {
    const meta = teacher.meta || topicOf(user.send || user.text, { image: !!user.image });
    let unit = '';
    try { unit = (kv.peek('progress', {}) || {}).unit || ''; } catch (e) { unit = ''; }
    await log({ type: 'ask', step: 'chat', qid: 'chat', who: 'emma', item: 'chat:' + user.id, about: 'chat:' + meta.kind,
      kind: meta.kind, point: meta.point ? 'g:' + meta.point : '', words: meta.words || [], topic: topicLabel(meta),
      check: (teacher.meta && teacher.meta.check) || 'none', followup: user.quick || '', image: !!user.image, unit: unit || undefined,
      q: short(user.text || (user.image ? '（照片）' : ''), 60), ok: !teacher.error, code: teacher.error || undefined,
      model: teacher.model || undefined, provider: teacher.provider || undefined, retry: retry || undefined });
  }

  async function reply(user, { onUpdate = () => {}, retry = false } = {}) {
    const teacher = { id: newId('m'), role: 'assistant', text: '', at: isoLocal(now()), thread: user.thread, reply_to: user.id, pending: true };
    msgs.push(teacher);
    busy = true;
    ctrl = new AbortController();
    const signal = ctrl.signal;
    const update = () => { try { onUpdate(teacher); } catch (e) { /* the screen never stops the answer */ } };
    update();
    let raw = '', messages = null, route = null;
    const onDelta = (piece, all) => { raw = all; teacher.text = visibleText(all); update(); };
    try {
      const s = settingsNow();
      const history = msgs.filter(m => m.thread === user.thread && m !== teacher && !m.transient);
      let res;
      if (s.mock) {
        res = await mockStream(user.send || user.text, { image: !!user.image, quick: user.quick || '', onDelta, signal, sleep });
        teacher.model = 'mock';
      } else {
        const hasPhoto = history.some(m => m.role === 'user' && m.image && images.has(m.id));
        route = chatRoute(s, { image: hasPhoto });
        if (!route.url || !route.key) {
          throw new AIError(route.provider === 'poe' ? '问老师设成了 Poe，但还没填中转站地址和 Poe Key。' : '还没填百炼 API Key：先在家长区填好。', 'nokey');
        }
        if (!keyOk(route.key)) throw new AIError(`${route.name} 的 Key 格式不对：在家长区重新粘贴。`, 'badkey');
        const why = app.budget && app.budget.blockReason ? app.budget.blockReason(BUDGET_KIND) : '';
        if (why === 'month') throw new AIError('今天已经收到过百炼的“预算用完”（429），App 今天不再发请求。', 'budget');
        if (why) throw new AIError(why === 'kind' ? '今天问老师的花费到了上限（每天 5 元），明天恢复。' : '今天的花费到了 App 里设的上限，明天恢复。可以在家长区调高上限。', 'budget-day');
        const ctx = await gatherContext(app, { now: now(), exclude: user.id, focus: focusPoints(user, history) });
        messages = buildMessages(buildSystemPrompt(ctx), history, images);
        res = await streamChat({ route, messages, fetchImpl, signal, onDelta, budget: app.budget, sleep });
        teacher.model = res.model || route.model;
        teacher.provider = route.provider;
        record(res.usage || estimateUsage(messages, res.text), teacher.model);
        if (!hasPhoto && res.finish !== 'length') res = await simpler(res, { route, messages, ctx, history, signal, update, teacher });
      }
      const { text, meta } = splitMeta(res.text);
      teacher.text = text;
      if (meta) teacher.meta = meta;
      else if (res.firstMeta) teacher.meta = res.firstMeta;
      if (!text) throw new AIError('老师回了空话。', 'empty');
      if (res.finish === 'length') teacher.error = 'truncated';
    } catch (err) {
      const code = (err && err.code) || 'http';
      if (err && err.partial) {
        const parts = splitMeta(err.partial);
        teacher.text = parts.text;
        if (parts.meta) teacher.meta = parts.meta;
        if (messages && route) record(estimateUsage(messages, err.partial), route.model);
      }
      if (code === 'abort') { if (teacher.text) teacher.stopped = true; else teacher.transient = true; }
      else {
        teacher.error = code;
        teacher.detail = (err && err.message) || String(err);
        if (!teacher.text) teacher.transient = true;
      }
      if (raw && !teacher.text) teacher.text = visibleText(raw);
    } finally {
      delete teacher.pending;
      busy = false;
      ctrl = null;
    }
    if (teacher.transient && !teacher.error) msgs.splice(msgs.indexOf(teacher), 1);   // stopped before a word
    await save();
    update();
    if (!teacher.transient || teacher.error) await logAsk(user, teacher, { retry });
    if (!teacher.transient && !teacher.error && teacher.text) await noteAsked(user, teacher);
    return teacher;
  }

  // 讲对: more than OFF_MAX words she does not know in the English examples -> the teacher rewrites the answer once with
  // simpler words. The first answer stays on screen until the rewrite starts arriving, and stays if the rewrite fails.
  async function simpler(res, { route, messages, ctx, history, signal, update, teacher }) {
    const first = splitMeta(res.text);
    const known = knownChecker(app, ctx, { extra: [herWords(history), ...((first.meta && first.meta.words) || []), focusWords(ctx.focus)] });
    const off = known ? offList(first.text, known) : [];
    if (off.length <= OFF_MAX) return res;
    const more = [...messages, { role: 'assistant', content: res.text }, { role: 'user', content: simplifyAsk(off) }];
    if (teacher) { teacher.simplifying = true; update(); }
    try {
      const res2 = await streamChat({ route, messages: more, fetchImpl, signal, budget: app.budget, sleep,
        onDelta: (piece, all) => { const t = visibleText(all); if (t && teacher) { teacher.text = t; update(); } } });
      record(res2.usage || estimateUsage(more, res2.text), res2.model || route.model);
      if (visibleText(res2.text).trim() && res2.finish !== 'length') {
        if (teacher) teacher.simplified = off;
        return { ...res2, model: res.model, firstMeta: first.meta };
      }
    } catch (err) {
      if (err && err.partial) record(estimateUsage(more, err.partial), route.model);
    } finally {
      if (teacher) delete teacher.simplifying;
    }
    if (teacher) { teacher.text = first.text; delete teacher.simplified; }
    return res;
  }

  // “我问过的” (teacher.js): what this answer explained comes back in the warm-up two and five days later
  async function noteAsked(user, teacher) {
    if (user.quick === 'recheck') return;   // checking again is not a new explanation
    try {
      const meta = teacher.meta || topicOf(user.send || user.text, { image: !!user.image });
      const res = T.noteAsked(T.readAsked(kv), { meta, text: user.quick ? '' : user.text, now: now(), msg: teacher.id });
      if (res.keys.length) await kv.set(T.ASKED_KEY, res.state);
    } catch (e) { /* bookkeeping only */ }
  }
  function record(usage, model) {
    try { if (app.budget && app.budget.record && usage) app.budget.record(usage, BUDGET_KIND, model); } catch (e) { /* bookkeeping only */ }
  }

  return {
    messages: () => (ensureDay(), msgs),
    thread: () => thread,
    isBusy: () => busy,
    image: id => images.get(id) || null,
    async send({ text = '', image = null, send = '', quick = '' } = {}, { onUpdate } = {}) {
      ensureDay();
      const t = String(text || '').trim();
      if (busy || (!t && !image)) return null;
      const last = msgs[msgs.length - 1];
      if (last && now() - new Date(last.at) >= THREAD_GAP_MS && last.thread === thread) thread = newId('t');
      const user = { id: newId('m'), role: 'user', text: t, at: isoLocal(now()), thread };
      if (send && send !== t) user.send = String(send);
      if (quick) user.quick = String(quick);
      if (image) { user.image = true; images.set(user.id, image); }
      msgs.push(user);
      await save();
      return reply(user, { onUpdate });
    },
    async retry(teacherId, { onUpdate } = {}) {
      if (busy) return null;
      const i = msgs.findIndex(m => m.id === teacherId && m.role === 'assistant');
      if (i < 0) return null;
      const user = msgs.find(m => m.id === msgs[i].reply_to && m.role === 'user');
      if (!user) return null;
      msgs.splice(i, 1);
      return reply(user, { onUpdate, retry: true });
    },
    stop() { if (ctrl) ctrl.abort(); },
    newThread() { thread = newId('t'); return thread; },
    async flag(teacherId) {
      const m = msgs.find(x => x.id === teacherId && x.role === 'assistant');
      if (!m) return false;
      m.flagged = true;
      await save();
      await log({ type: 'flag', step: 'chat', reason: 'chat', item: 'chat:' + m.id, kind: (m.meta && m.meta.kind) || undefined,
        point: m.meta && m.meta.point ? 'g:' + m.meta.point : undefined, model: m.model || undefined });
      return true;
    },
    history({ days = KEEP_DAYS } = {}) {
      ensureDay();
      let keys = [];
      try { keys = kv.keys(KV_PREFIX).filter(isDayKey).filter(k => k !== dayKey(date)).sort().reverse().slice(0, days); } catch (e) { keys = []; }
      return keys.map(k => { let rec = null; try { rec = kv.peek(k, null); } catch (e) { rec = null; } return normDay(rec, k.slice(KV_PREFIX.length)); })
        .filter(d => d.messages.length);
    },
  };
}
