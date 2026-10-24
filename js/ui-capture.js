// 家长区里的“拍课本”页（DESIGN 6.2，v1）：拍之前的提示、拍照或从相册选、识别中、确认页（逐行核对：可改、可删、
// 看不清的标出来、可以补一行）、存好了。识别和写入在 capture.js。照片只在这一页的内存里，存好、重拍、离开都丢掉。
// 负责：拍课本 agent（capture.js、ui-capture.js、css/capture.css、tests/capture.test.mjs）。
//
// 导出
//   createCaptureView(ctx, { root }) -> { show(params), hide(), onChange(), holding(), inSession() }
//     路由 'capture'（从家长区“拍课本”那一行 go('capture') 进来，整页，藏标签栏），画进 #tab-capture（root 不给时）。
//     左上角“家长区”回去（家长区离开时已经上锁，要再输一次数字码）。确认页改过还没存时，第一次点返回只提醒。
//     hide()：离开这一页（app.js 换路由时调）：丢掉照片和识别结果。holding() / inSession()：手上有照片或没存的结果时为真，
//     自动更新会等；同时 ctx.busy(+1)，结果存好或丢掉时 ctx.busy(-1)。
//   纯函数（Node 测试用）：rowsFrom(result)、unitChoices(curriculum, extra)、summaryText(rows)、savedText(counts, plan, dryRun)、
//     photoStatus(textbook)（家长区那一行右边可以显示它：“2 个单元按照片核对过”）
// 用到的 ctx：settings、mockForced、budget、kv.peek、curriculum（units、isPrimary、isRequired）、words.get / importData、
//   reloadCurriculum、busy、go、toast。
// 模拟模式（?mock=1 或家长区的模拟模式开关）：不看照片，给一份假的识别结果；“存”只算一遍会写什么，什么都不写。
import { h, icon } from './ui-dom.js';
import { recognize, imageToJpeg, planVocab, planToc, saveCapture, keptRows, tierText, unitTitleOf, unitIdOf, PAGE_LABEL } from './capture.js';
import { normWord, defaultUnitOrder } from './curriculum.js';

const TIP = '别拍到封面上的名字和班级。';
const BOOK_UNITS = ['S', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'];

// ---------------------------------------------------------------- pure helpers

let rid = 0;
export function rowsFrom(result) {
  return ((result && result.words) || []).map(x => ({ id: ++rid, w: x.w || '', pos: x.pos || '', cn: x.cn || '', unclear: !!x.unclear, deleted: false }));
}

// [{ id, title }] for the unit picker: the book's Starter to Unit 6, units already on the iPad, and the page's own
export function unitChoices(curriculum, extra = null) {
  const map = new Map();
  const add = (id, title) => { if (id && !map.has(id)) map.set(id, { id, title: title || unitTitleOf(id), order: defaultUnitOrder(id) }); };
  let known = [];
  try { known = curriculum && curriculum.units ? curriculum.units() : []; } catch (e) { known = []; }
  for (const u of known) add(u.id, u.title);
  if (extra && extra.id) add(extra.id, extra.title);
  for (const id of BOOK_UNITS) add(id);
  return [...map.values()].sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
}

export function summaryText(rows) {
  const kept = keptRows(rows).length;
  const unclear = (rows || []).filter(r => r && !r.deleted && r.unclear).length;
  const gone = (rows || []).filter(r => r && r.deleted).length;
  const bits = [`存 ${kept} 个`];
  if (unclear) bits.push(`${unclear} 个看不清的还没改，先不存`);
  if (gone) bits.push(`删掉了 ${gone} 个`);
  return bits.join('；') + '。';
}

export function savedText(c, plan, dryRun = false) {
  if (!c || !plan) return '';
  if (plan.kind === 'toc') {
    const s = `目录记下了 ${c.listed} 个单元${c.renamed ? `，${c.renamed} 个单元的标题照目录改了` : ''}。`;
    return dryRun ? '模拟模式，什么都没写。如果存：' + s : '存好了：' + s;
  }
  const name = (plan.unit && plan.unit.title) || '';
  const bits = [`新加 ${c.added} 个词`];
  if (c.updated) bits.push(`改了 ${c.updated} 个`);
  if (c.same) bits.push(`${c.same} 个和原来一样`);
  let s = `${name} ${bits.join('，')}`;
  if (c.moved) s += `；${c.moved} 个从别的单元挪了过来`;
  s += '。';
  return dryRun ? '模拟模式，什么都没写。如果存：' + s : '存好了：' + s;
}

// one line for the parent area row
export function photoStatus(textbook) {
  const units = (textbook && Array.isArray(textbook.units)) ? textbook.units : [];
  const done = units.filter(u => u && u.source === 'photo');
  if (done.length) return `${done.length} 个单元按照片核对过`;
  if (textbook && Array.isArray(textbook.toc) && textbook.toc.length) return '拍过目录';
  return '还没拍过';
}

// ---------------------------------------------------------------- the view

export function createCaptureView(ctx, { root = null } = {}) {
  let el = null;          // #tab-capture, found on first show
  let openNow = false;    // this page is the one showing
  let gen = 0;            // a photo taken while an older one is still being read wins
  let view = 'intro';     // intro | reading | error | vocab | toc | other | saving | saved
  let photo = null;       // { dataUrl, width, height, bytes }: memory only
  let result = null;
  let rows = [];
  let tocRows = [];
  let unitId = '';
  let lastUnit = '';
  let errMsg = '';
  let plan = null, counts = null, dry = false;
  let ctrl = null;
  let dirty = false, closeArm = 0;

  const mock = () => !!((ctx.settings && ctx.settings() || {}).mock || (ctx.mockForced && ctx.mockForced()));
  const curriculum = () => ctx.curriculum || null;
  const textbook = () => (ctx.kv && ctx.kv.peek ? ctx.kv.peek('textbook', null) : null);

  // two file inputs: the camera, and the photo library (a page photographed earlier)
  let camIn = null, albumIn = null;
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

  // busy while a photo or an unsaved result is in hand (the app does not reload itself under it)
  let busyOn = false;
  function setBusy(on) {
    if (on === busyOn) return;
    busyOn = on;
    if (ctx.busy) ctx.busy(on ? +1 : -1);
  }
  function dropPhoto() { photo = null; }

  async function take(file, mockKind = 'vocab') {
    const my = ++gen;
    if (ctrl) ctrl.abort();
    dropPhoto();
    result = null; rows = []; tocRows = []; errMsg = ''; dirty = false;
    view = 'reading';
    setBusy(true);
    render();
    try {
      const p = mock() ? null : await imageToJpeg(file);
      if (my !== gen || !openNow) return;
      photo = p;
    } catch (e) {
      if (my !== gen) return;
      errMsg = (e && e.message) || '这张照片打不开，换一张再试。'; view = 'error'; setBusy(false); render(); return;
    }
    render();
    ctrl = new AbortController();
    try {
      let units = [];
      try { units = curriculum() ? curriculum().units() : []; } catch (e) { units = []; }
      const settings = { ...(ctx.settings ? ctx.settings() : {}), mock: mock() };
      const r = await recognize({ dataUrl: photo && photo.dataUrl, settings, budget: ctx.budget, signal: ctrl.signal, units, mockKind });
      if (my !== gen || !openNow) return;
      result = r.result;
      rows = rowsFrom(result);
      tocRows = result.units.map(u => ({ id: u.id, title: u.title, deleted: false }));
      unitId = (result.unit && result.unit.id) || lastUnit || '';
      view = result.pageType === 'toc' ? 'toc' : result.pageType === 'vocab' ? 'vocab' : 'other';
      if (view === 'vocab' && !rows.length) { errMsg = '这一页没认出词。拍近一点、拍正一点，光线亮一点，再试一次。'; view = 'error'; }
    } catch (e) {
      if (my !== gen || (e && e.code === 'abort')) return;
      errMsg = (e && e.message) || String(e);
      view = 'error';
    } finally { if (my === gen) ctrl = null; }
    if (view === 'error') setBusy(false);
    render();
  }

  function reset() {
    gen++;
    if (ctrl) { ctrl.abort(); ctrl = null; }
    dropPhoto();
    result = null; rows = []; tocRows = []; plan = null; counts = null; errMsg = ''; dirty = false; closeArm = 0;
    view = 'intro';
    setBusy(false);
  }
  function retake() { reset(); render(); }

  async function save(kind) {
    const now = new Date();
    try {
      if (kind === 'toc') plan = planToc({ rows: tocRows, textbook: textbook(), now });
      else {
        const u = unitChoices(curriculum(), result && result.unit).find(x => x.id === unitId);
        const recognized = result && result.unit && result.unit.id === unitId ? result.unit.title : '';
        plan = planVocab({ rows, unitId, unitTitle: recognized || (u && u.title) || '', textbook: textbook(), curriculum: curriculum(),
          getEntry: slug => (ctx.words && ctx.words.get ? ctx.words.get(slug) : undefined), now });
      }
    } catch (e) { if (ctx.toast) ctx.toast((e && e.message) || String(e)); return; }
    const back = view;
    view = 'saving';
    render();
    try {
      dry = mock();
      counts = await saveCapture(ctx, plan, { dryRun: dry });
      if (kind !== 'toc') lastUnit = unitId;
      dropPhoto();
      dirty = false;
      view = 'saved';
      setBusy(false);
      if (ctx.toast) ctx.toast(dry ? '模拟模式，没有写入' : '存好了');
    } catch (e) {
      view = back;
      if (ctx.toast) ctx.toast('没存上：' + ((e && e.message) || e), 4000);
    }
    render();
  }

  // ---------------------------------------------------------------- drawing

  const btn = (text, onClick, cls = 'btn') => h('button', { type: 'button', className: cls, text, on: { click: onClick } });
  const pickCam = () => { inputs(); camIn.click(); };
  const pickAlbum = () => { inputs(); albumIn.click(); };

  function head(step) {
    return h('header', { className: 'cap-head' },
      h('button', { type: 'button', className: 'text-btn cap-back', on: { click: () => leave() } }, icon('back'), h('span', { text: '家长区' })),
      h('span', { className: 'cap-head-title', text: '拍课本' }),
      h('span', { className: 'cap-head-step small', text: step || '' }));
  }

  const mockNote = () => (mock() ? h('p', { className: 'small cap-mock', text: '模拟模式：不看照片，给一份假的识别结果；存的时候只算一遍，什么都不写。' }) : null);
  const photoEl = () => (photo && photo.dataUrl
    ? h('figure', { className: 'cap-photo' },
      h('img', { src: photo.dataUrl, alt: '刚拍的这一页', on: { click: ev => ev.currentTarget.closest('.cap-photo').classList.toggle('big') } }),
      h('figcaption', { className: 'small', text: '点照片放大。核对完照片就丢掉，不存。' }))
    : null);

  function introView() {
    const tb = textbook();
    const units = (tb && tb.units) || [];
    const n = units.reduce((a, u) => a + ((u && u.words) || []).length, 0);
    return [
      head(''),
      h('h1', { className: 'cap-title', text: '拍一页课本' }),
      h('p', { className: 'cap-lede', text: '拍目录页，或者一个单元的词汇表页。一次一页，拍平、拍全，光线亮一点。' }),
      h('p', { className: 'cap-tip', role: 'note' }, icon('alert'), h('span', { text: TIP })),
      h('div', { className: 'cap-actions' },
        btn('拍一张', pickCam, 'btn cap-main'),
        btn('从相册选', pickAlbum, 'text-btn accent'),
        mock() ? btn('不拍，看假的词汇表', () => take(null, 'vocab'), 'text-btn') : null,
        mock() ? btn('看假的目录', () => take(null, 'toc'), 'text-btn') : null),
      mockNote(),
      h('p', { className: 'small cap-foot', text: units.length
        ? `现在的课本：${units.map(u => u.title || u.id).join('、')}，共 ${n} 个词。${photoStatus(tb)}。`
        : '还没有课本数据。先拍目录页，再一个单元一个单元拍词汇表。' }),
      h('p', { className: 'small cap-foot', text: '一张约 1 分钱。认出来的词你核对过才存，照片不留。' }),
    ];
  }

  function readingView() {
    return [
      head(''),
      h('h1', { className: 'cap-title', text: '正在看这一页' }),
      photoEl(),
      h('p', { className: 'cap-lede cap-wait', text: photo || mock() ? '大约 10 到 20 秒。' : '正在把照片缩小…' }),
      h('div', { className: 'cap-actions' }, btn('不等了，重拍', retake, 'text-btn')),
    ];
  }

  function errorView() {
    return [
      head(''),
      h('h1', { className: 'cap-title', text: '这次没认出来' }),
      h('p', { className: 'cap-lede', text: errMsg }),
      photoEl(),
      h('p', { className: 'cap-tip', role: 'note' }, icon('alert'), h('span', { text: TIP })),
      h('div', { className: 'cap-actions' }, btn('再拍一张', pickCam, 'btn cap-main'), btn('从相册选', pickAlbum, 'text-btn accent'), btn('回家长区', () => leave(), 'text-btn')),
    ];
  }

  function otherView() {
    const t = result ? result.pageType : 'other';
    const words = rows.length;
    return [
      head(PAGE_LABEL[t] || ''),
      h('h1', { className: 'cap-title', text: t === 'grammar' ? '这一页像是语法页' : '这一页认不出是哪种' }),
      h('p', { className: 'cap-lede', text: t === 'grammar' ? '语法页要到下一版才认，这次先不存。' : '它看着不像目录，也不像单元词汇表。' }),
      photoEl(),
      h('div', { className: 'cap-actions' }, btn('重拍', retake, 'btn cap-main'),
        words ? btn(`当成词汇表核对（${words} 个词）`, () => { view = 'vocab'; render(); }, 'text-btn accent') : null,
        btn('回家长区', () => leave(), 'text-btn')),
    ];
  }

  // the confirm page for a vocabulary page: one row per word, edited in place without redrawing (focus stays)
  function vocabView() {
    const choices = unitChoices(curriculum(), result && result.unit);
    const sumEl = h('p', { className: 'small cap-sum', text: summaryText(rows) });
    const unitName = () => { const u = choices.find(x => x.id === unitId); return u ? u.title : ''; };
    const saveBtn = h('button', { type: 'button', className: 'btn cap-main', on: { click: () => save('vocab') } });
    const sync = () => {
      sumEl.textContent = summaryText(rows);
      const n = keptRows(rows).length;
      saveBtn.disabled = !unitId || !n;
      saveBtn.textContent = !unitId ? '先选单元' : `都对，存进 ${shortUnit(unitName())}`;
      titleEl.textContent = `${unitId ? shortUnit(unitName()) + ' ' : ''}词汇表 · 识别出 ${rows.filter(r => !r.deleted).length} 个`;
    };
    const titleEl = h('h1', { className: 'cap-title' });
    const pick = h('select', { className: 'field cap-unit', 'aria-label': '这一页是哪个单元', on: { change: ev => { unitId = ev.target.value; dirty = true; sync(); } } },
      h('option', { value: '', text: '选单元', disabled: true, selected: !unitId }),
      ...choices.map(u => h('option', { value: u.id, text: u.title, selected: u.id === unitId })));
    const list = h('ol', { className: 'cap-rows' });
    const drawRows = () => { list.replaceChildren(...rows.filter(r => !r.deleted).map(rowEl)); sync(); };
    function rowEl(r) {
      const tier = h('span', { className: 'cap-tier small', text: tierText(r.w, curriculum()) });
      const li = h('li', { className: 'cap-row' + (r.unclear ? ' unclear' : ''), dataset: { id: String(r.id) } });
      const mark = h('button', { type: 'button', className: 'cap-unclear', text: '看不清，点一下改', on: { click: () => { r.unclear = false; dirty = true; li.classList.remove('unclear'); wIn.focus(); sync(); } } });
      const edit = (k, input) => input.addEventListener('input', () => {
        r[k] = input.value; dirty = true;
        if (r.unclear) { r.unclear = false; li.classList.remove('unclear'); }
        if (k === 'w') tier.textContent = tierText(r.w, curriculum());
        sync();
      });
      const wIn = h('input', { className: 'cap-w', type: 'text', value: r.w, lang: 'en', 'aria-label': '英文', placeholder: '英文',
        autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false' });
      const pIn = h('input', { className: 'cap-pos', type: 'text', value: r.pos, lang: 'en', 'aria-label': '词性', placeholder: '词性',
        autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false' });
      const cIn = h('input', { className: 'cap-cn', type: 'text', value: r.cn, lang: 'zh-CN', 'aria-label': '书上的中文', placeholder: '书上的中文', autocomplete: 'off' });
      edit('w', wIn); edit('pos', pIn); edit('cn', cIn);
      const del = h('button', { type: 'button', className: 'cap-del', 'aria-label': '删掉这一行', on: { click: () => { r.deleted = true; dirty = true; drawRows(); } } }, icon('close'));
      li.append(h('div', { className: 'cap-fields' }, wIn, pIn, cIn), h('div', { className: 'cap-meta' }, mark, tier), del);
      return li;
    }
    const addRow = () => {
      const r = { id: ++rid, w: '', pos: '', cn: '', unclear: false, deleted: false };
      rows.push(r); dirty = true;
      drawRows();
      const last = list.querySelector(`[data-id="${r.id}"] .cap-w`);
      if (last) last.focus();
    };
    const tb = textbook();
    const pages = () => { const u = tb && (tb.units || []).find(x => x && x.id === unitId); return u && u.pages ? u.pages : 0; };
    const out = [
      head(PAGE_LABEL.vocab),
      titleEl,
      h('label', { className: 'cap-label' }, h('span', { text: '这一页是' }), pick),
      pages() ? h('p', { className: 'small', text: `这个单元已经按照片存过 ${pages()} 页，这一页的词会并进去。` }) : null,
      photoEl(),
      mockNote(),
      h('p', { className: 'small', text: '对着书看一遍：拼错的直接改，多出来的点 × 删掉，漏了的在最下面补一行。' }),
      list,
      h('div', { className: 'cap-add' }, btn('补一行', addRow, 'text-btn accent')),
      h('div', { className: 'cap-bar' }, sumEl, h('div', { className: 'cap-actions' }, saveBtn, btn('重拍这一页', retake, 'text-btn'))),
    ];
    drawRows();
    return out;
  }

  function tocView() {
    const list = h('ol', { className: 'cap-rows cap-toc' });
    const saveBtn = h('button', { type: 'button', className: 'btn cap-main', text: '都对，存目录', on: { click: () => save('toc') } });
    const draw = () => {
      list.replaceChildren(...tocRows.filter(r => !r.deleted).map(r => {
        const id = unitIdOf(r.id);
        const base = unitTitleOf(id);
        const rest = String(r.title || '').slice(base.length).trim();
        const tIn = h('input', { className: 'cap-cn', type: 'text', value: rest, lang: 'en', 'aria-label': base + ' 的标题', placeholder: '单元标题',
          autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false' });
        tIn.addEventListener('input', () => { r.title = unitTitleOf(id, tIn.value); dirty = true; });
        return h('li', { className: 'cap-row' },
          h('div', { className: 'cap-fields cap-toc-fields' }, h('b', { className: 'cap-toc-id', text: base }), tIn),
          h('button', { type: 'button', className: 'cap-del', 'aria-label': '删掉这一行', on: { click: () => { r.deleted = true; dirty = true; draw(); } } }, icon('close')));
      }));
      saveBtn.disabled = !tocRows.some(r => !r.deleted);
    };
    draw();
    return [
      head(PAGE_LABEL.toc),
      h('h1', { className: 'cap-title', text: `目录 · 认出 ${tocRows.length} 个单元` }),
      photoEl(),
      mockNote(),
      h('p', { className: 'small', text: '对着书看一遍单元的顺序和标题。存了以后，单词页的单元名照目录写。' }),
      list,
      h('div', { className: 'cap-bar' }, h('div', { className: 'cap-actions' }, saveBtn, btn('重拍这一页', retake, 'text-btn'))),
    ];
  }

  function savingView() {
    return [head(''), h('h1', { className: 'cap-title', text: '正在存…' })];
  }

  function savedView() {
    return [
      head(''),
      h('h1', { className: 'cap-title', text: dry ? '模拟存了一遍' : '存好了' }),
      h('p', { className: 'cap-lede', text: savedText(counts, plan, dry) }),
      h('p', { className: 'small', text: '照片已经丢掉，没有存。' }),
      plan && plan.kind === 'vocab' && counts && counts.skippedUnclear ? h('p', { className: 'small', text: `${counts.skippedUnclear} 个看不清的没存，可以再拍一次这一页补上。` }) : null,
      h('div', { className: 'cap-actions' }, btn('再拍一页', () => { retake(); }, 'btn cap-main'), btn('完成', () => leave(true), 'text-btn accent')),
    ];
  }

  const shortUnit = t => { const m = String(t || '').match(/^(Starter|Unit \d+)/); return m ? m[1] : String(t || ''); };

  function render() {
    if (!el) return;
    const views = { intro: introView, reading: readingView, error: errorView, other: otherView, vocab: vocabView, toc: tocView, saving: savingView, saved: savedView };
    const inner = h('div', { className: 'cap-page' }, ...(views[view] || introView)());
    el.replaceChildren(inner);
    if (camIn) el.append(camIn, albumIn);
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }

  // back to 家长区; edits on the confirm page are not thrown away on one stray tap
  function leave(force = false) {
    if (!force && dirty && (view === 'vocab' || view === 'toc') && Date.now() > closeArm) {
      closeArm = Date.now() + 3000;
      if (ctx.toast) ctx.toast('改过的还没存。再点一次就不存了。', 3000);
      return;
    }
    reset();
    if (ctx.go) ctx.go('parent');
  }

  return {
    show() {
      if (!el) el = root || (typeof document !== 'undefined' ? document.getElementById('tab-capture') : null);
      inputs();
      openNow = true;
      reset();
      render();
    },
    hide() {
      openNow = false;
      reset();
      if (el) el.replaceChildren();
    },
    onChange() { if (openNow && view === 'intro') render(); },
    holding: () => busyOn,
    inSession: () => busyOn,
  };
}
