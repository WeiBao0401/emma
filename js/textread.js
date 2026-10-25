// 课文陪读（design/teacher-next.md 3.3）：她（或家长）拍一页课本课文，老师陪她一句一句读懂。
// 课上读的、作业考的都是课文；番外只用她认识的词，课文有生词和新句型，正是最需要人陪着读的地方。
// 一页这样来：拍照 → 前端缩图（capture.js imageToJpeg）→ 视觉模型抄成逐句英文（recognizePage）→ 她看一眼、可以改字、
// 选第几单元第几页 → 再调一次模型（文字）给每句写中文、意群、主干、2 个关键词、语法标签，再出 3 道理解题（annotatePage）
// → 程序检查（checkPassage：每句都有中文、题的答案在选项里、依据句编号存在……），不过关的句子标“这句问问老师”，
// 不过关的题去掉 → 存进本机 kv（'textread:<id>'，照片不存）→ 阅读器逐句陪读：先听后读、点词、这句看不懂三下、做题。
// 这个文件是纯逻辑（不碰 DOM），Node 里直接测。界面在 ui-textread.js，样式 css/textread.css（类名 tr-）。
// 负责：课文陪读 agent（textread.js、ui-textread.js、css/textread.css、tests/textread.test.mjs、curriculum/exam-reading.json）。
//
// ---------------------------------------------------------------- 导出
//   KV_PREFIX 'textread:'；kvKey(id)；VISION_MODEL 'qwen3.8-flash'；MAX_SENTENCES 40；HINT_MAX 4；HELP_MAX 3
//   OCR_KIND 'photo'、GEN_KIND 'story'（budget.js 的花费类别：看图算拍照，写陪读内容算“写故事”）
//   TAGS { tag: 中文名 }、TAG_ALIASES（possessive_s、g:possessive_s 读成 poss_s……）、TAG_CARD { tag: 语法卡 id }、normTags(list)
//   QUESTION_TYPES、CHOICE_TYPES、TYPE_ZH { type: '点出答案句' | '指的是谁' | '找细节' | ... }
//   visionRoute(settings) / textRoute(settings) -> Route   Poe 设好（chat.js chatRoute 的 auto 规则）用 Poe 的 GPT，否则百炼：
//       看图用 qwen3.8-flash，写内容用问老师的模型（chatModelBailian，默认 qwen3.8-max）
//   OCR_SYSTEM、ocrUserText({ units })、GEN_SYSTEM、genUserText(page, { unit })
//   jsonBody(route, system, user, { image }) -> body   OpenAI 兼容，JSON 模式；百炼 enable_thinking:false；Poe 给 max_tokens
//   callJSON({ route, system, user, image, kind, budget, fetchImpl, signal, timeoutMs, sleep }) -> Promise<{ obj, usage, yuan, model }>
//       错误一律 ai.js 的 AIError（code 同 CONTRACTS 9.9），孩子看的走 ctx.kidError
//   normalizeOcr(raw) -> Page = { unit: 'U2' | null, page: 23 | null, title, sentences: [{ id, en, speaker, para? }], more, unclear }
//   pageFromText(text, base) -> Page   确认页上改过的文字（一行一句，“Mia: ...”是对话，空一行是新的一段）重新拆成句子；pageText(page) 反过来
//   recognizePage({ dataUrl, settings, budget, fetchImpl, signal, sleep, units }) -> Promise<{ page, model, usage, yuan, mock }>
//   annotatePage({ page, settings, budget, fetchImpl, signal, sleep, unit }) -> Promise<{ gen, model, usage, yuan, mock }>
//   normalizeGen(raw, page) -> Passage（逐句对上 page 的英文；模型改了英文也不认，英文一律用 page 的）
//   checkPassage(passage) -> [{ where: 's3' | 'q2' | 'page', what }]   程序检查，空数组 = 都过了
//   fixPassage(passage) -> { passage, problems }   不过关的句子 unsure: true（中文不给，标“这句问问老师”），不过关的题去掉
//   trunkParts(en, trunk) -> [{ text, role: 'subject' | 'verb' | null }]   主干在句子里的位置（加底色用）；对不上返回 null
//   makeRecord({ page, passage, unit, pageNo, model, mock, now, id, problems, prev }) -> Record；pageId(unit, pageNo, now)
//       prev：同一页以前存过的那份（读过的次数留着）
//   normRecord(raw) -> Record | null（坏数据 null）；loadRecord(kv, id)；saveRecord(kv, rec)；listSaved(kv) -> [Row]
//   noteHelp(rec, i, level)、noteAnswer(rec, qid, result, now)、noteRead(rec, { now, done, helps, right, total, ms }) -> 新 rec（纯函数）
//   readPages(kv) -> { pages, byUnit: { U2: [23, 24] }, list: [Row] }   “读过第几单元哪一页”（家长区、问老师可以读）
//   toEpisode(rec) -> stories.json 一集的形状（给阅读器 renderPassage；每句多 trunk、tags、unsure，题多 evidence / reference 两种）
//   passageOf(rec) -> Ep（reader.js createContent 收好的一集，句子带 trunk、tags、unsure，题带 kind 'choice' | 'evidence'）
//   createEvidenceAttempt(q, { now }) -> Attempt   点出答案句：点对一句就过；点错一次升一级提示，第 4 级亮出答案（不算过）
//   unitLabel(id) -> 'Unit 2' | 'Starter'；pageLabel(rec) -> 'Unit 2 · 第 23 页'
//   mockOcr()、mockGen()   模拟模式的一页假课文（原创，只用她认识的词；不是课本）
//
// ---------------------------------------------------------------- kv 'textread:<id>'（新键，随备份导出；照片从来不存）
//   Record = { v: 1, id, unit: 'U2' | null, page: 23 | null, title, titleZh, created, updated, model, mock?,
//              names: [{ en, zh }], glossary: [{ w, zh }],
//              sentences: [{ id（1 起，题目的依据句号）, en, speaker, para?（第几段）, zh, chunks: 'a / b', trunk: { subject, verb, note } | null,
//                            keys: [{ w, zh }], tags: [tag], unsure? }],
//              questions: [{ id: 'q1', type: 'evidence' | 'reference' | 'detail' | 'infer' | 'main' | 'meaning', ask, zh, word?,
//                            options?, options_zh?, answer（evidence 是句子编号数组，别的是选项原文）, evidence: [句号], hints: [4], explain }],
//              problems（程序检查拦下的几处）, helps: { 句号: 第几下 }, answers: { qid: { grade, passed, clean, hint, at } },
//              reads: [{ at, done, helps, right, total, ms }] }
//   id = pageId：有页码是 '<单元>-p<页>'（同一页重拍就覆盖，读过的次数留着）；没页码是 '<单元>-<日期时间>'
//
// ---------------------------------------------------------------- 事件（只加不改，CONTRACTS 第 6 节）
//   read_help { item: 'tr:<id>:s<句号>', mode: 'read', step: 'textread', textread: id, sentence, level, kind: 'sentence', tags, words }
//   answer    { item: 'tr:<id>:<qid>', mode: 'read', step: 'textread', textread: id, qtype, choice, correct, first_try, ms, hint_level,
//               done?, passed?, grade? }   没有 slug，不算进单词的“写对了”
//   hint      { item, mode: 'read', step: 'textread', level, auto }
//   lookup    { query, source, from: 'textread', item: 'tr:<id>:s<句号>', slug? }
//   read_time { item: 'tr:<id>', mode: 'read', step: 'textread', phase: 'listen', ms, sentences, completed }
// 依赖：config.js（API_URL）、ai.js（AIError、parseJSON）、budget.js（isBudgetExhausted）、chat.js（chatRoute）、
//   capture.js（unitIdOf）、reader.js（createContent、tokenize、splitSentences、normW、sameWord、isoLocal）。
import { API_URL } from './config.js';
import { AIError, parseJSON } from './ai.js';
import { isBudgetExhausted } from './budget.js';
import { chatRoute } from './chat.js';
import { unitIdOf } from './capture.js';
import * as R from './reader.js';

export const KV_PREFIX = 'textread:';
export const kvKey = id => KV_PREFIX + String(id || '');
export const VISION_MODEL = 'qwen3.8-flash';
export const MAX_SENTENCES = 40;
export const HINT_MAX = 4;
export const HELP_MAX = 3;
export const OCR_KIND = 'photo';
export const GEN_KIND = 'story';
export const OCR_TIMEOUT_MS = 90000;
export const GEN_TIMEOUT_MS = 150000;
export const RETRY_DELAYS = [2000];
export const POE_MAX_TOKENS = 12000;
export const STEP = 'textread';

// 语法标签：沿用 stories.json meta.grammar 和语法卡的写法（不带 g:）；名字给界面看
export const TAGS = {
  there_be: 'there be（有）',
  poss_s: "名词所有格 's（谁的）",
  pronoun: '代词（he、she、it、they 指谁）',
  be_adj: 'be 动词 + 形容词（is happy）',
  be_verb: 'be 动词 am / is / are',
  can: 'can（会、能）',
  third_s: '三单 -s（She likes）',
  plural: '名词复数',
  do_q: "do / does 的问句和否定（Do you…? doesn't）",
  wh_q: '特殊疑问句（What、Where、Who……）',
  imperative: '祈使句（Look!、Don’t…）',
  freq_adv: '频度副词（always、often、seldom）',
  be_ing: '正在做（is reading）',
  past: '过去的事（was、went）',
  will: '将来的事（will）',
};
export const TAG_ALIASES = {
  possessive_s: 'poss_s', 'g:possessive_s': 'poss_s', 's_possessive': 'poss_s',
  possessive_pronoun: 'pronoun', 'g:possessive_pronoun': 'pronoun', pronouns: 'pronoun',
  'g:there_be': 'there_be', 'g:third_s': 'third_s', present_simple: 'third_s',
  be: 'be_verb', 'g:be_verb': 'be_verb', freq_adverb: 'freq_adv', present_continuous: 'be_ing', past_simple: 'past',
};
// 标签对应的语法卡（grammar.json 的 card id），以后分诊“读不懂是哪块语法”用
export const TAG_CARD = { there_be: 'there_be', poss_s: 'possessive_s', pronoun: 'pronoun', be_adj: 'be_verb', be_verb: 'be_verb', can: 'can',
  third_s: 'present_simple', do_q: 'present_simple', plural: 'plural', freq_adv: 'freq_adverb' };
export function normTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[\s,，、]+/) : []) {
    let k = String(t || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    k = TAG_ALIASES[k] || TAG_ALIASES['g:' + k] || k.replace(/^g:/, '');
    k = TAG_ALIASES[k] || k;
    if (TAGS[k] && !out.includes(k)) out.push(k);
  }
  return out;
}

export const QUESTION_TYPES = ['evidence', 'reference', 'detail', 'infer', 'main', 'meaning'];
export const CHOICE_TYPES = ['reference', 'detail', 'infer', 'main', 'meaning'];
export const TYPE_ZH = { evidence: '点出答案句', reference: '指的是谁', detail: '找细节', infer: '想一想', main: '讲什么', meaning: '猜词义' };
// reader.js SKILLS 的叫法（阅读器按 skill 显示小标签）
const TYPE_SKILL = { evidence: 'detail', reference: 'ref', detail: 'detail', infer: 'infer', main: 'main', meaning: 'meaning' };

// ---------------------------------------------------------------- small helpers

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const ONE = s => String(s ?? '').replace(/[\u0000-\u001f\u200b-\u200d\u2060\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
const EN = s => ONE(s).replace(/[’‘`]/g, "'").replace(/[“”]/g, '"');
const CJK = /[\u3400-\u9fff]/;
const arr = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const letters = s => R.normW(s).replace(/[^a-z0-9]/g, '');
const pad = n => String(n).padStart(2, '0');
const toDate = x => (x instanceof Date ? x : x == null ? new Date() : new Date(x));
const stamp = d => { const x = toDate(d); return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}-${pad(x.getHours())}${pad(x.getMinutes())}${pad(x.getSeconds())}`; };
export const unitLabel = id => { const s = String(id || ''); if (!s) return ''; if (/^s/i.test(s)) return 'Starter'; const m = s.match(/(\d+)/); return m ? `Unit ${m[1]}` : s; };
export const pageLabel = rec => {
  const u = unitLabel(rec && rec.unit);
  const p = rec && Number.isFinite(rec.page) && rec.page > 0 ? `第 ${rec.page} 页` : '';
  return [u, p].filter(Boolean).join(' · ') || '一页课文';
};
const hasWord = (en, w) => {
  const text = ' ' + R.normW(en).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const k = R.normW(w).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k) return false;
  if (text.includes(' ' + k + ' ')) return true;
  // one word in another form: looks ~ look, children ~ child is out of reach, but -s / -ed / -ing are fine
  if (!/ /.test(k)) return R.tokenize(en).some(t => t.word && (R.sameWord(t.word, k) || R.sameWord(k, t.word) || (k.length >= 4 && t.word.startsWith(k))));
  return false;
};
const sameText = (a, b) => R.normW(EN(a)).replace(/[.。!！?？\s]+$/, '') === R.normW(EN(b)).replace(/[.。!！?？\s]+$/, '');

// ---------------------------------------------------------------- who reads the photo, who writes the help

export function visionRoute(s = {}) {
  const r = chatRoute(s || {}, { image: true });
  return r.provider === 'poe' ? r : { ...r, model: VISION_MODEL };
}
export function textRoute(s = {}) { return chatRoute(s || {}, { image: false }); }

// ---------------------------------------------------------------- 1. the photo -> sentences

export const OCR_SYSTEM = `你帮一个初一学生把一页英语课本（外研版七年级）的照片抄成文字。只看照片，只抄书上印着的英文课文。
只回一个 JSON 对象，形状固定：
{
  "unit": 2,
  "page": 23,
  "title": "课文的英文标题",
  "sentences": [{"en": "一句英文", "speaker": "说话人", "para": 1}],
  "unclear": false
}
规则：
- unit：页眉或页脚上印的单元号，Starter 写 0；看不出来写 null。page：印着的页码数字；看不到写 null。
- 只抄课文正文：故事、对话、短文、日记、邮件。练习题、题号、题目要求（Read and answer…）、单词表、图片里的小字、页眉页脚都不抄。
- 一句一项，按书上的顺序。一句话在行尾断开的，接起来抄成一句。
- 照书上的拼写、大小写、标点抄。不要改错，不要补字，不要翻译。
- 对话：speaker 写说话人的名字，en 只写说的话；不是对话 speaker 写空字符串。
- para：这句在第几段（1 起）。书上空一行或另起一段就是新的一段；对话每换一个人说话算一段。
- 看不清、被挡住、被切掉的句子：能看到多少写多少，unclear 写 true。没把握的字母不要猜。
- 照片里没有英文课文：sentences 给空数组。
- 不要输出 JSON 以外的任何文字。`;

export function ocrUserText({ units = [] } = {}) {
  const known = (units || []).filter(u => u && u.id).map(u => u.title || u.id);
  return ['把这一页课本照片里的课文抄成上面那种 JSON。', known.length ? `这本书的单元：${known.join('；')}。` : ''].filter(Boolean).join('\n');
}

// "Mia: Where is Kitty?" -> { speaker: 'Mia', en: 'Where is Kitty?' }
const SPEAKER_RE = /^([A-Z][A-Za-z]{0,14}(?: [A-Z][A-Za-z]{0,14})?)\s*[:：]\s*(.+)$/;
function splitOne(en, speaker, out, para = null) {
  for (const p of R.splitSentences(EN(en))) {
    const t = EN(p);
    if (!/[A-Za-z]/.test(t)) continue;
    out.push({ en: t, speaker: ONE(speaker), para });
  }
}
const paraNo = x => { const n = Number(x); return Number.isInteger(n) && n >= 1 && n < 100 ? n : null; };

export function normalizeOcr(raw) {
  const o = obj(raw);
  const src = o.sentences ?? o.lines ?? o.text ?? o.body ?? [];
  const flat = [];
  for (const item of typeof src === 'string' ? src.split(/\n+/) : arr(src)) {
    if (typeof item === 'string') {
      const m = EN(item).match(SPEAKER_RE);
      if (m) splitOne(m[2], m[1], flat); else splitOne(item, '', flat);
    } else if (item && typeof item === 'object') {
      splitOne(item.en ?? item.text ?? item.sentence ?? '', item.speaker ?? item.who ?? '', flat, paraNo(item.para ?? item.paragraph));
    }
  }
  const sentences = flat.slice(0, MAX_SENTENCES).map((s, i) => ({ id: i + 1, en: s.en, speaker: s.speaker, ...(s.para ? { para: s.para } : {}) }));
  const pageNo = Number(String(o.page ?? o.page_number ?? '').replace(/[^\d]/g, ''));
  return {
    unit: unitIdOf(o.unit ?? null),
    page: Number.isInteger(pageNo) && pageNo > 0 && pageNo < 400 ? pageNo : null,
    title: EN(o.title),
    sentences,
    more: flat.length > MAX_SENTENCES,
    unclear: !!o.unclear,
  };
}

// the text on the confirm page, one sentence a line ("Mia: ..." is someone talking), back into a page
// a blank line starts a new paragraph (the reader's “答案在第几段” hint uses it)
export function pageFromText(text, base = {}) {
  const items = [];
  String(text ?? '').split(/\n\s*\n+/).forEach((block, k) => {
    for (const line of block.split(/\n/).map(x => x.trim()).filter(Boolean)) {
      const m = EN(line).match(SPEAKER_RE);
      items.push(m ? { en: m[2], speaker: m[1], para: k + 1 } : { en: line, speaker: '', para: k + 1 });
    }
  });
  const paras = new Set(items.map(x => x.para));
  const page = normalizeOcr({ sentences: paras.size > 1 ? items : items.map(({ para, ...x }) => x) });
  return { ...base, sentences: page.sentences, more: page.more };
}
export const pageText = page => {
  let prev = null;
  return ((page && page.sentences) || []).map(s => {
    const line = s.speaker ? `${s.speaker}: ${s.en}` : s.en;
    const gap = prev !== null && s.para && s.para !== prev ? '\n' : '';
    prev = s.para || prev;
    return gap + line;
  }).join('\n');
};

// ---------------------------------------------------------------- 2. sentences -> help for each sentence and 3 questions

const TAG_LIST = Object.keys(TAGS).join('、');
export const GEN_SYSTEM = `你是北京一位很会教的初一英语老师。学生基础弱：阅读看不懂、语法不会、单词量不够。她用外研版七年级上册。
现在陪她读懂一页课本课文。我给你这一页的句子，已经编好号。按编号，每句给：
- zh：整句的中文，按课文里的意思翻，准确、自然、短，她一看就懂。
- chunks：把这句英文按意群用 " / " 分开，去掉 " / " 要和原句一字不差。4 个词以内的短句不用分，照抄原句。
- trunk：句子的主干。subject 是主语，verb 是谓语，都照原句原样抄（verb 带上 be、can、do、does、will、not，比如 is looking for、can't swim、doesn't like）。
  there be 句：verb 写 There is / There are，subject 写后面那个名词短语。祈使句：subject 写空字符串。问句：Where is Kitty? 的 subject 是 Kitty，verb 是 is。
  note：一句中文，格式像“谁 = Mia，干什么 = is looking for（在找）”。
- keys：这句里最关键的 2 个词或短语（她最可能不认识，或者不懂就读不懂这句的），w 照原句抄，zh 写在这句里的意思。
- tags：这句用到的语法点，只能从这些里选：${TAG_LIST}。写英文标签，没有就给空数组。
再给：
- title_zh：课文标题的中文（没有标题就空字符串）。
- names：课文里的人名，en 照抄，zh 写“人名”或中文名。
- glossary：这一页里课文意思和常见第一个意思不一样的词，以及超出小学词和她学过的单元的生词；w 写课文里的样子，zh 写在这页里的意思。
- questions：3 道理解题，照北京初一阅读题的考法：
  q1 type "evidence"（点出答案句）：问一个细节。ask 用简单英文，zh 是题目的中文。answer 是能回答这道题的句子编号数组（通常 1 个）。
  q2 type "reference"（指代题）：找一句里的 it / they / them / he / she / him / her / this 指原文里的一个名词。
     ask 写 In sentence 5, what does "it" mean?，zh 写“第 5 句的 it 指什么？”，word 写那个代词。
     options 3 到 4 个，都是原文里出现过的名词短语，原样抄；answer 等于其中一个；evidence 写代词那句和名词那句的编号。
     找不到合适的代词，就改出一道 type "detail" 的四选一。
  q3 type "detail" 或 "infer"（四选一）：options 4 个英文短句，options_zh 是对应的中文，answer 等于 options 里的一个，evidence 是依据句编号。
  每道题 hints 4 级，中文，短：1 去第几句找（不说答案）；2 关键词是哪个、原文哪里有它；3 排除一个错的选项并说为什么（evidence 题：缩小到两句）；
  4 讲清楚：答案是什么，原文哪一句，为什么。explain 和第 4 级一样也行。
  出完每道题你自己再做一遍：答案一定能在原文找到依据，不能有两个都对的选项，选项里不写 A、B、C、D。
题目和选项的英文只用课文里的词和小学就学过的简单词。
只回一个 JSON 对象，形状固定：
{
  "title_zh": "",
  "names": [{"en": "Mia", "zh": "人名"}],
  "glossary": [{"w": "look for", "zh": "寻找"}],
  "sentences": [{"id": 1, "zh": "", "chunks": "", "trunk": {"subject": "", "verb": "", "note": ""}, "keys": [{"w": "", "zh": ""}, {"w": "", "zh": ""}], "tags": []}],
  "questions": [
    {"id": "q1", "type": "evidence", "ask": "", "zh": "", "answer": [4], "hints": ["", "", "", ""], "explain": ""},
    {"id": "q2", "type": "reference", "word": "it", "ask": "", "zh": "", "options": [], "answer": "", "evidence": [5, 4], "hints": ["", "", "", ""], "explain": ""},
    {"id": "q3", "type": "detail", "ask": "", "zh": "", "options": [], "options_zh": [], "answer": "", "evidence": [7], "hints": ["", "", "", ""], "explain": ""}
  ]
}
sentences 要一句不落，id 和我给的一样。不要输出 JSON 以外的任何文字。`;

export function genUserText(page, { unit = '' } = {}) {
  const p = page || {};
  const list = (p.sentences || []).map(s => ({ id: s.id, en: s.en, ...(s.speaker ? { speaker: s.speaker } : {}) }));
  return [
    `她现在学到 ${unitLabel(unit || p.unit) || 'Unit 3'}。这一页是 ${pageLabel({ unit: p.unit, page: p.page })}。`,
    p.title ? `标题：${p.title}` : '',
    '句子：',
    JSON.stringify(list),
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- calling the model (one JSON answer)

export function jsonBody(route, system, user, { image = '' } = {}) {
  const content = image ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: user }] : user;
  const body = { model: route.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], response_format: { type: 'json_object' } };
  if (route.provider === 'poe') body.max_tokens = POE_MAX_TOKENS;
  else { body.enable_thinking = false; body.temperature = 0.3; }
  return body;
}

class Retry extends Error {}
const keyOk = k => /^[\x21-\x7e]+$/.test(k);
const errOf = data => {
  const e = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error : data) : {};
  return { code: String(e.code || e.type || ''), message: String(e.message || '').slice(0, 200) };
};
function httpFail(status, data, route) {
  const { code, message } = errOf(data);
  const blob = (code + ' ' + message).toLowerCase();
  const n = route.name || '百炼';
  if (route.relay && status === 404 && !message) return new AIError('中转站返回 404：地址里的暗号不对，到家长区重新粘贴中转站地址。', 'badkey');
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalidapikey')) return new AIError(`${n} 的 Key 不对或已失效：到家长区重新填。`, 'badkey');
  if (blob.includes('arrearage') || blob.includes('overdue') || blob.includes('good standing')) return new AIError('百炼账户欠费或预算用完了，去百炼控制台看一下。', 'billing');
  if (route.provider === 'poe' && (status === 402 || blob.includes('insufficient') || blob.includes('points'))) return new AIError('Poe 积分用完了，到 poe.com 看一下。', 'billing');
  if (blob.includes('model_not_found') || blob.includes('not exist') || blob.includes('not_found')) return new AIError(`模型“${route.model}”用不了：这个 Key 可能没开通它。`, 'model');
  if (blob.includes('data_inspection') || blob.includes('datainspection')) return new AIError('内容没通过百炼的安全检查。', 'inspection');
  if (status === 400 && /image|url|vision|multimodal|picture/.test(blob)) return new AIError(`模型“${route.model}”没收下这张照片（${message || code || '400'}）。重拍一张试试。`, 'model');
  if (status === 403) return new AIError(`${n}拒绝了请求（403）：${message || code || '没有权限'}。`, 'forbidden');
  return new AIError(`${n}返回 ${status}：${message || code || '没有详情'}`, 'http');
}
const contentText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('') : '');

export async function callJSON({ route, system, user, image = '', kind = 'other', budget = null, fetchImpl = null, signal = null,
  timeoutMs = GEN_TIMEOUT_MS, sleep = sleepMs, retries = RETRY_DELAYS } = {}) {
  if (signal && signal.aborted) throw new AIError('已取消', 'abort');
  const key = String((route && route.key) || '');
  if (!route || !route.url) throw new AIError('还没填中转站地址：到家长区填好，或者改用百炼。', 'nokey');
  if (!key) throw new AIError(route.provider === 'poe' ? '还没填 Poe 的 Key：到家长区填好。' : '还没填百炼 API Key：先在家长区上面的“Key”里填好。', 'nokey');
  if (!keyOk(key)) throw new AIError('Key 的格式不对：到家长区重新粘贴。', 'badkey');
  const why = budget && budget.blockReason ? budget.blockReason(kind) : '';
  if (why === 'month') throw new AIError('今天已经收到过百炼的“预算用完”（429），App 今天不再发请求。', 'budget');
  if (why) throw new AIError('今天的花费到了 App 里设的上限，明天再来，或者在家长区调高上限。', 'budget-day');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const body = JSON.stringify(jsonBody(route, system, user, { image }));

  async function once() {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res, data;
    try {
      res = await doFetch(route.url, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
      data = await res.json().catch(() => null);
    } catch (e) {
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
      if (timedOut) throw new AIError(`${route.name || '老师'} ${Math.round(timeoutMs / 1000)} 秒没回，网络可能太慢。再试一次。`, 'timeout');
      throw new Retry('network');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (!res.ok) {
      if (res.status === 429 && isBudgetExhausted(429, data)) {
        if (budget && budget.markExhausted) { try { budget.markExhausted(); } catch (e) { /* bookkeeping only */ } }
        throw new AIError('百炼返回 429：这个 Key 的月预算用完了。', 'budget');
      }
      if (res.status === 429) throw new Retry('429');
      if (res.status >= 500) throw new Retry('5xx:' + res.status);
      throw httpFail(res.status, data, route);
    }
    let yuan = 0;
    const usage = (data && data.usage) || null;
    if (usage && budget && budget.record) { try { yuan = budget.record(usage, kind, route.model) || 0; } catch (e) { /* never fails a call */ } }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice && choice.finish_reason === 'length') throw new AIError('这一页太长，回答被截断了。分两次拍上半页和下半页。', 'truncated');
    const text = contentText(choice && choice.message && choice.message.content).trim();
    if (!text) throw new Retry('empty');
    let out;
    try { out = parseJSON(text); } catch (e) { throw new Retry('json'); }
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Retry('json');
    return { obj: out, usage, yuan, model: (data && data.model) || route.model };
  }

  let last = null;
  for (let i = 0; i <= retries.length; i++) {
    try { return await once(); } catch (e) {
      if (!(e instanceof Retry)) throw e;
      last = e;
      if (e.message === 'network' && globalThis.navigator && navigator.onLine === false) break;
      if (i < retries.length) await sleep(retries[i]);
      if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    }
  }
  const m = last ? last.message : '';
  const n = route.name || '老师';
  if (m === '429') throw new AIError(`${n}限流了（请求太频繁），稍等一会儿再试。`, 'ratelimit');
  if (m.startsWith('5xx:')) throw new AIError(`${n}服务出错（${m.slice(4)}），稍后再试。`, 'server');
  if (m === 'empty') throw new AIError(`${n}返回了空内容，再试一次。`, 'empty');
  if (m === 'json') throw new AIError('回答不完整，再试一次。', 'incomplete');
  throw new AIError('连不上：网络不通，或者请求被拦截了（开着 VPN 可以关掉再试）。', 'network');
}

export async function recognizePage({ dataUrl, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs, units = [] } = {}) {
  const s = settings || {};
  if (s.mock) {
    await sleep(700);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上：网络不通（模拟断网）。', 'network');
    return { page: normalizeOcr(mockOcr()), model: VISION_MODEL, usage: null, yuan: 0, mock: true };
  }
  if (!dataUrl || !/^data:image\/(jpeg|png);base64,/.test(dataUrl)) throw new AIError('照片还没准备好，再拍一次。', 'empty');
  const route = visionRoute(s);
  const r = await callJSON({ route, system: OCR_SYSTEM, user: ocrUserText({ units }), image: dataUrl, kind: OCR_KIND, budget, fetchImpl, signal, sleep, timeoutMs: OCR_TIMEOUT_MS });
  return { page: normalizeOcr(r.obj), model: r.model, usage: r.usage, yuan: r.yuan, mock: false };
}

export async function annotatePage({ page, settings = {}, budget = null, fetchImpl = null, signal = null, sleep = sleepMs, unit = '' } = {}) {
  const s = settings || {};
  if (s.mock) {
    await sleep(900);
    if (signal && signal.aborted) throw new AIError('已取消', 'abort');
    if (s.mockFail === 'network') throw new AIError('连不上：网络不通（模拟断网）。', 'network');
    return { gen: mockGen(), model: 'mock', usage: null, yuan: 0, mock: true };
  }
  if (!page || !(page.sentences || []).length) throw new AIError('这一页没有认出句子。', 'empty');
  const route = textRoute(s);
  const r = await callJSON({ route, system: GEN_SYSTEM, user: genUserText(page, { unit }), kind: GEN_KIND, budget, fetchImpl, signal, sleep, timeoutMs: GEN_TIMEOUT_MS });
  return { gen: r.obj, model: r.model, usage: r.usage, yuan: r.yuan, mock: false };
}

// ---------------------------------------------------------------- what the model wrote -> one fixed shape

function normKeys(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([w, zh]) => ({ w, zh })) : [];
  return list.map(k => (typeof k === 'string'
    ? (() => { const m = k.match(/^([^\u3400-\u9fff]+?)\s*[=:：]?\s*([\u3400-\u9fff（(].*)$/); return m ? { w: EN(m[1]), zh: ONE(m[2]) } : null; })()
    : k && typeof k === 'object' ? { w: EN(k.w ?? k.word ?? k.en), zh: ONE(k.zh ?? k.cn ?? k.meaning) } : null)).filter(k => k && k.w);
}
function normTrunk(raw) {
  const t = obj(raw);
  const subject = EN(t.subject ?? t.subj ?? t.who ?? '');
  const verb = EN(t.verb ?? t.predicate ?? t.what ?? '');
  const note = ONE(t.note ?? t.zh ?? t.explain ?? '');
  return verb ? { subject, verb, note } : null;
}
function normChunks(raw) {
  if (Array.isArray(raw)) return raw.map(EN).filter(Boolean).join(' / ');
  return EN(raw).split(/\s*[/|｜]\s*/).filter(Boolean).join(' / ');
}
function idsOf(raw, n) {
  const out = [];
  for (const x of arr(raw)) {
    const k = Number(String(x).replace(/^s/i, ''));
    if (Number.isInteger(k) && k >= 1 && k <= n && !out.includes(k)) out.push(k);
  }
  return out;
}
function normQuestion(raw, i, n) {
  if (!raw || typeof raw !== 'object') return null;
  let type = String(raw.type ?? raw.kind ?? '').toLowerCase().trim();
  if (type === 'ref' || type === 'pronoun') type = 'reference';
  if (type === 'find' || type === 'sentence') type = 'evidence';
  if (!QUESTION_TYPES.includes(type)) type = Array.isArray(raw.options) && raw.options.length ? 'detail' : 'evidence';
  const q = {
    id: ONE(raw.id) || 'q' + (i + 1), type,
    ask: EN(raw.ask ?? raw.question ?? raw.q), zh: ONE(raw.zh ?? raw.ask_zh ?? raw.question_zh),
    hints: arr(raw.hints ?? raw.hint).map(ONE).filter(Boolean).slice(0, HINT_MAX),
    explain: ONE(raw.explain ?? raw.why),
  };
  if (type === 'evidence') {
    q.answer = idsOf(raw.answer ?? raw.evidence, n);
    q.evidence = q.answer.slice();
  } else {
    q.options = arr(raw.options ?? raw.choices).map(o => EN(typeof o === 'object' && o ? o.text ?? o.en : o).replace(/^\s*[A-Da-d]\s*[.、．)）:：]\s*/, '')).filter(Boolean);
    const zhs = arr(raw.options_zh ?? raw.choices_zh).map(ONE);
    if (zhs.length === q.options.length && zhs.some(Boolean)) q.options_zh = zhs;
    let ans = raw.answer ?? raw.correct;
    if (typeof ans === 'number' && q.options[ans] != null) ans = q.options[ans];
    else if (/^[A-Da-d]$/.test(String(ans ?? '').trim()) && q.options['ABCD'.indexOf(String(ans).trim().toUpperCase())]) ans = q.options['ABCD'.indexOf(String(ans).trim().toUpperCase())];
    q.answer = EN(ans);
    q.evidence = idsOf(raw.evidence ?? raw.ref ?? raw.from, n);
    if (type === 'reference') q.word = EN(raw.word ?? raw.pronoun ?? '').toLowerCase();
  }
  return q;
}

export function normalizeGen(raw, page) {
  const g = obj(raw);
  const base = (page && page.sentences) || [];
  const byId = new Map();
  arr(g.sentences).forEach((s, k) => {
    if (!s || typeof s !== 'object') return;
    const id = Number(s.id ?? k + 1);
    if (Number.isInteger(id) && !byId.has(id)) byId.set(id, s);
  });
  const sentences = base.map((b, k) => {
    const s = obj(byId.get(b.id) || byId.get(k + 1));
    return {
      id: k + 1, en: EN(b.en), speaker: ONE(b.speaker), ...(b.para ? { para: b.para } : {}),
      zh: ONE(s.zh ?? s.cn ?? s.translation),
      chunks: normChunks(s.chunks ?? s.split ?? ''),
      trunk: normTrunk(s.trunk ?? s.main ?? null),
      keys: normKeys(s.keys ?? s.key_words ?? s.keywords).slice(0, 3),
      tags: normTags(s.tags ?? s.grammar ?? []),
    };
  });
  const n = sentences.length;
  return {
    title: EN((page && page.title) || g.title), titleZh: ONE(g.title_zh ?? g.titleZh),
    names: arr(g.names).map(x => (typeof x === 'string' ? { en: EN(x), zh: '人名' } : { en: EN(obj(x).en ?? obj(x).name), zh: ONE(obj(x).zh) || '人名' })).filter(x => x.en),
    glossary: normKeys(g.glossary ?? g.words).filter(k => k.zh),
    sentences,
    questions: arr(g.questions ?? g.quiz).map((q, i) => normQuestion(q, i, n)).filter(Boolean).slice(0, 5),
  };
}

// ---------------------------------------------------------------- the trunk inside the sentence

function findFrom(lower, needle, from = 0) {
  if (!needle) return -1;
  const re = new RegExp(`(?<![a-z0-9'])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'g');
  re.lastIndex = from;
  const m = re.exec(lower);
  return m ? m.index : -1;
}
// [{ text, role }] covering the whole sentence; the verb may sit in two places (Does Kitty like fish? -> Does, like)
export function trunkParts(en, trunk) {
  const s = String(en ?? '');
  if (!trunk || !trunk.verb) return null;
  const lower = s.toLowerCase().replace(/[’‘]/g, "'");
  const marks = [];
  const taken = (a, b) => marks.some(m => a < m.b && b > m.a);
  const subj = String(trunk.subject || '').toLowerCase().replace(/[’‘]/g, "'").trim();
  if (subj) {
    let at = findFrom(lower, subj);
    if (at < 0) return null;
    marks.push({ a: at, b: at + subj.length, role: 'subject' });
  }
  const verb = String(trunk.verb).toLowerCase().replace(/[’‘]/g, "'").replace(/\s*\.\.\.\s*|\s*…\s*/g, ' ').trim();
  let at = findFrom(lower, verb);
  while (at >= 0 && taken(at, at + verb.length)) at = findFrom(lower, verb, at + 1);
  if (at >= 0) marks.push({ a: at, b: at + verb.length, role: 'verb' });
  else {
    // the verb in pieces, in order: does … like, is … going
    let from = 0;
    for (const piece of verb.split(/\s+/)) {
      let k = findFrom(lower, piece, from);
      while (k >= 0 && taken(k, k + piece.length)) k = findFrom(lower, piece, k + 1);
      if (k < 0) return null;
      marks.push({ a: k, b: k + piece.length, role: 'verb' });
      from = k + piece.length;
    }
  }
  marks.sort((x, y) => x.a - y.a);
  const out = [];
  let pos = 0;
  for (const m of marks) {
    if (m.a > pos) out.push({ text: s.slice(pos, m.a), role: null });
    out.push({ text: s.slice(m.a, m.b), role: m.role });
    pos = m.b;
  }
  if (pos < s.length) out.push({ text: s.slice(pos), role: null });
  return out;
}

// ---------------------------------------------------------------- the program check (before she sees anything)

export function checkPassage(p) {
  const out = [];
  const sentences = (p && p.sentences) || [];
  const n = sentences.length;
  if (!n) out.push({ where: 'page', what: '没有句子' });
  const all = sentences.map(s => s.en).join(' ');
  for (const s of sentences) {
    const w = 's' + s.id;
    if (!CJK.test(s.zh || '')) out.push({ where: w, what: '没有中文' });
    if (s.chunks && letters(s.chunks) !== letters(s.en)) out.push({ where: w, what: '断句和原句对不上' });
    if (s.trunk && !trunkParts(s.en, s.trunk)) out.push({ where: w, what: '主干在原句里找不到' });
    for (const k of s.keys || []) {
      if (!CJK.test(k.zh || '')) out.push({ where: w, what: `关键词 ${k.w} 没有中文` });
      else if (!hasWord(s.en, k.w)) out.push({ where: w, what: `关键词 ${k.w} 不在这句里` });
    }
  }
  for (const q of (p && p.questions) || []) {
    const w = q.id;
    if (!q.ask && !q.zh) out.push({ where: w, what: '没有题目' });
    if ((q.hints || []).length < HINT_MAX) out.push({ where: w, what: '提示不到 4 级' });
    if (q.type === 'evidence') {
      if (!(q.answer || []).length) out.push({ where: w, what: '答案句编号不存在' });
      continue;
    }
    const opts = q.options || [];
    if (opts.length < 3 || opts.length > 4) out.push({ where: w, what: '选项不是 3 到 4 个' });
    if (new Set(opts.map(o => R.normW(o))).size !== opts.length) out.push({ where: w, what: '选项有重复' });
    if (!opts.some(o => sameText(o, q.answer))) out.push({ where: w, what: '答案不在选项里' });
    if (!(q.evidence || []).length) out.push({ where: w, what: '依据句编号不存在' });
    if (q.type === 'reference') {
      if (!q.word) out.push({ where: w, what: '指代题没写代词' });
      else if (!(q.evidence || []).some(i => sentences[i - 1] && hasWord(sentences[i - 1].en, q.word))) out.push({ where: w, what: `依据句里没有 ${q.word}` });
      for (const o of opts) if (!R.normW(all).includes(R.normW(o).replace(/[.!?]$/, ''))) out.push({ where: w, what: `选项 ${o} 不在原文里` });
    }
  }
  return out;
}

// what fails is never shown as if it were right: a sentence without good Chinese says “这句问问老师”; a broken question goes
export function fixPassage(p) {
  const problems = checkPassage(p);
  const bad = where => problems.filter(x => x.where === where).map(x => x.what);
  const sentences = (p.sentences || []).map(s => {
    const b = bad('s' + s.id);
    const out = { ...s };
    if (b.includes('没有中文')) { out.zh = ''; out.unsure = true; }
    if (b.includes('断句和原句对不上')) out.chunks = '';
    if (b.includes('主干在原句里找不到')) out.trunk = null;
    out.keys = (s.keys || []).filter(k => CJK.test(k.zh || '') && hasWord(s.en, k.w)).slice(0, 2);
    return out;
  });
  const n = sentences.length;
  const questions = [];
  for (const q of p.questions || []) {
    const b = bad(q.id).filter(x => x !== '提示不到 4 级');
    if (b.length) continue;
    questions.push({ ...q, hints: fullHints(q, sentences), explain: q.explain || '' });
  }
  questions.forEach((q, i) => { q.id = 'q' + (i + 1); });
  return { passage: { ...p, sentences, questions: questions.slice(0, 3) }, problems, n };
}
// fewer than 4 hints: the missing levels are filled from what is sure (the evidence sentence, the answer)
function fullHints(q, sentences) {
  const h = (q.hints || []).slice(0, HINT_MAX);
  const ev = (q.type === 'evidence' ? q.answer : q.evidence) || [];
  const first = ev[0];
  const ans = q.type === 'evidence' ? `第 ${ev.join('、')} 句` : `“${q.answer}”`;
  const fill = [
    first ? `回到第 ${first} 句附近找。` : '回到课文里找。',
    '先找题目里的关键词，在课文里找到有它的那一句。',
    q.type === 'evidence' ? '答案就在关键词出现的那一两句里。' : '把每个选项放回课文里对一对，对不上的划掉。',
    `答案是${ans}。` + (first && sentences[first - 1] ? `第 ${first} 句：${sentences[first - 1].en}` : ''),
  ];
  while (h.length < HINT_MAX) h.push(fill[h.length]);
  return h;
}

// ---------------------------------------------------------------- saved pages (kv 'textread:<id>')

export function pageId(unit, page, now = new Date()) {
  const u = unitIdOf(unit) || 'x';
  return Number.isInteger(page) && page > 0 ? `${u}-p${page}` : `${u}-${stamp(now)}`;
}

export function makeRecord({ page, passage, unit = null, pageNo = null, model = '', mock = false, now = new Date(), id = '', problems = [], prev = null } = {}) {
  const u = unitIdOf(unit ?? (page && page.unit)) || null;
  const pn = Number.isInteger(pageNo) && pageNo > 0 ? pageNo : (page && Number.isInteger(page.page) ? page.page : null);
  const at = R.isoLocal(toDate(now));
  const old = prev ? normRecord(prev) : null;
  return {
    v: 1, id: id || pageId(u, pn, now), unit: u, page: pn,
    title: (passage && passage.title) || (page && page.title) || '', titleZh: (passage && passage.titleZh) || '',
    created: old ? old.created : at, updated: at, model: model || '', ...(mock ? { mock: true } : {}),
    names: (passage && passage.names) || [], glossary: (passage && passage.glossary) || [],
    sentences: (passage && passage.sentences) || [], questions: (passage && passage.questions) || [],
    problems: (problems || []).length,
    helps: {}, answers: {},
    reads: old ? old.reads : [],
  };
}

export function normRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sentences) || !raw.sentences.length) return null;
  const sentences = raw.sentences.filter(s => s && typeof s === 'object' && EN(s.en)).map((s, k) => ({
    id: k + 1, en: EN(s.en), speaker: ONE(s.speaker), ...(paraNo(s.para) ? { para: paraNo(s.para) } : {}), zh: ONE(s.zh), chunks: normChunks(s.chunks || ''),
    trunk: s.trunk ? normTrunk(s.trunk) : null, keys: normKeys(s.keys), tags: normTags(s.tags), ...(s.unsure ? { unsure: true } : {}),
  }));
  if (!sentences.length) return null;
  return {
    v: 1, id: ONE(raw.id) || 'x', unit: unitIdOf(raw.unit) || null, page: Number.isInteger(raw.page) ? raw.page : null,
    title: EN(raw.title), titleZh: ONE(raw.titleZh), created: ONE(raw.created), updated: ONE(raw.updated), model: ONE(raw.model),
    ...(raw.mock ? { mock: true } : {}),
    names: arr(raw.names).filter(x => x && x.en), glossary: arr(raw.glossary).filter(x => x && x.w),
    sentences, questions: arr(raw.questions).filter(q => q && typeof q === 'object' && q.id),
    problems: Number(raw.problems) || 0,
    helps: obj(raw.helps), answers: obj(raw.answers), reads: arr(raw.reads).filter(x => x && typeof x === 'object'),
  };
}

export function loadRecord(kv, id) {
  try { return normRecord(kv && kv.peek ? kv.peek(kvKey(id), null) : null); } catch (e) { return null; }
}
export async function saveRecord(kv, rec) {
  if (!kv || typeof kv.set !== 'function' || !rec || !rec.id) return false;
  try { await kv.set(kvKey(rec.id), rec); return true; } catch (e) { return false; }
}

// Row = { id, unit, page, label, title, created, last, times, done, sentences, questions }
export function listSaved(kv) {
  if (!kv || typeof kv.keys !== 'function') return [];
  const rows = [];
  for (const k of kv.keys(KV_PREFIX)) {
    const rec = (() => { try { return normRecord(kv.peek(k, null)); } catch (e) { return null; } })();
    if (!rec) continue;
    const done = rec.reads.filter(r => r.done);
    rows.push({ id: rec.id, unit: rec.unit, page: rec.page, label: pageLabel(rec), title: rec.title, created: rec.created,
      last: (rec.reads[rec.reads.length - 1] || {}).at || rec.updated || rec.created, times: done.length, done: done.length > 0,
      sentences: rec.sentences.length, questions: rec.questions.length });
  }
  const order = u => (u === 'S' ? 0 : /^U(\d+)$/.test(String(u)) ? +String(u).slice(1) : 99);
  return rows.sort((a, b) => String(b.last).localeCompare(String(a.last)) || order(a.unit) - order(b.unit) || (a.page || 0) - (b.page || 0));
}
export function readPages(kv) {
  const list = listSaved(kv);
  const byUnit = {};
  for (const r of list) if (r.done && r.unit && r.page) (byUnit[r.unit] = byUnit[r.unit] || []).push(r.page);
  for (const u of Object.keys(byUnit)) byUnit[u].sort((a, b) => a - b);
  return { pages: list.filter(r => r.done).length, byUnit, list };
}

export const noteHelp = (rec, i, level) => ({ ...rec, helps: { ...obj(rec.helps), [String(i)]: Math.max(Number(obj(rec.helps)[String(i)]) || 0, level) } });
export const noteAnswer = (rec, qid, r, now = new Date()) => ({ ...rec, answers: { ...obj(rec.answers),
  [qid]: { grade: r.grade || 1, passed: !!r.passed, clean: !!r.clean, hint: r.hintLevel || 0, at: R.isoLocal(toDate(now)) } } });
export function noteRead(rec, { now = new Date(), done = true, helps = 0, right = 0, total = 0, ms = 0 } = {}) {
  const reads = arr(rec.reads).concat([{ at: R.isoLocal(toDate(now)), done: !!done, helps, right, total, ms: Math.max(0, Math.round(ms)) }]).slice(-30);
  return { ...rec, reads, updated: R.isoLocal(toDate(now)) };
}

// ---------------------------------------------------------------- for the reader

// stories.json's shape of one episode (renderPassage reads it like a story episode); trunk, tags, unsure ride along
export function toEpisode(rec) {
  const r = normRecord(rec) || rec;
  return {
    id: 'tr-' + r.id, n: 0, kind: 'textread', textread: r.id,
    title: r.title || pageLabel(r), title_zh: r.titleZh || '', label: pageLabel(r), unit: r.unit, page: r.page,
    tip: { title: '先看题，再读', lines: ['先看一遍 3 道题，知道要找什么。', '先听老师读一遍，再自己读。看不懂的句子点“看不懂”。'], preview: true },
    names: (r.names || []).map(x => ({ en: x.en, zh: x.zh })),
    glossary: (r.glossary || []).map(g => ({ w: g.w, zh: g.zh })),
    targets: [],
    sentences: r.sentences.map(s => ({ id: s.id, speaker: s.speaker || null, ...(s.para ? { para: s.para } : {}), en: s.en, zh: s.unsure ? '' : s.zh, chunks: s.chunks || s.en,
      keys: s.keys, trunk: s.trunk || null, tags: s.tags || [], ...(s.unsure ? { unsure: true } : {}) })),
    // reader.js calls the reference question's word `pronoun` and its sentence `sentence`
    questions: (r.questions || []).map(q => ({ ...q, skill: TYPE_SKILL[q.type] || 'detail', skill_zh: TYPE_ZH[q.type] || '',
      ...(q.type === 'reference' && q.word ? { pronoun: q.word, sentence: (q.evidence || [])[0] } : {}) })),
  };
}

// reader.js's own Ep (createContent normalizes it), with trunk / tags / unsure kept and the two new question kinds
export function passageOf(rec) {
  const r = normRecord(rec);
  if (!r) return null;
  const raw = toEpisode(r);
  const c = R.createContent({ names: [], episodes: [{ ...raw, id: 'tr', n: 1 }] });
  const ep = c.episodes[0];
  if (!ep) return null;
  ep.id = raw.id;
  ep.textread = r.id;
  ep.label = raw.label;
  ep.sentences.forEach((s, k) => {
    const src = r.sentences[k] || {};
    s.trunk = src.trunk || null;
    s.tags = src.tags || [];
    s.unsure = !!src.unsure;
    if (s.unsure) s.zh = '';
  });
  // names: tapping one says it is a name
  for (const x of r.names || []) if (x.en) ep.names[R.normW(x.en)] = x.zh || '人名';
  ep.questions = (r.questions || []).map((q, i) => {
    const item = `tr:${r.id}:${q.id}`;
    if (q.type === 'evidence') {
      return { id: q.id, item, ep: r.id, kind: 'evidence', type: 'evidence', skill: 'detail', skillName: TYPE_ZH.evidence,
        ask: q.ask, zh: q.zh, answer: (q.answer || []).slice(), evidence: (q.answer || []).slice(), hints: fullHints(q, r.sentences), explain: q.explain || '' };
    }
    const n = ep.questions.find(x => x.id === q.id) || ep.questions[i];
    if (!n) return null;
    return { ...n, item, ep: r.id, type: q.type, kind: 'choice', word: q.word || '', skillName: TYPE_ZH[q.type] || n.skillName, variant: null,
      hints: fullHints(q, r.sentences) };
  }).filter(q => q && (q.kind === 'evidence' ? q.answer.length : q.options.some(o => o.correct)));
  return ep;
}

// 点出答案句：她在课文里点一句。点对（答案里任何一句）就过；点错一次自动升一级提示；到第 4 级亮出答案，这题不算过。
export function createEvidenceAttempt(q, { now = () => Date.now() } = {}) {
  const clock = () => +toDate(typeof now === 'function' ? now() : now);
  const picked = new Set();
  let phase = 'ask', level = 0, wrongs = 0, passed = null, clean = false, firstTry = null, hintEarly = false;
  const t0 = clock();
  const answer = (q.answer || []).map(Number);
  const reveal = () => { phase = 'done'; passed = false; };
  const base = (i, correct, extra) => ({ item: q.item, mode: R.MODE, qtype: 'evidence', choice: 's' + i, correct, ms: Math.max(0, clock() - t0), misconception: null, ...extra });
  const a = {
    q, picked,
    get phase() { return phase; }, get level() { return level; }, get passed() { return passed; }, get clean() { return clean; },
    get done() { return phase === 'done'; }, get grade() { return passed === null ? null : passed ? (clean ? 3 : 2) : 1; },
  };
  a.hint = () => {
    if (phase === 'done' || level >= HINT_MAX) return null;
    if (!wrongs) hintEarly = true;
    level++;
    const out = { level, text: q.hints[level - 1] || '', auto: false };
    if (level >= HINT_MAX) reveal();
    return out;
  };
  a.pick = i => {
    if (phase === 'done' || picked.has(i)) return null;
    picked.add(i);
    const first = firstTry === null;
    const correct = answer.includes(Number(i));
    if (first) firstTry = correct;
    const seen = level;
    const out = { correct, level: seen, first, done: false, hintShown: null };
    if (correct) {
      phase = 'done'; passed = true; clean = first && !hintEarly && level === 0;
      out.done = true;
      out.event = base(i, true, { first_try: first, hint_level: seen, done: true, passed: true, grade: clean ? 3 : 2, ...(wrongs ? { fixed_after: seen } : {}) });
      return out;
    }
    wrongs++;
    phase = 'retry';
    if (level < HINT_MAX) {
      level++;
      out.hintShown = { level, text: q.hints[level - 1] || '', auto: true };
      if (level >= HINT_MAX) reveal();
    }
    out.done = phase === 'done';
    out.event = base(i, false, { first_try: first, hint_level: seen, ...(out.done ? { done: true, passed: false, grade: 1 } : {}) });
    return out;
  };
  a.result = () => ({ item: q.item, qid: q.id, passed: !!passed, grade: a.grade || 1, clean, firstTry: firstTry === true, hintLevel: level, wrongs });
  return a;
}

// ---------------------------------------------------------------- 模拟模式：一页假课文（原创，只用她认识的词）

export function mockOcr() {
  return {
    unit: 1, page: 8, title: 'A Box for Kitty', unclear: false,
    sentences: [
      { en: 'Mia has a new cat.', speaker: '' },
      { en: 'Her name is Kitty.', speaker: '' },
      { en: 'Kitty is white and very small.', speaker: '' },
      { en: "Every morning, Kitty sleeps on Mia's desk.", speaker: '' },
      { en: "Mia's mother is not happy about it.", speaker: '' },
      { en: '"Kitty can\'t sleep there," she says.', speaker: '' },
      { en: 'So Mia finds a big box.', speaker: '' },
      { en: 'She puts an old T-shirt in it.', speaker: '' },
      { en: 'Now there is a nice bed for Kitty.', speaker: '' },
      { en: "But Kitty doesn't like the box.", speaker: '' },
      { en: "She likes Mia's desk!", speaker: '' },
    ],
  };
}

export function mockGen() {
  return {
    title_zh: '给 Kitty 的盒子',
    names: [{ en: 'Mia', zh: '人名' }, { en: 'Kitty', zh: '猫的名字' }],
    glossary: [{ w: 'puts', zh: '放' }, { w: 'finds', zh: '找到' }, { w: 'nice', zh: '好的，舒服的' }],
    sentences: [
      { id: 1, zh: 'Mia 有一只新猫。', chunks: 'Mia has a new cat.', trunk: { subject: 'Mia', verb: 'has', note: '谁 = Mia，干什么 = has（有）' },
        keys: [{ w: 'has', zh: '有' }, { w: 'new', zh: '新的' }], tags: ['third_s'] },
      { id: 2, zh: '它的名字叫 Kitty。', chunks: 'Her name is Kitty.', trunk: { subject: 'Her name', verb: 'is', note: '谁 = Her name（它的名字），是什么 = is Kitty' },
        keys: [{ w: 'Her', zh: '它的（指这只猫）' }, { w: 'name', zh: '名字' }], tags: ['pronoun', 'be_verb'] },
      { id: 3, zh: 'Kitty 是白色的，而且很小。', chunks: 'Kitty is white / and very small.', trunk: { subject: 'Kitty', verb: 'is', note: '谁 = Kitty，怎么样 = is white and very small' },
        keys: [{ w: 'white', zh: '白色的' }, { w: 'small', zh: '小的' }], tags: ['be_adj'] },
      { id: 4, zh: '每天早上，Kitty 都在 Mia 的书桌上睡觉。', chunks: "Every morning, / Kitty sleeps / on Mia's desk.",
        trunk: { subject: 'Kitty', verb: 'sleeps', note: '谁 = Kitty，干什么 = sleeps（睡觉）' },
        keys: [{ w: 'Every morning', zh: '每天早上' }, { w: 'desk', zh: '书桌' }], tags: ['third_s', 'poss_s'] },
      { id: 5, zh: 'Mia 的妈妈对这件事不高兴。', chunks: "Mia's mother / is not happy / about it.",
        trunk: { subject: "Mia's mother", verb: 'is not', note: "谁 = Mia's mother（Mia 的妈妈），怎么样 = is not happy（不高兴）" },
        keys: [{ w: "Mia's mother", zh: 'Mia 的妈妈' }, { w: 'happy', zh: '高兴的' }], tags: ['poss_s', 'be_adj', 'pronoun'] },
      { id: 6, zh: '“Kitty 不能睡在那儿，”她说。', chunks: '"Kitty can\'t sleep there," / she says.',
        trunk: { subject: 'she', verb: 'says', note: "谁 = she（妈妈），干什么 = says（说）；她说的话里：Kitty can't sleep（不能睡）" },
        keys: [{ w: "can't", zh: '不能' }, { w: 'there', zh: '那儿（指书桌上）' }], tags: ['can', 'third_s', 'pronoun'] },
      { id: 7, zh: '所以 Mia 找到一个大盒子。', chunks: 'So Mia finds / a big box.', trunk: { subject: 'Mia', verb: 'finds', note: '谁 = Mia，干什么 = finds（找到）' },
        keys: [{ w: 'So', zh: '所以' }, { w: 'box', zh: '盒子' }], tags: ['third_s'] },
      { id: 8, zh: '她把一件旧 T 恤放进盒子里。', chunks: 'She puts / an old T-shirt / in it.', trunk: { subject: 'She', verb: 'puts', note: '谁 = She（Mia），干什么 = puts（放）' },
        keys: [{ w: 'puts', zh: '放' }, { w: 'old', zh: '旧的' }], tags: ['pronoun', 'third_s'] },
      { id: 9, zh: '现在 Kitty 有了一张舒服的床。', chunks: 'Now there is / a nice bed / for Kitty.',
        trunk: { subject: 'a nice bed', verb: 'there is', note: '有什么 = there is a nice bed（有一张舒服的床），给谁 = for Kitty' },
        keys: [{ w: 'there is', zh: '有' }, { w: 'bed', zh: '床' }], tags: ['there_be'] },
      { id: 10, zh: '可是 Kitty 不喜欢这个盒子。', chunks: "But Kitty / doesn't like / the box.",
        trunk: { subject: 'Kitty', verb: "doesn't like", note: "谁 = Kitty，干什么 = doesn't like（不喜欢）" },
        keys: [{ w: 'But', zh: '可是' }, { w: "doesn't like", zh: '不喜欢' }], tags: ['do_q', 'third_s'] },
      { id: 11, zh: '它喜欢 Mia 的书桌！', chunks: "She likes / Mia's desk!", trunk: { subject: 'She', verb: 'likes', note: '谁 = She（Kitty），干什么 = likes（喜欢）' },
        keys: [{ w: 'likes', zh: '喜欢' }, { w: 'desk', zh: '书桌' }], tags: ['pronoun', 'third_s', 'poss_s'] },
    ],
    questions: [
      { id: 'q1', type: 'evidence', ask: 'Where does Kitty sleep every morning?', zh: 'Kitty 每天早上在哪儿睡觉？', answer: [4],
        hints: ['题目问“每天早上”，回到课文前半段找。', '关键词是 every morning。课文里哪一句有 Every morning？',
          '答案在第 4 句或第 5 句里。第 5 句讲妈妈不高兴，没说在哪儿睡。',
          "答案是第 4 句：Every morning, Kitty sleeps on Mia's desk.（每天早上，Kitty 都在 Mia 的书桌上睡觉。）"],
        explain: "第 4 句有 every morning，也说了在哪儿睡：on Mia's desk。" },
      { id: 'q2', type: 'reference', word: 'it', ask: 'In sentence 8, what is "it"?', zh: '第 8 句的 it 指什么？',
        options: ['a big box', "Mia's desk", 'an old T-shirt', 'Kitty'], answer: 'a big box', evidence: [8, 7],
        hints: ['看第 8 句和它前面的第 7 句。', 'it 指“一个东西”，T 恤被放进了 it 里面。', '不是 an old T-shirt：T 恤是被放进去的东西，不能把自己放进自己里面。',
          '答案是 a big box。第 7 句 Mia 找到一个大盒子，第 8 句她把旧 T 恤放进 it（这个盒子）里。'],
        explain: 'it 指前一句说过的 a big box。' },
      { id: 'q3', type: 'infer', ask: 'Why does Mia find a big box?', zh: 'Mia 为什么要找一个大盒子？',
        options: ["Her mother doesn't want Kitty on the desk.", 'Kitty likes boxes.', 'Mia wants a new desk.', 'The box is for her mother.'],
        options_zh: ['妈妈不想让 Kitty 睡在书桌上。', 'Kitty 喜欢盒子。', 'Mia 想要一张新书桌。', '盒子是给妈妈的。'],
        answer: "Her mother doesn't want Kitty on the desk.", evidence: [5, 6, 7],
        hints: ['把第 5、6、7 句连起来看。', '第 7 句开头的 So（所以）说明：找盒子是因为前面发生的事。',
          "排除“Kitty likes boxes”：第 10 句说 Kitty doesn't like the box（不喜欢盒子）。",
          "答案是“Her mother doesn't want Kitty on the desk”。第 5、6 句妈妈不高兴，说 Kitty 不能睡在那儿（书桌上），第 7 句 So Mia finds a big box：所以 Mia 去找盒子给它当床。"],
        explain: '第 7 句的 So 把前后连起来：妈妈不让 Kitty 睡书桌，所以 Mia 给它找盒子。' },
    ],
  };
}
