// 提示词：初一孩子版（DESIGN 5.9、8.5）。查词讲解给一个北京初一、英语基础弱的学生看：课本里的那个意思在前，
// 1-2 个义项，例句只用她认识的词（小学 505 词 + 已学单元的课本词），等级由程序传入（“课本 Unit 3 / 初中词 /
// 课外词”），不让模型猜。
// 0.8.2（Wei 10-26）：查词要给巧记。App 是帮她用好方法记住单词的老师，不是只给释义和例句的词典：core 另要
// 词性中文名（posZh）、1-2 种巧记（mem：想画面 / 拆开记 / 连中文 / 小故事，谐音只在自然、不误导读音时用，并提醒真正的读音）、
// 容易错（trap）、最常用的一个搭配（use）。字段名和离线巧记小本（word-notes.js，curriculum/word-notes-*.json）一样。
// 旧词条没有巧记时，查词页用 SYSTEM.memo 单独补一次（words.js fillMemory，见 CONTRACTS needs）。
// 负责：孩子版查词 agent（kid-errors.js、prompts.js）。
//
// JSON 的字段和词典版一样（words.js、ui-entry.js、db.js 直接接得上）：
//   core      status, headword, suggestions, kind, level, phonetic, syllables, brief_cn, senses[{pos, cn, en, example, example_cn}], context_note,
//             0.8.2 起另有 posZh, mem[{kind, text}], trap, use
//   lexicon   collocations, synonyms, antonyms, word_family, roots, confusables, usage_tip（数量变少，可以是空的）
//   practice  reading{title, text, cn}, quiz[3 道 choice]
//   zh        status, query, translation, explain, options[{en, pos, cn, nuance, example, example_cn, level}], best
//   story     title, text（**word** 标出目标词）, cn, questions[{q, a}]
//   hint      mnemonic（答错后的巧记，一句中文）
//   memo      posZh, mem[{kind, text}], trap, use（0.8.2：给已经有讲解、还没有巧记的词补巧记）
// 旧词条的 mnemonic（一句话巧记）留在 CORE_KEYS 里，旧词条和导入合并（db.js mergeEntry）照旧；查词页把它当一条巧记显示。
//
// 导出
//   SYSTEM[kind]                               系统提示词，kind：core | lexicon | practice | zh | story | hint | memo
//   CORE_KEYS / LEXICON_KEYS / PRACTICE_KEYS   从回答里拷进词条的字段（白名单）
//   MEMORY_KEYS                                ['posZh', 'mem', 'trap', 'use']：巧记那几个字段（core 和 memo 都给）
//   MEM_KINDS                                  ['picture', 'split', 'link', 'story', 'sound']
//   cleanMemory(raw) -> { posZh, mem, trap, use }   模型或小本给的巧记清洗一遍：kind 认不出的留空、最多 2 条、去破折号和直角引号；
//                                              没有 mem 但有旧的 mnemonic 时变成一条 kind 为 '' 的巧记
//   userMsg(q, context, fromCn, hints?)        查词的用户消息。第一行永远是 “Input: <q>”（模拟模式和测试靠它）
//   memoUserMsg({ headword, brief_cn, senses }, hints?)   补巧记的用户消息，第一行也是 “Input: <词>”
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
  'Chinese: short and plain, like a kind teacher talking to a 12-year-old. No grammar jargon beyond the part-of-speech names (名词、动词、形容词、副词、代词、介词、连词、数词、冠词) and 单数、复数、过去式. Use curly quotes “ ” in Chinese, never 「」. Do not use em dashes.',
  'English examples: 4-10 words, simple present tense unless the word needs another tense, and ONLY words she knows plus the target word. Topics: school, classmates, family, home, food, animals, sports, hobbies, weather, holidays. Never work, office, meetings, emails, business or technology.',
  'Every real English word gets a normal explanation, including words like die, dead, kill, hunt, fight, sad, cry and hate that appear in school texts: use plain, everyday examples.',
].join('\n');

// The memory part (Wei 10-26): the same fields as the offline notes (word-notes.js), asked for in the lookup (core)
// and, for an old entry that has none yet, on its own (memo).
const MEMORY_SCHEMA = `  "posZh": "sense 1 的词性中文名：名词 / 动词 / 形容词 / 副词 / 代词 / 介词 / 连词 / 数词 / 冠词 / 感叹词 / 短语",
  "mem": [{"kind": "picture" | "split" | "link" | "story" | "sound", "text": "一两句中文巧记"}],
  "trap": "最容易拼错或用错的地方，一句中文；没有就空字符串",
  "use": "最常用的一个搭配或句型，英文在前、中文放在括号里，例如 a strict teacher（严格的老师）"`;

export const MEMORY_RULES = `Memory help ("mem") matters most: she must still remember this word, how to spell it and what it means tomorrow. A meaning and an example sentence alone are not enough.
- 1 or 2 tricks. Pick the kinds that really fit this word; never force one:
  picture: a concrete scene she can see in her head (her classroom, her teacher, her family, a cat, Hello Kitty), tied to the meaning and, when you can, to the letters;
  split: cut the word into parts she already knows (class + room, any + thing) and say what each part means;
  link: link it to Chinese: the Chinese meaning, a Chinese word it looks or sounds like, the shape of the letters;
  story: a one- or two-sentence little story that carries the meaning and the spelling;
  sound: a Chinese sound-alike (谐音), ONLY when it is natural and close to the real pronunciation (bus 巴士, sofa 沙发), and remind her of the real sound, e.g. “真正读 /bʌs/”. Never a sound-alike that teaches a wrong pronunciation, and never a rude, scary or silly one.
- Each "text": 15-80 Chinese characters, concrete and vivid, something a 12-year-old sees at once. Not a definition, not “多读几遍”. English inside it: only the target word, its letters and words she knows.
- Example for strict: [{"kind": "picture", "text": "王老师站在讲台上，眉毛一竖：“Be quiet!” strict 开头 s-t-r 三个辅音挤在一起，就像她把每个人都管得紧紧的。"}, {"kind": "split", "text": "str（拉紧，像 string 绳子）+ ict：绳子拉得紧紧的，管得很严，就是“严格的”。"}]. This example is for strict only: every word gets its own scene.
- "trap": a spelling trap (a silent letter, a double letter, letters she may swap, a sound written in an unusual way) or a usage trap (a / an, plural, the word that goes after it). Empty string when there is none.
- "use": the one most common collocation or short sentence pattern, only words she knows, English first, then the Chinese in （）.
- "posZh": the Chinese name of the part of speech of sense 1.`;

export const CORE_SYSTEM = COMMON + `
She typed an English word or phrase. First check it, then explain it simply, then help her remember it.
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
  "context_note": "如果给了原句：这里是什么意思，一两句话；否则空字符串",
${MEMORY_SCHEMA}
}
Rules:
- "typo": a misspelling of a real word/phrase; fill suggestions, other fields may be empty.
- "invalid": gibberish, random characters, a full sentence with no clear target word, or not English.
- 1 or 2 senses, never more. If a textbook meaning is given, sense 1 is exactly that meaning. Otherwise, if a context sentence is given, the sense used there comes first. Add a second sense only when it is very common (for example the sense used in the context sentence, when it is not the textbook one).
- The memory help is about sense 1.
${MEMORY_RULES}`;

export const MEMO_SYSTEM = COMMON + `
She already has a short explanation of this English word or phrase (the meaning is given). Help her remember it: its meaning, its spelling and its part of speech. If the input is not a real English word or phrase, return {"invalid": true}.
Schema:
{
${MEMORY_SCHEMA}
}
${MEMORY_RULES}`;

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
  memo: MEMO_SYSTEM + JSON_NOTE,
};

export const LEXICON_KEYS = ['collocations', 'synonyms', 'antonyms', 'word_family', 'roots', 'confusables', 'usage_tip'];
export const PRACTICE_KEYS = ['reading', 'quiz'];
// the memory fields, same names as the offline notes (word-notes.js): in the core reply and the memo reply
export const MEMORY_KEYS = ['posZh', 'mem', 'trap', 'use'];
// Core fields copied into an entry (headword is handled separately); anything else the model returns is ignored.
// mnemonic stays listed for old entries and import merges (db.js); the kid prompt asks for mem instead (0.8.2).
export const CORE_KEYS = ['kind', 'level', 'phonetic', 'syllables', 'brief_cn', 'senses', 'context_note', 'mnemonic', ...MEMORY_KEYS];

// ---------------------------------------------------------------- memory help, cleaned

export const MEM_KINDS = ['picture', 'split', 'link', 'story', 'sound'];
// what a model may write instead of the five kinds
const KIND_ALIAS = { image: 'picture', scene: 'picture', imagine: 'picture', parts: 'split', break: 'split', root: 'split', roots: 'split',
  chinese: 'link', connect: 'link', association: 'link', homophone: 'sound', '谐音': 'sound', '画面': 'picture', '拆开': 'split', '故事': 'story' };
const MEM_MAX = 2;
const clip = (s, n) => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join('') + '…' : s; };
// her app never shows a dash used as a pause or corner quotes
function tidy(s, n = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
    .replace(/\s*(——|—|--)\s*/g, '，').replace(/「/g, '“').replace(/」/g, '”').replace(/，{2,}/g, '，').replace(/^，|，$/g, '');
  return clip(t, n);
}
function memKind(k) {
  const s = String(k ?? '').trim().toLowerCase();
  if (MEM_KINDS.includes(s)) return s;
  return KIND_ALIAS[s] || '';
}

// raw: a core or memo reply, an entry, or an offline note. Never throws; missing parts come back empty.
export function cleanMemory(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let list = r.mem;
  if (typeof list === 'string') list = [{ kind: '', text: list }];
  if (list && !Array.isArray(list) && typeof list === 'object') list = [list];
  const mem = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const item = typeof x === 'string' ? { kind: '', text: x } : x && typeof x === 'object' ? x : null;
    if (!item) continue;
    const text = tidy(item.text ?? item.tip ?? '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    mem.push({ kind: memKind(item.kind), text });
    if (mem.length >= MEM_MAX) break;
  }
  // an old entry's one-line mnemonic is still a memory trick
  if (!mem.length && typeof r.mnemonic === 'string' && r.mnemonic.trim()) mem.push({ kind: '', text: tidy(r.mnemonic) });
  return { posZh: tidy(r.posZh, 24), mem, trap: tidy(r.trap, 120), use: tidy(r.use, 120) };
}

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

// An entry that has its explanation but no memory help yet (looked up before 0.8.2): the word, its meaning and part of speech.
export function memoUserMsg(entry = {}, hints = {}) {
  const e = entry || {};
  const s0 = Array.isArray(e.senses) && e.senses[0] ? e.senses[0] : {};
  const cn = oneLine(s0.cn || (hints && hints.textbookCn) || e.brief_cn || '');
  const pos = oneLine(s0.pos || '');
  let msg = `Input: ${oneLine(e.headword || e.w || '')}`;
  if (cn) msg += `\nMeaning (sense 1): ${cn}`;
  if (pos) msg += `\nPart of speech: ${pos}`;
  return msg + knownLine(hints && hints.known);
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
