// 明天有听写，纸笔版（DESIGN 5.3）：选单元、勾掉老师没划的词、选老师的考法；千问读，她写在纸上；写完出答案，
// 她自己逐个打勾；错的马上再写一轮；睡前、第二天早上首页再提醒。这个文件只管逻辑（纯函数和一个小状态机），
// 界面在 ui-dictation.js。
// 负责：题型 agent（modes/choice.js、dictation.js）。
// 状态：骨架。形状已定；状态机能跑通一轮，提醒时间、错词进热身的规则由负责的 agent 补。
//
// 导出
//   METHODS = [['zh2en', '读中文写英文'], ['en2en', '读英文写英文'], ['phrase', '短语'], ['en2zh', '英译汉']]
//   promptFor(word, method) -> { say, lang, show, answer }
//     word = { slug, w(英文), cn(中文) }；say 是要朗读的文字，show 是屏幕上显示的提示（zh2en 显示中文，en2en 什么都不显示）
//   createDictation({ words, method, now }) -> Dictation
//     Dictation = {
//       method, words,
//       index, current() -> word | null, next() -> word | null, back(),   听写阶段：一个一个读
//       finishWriting(),                     写完了，进入对答案
//       mark(slug, ok: bool),                她自己打勾 / 打叉
//       wrong() -> [word],                   打了叉的
//       retryRound() -> Dictation | null,    只拿错的再来一轮（没有错的返回 null）
//       phase: 'writing' | 'checking' | 'done',
//       record() -> DictationRecord          存 kv 用（见下）
//     }
//   DictationRecord（kv 'dictation:<YYYY-MM-DD>'，同一天多轮放在 rounds 里）：
//     { date, unit, method, words: [slug], rounds: [{ at, words: [slug], marks: { slug: bool } }], remindAt?, morningDone? }
//   reminders(record, now) -> { tonight: bool, morning: bool }   首页要不要放“再写一次错的” / “出门前看一眼”
//
// 依赖：无。朗读走 ctx.say，事件（events 'dictation'：slug、correct、mode:'paper'、choice: method）由 ui-dictation 记。

export const METHODS = [['zh2en', '读中文写英文'], ['en2en', '读英文写英文'], ['phrase', '短语'], ['en2zh', '英译汉']];

export function promptFor(word, method = 'zh2en') {
  const w = (word && word.w) || '', cn = (word && word.cn) || '';
  if (method === 'en2en' || method === 'phrase') return { say: w, lang: 'en', show: '', answer: w };
  if (method === 'en2zh') return { say: w, lang: 'en', show: '', answer: cn };
  return { say: cn, lang: 'zh-CN', show: cn, answer: w };
}

const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function createDictation({ words = [], method = 'zh2en', unit = '', now = () => new Date(), rounds = [] } = {}) {
  const list = words.slice();
  const marks = {};
  let index = 0;
  let phase = list.length ? 'writing' : 'done';
  const d = {
    method, unit, words: list,
    get index() { return index; },
    get phase() { return phase; },
    current: () => (phase === 'writing' ? list[index] || null : null),
    next() { if (phase !== 'writing') return null; if (index < list.length - 1) index++; else d.finishWriting(); return d.current(); },
    back() { if (phase === 'writing' && index > 0) index--; },
    finishWriting() { phase = 'checking'; },
    mark(slug, ok) { if (phase === 'writing') return; marks[slug] = !!ok; if (list.every(w => w.slug in marks)) phase = 'done'; },
    marks: () => ({ ...marks }),
    wrong: () => list.filter(w => marks[w.slug] === false),
    retryRound() {
      const bad = d.wrong();
      return bad.length ? createDictation({ words: bad, method, unit, now, rounds: [...rounds, d.round()] }) : null;
    },
    round: () => ({ at: now().toISOString(), words: list.map(w => w.slug), marks: { ...marks } }),
    record: () => ({ date: dayOf(now()), unit, method, words: (rounds[0] ? rounds[0].words : list.map(w => w.slug)), rounds: [...rounds, d.round()] }),
  };
  return d;
}

// v0 placeholder: wrong words in the last round mean a reminder tonight (10 minutes after) and tomorrow morning
export function reminders(record, now = new Date()) {
  if (!record || !Array.isArray(record.rounds) || !record.rounds.length) return { tonight: false, morning: false };
  const last = record.rounds[record.rounds.length - 1];
  const anyWrong = Object.values(last.marks || {}).some(v => v === false);
  const sameDay = record.date === dayOf(now);
  return { tonight: anyWrong && sameDay && now.getTime() - new Date(last.at).getTime() >= 10 * 60e3, morning: anyWrong && !sameDay && !record.morningDone };
}
