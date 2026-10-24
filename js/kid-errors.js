// 孩子版报错文案（DESIGN 10.1、10.7）：Emma 看到的出错提示不提 Key、欠费、模型名、百炼、Poe，只说发生了什么、
// 她能做什么（“先看看词典里的意思”“告诉家长”）。原来的技术说明留给家长区（parentDetail）。
// 负责：孩子版报错与查词 agent（kid-errors.js、prompts.js）。
//
// 导出
//   KID_COPY                         { code: 中文一句 }，code 来自 ai.js 的 AIError.code、tts.js 的 TTSError.code、budget
//   WHERE_COPY                       按地方换说法：{ look: {...}, lookDict: {...}, lesson: {...}, voice: {...}, dictation: {...}, chat: {...} }
//   kidMessage(err, { where, dict }) -> string   给孩子看的一句。where：'look' 查词 | 'lesson' 上课 | 'voice' 朗读 | 'dictation' | 'chat' 问老师
//                                    dict：查词页下面有离线词典的意思（为真时句子里带“先看看词典里的意思吧”）
//   needsParent(err) -> bool         这个错要家长处理（Key、额度、模型权限）：界面上显示“告诉家长”，不显示“去设置”
//   parentDetail(err) -> string      原来的技术说明（err.message），只在家长区显示
//   BANNED                           孩子文案里不许出现的字（测试用）
// 安全话题拦截（care 规则、本地拦截词表、离线词典的成人义项过滤）10-24 按 Wei 的要求删了：die、kill 这类课本词照常讲。
//
// 规则：中文弯引号，不用破折号，不用感叹号，句子短；不出现 Key、API、欠费、预算、模型、百炼、Poe、qwen、429 这些字。
// 依赖：无。

export const BANNED = /key|api|欠费|预算|模型|百炼|poe|qwen|千问|429|—|「|」|!|！/i;

const ASK_PARENT = '老师这边出了点问题，告诉家长。';
const MONTH_OUT = '这个月的老师额度用完了，告诉家长。';

export const KID_COPY = {
  network: '老师这会儿连不上，等一下再试。',
  offline: '现在没连网，连上以后再试。',
  timeout: '网有点慢，等一下再试一次。',
  nokey: '老师还没准备好，告诉家长。',
  badkey: ASK_PARENT,
  billing: MONTH_OUT,
  budget: MONTH_OUT,
  'budget-day': '今天的老师额度用完了，明天再来。复习还能接着做。',
  model: ASK_PARENT,
  forbidden: ASK_PARENT,
  ratelimit: '老师这会儿有点忙，等一会儿再试。',
  server: '老师这会儿有点忙，等一会儿再试。',
  inspection: '这个老师讲不了，换一个词试试。',
  truncated: '这次没讲完，再试一次。',
  incomplete: '这次没讲完，再试一次。',
  empty: '这次没讲完，再试一次。',
  http: '出了点小问题，再试一次。',
  audio: '声音没放出来，再点一次。',
  play: '声音没放出来，再点一次。',
  host: '声音没放出来，再点一次。',
  blocked: '点一下“再听一遍”就能听到。',
  abort: '',
};

const DICT = '先看看词典里的意思吧。';
export const WHERE_COPY = {
  // the word page with the offline dictionary's meaning underneath (ui-look.js failPage with d)
  lookDict: {
    network: '老师这会儿连不上，' + DICT,
    offline: '现在没连网，' + DICT,
    timeout: '网有点慢，' + DICT,
    ratelimit: '老师这会儿有点忙，' + DICT,
    server: '老师这会儿有点忙，' + DICT,
    'budget-day': '今天的老师额度用完了，' + DICT,
    budget: MONTH_OUT + DICT,
    billing: MONTH_OUT + DICT,
    nokey: '老师还没准备好，告诉家长。' + DICT,
    badkey: ASK_PARENT + DICT,
    model: ASK_PARENT + DICT,
    forbidden: ASK_PARENT + DICT,
  },
  look: {
    'budget-day': '今天的老师额度用完了，明天再来查。',
  },
  lesson: {
    network: '老师这会儿连不上，先接着往下做。',
    offline: '现在没连网，先接着往下做。',
    timeout: '网有点慢，先接着往下做。',
    ratelimit: '老师这会儿有点忙，先接着往下做。',
    server: '老师这会儿有点忙，先接着往下做。',
    'budget-day': '今天的老师额度用完了，接着复习就好。',
  },
  voice: {
    network: '声音没放出来，再点一次。',
    offline: '现在没连网，先用 iPad 自己的声音读。',
    timeout: '声音没放出来，再点一次。',
    ratelimit: '声音没放出来，再点一次。',
    server: '声音没放出来，再点一次。',
    'budget-day': '今天的老师额度用完了，先用 iPad 自己的声音读。',
  },
  // 问老师 (ui-chat.js; its own CHAT_COPY covers truncated / timeout / empty)
  chat: {
    network: '老师这会儿连不上，等一下再问。',
    offline: '现在没连网，连上以后再问。',
    ratelimit: '老师这会儿有点忙，等一会儿再问。',
    server: '老师这会儿有点忙，等一会儿再问。',
    'budget-day': '今天的老师额度用完了，明天再来问。复习还能接着做。',
  },
  dictation: {
    network: '老师这会儿连不上，听写照常做。',
    offline: '现在没连网，听写照常做。',
    'budget-day': '今天的老师额度用完了，听写照常做。',
  },
};

const PARENT_CODES = new Set(['nokey', 'badkey', 'billing', 'budget', 'model', 'forbidden']);

const codeOf = err => (err && typeof err === 'object' && err.code) || (typeof err === 'string' && err ? err : 'http');

export function kidMessage(err, { where = '', dict = false } = {}) {
  const code = codeOf(err);
  if (code === 'abort') return '';
  const place = where === 'look' && dict ? 'lookDict' : where;
  const local = WHERE_COPY[place] && WHERE_COPY[place][code];
  if (local) return local;
  const base = KID_COPY[code] ?? KID_COPY.http;
  return place === 'lookDict' ? base + DICT : base;
}

export const needsParent = err => PARENT_CODES.has(codeOf(err));
export const parentDetail = err => (err && err.message) || String(err || '');
