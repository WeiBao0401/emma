// 错题标签的界面（第 5 个标签“错题”）：上面一个大的“拍一道题”，下面错题本（按考点或单元分组，显示还没攻克几道）。
// 拍照 → 老师认题 → 她看一眼、可以改、勾要收的 → 收进错题本 → 打开一道：老师讲（先结论、再为什么、一个例子、一道新题）
// → 还不懂接着问老师（ctx.go('chat', { ask, send })）→ 到日子再考一道同考点的新题，做对两次算攻克。
// 逻辑都在 mistakes.js，这里只画。样式 css/mistakes.css（类名 mx-）。负责：错题 agent。
//
// 导出
//   createMistakesTab(ctx, { root, sleep, fetchImpl, toJpeg }) -> { show(params), onChange(), hide(), inSession(), holding(), el }
//     root 不给就画进 #tab-mistakes。show(params)：params.id 打开那一道；params.review 直接开始今天的再考；params.take 直接开相机
//     hide()：停正在发的请求、丢掉照片（原图只在内存里，存的只有缩略图）
//     inSession()：老师在认题、在讲题，或者她正在做题；holding()：手上有认出来还没收的题
//   renderMistakeReview(container, ctx, { items, sid, step = 'warmup', onDone, autoNextMs }) -> { el, onKey, stop }
//     热身里用：items 是 mistakes.js mistakeReviewItems 的返回；每道答完写回 kv 'mistake:<id>'（到日子的才算进日程），
//     onDone({ results: [{ id, item, qid, correct }], right })
//   0.7.2 拍听写本（roadmap-gaps 6）：首页“拍听写本”→ 老师认出她写的词和批改 → 她看一眼（打叉的默认勾上，写法能改）→ 收下：
//     mistakes.js saveDictation（不在单词本的先加，打开“写得出”线，记 kv 'mistake.dictation'，第二天起热身拼一次），
//     每个词记一条 dictation 事件（mistakes.js dictEvent）；已经“会写了”的词退回“在练”（encounters.js markBack，写 kv 'write.recheck'）。
//     show({ dictation: true }) 直接开相机拍听写本。
//   ctx 用到：kv、settings()、mockForced()、budget、curriculum（units、unitWords）、fetchJSON、say、events（log、sessionId）、toast、kidError、go、busy、
//     words（get、patch、importData、favorites / all）
import { h, icon, skBars } from './ui-dom.js';
import { imageToJpeg } from './capture.js';
import * as M from './mistakes.js';

const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x !== null && x !== undefined && x !== false && x !== ''));
const THUMB = { maxSide: 480, quality: 0.6 };

function logOf(ctx) {
  return ev => safe(() => {
    const r = ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log(ev) : null;
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  }, null);
}

// one choice question, big buttons; calls done({ correct, choice, ms }) once she has answered and tapped 下一道
function quizCard(q, { label = '', onAnswer, onNext, nextLabel = '下一道', say = null } = {}) {
  const t0 = Date.now();
  let answered = false;
  const fb = h('div', { className: 'mx-fb', 'aria-live': 'polite' });
  const buttons = q.options.map((o, i) => h('button', { type: 'button', className: 'mx-opt', lang: 'en', on: { click: () => pick(i) } },
    h('span', { className: 'mx-opt-key' }, M.letterOf(i)), h('span', { className: 'mx-opt-text' }, o)));
  function pick(i) {
    if (answered) return;
    answered = true;
    const choice = q.options[i];
    const correct = M.sameAnswer(choice, q.answer);
    buttons.forEach((b, j) => {
      b.disabled = true;
      if (M.sameAnswer(q.options[j], q.answer)) b.classList.add('is-right');
      else if (j === i) b.classList.add('is-wrong');
    });
    fill(fb,
      h('p', { className: 'mx-fb-head ' + (correct ? 'is-right' : 'is-wrong') }, correct ? '对了。' : `不对，是“${q.answer}”。`),
      q.explain ? h('p', { className: 'mx-fb-why' }, q.explain) : null,
      onNext ? h('div', { className: 'mx-actions' }, h('button', { type: 'button', className: 'btn mx-big', on: { click: onNext } }, nextLabel)) : null);
    if (onAnswer) onAnswer({ correct, choice, ms: Date.now() - t0 });
  }
  const sayBtn = say && /[a-z]/i.test(q.stem) ? h('button', { type: 'button', className: 'say', 'aria-label': '读一遍', on: { click: e => say(q.stem.replace(/_{2,}/g, 'blank').replace(/（[^）]*）/g, ''), e.currentTarget) } }, icon('speak')) : null;
  const el = h('div', { className: 'mx-quiz' },
    label ? h('p', { className: 'mx-label' }, label) : null,
    h('p', { className: 'mx-stem', lang: /[㐀-鿿]/.test(q.stem) ? 'zh' : 'en' }, q.stem, sayBtn),
    q.zh ? h('p', { className: 'mx-zh small' }, q.zh) : null,
    h('div', { className: 'mx-opts' }, buttons),
    fb);
  return { el, pick, answered: () => answered };
}

// ---------------------------------------------------------------- 热身里的再考

export function renderMistakeReview(container, ctx = {}, { items = [], sid = '', step = 'warmup', onDone = null, now = () => new Date() } = {}) {
  const log = logOf(ctx);
  const list = (items || []).filter(x => x && x.question);
  const results = [];
  let i = 0, card = null, stopped = false;
  const el = h('div', { className: 'mx-review' });
  container.append(el);
  const finish = () => { if (stopped) return; stopped = true; if (onDone) onDone({ results, right: results.filter(r => r.correct).length }); };
  function next() {
    if (stopped) return;
    if (i >= list.length) { finish(); return; }
    const it = list[i];
    const rec = ctx.kv ? M.loadRecord(ctx.kv, it.id) : null;
    card = quizCard(it.question, {
      label: `错题再考 · ${it.label || ''}`,
      say: ctx.say ? (t, b) => ctx.say(t, b) : null,
      nextLabel: i + 1 < list.length ? '下一道' : '好了',
      onAnswer: async ({ correct, choice, ms }) => {
        results.push({ id: it.id, item: it.item, qid: it.qid, correct });
        log({ type: 'answer', item: it.item, mode: M.MODE, step, sid, kind: 'review', choice, correct, first_try: true, ms, hint_level: 0,
          misconception: correct ? null : ((rec && rec.tags[0]) || null), point: (rec && rec.points[0]) || '', mistake: it.id });
        if (ctx.kv) { try { await M.answerReview(ctx.kv, it, correct, now()); } catch (e) { /* the answer still counts on screen */ } }
      },
      onNext: () => { i++; next(); },
    });
    fill(el, card.el);
  }
  next();
  return {
    el,
    onKey(ev) {
      if (!card || card.answered()) { if (ev.key === 'Enter') { i++; next(); return true; } return false; }
      const n = '1234'.indexOf(ev.key);
      if (n >= 0 && n < list[i].question.options.length) { card.pick(n); return true; }
      return false;
    },
    stop() { stopped = true; },
  };
}

// ---------------------------------------------------------------- the tab

export function createMistakesTab(ctx = {}, { root = null, sleep = null, fetchImpl = null, toJpeg = imageToJpeg } = {}) {
  const host = root || safe(() => document.getElementById('tab-mistakes'), null) || h('section', { id: 'tab-mistakes', className: 'tab' });
  const log = logOf(ctx);
  let ctrl = null, working = false, quizzing = false, busyOn = false;
  let draft = null;           // [{ item, keep }] recognized, not saved yet
  let dictDraft = null;       // 拍听写本: [DictItem + slug] recognized, not saved yet
  let dictCam = null, dictAlbum = null;
  let thumb = '';
  let groupBy = 'topic';
  let camIn = null, albumIn = null;
  let bankP = null;
  let screen = '';           // 'home' when the list is on screen (onChange only redraws that)
  const memory = new Map();   // mock mode: records stay here, never in kv

  const mock = () => !!safe(() => ((ctx.settings && ctx.settings()) || {}).mock, false) || !!safe(() => ctx.mockForced && ctx.mockForced(), false);
  const settings = () => ({ ...safe(() => (ctx.settings && ctx.settings()) || {}, {}), mock: mock() });
  const sidNow = () => safe(() => (ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''), '');
  const kidSays = err => safe(() => (ctx.kidError ? ctx.kidError(err, { where: 'chat' }) : ''), '') || '出了点小问题，再试一次。';
  const setBusy = on => { if (on === busyOn) return; busyOn = on; safe(() => ctx.busy && ctx.busy(on ? +1 : -1)); };
  const unitNow = () => safe(() => (ctx.kv.peek('progress', {}) || {}).unit || '', '');
  const say = (t, b) => safe(() => ctx.say && ctx.say(t, b || null));
  const opts = () => ({ ...(sleep ? { sleep } : {}), ...(fetchImpl ? { fetchImpl } : {}) });

  // mock records live in memory; everything else in kv
  const store = {
    all() {
      const real = ctx.kv ? M.loadAll(ctx.kv) : [];
      return [...memory.values()].filter(r => !r.dropped).concat(real).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    },
    get(id) { return memory.get(id) || (ctx.kv ? M.loadRecord(ctx.kv, id) : null); },
    async put(rec) {
      if (rec.mock || mock() || !ctx.kv) { const r = M.normRecord(rec); memory.set(r.id, r); return r; }
      return M.saveRecord(ctx.kv, rec);
    },
  };
  function getBank() {
    if (M.bank()) return Promise.resolve(M.bank());
    if (!bankP) bankP = ctx.fetchJSON ? M.loadBank({ fetchJSON: ctx.fetchJSON }).catch(() => M.setBank(M.bankFrom({}))) : Promise.resolve(M.setBank(M.bankFrom({})));
    return bankP;
  }

  function page(...kids) {
    screen = '';
    fill(host, h('div', { className: 'mx-page' }, ...kids));
    safe(() => { if (typeof host.scrollTo === 'function') host.scrollTo(0, 0); });
  }
  function inputs() {
    if (camIn) return;
    const mk = cam => {
      const i = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
      if (cam) i.setAttribute('capture', 'environment');
      i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) take(f); });
      return i;
    };
    camIn = mk(true); albumIn = mk(false);
    const mkD = cam => {
      const i = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
      if (cam) i.setAttribute('capture', 'environment');
      i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) takeDict(f); });
      return i;
    };
    dictCam = mkD(true); dictAlbum = mkD(false);
  }
  function stopWork() {
    if (ctrl) { safe(() => ctrl.abort()); ctrl = null; }
    working = false; quizzing = false; setBusy(false);
  }

  // ------------------------------------------------ 1. the tab's first page
  function home() {
    stopWork();
    draft = null; thumb = ''; dictDraft = null;
    inputs();
    const B = M.bank();
    const all = store.all();
    const now = new Date();
    const due = all.filter(r => M.isDue(r, now));
    const open = all.filter(r => !r.mastered).length;
    const groups = M.groupRecords(all, B, { by: groupBy });
    const switcher = all.length ? h('div', { className: 'mx-switch', role: 'group', 'aria-label': '怎么分组' },
      ['topic', 'unit'].map(k => h('button', { type: 'button', className: 'mx-switch-btn' + (groupBy === k ? ' is-on' : ''), 'aria-pressed': String(groupBy === k),
        on: { click: () => { groupBy = k; home(); } } }, k === 'topic' ? '按考点' : '按单元'))) : null;
    const book = all.length
      ? h('div', { className: 'mx-book' },
        h('div', { className: 'mx-book-head' }, h('h3', { className: 'mx-h3' }, '错题本'), switcher),
        h('p', { className: 'small mx-count' }, open ? `还有 ${open} 道没攻克，攻克了 ${all.length - open} 道。` : `${all.length} 道都攻克了。`),
        groups.map(g => h('details', { className: 'mx-group', open: g.open > 0 },
          h('summary', { className: 'mx-group-head' },
            h('span', { className: 'mx-group-name' }, g.label),
            h('span', { className: 'mx-group-sub' }, g.open ? `还有 ${g.open} 道没攻克` : '都攻克了')),
          h('ul', { className: 'mx-list' }, g.list.map(r => h('li', null,
            h('button', { type: 'button', className: 'mx-row' + (r.mastered ? ' is-done' : ''), on: { click: () => detail(r.id) } },
              h('span', { className: 'mx-row-stem', lang: 'en' }, r.q.stem || '（没认出题干）'),
              h('span', { className: 'mx-row-sub small' }, M.dueLabel(r, now)),
              icon('chev'))))))))
      : h('p', { className: 'mx-empty' }, '错题本还是空的。拍一道不会或做错的题，老师讲给你听，过几天再考你一道新的。');
    page(
      h('h2', { className: 'mx-title' }, '拍一道题'),
      h('p', { className: 'mx-lede' }, '作业、卷子、练习册都行。老师先讲清楚，再收进错题本，过几天考你一道新的。'),
      h('div', { className: 'mx-actions' },
        h('button', { type: 'button', className: 'btn mx-big mx-cam', on: { click: () => { inputs(); camIn.click(); } } }, '拍一道题'),
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { inputs(); albumIn.click(); } } }, '从相册选一张'),
        mock() ? h('button', { type: 'button', className: 'text-btn mx-mock-btn', on: { click: () => take(null) } }, '不拍，用几道假题') : null),
      h('p', { className: 'small mx-tip' }, '拍正、拍清楚。一页题也可以，老师会一道一道认。'),
      mock() ? h('p', { className: 'small mx-mock' }, '模拟模式：不看照片，给几道假题；错题本不存。') : null,
      h('div', { className: 'mx-dict' },
        h('h3', { className: 'mx-h3' }, '拍听写本'),
        h('p', { className: 'small mx-tip' }, '老师批改过的听写本或单词小测，拍一下。打了叉的词，明天热身里再拼一次。'),
        h('div', { className: 'mx-actions' },
          h('button', { type: 'button', className: 'text-btn accent mx-dict-cam', on: { click: () => { inputs(); dictCam.click(); } } }, '拍听写本'),
          h('button', { type: 'button', className: 'text-btn', on: { click: () => { inputs(); dictAlbum.click(); } } }, '从相册选'),
          mock() ? h('button', { type: 'button', className: 'text-btn mx-mock-btn', on: { click: () => takeDict(null) } }, '不拍，用假的听写本') : null)),
      due.length ? h('div', { className: 'mx-due' },
        h('p', { className: 'mx-due-text' }, `今天有 ${due.length} 道错题要再考。`),
        h('button', { type: 'button', className: 'btn mx-big', on: { click: () => reviewNow() } }, '现在考')) : null,
      book,
      camIn, albumIn, dictCam, dictAlbum);
    screen = 'home';
  }

  // ------------------------------------------------ 2. photo -> questions
  function waiting(text) {
    page(h('p', { className: 'mx-lede mx-wait' }, text), skBars([88, 70, 80]),
      h('div', { className: 'mx-actions' }, h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '不等了')));
  }
  function failed(err, again) {
    working = false; setBusy(false);
    page(h('p', { className: 'mx-lede' }, err && err.kid ? err.kid : kidSays(err)),
      h('div', { className: 'mx-actions' },
        again ? h('button', { type: 'button', className: 'btn mx-big', on: { click: again } }, '再试一次') : null,
        h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '回去')));
  }
  async function take(file) {
    stopWork();
    working = true; setBusy(true);
    ctrl = new AbortController();
    const my = ctrl;
    waiting('老师在看这张照片……');
    try {
      const B = await getBank();
      let photo = null;
      if (!mock()) {
        try { photo = await toJpeg(file); } catch (e) { e.kid = e.message || '这张照片打不开，换一张再试。'; throw e; }
        thumb = '';
        try { thumb = M.thumbOk(await toJpeg(file, THUMB)); } catch (e) { thumb = ''; }
      }
      const units = safe(() => ctx.curriculum.units().map(u => u.id), []);
      const r = await M.recognizeQuestions({ dataUrl: photo && photo.dataUrl, settings: settings(), budget: ctx.budget, signal: my.signal, bank: B, units, unit: unitNow(), ...opts() });
      photo = null;
      if (my !== ctrl) return;
      working = false; setBusy(false);
      draft = r.items.map(item => ({ item, keep: item.ok !== true, mock: r.mock }));
      confirm(r.unclear);
    } catch (err) {
      if (my !== ctrl) return;
      if (err && err.code === 'abort') { home(); return; }
      failed(err, file || mock() ? () => take(file) : null);
    }
  }

  // ------------------------------------------------ 3. she checks what the teacher read (can fix it)
  function confirm(unclear = '') {
    const B = M.bank();
    const tps = M.topics(B);
    const cards = draft.map((d, idx) => {
      const it = d.item;
      const stem = h('textarea', { className: 'mx-input mx-input-stem', rows: 2, lang: 'en', 'aria-label': '题目', value: it.stem });
      const optsIn = h('textarea', { className: 'mx-input', rows: Math.max(2, it.options.length), lang: 'en', 'aria-label': '选项（一行一个）', value: it.options.join('\n') });
      const her = h('input', { className: 'mx-input', type: 'text', lang: 'en', 'aria-label': '我的答案', value: it.her, autocapitalize: 'off', spellcheck: false });
      const ans = h('input', { className: 'mx-input', type: 'text', lang: 'en', 'aria-label': '正确答案', value: it.answer, autocapitalize: 'off', spellcheck: false });
      const cur = M.topicOf(it, B).key;
      const sel = h('select', { className: 'mx-input mx-select', 'aria-label': '考点' },
        tps.map(t => h('option', { value: t.key, selected: t.key === cur }, t.label)),
        tps.some(t => t.key === cur) ? null : h('option', { value: cur, selected: true }, M.topicOf(it, B).label));
      const keep = h('input', { type: 'checkbox', className: 'mx-check', checked: d.keep });
      const okLine = h('p', { className: 'mx-ok small' });
      const showOk = () => {
        const a = M.sameAnswer(her.value, ans.value);
        okLine.textContent = !her.value.trim() ? '没认出你写的答案。' : a ? '你做对了。' : '你写的和正确答案不一样。';
        okLine.className = 'mx-ok small ' + (!her.value.trim() ? '' : a ? 'is-right' : 'is-wrong');
      };
      her.addEventListener('input', showOk); ans.addEventListener('input', showOk);
      showOk();
      d.read = () => {
        const options = it.kind === 'choice' ? optsIn.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
        const herV = her.value.trim(), ansV = ans.value.trim();
        const t = tps.find(x => x.key === sel.value);
        let points = it.points, tags = it.tags, topic = it.topic;
        if (sel.value !== cur) {
          const card = sel.value.startsWith('card:') ? B && B.cards[sel.value.slice(5)] : null;
          points = card ? [card.points[0]].filter(Boolean) : [];
          tags = [];
          topic = t ? t.label : topic;
        }
        return { ...it, stem: stem.value.trim(), options, her: herV, answer: ansV, ok: herV && ansV ? M.sameAnswer(herV, ansV) : it.ok, points, tags, topic };
      };
      d.keepEl = keep;
      return h('div', { className: 'mx-card' },
        h('label', { className: 'mx-keep' }, keep, h('span', null, `第 ${it.no} 题 · 收进错题本`)),
        it.unsure ? h('p', { className: 'small mx-warn' }, '这道老师没看太清，对一下照片。') : null,
        h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '题目'), stem),
        it.kind === 'choice' ? h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '选项（一行一个）'), optsIn) : null,
        h('div', { className: 'mx-two' },
          h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '我的答案'), her),
          h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '正确答案（老师做的）'), ans)),
        okLine,
        h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '考点'), sel));
    });
    page(
      h('h2', { className: 'mx-title' }, draft.length > 1 ? `老师认出了 ${draft.length} 道题` : '老师认出了这道题'),
      h('p', { className: 'mx-lede' }, '对一下有没有认错，错的地方直接改。勾上的题收进错题本。'),
      unclear ? h('p', { className: 'small mx-warn' }, unclear) : null,
      thumb ? h('img', { className: 'mx-thumb', src: thumb, alt: '拍的题' }) : null,
      cards,
      h('div', { className: 'mx-actions mx-end' },
        h('button', { type: 'button', className: 'btn mx-big', on: { click: saveDraft } }, '对了，请老师讲'),
        h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '不收了')));
  }
  async function saveDraft() {
    const now = new Date();
    const keep = draft.filter(d => d.keepEl && d.keepEl.checked);
    if (!keep.length) { safe(() => ctx.toast && ctx.toast('先勾上一道题。')); return; }
    const saved = [];
    for (const d of keep) {
      const item = d.read ? d.read() : d.item;
      const rec = M.makeRecord({ item, thumb, now, mock: d.mock || mock() });
      try { saved.push(await store.put(rec)); } catch (e) { /* kv full: skip this one */ }
      log({ type: 'ask', qid: 'mistake', who: 'emma', step: M.STEP, item: 'mx:' + rec.id, about: 'mistake:' + M.topicOf(rec, M.bank()).key, answer: 'saved' });
    }
    draft = null; thumb = '';
    if (!saved.length) { failed(new Error('save'), null); return; }
    if (saved.length > 1) safe(() => ctx.toast && ctx.toast(`收进了 ${saved.length} 道。先讲第一道。`));
    detail(saved[0].id, { explain: true });
  }

  // ------------------------------------------------ 4. one question: the teacher explains, she tries a new one
  async function detail(id, { explain = false } = {}) {
    stopWork();
    await getBank();
    const rec = store.get(id);
    if (!rec) { home(); return; }
    if (!rec.explain && explain !== false) { await teach(rec); return; }
    drawDetail(rec);
  }
  async function teach(rec) {
    working = true; setBusy(true);
    ctrl = new AbortController();
    const my = ctrl;
    waiting('老师在想怎么讲……');
    try {
      const r = await M.explainMistake({ rec, settings: settings(), budget: ctx.budget, signal: my.signal, unit: unitNow(), bank: M.bank(), ...opts() });
      if (my !== ctrl) return;
      const next = await store.put(M.withExplain(rec, r.explain, new Date()));
      working = false; setBusy(false);
      drawDetail(next);
    } catch (err) {
      if (my !== ctrl) return;
      if (err && err.code === 'abort') { drawDetail(rec); return; }
      working = false; setBusy(false);
      page(h('p', { className: 'mx-lede' }, kidSays(err)),
        h('div', { className: 'mx-actions' },
          h('button', { type: 'button', className: 'btn mx-big', on: { click: () => teach(rec) } }, '再试一次'),
          h('button', { type: 'button', className: 'text-btn', on: { click: () => drawDetail(rec) } }, '先看题')));
    }
  }
  function drawDetail(rec) {
    const now = new Date();
    const q = rec.q;
    const ex = rec.explain;
    const t = M.topicOf(rec, M.bank());
    const practiceSlot = h('div', { className: 'mx-practice' });
    if (ex && ex.practice) {
      const card = quizCard(ex.practice, {
        label: '你来试一道',
        say,
        onAnswer: ({ correct, choice, ms }) => log({ type: 'answer', item: `mx:${rec.id}:p1`, mode: M.MODE, step: M.STEP, sid: sidNow(), kind: 'explain', choice, correct,
          first_try: true, ms, hint_level: 0, misconception: correct ? null : (rec.tags[0] || null), point: rec.points[0] || '', card: t.card || '', mistake: rec.id }),
      });
      practiceSlot.append(card.el);
    }
    const reviewQ = M.reviewQuestion(rec, M.bank(), { now });
    const due = M.isDue(rec, now);
    const history = rec.reviews.filter(r => r.counted);
    page(
      h('div', { className: 'mx-top' },
        h('button', { type: 'button', className: 'text-btn mx-back', on: { click: home } }, icon('back'), h('span', null, '错题本'))),
      h('p', { className: 'mx-chip' }, h('span', { className: 'mx-tag' }, t.label), h('span', { className: 'small' }, M.dueLabel(rec, now))),
      h('p', { className: 'mx-stem mx-stem-big', lang: 'en' }, q.stem),
      q.options.length ? h('ol', { className: 'mx-orig-opts', type: 'A' }, q.options.map(o => h('li', { lang: 'en' }, o))) : null,
      h('dl', { className: 'mx-answers' },
        h('div', null, h('dt', null, '你的答案'), h('dd', { className: q.ok === false ? 'is-wrong' : '', lang: 'en' }, q.her || '没认出来')),
        h('div', null, h('dt', null, '正确答案'), h('dd', { className: 'is-right', lang: 'en' }, q.answer || '老师没做出来'))),
      rec.thumb ? h('details', { className: 'mx-photo' }, h('summary', null, '看拍的照片'), h('img', { className: 'mx-thumb', src: rec.thumb, alt: '拍的题' })) : null,
      ex ? h('div', { className: 'mx-explain' },
        h('p', { className: 'mx-conclusion' }, ex.conclusion),
        ex.why.length ? h('div', { className: 'mx-why' }, ex.why.map(s => h('p', null, s))) : null,
        ex.example ? h('div', { className: 'mx-example' },
          h('p', { className: 'mx-example-en', lang: 'en' }, ex.example.en,
            h('button', { type: 'button', className: 'say', 'aria-label': '读一遍', on: { click: e => say(ex.example.en, e.currentTarget) } }, icon('speak'))),
          ex.example.zh ? h('p', { className: 'small' }, ex.example.zh) : null) : null)
        : h('div', { className: 'mx-actions' }, h('button', { type: 'button', className: 'btn mx-big', on: { click: () => teach(rec) } }, '请老师讲这道题')),
      practiceSlot,
      h('div', { className: 'mx-actions mx-end' },
        h('button', { type: 'button', className: 'btn mx-big', on: { click: () => askTeacher(rec) } }, '还不懂，接着问老师'),
        !rec.mastered && reviewQ ? h('button', { type: 'button', className: 'text-btn accent', on: { click: () => quizOne(rec, reviewQ, due) } }, due ? '今天的再考' : '再练一道') : null),
      history.length ? h('div', { className: 'mx-history' },
        h('p', { className: 'mx-label' }, '再考过'),
        h('ul', { className: 'mx-hist-list' }, history.map(x => h('li', null, `${x.day.slice(5)} ${x.ok ? '对了' : '错了'}`)))) : null,
      h('p', { className: 'small mx-rule' }, rec.mastered ? '这道攻克了。' : `过 1、3、7 天各考一道新题，做对两次就攻克（已经对了 ${rec.wins} 次）。`),
      h('div', { className: 'mx-actions' },
        h('button', { type: 'button', className: 'text-btn mx-drop', on: { click: () => dropIt(rec) } }, '这道不用再考了')));
  }
  function askTeacher(rec) {
    const { ask, send } = M.askText(rec);
    safe(() => ctx.go && ctx.go('chat', { ask, send }));
  }
  async function dropIt(rec) {
    await store.put(M.dropRecord(rec, new Date()));
    if (rec.mock || mock()) memory.delete(rec.id);
    safe(() => ctx.toast && ctx.toast('移出了错题本。'));
    home();
  }
  function quizOne(rec, q, counted) {
    quizzing = true;
    const card = quizCard(q, {
      label: counted ? '今天的再考' : '再练一道（不算进日程）',
      say,
      nextLabel: '回到这道题',
      onAnswer: async ({ correct, choice, ms }) => {
        log({ type: 'answer', item: `mx:${rec.id}:${q.id}`, mode: M.MODE, step: M.STEP, sid: sidNow(), kind: counted ? 'review' : 'practice', choice, correct,
          first_try: true, ms, hint_level: 0, misconception: correct ? null : (rec.tags[0] || null), point: rec.points[0] || '', mistake: rec.id });
        const next = M.applyReview(rec, { qid: q.id, correct, now: new Date(), counted });
        try { await store.put(next); } catch (e) { /* shown anyway */ }
        if (next.mastered && !rec.mastered) safe(() => ctx.toast && ctx.toast('攻克了一道错题。'));
      },
      onNext: () => { quizzing = false; detail(rec.id); },
    });
    page(h('div', { className: 'mx-top' }, h('button', { type: 'button', className: 'text-btn mx-back', on: { click: () => { quizzing = false; detail(rec.id); } } }, icon('back'), h('span', null, '这道题'))), card.el);
  }

  // ------------------------------------------------ 拍听写本 (roadmap-gaps 6)
  const entriesNow = () => safe(() => (ctx.words && typeof ctx.words.all === 'function' ? ctx.words.all() : ctx.words.favorites()) || [], []);
  function unitWordList() {
    const cur = unitNow();
    const units = safe(() => ctx.curriculum.units().map(u => u.id), []);
    const order = cur ? [cur, ...units.filter(u => u !== cur).reverse()] : units.slice().reverse();
    const out = [];
    for (const u of order) for (const w of safe(() => ctx.curriculum.unitWords(u) || [], [])) if (w && w.w && !out.some(x => x.w === w.w)) out.push(w);
    return out;
  }
  async function takeDict(file) {
    stopWork();
    working = true; setBusy(true);
    ctrl = new AbortController();
    const my = ctrl;
    waiting('老师在看听写本……');
    try {
      let photo = null;
      if (!mock()) { try { photo = await toJpeg(file); } catch (e) { e.kid = e.message || '这张照片打不开，换一张再试。'; throw e; } }
      const units = safe(() => ctx.curriculum.units().map(u => u.id), []);
      const words = unitWordList();
      const r = await M.recognizeDictation({ dataUrl: photo && photo.dataUrl, settings: settings(), budget: ctx.budget, signal: my.signal, units, unit: unitNow(), words, ...opts() });
      photo = null;
      if (my !== ctrl) return;
      working = false; setBusy(false);
      dictDraft = M.matchDictation(r.items, { entries: entriesNow(), unitWords: words }).map(it => ({ ...it, mock: r.mock }));
      confirmDict(r.unclear);
    } catch (err) {
      if (my !== ctrl) return;
      if (err && err.code === 'abort') { home(); return; }
      failed(err, file || mock() ? () => takeDict(file) : null);
    }
  }
  const MARK_ZH = { wrong: '老师打了叉', right: '老师打了勾', none: '没批改' };
  function confirmDict(unclear = '') {
    const rows = dictDraft.map(it => {
      const keep = h('input', { type: 'checkbox', className: 'mx-check', checked: it.keep });
      const ans = h('input', { className: 'mx-input', type: 'text', lang: 'en', 'aria-label': '正确的写法', value: it.answer, autocapitalize: 'off', spellcheck: false });
      it.read = () => ({ ...it, answer: ans.value.trim(), keep: keep.checked });
      return h('div', { className: 'mx-card mx-dict-row' + (it.mark === 'wrong' ? ' is-wrong' : '') },
        h('label', { className: 'mx-keep' }, keep, h('span', null, `第 ${it.no} 个 · ${MARK_ZH[it.mark] || ''}`)),
        it.unsure ? h('p', { className: 'small mx-warn' }, '这个老师没看太清，对一下本子。') : null,
        h('div', { className: 'mx-two' },
          h('div', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '你写的'), h('p', { className: 'mx-dict-her', lang: 'en' }, it.her || '没认出来')),
          h('label', { className: 'mx-field' }, h('span', { className: 'mx-field-name' }, '正确的写法'), ans)),
        it.cn ? h('p', { className: 'small mx-zh' }, it.cn) : null);
    });
    const wrongN = dictDraft.filter(x => x.mark === 'wrong').length;
    page(
      h('h2', { className: 'mx-title' }, `老师认出了 ${dictDraft.length} 个词`),
      h('p', { className: 'mx-lede' }, wrongN ? `打了叉的 ${wrongN} 个已经勾上。认错了直接改正确的写法。` : '没看到打叉的词。写错了的自己勾上。'),
      unclear ? h('p', { className: 'small mx-warn' }, unclear) : null,
      rows,
      h('div', { className: 'mx-actions mx-end' },
        h('button', { type: 'button', className: 'btn mx-big', on: { click: saveDict } }, '收下勾上的词'),
        h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '不收了')));
  }
  async function saveDict() {
    const now = new Date();
    const read = dictDraft.map(it => (it.read ? it.read() : it)).filter(it => it.keep && it.answer);
    if (!read.length) { safe(() => ctx.toast && ctx.toast('先勾上一个词。')); return; }
    // a corrected spelling may be another word: match again
    const items = M.matchDictation(read.map(({ slug, headword, inBook, ...rest }) => rest), { entries: entriesNow(), unitWords: unitWordList() });
    const isMock = mock() || items.some(x => x.mock);
    working = true; setBusy(true);
    let res = null;
    try { res = await M.saveDictation({ kv: ctx.kv, words: ctx.words, items, now, unit: unitNow() || null, mock: isMock }); }
    catch (e) { res = null; }
    working = false; setBusy(false);
    if (!res) { failed(new Error('save'), null); return; }
    if (!isMock) {
      const sid = sidNow();
      for (const it of items) log({ ...M.dictEvent(it, { page: res.page }), sid, unit: unitNow() || undefined });
      // a word she could write (会写了) that the teacher crossed out goes back to 在练
      try {
        // encounters.js loads here (not at the top), so the tab still opens while the file is not in the offline shell
        const E = await import('./encounters.js');
        let st = E.readRecheck(ctx.kv);
        const written = E.writtenOf({ kv: ctx.kv, events: [] });
        let n = 0;
        for (const it of items) if (written[it.slug] || st.items[it.slug]) { st = E.markBack(st, it.slug, { now, why: 'school' }); n++; }
        if (n) await ctx.kv.set(E.RECHECK_KEY, { ...st, updated: now.toISOString() });
      } catch (e) { /* the words are saved anyway */ }
    }
    dictDraft = null;
    const names = items.map(x => x.headword || x.answer);
    page(
      h('h2', { className: 'mx-title' }, '收好了'),
      h('p', { className: 'mx-lede' }, `明天热身里再拼一次：${names.slice(0, 8).join('、')}${names.length > 8 ? ` 等 ${names.length} 个` : ''}。`),
      h('ul', { className: 'mx-list mx-dict-list' }, items.map(x => h('li', { lang: 'en' }, x.headword || x.answer, x.cn ? h('span', { className: 'small' }, '  ' + x.cn) : null))),
      res.added.length ? h('p', { className: 'small' }, `${res.added.length} 个词原来不在单词本里，加进去了。`) : null,
      isMock ? h('p', { className: 'small mx-mock' }, '模拟模式：单词本和热身都不改。') : null,
      h('div', { className: 'mx-actions' }, h('button', { type: 'button', className: 'btn mx-big', on: { click: home } }, '回到错题本')));
  }

  // ------------------------------------------------ 5. today's reviews, one after another
  async function reviewNow() {
    const B = await getBank();
    const now = new Date();
    const items = [];
    for (const r of store.all().filter(x => M.isDue(x, now))) {
      const q = M.reviewQuestion(r, B, { now });
      if (q) items.push({ type: 'mistake', id: r.id, item: `mx:${r.id}:${q.id}`, qid: q.id, question: q, label: M.topicOf(r, B).label });
    }
    if (!items.length) { safe(() => ctx.toast && ctx.toast('今天没有要再考的了。')); home(); return; }
    quizzing = true;
    const box = h('div');
    page(h('div', { className: 'mx-top' }, h('button', { type: 'button', className: 'text-btn mx-back', on: { click: () => { quizzing = false; home(); } } }, icon('back'), h('span', null, '错题本'))), box);
    // mock records live in memory, so answer through the same store as the list
    const kvLike = { peek: (k, d) => { const r = store.get(String(k).slice(M.KV_PREFIX.length)); return r || d; }, keys: () => [], set: async (k, v) => store.put(v) };
    renderMistakeReview(box, { ...ctx, kv: kvLike }, {
      items, sid: sidNow(), step: M.STEP,
      onDone: ({ right }) => { quizzing = false; safe(() => ctx.toast && ctx.toast(`考完了，对了 ${right} / ${items.length} 道。`)); home(); },
    });
  }

  return {
    el: host,
    async show(params = {}) {
      await getBank();
      const p = params || {};
      if (p.id) { detail(p.id); return; }
      if (p.review) { reviewNow(); return; }
      if (p.dictation) { home(); inputs(); safe(() => dictCam.click()); return; }
      home();
      if (p.take) { inputs(); safe(() => camIn.click()); }
    },
    onChange() { if (screen === 'home' && !working && !quizzing && !draft && !dictDraft) safe(() => home()); },
    hide() { stopWork(); draft = null; thumb = ''; dictDraft = null; },
    inSession: () => working || quizzing,
    holding: () => !!(draft && draft.length) || !!(dictDraft && dictDraft.length),
  };
}
