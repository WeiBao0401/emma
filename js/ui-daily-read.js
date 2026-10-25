// 每日阅读的界面（daily-read.js 的逻辑；阅读器 ui-reader.js 的 renderPassage / renderEpisode 来读）。样式 css/daily-read.css（类名 dr-）。
// 负责：每日阅读 agent。
//
// 导出
//   renderDailyRead(container, ctx, { onDone, sid?, step = 'read', doneLabel = '接着上课', now?, passages? }) -> { el, onKey, stop }
//     今天有写好没读的一篇：直接用 renderPassage 读（先听后读、点词、看不懂三下、做题）；
//     老师还在写：显示“老师在写今天的阅读”，写好了自动换上；可以“先读一篇现成的”；
//     没写成（没网、失败、预算到了）：现成的顶上（番外下一集用 renderEpisode，期中阅读小篇用 renderPassage）。
//     读完：daily.settleRead（目标词进单词本、句型进复习、记事件），再一屏：这篇对你来说“太简单 / 正好 / 太难”（kid-me recordFeedback，part 'read'）、
//     “再来一篇”（今天最多 3 篇）、doneLabel。点 doneLabel 调 onDone({ done: true, id, daily: true | false, fallback?, added, queued })。
//     passages：期中阅读小篇 [Ep]（不给就按需 R.loadPassages）。测试钩子：fetchImpl、sleep、pollMs。
//   createDailyRead(ctx, { root? }) -> { open(params), show(params), hide(), inSession(), holding(), el }
//     首页“接着练”用：没给 root 在 document.body 上盖一层全屏（.dr-screen，右上角“关上”）；给了 root 就画进去，“关上”调 ctx.back()。
//     open({ more: true }) 先写“再来一篇”再读。
//   ctx 用到：kv、settings()、mockForced()、budget、events、words、toggleFav、say、voice、dict、curriculum、fetchJSON、toast、kidError、back、busy
import { h, icon, skBars } from './ui-dom.js';
import * as D from './daily-read.js';
import * as R from './reader.js';

const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(x => x !== null && x !== undefined && x !== false && x !== ''));
const isMock = ctx => !!safe(() => ((ctx.settings && ctx.settings()) || {}).mock, false) || !!safe(() => ctx.mockForced && ctx.mockForced(), false);

export function renderDailyRead(container, ctx = {}, opts = {}) {
  const { onDone = () => {}, step = 'read', doneLabel = '接着上课', fetchImpl = null, sleep = undefined, pollMs = 3000 } = opts;
  const nowOf = () => (opts.now ? new Date(opts.now) : new Date());
  const sid = opts.sid || safe(() => (ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''), '');
  const mock = isMock(ctx);
  const shell = h('div', { className: 'dr' });
  container.replaceChildren(shell);
  const st = { stopped: false, reader: null, timer: null, keyHandler: null };
  const stopReader = () => { if (st.reader && st.reader.stop) safe(() => st.reader.stop()); st.reader = null; };
  const clearTimer = () => { if (st.timer) clearTimeout(st.timer); st.timer = null; };
  const kidSays = err => safe(() => (ctx.kidError ? ctx.kidError(err, { where: 'lesson' }) : ''), '') || '这篇没写好，先读一篇现成的。';
  const state = () => D.dayState(mock ? null : ctx.kv, nowOf(), { mock });
  const head = (sub = '') => h('div', { className: 'dr-head' },
    h('p', { className: 'dr-kicker' }, '今天的阅读'), sub ? h('p', { className: 'dr-sub small' }, sub) : null);

  // ------------------------------------------------ the generated piece
  function readPiece(piece) {
    clearTimer();
    stopReader();
    const box = h('div', { className: 'dr-reader' });
    fill(shell, head(`${piece.topic ? piece.topic.zh + ' · ' : ''}第 ${piece.n} 篇${piece.mock ? ' · 模拟' : ''}`), box);
    import('./ui-reader.js').then(UR => {
      if (st.stopped) return;
      st.reader = UR.renderPassage(box, ctx, {
        passage: piece.passage, id: piece.id, mode: 'read', listen: true, label: '今天的阅读', sid, step, doneLabel: '读完了',
        onDone: async res => {
          if (res && res.done === false) { fallbackView('这篇打不开，先读一篇现成的。'); return; }
          stopReader();
          const out = await D.settleRead(ctx, piece, res || {}, { now: nowOf(), step, sid }).catch(() => ({ added: [], queued: [] }));
          endView({ id: piece.id, daily: true, ...out, readAloud: (res && Array.isArray(res.readAloud) ? res.readAloud : []) });
        },
      });
    }).catch(() => fallbackView('阅读器没打开，先读一篇现成的。'));
  }

  // ------------------------------------------------ the teacher is still writing
  function waitView(note = '') {
    stopReader();
    clearTimer();
    fill(shell, head(),
      h('div', { className: 'dr-wait' },
        h('p', { className: 'lede' }, '老师在写今天的阅读。'),
        h('p', { className: 'small' }, note || '大约一分钟。写好了这里自动换上。'),
        skBars([90, 70, 82])),
      h('div', { className: 'rd-actions' },
        h('button', { type: 'button', className: 'text-btn accent dr-fb-go', on: { click: () => fallbackView('') } }, '先读一篇现成的')));
    const tick = () => {
      if (st.stopped) return;
      const s = state();
      if (s.ready) { readPiece(s.ready); return; }
      if (!s.writing) { s.pieces.length ? doneDayView() : fallbackView('今天的还没写好，先读这篇。'); return; }
      st.timer = setTimeout(tick, pollMs);
    };
    st.timer = setTimeout(tick, pollMs);
  }

  // ------------------------------------------------ nothing written: something ready-made
  async function fallbackView(note) {
    clearTimer();
    stopReader();
    let passages = opts.passages || null;
    if (!passages) passages = await R.loadPassages({ fetchJSON: ctx.fetchJSON }).catch(() => []);
    if (!R.content() && ctx.fetchJSON) await R.loadStories({ fetchJSON: ctx.fetchJSON }).catch(() => null);
    if (st.stopped) return;
    const fb = D.pickFallback({ kv: ctx.kv, content: R.content(), passages, now: nowOf() });
    if (!fb) {
      fill(shell, head(), h('p', { className: 'lede' }, '今天的阅读还没准备好。'),
        h('div', { className: 'rd-actions' }, h('button', { type: 'button', className: 'btn', on: { click: () => onDone({ done: false, daily: false }) } }, doneLabel)));
      return;
    }
    const box = h('div', { className: 'dr-reader' });
    fill(shell, head(note || '先读一篇现成的'), box);
    const UR = await import('./ui-reader.js').catch(() => null);
    if (!UR || st.stopped) return;
    const finish = async res => {
      stopReader();
      await D.settleFallback(ctx, fb, res || {}, { now: nowOf(), step, sid });
      endView({ id: fb.kind === 'story' ? fb.episodeId : fb.id, daily: false, fallback: fb.kind, added: [], queued: [], readAloud: (res && Array.isArray(res.readAloud) ? res.readAloud : []) });
    };
    st.reader = fb.kind === 'story'
      ? UR.renderEpisode(box, ctx, { episodeId: fb.episodeId, again: !!fb.again, sid, step, doneLabel: '读完了', onDone: finish })
      : UR.renderPassage(box, ctx, { passage: fb.passage, id: fb.id, mode: 'read', listen: true, label: '期中阅读', sid, step, doneLabel: '读完了', onDone: finish });
  }

  // ------------------------------------------------ after reading
  function moreButton() {
    const s = state();
    if (!s.canMore) return null;
    const b = h('button', { type: 'button', className: 'text-btn accent dr-more', on: { click: () => more(b) } }, '再来一篇');
    return b;
  }
  async function more(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '老师在写……'; }
    const job = D.another(ctx, { now: nowOf(), fetchImpl, ...(sleep ? { sleep } : {}) });
    waitView('再写一篇，大约一分钟。');
    try {
      const piece = await job;
      if (!st.stopped) readPiece(piece);
    } catch (e) {
      if (st.stopped) return;
      if (e && e.code === 'limit') { doneDayView(); return; }
      fallbackView(kidSays(e));
    }
  }
  function endView(res) {
    clearTimer();
    const fbRow = h('div', { className: 'dr-feel' }, h('p', { className: 'rd-label' }, '这篇对你来说'),
      h('div', { className: 'dr-feel-btns' }, [['easy', '太简单'], ['ok', '正好'], ['hard', '太难']].map(([id, zh]) => h('button', {
        type: 'button', className: 'text-btn dr-feel-btn', on: { click: async ev => {
          const row = ev.currentTarget.parentNode;
          for (const b of row.children) b.disabled = true;
          ev.currentTarget.classList.add('on');
          try { const KM = await import('./kid-me.js'); await KM.recordFeedback(ctx, { part: 'read', choice: id, from: 'button', sid, item: D.EVENT_PREFIX + res.id, mode: 'read' }); } catch (e) { /* fine */ }
          note.textContent = id === 'easy' ? '记下了，明天写长一点。' : id === 'hard' ? '记下了，明天写短一点、简单一点。' : '好，明天还这样。';
        } } }, zh))));
    const note = h('p', { className: 'small dr-feel-note' });
    const added = (res.added || []).length ? h('p', { className: 'dr-added' }, `${res.added.join('、')} 进了单词本，热身里会再见到。`) : null;
    fill(shell, head(), h('div', { className: 'dr-end' },
      h('p', { className: 'lede' }, res.daily ? '今天的阅读读完了。' : '这篇读完了。'),
      added, fbRow, note,
      h('div', { className: 'rd-actions' }, moreButton(),
        h('button', { type: 'button', className: 'btn dr-done', on: { click: () => onDone({ done: true, ...res }) } }, doneLabel))));
  }
  function doneDayView() {
    const s = state();
    fill(shell, head(), h('div', { className: 'dr-end' },
      h('p', { className: 'lede' }, s.readCount ? `今天读了 ${s.readCount} 篇。` : '今天的阅读写好了。'),
      h('div', { className: 'rd-actions' }, moreButton(),
        h('button', { type: 'button', className: 'btn dr-done', on: { click: () => onDone({ done: true, daily: true, already: true }) } }, doneLabel))));
  }

  // ------------------------------------------------ start
  const s0 = state();
  if (s0.ready) readPiece(s0.ready);
  else if (s0.writing) waitView();
  else if (opts.more && s0.canMore) more(null);
  else if (s0.pieces.length) doneDayView();
  else {
    // nothing yet today: start writing in the background, read something ready-made meanwhile only if writing cannot start
    const online = !(globalThis.navigator && navigator.onLine === false);
    if (online || mock) {
      D.prepare(ctx, { now: nowOf(), fetchImpl, ...(sleep ? { sleep } : {}) }).then(p => { if (!p && !st.stopped && !D.writing(s0.date) && !state().ready) fallbackView('今天的还没写好，先读这篇。'); });
      if (D.writing(s0.date)) waitView(); else setTimeout(() => { if (!st.stopped && D.writing(s0.date)) waitView(); }, 0);
    } else fallbackView('现在没网，先读一篇现成的。');
  }

  return {
    el: shell,
    onKey: ev => { if (st.reader && st.reader.onKey) st.reader.onKey(ev); },
    stop: () => { st.stopped = true; clearTimer(); stopReader(); },
  };
}

export function createDailyRead(ctx = {}, { root = null } = {}) {
  let overlay = null, host = null, ctl = null, open_ = false;
  function mount() {
    if (root) { host = root; return host; }
    if (!overlay) { overlay = h('div', { className: 'dr-screen', role: 'dialog', 'aria-label': '今天的阅读' }); document.body.append(overlay); }
    overlay.hidden = false;
    host = overlay;
    safe(() => document.documentElement.classList.add('dr-open'));
    return host;
  }
  function hide() {
    if (ctl) safe(() => ctl.stop());
    ctl = null;
    open_ = false;
    if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
    safe(() => document.documentElement.classList.remove('dr-open'));
  }
  function close() { hide(); if (root) safe(() => ctx.back && ctx.back()); }
  function open(params = {}) {
    hide();
    const el = mount();
    const bar = h('div', { className: 'dr-bar' }, h('button', { type: 'button', className: 'text-btn dr-close', 'aria-label': '关上', on: { click: close } }, icon('close')));
    const body = h('div', { className: 'dr-page' });
    el.replaceChildren(bar, body);
    open_ = true;
    ctl = renderDailyRead(body, ctx, { ...params, doneLabel: '关上', onDone: () => close() });
    return ctl;
  }
  return { open, show: params => open(params || {}), hide, inSession: () => open_, holding: () => false, get el() { return host; } };
}
