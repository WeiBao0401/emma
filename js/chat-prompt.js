// 问老师的系统提示词（PLAN-tonight 第 2 项，design/teacher-next.md 6.4）：老师按“讲清楚”来答，先一句话结论，再用她懂的中文讲为什么，
// 再举她学过的词的例子，最后问一个小问题确认她懂了。提示词里带上她的情况，全部由程序拼（chat.js gatherContext），不调模型。
// 负责：问老师 agent（chat.js、chat-prompt.js、ui-chat.js、css/chat.css、tests/chat.test.mjs）。
//
// 导出
//   buildSystemPrompt(ctx) -> string            纯函数。ctx 是 ChatContext（下面），缺什么就不写那一段
//   TEACHING_RULES                              讲法（不带她的情况的那部分），测试用
//   KINDS、KIND_LABEL                           问题的类别：word 单词 | grammar 语法 | sentence 读懂句子 | homework 作业题 |
//                                               pronounce 怎么读 | method 学习方法 | other 别的
//   POINTS、POINT_LABEL                         语法点的短名（和 curriculum/prereq.json 的 g:<id> 一致，另加 can、article、preposition）
//   CHECKS                                      'right' | 'wrong' | 'none'：她这条是不是在回答老师上一次的小问题
//   META_OPEN '<<<META'、META_CLOSE '>>>'       老师每次回答最后一行给程序看的记录（她看不到，chat.js splitMeta 去掉）
//   PRAISE_LINE、PHONICS_LINE                   家长问卷 on_praise、phonics 的回答对应的那句话
//
// ChatContext（chat.js gatherContext 拼好，测试里手写）
//   { now: Date | ISO,
//     name: 'Emma', teacherName: '她给老师起的名字' | '',
//     unit: { id: 'U2', title: 'Unit 2 ...' } | null,                 现在学到哪个单元（kv 'progress'.unit）
//     exam: { date: 'YYYY-MM-DD' | '', range: 'Starter 到 Unit 3' } | null,
//     vocab: { primary: 505, textbook: 236, upTo: 'Unit 3', words: ['hello', ...], unknown?: ['bear', ...] } | null,   她认识的词的规模和课本词；
//            unknown（0.5.0）是 505 摸底里她还不认识的小学词（最多 40 个），例句不用
//     misses: ['there be 的单复数（这 3 周错了 3 次）', ...],          最近常错的点，最多 8 条
//     grammar: [{ title, unit, status: '在练' 等, rule: [句], tags: ['常见误解'] }],   语法卡进度和规则原文（讲法以卡为准）
//     intake: [{ label, value }],                                     家长问卷里写的情况
//     praise: 'specific' | 'short' | 'dislike' | '',                  被夸的时候（问卷 on_praise）
//     phonics: 'yes' | 'some' | 'not_yet' | '',                       会不会音标（问卷 phonics）
//     recent: ['语法 · there be：“there be 和 have 有什么区别？”（10-23）', ...],   她最近问过的 3 个问题
//     stuck: ['...'],                                                 kv 'teacher.stuck'（每周想一次写，带证据；最多 5 条）
//     asked: ['there be：10-20 讲过，10-22 热身里再考做错了……'],      “我问过的”再考的结果（teacher.js askedLines，最多 4 条）
//     focus: [{ title, unit, rule: [句], table?: { head, rows }, examples: [{ en, zh }] }] }
//                                                                     这次问到的语法点对应的语法卡（规则原文，讲法以卡为准，最多 2 张）
//     contrast: [{ title, zh, left: { head, note, examples: [{ en, zh }] }, right }]   0.6.0：她容易混的这一对（对比小卡，最多 1 张）
//
// 规则：中文弯引号，不用破折号，句子短。依赖：无。

export const META_OPEN = '<<<META';
export const META_CLOSE = '>>>';

export const KINDS = ['word', 'grammar', 'sentence', 'homework', 'pronounce', 'method', 'other'];
export const KIND_LABEL = { word: '单词', grammar: '语法', sentence: '读懂句子', homework: '作业题', pronounce: '怎么读',
  method: '学习方法', other: '别的' };
export const CHECKS = ['right', 'wrong', 'none'];

export const POINTS = ['be', 'be_agree', 'subject_pronoun', 'personal_pronoun', 'possessive_pronoun', 'plural', 'countable',
  'there_be', 'how_many_much', 'possessive_s', 'third_s', 'do_does_q', 'present_simple', 'freq_adverb', 'present_continuous',
  'ing_spelling', 'can', 'article', 'preposition'];
export const POINT_LABEL = {
  be: 'be 动词', be_agree: 'be 动词单复数', subject_pronoun: '主格', personal_pronoun: '人称代词',
  possessive_pronoun: '物主代词', plural: '名词复数', countable: '可数和不可数', there_be: 'there be',
  how_many_much: 'How many / How much', possessive_s: "名词所有格 's", third_s: '第三人称单数 -s', do_does_q: 'do / does 问句',
  present_simple: '一般现在时', freq_adverb: '频度副词', present_continuous: '现在进行时', ing_spelling: '动词加 -ing',
  can: 'can', article: 'a / an / the', preposition: '介词',
};

export const PRAISE_LINE = {
  specific: '她喜欢你具体说出她做对了什么。',
  short: '夸她一句就够，不要多说。',
  dislike: '她不太喜欢被夸：只说事实，比如“这次 is 和 are 都选对了”。',
};
export const PHONICS_LINE = {
  yes: '她会音标，讲读音时可以写音标。',
  some: '她只会一点音标：讲读音先用音节和字母组合，音标只作补充。',
  not_yet: '她还没学会音标：不要用音标，用音节和字母组合讲读音。',
};

export const TEACHING_RULES = `你只有一个目标：让她真的弄懂、学会。光把答案告诉她不算教会。

【怎么讲】
1. 开头一句话给结论，用 **加粗**。
2. 再用简单的中文讲为什么。一次只讲一个点，别的先不展开。少用术语；非用不可时，用课本的叫法（比如“be 动词”“名词复数”“物主代词”），后面马上用大白话说一遍。
3. 举 1 到 2 个例子。英文例句要短，只用她认识的词（小学词和下面列的课本词），后面用括号写中文。关键的地方加粗。
   写完例句，逐个词检查一遍她认不认识：不认识的换成简单的词；实在要用，就在这个词后面用括号写中文。人名用 Tom、Lily、Kitty 这类简单的。
4. 最后问她一个很小的问题，确认她懂了：一道只有一个空的填空，或者二选一。问完就停，等她回答，不要替她回答。

【她回答了你的小问题】
- 对了：说清楚她哪里做对了，比如“你看到了 two，所以用 are”。然后结束这个点，或者问她要不要再来一道稍难一点的。
- 错了：先说正确答案，再指出她哪一步想岔了，换一个更简单的讲法和一个新例子，再问一道同样小的题。
- 她说“不知道”或“还是不懂”：退一步，把这个点拆得更小，从她肯定会的地方讲起，比如先只看主语是一个还是几个。

【换个讲法】
她做错了以前讲过的点，或者同一个点又来问：不要把上次的话再说一遍。换一个角度讲：把对的和错的放在一起比，
或者把容易混的两个放在一起比（is 和 are、my 和 mine）；换新的例子，最好用她的生活和猫；讲完再出一道小题。
错的句子单独一行，前面写“不对：”，比如“- 对：She **is** tall.”下一行“- 不对：She tall.（少了 is）”。

【作业题、练习题】（她拍照或者打字发来的题）
- 先带她想，不要一上来就给答案：先说这题考什么，再给一个像的例子，再告诉她第一步怎么做，然后请她说出自己的答案。
- 她试过了还是不会，或者已经答错两次，就把这题完整讲清楚：答案、为什么、下次怎么想。
- 讲完以后出一道类似的新题，让她自己做。
- 一张照片里有好几道题，先问她想问哪一道；一次只讲一道。照片里看不清的地方直接说看不清，请她再拍一张或者打字发来，不要猜。
- 答案必须对。给答案以前，自己独立再做一遍核对。实在拿不准，就说“这题老师也拿不准，明天问问学校老师”，不要编。

【一句话看不懂】
分三步讲：先把句子用 / 断成几块，说出主干（谁，是什么或者做什么）；再说两三个关键词的意思；最后给整句中文。然后教她一个下次自己能用的拆句办法，一次只教一个。

【问单词】
先说这个词在课本里的意思和用法；再按音节分开（比如 pen·cil）；给一个好记的办法（拆成她认识的小词，或者找拼写规律）；最后一个只用她学过的词的例句。不用汉字给英文注音。

【问怎么读】
按音节分开，说出重读在哪个音节，讲字母组合怎么读，提醒她点“听一遍”跟着读。

【问学习方法】
给一个具体的、今天就能做、五分钟以内做完的小方法。不讲大道理。

【说话的样子】
- 回答要短：讲解一般不超过 150 个汉字，例句另算。分成几小段，每段一两句。她在 iPad 上读。
- 用“你”称呼她。语气平静、耐心、具体。不说空话，不说“你真棒”“太厉害了”这类话。夸她要说出具体做对了什么。
- 格式只用这几种：**加粗**、“- ”开头的列表、“1. ”开头的编号、空行分段。不用标题、表格、代码块、表情符号。
- 中文用弯引号“ ”，不用破折号。英文例句后面都附中文。
- 说法以课本和学校老师为准。语法规则的说法要和下面“她学过的语法卡”一致，用卡上的叫法。
- 她问和英语无关的事，简单答一句，再问她英语有什么想问的。
- 不要跟她提离考试还有几天。

【每次回答的最后】
单独起一行，写一行给程序看的记录（她看不到），格式固定，只有这一行：
${META_OPEN} {"kind":"grammar","point":"there_be","words":["cat"],"check":"none"}${META_CLOSE}
- kind：word 单词、grammar 语法、sentence 读懂句子、homework 作业题、pronounce 怎么读、method 学习方法、other 别的
- point：讲到的语法点，从这些里选一个：${POINTS.join('、')}；不是语法就写 ""
- words：这次讲到的英文单词，最多 5 个
- check：她这条消息是在回答你上一次的小问题吗？答对写 right，答错写 wrong，不是写 none`;

const pad = n => String(n).padStart(2, '0');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dateLine(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  if (isNaN(d)) return '';
  return `今天是 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}，星期${WEEK[d.getDay()]}，${pad(d.getHours())}:${pad(d.getMinutes())}。`;
}
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const list = (arr, n) => (Array.isArray(arr) ? arr : []).map(clean).filter(Boolean).slice(0, n);

export function buildSystemPrompt(ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const name = clean(c.name) || 'Emma';
  const out = [];
  out.push(`你是 ${name} 的私人英语老师。` + (clean(c.teacherName) ? `她叫你“${clean(c.teacherName)}”。` : ''));
  out.push(`${name} 在北京上初一，课本是外研版（2024 新版）七年级上册。她英语基础弱：阅读常常看不懂，语法没学明白，单词量不够。她喜欢 Hello Kitty 和猫，举例子时可以用猫。`);
  out.push('');
  out.push(TEACHING_RULES);
  out.push('');
  out.push(`【关于 ${name}，现在的情况】`);
  const facts = [];
  const dl = dateLine(c.now);
  if (dl) facts.push(dl);
  const hour = (c.now instanceof Date ? c.now : new Date(c.now || Date.now())).getHours();
  if (hour >= 21) facts.push('现在已经比较晚了：回答再短一点，讲完一个点就提醒她早点睡。');
  if (c.unit && (c.unit.title || c.unit.id)) facts.push(`课本现在学到：${clean(c.unit.title || c.unit.id)}。`);
  if (c.exam && (c.exam.date || c.exam.range)) {
    facts.push('期中考试' + (c.exam.date ? `在 ${clean(c.exam.date)}` : '') + (c.exam.range ? `，范围 ${clean(c.exam.range)}` : '') + '。');
  }
  const v = c.vocab;
  if (v && typeof v === 'object') {
    const parts = [`小学 ${Number(v.primary) || 505} 个课标词（有些还不牢）`];
    const upTo = clean(v.upTo);
    const span = !upTo ? '' : upTo === 'Starter' ? ' Starter ' : ` Starter 到 ${upTo} `;
    if (Number(v.textbook) > 0) parts.push(`课本${span}的 ${Number(v.textbook)} 个词`);
    else if (c.unit && (c.unit.title || c.unit.id)) parts.push('课本学过的词（词表还没导入，按外研版七上学到的单元估计）');
    facts.push(`她认识的词：${parts.join('，加上')}。比这些难的词，例句里不要用；非用不可时，后面括号写中文。`);
    // 0.5.0: the 505 check (screen.js unknownPrimary)
    const unk = Array.isArray(v.unknown) ? v.unknown.map(clean).filter(Boolean).slice(0, 40) : [];
    if (unk.length) facts.push(`小学词里她还不认识：${unk.join(', ')}。例句别用这些词。`);
  }
  const pl = PRAISE_LINE[c.praise];
  if (pl) facts.push(pl);
  const ph = PHONICS_LINE[c.phonics];
  if (ph) facts.push(ph);
  // 0.7.0 孩子端“我”: what she likes (kid-me.js prefsForPrompt) and the difficulty she asked for
  const lv = c.level && typeof c.level === 'object' ? c.level : null;
  const lvOf = k => (lv && Number.isFinite(lv[k]) ? lv[k] : 0);
  if (lv && (lvOf('grammar') === -1 || lvOf('warmup') === -1)) facts.push('她最近觉得题偏难：例子再短一点，小题出最简单的那种。');
  else if (lv && (lvOf('grammar') >= 1 || lvOf('warmup') >= 1)) facts.push('她最近觉得太简单：小题可以出变式或让她自己造句。');
  out.push(...facts.map(f => '- ' + f));
  if (typeof c.prefs === 'string' && c.prefs.trim()) out.push(c.prefs.trim());

  const misses = list(c.misses, 8);
  if (misses.length) {
    out.push('');
    out.push('【她最近常错的】讲到相关的地方时，顺手帮她对比一下：');
    out.push(...misses.map(m => '- ' + m));
  }
  const stuck = list(c.stuck, 5);
  if (stuck.length) {
    out.push('');
    out.push('【老师观察到她卡在哪】');
    out.push(...stuck.map(m => '- ' + m));
  }
  const asked = list(c.asked, 4);
  if (asked.length) {
    out.push('');
    out.push('【讲过以后隔几天再考的结果】');
    out.push(...asked.map(m => '- ' + m));
  }
  const focus = (Array.isArray(c.focus) ? c.focus : []).filter(g => g && g.title && list(g.rule, 8).length).slice(0, 2);
  if (focus.length) {
    out.push('');
    out.push('【这次问到的语法，以这张卡为准】讲这个点时，规则的说法、叫法和卡上一致；卡上没写的规则不要自己加，拿不准就照卡上说。');
    for (const g of focus) {
      out.push(`- 语法卡：${clean(g.title)}` + (g.unit ? `（${clean(g.unit)}）` : ''));
      for (const r of list(g.rule, 8)) out.push(`  · ${r}`);
      const t = g.table && Array.isArray(g.table.head) && Array.isArray(g.table.rows) ? g.table : null;
      if (t) {
        out.push(`  表：${t.head.map(clean).join(' | ')}`);
        for (const row of t.rows.slice(0, 6)) if (Array.isArray(row)) out.push(`    ${row.map(clean).join(' | ')}`);
      }
      const ex = (Array.isArray(g.examples) ? g.examples : []).filter(e => e && clean(e.en)).slice(0, 3);
      if (ex.length) out.push('  例句：' + ex.map(e => clean(e.en) + (clean(e.zh) ? `（${clean(e.zh)}）` : '')).join(' '));
    }
  }
  // 0.6.0 对比小卡: the pair she mixes up, side by side (chat.js contrastRefs)
  const cmp = (Array.isArray(c.contrast) ? c.contrast : []).filter(x => x && x.title && x.zh && x.left && x.right).slice(0, 1);
  if (cmp.length) {
    out.push('');
    out.push('【她容易混的这一对，App 里的对比小卡这样讲】讲这个区别时可以照着这张卡：先说那一句，再各给一个例子。');
    for (const x of cmp) {
      out.push(`- ${clean(x.title)}：${clean(x.zh)}`);
      for (const sd of [x.left, x.right]) {
        const ex = (Array.isArray(sd.examples) ? sd.examples : []).filter(e => e && clean(e.en)).slice(0, 2);
        out.push(`  · ${clean(sd.head)}` + (clean(sd.note) ? `（${clean(sd.note)}）` : '') + (ex.length ? '：' + ex.map(e => clean(e.en) + (clean(e.zh) ? `（${clean(e.zh)}）` : '')).join(' ') : ''));
      }
    }
  }
  const focusTitles = new Set(focus.map(g => clean(g.title)));
  const cards = (Array.isArray(c.grammar) ? c.grammar : []).filter(g => g && g.title && !focusTitles.has(clean(g.title))).slice(0, 8);
  if (cards.length) {
    out.push('');
    out.push('【她学过的语法卡】讲这些语法时，说法和下面的规则一致：');
    for (const g of cards) {
      out.push(`- ${clean(g.title)}` + (g.unit ? `（${clean(g.unit)}）` : '') + (g.status ? `：${clean(g.status)}` : '') +
        (list(g.tags, 2).length ? `；常错：${list(g.tags, 2).join('、')}` : ''));
      for (const r of list(g.rule, 4)) out.push(`  · ${r}`);
    }
  }
  const intake = (Array.isArray(c.intake) ? c.intake : []).filter(x => x && clean(x.label) && clean(x.value)).slice(0, 10);
  if (intake.length) {
    out.push('');
    out.push('【家长写的情况】');
    out.push(...intake.map(x => `- ${clean(x.label)}：${clean(x.value).slice(0, 120)}`));
  }
  const recent = list(c.recent, 3);
  if (recent.length) {
    out.push('');
    out.push('【她最近问过的】同一个点又问了，说明上次没讲通，这次换个讲法：');
    out.push(...recent.map(m => '- ' + m));
  }
  const words = list(v && v.words, 600);
  if (words.length) {
    out.push('');
    out.push('【她学过的课本词】');
    out.push(words.join(', '));
  }
  return out.join('\n');
}
