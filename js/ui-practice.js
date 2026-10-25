// 接着练的界面（Wei 10-25，第 6 批）：最上面一句老师推荐的下一件事和一个大按钮，下面一排随时能点的入口。
// 点了就在 document.body 上盖一层全屏（.pr-screen，和课文陪读一样不占路由），做一小轮（3-5 分钟），做完给一句具体的反馈和
// “再来一轮 / 换一个 / 今天够了”。不限次数。逻辑在 practice.js，样式 css/practice.css（类名 pr-）。
// 负责：接着练 agent。
//
// 导出
//   createPracticeHub(ctx, { root? }) -> Hub
//     Hub = { el, mount(container, { compact }), refresh(), start(kind, params), show(params), hide(), inSession(), holding(), onKey(ev) }
//     mount：把“接着练”中心画进 container（首页课上完以后、收尾页）。compact: true 只画那排入口（首页还没上课时放在下面）。
//       同一个 Hub 可以 mount 到不同的地方，后一次替换前一次。
//     refresh()：重新算推荐和入口上的小字（onChange、回到首页时调）。
//     start(kind, params)：直接开始一小轮；kind 是 practice.js KINDS 之一。dictation / revise / chat 直接 ctx.go 过去。
//       params：grammar 的 { cardId }（不给先出选卡页）、read 的 { option }（readOptions 的一项）。
//     show(params)：params.start 给了就 start(params.start, params)，否则只 refresh。
//     hide()：拿掉那一层（换页时 app.js 调，和 textread 一样）；inSession()：正在做一小轮；holding() 永远 false（没有要保存的输入）。
//   ctx 用到：kv、words（favorites、get、review）、curriculum、say、events（log、sessionId、query）、go、toast、busy、fetchJSON、
//     dict、voice（stop）；题型照它们原来的要求。
import { h, icon } from './ui-dom.js';
import * as P from './practice.js';
import * as G from './grammar.js';
import * as M from './mistakes.js';
import * as R from './reader.js';
import { pickModes } from './wordbook.js';

const safe = (f, d) => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
const quiet = p => { if (p && typeof p.catch === 'function') p.catch(() => {}); return p; };
const MODE_FILES = { mc4: ['./modes/choice.js', 'choiceMode'], listen: ['./modes/listen.js', 'listenMode'], tiles: ['./modes/spell.js', 'spellMode'], cloze: ['./modes/cloze.js', 'clozeMode'] };
const EVENT_MODE = { mc4: 'mc4', listen: 'listen', spell: 'tiles', tiles: 'tiles', cloze: 'cloze', card: 'card', keys: 'keys' };
const ENTRY_ICON = { read: 'book', words: 'cards', mistakes: 'pen', grammar: 'note', dictation: 'pen', revise: 'check', chat: 'chat' };

// modules written in parallel (daily-read.js) or loaded on demand: a missing file never stops the page
const optional = new Map();
function optionalModule(path) {
  if (!optional.has(path)) optional.set(path, import(path).catch(() => null));
  return optional.get(path);
}
const fnOf = (m, ...names) => { for (const n of names) if (m && typeof m[n] === 'function') return m[n]; return null; };

export function createPracticeHub(ctx = {}, { root = null } = {}) {
  const kv = ctx.kv;
  const log = ev => safe(() => quiet(ctx.events && ctx.events.log ? ctx.events.log(ev) : null), null);
  const sidNow = () => safe(() => ctx.events.sessionId(), '');
  const say = (t, b) => safe(() => ctx.say && ctx.say(t, b || null));
  let host = null, compact = false;
  let overlay = null, stage = null, headLabel = null;
  let ctl = null;            // the running round's controller { onKey, stop }
  let round = null;          // { kind, sid, t0, params, finished }
  let busyOn = false;
  let events = [];           // recent answers (14 days), for 刚答错的词 and the 误解
  let passages = null;       // 期中阅读小篇, loaded once
  let daily = null;          // daily-read.js: today's reading, if the module is there
  let lastKind = '';
  const el = h('section', { className: 'pr-hub', 'aria-label': '接着练' });

  const setBusy = on => { if (on === busyOn) return; busyOn = on; safe(() => ctx.busy && ctx.busy(on ? +1 : -1)); };

  // ---------------------------------------------------------------- data that needs loading
  function loadAsync() {
    const since = P.dayOf(new Date(Date.now() - 14 * 864e5));
    const q = safe(() => ctx.events.query({ since, type: 'answer', limit: 2000 }), null);
    if (q && typeof q.then === 'function') q.then(list => { events = Array.isArray(list) ? list : []; draw(); }).catch(() => {});
    if (!passages) {
      passages = [];
      quiet(R.loadPassages({ fetchJSON: ctx.fetchJSON }).then(list => { passages = (list || []).map((p, i) => ({ id: p.id, label: p.label || `期中阅读 · 第 ${i + 1} 篇`, minutes: 5, raw: p })); draw(); }));
    }
    optionalModule('./daily-read.js').then(m => {
      const f = fnOf(m, 'todayRead', 'nextRead', 'dailyRead');
      if (!f) return;
      Promise.resolve(safe(() => f(ctx, new Date()), null)).then(d => { daily = d && d.id ? d : null; draw(); }).catch(() => {});
    });
  }
  const stories = () => safe(() => { const names = kv.peek(R.NAMES_KEY, null); return (names ? R.contentWith(names) : null) || R.content(); }, null);
  const opts = (exclude = []) => ({ exclude, events, content: safe(() => G.content(), null), stories: stories(), passages: passages || [], bank: safe(() => M.bank(), null), daily });

  // ---------------------------------------------------------------- the hub (recommendation + entries)
  function entryNote(kind, now) {
    if (kind === 'words') { const n = P.fadingWords(safe(() => ctx.words.favorites(), []), now).length; return n ? `${n} 个快忘了` : ''; }
    if (kind === 'mistakes') { const s = safe(() => M.summary(kv, now), { open: 0, due: 0 }); return s.due ? `${s.due} 道到日子了` : s.open ? `${s.open} 道没攻克` : '还没有'; }
    if (kind === 'grammar') { const m = P.grammarMissed(kv, now)[0]; const c = G.content(); return m && c && c.card(m.cardId) ? `${P.cardName(c.card(m.cardId))}刚错过` : ''; }
    if (kind === 'read') return daily && !daily.done ? '今天的还没读' : '';
    return '';
  }
  function entries(now) {
    return h('div', { className: 'pr-entries' }, P.KINDS.map(kind => {
      const note = entryNote(kind, now);
      return h('button', { type: 'button', className: 'pr-entry', on: { click: () => start(kind) } },
        icon(ENTRY_ICON[kind] || 'chev'), h('span', { className: 'pr-entry-name', text: P.ENTRY_ZH[kind] }), note ? h('span', { className: 'pr-entry-note', text: note }) : null);
    }));
  }
  function nudgeLine(now) {
    const m = P.todayMinutes(kv, now);
    return m >= P.NUDGE_MIN ? h('p', { className: 'pr-nudge', text: `今天已经练了 ${m} 分钟。够了，明天见。想再练也可以。` }) : null;
  }
  function hubView({ compactView = false, exclude = [] } = {}) {
    const now = new Date();
    if (compactView) {
      return h('div', { className: 'pr-hub-in compact' }, h('p', { className: 'pr-label', text: '随时能练' }), entries(now));
    }
    const rec = P.recommendNext(ctx, now, opts(exclude));
    return h('div', { className: 'pr-hub-in' },
      h('p', { className: 'pr-label', text: '接着练 · 老师推荐' }),
      h('p', { className: 'lede pr-title', text: rec.title }),
      rec.why ? h('p', { className: 'pr-why', text: rec.why }) : null,
      h('button', { type: 'button', className: 'btn pr-go', text: rec.cta, on: { click: () => start(rec.kind, rec.params) } }),
      nudgeLine(now),
      h('p', { className: 'pr-label pr-label-2', text: '或者自己选' }),
      entries(now));
  }
  function draw() {
    if (!host) return;
    el.replaceChildren(hubView({ compactView: compact }));
  }
  function mount(container, { compact: c = false } = {}) {
    host = container || root;
    compact = !!c;
    if (host) { host.replaceChildren(el); draw(); loadAsync(); }
    return el;
  }

  // ---------------------------------------------------------------- the layer
  function open(label) {
    if (!overlay) {
      headLabel = h('p', { className: 'pr-head-label' });
      stage = h('div', { className: 'pr-stage' });
      overlay = h('div', { className: 'pr-screen', role: 'dialog', 'aria-label': '接着练' },
        h('div', { className: 'pr-col' },
          h('header', { className: 'pr-head' }, headLabel,
            h('button', { type: 'button', className: 'text-btn pr-quit', on: { click: () => quit() } }, '不练了')),
          stage));
      safe(() => document.body.append(overlay));
    }
    overlay.hidden = false;
    headLabel.textContent = label;
    return stage;
  }
  function close() {
    stopCtl();
    if (overlay) { safe(() => overlay.remove()); overlay = null; stage = null; }
    setBusy(false);
    draw();
  }
  function stopCtl() { if (ctl && typeof ctl.stop === 'function') safe(() => ctl.stop()); ctl = null; safe(() => ctx.voice && ctx.voice.stop && ctx.voice.stop()); }
  function quit() {
    if (round && !round.finished) finishRound({ n: 0, right: 0 }, { early: true });
    close();
  }

  // ---------------------------------------------------------------- one round
  function begin(kind, params = {}) {
    const sid = sidNow();
    round = { kind, sid, t0: Date.now(), params, finished: false };
    setBusy(true);
    log({ type: 'session_start', kind: 'practice', practice: kind, sid, hour: new Date().getHours(), step: P.STEP });
    return round;
  }
  async function finishRound(res, { early = false, ref = '', slugs = null, feedback = null } = {}) {
    if (!round || round.finished) return null;
    const r = round;
    r.finished = true;
    const ms = Date.now() - r.t0;
    log({ type: 'session_end', sid: r.sid, step: P.STEP, practice: r.kind, min: Math.round(ms / 6e4), steps_done: res.n ? [r.kind] : [], completed: !early });
    await P.noteRound(kv, { kind: r.kind, ms, n: res.n, right: res.right, ref, slugs }, new Date());
    lastKind = r.kind;
    setBusy(false);
    if (!early) showFeedback(r, feedback || P.feedbackLine(r.kind, res));
    return r;
  }
  async function showFeedback(r, fb) {
    stopCtl();
    if (!stage) return;
    const now = new Date();
    const nudge = P.shouldNudge(kv, now);
    if (nudge) await P.markNudged(kv, now);
    const minutes = P.todayMinutes(kv, now);
    const again = h('button', { type: 'button', className: nudge ? 'text-btn accent' : 'btn pr-big', on: { click: () => start(r.kind, r.kind === 'grammar' ? { cardId: r.params.cardId } : {}) } }, '再来一轮');
    const enough = h('button', { type: 'button', className: nudge ? 'btn pr-big' : 'text-btn accent', on: { click: () => { close(); safe(() => ctx.toast && ctx.toast('明天见。')); } } }, '今天够了');
    const other = h('button', { type: 'button', className: 'text-btn accent', on: { click: () => switchView(r.kind) } }, '换一个');
    stage.replaceChildren(h('div', { className: 'pr-done' },
      h('p', { className: 'lede', text: fb.head }),
      fb.detail ? h('p', { className: 'pr-detail', text: fb.detail }) : null,
      nudge ? h('p', { className: 'pr-nudge', text: `今天练了 ${minutes} 分钟了，很棒。今天够了，明天见。` }) : null,
      h('div', { className: 'pr-actions' }, nudge ? [enough, again, other] : [again, other, enough])));
    headLabel.textContent = '这一轮做完了';
  }
  function switchView(kind) {
    stopCtl();
    if (!stage) return;
    headLabel.textContent = '换一个';
    stage.replaceChildren(hubView({ exclude: [kind] }));
  }

  // ---------------------------------------------------------------- kinds
  function start(kind, params = {}) {
    if (P.LINK_KINDS[kind]) {
      close();
      safe(() => ctx.go(P.LINK_KINDS[kind], {}));
      return;
    }
    stopCtl();
    round = null;
    if (kind === 'words') return startWords();
    if (kind === 'mistakes') return startMistakes();
    if (kind === 'grammar') return params.cardId ? startGrammar(params.cardId, params.why) : pickCard();
    if (kind === 'read') return startRead(params.option);
    return null;
  }

  // 练我不熟的词
  async function startWords() {
    const st = open(P.ENTRY_ZH.words);
    const now = new Date();
    const done = P.readDay(kv, now).rounds.filter(r => r.kind === 'words').flatMap(r => r.slugs || []);
    const slugs = P.weakWords(safe(() => ctx.words.favorites(), []), now, { exclude: done, events });
    if (!slugs.length) {
      st.replaceChildren(h('div', { className: 'pr-done' }, h('p', { className: 'lede', text: '现在没有不熟的词。' }),
        h('p', { className: 'pr-detail', text: '单词本里的词都记得挺好。去读一篇，或者问老师。' }),
        h('div', { className: 'pr-actions' }, h('button', { type: 'button', className: 'btn pr-big', on: { click: () => switchView('words') } }, '换一个'))));
      return;
    }
    const r = begin('words');
    st.replaceChildren(h('p', { className: 'small pr-wait', text: '稍等……' }));
    ctl = await wordRound(st, slugs, r.sid, res => finishRound({ n: res.right.length + res.again.length, right: res.right.length }, { slugs,
      feedback: P.feedbackLine('words', { right: res.right.map(word), again: res.again.map(word) }) }));
  }
  const word = s => safe(() => ctx.words.get(s).headword, s) || s;

  async function wordRound(st, slugs, sid, onEnd) {
    const mods = {};
    for (const [k, [file, name]] of Object.entries(MODE_FILES)) {
      try { const m = await import(file); mods[k] = m[name] || null; if (k === 'tiles') mods.canSpell = m.canSpell; } catch (e) { mods[k] = null; }
    }
    const list = slugs.map(s => safe(() => ctx.words.get(s), null)).filter(e => e && e.favorited);
    const canSpell = e => !!safe(() => mods.canSpell && mods.canSpell(e, ctx.curriculum), false);
    const queue = pickModes(list, { canSpell, single: list.length === 1 });
    const total = queue.length;
    const results = new Map();   // slug -> { first, mode, hint }
    const retried = new Set();
    let cur = null, view = null, stopped = false, n = 0;
    const pool = (() => { const seen = new Set(), out = []; for (const e of [...list, ...safe(() => ctx.words.favorites(), [])]) if (e && e.brief_cn && !seen.has(e.slug)) { seen.add(e.slug); out.push(e); } return out; })();
    const unitOf = e => (e && e.unit) || safe(() => ctx.curriculum.unitOf(e.headword), '') || undefined;
    const box = h('div', { className: 'pr-card' });
    const foot = h('div', { className: 'pr-card-foot' });
    st.replaceChildren(box, foot);
    function next() {
      if (stopped) return;
      cur = queue.shift();
      if (!cur) { end(); return; }
      const e = safe(() => ctx.words.get(cur.slug), null);
      if (!e) { next(); return; }
      cur.t = Date.now(); cur.answered = false;
      const base = { app: ctx, pool, say, position: { n: n + 1, total: Math.max(total, n + queue.length + 1), isNew: false }, rate: g => rated(g), onAnswer: ev => answered(e, ev) };
      view = null;
      for (const m of [cur.want, 'mc4']) {
        const mode = mods[m];
        if (!mode) continue;
        view = safe(() => mode.render(e, base), null);
        if (view && view.el) { cur.mode = EVENT_MODE[view.eventMode && view.modeId !== 'mc4' ? view.eventMode : view.modeId] || EVENT_MODE[m] || 'mc4'; break; }
      }
      if (!view || !view.el) { n++; next(); return; }
      box.replaceChildren(view.el);
      foot.replaceChildren(...[].concat(view.footer || []).filter(Boolean));
    }
    function answered(e, ev) {
      log({ type: 'answer', step: P.STEP, sid, unit: unitOf(e), ...ev });
      if (!cur || ev.slug !== cur.slug || cur.answered) return;
      cur.answered = true;
      const clean = !!ev.correct && ev.first_try !== false && !(ev.hint_level > 0);
      const prev = results.get(cur.slug);
      results.set(cur.slug, { first: prev ? prev.first && clean : clean, mode: cur.mode, hint: !!(ev.hint_level > 0) });
    }
    function rated(g) {
      if (!cur || stopped) return;
      const c = cur;
      if (!c.answered) {
        const e = safe(() => ctx.words.get(c.slug), null);
        log({ type: 'answer', step: P.STEP, sid, item: 'w:' + c.slug, slug: c.slug, unit: unitOf(e), mode: 'card', choice: String(g), correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
        if (!results.has(c.slug)) results.set(c.slug, { first: g >= 3, mode: 'card' });
      }
      n++;
      if (g <= 1 && results.has(c.slug)) results.set(c.slug, { ...results.get(c.slug), first: false });
      if (g <= 1 && !retried.has(c.slug)) { retried.add(c.slug); queue.push({ slug: c.slug, want: 'mc4' }); }
      cur = null;
      next();
    }
    async function end() {
      if (stopped) return;
      stopped = true;
      // into the review: a word missed is rated 1 (it comes back in the next warm-up); a word that was due anyway gets its
      // rating; a word not due and right is left alone, so a free round never moves the schedule forward
      const eod = new Date(); eod.setHours(23, 59, 59, 999);
      for (const [slug, r] of results) {
        const e = safe(() => ctx.words.get(slug), null);
        if (!e || !e.favorited) continue;
        const due = !!(e.fsrs && e.fsrs.due && new Date(e.fsrs.due) <= eod);
        const g = !r.first ? 1 : due ? (r.hint ? 2 : 3) : 0;
        if (g) { try { await ctx.words.review(slug, g, r.mode || 'mc4'); } catch (err) { /* the round still counts */ } }
      }
      const right = [], again = [];
      for (const [slug, r] of results) (r.first ? right : again).push(slug);
      onEnd({ right, again });
    }
    next();
    return { onKey: ev => { if (view && typeof view.onKey === 'function' && !stopped) view.onKey(ev); }, stop: () => { stopped = true; } };
  }

  // 错题再练
  async function startMistakes() {
    const st = open(P.ENTRY_ZH.mistakes);
    const now = new Date();
    const done = P.readDay(kv, now).rounds.filter(r => r.kind === 'mistakes').flatMap(r => r.slugs || []);
    const items = P.openMistakes(kv, now, { exclude: done });
    if (!items.length) {
      st.replaceChildren(h('div', { className: 'pr-done' }, h('p', { className: 'lede', text: '错题本里没有要再练的题。' }),
        h('p', { className: 'pr-detail', text: '作业或卷子上有错题，拍下来，老师帮你讲。' }),
        h('div', { className: 'pr-actions' },
          h('button', { type: 'button', className: 'btn pr-big', on: { click: () => { close(); safe(() => ctx.go('mistakes', { take: true })); } } }, '拍一道错题'),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => switchView('mistakes') } }, '换一个'))));
      return;
    }
    const mod = await optionalModule('./ui-mistakes.js');
    const render = fnOf(mod, 'renderMistakeReview');
    if (!render) { st.replaceChildren(h('p', { className: 'pr-detail', text: '错题这会儿打不开，换一个练吧。' })); return; }
    const r = begin('mistakes');
    const ids = items.map(x => x.id);
    const before = new Map(ids.map(id => [id, safe(() => M.loadRecord(kv, id), null)]));
    st.replaceChildren();
    ctl = render(st, ctx, { items, sid: r.sid, step: P.STEP, onDone: ({ results = [], right = 0 } = {}) => {
      let conquered = 0, left = 2;
      for (const id of ids) {
        const a = safe(() => M.loadRecord(kv, id), null), b = before.get(id);
        if (a && a.mastered && !(b && b.mastered)) conquered++;
        else if (a && !a.mastered) left = Math.min(left, Math.max(1, M.WIN_TARGET - (a.wins || 0)));
      }
      finishRound({ n: results.length, right }, { slugs: ids, feedback: P.feedbackLine('mistakes', { n: results.length, right, conquered, left }) });
    } });
  }

  // 语法闯关：选一张卡（或老师帮我选）
  function pickCard() {
    const st = open(P.ENTRY_ZH.grammar);
    const now = new Date();
    const c = G.content();
    if (!c) {
      st.replaceChildren(h('p', { className: 'small pr-wait', text: '稍等……' }));
      quiet(G.loadGrammar({ fetchJSON: ctx.fetchJSON }).then(() => pickCard(), () => st.replaceChildren(h('p', { className: 'pr-detail', text: '语法卡这会儿打不开，换一个练吧。' }))));
      return;
    }
    const auto = P.grammarAuto(kv, now, { content: c, events });
    const rows = P.cardList(kv, now, { content: c });
    st.replaceChildren(h('div', { className: 'pr-pick' },
      auto ? h('div', { className: 'pr-auto' },
        h('p', { className: 'lede', text: `老师帮你选：${P.cardName(c.card(auto.cardId))}` }),
        h('p', { className: 'pr-why', text: auto.why }),
        h('button', { type: 'button', className: 'btn pr-big', on: { click: () => startGrammar(auto.cardId, auto.why) } }, '就练这张')) : null,
      h('p', { className: 'pr-label pr-label-2', text: '或者自己挑一张' }),
      h('ul', { className: 'pr-cards' }, rows.map(x => h('li', null,
        h('button', { type: 'button', className: 'pr-cardrow', on: { click: () => startGrammar(x.id) } },
          h('span', { className: 'pr-cardrow-t', text: x.title }),
          h('span', { className: 'pr-cardrow-s' + (x.missed ? ' hot' : ''), text: x.missed ? '刚错过' : x.due ? '该复习了' : x.statusZh }),
          icon('chev')))))));
  }
  function startGrammar(cardId, why = '') {
    const st = open(P.ENTRY_ZH.grammar);
    const c = G.content();
    const card = c && c.card(cardId);
    if (!card) { pickCard(); return; }
    const name = P.cardName(card);
    headLabel.textContent = `语法闯关 · ${name}`;
    const now = new Date();
    const state = G.normState(kv.peek(G.kvKey(cardId), null), cardId);
    const plan = P.cardRound(state, now);
    optionalModule('./ui-grammar.js').then(UG => {
      if (!UG) { st.replaceChildren(h('p', { className: 'pr-detail', text: '语法卡这会儿打不开，换一个练吧。' })); return; }
      const r = begin('grammar', { cardId });
      if (plan.part) {
        ctl = UG.renderGrammarCard(st, ctx, { cardId, part: plan.part, sid: r.sid, step: P.STEP, doneLabel: '好了', why, onDone: res => {
          const s = (res && res.stats) || {};
          const n = (s.right || 0) + (s.fuzzy || 0) + (s.failed || 0);
          finishRound({ n, right: s.right || 0 }, { ref: cardId, feedback: P.feedbackLine('grammar', { name, n, right: s.right, fuzzy: s.fuzzy, failed: s.failed, part: plan.part }) });
        } });
        return;
      }
      const items = P.grammarItems(card, state, now);
      if (!items.length) { finishRound({ n: 0, right: 0 }, { early: true }); st.replaceChildren(h('p', { className: 'pr-detail', text: '这张卡今天的题都做过了，换一张吧。' })); return; }
      ctl = UG.renderGrammarItem(st, ctx, { items, sid: r.sid, step: P.STEP, autoNextMs: 0, onDone: res => {
        const list = (res && res.results) || [];
        const right = list.filter(x => x.clean).length, failed = list.filter(x => !x.passed).length;
        finishRound({ n: list.length, right }, { ref: cardId, feedback: P.feedbackLine('grammar', { name, n: list.length, right, fuzzy: list.length - right - failed, failed }) });
      } });
    });
  }

  // 再读一篇：每日阅读 → 期中阅读小篇 → 再读番外 → 下一集
  async function startRead(option = null) {
    const st = open(P.ENTRY_ZH.read);
    const now = new Date();
    let opt = option;
    if (!opt) {
      if (!R.content()) { try { await R.loadStories({ fetchJSON: ctx.fetchJSON }); } catch (e) { /* passages may still be there */ } }
      opt = P.readOptions(kv, now, { stories: stories(), passages: passages || [], daily, lessonDone: P.lessonDone(kv, now) })[0] || null;
    }
    if (!opt) {
      st.replaceChildren(h('div', { className: 'pr-done' }, h('p', { className: 'lede', text: '今天能读的都读过了。' }),
        h('p', { className: 'pr-detail', text: '明天有新的。想读课本，可以拍一页课文让老师陪你读。' }),
        h('div', { className: 'pr-actions' }, h('button', { type: 'button', className: 'btn pr-big', on: { click: () => switchView('read') } }, '换一个'))));
      return;
    }
    headLabel.textContent = opt.label;
    const r = begin('read', { option: opt });
    const doneRead = res => {
      const list = (res && res.results) || [];
      const n = list.length, right = list.filter(x => x && x.clean).length;
      const label = opt.kind === 'episode' ? `第 ${safe(() => stories().episode(opt.id).n, '')} 集` : opt.label;
      finishRound({ n: res && res.done ? Math.max(1, n) : 0, right }, { ref: opt.id, feedback: P.feedbackLine('read', { done: !!(res && res.done), n, right, label }) });
    };
    if (opt.kind === 'daily') {
      // 0.8.0 接线: the screen is in ui-daily-read.js (daily-read.js is the logic)
      const m = await optionalModule('./ui-daily-read.js');
      const render = fnOf(m, 'renderDailyRead', 'renderRead');
      if (render) { ctl = render(st, ctx, { id: opt.id, sid: r.sid, step: P.STEP, doneLabel: '好了', onDone: doneRead }); return; }
    }
    const UR = await optionalModule('./ui-reader.js');
    if (!UR) { st.replaceChildren(h('p', { className: 'pr-detail', text: '阅读这会儿打不开，换一个练吧。' })); return; }
    if (opt.kind === 'passage') {
      const p = (passages || []).find(x => x.id === opt.id);
      ctl = UR.renderPassage(st, ctx, { passage: p ? p.raw : null, id: opt.id, mode: 'read', listen: true, label: opt.label, sid: r.sid, step: P.STEP, doneLabel: '好了', onDone: doneRead });
      return;
    }
    ctl = UR.renderEpisode(st, ctx, { episodeId: opt.id, again: !!opt.again, sid: r.sid, step: P.STEP, doneLabel: '好了', onDone: doneRead });
  }

  return {
    el,
    mount,
    refresh: draw,
    start,
    show(params = {}) { if (params && params.start) start(params.start, params); else draw(); },
    hide() { if (round && !round.finished) quiet(finishRound({ n: 0, right: 0 }, { early: true })); close(); },
    inSession: () => !!(overlay && round && !round.finished),
    holding: () => false,
    onKey(ev) { if (ctl && typeof ctl.onKey === 'function') return ctl.onKey(ev); return false; },
    get lastKind() { return lastKind; },
  };
}
