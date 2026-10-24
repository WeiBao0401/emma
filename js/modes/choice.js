// 四选一（DESIGN 5.1，v0 唯一的题型）：看英文选中文意思（en2zh），或看中文选英文（zh2en）。干扰项带误解标签
// （form 形近、category 同类、meaning 意思近、sound 读音近，teacher-memory 2.2），作答记一条 events 'answer'。
// 负责：题型 agent（modes/choice.js、dictation.js、css/choice.css）。
// 状态：骨架。出题能出（随机挑 3 个干扰项），渲染是最简单的一屏；干扰项按标签挑、答错隔 4 张换形式再考、
// 第一张放最有把握的词这些规则由负责的 agent 补。
//
// 导出
//   DIRECTIONS = ['en2zh', 'zh2en']
//   meaningOf(entry) -> string               词条最短的中文意思（brief_cn，没有就用第一个义项）
//   makeQuestion(entry, pool, { direction, rng }) -> Question | null   纯函数
//     pool：可以当干扰项的词条（同一节课的词、同单元的词）；不够 3 个就返回 null（换闪卡或跳过）
//     Question = { id: 'w:<slug>', slug, direction, prompt: { text, lang: 'en' | 'zh-CN', say: 要朗读的英文 },
//                  options: [{ text, slug, correct: bool, tag: null | 'form' | 'category' | 'meaning' | 'sound' }],
//                  answer: 正确选项的下标 }
//   gradeOf({ correct, firstTry, ms, hintLevel }) -> 1 | 2 | 3 | 4   给 FSRS 的评分，看第一次作答：第一次就对 3，否则 1
//     （答错后自己改对也算 1，这张卡在这一轮稍后再出现）
//   choiceMode = { id: 'mc4', label: '四选一', render(entry, ctx) -> { el, footer, onKey } }
//     和 ui-review.js 的 flashcard 同一个“mode”接口，session.js 跑队列：
//     ctx = { app, rate(rating), say(text, button), position: { n, total, isNew }, pool: [entry],
//             onAnswer(ev)?: 作答时调用，ev 是 events 'answer' 的字段（type 由调用方补），sid、step 由 ui-lesson 补 }
//
// 依赖：ui-dom.js（h）。不直接写数据库：评分走 ctx.rate，事件走 ctx.onAnswer。
import { h } from '../ui-dom.js';

export const DIRECTIONS = ['en2zh', 'zh2en'];

export function meaningOf(e) {
  if (!e) return '';
  if (e.brief_cn) return String(e.brief_cn);
  const s = (e.senses || []).find(x => x && x.cn);
  return s ? String(s.cn).split(/[；;]/)[0] : (e.cn || '');
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function makeQuestion(entry, pool = [], { direction = 'en2zh', rng = Math.random } = {}) {
  if (!entry || !entry.slug) return null;
  const right = direction === 'en2zh' ? meaningOf(entry) : entry.headword;
  if (!right) return null;
  const seen = new Set([right]);
  const others = [];
  for (const p of shuffle(pool.filter(x => x && x.slug !== entry.slug), rng)) {
    const t = direction === 'en2zh' ? meaningOf(p) : p.headword;
    if (!t || seen.has(t)) continue;
    seen.add(t);
    others.push({ text: t, slug: p.slug, correct: false, tag: null });
    if (others.length === 3) break;
  }
  if (others.length < 3) return null;
  const options = shuffle([{ text: right, slug: entry.slug, correct: true, tag: null }, ...others], rng);
  return {
    id: 'w:' + entry.slug,
    slug: entry.slug,
    direction,
    prompt: direction === 'en2zh' ? { text: entry.headword, lang: 'en', say: entry.headword } : { text: meaningOf(entry), lang: 'zh-CN', say: '' },
    options,
    answer: options.findIndex(o => o.correct),
  };
}

export const gradeOf = ({ correct, firstTry = true } = {}) => (correct && firstTry ? 3 : 1);

export const choiceMode = {
  id: 'mc4',
  label: '四选一',
  render(e, ctx) {
    const q = makeQuestion(e, ctx.pool || []);
    const t0 = Date.now();
    let tries = 0;
    let done = false;
    const el = h('article', { className: 'mc4' });
    if (!q) {
      el.append(h('p', { className: 'mc4-prompt', lang: 'en', text: e.headword }), h('p', { className: 'small', text: '这个词还没有够用的选项，先跳过。' }),
        h('button', { type: 'button', className: 'btn', text: '下一个', on: { click: () => ctx.rate(3) } }));
      return { el, footer: null, onKey: null };
    }
    const prompt = h('p', { className: 'mc4-prompt', lang: q.prompt.lang, text: q.prompt.text });
    const list = h('div', { className: 'mc4-options', role: 'group', 'aria-label': '选一个' });
    q.options.forEach((o, i) => {
      const b = h('button', { type: 'button', className: 'mc4-opt', lang: q.direction === 'zh2en' ? 'en' : 'zh-CN', text: o.text, on: { click: () => pick(i, b) } });
      list.append(b);
    });
    function pick(i, b) {
      if (done) return;
      tries++;
      const o = q.options[i];
      if (ctx.onAnswer) {
        ctx.onAnswer({ item: q.id, slug: q.slug, mode: 'mc4', choice: o.text, correct: o.correct, first_try: tries === 1,
          ms: Date.now() - t0, hint_level: 0, misconception: o.correct ? null : o.tag });
      }
      if (o.correct) {
        done = true;
        b.classList.add('right');
        setTimeout(() => ctx.rate(gradeOf({ correct: true, firstTry: tries === 1 })), 450);
      } else {
        b.classList.add('wrong');
        b.disabled = true;
      }
    }
    el.append(prompt, list);
    if (q.prompt.say && ctx.say) setTimeout(() => ctx.say(q.prompt.say, null), 0);
    return { el, footer: null, onKey: ev => { const n = Number(ev.key); if (n >= 1 && n <= 4) list.children[n - 1].click(); } };
  },
};
