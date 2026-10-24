// 孩子版报错文案（DESIGN 10.1、10.7）：Emma 看到的出错提示不提 Key、欠费、模型名、百炼、Poe，只说发生了什么、
// 她能做什么（“先用离线词典”“告诉家长”）。原来的技术说明留给家长区（parentDetail）。
// 负责：孩子版报错 agent（kid-errors.js）。
// 状态：骨架。码表和函数签名已定，文案是初稿，由负责的 agent 改定；ui-look.js 的报错页已经接上 kidMessage。
//
// 导出
//   KID_COPY                         { code: 中文一句 }，code 来自 ai.js 的 AIError.code、tts.js 的 TTSError.code、budget
//   kidMessage(err, { where }) -> string   给孩子看的一句。where：'look' 查词 | 'lesson' 上课 | 'voice' 朗读 | 'dictation'
//   needsParent(err) -> bool         这个错要家长处理（Key、额度、模型权限）：界面上显示“告诉家长”，不显示“去设置”
//   parentDetail(err) -> string      原来的技术说明（err.message），只在家长区显示
//
// 规则：中文弯引号，不用破折号，不用感叹号，句子短；不出现 Key、API、欠费、预算、模型、百炼、Poe、429 这些字。
// 依赖：无。

export const KID_COPY = {
  network: '现在连不上网，先用离线词典。',
  timeout: '网有点慢，等一下再试一次。',
  offline: '现在没连网，先用离线词典。',
  nokey: '老师还没准备好，告诉家长。',
  badkey: '老师这边出了点问题，告诉家长。',
  billing: '这个月的老师额度用完了，告诉家长。',
  budget: '这个月的老师额度用完了，告诉家长。',
  'budget-day': '今天的老师额度用完了，明天再来。复习和离线词典还能用。',
  model: '老师这边出了点问题，告诉家长。',
  forbidden: '老师这边出了点问题，告诉家长。',
  ratelimit: '用的人有点多，等一会儿再试。',
  server: '老师这边忙不过来，等一会儿再试。',
  inspection: '这个说法老师讲不了，换一个词试试。',
  truncated: '这次没讲完，再试一次。',
  incomplete: '这次没讲完，再试一次。',
  empty: '这次没讲完，再试一次。',
  http: '出了点小问题，再试一次。',
  audio: '声音没放出来，再点一次。',
  abort: '',
};
const PARENT_CODES = new Set(['nokey', 'badkey', 'billing', 'budget', 'model', 'forbidden']);

const codeOf = err => (err && typeof err === 'object' && err.code) || (typeof err === 'string' ? err : 'http');

export function kidMessage(err, { where = '' } = {}) {
  const code = codeOf(err);
  if (code === 'abort') return '';
  if (where === 'voice' && (code === 'network' || code === 'timeout')) return '声音没放出来，再点一次。';
  return KID_COPY[code] ?? KID_COPY.http;
}

export const needsParent = err => PARENT_CODES.has(codeOf(err));
export const parentDetail = err => (err && err.message) || String(err || '');
