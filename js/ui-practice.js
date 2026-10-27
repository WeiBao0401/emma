// 接着练的界面（Wei 10-25，第 6 批）：最上面一句老师推荐的下一件事和一个大按钮，下面一排随时能点的入口。
// 点了就在 document.body 上盖一层全屏（.pr-screen，和课文陪读一样不占路由），做一小轮（3-5 分钟），做完给一句具体的反馈和
// “再来一轮 / 换一个 / 今天够了”。不限次数。逻辑在 practice.js，样式 css/practice.css（类名 pr-）。
// 负责：接着练 agent。
//
// 导出
//   createPracticeHub(ctx, { root? }) -> Hub
//     Hub = { el, mount(container, { compact, card, onClose }), refresh(), start(kind, params), show(params), hide(), inSession(), holding(), onKey(ev) }
//     mount：把“接着练”中心画进 container（收尾页）。compact: true 只画那排入口。
//       card: true（0.9.0 首页第三张卡“接着练”）：只画老师推荐的一句、为什么、一个“开始”和约几分钟；“今天的阅读”有自己的卡，
//       所以这里先不推“再读一篇”（实在没别的可推才推）。compact 在卡片里是“不是首推”：按钮用描边的，不用实心的。
//       卡片下面那行小入口（练不熟的词、错题、语法、听写、复习考试）首页自己画，点了调 start(kind)。
//       onClose：盖的那一层关上以后调一次（首页拿它重画三张卡）。
//       同一个 Hub 可以 mount 到不同的地方，后一次替换前一次。
//     refresh()：重新算推荐和入口上的小字（onChange、回到首页时调）。
//     start(kind, params)：直接开始一小轮；kind 是 practice.js KINDS 之一。dictation / revise / chat 直接 ctx.go 过去。
//       params：grammar 的 { cardId }（不给先出选卡页）、read 的 { option }（readOptions 的一项）。
//     show(params)：params.start 给了就 start(params.start, params)，否则只 refresh。
//     hide()：拿掉那一层（换页时 app.js 调，和 textread 一样）；inSession()：正在做一小轮；holding() 永远 false（没有要保存的输入）。
//   ctx 用到：kv、words（favorites、get、review）、curriculum、say、events（log、sessionId、query）、go、toast、busy、fetchJSON、
//     dict、voice（stop）；题型照它们原来的要求。
//
// 0.9.4 按单元练（Wei 10-27：要背下来、会写）：中心页那排入口里多一个“按单元练”（.pr-entry-unit，排在“练我不熟的词”后面；
//   不在 practice.js KINDS 里，所以 .pr-entry 还是原来 7 个）。start('unit') 先出选单元页：每个单元一行，课本 kv 里的名字和
//   “会写 N / M 个”，现在学的那个标“在学”；start('unit', { unit }) 直接开这个单元。一轮 10 个词（practice.js unitPick / unitQueue）：
//   字母块用 pos.js posSpellMode（题面“n. 名词：写出这个名词”），首字母填空用 modes/cloze.js clozeMode（上面同样加一行词性），
//   看中文选英文用 modes/choice.js choiceMode（direction 'zh2en'），词性题用 pos.js renderPos（wordItem）。
//   写错了（不是一下就对）给一屏巧记（word-notes.js memoryOf + ui-entry.js memoryBlock，点“记住了”往下走）；选错了巧记挂在题下面。
//   主线做完，写错、选错的再考一遍（写的用字母块，选的照样选）。FSRS 照“练我不熟的词”：错了评 1，本来就到期又一下就对评 3 / 2，
//   别的不评；词性题不评。作答照各题型原来的格式记（step 'practice'），session_start 多 unit。
//   收尾一句（写了几个、写对几个、哪几个还要再练），旁边“分享给妈妈”：import('./share.js') 的 shareButton(ctx, { scope: 'today' })，
//   文件没有或出错就不显示。题型模块都按需加载，少一个也不报错。
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
const WRITE_MODES = new Set(['tiles', 'cloze', 'keys']);
const arr = v => (Array.isArray(v) ? v : []);

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
  let host = null, compact = false, cardMode = false, onClosed = null;
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
    const list = P.KINDS.map(kind => {
      const note = entryNote(kind, now);
      return h('button', { type: 'button', className: 'pr-entry', on: { click: () => start(kind) } },
        icon(ENTRY_ICON[kind] || 'chev'), h('span', { className: 'pr-entry-name', text: P.ENTRY_ZH[kind] }), note ? h('span', { className: 'pr-entry-note', text: note }) : null);
    });
    // 0.9.4 按单元练, right after 练我不熟的词
    const unit = h('button', { type: 'button', className: 'pr-entry-unit', on: { click: () => start(P.UNIT_KIND) } },
      icon('pen'), h('span', { className: 'pr-unit-name', text: P.ENTRY_ZH.unit }), h('span', { className: 'pr-unit-note', text: '选一个单元，写 10 个词' }));
    const at = P.KINDS.indexOf('words');
    list.splice(at >= 0 ? at + 1 : list.length, 0, unit);
    return h('div', { className: 'pr-entries' }, list);
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
  // 0.9.0 the third card on 今天: one line of what the teacher picks next, why, one button. 今天的阅读 has its own card,
  // so reading goes to the back of the queue here (recommendNext still falls back to it when nothing else is left).
  function cardView({ primary = false } = {}) {
    const now = new Date();
    const rec = P.recommendNext(ctx, now, opts(['read']));
    const link = !!P.LINK_KINDS[rec.kind];
    return h('div', { className: 'pr-card-in' },
      h('p', { className: 'pr-card-title', text: rec.title }),
      rec.why ? h('p', { className: 'pr-card-why', text: rec.why }) : null,
      h('div', { className: 'pr-card-row' },
        h('button', { type: 'button', className: 'btn pr-card-go' + (primary ? '' : ' pr-quiet'), text: link ? '去看看' : rec.minutes ? `开始 · 约 ${rec.minutes} 分钟` : '开始',
          on: { click: () => start(rec.kind, rec.params) } })));
  }
  function draw() {
    if (!host) return;
    el.className = cardMode ? 'pr-hub pr-hub-card' : 'pr-hub';
    el.replaceChildren(cardMode ? cardView({ primary: !compact }) : hubView({ compactView: compact }));
  }
  function mount(container, { compact: c = false, card = false, onClose = null } = {}) {
    host = container || root;
    compact = !!c;
    cardMode = !!card;
    onClosed = typeof onClose === 'function' ? onClose : null;
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
    const had = !!overlay;
    if (overlay) { safe(() => overlay.remove()); overlay = null; stage = null; }
    setBusy(false);
    draw();
    if (had && onClosed) safe(() => onClosed());
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
    log({ type: 'session_start', kind: 'practice', practice: kind, sid, hour: new Date().getHours(), step: P.STEP, ...(params.unit ? { unit: String(params.unit) } : {}) });
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
    const againParams = r.kind === 'grammar' ? { cardId: r.params.cardId } : r.kind === P.UNIT_KIND ? { unit: r.params.unit } : {};
    const again = h('button', { type: 'button', className: nudge ? 'text-btn accent' : 'btn pr-big', on: { click: () => start(r.kind, againParams) } }, '再来一轮');
    const enough = h('button', { type: 'button', className: nudge ? 'btn pr-big' : 'text-btn accent', on: { click: () => { close(); safe(() => ctx.toast && ctx.toast('明天见。')); } } }, '今天够了');
    const other = h('button', { type: 'button', className: 'text-btn accent', on: { click: () => switchView(r.kind) } }, '换一个');
    // 0.9.4 按单元练: “分享给妈妈” next to the closing line (share.js, loaded on demand; missing or failing: not shown)
    const shareBox = r.kind === P.UNIT_KIND ? h('div', { className: 'pr-share', hidden: true }) : null;
    const doneEl = h('div', { className: 'pr-done' },
      h('p', { className: 'lede', text: fb.head }),
      fb.detail ? h('p', { className: 'pr-detail', text: fb.detail }) : null,
      shareBox,
      nudge ? h('p', { className: 'pr-nudge', text: `今天练了 ${minutes} 分钟了，很棒。今天够了，明天见。` }) : null,
      h('div', { className: 'pr-actions' }, nudge ? [enough, again, other] : [again, other, enough]));
    stage.replaceChildren(doneEl);
    headLabel.textContent = '这一轮做完了';
    if (shareBox) addShare(shareBox);
  }
  async function addShare(box) {
    try {
      const m = await optionalModule('./share.js');
      const fn = fnOf(m, 'shareButton');
      if (!fn) return;
      let node = await Promise.resolve(fn(ctx, { scope: 'today' }));
      if (node && !(node instanceof Node) && node.el instanceof Node) node = node.el;
      if (!node || !(node instanceof Node) || !box) return;
      box.replaceChildren(node);
      box.hidden = false;
    } catch (e) { /* no share button: the round is still done */ }
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
    if (kind === P.UNIT_KIND) return params.unit ? startUnit(String(params.unit)) : pickUnit();
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

  // ---------------------------------------------------------------- 0.9.4 按单元练
  // answers and dictation marks of the last 180 days: 会写了 (metDays) needs them, like the word book
  let unitEv = null, unitEvAt = 0;
  async function unitEvents() {
    if (unitEv && Date.now() - unitEvAt < 30000) return unitEv;
    const since = P.dayOf(new Date(Date.now() - 180 * 864e5));
    let list = [];
    try { const q = await (ctx.events && typeof ctx.events.query === 'function' ? ctx.events.query({ since, type: ['answer', 'dictation'] }) : []); list = Array.isArray(q) ? q : []; } catch (e) { list = []; }
    unitEv = list; unitEvAt = Date.now();
    return list;
  }
  const favs = () => safe(() => ctx.words.favorites(), []) || [];
  const curUnit = () => safe(() => (kv.peek('progress', {}) || {}).unit, '') || '';
  const wait = () => h('p', { className: 'small pr-wait', text: '稍等……' });
  // the question modes, the 词性 module and the 巧记 pieces; each one may be missing
  let unitMods = null;
  async function loadUnitMods() {
    if (unitMods) return unitMods;
    const [choice, spell, cloze, pos, entry, notes] = await Promise.all(['./modes/choice.js', './modes/spell.js', './modes/cloze.js', './pos.js', './ui-entry.js', './word-notes.js'].map(optionalModule));
    unitMods = { choice, spell, cloze, pos, entry, notes };
    return unitMods;
  }
  const settle = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(r, ms))]);

  async function pickUnit() {
    const st = open(P.ENTRY_ZH.unit);
    st.replaceChildren(wait());
    const evs = await unitEvents();
    if (st !== stage) return;
    const list = P.unitList(ctx.curriculum, favs(), { written: P.writtenNow(kv, evs), current: curUnit() });
    if (!list.length) {
      st.replaceChildren(h('div', { className: 'pr-done' }, h('p', { className: 'lede', text: '还没有课本单元的词。' }),
        h('p', { className: 'pr-detail', text: '家长在家长区导入课本以后，这里就能按单元练。' }),
        h('div', { className: 'pr-actions' }, h('button', { type: 'button', className: 'btn pr-big', on: { click: () => switchView(P.UNIT_KIND) } }, '换一个'))));
      return;
    }
    st.replaceChildren(h('div', { className: 'pr-pick' },
      h('p', { className: 'lede pr-unit-ask', text: '练哪个单元？' }),
      h('p', { className: 'pr-why', text: '一轮 10 个必会词，多半是看中文写英文。' }),
      h('ul', { className: 'pr-cards pr-units' }, list.map(u => h('li', null,
        h('button', { type: 'button', className: 'pr-cardrow pr-unitrow', on: { click: () => startUnit(u.id) } },
          h('span', { className: 'pr-cardrow-t', lang: 'en', text: u.title }),
          u.current ? h('span', { className: 'pr-unit-now', text: '在学' }) : null,
          h('span', { className: 'pr-cardrow-s pr-unit-count', text: u.note }),
          icon('chev')))))));
  }

  async function startUnit(unit) {
    const st = open(P.ENTRY_ZH.unit);
    const title = safe(() => ctx.curriculum.unitTitle(unit), '') || unit;
    headLabel.textContent = `按单元练 · ${title}`;
    st.replaceChildren(wait());
    const [evs, mods] = await Promise.all([unitEvents(), loadUnitMods()]);
    // the part-of-speech guide and the offline 巧记 (app.js loaded them at start; this only waits if it has not)
    await settle(Promise.all([mods.pos && typeof mods.pos.loadPos === 'function' ? mods.pos.loadPos(ctx) : null,
      mods.entry && typeof mods.entry.ensureNotes === 'function' ? mods.entry.ensureNotes(ctx) : null]), 1500);
    if (st !== stage) return;
    const now = new Date();
    const list = P.unitEntries(ctx.curriculum, unit, favs());
    const done = P.readDay(kv, now).rounds.filter(r => r.kind === P.UNIT_KIND && r.ref === unit).flatMap(r => r.slugs || []);
    const slugs = P.unitPick(list, { written: P.writtenNow(kv, evs), events: evs, now, exclude: done });
    const chosen = slugs.map(s => list.find(e => e.slug === s)).filter(Boolean);
    const tiles = (mods.pos && mods.pos.posSpellMode) || (mods.spell && mods.spell.spellMode) || null;
    const choice = mods.choice && mods.choice.choiceMode;
    if (!chosen.length || !choice) {
      st.replaceChildren(h('div', { className: 'pr-done' }, h('p', { className: 'lede', text: chosen.length ? '题目这会儿打不开。' : '这个单元还没有能练的词。' }),
        h('p', { className: 'pr-detail', text: '换一个单元，或者换一个练吧。' }),
        h('div', { className: 'pr-actions' },
          h('button', { type: 'button', className: 'btn pr-big', on: { click: () => pickUnit() } }, '换一个单元'),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: () => switchView(P.UNIT_KIND) } }, '换一个'))));
      return;
    }
    const cur = ctx.curriculum;
    let sources = [];
    if (mods.cloze && typeof mods.cloze.defaultSources === 'function') sources = safe(() => mods.cloze.defaultSources(ctx), []) || [];
    const canSpell = e => !!(tiles && mods.spell && safe(() => mods.spell.canSpell(e, cur), false));
    const canPos = e => !!(mods.pos && typeof mods.pos.renderPos === 'function' && safe(() => mods.pos.wordItem(e, { curriculum: cur }), null));
    // 首字母填空 only for a word with one part of speech: the sentence then uses it the way the cue says
    const canCloze = e => {
      if (!mods.cloze || !mods.cloze.clozeMode || !mods.pos || !sources.length) return false;
      const info = safe(() => mods.pos.posInfo(e, { curriculum: cur }), null);
      if (!info || !info.main || arr(info.all).length !== 1) return false;
      if (safe(() => mods.pos.shownPos(e, { curriculum: cur }), '') !== info.main) return false;
      return !!safe(() => mods.cloze.canCloze(e, sources, { curriculum: cur }), false);
    };
    const queue = P.unitQueue(chosen, { canSpell, canPos, canCloze });
    const r = begin(P.UNIT_KIND, { unit });
    const word = s => safe(() => ctx.words.get(s).headword, s) || s;
    ctl = unitRound(st, { unit, queue, pool: chosen, mods, tiles, choice, sources }, r.sid, res => {
      unitEvAt = 0;   // the next picker counts this round's answers
      finishRound({ n: res.n, right: res.right }, { ref: unit, slugs: chosen.map(e => e.slug),
        feedback: P.feedbackLine(P.UNIT_KIND, { title, written: res.written.map(word), wrote: res.wrote.map(word), again: res.again.map(word), posAgain: res.posAgain.map(word), fixed: res.fixed }) });
    });
  }

  function unitRound(st, { unit, queue: q0, pool: first = [], mods, tiles, choice, sources = [] }, sid, onEnd) {
    const queue = q0.map(x => ({ ...x }));
    const total = queue.length;
    const results = new Map();   // slug -> { kind: 'write' | 'choice', first, mode, hint }   the first time only
    const posRes = new Map();    // slug -> clean
    const retest = [];
    const fixed = new Set();
    const memoSeen = new Set();
    let again = false, cur = null, view = null, stopped = false, n = 0;
    const cue = curKind => {
      const zh = mods.pos && mods.pos.ZH ? mods.pos.ZH[curKind] : '', ab = mods.pos && mods.pos.ABBR ? mods.pos.ABBR[curKind] : '';
      return zh && ab && curKind !== 'aux' ? h('p', { className: 'spell-ask small pos-cue' }, h('i', { className: 'pos', lang: 'en', text: ab }), ` ${zh}：写出这个${zh}`) : null;
    };
    const pool = (() => { const seen = new Set(), out = []; for (const e of [...first, ...favs()]) if (e && e.brief_cn && !seen.has(e.slug)) { seen.add(e.slug); out.push(e); } return out; })();
    const unitOf = e => (e && e.unit) || safe(() => ctx.curriculum.unitOf(e.headword), '') || unit || undefined;
    const box = h('div', { className: 'pr-card' });
    const foot = h('div', { className: 'pr-card-foot' });
    st.replaceChildren(box, foot);
    const paint = (node, footer = []) => {
      box.replaceChildren(...(again ? [h('p', { className: 'small pr-again', text: '最后把刚才错的再做一遍。' })] : []), node);
      foot.replaceChildren(...footer);
    };
    function next() {
      if (stopped) return;
      cur = queue.shift() || null;
      if (!cur && !again && retest.length) {
        again = true;
        queue.push(...retest.splice(0));
        safe(() => { headLabel.textContent = '再做一遍刚才错的'; });
        cur = queue.shift();
      }
      if (!cur) { end(); return; }
      const e = safe(() => ctx.words.get(cur.slug), null);
      if (!e) { next(); return; }
      cur.t = Date.now(); cur.answered = false; cur.clean = true;
      if (cur.want === 'pos') { drawPos(e, cur); return; }
      const kind = cur.want === 'cloze' && mods.pos ? safe(() => mods.pos.shownPos(e, { curriculum: ctx.curriculum }), '') : '';
      const base = { app: ctx, pool, say, position: { n: n + 1, total: Math.max(total, n + queue.length + 1), isNew: false }, rate: g => rated(g),
        onAnswer: ev => answered(e, kind && ev && typeof ev === 'object' ? { ...ev, pos: kind } : ev) };
      if (cur.want === 'zh2en') base.direction = 'zh2en';
      const clozeMode = mods.cloze && mods.cloze.clozeMode;
      const tries = cur.want === 'cloze' ? [clozeMode, tiles, choice] : cur.want === 'tiles' ? [tiles, choice] : [choice];
      view = null;
      for (const mode of tries) {
        if (!mode) continue;
        view = safe(() => mode.render(e, base), null);
        if (view && view.el) break;
      }
      if (!view || !view.el) { n++; next(); return; }
      cur.mode = EVENT_MODE[view.eventMode && view.modeId !== 'mc4' ? view.eventMode : view.modeId] || 'mc4';
      cur.kind = WRITE_MODES.has(cur.mode) ? 'write' : 'choice';
      // the 首字母填空 card gets the same part-of-speech line as the tiles (n. 名词：写出这个名词)
      if (view.modeId === 'cloze' && kind) { const c = cue(kind); if (c) safe(() => view.el.replaceChildren(c, ...[...view.el.childNodes].filter(x => x !== c))); }
      paint(view.el, [].concat(view.footer || []).filter(Boolean));
    }
    function note(c, clean, hint) {
      if (!clean) c.clean = false;
      if (again) { if (clean) fixed.add(c.slug); return; }
      if (!results.has(c.slug)) results.set(c.slug, { kind: c.kind, first: clean, mode: c.mode, hint });
    }
    function answered(e, ev) {
      log({ type: 'answer', step: P.STEP, sid, unit: unitOf(e), ...ev });
      if (!cur || !ev || ev.slug !== cur.slug || cur.answered) return;
      cur.answered = true;
      note(cur, !!ev.correct && ev.first_try !== false && !(ev.hint_level > 0), !!(ev.hint_level > 0));
      // a wrong choice shows the right word already: its 巧记 goes right under it
      if (!ev.correct && cur.kind === 'choice') memoInline(e);
    }
    function rated(g) {
      if (!cur || stopped) return;
      const c = cur;
      const e = safe(() => ctx.words.get(c.slug), null);
      if (!c.answered) {
        // a card with no choices to tap (not enough distractors): her own 认得 / 没认出来 is the answer
        c.answered = true;
        log({ type: 'answer', step: P.STEP, sid, item: 'w:' + c.slug, slug: c.slug, unit: unitOf(e), mode: 'card', choice: String(g), correct: g >= 2, first_try: true, ms: Date.now() - c.t, hint_level: 0, misconception: null });
        note(c, g >= 3, false);
      }
      n++;
      if (g <= 1) note(c, false, false);
      if (!c.clean && !again) {
        const r = results.get(c.slug);
        if (r) r.first = false;
        retest.push({ slug: c.slug, want: c.kind === 'write' ? 'tiles' : 'zh2en' });
        // written wrong: one screen of 巧记 before the next word
        if (c.kind === 'write' && e && showMemo(e, () => { if (cur === c) { cur = null; next(); } })) return;
      }
      cur = null;
      next();
    }
    function drawPos(e, c) {
      const it = safe(() => mods.pos.wordItem(e, { curriculum: ctx.curriculum }), null);
      if (!it) { n++; cur = null; next(); return; }
      c.kind = 'pos';
      const holder = h('div', { className: 'pr-pos' });
      paint(holder);
      const v = safe(() => mods.pos.renderPos(holder, ctx, { items: [it], sid, step: P.STEP, onDone: res => {
        if (stopped || cur !== c) return;
        const r0 = arr(res && res.results)[0];
        if (r0 && !again) posRes.set(e.slug, !!r0.clean);
        n++;
        cur = null;
        next();
      } }), null);
      if (cur === c) view = v;
      if (!v && cur === c) { n++; cur = null; next(); }
    }
    function memoOf(e) {
      if (!e || !e.headword || !mods.notes || !mods.entry) return null;
      const m = safe(() => mods.notes.memoryOf(e, mods.entry.noteOf(ctx, e.headword)), null);
      return m && (arr(m.mem).length || m.trap || m.use) ? m : null;
    }
    function memoInline(e) {
      if (!e || memoSeen.has(e.slug) || !view || !view.el) return;
      const m = memoOf(e);
      const box2 = m ? safe(() => mods.entry.memoryBlock(ctx, m, { word: e.headword }), null) : null;
      if (!box2) return;
      memoSeen.add(e.slug);
      safe(() => { box2.classList.add('pr-memo-inline'); view.el.append(box2); });
    }
    function showMemo(e, then) {
      if (memoSeen.has(e.slug)) return false;
      const m = memoOf(e);
      const block = m ? safe(() => mods.entry.memoryBlock(ctx, m, { word: e.headword }), null) : null;
      if (!block) return false;
      memoSeen.add(e.slug);
      let gone = false;
      const go = () => { if (gone || stopped) return; gone = true; then(); };
      const pl = safe(() => mods.pos.posLine(e, { curriculum: ctx.curriculum }), null);
      const cn = safe(() => mods.choice.meaningOf(e), '') || m.cn || e.brief_cn || '';
      const hw = safe(() => mods.entry.headwordNode({ headword: e.headword }, { tag: 'p', syl: false }), null) || h('p', { className: 'pr-memo-word', lang: 'en', text: e.headword });
      const sb = safe(() => mods.entry.sayBtn(ctx, e.headword, '听一遍'), null);
      paint(h('article', { className: 'pr-memo' },
        h('p', { className: 'small pr-memo-why', text: '没关系，记一记。这一轮最后再写一遍。' }),
        h('div', { className: 'pr-memo-head' }, hw, sb),
        h('p', { className: 'pr-memo-cn' },
          pl && pl.abbr ? h('i', { className: 'pos', lang: 'en', text: pl.abbr }) : null,
          pl && pl.zh ? h('span', { className: 'pr-memo-pos', text: pl.zh }) : null,
          cn ? h('span', { text: cn }) : null),
        block,
        h('div', { className: 'pr-actions' }, h('button', { type: 'button', className: 'btn pr-big pr-memo-go', text: '记住了', on: { click: go } }))));
      view = { onKey: ev => { if (ev.metaKey || ev.ctrlKey || ev.altKey) return; if (ev.key === 'Enter' || ev.key === ' ') { if (ev.preventDefault) ev.preventDefault(); go(); } } };
      return true;
    }
    async function end() {
      if (stopped) return;
      stopped = true;
      // into the review, the rule of 练我不熟的词: wrong -> 1 (back in the next warm-up); due anyway and right -> 3 (2 with a
      // hint); not due and right -> left alone. 词性题 are not rated.
      const eod = new Date(); eod.setHours(23, 59, 59, 999);
      for (const [slug, r] of results) {
        const e = safe(() => ctx.words.get(slug), null);
        if (!e || !e.favorited) continue;
        const due = !!(e.fsrs && e.fsrs.due && new Date(e.fsrs.due) <= eod);
        const g = !r.first ? 1 : due ? (r.hint ? 2 : 3) : 0;
        if (g) { try { await ctx.words.review(slug, g, r.mode || 'mc4'); } catch (err) { /* the round still counts */ } }
      }
      const written = [], wrote = [], wrong = [];
      for (const [slug, r] of results) {
        if (r.kind === 'write') { written.push(slug); if (r.first) wrote.push(slug); }
        if (!r.first) wrong.push(slug);
      }
      const posAgain = [...posRes].filter(([, ok]) => !ok).map(([s]) => s);
      const right = [...results.values()].filter(r => r.first).length + [...posRes.values()].filter(Boolean).length;
      onEnd({ written, wrote, again: wrong, posAgain, fixed: fixed.size, n: results.size + posRes.size, right });
    }
    next();
    return { onKey: ev => { if (view && typeof view.onKey === 'function' && !stopped) view.onKey(ev); }, stop: () => { stopped = true; } };
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
