// 单词 tab (the dictionary's 词库): running head with the count and the 家长 entry (家长区, ui-parent.js), a search
// line, sort as a phrase of words, filters as a line of small words, rows grouped by month / letter / lookups (sticky
// group heads), an A–Z thumb index. Rendered in batches of 150. A row pushes the word page (‹ 单词).
// Owner: 接线. Unit filter (DESIGN 5.1): once the textbook is imported, a second line of small words picks a unit
// (curriculum.units(), entry.unit or curriculum.unitOf) or 课外 (no unit). Inside a unit the words follow the textbook:
// 必会词, then 认读词, then 小学词, each in the book's order (entry.order).
// 0.7 单词本的积累 (wordbook.js, css/wordbook.css): a line on top with this week's gain (“这周新认得 12 个，会写 5 个。”),
// 加一个词 (offline dictionary gives the Chinese, she may add where she saw it), 选几个练一下 (choice / listen / spell / cloze),
// every row shows its level (没见过 / 认得 / 会写) and where it came from; filters 我不熟的 / 快忘的 / 这周新加的 and the three
// levels, a line of sources (课本、故事、问老师、查词、错题、我自己加的…). A row opens the word's card (读音、课本里的意思、
// 她遇见过的句子、错过几次); 看完整讲解 pushes the old word page. Pushed screens are a stack: card / detail / practice / add.
import { h, icon } from './ui-dom.js';
import { createEntryView } from './ui-entry.js';
import { summary, hasExtras } from './words.js';
import { State } from './fsrs.js';
import { LIB_CHUNK } from './config.js';
import * as WB from './wordbook.js';

// “今天到期” is called 今天要复习 now, the same words as the 复习 tab (design v2.1)
// 0.7: the levels are the two lines (没见过 / 认得 / 会写, wordbook.js levelOf) instead of the FSRS words 新词 / 学习中 / 已掌握
const FILTERS = [['all', '全部'], ['due', '今天要复习'], ['shaky', '我不熟的'], ['fading', '快忘的'], ['week', '这周新加的'],
  ['lv:new', '没见过'], ['lv:know', '认得'], ['lv:write', '会写'], ['relook', '收藏后又查过']];
const EVENT_DAYS = 180;
// index.html links one stylesheet per agent; until 接线 adds css/wordbook.css there, the tab links it itself
function ensureCss() {
  try {
    if (typeof document === 'undefined' || document.querySelector('link[href$="css/wordbook.css"]')) return;
    document.head.append(h('link', { rel: 'stylesheet', href: 'css/wordbook.css' }));
  } catch (e) { /* styles are optional */ }
}
const SORTS = [['new', '新→旧'], ['old', '旧→新'], ['az', 'A–Z'], ['most', '查得最多']];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const TIER_GROUP = { required: '必会词', recognize: '认读词', primary: '小学词', extra: '课外词' };
const TIER_RANK = { required: 0, recognize: 1, primary: 2, extra: 3 };
// 'Unit 2 More than fun' -> 'Unit 2' for the small line
const shortUnit = u => { const t = String((u && u.title) || (u && u.id) || ''); const m = t.match(/^(Unit \d+|Starter)\b/i); return m ? m[1] : t; };
const DAY = 864e5;

const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

export function createLibTab(app) {
  const root = document.getElementById('tab-lib');
  root.replaceChildren();
  ensureCss();

  let filter = 'all';
  let unit = '';          // '' every unit, a unit id, or 'extra' (words outside the textbook)
  let sort = lsGet('emma.sort', 'new');   // same origin as Wei's dictionary: localStorage keys start with emma.
  if (!SORTS.some(s => s[0] === sort)) sort = 'new';
  let query = '';
  let rows = [];
  let shown = 0;
  let dirty = true;
  let detail = null;      // EntryView in the detail screen
  let listScroll = 0;
  let changeTimer = 0;
  let groupCounts = new Map();
  let src = '';           // '' every source, or a wordbook.js source kind
  let events = [];        // answer / dictation / ask events of the last EVENT_DAYS days (read async, see loadEvents)
  let eventsAt = 0;
  let facts = null;       // wordbook.js buildFacts, rebuilt on each render
  let selecting = false;  // 选几个练一下: a tap picks the row instead of opening it
  const picked = new Set();
  const stack = [];       // pushed screens, the top one shows: 'card' | 'detail' | 'practice' | 'add'
  let practice = null;
  let busyHeld = false;

  // ---------------------------------------------------------------- DOM
  const countEl = h('span', { className: 'num count' });
  const meBtn = h('button', { type: 'button', className: 'text-btn parent-btn', 'aria-label': '家长区', text: '家长', on: { click: () => app.go('parent') } });
  const cancelBtn = h('button', { type: 'button', className: 'text-btn accent cancel', text: '取消', hidden: true });
  const statusSlot = h('div', { className: 'status-slot' });
  const top = h('header', { className: 'lib-top' },
    h('div', { className: 'runhead' }, h('h1', { className: 'runhead-title', text: '单词' }), h('div', { className: 'runhead-meta' }, countEl, meBtn, cancelBtn)));
  const searchEl = h('input', { type: 'search', className: 'lib-q', placeholder: '搜单词或中文意思', autocomplete: 'off',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': '搜索单词本' });
  const searchClear = h('button', { type: 'button', className: 'clear', 'aria-label': '清空搜索', hidden: true }, icon('close'));
  const searchRow = h('label', { className: 'search' }, icon('search'), searchEl, searchClear);
  const sortEl = h('div', { className: 'sort', role: 'group', 'aria-label': '排序' });
  const filterEl = h('div', { className: 'filters', role: 'tablist', 'aria-label': '筛选' });
  const unitEl = h('div', { className: 'filters units', role: 'tablist', 'aria-label': '单元', hidden: true });
  const summaryEl = h('p', { className: 'summary', hidden: true });
  const weekEl = h('p', { className: 'wb-week', hidden: true });
  const srcEl = h('div', { className: 'filters wb-srcline', role: 'tablist', 'aria-label': '从哪来', hidden: true });
  const addBtn = h('button', { type: 'button', className: 'btn wb-tool', on: { click: () => openAdd() } }, icon('plus'), '加一个词');
  const pickBtn = h('button', { type: 'button', className: 'btn wb-tool wb-tool-2', on: { click: () => setSelecting(!selecting) } }, '选几个练一下');
  const toolsEl = h('div', { className: 'wb-tools' }, addBtn, pickBtn);
  const pickCount = h('span', { className: 'wb-pick-n' });
  const pickGo = h('button', { type: 'button', className: 'btn wb-big', disabled: true, on: { click: () => startPractice([...picked]) } }, '开始练');
  const pickBar = h('div', { className: 'wb-pickbar', hidden: true },
    pickCount, pickGo, h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => setSelecting(false) } }));
  const listEl = h('div', { className: 'lib-list' });
  const thumbs = h('nav', { className: 'thumbs', 'aria-label': '字母索引', hidden: true });
  const loupe = h('div', { className: 'loupe', 'aria-hidden': 'true', hidden: true });
  const controls = h('div', { className: 'lib-controls' }, weekEl, toolsEl, searchRow, sortEl, filterEl, unitEl, srcEl, summaryEl);
  const listView = h('div', { className: 'lib-list-view' }, top, statusSlot, h('div', { className: 'lib-body' }, controls, listEl), pickBar);
  const detailView = h('div', { className: 'lib-detail-view', hidden: true });
  // the wordbook's own pushed screens: a running head with ‹ 单词 and a body
  const pushedView = (cls) => {
    const body = h('div', { className: 'wb-body' });
    const backBtn = h('button', { type: 'button', className: 'text-btn accent wb-back', on: { click: () => closeTop() } }, icon('back'), '单词');
    const el = h('div', { className: 'wb-view ' + cls, hidden: true }, h('header', { className: 'lib-top wb-top' }, h('div', { className: 'runhead' }, backBtn)), body);
    return { el, body, backBtn };
  };
  const cardV = pushedView('wb-card-view');
  const practiceV = pushedView('wb-practice-view');
  const addV = pushedView('wb-add-view');
  root.append(listView, detailView, cardV.el, practiceV.el, addV.el, thumbs, loupe);
  app.statusSlot(statusSlot);

  SORTS.forEach(([k, label], i) => {
    if (i) sortEl.append(h('span', { className: 'sep', 'aria-hidden': 'true', text: '·' }));
    sortEl.append(h('button', { type: 'button', className: 'text-btn', 'aria-pressed': String(k === sort), dataset: { s: k }, text: label,
      on: { click: () => { sort = k; lsSet('emma.sort', k); syncChips(); render(); window.scrollTo(0, 0); } } }));
  });
  for (const [k, label] of FILTERS) {
    filterEl.append(h('button', { type: 'button', className: 'f', role: 'tab', 'aria-selected': String(k === filter), dataset: { f: k },
      on: { click: () => { filter = k; syncChips(); render(); window.scrollTo(0, 0); } } },
    k === 'due' ? h('span', { className: 'dot', 'aria-hidden': 'true' }) : null, label));
  }
  function syncChips() {
    for (const b of filterEl.children) { const on = b.dataset.f === filter; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    for (const b of sortEl.querySelectorAll('button')) { const on = b.dataset.s === sort; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  syncChips();

  // the unit line, rebuilt on every render: the units change when a textbook pack is imported
  const curOf = () => { try { return app.curriculum; } catch (e) { return null; } };
  function renderUnits() {
    let units = [];
    try { const c = curOf(); units = c && c.hasTextbook && c.hasTextbook() ? c.units() : []; } catch (e) { units = []; }
    unitEl.hidden = !units.length;
    if (!units.length) { unit = ''; unitEl.replaceChildren(); return; }
    if (unit && unit !== 'extra' && !units.some(u => u.id === unit)) unit = '';
    const chip = (k, label) => h('button', { type: 'button', className: 'f' + (k === unit ? ' on' : ''), role: 'tab', 'aria-selected': String(k === unit),
      dataset: { u: k }, text: label, on: { click: () => { unit = k; render(); window.scrollTo(0, 0); } } });
    unitEl.replaceChildren(chip('', '全部单元'), ...units.map(u => chip(u.id, shortUnit(u))), chip('extra', '课外'));
  }
  const inUnitOrder = () => !!unit && unit !== 'extra' && !query && (sort === 'new' || sort === 'old');

  // searching: the sort and filters step aside, 取消 takes the running head
  const searching = () => document.activeElement === searchEl || !!searchEl.value;
  function syncSearch() {
    const on = searching();
    listView.classList.toggle('searching', on);
    cancelBtn.hidden = !on;
    countEl.hidden = on || !app.words.favorites().length;
    meBtn.hidden = on;
    searchClear.hidden = !searchEl.value;
  }
  let searchTimer = 0;
  searchEl.addEventListener('input', () => {
    syncSearch();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = searchEl.value.trim().toLowerCase(); render(); }, 120);
  });
  searchEl.addEventListener('focus', syncSearch);
  searchEl.addEventListener('blur', () => setTimeout(syncSearch, 0));
  searchEl.addEventListener('keydown', ev => { if (ev.key === 'Enter') searchEl.blur(); });
  searchClear.addEventListener('mousedown', ev => ev.preventDefault());
  searchClear.addEventListener('click', () => { searchEl.value = ''; query = ''; render(); searchEl.focus(); syncSearch(); });
  cancelBtn.addEventListener('mousedown', ev => ev.preventDefault());
  cancelBtn.addEventListener('click', () => { searchEl.value = ''; query = ''; searchEl.blur(); render(); syncSearch(); });

  // ---------------------------------------------------------------- data
  const favTime = w => w.favorited_at || w.created || '';
  function groupKey(w) {
    if (inUnitOrder()) return TIER_GROUP[w.tier] || '课外词';
    if (filter === 'fading' && (sort === 'new' || sort === 'old')) return '最快要忘的在前面';
    if (sort === 'az') { const c = (w.headword || '')[0] || ''; return /[a-z]/i.test(c) ? c.toUpperCase() : '#'; }
    if (sort === 'most') return w.lookups >= 5 ? '查过 5 次以上' : w.lookups >= 2 ? `查过 ${w.lookups} 次` : w.lookups === 1 ? '查过 1 次' : '没在这里查过';
    const t = favTime(w);
    if (!t) return '没有时间';
    const y = +t.slice(0, 4), m = +t.slice(5, 7);
    return y === new Date().getFullYear() ? `${m} 月` : `${y} 年 ${m} 月`;
  }

  function compute() {
    // 今天要复习 = what today's review will actually show (same rule and new-card quota as the 复习 tab)
    const rq = app.words.reviewQueue(app.settings().newPerDay);
    const dueSet = new Set([...rq.due, ...rq.fresh].map(e => e.slug));
    const cur = curOf();
    const ask = (fn, w, d) => { try { return cur && cur[fn] ? cur[fn](w) || d : d; } catch (e) { return d; } };
    const favs = app.words.favorites();
    try {
      facts = WB.buildFacts({ entries: favs, kv: app.kv, events, curriculum: cur, intake: () => (typeof app.intake === 'function' ? app.intake() : null), now: new Date() });
    } catch (e) { facts = WB.buildFacts({ entries: favs, curriculum: cur }); }
    const all = favs.map(e => {
      const s = summary(e);
      s.level = WB.levelOf(e, facts);
      s.srcs = WB.sourcesOf(e, facts);
      Object.assign(s, WB.flagsOf(e, facts));
      s.isDue = dueSet.has(e.slug);
      s.isNew = !!(e.fsrs && e.fsrs.state === State.New);
      s.unit = e.unit || ask('unitOf', e.headword, '');
      s.tier = e.tier || ask('tierOf', e.headword, 'extra');
      s.order = Number.isFinite(e.order) ? e.order : 1e9;
      return s;
    });
    const counts = { all: all.length, new: 0, learning: 0, mastered: 0, due: 0, relook: 0, dueOld: rq.due.length, dueNew: rq.fresh.length, src: {} };
    for (const w of all) {
      counts[w.mastery]++; if (w.isDue) counts.due++; if (w.relookups > 0) counts.relook++;
      for (const x of w.srcs) counts.src[x.kind] = (counts.src[x.kind] || 0) + 1;
    }
    const q = query;
    const inUnit = w => !unit || (unit === 'extra' ? !w.unit : w.unit === unit);
    const inFilter = w => filter === 'all' || (filter === 'due' && w.isDue) || (filter === 'relook' && w.relookups > 0) ||
      (filter === 'shaky' && w.shaky) || (filter === 'fading' && w.fading) || (filter === 'week' && w.week) ||
      (filter.startsWith('lv:') && w.level === filter.slice(3));
    const list = all.filter(w =>
      (q || inFilter(w)) &&
      (q || inUnit(w)) &&
      (q || !src || w.srcs.some(x => x.kind === src)) &&
      (!q || String(w.headword).toLowerCase().includes(q) || String(w.brief_cn || '').toLowerCase().includes(q)));
    if (q) {
      // a search ranks words that start with what was typed first
      const starts = w => (String(w.headword).toLowerCase().startsWith(q) ? 0 : 1);
      list.sort((a, b) => starts(a) - starts(b) || String(a.headword).localeCompare(String(b.headword), 'en', { sensitivity: 'base' }));
    } else if (inUnitOrder()) {
      list.sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3) || (sort === 'old' ? b.order - a.order : a.order - b.order));
    } else if (filter === 'fading' && (sort === 'new' || sort === 'old')) {
      list.sort((a, b) => a.r - b.r);
    } else if (sort === 'az') list.sort((a, b) => String(a.headword).localeCompare(String(b.headword), 'en', { sensitivity: 'base' }));
    else if (sort === 'most') list.sort((a, b) => b.lookups - a.lookups || b.relookups - a.relookups || String(b.last_lookup || '').localeCompare(String(a.last_lookup || '')));
    else list.sort((a, b) => sort === 'new' ? favTime(b).localeCompare(favTime(a)) : favTime(a).localeCompare(favTime(b)));
    return { all, list, counts };
  }

  // ---------------------------------------------------------------- render
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); renderMore(); } }), { rootMargin: '400px 0px' })
    : null;

  // the right slot: a small note (新词 / 晚 3 天 / 查 5 次 / ↻2) and a dot when it is in today's review
  function rowNote(w) {
    if (sort === 'most' && !query) return `查 ${w.lookups} 次`;
    if (filter === 'due' && !query) {
      if (w.isNew) return '新词';
      const late = Math.floor((Date.now() - new Date(w.due)) / DAY);
      if (late >= 1) return `晚 ${late} 天`;
    }
    return w.relookups ? `↻${w.relookups}` : '';
  }
  function rowNode(w) {
    const note = rowNote(w);
    const hw = String(w.headword);
    const pre = query && hw.toLowerCase().startsWith(query) ? hw.slice(0, query.length) : '';
    const on = selecting && picked.has(w.slug);
    const from = (w.srcs || [])[0];
    return h('button', { type: 'button', className: 'word-row wb-row' + (selecting ? ' picking' : '') + (on ? ' picked' : ''), dataset: { slug: w.slug },
      'aria-pressed': selecting ? String(on) : null, on: { click: ev => rowTap(w.slug, ev.currentTarget) } },
      selecting ? h('span', { className: 'wb-tick', 'aria-hidden': 'true' }, on ? icon('check') : null) : null,
      h('span', { className: 'w', lang: 'en' }, pre ? [h('b', { text: pre }), h('span', { className: 'rest', text: hw.slice(pre.length) })] : hw),
      h('span', { className: 'g' }, w.brief_cn, from ? h('span', { className: 'wb-row-src', text: from.label }) : null),
      h('span', { className: 'wb-lv wb-lv-' + (w.level || 'new'), title: '掌握到哪一档', text: WB.LEVELS[w.level || 'new'] }),
      note || w.isDue ? h('span', { className: 'end' },
        note ? h('span', { className: 'note', title: w.relookups && note.startsWith('↻') ? `收藏后又查了 ${w.relookups} 次` : null, text: note }) : null,
        w.isDue ? h('span', { className: 'dot', role: 'img', 'aria-label': '今天要复习' }) : null) : null);
  }

  function renderMore(upto = 0) {
    const old = listEl.querySelector('.more');
    if (old) old.remove();
    const end = Math.min(rows.length, Math.max(upto, shown + LIB_CHUNK));
    const frag = document.createDocumentFragment();
    let prev = shown ? groupKey(rows[shown - 1]) : null;
    for (let i = shown; i < end; i++) {
      const w = rows[i], g = query ? '' : groupKey(w);
      if (!query && g !== prev) {
        frag.append(h('div', { className: 'group', id: 'G-' + g }, h('h2', { text: g }), h('span', { className: 'n num', text: String(groupCounts.get(g) || '') })));
        prev = g;
      }
      frag.append(rowNode(w));
    }
    shown = end;
    if (shown < rows.length) {
      const left = rows.length - shown;
      const more = h('button', { type: 'button', className: 'more text-btn accent', text: `还有 ${left} 个，再显示 ${Math.min(LIB_CHUNK, left)} 个`, on: { click: () => renderMore() } });
      frag.append(more);
      if (io) io.observe(more);
    }
    listEl.append(frag);
  }

  const arrow = () => icon('chev');
  function render({ keep = false } = {}) {
    dirty = false;
    renderUnits();
    const keepShown = keep ? shown : 0;
    const { all, list, counts } = compute();
    renderSources(counts);
    const wl = WB.weekLine(app.words.favorites(), facts);
    weekEl.textContent = wl;
    weekEl.hidden = !wl;
    rows = list;
    shown = 0;
    groupCounts = new Map();
    if (!query) for (const w of rows) { const g = groupKey(w); groupCounts.set(g, (groupCounts.get(g) || 0) + 1); }
    listEl.replaceChildren();
    listEl.classList.toggle('az', sort === 'az' && !query);
    countEl.textContent = all.length.toLocaleString('en-US');
    listView.classList.toggle('empty-lib', !all.length);
    syncSearch();
    // the line under the filters: how many words this filter holds (and, for today's review, the split)
    if ((filter !== 'all' || unit || src) && !query && all.length) {
      const label = [unit ? (unit === 'extra' ? '课外' : (unitEl.querySelector('.f.on') || {}).textContent || unit) : '',
        filter !== 'all' ? FILTERS.find(f => f[0] === filter)[1] : '', src ? WB.SOURCE_ZH[src] : ''].filter(Boolean).join(' · ');
      const quick = !selecting && filter !== 'due' && filter !== 'all' && rows.length
        ? h('button', { type: 'button', className: 'text-btn accent', on: { click: () => startPractice(rows.slice(0, WB.PRACTICE_QUICK).map(w => w.slug)) } },
          rows.length > WB.PRACTICE_QUICK ? `练前 ${WB.PRACTICE_QUICK} 个` : '练一下这些', arrow()) : null;
      // replaceChildren would print a null as the text "null": only real nodes go in
      summaryEl.replaceChildren(...[
        h('span', {}, h('b', { className: 'num', text: String(rows.length) }), ' 个词',
          filter === 'due' ? ` · 到期 ${counts.dueOld} · 新词 ${counts.dueNew}` : ` · ${label}`),
        filter === 'due' && rows.length ? h('button', { type: 'button', className: 'text-btn accent', on: { click: () => app.go('home') } }, '去今天的课', arrow()) : quick].filter(Boolean));
      summaryEl.hidden = false;
    } else summaryEl.hidden = true;
    if (!all.length) {
      listEl.append(h('section', { className: 'lib-empty' },
        h('p', { className: 'lede', text: '单词本还是空的。' }),
        h('p', { className: 'small', text: '课本的词由家长导进来。查词时点“加进单词本”，词也会记在这里。' }),
        h('div', { className: 'lib-empty-actions' },
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => app.showTab('look') } }, '去查一个词', arrow()),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => openAdd() } }, '自己加一个词', arrow()))));
    } else if (!rows.length) {
      listEl.append(query
        ? h('section', { className: 'none', 'aria-live': 'polite' },
          h('p', { className: 't' }, '单词本里没有 ', h('span', { className: 'serif', lang: 'en', text: searchEl.value.trim() }), '。'),
          h('p', { className: 'small', text: '可能还没收藏，也可能拼错了。' }),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => app.lookup(searchEl.value.trim()) } }, '去查这个词', arrow()))
        : h('p', { className: 'none small', text: '没有符合条件的词。' }));
    } else {
      if (query) listEl.append(h('p', { className: 'small count-line' }, h('span', { className: 'num', text: String(rows.length) }), '\u00a0个词'));
      renderMore(keepShown);
      if (query && /^[A-Za-z][A-Za-z '’.-]*$/.test(searchEl.value.trim())) {
        listEl.append(h('p', { className: 'find' }, h('button', { type: 'button', className: 'text-btn accent', on: { click: () => app.lookup(searchEl.value.trim()) } },
          '在词典里查“', h('span', { lang: 'en', text: searchEl.value.trim() }), '”', arrow())));
      }
    }
    pickBtn.hidden = !all.length;
    syncPick();
    renderThumbs();
  }

  // ---------------------------------------------------------------- A–Z thumb index
  function renderThumbs() {
    const az = sort === 'az' && !query;
    const present = new Set(az ? rows.map(groupKey) : []);
    thumbs.replaceChildren(...(az ? LETTERS.map(L => h('span', { className: present.has(L) ? 'has' : 'off', dataset: { l: L }, text: L })) : []));
    syncThumbs();
  }
  function syncThumbs() {
    thumbs.hidden = !(sort === 'az' && !query && rows.length > 30 && app.currentRoute() === 'lib' && !stack.length);
    if (!thumbs.hidden) placeIndex();
  }
  // centred in the space the list really has: from the bottom of the controls (or the running head) to the tab bar
  function placeIndex() {
    const head = top.getBoundingClientRect().bottom;
    const ctrl = controls.getBoundingClientRect().bottom;
    thumbs.style.top = Math.max(head, ctrl + 8) + 'px';
    markCurrent();
  }
  function markCurrent() {
    if (thumbs.hidden) return;
    const head = top.getBoundingClientRect().bottom;
    let cur = '';
    for (const g of listEl.querySelectorAll('.group')) { if (g.getBoundingClientRect().top <= head + 2) cur = g.id.slice(2); else break; }
    if (!cur) { const first = listEl.querySelector('.group'); cur = first ? first.id.slice(2) : ''; }
    for (const s of thumbs.children) s.classList.toggle('cur', s.dataset.l === cur);
  }
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (thumbs.hidden) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(placeIndex);
  }, { passive: true });

  function jump(L) {
    const idx = rows.findIndex(w => groupKey(w) === L);
    if (idx < 0) return;
    if (idx >= shown) renderMore(idx + 60);
    const g = document.getElementById('G-' + L);
    if (g) window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - top.getBoundingClientRect().bottom + 1, behavior: 'auto' });
  }
  // drag along the index like the iOS contacts list; a big serif letter shows in the margin while the finger is down
  let lastL = '';
  const pick = ev => {
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const L = t && t.dataset && t.dataset.l;
    if (L && t.classList.contains('has')) {
      if (L !== lastL) { lastL = L; jump(L); }
      loupe.textContent = L;
      loupe.hidden = false;
      // the jump scrolls the controls away and the index moves up with them: place the loupe after that
      placeIndex();
      const cur = thumbs.querySelector(`[data-l="${L}"]`);
      if (cur) loupe.style.top = (cur.getBoundingClientRect().top + 8 - 36) + 'px';
      for (const s of thumbs.children) s.classList.toggle('cur', s.dataset.l === L);
    }
  };
  thumbs.addEventListener('pointerdown', ev => { lastL = ''; try { thumbs.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } thumbs.classList.add('active'); pick(ev); ev.preventDefault(); });
  thumbs.addEventListener('pointermove', ev => { if (thumbs.classList.contains('active')) pick(ev); });
  const endDrag = () => { thumbs.classList.remove('active'); loupe.hidden = true; };
  thumbs.addEventListener('pointerup', endDrag);
  thumbs.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- sources, picking (wordbook.js)
  function renderSources(counts) {
    const kinds = WB.SOURCES.filter(([k]) => counts.src[k] > 0);
    if (src && !kinds.some(([k]) => k === src)) src = '';
    srcEl.hidden = kinds.length < 2;
    if (srcEl.hidden) { srcEl.replaceChildren(); return; }
    const chip = (k, label) => h('button', { type: 'button', className: 'f' + (k === src ? ' on' : ''), role: 'tab', 'aria-selected': String(k === src),
      dataset: { src: k }, text: label, on: { click: () => { src = k; render(); window.scrollTo(0, 0); } } });
    srcEl.replaceChildren(chip('', '全部来源'), ...kinds.map(([k, label]) => chip(k, label)));
  }
  function syncPick() {
    pickBar.hidden = !selecting;
    listView.classList.toggle('wb-selecting', selecting);
    pickBtn.textContent = selecting ? '不选了' : '选几个练一下';
    pickCount.textContent = picked.size ? `选了 ${picked.size} 个` : `点词来选，最多 ${WB.PRACTICE_MAX} 个`;
    pickGo.disabled = !picked.size;
    pickGo.textContent = picked.size ? `练这 ${picked.size} 个` : '开始练';
  }
  function setSelecting(on) {
    selecting = !!on;
    if (!selecting) picked.clear();
    syncPick();
    render({ keep: true });
  }
  function rowTap(slug, btn) {
    if (!selecting) { openCard(slug); return; }
    if (picked.has(slug)) picked.delete(slug);
    else if (picked.size >= WB.PRACTICE_MAX) { app.toast(`一次最多练 ${WB.PRACTICE_MAX} 个。`); return; }
    else picked.add(slug);
    const on = picked.has(slug);
    btn.classList.toggle('picked', on);
    btn.setAttribute('aria-pressed', String(on));
    const tick = btn.querySelector('.wb-tick');
    if (tick) tick.replaceChildren(...(on ? [icon('check')] : []));
    syncPick();
  }
  async function loadEvents(force = false) {
    if (!force && Date.now() - eventsAt < 30000) return;
    eventsAt = Date.now();
    try {
      const since = new Date(Date.now() - EVENT_DAYS * DAY).toISOString().slice(0, 10);
      events = await app.events.query({ since, type: ['answer', 'dictation', 'ask'] });
    } catch (e) { events = []; }
    dirty = true;
    if (app.currentRoute() === 'lib' && !stack.length) render({ keep: true });
    else if (stack[stack.length - 1] === 'card' && cardSlug) drawCard(cardSlug);
  }

  // ---------------------------------------------------------------- pushed screens (a stack)
  const viewEl = { card: cardV.el, detail: detailView, practice: practiceV.el, add: addV.el };
  function showTop() {
    const topName = stack[stack.length - 1] || '';
    listView.hidden = !!topName;
    for (const [k, el] of Object.entries(viewEl)) el.hidden = k !== topName;
    syncThumbs();
    app.chrome();
  }
  function push(name) {
    if (!stack.length) listScroll = window.scrollY;
    const at = stack.indexOf(name);
    if (at >= 0) { for (const n of stack.splice(at)) if (n !== name) drop(n); }
    stack.push(name);
    showTop();
    window.scrollTo(0, 0);
  }
  function drop(name) {
    if (name === 'detail') { app.voice.stop(); if (detail) { app.unregisterView(detail); detail.destroy(); detail = null; } detailView.replaceChildren(); }
    if (name === 'practice') {
      if (practice) practice.stop();
      practice = null;
      if (busyHeld) { busyHeld = false; try { app.busy(-1); } catch (e) { /* ignore */ } }
      practiceV.body.replaceChildren();
      loadEvents(true);
    }
    if (name === 'card') cardV.body.replaceChildren();
    if (name === 'add') addV.body.replaceChildren();
  }
  function closeTop() {
    const name = stack.pop();
    if (!name) return;
    drop(name);
    showTop();
    const below = stack[stack.length - 1];
    if (below === 'card' && cardSlug) drawCard(cardSlug);
    if (!stack.length) {
      if (dirty) render({ keep: true });
      window.scrollTo(0, listScroll);
    } else window.scrollTo(0, 0);
  }
  function closeAll() { while (stack.length) { drop(stack.pop()); } showTop(); if (dirty) render({ keep: true }); window.scrollTo(0, listScroll); }

  // the word's card: 读音、课本里的意思、从哪来、她遇见过的句子、错过几次
  let cardSlug = '';
  function drawCard(slug) {
    const e = app.words.get(slug);
    if (!e) return false;
    cardSlug = slug;
    compute();   // fresh facts: a practice or a lesson may have just changed them
    WB.renderCard(cardV.body, app, e, facts, { onPractice: slugs => startPractice(slugs), onFull: s => openDetail(s) });
    return true;
  }
  function openCard(slug) {
    if (!drawCard(slug)) return;
    push('card');
  }

  function openAdd() {
    if (selecting) setSelecting(false);
    const v = WB.renderAdd(addV.body, app, {
      onAdded: slug => { dirty = true; closeTop(); openCard(slug); },
      onClose: () => closeTop(),
      onOpen: slug => { closeTop(); openCard(slug); },
    });
    push('add');
    setTimeout(() => v.focus(), 60);
  }

  async function startPractice(slugs) {
    const list = [...new Set(slugs)].filter(s => app.words.get(s));
    if (!list.length) return;
    if (selecting) { selecting = false; picked.clear(); syncPick(); dirty = true; }
    if (practice) drop('practice');
    practiceV.body.replaceChildren(h('p', { className: 'small wb-loading', text: '准备一下…' }));
    push('practice');
    if (!busyHeld) { busyHeld = true; try { app.busy(+1); } catch (e) { /* ignore */ } }
    try {
      practice = await WB.createPractice(practiceV.body, app, { slugs: list, onExit: ({ again } = {}) => {
        if (again && again.length) { startPractice(again); return; }
        closeTop();
      } });
    } catch (err) {
      console.warn('wordbook: practice:', (err && err.message) || err);
      app.toast('这会儿练不了，等一下再试。');
      closeTop();
    }
  }
  document.addEventListener('keydown', ev => {
    if (practice && stack[stack.length - 1] === 'practice' && app.currentRoute() === 'lib') practice.onKey(ev);
  });

  // ---------------------------------------------------------------- detail (the old word page, from the card's 看完整讲解)
  function openDetail(slug) {
    const e = app.words.get(slug);
    if (!e) return;
    if (detail) { app.unregisterView(detail); detail.destroy(); }
    const fromCard = stack[stack.length - 1] === 'card';
    detail = createEntryView(app, { where: 'lib', back: { label: fromCard ? e.headword : '单词', onClick: () => closeTop() } });
    detailView.replaceChildren(detail.el);
    app.registerView(detail);
    detail.show(e, {});
    push('detail');
    if (!hasExtras(e) || e.needs_core) app.words.enrich(e.slug).catch(() => {});
  }

  return {
    show() { if (dirty && !stack.length) render({ keep: true }); syncThumbs(); loadEvents(); },
    hide() { thumbs.hidden = true; loupe.hidden = true; if (practice && practice.inSession()) closeAll(); },
    onChange() {
      dirty = true;
      if (app.currentRoute() === 'lib' && !stack.length) {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => render({ keep: true }), 80);
      }
    },
    inDetail: () => stack.length > 0,
    isPushed: () => stack.length > 0,
    inSession: () => !!(practice && practice.inSession()),
    back: () => closeTop(),
  };
}
