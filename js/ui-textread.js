// 课文陪读的界面（design/teacher-next.md 3.3）：拍一页课文 → 看一眼认出来的字（可以改）、选第几单元第几页 → 老师备课
// → 逐句陪读（先听后读、点词、这句看不懂三下）→ 3 道题（点出答案句、指的是谁、四选一，四级提示）→ 读完。
// 逻辑都在 textread.js，这里只画。样式 css/textread.css（类名 tr-）。负责：课文陪读 agent。
//
// 导出
//   createTextRead(ctx, { root }) -> { open(), openSaved(id), show(params), hide(), inSession(), holding(), el }
//     open()：课文陪读的第一页：拍一页课文 / 从相册选 / 读过的几页（点一下重读）
//     openSaved(id)：直接打开存过的那一页（kv 'textread:<id>'）从头陪读；找不到就回第一页
//     show(params)：当路由的 view 用（params.id 有就 openSaved，否则 open）
//     没给 root：自己在 document.body 上盖一层全屏（.tr-screen），右上角“关上”拿掉它；给了 root（比如路由的 #tab-textread）
//       就画进去，“关上”调 ctx.back()
//     hide()：停朗读、停正在发的请求、丢掉照片（照片只在内存里，从来不存）
//     测试用的钩子：builtin（不用 renderPassage）、sleep、fetchImpl（发请求）、speak(text) -> Promise（代替“读一句、等它读完”）、
//       toJpeg(file)（代替 capture.js imageToJpeg）
//     inSession()：老师在看照片、在备课，或者她正在读；holding()：手上有照片或认出来还没开始读的字
//   阅读器：ui-reader.js 导出了 renderPassage 就用它：
//     renderPassage(container, ctx, { passage: toEpisode(rec), mode: 'read', listen: true, label, sid, step: 'textread', doneLabel,
//                                     onDone(result) }) -> { el, onKey, stop }   （另传 onHelp / onAnswer，阅读器以后想回传进度可以用）
//     没有它、它出错、或者它说这一篇打不开（onDone({ done: false })），就用这里自带的一版。
//     读完 onDone 的 results（带 qid）记进这一页的 answers，读的次数记进 reads。
//   ctx 用到：kv（peek / set / keys）、settings()、mockForced()、budget、curriculum（units）、dict、words、say、voice、
//     events（log、sessionId）、toast、kidError、go、back、toggleFav、busy
import { h, icon, skBars } from './ui-dom.js';
import { imageToJpeg } from './capture.js';
import * as T from './textread.js';
import * as R from './reader.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const DEFAULT_UNITS = ['S', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'];
const md = iso => String(iso || '').slice(5, 10);
const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
// replaceChildren turns null into the text "null": leave the empty slots out
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x !== null && x !== undefined && x !== false && x !== ''));

export function createTextRead(ctx = {}, { root = null, builtin = false, sleep = null, fetchImpl = null, speak = null, toJpeg = imageToJpeg } = {}) {
  let overlay = null, host = null;
  let ctrl = null, reader = null, gen = 0;
  let busyOn = false, working = false, readingNow = false;
  let draft = null;              // the page as recognized, before she starts (unit, page, sentences)
  let photo = null;              // { dataUrl } while the model looks at it; dropped right after
  const memory = new Map();      // mock mode: pages stay here, never in kv
  let camIn = null, albumIn = null;

  const mock = () => !!safe(() => ((ctx.settings && ctx.settings()) || {}).mock, false) || !!safe(() => ctx.mockForced && ctx.mockForced(), false);
  const settings = () => ({ ...safe(() => (ctx.settings && ctx.settings()) || {}, {}), mock: mock() });
  const kv = () => ctx.kv || null;
  const sidNow = () => safe(() => (ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''), '');
  const log = ev => safe(() => {
    const out = { ...ev };
    delete out.episode;
    const r = ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log(out) : null;
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  }, null);
  const setBusy = on => { if (on === busyOn) return; busyOn = on; safe(() => ctx.busy && ctx.busy(on ? +1 : -1)); };
  const kidSays = err => safe(() => (ctx.kidError ? ctx.kidError(err, { where: 'lesson' }) : ''), '') || '出了点小问题，再试一次。';

  // ------------------------------------------------ where it draws
  function mount() {
    if (root) { host = root; return host; }
    if (!overlay) {
      overlay = h('div', { className: 'tr-screen', role: 'dialog', 'aria-label': '课文陪读' });
      document.body.append(overlay);
    }
    overlay.hidden = false;
    host = overlay;
    safe(() => document.documentElement.classList.add('tr-open'));
    return host;
  }
  function close() {
    hide();
    if (root) safe(() => ctx.back && ctx.back());
  }
  function page(...children) {
    const head = h('div', { className: 'tr-head' },
      h('p', { className: 'tr-head-title' }, '课文陪读'),
      h('button', { type: 'button', className: 'text-btn tr-close', 'aria-label': '关上', on: { click: close } }, icon('close')));
    const body = h('div', { className: 'tr-page' }, head, ...children.filter(Boolean));
    host.replaceChildren(body);
    if (typeof host.scrollTo === 'function') safe(() => host.scrollTo(0, 0));
    return body;
  }
  function stopReader() { if (reader && reader.stop) safe(() => reader.stop()); reader = null; readingNow = false; }

  // ------------------------------------------------ saved pages (kv; mock mode in memory)
  function getRec(id) {
    if (memory.has(id)) return T.normRecord(memory.get(id));
    return T.loadRecord(kv(), id);
  }
  function putRec(rec) {
    if (!rec) return;
    if (mock() || rec.mock) { memory.set(rec.id, rec); return; }
    T.saveRecord(kv(), rec);
  }
  function savedRows() {
    const rows = T.listSaved(kv());
    for (const rec of memory.values()) {
      const r = T.normRecord(rec);
      if (!r || rows.some(x => x.id === r.id)) continue;
      const done = r.reads.filter(x => x.done);
      rows.unshift({ id: r.id, unit: r.unit, page: r.page, label: T.pageLabel(r) + '（模拟）', title: r.title, last: r.updated, times: done.length, done: done.length > 0 });
    }
    return rows;
  }

  // ------------------------------------------------ 1. 第一页
  function inputs() {
    if (camIn) return;
    const mk = cam => {
      const i = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
      if (cam) i.setAttribute('capture', 'environment');
      i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) take(f); });
      return i;
    };
    camIn = mk(true); albumIn = mk(false);
  }
  function home() {
    stopReader();
    draft = null;
    if (ctrl) { safe(() => ctrl.abort()); ctrl = null; }
    working = false;
    setBusy(false);
    inputs();
    const rows = savedRows();
    const list = rows.length
      ? h('div', { className: 'tr-saved' },
        h('p', { className: 'tr-label' }, '读过的'),
        h('ul', { className: 'tr-saved-list' }, rows.map(r => h('li', null,
          h('button', { type: 'button', className: 'tr-saved-row', on: { click: () => openSaved(r.id) } },
            h('span', { className: 'tr-saved-main' }, r.label),
            r.title ? h('span', { className: 'tr-saved-title', lang: 'en' }, r.title) : null,
            h('span', { className: 'tr-saved-sub small' }, r.done ? `${md(r.last)} 读过${r.times > 1 ? ` ${r.times} 次` : ''}` : '还没读完'),
            icon('chev'))))))
      : null;
    page(
      h('h2', { className: 'tr-title' }, '拍一页课文，一句一句读懂'),
      h('p', { className: 'tr-lede' }, '老师先读给你听，哪句看不懂就点它。读完做 3 道小题。'),
      h('p', { className: 'small tr-tip' }, '拍正、拍清楚，一次拍一页。'),
      h('div', { className: 'tr-actions' },
        h('button', { type: 'button', className: 'btn tr-main', on: { click: () => { inputs(); camIn.click(); } } }, '拍一页课文'),
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { inputs(); albumIn.click(); } } }, '从相册选一张'),
        mock() ? h('button', { type: 'button', className: 'text-btn tr-mock-btn', on: { click: () => take(null) } }, '不拍，看一页假课文') : null),
      mock() ? h('p', { className: 'small tr-mock' }, '模拟模式：不看照片，给一页假课文；读的进度不存。') : null,
      list,
      camIn, albumIn);
  }

  // ------------------------------------------------ 2. the photo -> the sentences
  function waiting(text, sub) {
    page(h('p', { className: 'tr-lede tr-wait' }, text), sub ? h('p', { className: 'small' }, sub) : null, skBars([88, 70, 80]),
      h('div', { className: 'tr-actions' }, h('button', { type: 'button', className: 'text-btn', on: { click: () => { if (ctrl) ctrl.abort(); home(); } } }, '不等了')));
  }
  function failed(err, again) {
    working = false; setBusy(false);
    page(h('p', { className: 'tr-lede' }, kidSays(err)),
      h('div', { className: 'tr-actions' },
        again ? h('button', { type: 'button', className: 'btn', on: { click: again } }, '再试一次') : null,
        h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '回去')));
  }
  async function take(file) {
    const my = ++gen;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    working = true; setBusy(true);
    waiting('老师在看这一页……', '大约十几秒。');
    try {
      photo = mock() ? null : await toJpeg(file);
      if (my !== gen) return;
      const units = safe(() => (ctx.curriculum && ctx.curriculum.units ? ctx.curriculum.units() : []), []);
      const r = await T.recognizePage({ dataUrl: photo && photo.dataUrl, settings: settings(), budget: ctx.budget, signal: ctrl.signal, units,
        ...(sleep ? { sleep } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
      photo = null;            // the photo is not needed any more: never kept
      if (my !== gen) return;
      working = false;
      draft = { ...r.page, mock: r.mock };
      confirm();
    } catch (err) {
      photo = null;
      if (my !== gen) return;
      if (err && err.code === 'abort') { working = false; setBusy(false); return; }
      if (err && !err.code) {
        // the photo itself would not open (imageToJpeg): its message is already for her
        working = false; setBusy(false);
        page(h('p', { className: 'tr-lede' }, String(err.message || '这张照片打不开，换一张再试。')),
          h('div', { className: 'tr-actions' }, h('button', { type: 'button', className: 'btn', on: { click: home } }, '换一张')));
        return;
      }
      failed(err, () => take(file));
    }
  }
  function unitChoices() {
    const list = safe(() => (ctx.curriculum && ctx.curriculum.units ? ctx.curriculum.units().map(u => u.id) : []), []);
    const ids = [...new Set([...DEFAULT_UNITS.slice(0, 4), ...list, ...DEFAULT_UNITS])].filter(id => /^(S|U\d+)$/.test(id));
    return ids.sort((a, b) => (a === 'S' ? 0 : +a.slice(1)) - (b === 'S' ? 0 : +b.slice(1)));
  }
  function confirm() {
    setBusy(true);
    const d = draft;
    if (!d || !d.sentences.length) {
      setBusy(false);
      page(h('p', { className: 'tr-lede' }, '这张照片里没找到课文。'), h('p', { className: 'small' }, '换一张，拍正一点，让课文占满屏幕。'),
        h('div', { className: 'tr-actions' }, h('button', { type: 'button', className: 'btn', on: { click: home } }, '再拍一张')));
      return;
    }
    const prog = safe(() => kv().peek('progress', null), null) || {};
    const unitSel = h('select', { className: 'field tr-unit', 'aria-label': '第几单元' },
      unitChoices().map(id => h('option', { value: id, selected: id === (d.unit || prog.unit || 'U1') }, T.unitLabel(id))));
    const pageIn = h('input', { className: 'field tr-pageno', type: 'number', inputmode: 'numeric', min: '1', max: '399', value: d.page ? String(d.page) : '',
      placeholder: '页码', 'aria-label': '第几页' });
    const box = h('textarea', { className: 'tr-text', lang: 'en', rows: String(Math.min(14, d.sentences.length + 1)), spellcheck: 'false', autocapitalize: 'sentences' });
    box.value = T.pageText(d);
    const fix = h('details', { className: 'tr-fix' }, h('summary', null, '有字认错了？点这里改'),
      h('p', { className: 'small' }, '一行一句。对话写成“Mia: Hello!”。'), box);
    const list = h('ol', { className: 'tr-preview-list', lang: 'en' }, d.sentences.map(s => h('li', null, s.speaker ? h('b', null, s.speaker + ': ') : null, s.en)));
    box.addEventListener('input', () => {
      const p = T.pageFromText(box.value, d);
      list.replaceChildren(...p.sentences.map(s => h('li', null, s.speaker ? h('b', null, s.speaker + ': ') : null, s.en)));
    });
    const go = () => {
      const p = T.pageFromText(box.value, d);
      if (!p.sentences.length) { box.focus(); return; }
      const n = Number(pageIn.value);
      draft = { ...p, unit: unitSel.value || d.unit || null, page: Number.isInteger(n) && n > 0 ? n : null, title: d.title, mock: d.mock };
      prepare();
    };
    page(
      h('p', { className: 'tr-lede' }, `认出来 ${d.sentences.length} 句。`),
      d.more ? h('p', { className: 'small' }, `这一页太长，先读前 ${T.MAX_SENTENCES} 句。`) : null,
      d.unclear ? h('p', { className: 'small tr-warn' }, '有的地方没看清，对一对书，认错的改一下。') : null,
      h('div', { className: 'tr-where' },
        h('label', { className: 'tr-where-row' }, h('span', null, '这是'), unitSel),
        h('label', { className: 'tr-where-row' }, h('span', null, '第'), pageIn, h('span', null, '页'))),
      d.title ? h('p', { className: 'tr-ptitle', lang: 'en' }, d.title) : null,
      list, fix,
      h('div', { className: 'tr-actions' },
        h('button', { type: 'button', className: 'btn tr-main', on: { click: go } }, '开始陪读'),
        h('button', { type: 'button', className: 'text-btn', on: { click: home } }, '重拍')));
  }

  // ------------------------------------------------ 3. the teacher prepares (second call), the program checks, saved
  async function prepare() {
    const my = ++gen;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    working = true; setBusy(true);
    waiting('老师在备课……', '每句的中文、断句、主干和 3 道小题，大约半分钟。');
    const d = draft;
    try {
      const prog = safe(() => kv().peek('progress', null), null) || {};
      const r = await T.annotatePage({ page: d, settings: settings(), budget: ctx.budget, signal: ctrl.signal, unit: prog.unit || d.unit,
        ...(sleep ? { sleep } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
      if (my !== gen) return;
      const { passage, problems } = T.fixPassage(T.normalizeGen(r.gen, d));
      const id = T.pageId(d.unit, d.page, new Date());
      const prev = getRec(id);
      const rec = T.makeRecord({ page: d, passage, unit: d.unit, pageNo: d.page, model: r.model, mock: !!(r.mock || d.mock), problems, prev, id });
      putRec(rec);
      draft = null;
      working = false;
      startReading(rec);
    } catch (err) {
      if (my !== gen) return;
      if (err && err.code === 'abort') { working = false; setBusy(false); return; }
      failed(err, () => prepare());
    }
  }

  // ------------------------------------------------ 4. reading
  async function startReading(rec) {
    stopReader();
    setBusy(true);
    readingNow = true;
    const box = h('div', { className: 'tr-read' });
    page(box);
    const my = ++gen;
    const viaReader = await (async () => {
      try {
        const UR = await import('./ui-reader.js');
        if (builtin || my !== gen || typeof UR.renderPassage !== 'function') return null;
        let cur = rec;
        const c = UR.renderPassage(box, ctx, {
          passage: T.toEpisode(rec), mode: 'read', listen: true, label: T.pageLabel(rec), sid: sidNow(), step: T.STEP, doneLabel: '读完了',
          id: rec.id, kind: 'textread',
          onHelp: (i, level) => { cur = T.noteHelp(cur, i, level); putRec(cur); },
          onAnswer: (qid, result) => { cur = T.noteAnswer(cur, qid, result || {}); putRec(cur); },
          onDone: res => {
            if (res && res.done === false) { safe(() => ctx.toast && ctx.toast('这一页打不开了，用老师自带的版本读。')); stopReader(); reader = readPassage(box, cur); readingNow = true; return; }
            done(cur, res || {});
          },
        });
        return c && typeof c === 'object' ? c : null;
      } catch (e) { return null; }
    })();
    if (my !== gen) return;
    reader = viaReader || readPassage(box, rec);
  }

  function done(rec, res = {}) {
    const results = (res.results || []).filter(Boolean);
    const right = results.filter(r => r.clean).length;
    const helps = Number(res.helps) || 0;
    let next = rec;
    // the reader's results carry the question id: kept on the page, so a reread can show what went wrong last time
    for (const r of results) if (r.qid && !(next.answers || {})[r.qid]) next = T.noteAnswer(next, r.qid, r);
    next = T.noteRead(next, { done: res.done !== false, helps, right, total: results.length, ms: res.ms || 0 });
    putRec(next);
    stopReader();
    setBusy(false);
    // sentences she needed the whole Chinese for (the built-in reader says which; renderPassage's `hard` is the 今天哪里最难 answer)
    const hard = (res.hardSentences || []).filter(Boolean);
    page(
      h('p', { className: 'tr-chip' }, h('span', { className: 'tr-tag' }, T.pageLabel(next))),
      h('p', { className: 'tr-lede' }, `读完了${next.title ? ' “' + next.title + '”' : '这一页'}。`),
      results.length ? h('p', { className: 'tr-sum' }, `${results.length} 道题，一次就对 ${right} 道。`) : null,
      helps ? h('p', { className: 'small' }, `点了 ${helps} 次“看不懂”。看不懂就点，这就是在读懂。`) : null,
      hard.length ? h('div', { className: 'tr-hard' }, h('p', { className: 'tr-label' }, '看了中文才懂的句子'),
        hard.slice(0, 3).map(s => h('div', { className: 'tr-hard-row' }, h('p', { className: 'tr-hard-en', lang: 'en' }, s.en),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => askTeacher(next, s) } }, '问老师这句为什么这样说')))) : null,
      h('div', { className: 'tr-actions' },
        h('button', { type: 'button', className: 'btn tr-main', on: { click: home } }, '好了'),
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => startReading(next) } }, '再读一遍')));
  }

  function askTeacher(rec, s) {
    const prev = rec.sentences[s.id - 2];
    const ask = `这句话什么意思：${s.en}`;
    const send = [
      `我在读课本 ${T.pageLabel(rec)} 的课文${rec.title ? `《${rec.title}》` : ''}，这句我看不懂：${s.en}`,
      prev ? `前一句是：${prev.en}` : '',
      s.speaker ? `这句是 ${s.speaker} 说的。` : '',
      s.zh && !s.unsure ? `App 给的中文是：${s.zh}` : 'App 没把握这句的中文。',
      '请你用简单的中文讲讲这句的意思和为什么这样说。',
    ].filter(Boolean).join('\n');
    hide();
    safe(() => ctx.go && ctx.go('chat', { ask, send }));
  }

  // ------------------------------------------------ the built-in reader (used when ui-reader.js has no renderPassage)
  function readPassage(box, rec0) {
    let rec = rec0;
    const ep = T.passageOf(rec);
    if (!ep) { box.replaceChildren(h('p', { className: 'tr-lede' }, '这一页打不开了，再拍一次吧。')); return { stop() {} }; }
    const sid = sidNow();
    const step = T.STEP;
    const env = { episode: ep, curriculum: ctx.curriculum, words: ctx.words, dict: ctx.dict };
    const helpLevel = new Map();
    const results = [];
    let helps = 0, stopped = false, player = null, listenT0 = 0, listenMs = 0;
    const save = () => putRec(rec);
    const card = h('div', { className: 'tr-card', hidden: true, role: 'dialog', 'aria-label': '这个词' });

    // speaking one sentence and knowing when it ended (the same rhythm as the story reader)
    let pendingDone = null;
    function stopSpeech() {
      safe(() => ctx.voice && ctx.voice.stop && ctx.voice.stop());
      if (pendingDone) { const f = pendingDone; pendingDone = null; f(); }
    }
    function speakWait(text) {
      if (typeof speak === 'function') return Promise.resolve(speak(text)).catch(() => {});
      return new Promise(resolve => {
        let timer = 0;
        const t0 = Date.now(), est = R.speakMs(text);
        const finish = () => { clearTimeout(timer); if (pendingDone === finish) pendingDone = null; resolve(); };
        pendingDone = finish;
        if (typeof ctx.say !== 'function') { timer = setTimeout(finish, est); return; }
        try { ctx.say(text, null); } catch (e) { timer = setTimeout(finish, est); return; }
        const v = ctx.voice;
        if (!v || typeof v.busy !== 'function') { timer = setTimeout(finish, est); return; }
        const max = est * 2 + 3000;
        const tick = () => {
          const el = Date.now() - t0;
          if (el > max) { finish(); return; }
          if (el > 250 && !v.busy()) { if (el < est * 0.25) { timer = setTimeout(finish, Math.round(est * 0.6 - el)); return; } finish(); return; }
          timer = setTimeout(tick, 120);
        };
        timer = setTimeout(tick, 150);
      });
    }

    // the word card
    const closeCard = () => { card.hidden = true; card.replaceChildren(); };
    function openWord(text, s) {
      if (player && player.state === 'playing') { player.pause(); paintBar(); }
      const info = R.wordInfo(text, { ...env, sentence: s });
      log({ type: 'lookup', item: `tr:${rec.id}:s${s.i}`, query: info.w, source: info.source || 'none', from: 'textread', step, sid, ...(info.name ? {} : { slug: info.slug }) });
      drawCard(info);
    }
    function drawCard(info) {
      let foot = null;
      if (info.justAdded) foot = h('p', { className: 'tr-card-in small' }, '加进单词本了，热身里会再见到它。');
      else if (info.inBook) foot = h('p', { className: 'tr-card-in small' }, '已经在单词本里了。');
      else if (info.canAdd) foot = h('button', { type: 'button', className: 'btn tr-add', on: { click: ev => addWord(info, ev.currentTarget) } }, '加进单词本');
      fill(card,
        h('div', { className: 'tr-card-top' },
          h('p', { className: 'tr-card-w', lang: 'en' }, info.word, info.name ? null : sayBtn(info.word)),
          h('button', { type: 'button', className: 'text-btn', 'aria-label': '关上', on: { click: closeCard } }, icon('close'))),
        h('p', { className: 'tr-card-meta small' }, info.phonetic && !info.name ? h('span', { lang: 'en' }, `/${info.phonetic}/ `) : null,
          info.base !== info.w && !info.name ? h('span', null, '原形 ', h('b', { lang: 'en' }, info.base), ' ') : null, info.label || null),
        h('p', { className: 'tr-card-zh' + (info.zh ? '' : ' none') }, info.zh || (info.name ? '这是名字。' : '离线词典里还没有这个词。')),
        foot);
      card.hidden = false;
    }
    async function addWord(info, btn) {
      if (btn) btn.disabled = true;
      try {
        const W = ctx.words;
        let e = W && W.get ? W.get(info.slug) : null;
        if (!e && W && typeof W.importData === 'function') { await W.importData(R.placeholderExport(info, new Date())); e = W.get ? W.get(info.slug) : null; }
        if (e && !e.favorited) {
          if (typeof ctx.toggleFav === 'function') await ctx.toggleFav(e.slug, true);
          else if (W && typeof W.favorite === 'function') await W.favorite(e.slug, true);
        }
        if (!card.hidden) drawCard({ ...info, inBook: true, justAdded: true });
      } catch (err) {
        if (btn) btn.disabled = false;
        safe(() => ctx.toast && ctx.toast('没加上，再点一次。'));
      }
    }
    function sayBtn(text, label = '听一遍') {
      if (typeof ctx.say !== 'function' || !text) return null;
      return h('button', { type: 'button', className: 'say', 'aria-label': label, on: { click: ev => { ev.stopPropagation(); ctx.say(text, ev.currentTarget); } } }, icon('speak'));
    }

    // 这句看不懂：第一下断句和主干，第二下关键词，第三下整句中文
    function trunkLine(s) {
      const parts = T.trunkParts(s.en, s.trunk);
      if (!parts) return null;
      return h('div', { className: 'tr-trunk' },
        h('p', { className: 'tr-trunk-en', lang: 'en' }, parts.map(p => (p.role ? h('span', { className: 'tr-' + p.role }, p.text) : p.text))),
        h('p', { className: 'tr-trunk-note' }, s.trunk.note || [s.trunk.subject ? `谁 = ${s.trunk.subject}` : '', `干什么 = ${s.trunk.verb}`].filter(Boolean).join('，')));
    }
    function helpParts(s) {
      const lv = helpLevel.get(s.i) || 0;
      if (!lv) return [];
      const chunks = R.chunksOf(s);
      const out = [
        h('p', { className: 'tr-chunks', lang: 'en' }, chunks.map((x, k) => [k ? h('span', { className: 'tr-slash', 'aria-hidden': 'true' }, ' / ') : null, h('span', null, x)])),
        trunkLine(s),
        s.tags && s.tags.length ? h('p', { className: 'tr-tags' }, s.tags.map(t => h('span', { className: 'tr-gtag' }, T.TAGS[t] || t))) : null,
      ];
      if (lv >= 2) {
        const keys = R.keysOf(s, env);
        out.push(keys.length ? h('p', { className: 'tr-keys' }, keys.map(k => h('span', { className: 'tr-key' }, h('b', { lang: 'en' }, k.w), ' ', k.zh)))
          : h('p', { className: 'tr-note small' }, '这句的词都不难，再看一遍断句。'));
      }
      if (lv >= 3) {
        out.push(s.unsure
          ? h('p', { className: 'tr-zh unsure' }, '这句老师也拿不准，问问老师吧。')
          : h('p', { className: 'tr-zh' }, s.zh));
        out.push(h('button', { type: 'button', className: 'text-btn accent tr-ask', on: { click: () => askTeacher(rec, rec.sentences[s.i - 1] || s) } }, '问老师这句'));
      }
      return out.filter(Boolean);
    }
    function passageView({ pick = null, marks = new Map() } = {}) {
      const el = h('div', { className: 'tr-story' + (pick ? ' picking' : '') });
      const rows = [];
      let prev = null;
      for (const s of ep.sentences) {
        const who = s.speaker && s.speaker !== prev ? h('p', { className: 'tr-who', lang: 'en' }, s.speaker) : null;
        prev = s.speaker || null;
        const words = R.tokenize(s.en).map(t => (t.word && !pick
          ? h('span', { className: 'tr-w', role: 'button', tabindex: '0', on: { click: ev => { ev.stopPropagation(); openWord(t.text, s); } } }, t.text)
          : t.text));
        const helpBox = h('div', { className: 'tr-help' });
        const helpBtn = pick ? null : h('button', { type: 'button', className: 'text-btn tr-help-btn' });
        const line = h('div', { className: 'tr-line' }, h('span', { className: 'tr-no' }, String(s.no)), h('p', { className: 'tr-en', lang: 'en' }, words), helpBtn);
        const row = h(pick ? 'button' : 'div', { className: 'tr-s' + (marks.get(s.i) ? ' ' + marks.get(s.i) : ''), ...(pick ? { type: 'button', on: { click: () => pick(s.i, row) } } : {}) },
          who, line, pick ? null : helpBox);
        if (helpBtn) {
          const paint = () => {
            const lv = helpLevel.get(s.i) || 0;
            helpBox.replaceChildren(...helpParts(s));
            helpBox.hidden = !lv;
            helpBtn.textContent = R.HELP_LABELS[Math.min(lv, R.HELP_LABELS.length - 1)];
            helpBtn.hidden = lv >= T.HELP_MAX;
          };
          helpBtn.addEventListener('click', () => {
            if (player && player.state === 'playing') { player.pause(); paintBar(); }
            const lv = (helpLevel.get(s.i) || 0) + 1;
            if (lv > T.HELP_MAX) return;
            helpLevel.set(s.i, lv);
            helps++;
            rec = T.noteHelp(rec, s.i, lv); save();
            log({ type: 'read_help', item: `tr:${rec.id}:s${s.i}`, mode: R.MODE, step, sid, textread: rec.id, sentence: s.i, level: lv, kind: 'sentence',
              words: s.words, tags: s.tags || [], question: /\?["”]?\s*$/.test(s.en), unsure: !!s.unsure });
            paint();
          });
          paint();
        }
        rows.push({ s, row });
        el.append(row);
      }
      let now = -1;
      return { el, rows,
        mark(i) {
          if (now >= 0 && rows[now]) rows[now].row.classList.remove('now');
          now = i;
          const r = rows[i];
          if (!r) return;
          r.row.classList.add('now');
          safe(() => r.row.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        },
        clear() { if (now >= 0 && rows[now]) rows[now].row.classList.remove('now'); now = -1; } };
    }

    // ---- the reading page: 先看题 → 先听一遍 → 自己读（看不懂就点）→ 做题
    const bar = h('div', { className: 'tr-bar' });
    let story = null;
    function paintBar() {
      const st = player ? player.state : 'idle';
      if (st === 'playing') {
        bar.replaceChildren(h('p', { className: 'tr-bar-msg' }, '老师在读，跟着看高亮的那句。'),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { player.pause(); paintBar(); } } }, '暂停'),
          h('button', { type: 'button', className: 'text-btn', on: { click: () => player.replay() } }, '重听这句'));
      } else if (st === 'paused') {
        bar.replaceChildren(h('p', { className: 'tr-bar-msg' }, '停下来了。'),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { closeCard(); player.resume(); paintBar(); } } }, '接着听'),
          h('button', { type: 'button', className: 'text-btn', on: { click: () => player.replay() } }, '重听这句'));
      } else if (st === 'done' || st === 'stopped') {
        bar.replaceChildren(h('p', { className: 'tr-bar-msg' }, '听完了。现在自己读一遍，看不懂的句子点“看不懂”。'),
          h('button', { type: 'button', className: 'text-btn', on: { click: listen } }, '再听一遍'));
      } else {
        bar.replaceChildren(h('button', { type: 'button', className: 'btn tr-listen', on: { click: listen } }, icon('speak'), '先听老师读一遍'),
          h('button', { type: 'button', className: 'text-btn', on: { click: () => { player = { state: 'stopped', stop() {} }; paintBar(); } } }, '我自己读'));
      }
    }
    function listen() {
      closeCard();
      if (player && player.stop) player.stop();
      listenT0 = Date.now();
      player = R.createReadAloud({
        count: ep.sentences.length,
        speak: i => speakWait(ep.sentences[i].en),
        stopSpeech,
        gap: i => 650 + (/\?["”]?$/.test(ep.sentences[i].en) ? 150 : 0),
        onIndex: i => story && story.mark(i),
        onState: st => {
          if (st === 'done') {
            listenMs += Date.now() - listenT0;
            if (story) story.clear();
            log({ type: 'read_time', item: `tr:${rec.id}`, mode: R.MODE, step, sid, textread: rec.id, phase: 'listen', ms: listenMs, sentences: ep.sentences.length, completed: true });
          }
          paintBar();
        },
      });
      player.start(0);
    }
    function readView() {
      closeCard();
      story = passageView();
      const qs = ep.questions;
      fill(box,
        h('p', { className: 'tr-chip' }, h('span', { className: 'tr-tag' }, ep.label)),
        h('h2', { className: 'tr-ptitle-big', lang: 'en' }, ep.title || ep.label),
        ep.titleZh ? h('p', { className: 'tr-ptitle-zh' }, ep.titleZh) : null,
        qs.length ? h('div', { className: 'tr-first' }, h('p', { className: 'tr-label' }, '先看看要回答什么'),
          h('ol', { className: 'tr-first-list' }, qs.map(q => h('li', null, h('span', { lang: 'en' }, q.ask || q.zh), q.ask && q.zh ? h('span', { className: 'tr-first-zh' }, q.zh) : null)))) : null,
        bar, story.el,
        h('div', { className: 'tr-actions tr-end' },
          qs.length
            ? h('button', { type: 'button', className: 'btn tr-main', on: { click: () => { if (player && player.stop) player.stop(); quiz(0); } } }, `读完了，做 ${qs.length} 道题`)
            : h('button', { type: 'button', className: 'btn tr-main', on: { click: () => finish() } }, '读完了')),
        card);
      paintBar();
    }

    // ---- the questions
    function quiz(k) {
      closeCard();
      const q = ep.questions[k];
      if (!q) { finish(); return; }
      const isEv = q.kind === 'evidence';
      const a = isEv ? T.createEvidenceAttempt(q) : R.createAttempt(q);
      const hintBox = h('div', { className: 'tr-hints' });
      const shown = [];
      const msg = h('p', { className: 'tr-q-msg' });
      let showZh = false, look = false;
      const zhBtn = q.zh && q.ask ? h('button', { type: 'button', className: 'text-btn tr-zh-btn', on: { click: () => {
        showZh = !showZh; zhLine.hidden = !showZh; zhBtn.textContent = showZh ? '收起中文' : '看中文';
        settle();
        if (showZh) log({ type: 'read_help', item: q.item, mode: R.MODE, step, sid, textread: rec.id, kind: 'question_zh', level: 1 });
      } } }, '看中文') : null;
      const zhLine = h('p', { className: 'tr-q-zh', hidden: true }, q.zh);
      const opts = h('div', { className: 'tr-opts' });
      const passBox = h('div', { className: 'tr-q-passage' });
      const nextBtn = h('button', { type: 'button', className: 'btn tr-main', hidden: true, on: { click: () => quiz(k + 1) } }, k + 1 < ep.questions.length ? '下一题' : '做完了');
      const hintBtn = h('button', { type: 'button', className: 'text-btn', on: { click: () => {
        const hnt = a.hint();
        if (!hnt) return;
        shown.push(hnt);
        log({ type: 'hint', item: q.item, mode: R.MODE, step, sid, textread: rec.id, level: hnt.level, hint_level: hnt.level, auto: false });
        settle();
      } } }, '给个提示');
      const lookBtn = isEv ? null : h('button', { type: 'button', className: 'text-btn accent', on: { click: () => { look = !look; settle(); } } }, '回原文看看');

      function logAnswer(out) {
        if (!out || !out.event) return;
        log({ type: 'answer', step, sid, textread: rec.id, qtype: q.type, ...out.event, mode: R.MODE, item: q.item });
        if (out.hintShown) { shown.push(out.hintShown); log({ type: 'hint', item: q.item, mode: R.MODE, step, sid, textread: rec.id, level: out.hintShown.level, hint_level: out.hintShown.level, auto: true }); }
      }
      function evidenceMarks() {
        const m = new Map();
        const ids = isEv ? q.answer : q.evidence;
        if (a.done || a.level >= 2) for (const i of ids || []) m.set(i, a.done && !a.passed && isEv ? 'answer' : 'evidence');
        if (isEv) for (const i of a.picked) m.set(i, q.answer.includes(i) ? 'right' : 'wrong');
        return m;
      }
      function settle() {
        hintBox.replaceChildren(...shown.map(x => h('p', { className: 'tr-hint' + (x.level >= T.HINT_MAX ? ' last' : '') }, h('span', { className: 'tr-hint-n' }, `提示 ${x.level}`), x.text)));
        if (isEv) {
          const pv = passageView({ pick: a.done ? null : i => { logAnswer(a.pick(i)); settle(); }, marks: evidenceMarks() });
          passBox.replaceChildren(pv.el);
        } else {
          fill(passBox, look || a.done ? passageView({ marks: evidenceMarks() }).el : null);
          if (lookBtn) { lookBtn.hidden = a.done; lookBtn.textContent = look ? '收起原文' : '回原文看看'; }
          opts.replaceChildren(...q.options.map((o, i) => {
            const pickedIt = a.picked.has(i);
            const cls = 'tr-opt' + (pickedIt && !o.correct ? ' wrong' : '') + ((a.done && o.correct) || (pickedIt && o.correct) ? ' right' : '') + (o.drop && a.level >= 3 && !o.correct ? ' dropped' : '');
            return h('button', { type: 'button', className: cls, disabled: a.done || pickedIt || (o.drop && a.level >= 3 && !o.correct),
              on: { click: () => { logAnswer(a.pick(i)); settle(); } } },
            h('span', { className: 'tr-opt-l' }, LETTERS[i] || ''), h('span', { className: 'tr-opt-t', lang: 'en' }, o.text),
            o.zh && (showZh || a.done) ? h('span', { className: 'tr-opt-zh' }, o.zh) : null);
          }));
        }
        if (a.done) {
          const r = a.result();
          results[k] = r;
          rec = T.noteAnswer(rec, q.id, r); save();
          msg.textContent = a.passed ? (a.clean ? '对了。' : '改对了。') : '这题先记下来，看看提示 4 怎么讲的。';
          msg.className = 'tr-q-msg ' + (a.passed ? 'ok' : 'no');
          if (!a.passed && !shown.some(x => x.level >= T.HINT_MAX)) shown.push({ level: T.HINT_MAX, text: q.hints[T.HINT_MAX - 1] || q.explain });
          hintBox.replaceChildren(...shown.map(x => h('p', { className: 'tr-hint' + (x.level >= T.HINT_MAX ? ' last' : '') }, h('span', { className: 'tr-hint-n' }, `提示 ${x.level}`), x.text)));
          if (a.passed && q.explain) hintBox.append(h('p', { className: 'tr-hint last' }, q.explain));
          hintBtn.hidden = true;
          nextBtn.hidden = false;
        } else {
          msg.textContent = isEv ? (a.picked.size ? '不是这句。再找找。' : '在课文里点出答案在哪一句。') : (a.picked.size ? '不对，再想想。' : '');
          msg.className = 'tr-q-msg';
          hintBtn.hidden = a.level >= T.HINT_MAX;
          hintBtn.textContent = a.level ? '再给个提示' : '给个提示';
        }
      }
      fill(box,
        h('p', { className: 'tr-chip' }, h('span', { className: 'tr-tag' }, `第 ${k + 1} 题`), h('span', { className: 'tr-sub' }, T.TYPE_ZH[q.type] || q.skillName || '')),
        h('p', { className: 'tr-q-ask', lang: q.ask ? 'en' : 'zh-CN' }, q.ask || q.zh),
        zhBtn, zhLine,
        isEv ? null : opts,
        msg, hintBox,
        h('div', { className: 'tr-q-tools' }, hintBtn, lookBtn),
        passBox,
        h('div', { className: 'tr-actions' }, nextBtn),
        card);
      settle();
      if (typeof box.scrollIntoView === 'function') safe(() => box.scrollIntoView({ block: 'start' }));
    }

    function finish() {
      if (stopped) return;
      const hard = ep.sentences.filter(s => (helpLevel.get(s.i) || 0) >= 3).map(s => rec.sentences[s.i - 1]).filter(Boolean);
      done(rec, { done: true, results: results.filter(Boolean), helps, hardSentences: hard, ms: listenMs });
    }

    readView();
    return {
      el: box,
      onKey() {},
      stop() { stopped = true; if (player && player.stop) safe(() => player.stop()); stopSpeech(); },
    };
  }

  // ------------------------------------------------ the outside
  function open() { mount(); home(); }
  function openSaved(id) {
    mount();
    const rec = getRec(id);
    if (!rec) { home(); safe(() => ctx.toast && ctx.toast('这一页找不到了，再拍一次吧。')); return; }
    startReading(rec);
  }
  function show(params = {}) { if (params && params.id) openSaved(params.id); else open(); }
  function hide() {
    gen++;
    if (ctrl) { safe(() => ctrl.abort()); ctrl = null; }
    stopReader();
    photo = null; draft = null; working = false;
    setBusy(false);
    if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
    safe(() => document.documentElement.classList.remove('tr-open'));
  }
  return {
    open, openSaved, show, hide,
    inSession: () => working || readingNow,
    holding: () => !!photo || !!draft,
    get el() { return host; },
  };
}
