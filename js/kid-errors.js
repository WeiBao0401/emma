// 孩子版报错文案（DESIGN 10.1、10.7）：Emma 看到的出错提示不提 Key、欠费、模型名、百炼、Poe，只说发生了什么、
// 她能做什么（“先看看词典里的意思”“告诉家长”）。原来的技术说明留给家长区（parentDetail）。
// 负责：孩子版报错与查词 agent（kid-errors.js、prompts.js）。
//
// 导出
//   KID_COPY                         { code: 中文一句 }，code 来自 ai.js 的 AIError.code、tts.js 的 TTSError.code、budget
//   WHERE_COPY                       按地方换说法：{ look: {...}, lookDict: {...}, lesson: {...}, voice: {...}, dictation: {...} }
//   kidMessage(err, { where, dict }) -> string   给孩子看的一句。where：'look' 查词 | 'lesson' 上课 | 'voice' 朗读 | 'dictation'
//                                    dict：查词页下面有离线词典的意思（为真时句子里带“先看看词典里的意思吧”）
//   needsParent(err) -> bool         这个错要家长处理（Key、额度、模型权限）：界面上显示“告诉家长”，不显示“去设置”
//   parentDetail(err) -> string      原来的技术说明（err.message），只在家长区显示
//   BANNED                           孩子文案里不许出现的字（测试用）
//   CARE_LINE                        查词碰到伤害自己、暴力、性、毒品、很难过这类话题时 Emma 看到的那一句（kidMessage('care')）
//   isCareText(text) -> bool         她输入的词、句子、原句里有明显的这类话题（本地先挡一道，不用等模型的 status 'care'）
//   isCareGloss(cn) -> bool          离线词典里这个词的主要意思是成人内容（粗话、性、毒品、自杀）：查词页和联想词都不显示
//   careFreeGloss(cn) -> string      普通词去掉词典里夹带的成人义项（warm 的“色情的”），其余原样
//   DESIGN 8.5：老师不进情绪和安全话题，只请她去找家人聊；什么都不存，查词页只记一条 events { type: 'flag', reason: 'care' }
//
// 规则：中文弯引号，不用破折号，不用感叹号，句子短；不出现 Key、API、欠费、预算、模型、百炼、Poe、qwen、429 这些字。
// 依赖：无。

export const BANNED = /key|api|欠费|预算|模型|百炼|poe|qwen|千问|429|—|「|」|!|！/i;

const ASK_PARENT = '老师这边出了点问题，告诉家长。';
const MONTH_OUT = '这个月的老师额度用完了，告诉家长。';

export const CARE_LINE = '这个问题，去找家人聊聊吧。';

export const KID_COPY = {
  care: CARE_LINE,
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

// ---------------------------------------------------------------- care: topics the teacher does not go into (DESIGN 8.5)
// Ordinary school words (die, dead, kill, hunt, fight, sad, cry, hate, alone) are not here: they get a normal, gentle
// lesson. These are only the plain cases; the prompts' care rule (prompts.js COMMON) catches the rest.
const CARE_TEXT = /不想活|活不下去|想死|去死|寻死|自杀|自残|割腕|跳楼|伤害自己|杀了?我自己|色情|做爱|性交|毒品|吸毒|大麻|强奸|kill\s*(?:my|your|him|her|them)sel(?:f|ves)|suicid|self[\s-]*harm|want(?:s|ed)?\s+to\s+die|hurt\s+myself|\b(?:sex|sexy|porn\w*|fuck\w*|shit\w*|bitch\w*|cocaine|heroin|rape[sd]?|raping|nude)\b/i;
const CARE_GLOSS = /性交|性欲|色情|阴茎|阴道|阳物|强奸|卖淫|妓|淫|自杀|毒品|海洛因|可卡因|大麻|他妈的|狗屁|杂种|拉屎/;

export const isCareText = text => CARE_TEXT.test(String(text ?? ''));

// ECDICT lines look like "a. 暖和的, 暖的, 温暖的, ……, 色情的；vt. 使温暖". A word whose main meaning (the first three
// items of the first sense) is adult content is a care word; an ordinary word only loses the adult items (careFreeGloss).
const senses = cn => String(cn ?? '').split(/[；;]/);
const items = sense => sense.replace(/^\s*(?:[a-z]+\.\s*)+/i, '').split(/\s*[,，]\s*/).filter(Boolean);
export const isCareGloss = cn => items(senses(cn)[0] || '').slice(0, 3).some(x => CARE_GLOSS.test(x));
export function careFreeGloss(cn) {
  const s = String(cn ?? '');
  if (!CARE_GLOSS.test(s)) return s;
  return senses(s).map(sense => {
    const pos = (sense.match(/^\s*(?:[a-z]+\.\s*)+/i) || [''])[0];
    const kept = items(sense).filter(x => !CARE_GLOSS.test(x));
    return kept.length ? pos + kept.join(', ') : '';
  }).filter(Boolean).join('；');
}
