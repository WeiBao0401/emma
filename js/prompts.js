// 提示词：初一孩子版（DESIGN 5.9、8.5）。查词讲解给一个北京初一、英语基础弱的学生看：课本里的那个意思在前，
// 1-2 个义项，例句只用她认识的词（小学 505 词 + 已学单元的课本词），等级由程序传入（“课本 Unit 3 / 初中词 /
// 课外词”），不让模型猜。谐音巧记不在查词里生成，答错后才用 SYSTEM.hint 单独要（v0 可以不接）。
// 负责：孩子版查词 agent（kid-errors.js、prompts.js）。
//
// JSON 的字段和词典版一样（words.js、ui-entry.js、db.js 直接接得上）：
//   core      status, headword, suggestions, kind, level, phonetic, syllables, brief_cn, senses[{pos, cn, en, example, example_cn}], context_note
//   lexicon   collocations, synonyms, antonyms, word_family, roots, confusables, usage_tip（数量变少，可以是空的）
//   practice  reading{title, text, cn}, quiz[3 道 choice]
//   zh        status, query, translation, explain, options[{en, pos, cn, nuance, example, example_cn, level}], best
//   story     title, text（**word** 标出目标词）, cn, questions[{q, a}]
//   hint      mnemonic（新：答错后的巧记，一句中文）
// core 不再要 mnemonic；CORE_KEYS 里留着它，旧词条和导入合并（db.js mergeEntry）照旧。
//
// 导出
//   SYSTEM[kind]                               系统提示词，kind：core | lexicon | practice | zh | story | hint
//   CORE_KEYS / LEXICON_KEYS / PRACTICE_KEYS   从回答里拷进词条的字段（白名单）
//   userMsg(q, context, fromCn, hints?)        查词的用户消息。第一行永远是 “Input: <q>”（模拟模式和测试靠它）
//   zhUserMsg(q, scene, hints?)                中译英的用户消息
//   storyUserMsg(words, hints?)                写故事的用户消息
//   hintUserMsg({ word, cn, chose })           答错后要巧记
//   levelLabel(word, curriculum) -> string     '课本 Unit 3' | '小学词' | '初中词' | '课外词'（没有 curriculum 时 ''）
//   lookupHints(word, { curriculum, progress, cap }) -> { level, textbookCn, known }   拼 hints 用的纯函数
//     hints：{ level: 程序定的等级, textbookCn: 课本上的中文意思, known: [她学过的课本词] }，都可以没有
//     单元词上 cn_source 为 'ecdict' 的中文（离线词典凑的占位）不当课本意思传
//
// 10-24 Wei 定：不做安全话题拦截（原来的 care 规则删了），die、kill、hunt 这类课本里会出现的词照常讲。
// 依赖：无（curriculum 由调用方传入，用 curriculum.js 的 Curriculum 接口）。

export const COMMON = [
  'You are a patient English teacher for a Grade 7 student (初一, about 12 years old) in China whose English is weak. She uses a Chinese junior middle school textbook.',
  'What she knows: the ~505 primary-school words of the Chinese national curriculum (very common words: numbers, colors, family, body, food, fruit, animals, school things, days, months, weather, clothes, rooms, simple verbs like be, have, go, come, like, want, can, eat, play, see, look, read, write, help), plus the textbook words listed in the message as known.',
  'Return ONLY one JSON object, no markdown fences, no extra text.',
  'Chinese: short and plain, like a kind teacher talking to a 12-year-old. No grammar jargon beyond 名词、动词、形容词、单数、复数、过去式. Use curly quotes “ ” in Chinese, never 「」. Do not use em dashes.',
  'English examples: 4-10 words, simple present tense unless the word needs another tense, and ONLY words she knows plus the target word. Topics: school, classmates, family, home, food, animals, sports, hobbies, weather, holidays. Never work, office, meetings, emails, business or technology.',
  'Every real English word gets a normal explanation, including words like die, dead, kill, hunt, fight, sad, cry and hate that appear in school texts: use plain, everyday examples.',
].join('\n');

export const CORE_SYSTEM = COMMON + `
She typed an English word or phrase. First check it, then explain it simply.
Schema:
{
  "status": "ok" | "typo" | "invalid",
  "headword": "dictionary form (lemma); for phrases keep the phrase; lowercase unless proper",
  "suggestions": ["likely intended words if typo, else []"],
  "kind": "word" | "phrase" | "idiom" | "phrasal_verb" | "abbreviation" | "proper_noun",
  "level": "copy the level label given in the message exactly; if none is given, empty string",
  "phonetic": "IPA, e.g. /ˈæpl/",
  "syllables": "syllable breaks with middle dots, e.g. ba·na·na (phrases: keep spaces)",
  "brief_cn": "最核心的中文意思，8 字以内；给了课本意思就用课本的",
  "senses": [{"pos": "n.", "cn": "中文意思，短", "en": "a very simple English explanation using only words she knows, or empty string", "example": "short example sentence", "example_cn": "中文翻译"}],
  "context_note": "如果给了原句：这里是什么意思，一两句话；否则空字符串"
}
Rules:
- "typo": a misspelling of a real word/phrase; fill suggestions, other fields may be empty.
- "invalid": gibberish, random characters, a full sentence with no clear target word, or not English.
- 1 or 2 senses, never more. If a textbook meaning is given, sense 1 is exactly that meaning. Otherwise, if a context sentence is given, the sense used there comes first. Add a second sense only when it is very common (for example the sense used in the context sentence, when it is not the textbook one).
- Do not add memory tricks or homophones (谐音) here.`;

export const LEXICON_SYSTEM = COMMON + `
Show a few useful connections of the dictionary form (lemma) of the given English word or phrase, at her level. If the input is not a real English word or phrase, return {"invalid": true}.
Schema:
{
  "collocations": [{"phrase": "short common phrase she can use, e.g. a red apple", "cn": "中文"}],
  "synonyms": [{"word": "simple synonym", "diff": "一句中文：和它有什么不一样"}],
  "antonyms": [{"word": "antonym", "cn": "中文"}],
  "word_family": [{"word": "related form", "pos": "n.", "cn": "中文"}],
  "roots": {"breakdown": "only when the word splits into parts she can see, e.g. class(班) + room(房间)", "explain": "一句中文", "same_root": [{"word": "word with the same part", "cn": "中文"}]},
  "confusables": [{"word": "word a beginner mixes up with it (spelling or sound), e.g. where / wear", "diff": "一句中文区别"}],
  "usage_tip": "一句中文：初一学生用这个词最容易错的地方（a / an、单复数、搭配的介词、拼写），没有就空字符串"
}
Counts: 2-4 collocations, 0-2 synonyms, 0-2 antonyms, 0-3 word family items, 0-2 confusables; empty lists are fine. roots: when the parts are not obvious, use {"breakdown": "", "explain": "", "same_root": []}. Every English word you use should be easy.`;

export const PRACTICE_SYSTEM = COMMON + `
Write a little practice for the dictionary form (lemma) of the given English word or phrase. If the input is not a real English word or phrase, return {"invalid": true}.
Schema:
{
  "reading": {"title": "short title", "text": "a 40-70 word English passage about a middle school student's day (school, family, friends) that uses the word naturally 2 times", "cn": "中文翻译"},
  "quiz": [{"type": "choice", "question": "题目，中文为主", "options": ["A", "B", "C", "D"], "answer": 0, "explain": "一句中文解析"}]
}
Exactly 3 quiz items of different styles: 看句子选中文意思, 选词填空, 选正确的说法. Options are short; wrong options are words she knows. Vary the position of the right answer.`;

export const ZH_SYSTEM = COMMON + `
She typed Chinese and wants to know how to say it in English. Give the simplest English a Grade 7 student would use at school or at home.
Schema:
{
  "status": "ok" | "invalid",
  "query": "the Chinese input",
  "translation": "if the input is a sentence or a long phrase: one simple English translation; otherwise empty string",
  "explain": "一句中文：英文里一般怎么说，选哪个",
  "options": [
    {"en": "English word or phrase (dictionary form)", "pos": "adj.", "cn": "它最贴近的中文意思", "nuance": "一句中文：什么时候用，和别的选项哪里不一样", "example": "short example sentence", "example_cn": "中文翻译", "level": ""}
  ],
  "best": 0
}
Rules:
- 2-4 options, the simplest and most common first (textbook words before harder ones); "best" is the index of the one you recommend for the given scene (or in general).
- Prefer single words or short set phrases; for a sentence, options are the key words or phrases inside it.
- "level": always empty string (the app fills it in).
- "invalid": the input has no translatable meaning (random characters).
- If a usage scene is given, pick and rank options for that scene.`;

export const STORY_SYSTEM = COMMON + `
Write a short, easy English reading passage for vocabulary review.
Use EVERY target word at least once, in a coherent little story about a middle school student's life (about 80-120 words). Wrap each target word occurrence as **word** (inflected forms allowed). Other words: only words she knows.
Return ONLY a JSON object: {"title": "...", "text": "... with **word** marks ...", "cn": "中文翻译", "questions": [{"q": "easy comprehension question in English", "a": "short answer"}]} with 2 questions.`;

export const HINT_SYSTEM = COMMON + `
She just got this word wrong. Give ONE memory trick in Chinese that helps her remember the meaning: split the word into parts she knows, a picture to imagine, or a sound-alike (谐音) that is kind and suitable for a child. Keep it under 30 Chinese characters. Do not scold or mention the mistake.
Schema: {"mnemonic": "一句中文巧记"}`;

// DashScope json_object mode requires the lowercase word "json" somewhere in the messages.
export const JSON_NOTE = '\nReply with a single valid json object.';

export const SYSTEM = {
  core: CORE_SYSTEM + JSON_NOTE,
  lexicon: LEXICON_SYSTEM + JSON_NOTE,
  practice: PRACTICE_SYSTEM + JSON_NOTE,
  zh: ZH_SYSTEM + JSON_NOTE,
  story: STORY_SYSTEM + JSON_NOTE,
  hint: HINT_SYSTEM + JSON_NOTE,
};

export const LEXICON_KEYS = ['collocations', 'synonyms', 'antonyms', 'word_family', 'roots', 'confusables', 'usage_tip'];
export const PRACTICE_KEYS = ['reading', 'quiz'];
// Core fields copied into an entry (headword is handled separately); anything else the model returns is ignored.
// mnemonic stays listed for old entries and import merges (db.js), though the core prompt no longer asks for it.
export const CORE_KEYS = ['kind', 'level', 'phonetic', 'syllables', 'brief_cn', 'senses', 'context_note', 'mnemonic'];

// ---------------------------------------------------------------- what the program tells the model

const KNOWN_CAP = 400;
const norm = w => String(w ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function knownLine(known) {
  const list = [...new Set((Array.isArray(known) ? known : []).map(oneLine).filter(Boolean))].slice(-KNOWN_CAP);
  return list.length ? `\nTextbook words she has learned (use these and primary-school words in examples): ${list.join(', ')}` : '';
}
function hintLines(hints = {}) {
  const h = hints || {};
  let msg = '';
  if (h.level) msg += `\nLevel label (copy into "level"): ${oneLine(h.level)}`;
  if (h.textbookCn) msg += `\nTextbook meaning (sense 1 must be this): ${oneLine(h.textbookCn)}`;
  return msg + knownLine(h.known);
}

// Same first lines as the dictionary's server.py user_msg(); the program's hints follow.
export function userMsg(q, context, fromCn = '', hints = {}) {
  let msg = `Input: ${q}`;
  if (context) msg += `\nContext sentence where she saw it: ${context}`;
  if (fromCn) msg += `\nShe reached this word from the Chinese “${fromCn}”; put the sense matching it first.`;
  return msg + hintLines(hints);
}

export function zhUserMsg(q, scene, hints = {}) {
  return `Chinese input: ${q}` + (scene ? `\nUsage scene: ${scene}` : '') + knownLine(hints && hints.known);
}

export function storyUserMsg(words, hints = {}) {
  return 'Target words: ' + words.join(', ') + knownLine(hints && hints.known);
}

export function hintUserMsg({ word, cn = '', chose = '' } = {}) {
  return `Word: ${oneLine(word)}` + (cn ? `\nMeaning: ${oneLine(cn)}` : '') + (chose ? `\nShe chose instead: ${oneLine(chose)}` : '');
}

// ---------------------------------------------------------------- level and known words, from curriculum.js

// 'Unit 3' from the textbook's title; without one (units() then gives the id) from the id: 'S' -> Starter, 'U3' -> Unit 3
// A long textbook title ('Unit 2 More than fun') is cut to its 'Unit 2' so the tag on the word page stays short.
function unitName(id, title) {
  const t = oneLine(title);
  const short = t.match(/^(Unit \d+|Starter)\b/i);
  if (short) return short[1];
  if (t && t !== id) return t;
  return id === 'S' ? 'Starter' : String(id || '').replace(/^U(\d+)$/, 'Unit $1');
}

// The label on the word page. Decided here from the word lists, never by the model.
export function levelLabel(word, curriculum) {
  if (!curriculum || !word) return '';
  const unit = curriculum.unitOf(word);
  if (unit) {
    const u = (curriculum.units() || []).find(x => x.id === unit);
    return '课本 ' + unitName(unit, u && u.title);
  }
  if (curriculum.isPrimary(word)) return '小学词';
  if (curriculum.isRequired(word)) return '初中词';
  return '课外词';
}

// hints for userMsg: the level, the textbook's Chinese for this word, and the textbook words she has met so far
// (every unit up to progress.unit; without a progress, up to this word's unit; nothing when neither is known).
export function lookupHints(word, { curriculum = null, progress = null, cap = KNOWN_CAP } = {}) {
  if (!curriculum) return {};
  const unit = curriculum.unitOf(word);
  let textbookCn = '';
  if (unit) {
    const hit = curriculum.unitWords(unit).find(x => norm(x.w) === norm(word));
    // a placeholder meaning from the offline dictionary (cn_source 'ecdict') is not the textbook's: never forced on the model
    textbookCn = (hit && hit.cn_source !== 'ecdict' && oneLine(hit.cn)) || '';
  }
  const upTo = progress && progress.unit ? curriculum.unitOrder(progress.unit) : unit ? curriculum.unitOrder(unit) : -1;
  const known = [];
  if (upTo >= 0 && upTo < 1e6) {
    for (const u of curriculum.units()) {
      if (curriculum.unitOrder(u.id) > upTo) continue;
      for (const x of curriculum.unitWords(u.id)) if (x && x.w) known.push(oneLine(x.w));
    }
  }
  const out = { level: levelLabel(word, curriculum) };
  if (textbookCn) out.textbookCn = textbookCn;
  if (known.length) out.known = [...new Set(known)].slice(-cap);
  return out;
}
