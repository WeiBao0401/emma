// “进 Unit X 了”这一层（unit-flow.js 的界面）：在 document.body 上盖一层全屏（.uf-screen），一次一屏，从上往下：
// 植物还是动物（第 5、6 单元顺序不确定时）、拍本单元词汇表（跳到拍课本）、这单元的语法卡和要先打的地基（点开看规则，
// 还没学的可以当场做第一天）、5 个新词（点一下读）。底部“知道了”。样式 css/unit-flow.css（类名 uf-）。
// 负责：语法卡 agent。
//
// 导出
//   createUnitFlow(ctx, { now }) -> { check(), open(unitId, { reason }), hide(), inSession(), holding(), el }
//     check()：看 unit-flow.js 的 syncFlow 该不该弹（第一次只记下现在的单元）；该弹就 open。返回 Promise<是否弹了>。
//       app.js 在回到“今天”时调（不在上课、不在第一次打开的流程里）。
//     open(unitId, { reason })：直接打开（弹出就记 shown，reason 'date' 时把进度改过去）。
//     hide()：拿掉这一层（换路由时 app.js 调）。inSession()：正在这一层里做语法卡。
//   renderNextFrom(container, ctx, { onSaved }) -> { el }   “下个单元哪天开始”一行（日期框、存、清掉），给家长区和“我”挂上去
//   ctx 用到：kv、curriculum、say、events.log / sessionId、go（'capture'）、toast、busy、fetchJSON（语法卡没读到时）
import { h, icon } from './ui-dom.js';
import * as G from './grammar.js';
import * as U from './unit-flow.js';
import { renderGrammarCard } from './ui-grammar.js';

const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x !== null && x !== undefined && x !== false && x !== ''));
const STATUS_ZH = { new: '还没学', learning: '学了一半', practicing: '在练', steady: '练稳了' };

export function createUnitFlow(ctx = {}, { now = () => new Date() } = {}) {
  let overlay = null, practicing = null;
  const clock = () => (typeof now === 'function' ? now() : new Date(now));
  const log = ev => safe(() => ctx.events && ctx.events.log && ctx.events.log({ ...ev, ...(ctx.events.sessionId ? { sid: ctx.events.sessionId() } : {}) }), null);
  const ensureGrammar = async () => { if (G.content()) return G.content(); try { return await G.loadGrammar({ fetchJSON: ctx.fetchJSON }); } catch (e) { return null; } };

  function mount() {
    if (!overlay) {
      overlay = h('div', { className: 'uf-screen', role: 'dialog', 'aria-label': '进新单元' });
      document.body.append(overlay);
    }
    overlay.hidden = false;
    safe(() => document.documentElement.classList.add('uf-open'));
    return overlay;
  }
  function hide() {
    if (practicing) { safe(() => practicing.stop && practicing.stop()); practicing = null; }
    if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
    safe(() => document.documentElement.classList.remove('uf-open'));
  }
  const head = () => h('div', { className: 'uf-head' },
    h('span', { className: 'uf-head-title' }, '进新单元'),
    h('button', { type: 'button', className: 'text-btn uf-close', 'aria-label': '关上', on: { click: () => { log(U.introEvent(cur.unit, 'seen', cur.reason)); hide(); } } }, icon('close')));

  let cur = { unit: '', reason: '' };
  function draw() {
    const box = mount();
    const it = U.unitIntro(ctx.kv, cur.unit, { curriculum: ctx.curriculum, grammar: G.content(), now: clock() });
    const page = h('div', { className: 'uf-page' }, head(),
      h('h1', { className: 'uf-title' }, `进 ${it.name} 了`),
      it.title ? h('p', { className: 'uf-sub' }, it.title) : null,
      orderPart(it), photoPart(it), cardsPart(it), wordsPart(it),
      h('div', { className: 'uf-end' },
        h('button', { type: 'button', className: 'btn uf-main', on: { click: () => { log(U.introEvent(it.unit, 'seen', cur.reason)); hide(); } } }, '知道了')));
    fill(box, page);
  }

  function orderPart(it) {
    if (!it.order || !it.order.ask) return null;
    const pick = async id => {
      await U.answerOrder(ctx.kv, { unit: it.unit, topic: id }, clock());
      log(U.orderEvent(it.unit, id));
      safe(() => ctx.toast && ctx.toast(`记下了：${it.name} 是${id === 'plants' ? '植物' : '动物'}。`));
      draw();
    };
    return h('section', { className: 'uf-sec uf-order' },
      h('p', { className: 'uf-ask' }, it.order.text),
      h('div', { className: 'uf-choices' }, it.order.choices.map(c =>
        h('button', { type: 'button', className: 'uf-choice', on: { click: () => pick(c.id) } }, c.label))));
  }
  function photoPart(it) {
    if (!it.photo.need) return h('section', { className: 'uf-sec' }, h('p', { className: 'uf-quiet' }, '这单元的词汇表拍过了。'));
    return h('section', { className: 'uf-sec' },
      h('h2', { className: 'uf-label' }, '先拍词汇表'),
      h('p', { className: 'uf-text' }, '翻到书后面这个单元的词汇表，拍一张，老师就知道这单元学哪些词。'),
      h('button', { type: 'button', className: 'text-btn accent uf-go', on: { click: () => { log(U.introEvent(it.unit, 'photo', cur.reason)); hide(); safe(() => ctx.go && ctx.go('capture', { unit: it.unit, from: 'unit' })); } } },
        '去拍课本', icon('chev')));
  }
  function cardRow(c, { lean }) {
    const card = safe(() => G.content().card(c.id), null);
    const detail = h('div', { className: 'uf-rule', hidden: true },
      card ? card.rule.slice(0, 2).map(r => h('p', null, r)) : null,
      card && card.examples[0] ? h('p', { className: 'uf-ex' }, card.examples[0].en, h('span', { className: 'uf-ex-zh' }, card.examples[0].zh)) : null,
      c.status === 'new' ? h('button', { type: 'button', className: 'text-btn accent', on: { click: () => practice(c.id) } }, '现在做第一天的 5 道') : null);
    const row = h('li', { className: 'uf-card' + (lean ? ' lean' : '') },
      h('button', { type: 'button', className: 'uf-card-btn', 'aria-expanded': 'false', on: { click: e => {
        detail.hidden = !detail.hidden; safe(() => e.currentTarget.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true'));
      } } },
        h('span', { className: 'uf-card-title' }, c.title),
        h('span', { className: 'uf-card-tag' }, c.preview ? '七下预告' : lean ? '先打地基' : '这单元学'),
        h('span', { className: 'uf-card-status' }, STATUS_ZH[c.status] || '')),
      detail);
    return row;
  }
  function cardsPart(it) {
    const { cards = [], foundations = [], note = '' } = it.cards || {};
    if (!cards.length && !foundations.length) return null;
    return h('section', { className: 'uf-sec' },
      h('h2', { className: 'uf-label' }, '这单元的语法'),
      note ? h('p', { className: 'uf-text' }, note) : null,
      foundations.length ? h('p', { className: 'uf-text' }, '先看一眼要用到的地基，点开看规则。') : null,
      h('ul', { className: 'uf-cards' }, foundations.map(c => cardRow(c, { lean: true })), cards.map(c => cardRow(c, { lean: false }))));
  }
  function wordsPart(it) {
    return h('section', { className: 'uf-sec' },
      h('h2', { className: 'uf-label' }, it.words.length ? `${it.words.length} 个新词` : '新词'),
      it.words.length
        ? h('ul', { className: 'uf-words' }, it.words.map(w => h('li', null,
          h('button', { type: 'button', className: 'uf-word', on: { click: e => safe(() => ctx.say && ctx.say(w.w, e.currentTarget)) } },
            h('span', { className: 'uf-w' }, w.w), h('span', { className: 'uf-cn' }, w.cn)))))
        : h('p', { className: 'uf-quiet' }, it.wordsNote));
  }
  function practice(cardId) {
    const box = mount();
    const area = h('div', { className: 'uf-practice' });
    fill(box, h('div', { className: 'uf-page' }, head(), area));
    log(U.introEvent(cur.unit, 'card', cur.reason));
    practicing = renderGrammarCard(area, ctx, { cardId, part: 1, step: 'grammar', doneLabel: '回到新单元', onDone: () => { practicing = null; draw(); } });
  }

  async function open(unitId, { reason = 'progress' } = {}) {
    await ensureGrammar();
    cur = { unit: String(unitId || ''), reason };
    if (!cur.unit) return false;
    await U.markShown(ctx.kv, { unit: cur.unit, reason }, clock(), { curriculum: ctx.curriculum });
    draw();
    return true;
  }
  async function check() {
    try {
      const due = await U.syncFlow(ctx.kv, clock(), { curriculum: ctx.curriculum });
      if (!due) return false;
      return await open(due.unit, { reason: due.reason });
    } catch (e) { console.warn('unit-flow:', (e && e.message) || e); return false; }
  }
  return { check, open, hide, inSession: () => !!practicing, holding: () => false, get el() { return overlay; } };
}

// 家长区 / “我”：下个单元哪天开始（kv progress.nextFrom）
export function renderNextFrom(container, ctx = {}, { onSaved = () => {}, now = () => new Date() } = {}) {
  const clock = () => (typeof now === 'function' ? now() : new Date(now));
  const progress = () => safe(() => ctx.kv.peek('progress', {}), {}) || {};
  const title = id => safe(() => (ctx.curriculum && ctx.curriculum.unitTitle ? ctx.curriculum.unitTitle(id) : U.unitName(id)), U.unitName(id));
  const input = h('input', { type: 'date', className: 'uf-date', value: String(progress().nextFrom || '').slice(0, 10), 'aria-label': '下个单元哪天开始' });
  const msg = h('p', { className: 'uf-msg' }, U.nextFromText(progress(), { title }));
  const save = async v => {
    const r = await U.setNextFrom(ctx.kv, v, clock(), { curriculum: ctx.curriculum });
    msg.textContent = r.error || U.nextFromText(r.progress, { title }) || '清掉了。';
    msg.className = 'uf-msg' + (r.error ? ' warn' : '');
    if (!r.error) { input.value = String(r.progress.nextFrom || ''); safe(() => onSaved(r.progress)); }
  };
  const el = h('div', { className: 'uf-next' },
    h('label', { className: 'uf-next-label' }, '下个单元哪天开始', input),
    h('div', { className: 'uf-next-actions' },
      h('button', { type: 'button', className: 'text-btn accent', on: { click: () => save(input.value) } }, '存'),
      h('button', { type: 'button', className: 'text-btn', on: { click: () => save('') } }, '清掉')),
    msg);
  fill(container, el);
  return { el };
}
