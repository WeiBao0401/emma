// 读一段的界面（DESIGN 5.6、5.5）：一集 = 读的方法 → 先听后读（逐句高亮，可以暂停、重听这句）→ 自己再读一遍（可选）
// → 读后题（提示阶梯、变式题、随时回原文）→ 收尾说出本集学的词，问一句“今天哪里最难？”。
// 逻辑都在 reader.js，这里只画。样式 css/reader.css（类名 rd-）。负责：阅读器 agent。
//
// 导出
//   renderEpisode(container, ctx, { episodeId, onDone, sid?, step = 'read', doneLabel = '接着上课', short?, again? }) -> Controller
//     把一集画进 container（会清空它）。episodeId 不给就读 nextEpisode(kv)。short：轻松版，只做 2 道题（R.shortQuestions：点出答案句那道在前，再一道选择题）。
//     again：已经读完的一集再读一遍（不给就看 kv：读完过的就是再读）。
//     做完点 doneLabel 调用 onDone({ episodeId, n, done: true, again, stats, results, words, passedWords, helps, taps, hard, triage })；
//     这一集打不开时 onDone({ episodeId, done: false })。hard 是“今天哪里最难？”的回答 id（没答是 null），triage 是这集今天卡住的次数。
//     测试用的两个钩子：speak(text) -> Promise（代替“读一句、等它读完”）、gap(i) -> 毫秒（句子之间停多久）。
//     ctx 用到：kv（'story:progress'、'read:triage'）、events.log、events.sessionId（没给 sid 时）、say、voice（busy / stop，用来一句一句读）、
//     dict、curriculum、words（get、favorite、importData）、toggleFav、toast、fetchJSON（第一次读 stories.json）。
//   renderPassage(container, ctx, { passage, onDone, mode = 'read' | 'questions', listen = false, label?, sid?, step = 'read', doneLabel }) -> Controller
//     0.5：期中阅读小篇、课文陪读用。passage 和 stories.json 的一集同一个格式（原样的，或 reader.js passageOf 过的）。
//     mode 'read' 先读后做题（listen: true 时老师先一句一句读），'questions' 只做题（原文一直开着）。
//     不写 'story:progress'（番外的进度），求助分诊照样记进 'read:triage'（按 passage.id）。
//     做完调用 onDone({ id, passage: true, done: true, stats, results, helps, taps, hard, triage, ms, hardSentences })；打不开时 onDone({ id, done: false })。
//     另认 id（passage 没写 id 时用）、onHelp(i, level)（每点一下“看不懂”）、onAnswer(qid, result)（每题做完，result 同 results 里的一条）。
//     句子带 unsure: true 的（课文陪读第二遍核对没对上），第 3 下不给中文，说“这句老师也拿不准，可以问问老师”。
//   两个 onDone 都另带 ms（从打开到做完）和 hardSentences: [{ i, en, zh, level }]（这次看了整句中文才懂的句子）。
//   Controller = { el, onKey(ev), stop() }   onKey：听的时候空格暂停 / 接着听，R 重听这句；做题时 1-4 / A-D 选，Enter 下一题。
//   stop()：离开上课页时调用，停掉朗读。
import { h, icon } from './ui-dom.js';
import * as R from './reader.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
// 答案是“Green.”。 the answer in curly quotes, so a full stop never runs into “。”
const endStop = t => `“${String(t)}”。`;
const hasCJK = s => /[㐀-鿿]/.test(String(s || ''));

function ensureContent(ctx) {
  const c = R.content();
  if (c) return Promise.resolve(c);
  return R.loadStories({ fetchJSON: ctx && ctx.fetchJSON });
}
function sidOf(ctx, sid) {
  if (sid) return sid;
  if (ctx && ctx.sid) return ctx.sid;
  try { return ctx && ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''; } catch (e) { return ''; }
}
function sayBtn(ctx, text, label = '听一遍') {
  if (!ctx || typeof ctx.say !== 'function' || !text) return null;
  return h('button', { type: 'button', className: 'say', 'aria-label': label, on: { click: ev => { ev.stopPropagation(); ctx.say(text, ev.currentTarget); } } }, icon('speak'));
}
const roleCls = r => (r === 'subject' ? 'rd-subj' : r === 'verb' ? 'rd-verb' : '');
// a sentence's tokens -> nodes; words are tap targets when tap is given; the subject and the verb (trunk) get their marks
function renderTokens(tokens, tap = null) {
  const out = [];
  let group = null, groupRole = null;
  const flush = () => { if (group) out.push(group); group = null; groupRole = null; };
  for (const t of tokens) {
    let node = t.text;
    if (t.word) {
      const inner = t.parts ? t.parts.map(p => (p.role ? h('span', { className: roleCls(p.role) }, p.text) : p.text)) : [t.text];
      if (tap) node = h('span', { className: 'rd-w', role: 'button', tabindex: '0', on: { click: ev => { if (ev && ev.stopPropagation) ev.stopPropagation(); tap(t.text); } } }, inner);
      else if (t.parts) node = h('span', null, inner);
    }
    const r = !t.parts && t.role ? t.role : null;
    if (r) {
      if (groupRole !== r) { flush(); group = h('span', { className: roleCls(r) }); groupRole = r; }
      group.append(node);
    } else { flush(); out.push(node); }
  }
  flush();
  return out;
}

function makeShell(container) {
  const body = h('div', { className: 'rd-body' }, h('p', { className: 'rd-wait small' }, '稍等……'));
  const card = h('div', { className: 'rd-card', hidden: true, role: 'dialog', 'aria-label': '这个词' });
  const shell = h('div', { className: 'rd-shell' }, body, card);
  container.replaceChildren(shell);
  const st = { stopped: false, keyHandler: null, cleanup: [] };
  const ctl = {
    el: shell,
    onKey: ev => { if (st.keyHandler) st.keyHandler(ev); },
    stop: () => { st.stopped = true; st.keyHandler = null; for (const f of st.cleanup.splice(0)) { try { f(); } catch (e) { /* ignore */ } } },
  };
  return { body, card, shell, st, ctl };
}
function failView(sh, text, onGo, label) {
  sh.body.replaceChildren(h('div', { className: 'rd' },
    h('p', { className: 'rd-wait small' }, text),
    h('div', { className: 'rd-actions' }, h('button', { type: 'button', className: 'btn', on: { click: onGo } }, label))));
}

export function renderEpisode(container, ctx, opts = {}) {
  const { episodeId = null, onDone = () => {}, doneLabel = '接着上课' } = opts;
  const sh = makeShell(container);
  const fail = (text, id) => failView(sh, text, () => onDone({ episodeId: id, done: false }), doneLabel);
  function open(c) {
    if (sh.st.stopped) return;
    // the names she picked for the girl and her cat (kv 'story:names') are swapped into the whole episode
    const named = (() => { try { return R.contentWith(ctx && ctx.kv && ctx.kv.peek ? ctx.kv.peek(R.NAMES_KEY, null) : null) || c; } catch (e) { return c; } })() || c;
    const ep = (named && (named.episode(episodeId) || (!episodeId && named.episode(R.nextEpisode(ctx && ctx.kv, { content: named }))))) || null;
    if (!ep) { fail('这一集还没准备好。', episodeId); return; }
    mount(sh, ctx, named, ep, { ...opts, story: true, mode: 'read', listen: true, reopen: () => open(c) });
  }
  ensureContent(ctx).then(open).catch(() => { if (!sh.st.stopped) fail('故事没有打开，等一下再试。', episodeId); });
  return sh.ctl;
}

export function renderPassage(container, ctx, opts = {}) {
  const { passage = null, onDone = () => {}, doneLabel = '接着上课' } = opts;
  const sh = makeShell(container);
  let ep = null;
  try { ep = R.passageOf(passage && typeof passage === 'object' && !passage.id && opts.id ? { ...passage, id: String(opts.id) } : passage); } catch (e) { ep = null; }
  const id = (ep && ep.id) || (passage && passage.id) || '';
  if (!ep || !ep.sentences.length) { failView(sh, '这一篇还没准备好。', () => onDone({ id, done: false }), doneLabel); return sh.ctl; }
  mount(sh, ctx, null, ep, { ...opts, story: false, mode: opts.mode === 'questions' ? 'questions' : 'read', listen: !!opts.listen });
  return sh.ctl;
}

// ---------------------------------------------------------------- one episode (or one passage)
function mount(sh, ctx, c, ep, cfg) {
  const { body, card, st } = sh;
  const { onDone = () => {}, sid: sid0 = '', step = R.STEP, doneLabel = '接着上课', short = false, again: againOpt = null,
    speak: speakHook = null, gap: gapHook = null, story = true, mode = 'read', listen: canListen = true, reopen = null,
    onHelp = null, onAnswer = null } = cfg;
  const t00 = Date.now();
  const hook = (fn, ...args) => { if (typeof fn === 'function') { try { fn(...args); } catch (e) { /* the caller's problem */ } } };
  const kv = ctx && ctx.kv;
  const sid = sidOf(ctx, sid0);
  const env = { episode: ep, curriculum: ctx && ctx.curriculum, words: ctx && ctx.words, dict: ctx && ctx.dict };
  const log = ev => {
    try { return ctx && ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, episode: ep.id, ...ev }) : null; } catch (e) { return null; }
  };
  const kvSet = (key, val) => { try { const r = kv && typeof kv.set === 'function' ? kv.set(key, val) : null; if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { /* keep going */ } };
  let prog = R.readProgress(kv);
  const again = story ? (againOpt != null ? !!againOpt : !!(prog.episodes[ep.id] && prog.episodes[ep.id].done)) : false;
  const save = () => { if (!story) return; prog = { ...prog, updated: R.isoLocal(new Date()) }; kvSet(R.KV_KEY, prog); };
  if (story) { prog = R.startEpisode(prog, ep.id, new Date()); save(); }
  // 求助分诊 (kv 'read:triage'): every word tap, 看不懂 and first wrong answer, and the same-day changes it brings
  let triage = R.readTriage(kv);
  const saveTriage = () => kvSet(R.TRIAGE_KEY, triage);
  const answered = story && !again ? ((prog.episodes[ep.id] || {}).answers || {}) : {};
  const flagged = new Set(story ? (prog.episodes[ep.id] || {}).flagged || [] : []);
  const all = short ? R.shortQuestions(ep) : ep.questions;
  const questions = all.filter(q => !answered[q.id] && !flagged.has(q.id));
  const focus = R.focusOf(ep, questions);
  const results = [];
  const helpLevel = new Map();
  let helps = 0, taps = 0, phase = 'intro', player = null, onPause = () => {}, resumeListen = null, hardAnswer = null;
  let autoTrunk = R.readAdjust(triage, ep.id).trunkFirst;
  let methodShownAt = 0;
  let liveStory = null;   // the story view on screen: repainted when the trunk starts showing by itself
  const epLabel = () => (!story ? cfg.label || ep.label || '读一篇' : again ? `再读一遍 · 第 ${ep.n} 集` : `番外 · 第 ${ep.n} 集`);

  function noteStuck(entry) {
    triage = R.noteTriage(triage, ep.id, entry, new Date());
    saveTriage();
    if (!autoTrunk && R.readAdjust(triage, ep.id).trunkFirst) {
      autoTrunk = true;
      if (liveStory) liveStory.repaint();
    }
  }
  // asked about in this reading (or earlier today when she left in the middle; not an old reading of the same episode)
  const helpedOn = list => list.some(i => (helpLevel.get(i) || 0) > 0 || (story && !again && Number(((prog.episodes[ep.id] || {}).helps || {})[String(i)] || 0) > 0));

  // ------------------------------------------------ speaking one sentence and knowing when it ended
  let pendingDone = null;
  function stopSpeech() {
    try { if (ctx && ctx.voice && typeof ctx.voice.stop === 'function') ctx.voice.stop(); } catch (e) { /* ignore */ }
    if (pendingDone) { const f = pendingDone; pendingDone = null; f(); }
  }
  st.cleanup.push(() => { if (player) player.stop(); stopSpeech(); });
  function speakWait(text, marker) {
    return new Promise(resolve => {
      let timer = 0;
      const t0 = Date.now();
      const est = R.speakMs(text);
      const finish = () => { clearTimeout(timer); if (pendingDone === finish) pendingDone = null; resolve(); };
      pendingDone = finish;
      if (!ctx || typeof ctx.say !== 'function') { timer = setTimeout(finish, est); return; }
      try { ctx.say(text, marker); } catch (e) { timer = setTimeout(finish, est); return; }
      const v = ctx.voice;
      if (!v || typeof v.busy !== 'function') { timer = setTimeout(finish, est); return; }
      // a voice that never says it ended (WebKit drops an utterance now and then): go on anyway
      const max = est * 2 + 3000;
      const tick = () => {
        const el = Date.now() - t0;
        if (el > max) { finish(); return; }
        if (el > 250 && !v.busy()) {
          // ended far too soon: no voice came out, so keep the rhythm by the clock
          if (el < est * 0.25) { timer = setTimeout(finish, Math.round(est * 0.6 - el)); return; }
          finish();
          return;
        }
        timer = setTimeout(tick, 120);
      };
      timer = setTimeout(tick, 150);
    });
  }
  const gapAfter = i => {
    const a = ep.sentences[i], b = ep.sentences[i + 1];
    return 650 + (b && (b.speaker || '') !== (a.speaker || '') ? 300 : 0) + (/\?["”]?$/.test(a.en) ? 150 : 0);
  };
  // a word or a sentence help in the middle of listening: stop and wait for her
  const pauseForHelp = () => { if (player && player.state === 'playing') { player.pause(); onPause(); } };

  // ------------------------------------------------ the word card
  function closeCard() { card.hidden = true; card.replaceChildren(); }
  function openWord(text, s) {
    pauseForHelp();
    // the sentence goes along: its key words say what the word means here (gone 不见了, kind 和善的)
    const info = R.wordInfo(text, { ...env, sentence: s });
    taps++;
    if (story) { prog = R.noteTap(prog, ep.id, info.name ? '' : info.base, new Date()); save(); }
    // a name is not a word she is stuck on
    if (!info.name) noteStuck({ from: 'tap', w: info.base, i: s.i });
    log({ type: 'lookup', item: `ep:${ep.id}:s${s.i}`, query: info.w, source: info.source || 'none', from: 'story', phase, ...(info.name ? {} : { slug: info.slug, triage: 'word' }) });
    drawCard(info);
  }
  function drawCard(info) {
    let foot = null;
    if (info.justAdded) foot = h('p', { className: 'rd-card-in' }, '加进单词本了，热身里会再见到它。');
    else if (info.inBook) foot = h('p', { className: 'rd-card-in' }, '已经在单词本里了。');
    else if (info.canAdd) foot = h('button', { type: 'button', className: 'btn rd-add', on: { click: ev => addWord(info, ev.currentTarget) } }, '加进单词本');
    const meaning = info.zh
      ? h('p', { className: 'rd-card-zh' }, info.zh)
      : h('p', { className: 'rd-card-zh none' }, info.name ? '这是名字。' : '离线词典里还没有这个词。');
    // listening stopped for this word: carry on from the card itself (the bar is under it)
    const goOn = phase === 'listen' && resumeListen && player && player.state === 'paused'
      ? h('button', { type: 'button', className: 'text-btn accent rd-card-go', on: { click: () => resumeListen() } }, '接着听') : null;
    card.replaceChildren(...[
      h('div', { className: 'rd-card-top' },
        h('p', { className: 'rd-card-w', lang: 'en' }, info.word, info.name ? null : sayBtn(ctx, info.word)),
        h('button', { type: 'button', className: 'text-btn rd-card-x', 'aria-label': '关上', on: { click: closeCard } }, icon('close'))),
      h('p', { className: 'rd-card-meta' },
        info.phonetic && !info.name ? h('span', { className: 'rd-card-ph', lang: 'en' }, `/${info.phonetic}/`) : null,
        info.base !== info.w && !info.name ? h('span', { className: 'rd-card-base' }, '原形 ', h('b', { lang: 'en' }, info.base)) : null,
        info.label ? h('span', { className: 'rd-card-tag' }, info.label) : null),
      meaning,
      foot || goOn ? h('div', { className: 'rd-card-foot' }, foot, goOn) : null].filter(Boolean));
    card.hidden = false;
  }
  async function addWord(info, btn) {
    if (btn) btn.disabled = true;
    try {
      const W = ctx && ctx.words;
      let e = W && W.get ? W.get(info.slug) : null;
      if (!e && W && typeof W.importData === 'function') { await W.importData(R.placeholderExport(info, new Date())); e = W.get ? W.get(info.slug) : null; }
      if (e && !e.favorited) {
        if (typeof ctx.toggleFav === 'function') await ctx.toggleFav(e.slug, true);
        else if (W && typeof W.favorite === 'function') await W.favorite(e.slug, true);
      } else if (ctx && typeof ctx.toast === 'function') ctx.toast('已加进单词本');
      if (story) { prog = R.noteAdded(prog, info.slug); save(); }
      if (!card.hidden) drawCard({ ...info, inBook: true, justAdded: true });
    } catch (err) {
      if (btn) btn.disabled = false;
      if (ctx && typeof ctx.toast === 'function') ctx.toast('没加上，再点一次。');
    }
  }

  // ------------------------------------------------ the story, sentence by sentence
  // 看不懂: 1 the trunk is marked in the sentence (谁 / 干什么) with its note; 2 the chunks and two key words; 3 the Chinese.
  // A sentence with no trunk written: 1 the chunks, 2 the key words, 3 the Chinese (as before).
  const trunkShown = s => { const tr = R.trunkOf(s); return tr && tr.found && tr.tokens.some(t => t.role || t.parts) ? tr : null; };
  function helpParts(s) {
    const lv = helpLevel.get(s.i) || 0;
    if (!lv) return [];
    const tr = R.trunkOf(s);
    const out = [];
    if (tr) {
      if (tr.note) out.push(h('p', { className: 'rd-trunk-note' }, tr.note));
      if (lv === 1 && trunkShown(s)) out.push(h('p', { className: 'rd-legend' }, h('span', { className: 'rd-subj' }, '谁'), h('span', { className: 'rd-verb' }, '干什么')));
    }
    const chunkLine = () => h('p', { className: 'rd-chunks', lang: 'en' }, R.chunksOf(s).map((x, k) => [k ? h('span', { className: 'rd-slash', 'aria-hidden': 'true' }, ' / ') : null, h('span', { className: 'rd-chunk' }, x)]));
    if (!tr) {
      out.push(chunkLine());
      if (lv === 1) out.push(h('p', { className: 'rd-help-note' }, '按意思分成几块，一块一块读。'));
    } else if (lv >= 2) out.push(chunkLine());
    if (lv >= 2) {
      const keys = R.keysOf(s, env);
      out.push(keys.length
        ? h('p', { className: 'rd-keys' }, keys.map(k => h('span', { className: 'rd-key' }, h('b', { lang: 'en' }, k.w), ' ', k.zh)))
        : h('p', { className: 'rd-help-note' }, '这句的词都不难，再看一遍断句。'));
    }
    if (lv >= 3) out.push(s.unsure && !s.zh
      ? h('p', { className: 'rd-help-note' }, '这句老师也拿不准，可以问问老师。')
      : h('p', { className: 'rd-zh' }, s.zh || '这句的中文还没写好。'));
    return out.filter(Boolean);
  }
  // locate: { pick(i), cls(i) -> [class], open() -> bool }   a 点句子 question: the rows are what she taps
  function storyView({ selfRead = false, evidence = [], compact = false, locate = null } = {}) {
    const rows = [];
    let prev = null, prevPart = null, prevLine = null;
    const el = h('div', { className: 'rd-story' + (compact ? ' compact' : '') + (locate ? ' rd-locate' : '') });
    const autoNote = locate ? null : h('p', { className: 'rd-auto-note small', hidden: !autoTrunk }, '后面的句子先标出了主干：', h('span', { className: 'rd-subj' }, '谁'), ' 和 ', h('span', { className: 'rd-verb' }, '干什么'), '。');
    if (autoNote) el.append(autoNote);
    for (const s of ep.sentences) {
      // a new part of the episode (群聊 / 那天深夜 / 日记): its label, so she knows where and when
      if (s.part != null && s.part !== prevPart && ep.parts[s.part]) {
        const pt = ep.parts[s.part];
        el.append(h('div', { className: 'rd-part' + (pt.kind ? ' ' + 'rd-part-' + pt.kind : '') },
          pt.label ? h('p', { className: 'rd-part-en', lang: 'en' }, pt.label) : null,
          pt.labelZh ? h('p', { className: 'rd-part-zh' }, pt.labelZh) : null));
        prev = null; prevLine = null;
      }
      prevPart = s.part;
      const who = s.speaker && s.speaker !== prev ? h('p', { className: 'rd-who', lang: 'en' }, s.speaker) : null;
      // the same chat message (same line, same speaker): sit closer together; a passage's new paragraph: a little space
      const cont = s.line != null && s.line === prevLine && s.speaker === prev;
      const newPara = !s.speaker && !s.para ? s.line != null && prevLine != null && s.line !== prevLine : !!s.para && rows.length > 0 && rows[rows.length - 1].s.para !== s.para;
      prev = s.speaker || null;
      prevLine = s.line;
      const enEl = h('p', { className: 'rd-en', lang: 'en' });
      const helpBox = h('div', { className: 'rd-help' });
      const helpBtn = locate ? null : h('button', { type: 'button', className: 'text-btn rd-help-btn' });
      const row = h('div', { className: 'rd-s' + (s.speaker ? ' talk' : '') + (cont ? ' cont' : '') + (newPara ? ' rd-newpara' : '') + (evidence.includes(s.i) ? ' evidence' : ''), dataset: { i: String(s.i) } },
        who,
        h('div', { className: 'rd-line' },
          h('span', { className: 'rd-no', 'aria-label': `第 ${s.no} 句` }, String(s.no)),
          enEl,
          selfRead ? sayBtn(ctx, s.en, '听这句') : null,
          helpBtn),
        locate ? null : helpBox);
      if (locate) {
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.addEventListener('click', () => { if (locate.open()) locate.pick(s.i); });
      }
      const paint = () => {
        if (locate) {
          enEl.replaceChildren(s.en);
          for (const c of ['rd-zone', 'rd-miss', 'rd-hit', 'rd-dropped']) row.classList.remove(c);
          for (const c of locate.cls(s.i)) row.classList.add(c);
          return;
        }
        const lv = helpLevel.get(s.i) || 0;
        // the trunk is marked in the sentence itself: after the first 看不懂, or by itself once she got stuck on sentences 3 times today
        const tr = lv >= 1 || autoTrunk ? trunkShown(s) : null;
        enEl.replaceChildren(...renderTokens(tr ? tr.tokens : R.tokenize(s.en), text => openWord(text, s)));
        helpBox.replaceChildren(...helpParts(s));
        helpBox.hidden = !lv;
        helpBtn.textContent = R.HELP_LABELS[Math.min(lv, R.HELP_LABELS.length - 1)];
        helpBtn.hidden = lv >= R.HELP_MAX;
        if (autoNote) autoNote.hidden = !autoTrunk;
      };
      if (helpBtn) helpBtn.addEventListener('click', () => {
        pauseForHelp();
        const lv = (helpLevel.get(s.i) || 0) + 1;
        if (lv > R.HELP_MAX) return;
        const wasAuto = autoTrunk && lv === 1 && !!trunkShown(s);
        helpLevel.set(s.i, lv);
        helps++;
        if (story) { prog = R.noteHelp(prog, ep.id, s.i, lv); save(); }
        log(R.helpEvent(ep, s, lv, { phase, autoTrunk: wasAuto }));
        noteStuck({ from: 'help', level: lv, i: s.i, tags: s.tags });
        hook(onHelp, s.i, lv);
        for (const r of rows) if (r.s === s) r.paint();
      });
      paint();
      rows.push({ s, row, paint });
      el.append(row);
    }
    let now = -1;
    return {
      el, rows,
      repaint() { for (const r of rows) r.paint(); },
      mark(i) {
        if (now >= 0 && rows[now]) rows[now].row.classList.remove('now');
        now = i;
        const r = rows[i];
        if (!r) return;
        r.row.classList.add('now');
        if (typeof r.row.scrollIntoView === 'function') { try { r.row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* old Safari */ } }
      },
      clear() { if (now >= 0 && rows[now]) rows[now].row.classList.remove('now'); now = -1; },
    };
  }
  const chip = (text, extra) => h('p', { className: 'rd-chip' }, h('span', { className: 'rd-tag' }, text), extra ? h('span', { className: 'rd-sub' }, extra) : null);
  const qText = q => q.stem || q.ask;
  const qZh = q => (q.stem ? q.stemZh : q.zh);
  // 带着问题读: the one question she looks for while reading
  const focusLine = () => (focus && phase !== 'question' ? h('div', { className: 'rd-focus' },
    h('p', { className: 'rd-label' }, '带着这道题读'),
    h('p', { className: 'rd-focus-q', lang: hasCJK(qText(focus)) ? 'zh-CN' : 'en' }, qText(focus)),
    qZh(focus) && !hasCJK(qText(focus)) ? h('p', { className: 'rd-focus-zh' }, qZh(focus)) : null) : null);

  // ------------------------------------------------ her own names for the girl and her cat (first episode, asked once)
  function namer() {
    if (!story) return null;
    const list = (c && c.names) || [];
    const two = ['hero', 'cat'].map(k => list.find(n => n.key === k && n.replaceable)).filter(Boolean);
    const pick = two.length ? two : list.filter(n => n.replaceable).slice(0, 2);
    const saved = kv && kv.peek ? kv.peek(R.NAMES_KEY, null) : null;
    if (ep.n !== 1 || again || !pick.length || saved) return null;
    const box = h('div', { className: 'rd-namer' });
    const keep = () => {
      kvSet(R.NAMES_KEY, { at: R.isoLocal(new Date()) });
      box.hidden = true;
    };
    const ask = () => {
      const inputs = pick.map(n => h('input', { className: 'field rd-name-in', type: 'text', placeholder: n.name, maxlength: '14',
        autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', lang: 'en', 'aria-label': n.zh || n.name }));
      const msg = h('p', { className: 'rd-namer-msg small' });
      const ok = () => {
        const names = Object.fromEntries(pick.map((n, i) => [n.key, String(inputs[i].value || '').trim()]).filter(([, v]) => v));
        const clean = R.cleanNames(names) || {};
        const typed = Object.keys(names).length;
        if (typed && Object.keys(clean).length < typed) { msg.textContent = '名字用英文字母写，比如 Lily、Kitty，也别和故事里别的人重名。'; return; }
        kvSet(R.NAMES_KEY, { ...clean, at: R.isoLocal(new Date()) });
        if (typeof reopen === 'function') reopen(); else box.hidden = true;
      };
      box.replaceChildren(
        h('p', { className: 'rd-label' }, '给她们起名字'),
        ...pick.map((n, i) => h('label', { className: 'rd-name-row' }, h('span', { className: 'rd-name-who' }, n.key === 'cat' ? '小猫' : n.key === 'hero' ? '女孩' : n.name), inputs[i])),
        msg,
        h('div', { className: 'rd-namer-actions' },
          h('button', { type: 'button', className: 'text-btn', on: { click: keep } }, '还是用原来的'),
          h('button', { type: 'button', className: 'btn rd-name-ok', on: { click: ok } }, '好了')));
    };
    const who = pick.map(n => (n.key === 'cat' ? `小猫叫 ${n.name}` : n.key === 'hero' ? `女孩叫 ${n.name}` : n.name)).join('，');
    box.append(
      h('p', { className: 'rd-namer-q' }, `故事里的${who}。想给她们换成你起的名字吗？`),
      h('div', { className: 'rd-namer-actions' },
        h('button', { type: 'button', className: 'text-btn', on: { click: keep } }, '就用这两个'),
        h('button', { type: 'button', className: 'text-btn accent rd-name-go', on: { click: ask } }, '起名字')));
    return box;
  }

  // ------------------------------------------------ 1. 读的方法
  function introView() {
    phase = 'intro';
    st.keyHandler = null;
    closeCard();
    const tip = ep.tip;
    const fi = focus ? questions.indexOf(focus) : -1;
    // 读前先看题: all of them when the episode says so (the one to look for while reading is named); one at least, always
    const preview = !questions.length ? null : tip.preview
      ? [h('p', { className: 'rd-label' }, '先看看要回答什么'), h('ol', { className: 'rd-preview' }, questions.map(q => h('li', { className: q === focus ? 'rd-pv-focus' : null },
        h('span', { className: 'rd-pv-en', lang: hasCJK(qText(q)) ? 'zh-CN' : 'en' }, qText(q)),
        qZh(q) && !hasCJK(qText(q)) ? h('span', { className: 'rd-pv-zh' }, qZh(q)) : null))),
        fi >= 0 && questions.length > 1 ? h('p', { className: 'rd-pv-note' }, `读的时候，先找第 ${fi + 1} 题的答案。`) : null]
      : [h('p', { className: 'rd-label' }, '先看一道题'), h('div', { className: 'rd-pv-one' },
        h('p', { className: 'rd-pv-en', lang: hasCJK(qText(focus)) ? 'zh-CN' : 'en' }, qText(focus)),
        qZh(focus) && !hasCJK(qText(focus)) ? h('p', { className: 'rd-pv-zh' }, qZh(focus)) : null), h('p', { className: 'rd-pv-note' }, '读的时候，找它的答案。')];
    const first = canListen
      ? h('button', { type: 'button', className: 'btn rd-start', on: { click: () => listenView() } }, '开始听')
      : h('button', { type: 'button', className: 'btn rd-start', on: { click: () => selfView() } }, '开始读');
    body.replaceChildren(h('div', { className: 'rd rd-intro' },
      chip(epLabel(), `约 ${R.estimateMinutes(ep, { short })} 分钟`),
      h('h2', { className: 'rd-title', lang: 'en' }, ep.title || (story ? `Episode ${ep.n}` : 'Reading')),
      ep.titleZh ? h('p', { className: 'rd-title-zh' }, ep.titleZh) : null,
      ep.recap ? h('div', { className: 'rd-recap' }, h('p', { className: 'rd-label' }, !story ? '这篇讲什么' : ep.n > 1 ? '上一集说到' : '故事开头'), h('p', { className: 'rd-recap-text' }, ep.recap)) : null,
      ep.targets.length ? h('div', { className: 'rd-targets' },
        h('p', { className: 'rd-label' }, story ? '这集会遇到的词' : '这篇会遇到的词'),
        h('ul', { className: 'rd-tw' }, ep.targets.map(t => h('li', null,
          h('button', { type: 'button', className: 'rd-tw-w', lang: 'en', on: { click: ev => ctx && ctx.say && ctx.say(t.w, ev.currentTarget) } }, t.w),
          t.zh ? h('span', { className: 'rd-tw-zh' }, t.zh) : null)))) : null,
      h('div', { className: 'rd-tip' },
        h('p', { className: 'rd-label' }, '读的方法'),
        tip.title ? h('p', { className: 'rd-tip-title' }, tip.title) : null,
        tip.lines.map(l => h('p', { className: 'rd-tip-line' }, l)),
        tip.steps && tip.steps.length ? h('ol', { className: 'rd-steps' }, tip.steps.map(x => h('li', null, x))) : null,
        preview),
      namer(),
      h('p', { className: 'rd-how small' }, canListen
        ? '老师一句一句读，你跟着看。点不认识的词看意思；哪句看不懂，点句子后面的“看不懂”。'
        : '一句一句看。点不认识的词看意思；哪句看不懂，点句子后面的“看不懂”。'),
      h('div', { className: 'rd-actions' }, first)));
  }

  // ------------------------------------------------ 2. 先听后读
  function listenView() {
    phase = 'listen';
    closeCard();
    const t0 = Date.now();
    const h0 = helps, k0 = taps;
    let pauses = 0, replays = 0, logged = false;
    const storyEl = storyView();
    liveStory = storyEl;
    const speaker = h('span', { className: 'rd-speaker', 'aria-hidden': 'true' }, icon('speak'));
    const pauseBtn = h('button', { type: 'button', className: 'btn rd-pause', on: { click: () => toggle() } }, '暂停');
    const replayBtn = h('button', { type: 'button', className: 'text-btn accent rd-replay', on: { click: () => { replays++; player.replay(); } } }, '重听这句');
    const quitBtn = h('button', { type: 'button', className: 'text-btn rd-quit', on: { click: () => { finish(false); player.stop(); selfView(); } } }, '不听了，自己读');
    const bar = h('div', { className: 'rd-bar' }, speaker, pauseBtn, replayBtn, quitBtn);
    const finish = completed => {
      if (logged) return;
      logged = true;
      const ms = Date.now() - t0;
      if (completed && story) { prog = R.noteListen(prog, ep, { ms, now: new Date() }); save(); }
      log({ type: 'read_time', item: `ep:${ep.id}`, mode: R.MODE, phase: 'listen', ms, words: ep.words, sentences: ep.sentences.length,
        completed, pauses, replays, helps: helps - h0, taps: taps - k0 });
    };
    const toggle = () => {
      if (!player) return;
      if (player.state === 'playing') { player.pause(); pauses++; }
      else if (player.state === 'paused') { closeCard(); player.resume(); }
      paintBar();
    };
    onPause = () => { pauses++; paintBar(); };
    resumeListen = () => { if (player && player.state === 'paused') { closeCard(); player.resume(); paintBar(); } };
    function paintBar() {
      const stt = player ? player.state : 'idle';
      if (stt === 'done') {
        bar.className = 'rd-bar done';
        bar.replaceChildren(...[
          h('p', { className: 'rd-bar-msg' }, '听完了。'),
          h('button', { type: 'button', className: 'btn rd-go', on: { click: () => { closeCard(); questionsStart(); } } }, questions.length ? '去做题' : '读完了'),
          short ? null : h('button', { type: 'button', className: 'text-btn accent rd-self', on: { click: () => selfView() } }, '自己再读一遍'),
          h('button', { type: 'button', className: 'text-btn rd-again', on: { click: () => listenView() } }, '再听一遍')].filter(Boolean));
        return;
      }
      pauseBtn.textContent = stt === 'paused' ? '接着听' : '暂停';
    }
    body.replaceChildren(h('div', { className: 'rd rd-listen' },
      chip(epLabel(), '先听后读'),
      h('h2', { className: 'rd-title small-title', lang: 'en' }, ep.title || `Episode ${ep.n}`),
      focusLine(),
      storyEl.el, bar));
    player = R.createReadAloud({
      count: ep.sentences.length,
      speak: i => (speakHook ? speakHook(ep.sentences[i].en, i) : speakWait(ep.sentences[i].en, speaker)),
      stopSpeech,
      gap: gapHook || gapAfter,
      onIndex: i => storyEl.mark(i),
      onState: stt => {
        if (stt === 'done') { storyEl.clear(); finish(true); }
        paintBar();
      },
    });
    st.keyHandler = ev => {
      const k = String(ev.key || '');
      if (k === ' ' || k === 'Spacebar') { if (ev.preventDefault) ev.preventDefault(); if (player.state === 'done') return; toggle(); }
      else if (/^r$/i.test(k) && player.state !== 'done') { replays++; player.replay(); }
    };
    player.start(0);   // inside the tap on 开始听, so the first sentence may play on the iPad
  }

  // ------------------------------------------------ 3. 自己再读一遍（可选；小篇不听的时候就从这里读）
  function selfView() {
    phase = 'self';
    resumeListen = null;
    st.keyHandler = null;
    closeCard();
    if (player) { player.stop(); player = null; }
    const t0 = Date.now();
    const h0 = helps, k0 = taps;
    const storyEl = storyView({ selfRead: true });
    liveStory = storyEl;
    const first = !canListen;
    const done = () => {
      const ms = Date.now() - t0;
      if (story) { prog = R.noteSelfRead(prog, ep.id, { ms }); save(); }
      log({ type: 'read_time', item: `ep:${ep.id}`, mode: R.MODE, phase: 'self', ms, words: ep.words, sentences: ep.sentences.length,
        completed: true, helps: helps - h0, taps: taps - k0 });
      closeCard();
      questionsStart();
    };
    body.replaceChildren(h('div', { className: 'rd rd-self' },
      chip(epLabel(), first ? '自己读' : '自己再读一遍'),
      first ? h('h2', { className: 'rd-title small-title', lang: 'en' }, ep.title || 'Reading') : null,
      h('p', { className: 'rd-how small' }, '不着急，一句一句看。哪句想再听，点句子后面的小喇叭。'),
      focusLine(),
      storyEl.el,
      h('div', { className: 'rd-bar done' },
        h('button', { type: 'button', className: 'btn rd-go', on: { click: done } }, questions.length ? '读完了，去做题' : '读完了'))));
  }

  // ------------------------------------------------ 4. 读后题
  function questionsStart() {
    resumeListen = null;
    liveStory = null;
    if (player) { player.stop(); player = null; }
    if (!questions.length) { endView(); return; }
    questionView(0);
  }
  function questionView(k) {
    if (k >= questions.length) { endView(); return; }
    phase = 'question';
    closeCard();
    const q = questions[k];
    const a = R.createAttempt(q);
    const el = h('div', { className: 'rd rd-q' });
    const shown = [];
    // 只做题 (a passage with mode 'questions'): the text stays open
    let vPick = null, lookOpen = mode === 'questions' && q.kind !== 'evidence', zhOpen = false, panelEl = null, markedOnce = false;
    // a 点句子 question: its story is built once and kept in a scroll panel, so a tap never loses her place
    let mainLoc = null, mainPanel = null, vLoc = null, vPanel = null;
    const unit = q.word ? (() => { try { return ctx.curriculum && ctx.curriculum.unitOf ? ctx.curriculum.unitOf(q.word) : null; } catch (e) { return null; } })() : null;
    const wordFields = q.word ? { slug: R.wordInfo(q.word, env).slug, ...(unit ? { unit } : {}) } : {};
    // 方法 missed twice today in this episode: this question starts with the episode's method
    const adj = R.readAdjust(triage, ep.id);
    const methodBox = adj.methodTip && adj.counts.method > methodShownAt ? (() => {
      methodShownAt = adj.counts.method;
      const tip = ep.tip || {};
      return h('div', { className: 'rd-method' },
        h('p', { className: 'rd-label' }, '先想想这集的方法'),
        tip.title ? h('p', { className: 'rd-method-title' }, tip.title) : null,
        (tip.lines || []).slice(0, 2).map(l => h('p', { className: 'rd-method-line' }, l)),
        h('p', { className: 'rd-method-line' }, '做题前先回原文找关键词，找到那一句再选。'));
    })() : null;

    // once the question is done, each option shows its Chinese: she sees what every choice meant
    function options(list, onPick, variant, showZh) {
      const long = list.some(o => o.text.length > 14);
      return h('div', { className: 'rd-options' + (long ? ' one-col' : '') + (list.length === 2 ? ' two' : '') }, list.map((o, i) => h('button', {
        type: 'button', className: 'rd-opt' + (variant ? ' v' : ''), lang: hasCJK(o.text) ? 'zh-CN' : 'en', dataset: { i: String(i) }, on: { click: () => onPick(i) },
      }, h('span', { className: 'rd-letter', 'aria-hidden': 'true' }, LETTERS[i]),
      h('span', { className: 'rd-text' }, o.text, showZh && o.zh && o.zh !== o.text ? h('span', { className: 'rd-opt-zh', lang: 'zh-CN' }, o.zh) : null))));
    }
    function stemLine(x) {
      if (!x.stem) return null;
      const [p1, p2] = x.stem.split('____');
      return h('p', { className: 'rd-stem', lang: 'en' }, p1, p2 !== undefined ? h('span', { className: 'rd-blank', 'aria-label': '空' }, ' ') : null, p2 !== undefined ? p2 : null);
    }
    function askLine(x) {
      if (!x.ask) return null;
      return h('p', { className: 'rd-ask', lang: hasCJK(x.ask) ? 'zh-CN' : 'en' }, x.ask);
    }
    // 指代题: the sentence with the pronoun marked
    function refLine(x) {
      if (!x.ref) return null;
      const s = ep.sentences[x.ref.i - 1];
      if (!s) return null;
      const w = R.normW(x.ref.word);
      return h('div', { className: 'rd-refq' },
        h('p', { className: 'rd-label' }, `第 ${s.no} 句`),
        h('p', { className: 'rd-refq-en', lang: 'en' }, R.tokenize(s.en).map(t => (t.word === w ? h('span', { className: 'rd-pron' }, t.text) : t.text))));
    }
    // a 点句子 question: the story, every row a button, inside a panel that scrolls
    function locateStory(question, state) {
      const v = storyView({ compact: true, locate: { open: state.open, pick: state.pick, cls: state.cls } });
      return { view: v, panel: h('div', { className: 'rd-lookback rd-locate-box' }, v.el), zone: state.zone || (() => []) };
    }
    const refresh = x => { if (!x) return; x.view.repaint(); x.view.el.classList.toggle('rd-zoned', x.zone().length > 0); };
    function draw() {
      const top = h('div', { className: 'rd-top' },
        h('span', { className: 'rd-pos' }, `第 ${k + 1} 题`, q.skillName ? h('span', { className: 'sub' }, ` · ${q.skillName}`) : null),
        a.done ? null : h('button', { type: 'button', className: 'text-btn rd-flag', on: { click: flag } }, '这题有问题'));
      const zhBtn = (q.zh || q.stemZh) && !hasCJK(q.ask) && !zhOpen
        ? h('button', { type: 'button', className: 'text-btn rd-q-zh-btn', on: { click: () => { zhOpen = true; log({ type: 'read_help', item: q.item, mode: R.MODE, kind: 'question_zh', level: 1, phase }); draw(); } } }, '题目看中文')
        : null;
      const hints = shown.length ? h('ol', { className: 'rd-hints' }, shown.map(x => h('li', { className: 'rd-hint' + (x.level >= R.HINT_MAX ? ' full' : '') },
        h('span', { className: 'rd-n' }, String(x.level)), h('span', { className: 'rd-hint-text' }, x.text)))) : null;
      const canHint = (a.phase === 'ask' || a.phase === 'retry') && a.level < R.HINT_MAX && a.ladder.length > a.level;
      const more = canHint ? h('button', { type: 'button', className: 'text-btn accent rd-more', on: { click: moreHint } }, a.level ? '再给个提示' : '给个提示') : null;
      const tipNote = ep.tip && ep.tip.q === q.id && ep.tip.title && !a.done ? h('p', { className: 'rd-tip-note' }, '用上这集的方法：', h('b', null, ep.tip.title)) : null;
      const zhLine = zhOpen ? [q.zh ? h('p', { className: 'rd-q-zh' }, q.zh) : null, q.stemZh ? h('p', { className: 'rd-q-zh' }, q.stemZh) : null] : [];
      const head = [top, methodBox, tipNote, askLine(q), ...zhLine, zhBtn, stemLine(q), refLine(q)];
      let middle = [];
      if (a.locate) {
        // ---- 点出答案句
        const inVariant = !!a.variant && (a.phase === 'variant' || !!vPick);
        const asking = () => a.phase === 'ask' || a.phase === 'retry';
        const revealed = () => a.phase === 'then' || a.done || a.level >= R.HINT_MAX;
        const zoneNow = () => (asking() ? R.zoneOf(ep, q, a.level) : []);
        if (!inVariant && !mainLoc) mainLoc = locateStory(q, {
          open: asking,
          pick,
          zone: zoneNow,
          cls: i => {
            const out = [];
            const z = zoneNow();
            if (a.picked.has(i) && !q.where.includes(i)) out.push('rd-miss');
            if ((a.picked.has(i) || revealed()) && q.where.includes(i)) out.push('rd-hit');
            if (z.includes(i) && !revealed() && !a.picked.has(i)) out.push('rd-zone');
            if (a.level >= 3 && !revealed() && (q.dropSentences || []).includes(i)) out.push('rd-dropped');
            return out;
          },
        });
        if (mainLoc) refresh(mainLoc);
        const how = asking() ? h('p', { className: 'rd-locate-how' }, '在下面的故事里，点出答案在哪一句。') : null;
        const tools = asking() && more ? h('div', { className: 'rd-qtools' }, more) : null;
        let thenBlock = null;
        if (a.then && (a.phase === 'then' || a.thenPick)) {
          const t = a.then;
          const tb = options(t.options, pickThen, false, !!a.thenPick);
          tb.childNodes.forEach((b, i) => {
            if (!b.classList) return;
            const o = t.options[i];
            if (a.thenPick) {
              b.disabled = true;
              if (a.thenPick.i === i) b.classList.add(o.correct ? 'right' : 'wrong');
              else if (o.correct) b.classList.add('is-answer');
            }
          });
          const found = a.thenPick ? [] : q.where.map(i => ep.sentences[i - 1]).filter(Boolean);
          thenBlock = h('div', { className: 'rd-then' },
            h('p', { className: 'rd-now' }, a.passed ? '找到了。再选答案：' : '答案在这一句。再选答案：'),
            found.length ? h('div', { className: 'rd-found' }, found.map(x => h('p', { className: 'rd-proof-en', lang: 'en' }, h('span', { className: 'rd-no' }, String(x.no)), ' ', x.en))) : null,
            t.ask && t.ask !== q.ask ? askLine(t) : null, tb,
            a.thenPick ? h('p', { className: 'rd-feedback' + (a.thenPick.correct ? ' ok' : '') }, a.thenPick.correct ? '选对了。' : `应该选${endStop(t.answer)}`) : null);
        }
        let variantBlock = null;
        if (inVariant) {
          const v = a.variant;
          if (v.kind === 'evidence') {
            if (!vLoc) vLoc = locateStory(v, {
              open: () => a.phase === 'variant',
              pick: pickVariant,
              cls: i => {
                const out = [];
                if (vPick && vPick.i === i) out.push(v.where.includes(i) ? 'rd-hit' : 'rd-miss');
                if (a.done && v.where.includes(i)) out.push('rd-hit');
                return out;
              },
            });
            refresh(vLoc);
            variantBlock = h('div', { className: 'rd-variant' }, h('p', { className: 'rd-now' }, '现在你来：'), askLine(v), stemLine(v),
              a.phase === 'variant' ? h('p', { className: 'rd-locate-how' }, '点出答案在哪一句。') : null, a.phase === 'variant' ? vLoc.panel : null);
          } else variantBlock = choiceVariant();
        }
        // the story is there while she looks for the sentence; after that the sentence itself is quoted (no long scroll to 下一题)
        mainPanel = !inVariant && asking() ? mainLoc.panel : null;
        vPanel = vLoc && a.phase === 'variant' ? vLoc.panel : null;
        middle = [how, hints, tools, thenBlock, variantBlock, mainPanel];
      } else {
        // ---- 选一个
        const main = options(q.options, pick, false, a.done);
        main.childNodes.forEach((b, i) => {
          if (!b.classList) return;
          const o = q.options[i];
          const picked = a.picked.has(i);
          if (picked && !o.correct) { b.classList.add('wrong'); b.disabled = true; }
          if (o.correct && (picked || a.phase === 'variant' || (a.done && a.level >= R.HINT_MAX))) b.classList.add(picked ? 'right' : 'is-answer');
          // 排除法: hint 3 rules this one out, so it is crossed out too
          if (o.drop && a.level >= 3 && !picked) { b.classList.add('dropped'); b.disabled = true; }
          if (a.done || a.phase === 'variant') b.disabled = true;
        });
        // 回原文看看: open by itself once a hint shows; the answer's sentence is marked from hint 2 on (or once she is done)
        const mark = a.level >= 2 || a.done ? q.evidence : [];
        const look = h('button', { type: 'button', className: 'text-btn rd-look-btn' + (lookOpen ? ' on' : ''), on: { click: () => { lookOpen = !lookOpen; draw(); } } },
          lookOpen ? '收起原文' : '回原文看看');
        const prevTop = panelEl ? panelEl.scrollTop || 0 : 0;
        const lookView = lookOpen ? storyView({ evidence: mark, compact: true }) : null;
        const text = lookView ? h('div', { className: 'rd-lookback' }, lookView.el) : null;
        panelEl = text;
        const variantBlock = a.variant && (a.phase === 'variant' || (a.done && vPick)) ? choiceVariant() : null;
        // 回原文看看 on the left, 给个提示 on the right, the story right under them
        const tools = !a.done ? h('div', { className: 'rd-qtools' }, look, more) : null;
        middle = [main, hints, tools, a.done ? null : text, variantBlock];
        setTimeout0(() => {
          // the story keeps where she scrolled it; when the answer's sentence is first marked, it scrolls there
          if (text && lookView) {
            const j = mark.length && !markedOnce ? lookView.rows.findIndex(x => x.s.i === mark[0]) : -1;
            // show the sentence before it too: hints often say “find X, then read on”
            const r = j >= 0 ? lookView.rows[Math.max(0, j - 1)] : null;
            if (r) { markedOnce = true; text.scrollTop = Math.max(0, (r.row.offsetTop || 0) - 8); } else text.scrollTop = prevTop;
          }
        });
      }
      let feedback = null, why = null, proof = null, actions = null;
      if (a.done) {
        const r = a.result();
        const noOf = i => (ep.sentences[i - 1] || {}).no || i;
        let msg;
        if (a.variant && vPick) msg = r.variantCorrect ? '这题过关了。' : a.variant.kind === 'evidence' ? `答案在第 ${noOf(a.variant.where[0])} 句。下次再练。` : `答案是${endStop(a.variant.answer)}下次再练。`;
        else if (r.clean) msg = a.locate ? '找对了。' : '对了。';
        else if (r.passed) msg = '改对了。';
        else msg = a.locate ? `答案在第 ${noOf(q.where[0])} 句。下次再练。` : `答案是${endStop(q.answer)}下次再练。`;
        feedback = h('p', { className: 'rd-feedback' + (r.passed ? ' ok' : '') }, msg);
        const ex = a.variant && vPick ? a.variant.explain : (!r.clean ? q.explain : '');
        why = ex && !shown.some(x => x.text === ex) ? h('p', { className: 'rd-why' }, ex) : null;
        // the sentence that proves it: reading questions are answered from the text, never from a guess
        const evList = a.variant && vPick ? (a.variant.kind === 'evidence' ? a.variant.where : a.variant.evidence) : a.locate ? q.where : q.evidence;
        const ev = evList.map(i => ep.sentences[i - 1]).filter(Boolean);
        proof = ev.length ? h('div', { className: 'rd-proof' }, h('p', { className: 'rd-label' }, '原文这样说'),
          ev.map(s => h('p', { className: 'rd-proof-en', lang: 'en' }, s.en, sayBtn(ctx, s.en)))) : null;
        actions = h('div', { className: 'rd-actions' }, h('button', { type: 'button', className: 'btn rd-next', on: { click: next } }, k + 1 < questions.length ? '下一题' : story ? '看看这集的词' : '读完了'));
      }
      const keep = [mainPanel, vPanel].map(p => (p ? p.scrollTop || 0 : 0));
      el.replaceChildren(...[...head, ...middle, feedback, why, proof, actions].filter(Boolean));
      [mainPanel, vPanel].forEach((p, j) => { if (p) p.scrollTop = keep[j]; });
    }
    function choiceVariant() {
      const v = a.variant;
      const vb = options(v.options, pickVariant, true, a.done);
      vb.childNodes.forEach((b, i) => {
        if (!b.classList) return;
        const o = v.options[i];
        if (a.done) {
          b.disabled = true;
          if (vPick && vPick.i === i) b.classList.add(o.correct ? 'right' : 'wrong');
          else if (o.correct) b.classList.add('is-answer');
        }
      });
      return h('div', { className: 'rd-variant' }, h('p', { className: 'rd-now' }, '现在你来：'), askLine(v), stemLine(v), vb);
    }
    function logAnswer(p, extra = {}) {
      if (p && p.event) log({ type: 'answer', ...p.event, ...wordFields, ...extra });
    }
    function settle() {
      const r = a.result();
      results.push(r);
      if (story) { prog = R.noteAnswer(prog, ep.id, r, new Date()); save(); }
      hook(onAnswer, r.qid, r);
    }
    function pick(i) {
      const p = a.pick(i);
      if (!p) return;
      // the first wrong answer says where she is stuck: 方法 (she did not go back to the text), or 句子 (whose she is)
      let tri = null;
      if (p.firstWrong) {
        tri = R.triageKind({ from: 'wrong', helped: helpedOn(q.evidence), qtype: q.qtype });
        if (tri) noteStuck({ kind: tri, from: 'wrong', q: q.id, i: (q.evidence[0] || 0), tags: (ep.sentences[(q.evidence[0] || 1) - 1] || {}).tags });
      }
      logAnswer(p, tri ? { triage: tri } : {});
      if (p.hintShown) {
        shown.push(p.hintShown);
        lookOpen = true;
        log({ type: 'hint', item: q.item, mode: R.MODE, level: p.hintShown.level, hint_level: p.hintShown.level, auto: true });
      }
      if (a.done) settle();
      draw();
    }
    function moreHint() {
      const x = a.hint();
      if (!x) return;
      shown.push(x);
      lookOpen = true;
      log({ type: 'hint', item: q.item, mode: R.MODE, level: x.level, hint_level: x.level, auto: false });
      if (a.done) settle();
      draw();
    }
    function pickThen(i) {
      const p = a.pickThen(i);
      if (!p) return;
      logAnswer(p);
      if (a.done) settle();
      draw();
    }
    function pickVariant(i) {
      const p = a.pickVariant(i);
      if (!p) return;
      vPick = { i, correct: p.correct };
      logAnswer(p);
      settle();
      draw();
    }
    function flag() {
      log({ type: 'flag', item: q.item, mode: R.MODE });
      if (story) { prog = R.noteFlag(prog, ep.id, q.id); save(); }
      questionView(k + 1);
    }
    function next() { if (a.done) questionView(k + 1); }
    st.keyHandler = ev => {
      const key = String(ev.key || '').toUpperCase();
      if (ev.key === 'Enter' && a.done) { if (ev.preventDefault) ev.preventDefault(); next(); return; }
      const i = key && '123456'.includes(key) ? Number(key) - 1 : LETTERS.indexOf(key);
      if (i < 0) return;
      if (a.phase === 'then') pickThen(i);
      else if (a.locate) { if (a.phase === 'variant' && a.variant && a.variant.kind !== 'evidence') pickVariant(i); }
      else if (a.phase === 'variant') pickVariant(i); else if (!a.done) pick(i);
    };
    draw();
    body.replaceChildren(el);
    if (typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------ 今天哪里最难？ (her own word, next to the data)
  function hardBlock() {
    const box = h('div', { className: 'rd-hard' });
    const choose = o => {
      if (hardAnswer) return;
      hardAnswer = o.id;
      log(R.hardEvent(ep, o.id));
      triage = R.noteHard(triage, ep.id, o.id, new Date());
      saveTriage();
      box.replaceChildren(h('p', { className: 'rd-label' }, '今天哪里最难？'), h('p', { className: 'rd-hard-reply' }, o.reply));
    };
    box.append(
      h('p', { className: 'rd-label' }, '今天哪里最难？'),
      h('div', { className: 'rd-hard-opts' }, R.HARD_OPTIONS.map(o => h('button', { type: 'button', className: 'rd-hard-opt', dataset: { id: o.id }, on: { click: () => choose(o) } }, o.zh))));
    return box;
  }

  // ------------------------------------------------ 5. 收尾：这集学的词
  function endView() {
    phase = 'end';
    st.keyHandler = null;
    liveStory = null;
    closeCard();
    if (story) { prog = R.finishEpisode(prog, ep.id, { now: new Date(), again }); save(); }
    const e = prog.episodes[ep.id] || {};
    const stt = story ? e.stats || { right: 0, fuzzy: 0, failed: 0 } : {
      right: results.filter(r => r.clean).length, fuzzy: results.filter(r => r.passed && !r.clean).length,
      failed: results.filter(r => !r.passed).length, flagged: questions.length - results.length };
    const passedWords = new Set(results.filter(r => r.passed && r.word).map(r => R.normW(r.word)));
    const missedWords = new Set(results.filter(r => !r.passed && r.word).map(r => R.normW(r.word)));
    const n = stt.right + stt.fuzzy + stt.failed;
    const bits = [stt.right ? `第一次就对了 ${stt.right} 道` : '', stt.fuzzy ? `${stt.fuzzy} 道看了提示改对` : '', stt.failed ? `${stt.failed} 道下次再练` : ''].filter(Boolean);
    const line = n ? bits.join('，') + '。' : '';
    const list = ep.targets.map(t => t.w);
    const say = btn => { if (ctx && typeof ctx.say === 'function' && list.length) ctx.say(list.join(', '), btn); };
    const hear = h('button', { type: 'button', className: 'text-btn accent rd-hear', on: { click: ev => say(ev.currentTarget) } }, icon('speak'), '听一遍这些词');
    const boring = story ? h('button', { type: 'button', className: 'text-btn rd-boring', on: { click: ev => {
      log({ type: 'feel', item: `ep:${ep.id}`, mode: R.MODE, choice: 'boring' });
      prog = R.noteBoring(prog, ep.id);
      save();
      const b = ev.currentTarget;
      b.textContent = '老师记下了。';
      b.disabled = true;
    } } }, '这集不好看') : null;
    const hardSentences = [...helpLevel].filter(([, lv]) => lv >= R.HELP_MAX).map(([i, lv]) => ep.sentences[i - 1] && { i, en: ep.sentences[i - 1].en, zh: ep.sentences[i - 1].zh, level: lv }).filter(Boolean).sort((x, y) => x.i - y.i);
    const extra = () => ({ ms: Date.now() - t00, hardSentences });
    const finish = () => onDone(story ? {
      episodeId: ep.id, n: ep.n, done: true, again, stats: { ...stt }, results: results.slice(),
      words: ep.targets.map(t => t.slug), passedWords: [...passedWords], helps, taps, hard: hardAnswer, triage: R.triageToday(triage, ep.id), ...extra(),
    } : { id: ep.id, passage: true, done: true, stats: { ...stt }, results: results.slice(), helps, taps, hard: hardAnswer, triage: R.triageToday(triage, ep.id), ...extra() });
    body.replaceChildren(h('div', { className: 'rd rd-end' },
      chip(epLabel(), '读完了'),
      h('p', { className: 'lede' }, !story ? '这篇读完了。' : again ? '这集又读了一遍。' : '这集读完了。'),
      line ? h('p', { className: 'rd-sum' }, line) : null,
      list.length ? h('div', { className: 'rd-learned' },
        h('p', { className: 'rd-label' }, story ? '这集学的词' : '这篇的词'),
        h('ul', { className: 'rd-tw end' }, ep.targets.map(t => {
          const w = R.normW(t.w);
          return h('li', { className: passedWords.has(w) ? 'ok' : missedWords.has(w) ? 'miss' : '' },
            h('button', { type: 'button', className: 'rd-tw-w', lang: 'en', on: { click: ev => ctx && ctx.say && ctx.say(t.w, ev.currentTarget) } }, t.w),
            t.zh ? h('span', { className: 'rd-tw-zh' }, t.zh) : null,
            passedWords.has(w) ? h('span', { className: 'rd-tw-ok' }, icon('check')) : null);
        })),
        hear) : null,
      hardBlock(),
      ep.teaser && !again && story ? h('p', { className: 'rd-teaser' }, c && c.next && c.next(ep.id) ? h('b', null, '下一集：') : null, ep.teaser) : null,
      h('div', { className: 'rd-actions' }, boring, h('button', { type: 'button', className: 'btn rd-done', on: { click: finish } }, doneLabel))));
    say(hear);   // the teacher says this episode's words once (still inside the tap on the last 下一题)
  }

  if (mode === 'questions') questionsStart(); else introView();
}

// after the screen is drawn (the look-back panel needs its rows laid out to scroll to the answer)
function setTimeout0(fn) {
  try { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn()); else fn(); } catch (e) { /* ignore */ }
}
