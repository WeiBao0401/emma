// 问老师（第 4 个标签，放在“今天”后面）：她的气泡在右，老师的在左。老师的回答支持加粗、列表、换行（chat.js formatBlocks，
// 用 h() 拼，不用 innerHTML）；英文单词点一下看意思（单词本的课本意思，没有就离线词典），可以“查词”跳到查词页；
// 老师回答旁有“听一遍”（只读英文例句）。下面是输入框、拍题、按住说话、发送。第一次打开给 3 个能点的示例问题。
// 最新一条老师回答下面有三个快捷按钮（还是不懂、再举个例子、出道题考考我）和“和学校讲的不一样”（记 flag，请老师再核对）。
// 老师的笔记本（teacher.js）：打开时先对一遍“我问过的”（syncAsked）；讲过的点在热身里再考做错了，老师在对话最后主动问一句
// “上次讲的 X，我换个讲法再说一遍？”（好，再讲一遍 / 先不用）；每周第一次打开问一次“这周学下来，哪里最卡？”（记 ask 事件
// qid 'chat_week'）；第一次打开的招呼下面有每周想一次给她的那一句（kidWeekLine，只说正面的）。
// 例句里她不认识的词太多时老师会重写一次（chat.js），重写的那会儿气泡下面写一句“老师在把例句换成你学过的词”。
// 负责：问老师 agent（chat.js、chat-prompt.js、ui-chat.js、css/chat.css、tests/chat.test.mjs）。
//
// 导出
//   createChatTab(ctx, { root }) -> { show(params), onChange(), hide(), inSession(), holding() }
//     渲染进 #tab-chat（root 不给时）。params：{ ask?: 放进输入框的字, send?: true（直接发出去）| 字符串（直接发出去：气泡上
//     显示 ask，发给老师的是这串字，带上 App 给她看过的中文、前一句这类背景）, image?: data URL（带一张照片） }
//     别的页可以 ctx.go('chat', { ask: '这句话什么意思：…', send: true }) 把问题带进来（比如阅读里“这句还是不懂”）。
//     params.retell：'teacher.asked' 的 key（'g:there_be'），直接开始“换个讲法再说一遍”（上课收尾可以这样带进来）。
//     inSession()：老师正在回答或者正在录音（App 不自动更新）；holding()：输入框里有没发的字或照片。
//   CHAT_COPY   问老师这里换的几句报错（其余走 ctx.kidError）
//
// 用到的 ctx：kv、events、words（get）、dict（find）、curriculum、budget、settings、mockForced、say、lookup、toast、kidError、
//   statusSlot；可选 voiceInput（语音输入，形状见 needs：start({ onPartial, lang }) / stop() -> 文字 / cancel()，
//   也认 startRecording / stopRecording，或者一个返回这样对象的函数）。
import { h, icon, toast as baseToast, dateCn } from './ui-dom.js';
import * as C from './chat.js';
import * as T from './teacher.js';
import { imageToJpeg } from './capture.js';
import { slugify } from './words.js';

export const CHAT_COPY = {
  inspection: '这个问题老师这边讲不了，换个说法问问。',
  empty: '老师这次没回上话，再试一次。',
  truncated: '这次没讲完，点“再试一次”。',
  incomplete: '这次没讲完，点“再试一次”。',
  timeout: '网有点慢，这次没讲完，点“再试一次”。',
};

const NS = 'http://www.w3.org/2000/svg';
function svgIcon(shapes) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'icon');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    s.append(el);
  }
  return s;
}
const cameraIcon = () => svgIcon([['path', { d: 'M4.5 8.5A1.5 1.5 0 0 1 6 7h2.2l1.4-2h4.8l1.4 2H18a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5z' }],
  ['circle', { cx: 12, cy: 12.75, r: 3.25 }]]);
const micIcon = () => svgIcon([['rect', { x: 9, y: 3.5, width: 6, height: 11, rx: 3 }], ['path', { d: 'M6 11.5a6 6 0 0 0 12 0' }], ['path', { d: 'M12 17.5v3' }]]);

const shortUnit = id => (id === 'S' ? 'Starter' : /^U(\d+)$/.test(String(id)) ? 'Unit ' + String(id).slice(1) : '');
// "n. 猫；猫科动物；v. 抓" -> the first two senses, short
function briefCn(cn) {
  const s = String(cn || '').split(/[；;]/).map(x => x.trim()).filter(Boolean).slice(0, 2).join('；');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}
const joinText = (base, add) => (base && add ? base.replace(/\s+$/, '') + (/[一-鿿]$/.test(base) ? '' : ' ') + add : base || add || '');

export function createChatTab(ctx, { root = null } = {}) {
  const el = root || document.getElementById('tab-chat');
  const toast = (m, ms) => (ctx.toast ? ctx.toast(m, ms) : baseToast(m, ms));
  const chat = C.createChat(ctx);
  let pendingImage = null;   // data URL waiting to be sent
  let preparing = false;
  let rec = null;            // the voice recording in progress
  let olderOpen = false;
  let stick = true;          // keep the newest line in view while the teacher writes
  const bubbles = new Map(); // message id -> { wrap, body, tools, m }
  let offer = null;          // teacher.js retellOffer: a point to tell again another way
  let weekAsk = false;       // this week's “哪里最卡？” not answered yet

  // ---------------------------------------------------------------- the page
  const statusEl = h('div', { className: 'status-slot' });
  const olderBtn = h('button', { type: 'button', className: 'text-btn chat-older-btn', on: { click: toggleOlder } }, '前几天');
  const newBtn = h('button', { type: 'button', className: 'text-btn accent chat-new-btn', on: { click: newQuestion } }, '换个问题');
  const older = h('section', { className: 'chat-older', hidden: true, 'aria-label': '前几天问过的' });
  const list = h('div', { className: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const pop = h('div', { className: 'chat-pop', hidden: true });
  const photoBox = h('div', { className: 'chat-photo', hidden: true });
  const input = h('textarea', { className: 'chat-input', rows: 1, placeholder: '问老师……', 'aria-label': '想问老师什么',
    enterkeyhint: 'send', on: { input: () => { grow(); updateComposer(); }, keydown: onKey } });
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, on: { change: onFile } });
  const camBtn = h('button', { type: 'button', className: 'chat-tool-btn chat-cam', 'aria-label': '拍一道题', on: { click: openCamera } },
    cameraIcon(), h('span', { text: '拍题' }));
  const micLabel = h('span', { text: '按住说话' });
  const micBtn = h('button', { type: 'button', className: 'chat-tool-btn chat-mic', 'aria-label': '按住说话' }, micIcon(), micLabel);
  const sendBtn = h('button', { type: 'button', className: 'btn chat-send', on: { click: () => (chat.isBusy() ? chat.stop() : doSend()) } }, '发送');
  const composer = h('div', { className: 'chat-composer' }, pop, photoBox,
    h('div', { className: 'chat-bar' }, camBtn, input, micBtn, sendBtn), fileInput);
  const page = h('div', { className: 'chat' },
    h('header', { className: 'runhead chat-head' }, h('span', { className: 'runhead-title', text: '问老师' }),
      h('span', { className: 'chat-head-end' }, olderBtn, newBtn)),
    statusEl, older, list, composer);
  if (el) el.replaceChildren(page);
  if (ctx.statusSlot) ctx.statusSlot(statusEl);

  page.addEventListener('click', e => {
    const w = e.target && e.target.closest ? e.target.closest('.chat-w') : null;
    if (w) openWord(w.dataset.w || w.textContent || '');
  });
  setupMic();

  // ---------------------------------------------------------------- drawing
  const kidLine = code => CHAT_COPY[code] || (ctx.kidError ? ctx.kidError({ code }, { where: 'chat' }) : '') || '出了点小问题，再试一次。';
  const unitLabel = () => { try { return shortUnit((ctx.kv.peek('progress', {}) || {}).unit) || 'Unit 3'; } catch (e) { return 'Unit 3'; } };

  function spansEl(spans) {
    return spans.map(sp => {
      const kids = C.tokens(sp.text).map(t => (t.en ? h('span', { className: 'chat-w', lang: 'en', dataset: { w: t.s }, text: t.s }) : t.s));
      return sp.bold ? h('strong', null, kids) : kids;
    });
  }
  function rich(text) {
    return C.formatBlocks(text).map(b => {
      if (b.type === 'ul') return h('ul', { className: 'chat-ul' }, b.items.map(sp => h('li', null, spansEl(sp))));
      if (b.type === 'ol') return h('ol', { className: 'chat-ol' }, b.items.map(it => h('li', null, h('span', { className: 'chat-n', text: it.n + '.' }), h('span', null, spansEl(it.spans)))));
      return h('p', null, b.lines.map((sp, i) => [i ? h('br') : null, spansEl(sp)]));
    });
  }
  function fillBody(body, m) {
    const kids = [];
    if (m.pending && !m.text) kids.push(h('p', { className: 'chat-typing' }, '老师在想', h('span', { className: 'dots' })));
    else kids.push(...rich(m.text));
    if (m.pending && m.text) kids.push(h('span', { className: 'chat-caret', 'aria-hidden': 'true' }));
    if (m.simplifying) kids.push(h('p', { className: 'chat-note small', text: '老师在把例句换成你学过的词……' }));
    if (m.stopped) kids.push(h('p', { className: 'chat-note small', text: '（停下了）' }));
    if (m.error) kids.push(h('p', { className: 'chat-err', text: kidLine(m.error) }));
    body.replaceChildren(...kids);
  }
  function toolsFor(m, { last = false, old = false } = {}) {
    if (m.pending) return null;
    const say = m.text ? C.speakable(m.text) : '';
    const row = [];
    if (say) row.push(h('button', { type: 'button', className: 'text-btn chat-say', on: { click: e => ctx.say(say, e.currentTarget) } }, icon('speak'), h('span', { text: '听一遍' })));
    if (!old && m.error) row.push(h('button', { type: 'button', className: 'text-btn accent', on: { click: () => retry(m.id) } }, icon('refresh'), h('span', { text: '再试一次' })));
    if (!old && last && !m.error && m.text && !m.flagged) row.push(h('button', { type: 'button', className: 'text-btn chat-flag', on: { click: () => recheck(m) } }, RECHECK_LABEL));
    if (m.flagged) row.push(h('span', { className: 'small chat-flagged', text: '已请老师再核对' }));
    const out = [];
    if (row.length) out.push(h('div', { className: 'chat-tools' }, row));
    if (!old && last && !m.error && m.text) {
      out.push(h('div', { className: 'chat-quick' }, C.QUICK.map(q => h('button', { type: 'button', className: 'chat-chip',
        on: { click: () => doSend({ text: q.label, send: q.send, quick: q.id }) } }, q.label))));
    }
    return out.length ? out : null;
  }
  const RECHECK_LABEL = C.RECHECK.label;

  function teacherBubble(m, opts = {}) {
    const body = h('div', { className: 'chat-body' });
    fillBody(body, m);
    const tools = h('div', { className: 'chat-after' }, toolsFor(m, opts));
    const wrap = h('div', { className: 'chat-row chat-row-teacher' }, h('div', { className: 'chat-msg chat-teacher', dataset: { id: m.id } }, body), tools);
    if (!opts.old) bubbles.set(m.id, { wrap, body, tools, m });
    return wrap;
  }
  function userBubble(m) {
    const img = chat.image(m.id);
    return h('div', { className: 'chat-row chat-row-me' }, h('div', { className: 'chat-msg chat-me' },
      img ? h('img', { className: 'chat-img', src: img, alt: '拍的题' }) : m.image ? h('p', { className: 'chat-note small', text: '（拍了一张照片）' }) : null,
      m.text ? h('p', { className: 'chat-text' }, spansEl([{ text: m.text, bold: false }])) : null));
  }
  const divider = () => h('div', { className: 'chat-divider', role: 'separator' }, h('span', { text: '新问题' }));
  function greeting() {
    let tn = '';
    try { tn = String(((ctx.kv.peek('profile', {}) || {}).teacherName) || '').trim(); } catch (e) { tn = ''; }
    return h('div', { className: 'chat-row chat-row-teacher' }, h('div', { className: 'chat-msg chat-teacher chat-hello' }, h('div', { className: 'chat-body' },
      h('p', null, h('strong', { text: '有不懂的，都可以问' + (tn ? (/^[A-Za-z]/.test(tn) ? ' ' + tn : tn) : '我') + '。' })),
      h('p', { text: '课本、作业题、单词、语法、一句话看不懂，都行。我会讲到你真的懂了为止。' }),
      h('p', { className: 'small', text: '可以打字，可以按住“说话”，也可以拍一道题。我回答里的英文单词，点一下就能看意思。' }),
      weekLine() ? h('p', { className: 'chat-week', text: weekLine() }) : null)));
  }
  const weekLine = () => { try { return T.kidWeekLine(ctx.kv, new Date()); } catch (e) { return ''; } };

  // ---------------------------------------------------------------- the teacher's notebook (teacher.js)
  function retellBlock(e) {
    return h('div', { className: 'chat-row chat-row-teacher chat-retell' },
      h('div', { className: 'chat-msg chat-teacher' }, h('div', { className: 'chat-body' },
        h('p', null, h('strong', null, spansEl([{ text: `上次讲的 ${e.label}，我换个讲法再说一遍？`, bold: false }]))),
        h('p', { className: 'small', text: '这几天热身里又考到它，有一道没做对。换个角度讲，常常就通了。' }))),
      h('div', { className: 'chat-after' }, h('div', { className: 'chat-quick' },
        h('button', { type: 'button', className: 'chat-chip', on: { click: () => startRetell(e) } }, '好，再讲一遍'),
        h('button', { type: 'button', className: 'chat-chip chat-chip-quiet', on: { click: () => skipRetell(e) } }, '先不用'))));
  }
  async function startRetell(e) {
    if (chat.isBusy() || preparing) return;
    offer = null;
    try { await T.markRetell(ctx.kv, e.key, { accepted: true }); } catch (err) { /* the question still goes */ }
    const msgs = chat.messages();
    if (msgs.length && msgs[msgs.length - 1].thread === chat.thread()) chat.newThread();
    doSend({ text: T.retellLabel(e), send: T.retellAsk(e), quick: 'retell' });
  }
  async function skipRetell(e) {
    offer = null;
    render();
    try { await T.markRetell(ctx.kv, e.key, { accepted: false }); } catch (err) { /* asked again next time */ }
  }
  function weekAskBlock() {
    return h('div', { className: 'chat-row chat-row-teacher chat-weekask' },
      h('div', { className: 'chat-msg chat-teacher' }, h('div', { className: 'chat-body' },
        h('p', null, h('strong', { text: T.WEEK_ASK })),
        h('p', { className: 'small', text: '点一个就好。老师记下来，下周对着帮你。' }))),
      h('div', { className: 'chat-after' }, h('div', { className: 'chat-quick' },
        ...T.WEEK_ASK_OPTIONS.map(o => h('button', { type: 'button', className: 'chat-chip', on: { click: () => answerWeek(o.id) } }, o.label)),
        h('button', { type: 'button', className: 'chat-chip chat-chip-quiet', on: { click: () => answerWeek('skip') } }, '先不说'))));
  }
  async function answerWeek(id) {
    weekAsk = false;
    render();
    try {
      if (ctx.events && ctx.events.log) await ctx.events.log({ type: 'ask', step: 'chat', qid: 'chat_week', who: 'emma', answer: id, about: 'week_stuck:' + id });
    } catch (e) { /* never blocks */ }
    toast(id === 'skip' ? '好，有不懂的随时来问。' : '老师记下了。有不懂的随时来问。', 2200);
  }
  // what the notebook wants to say when she opens the page: settle “我问过的”, then a retell offer or this week's question
  let refreshing = null;
  function refreshNotebook() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const now = new Date();
      let st = null;
      try { st = await T.syncAsked(ctx, { now }); } catch (e) { st = null; }
      offer = st ? T.retellOffer(st, now) : null;
      weekAsk = false;
      try {
        const mon = T.mondayOf(now);
        const used = ctx.kv.keys(C.KV_PREFIX).some(k => C.isDayKey(k) && k !== C.dayKey(now)) || T.lessonDaysIn(ctx.kv, mon, T.dayOf(now)).length > 0;
        if (used && ctx.events && ctx.events.query) {
          const asks = (await ctx.events.query({ since: mon, type: 'ask' })) || [];
          weekAsk = !asks.some(x => x && x.qid === 'chat_week');
        }
      } catch (e) { weekAsk = false; }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function exampleBlock() {
    return h('div', { className: 'chat-examples' },
      h('p', { className: 'chat-ex-h small', text: '可以这样问' }),
      C.examples(unitLabel()).map(x => h('button', { type: 'button', className: 'chat-ex', on: { click: () => (x.fill ? fill(x.fill) : doSend({ text: x.text })) } },
        h('span', { text: x.text }), icon('chev'))),
      h('button', { type: 'button', className: 'chat-ex', on: { click: openCamera } }, h('span', { text: '拍一道不会的题' }), icon('chev')),
      // 0.5.0 课文陪读 (ui-textread.js, app.textread): a page of the textbook, read with the teacher sentence by sentence
      ctx.textread && typeof ctx.textread.open === 'function'
        ? h('button', { type: 'button', className: 'chat-ex', on: { click: () => ctx.textread.open() } }, h('span', { text: '拍一页课文，陪我读' }), icon('chev')) : null);
  }

  function render() {
    const msgs = chat.messages();
    const cur = chat.thread();
    bubbles.clear();
    const kids = [];
    if (!msgs.length) kids.push(greeting(), exampleBlock());
    const lastTeacher = [...msgs].reverse().find(m => m.role === 'assistant') || null;
    const lastMsg = msgs[msgs.length - 1] || null;
    let prev = null;
    for (const m of msgs) {
      if (prev !== null && m.thread !== prev) kids.push(divider());
      prev = m.thread;
      kids.push(m.role === 'user' ? userBubble(m) : teacherBubble(m, { last: m === lastTeacher && m === lastMsg && m.thread === cur }));
    }
    if (lastMsg && lastMsg.thread !== cur) kids.push(divider(), exampleBlock());
    if (!chat.isBusy()) {
      if (offer) kids.push(retellBlock(offer));
      else if (weekAsk) kids.push(weekAskBlock());
    }
    list.replaceChildren(...kids);
    updateComposer();
  }

  // one teacher message changed while it streams: redraw only that bubble, at most once a frame
  let queued = null, framePending = false;
  function onUpdate(m) {
    if (!bubbles.get(m.id) || !m.pending) { queued = null; stick = nearEnd() || stick; render(); scrollEnd(); return; }
    queued = m;
    if (framePending) return;
    framePending = true;
    const run = () => {
      framePending = false;
      const x = queued; queued = null;
      if (!x) return;
      stick = nearEnd();
      const cur = bubbles.get(x.id);
      if (!cur) render(); else fillBody(cur.body, x);
      scrollEnd();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
  }

  function renderOlder() {
    const days = chat.history();
    if (!days.length) { older.replaceChildren(h('p', { className: 'small chat-older-none', text: '前几天还没问过问题。' })); return; }
    older.replaceChildren(h('p', { className: 'chat-ex-h small', text: '前几天问过的' }), ...days.map(d => {
      const asks = d.messages.filter(m => m.role === 'user' && !m.quick);
      const first = asks[0] ? (asks[0].text || '（一张照片）') : '';
      return h('details', { className: 'chat-day' },
        h('summary', null, h('span', { className: 'chat-day-date', text: dateCn(d.date) }),
          h('span', { className: 'chat-day-sum small', text: `${asks.length} 个问题` + (first ? `：${first.length > 18 ? first.slice(0, 18) + '…' : first}` : '') })),
        h('div', { className: 'chat-day-list' }, d.messages.map(m => (m.role === 'user' ? userBubble(m) : teacherBubble(m, { old: true })))));
    }));
  }
  function toggleOlder() {
    olderOpen = !olderOpen;
    older.hidden = !olderOpen;
    olderBtn.classList.toggle('on', olderOpen);
    if (olderOpen) { renderOlder(); window.scrollTo(0, 0); }
  }

  // ---------------------------------------------------------------- scrolling
  const nearEnd = () => {
    const doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 200;
  };
  function scrollEnd(force = false) {
    if (!force && !stick) return;
    const go = () => window.scrollTo(0, document.documentElement.scrollHeight);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
  }

  // ---------------------------------------------------------------- sending
  function updateComposer() {
    const busy = chat.isBusy();
    sendBtn.textContent = busy ? '停一下' : '发送';
    sendBtn.classList.toggle('chat-stop', busy);
    sendBtn.disabled = !busy && (preparing || (!input.value.trim() && !pendingImage));
    camBtn.disabled = busy;
    micBtn.disabled = busy;
    newBtn.disabled = busy;
  }
  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(Math.max(input.scrollHeight, 48), 168) + 'px';
    input.style.overflowY = input.scrollHeight > 168 ? 'auto' : 'hidden';
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!chat.isBusy()) doSend();
    }
  }
  function fill(text) {
    input.value = text;
    grow();
    updateComposer();
    try { input.focus(); input.setSelectionRange(text.length, text.length); } catch (e) { /* older Safari */ }
  }

  async function doSend({ text, send = '', quick = '' } = {}) {
    if (chat.isBusy() || preparing) return;
    const fromBox = text === undefined;
    const t = String(fromBox ? input.value : text).trim();
    const image = fromBox ? pendingImage : null;
    if (!t && !image) return;
    if (fromBox) { input.value = ''; grow(); }
    if (image) clearPhoto();
    closePop();
    stick = true;
    const p = chat.send({ text: t, image, send, quick }, { onUpdate });
    render();
    scrollEnd(true);
    try { await p; } catch (e) { console.warn('chat:', (e && e.message) || e); }
    render();
    scrollEnd();
  }
  async function retry(id) {
    stick = true;
    const p = chat.retry(id, { onUpdate });
    render();
    try { await p; } catch (e) { console.warn('chat:', (e && e.message) || e); }
    render();
    scrollEnd();
  }
  async function recheck(m) {
    if (chat.isBusy()) return;
    try { await chat.flag(m.id); } catch (e) { /* the question still goes */ }
    doSend({ text: C.RECHECK.label, send: C.RECHECK.send, quick: C.RECHECK.id });
  }
  function newQuestion() {
    if (chat.isBusy()) return;
    const msgs = chat.messages();
    if (msgs.length && msgs[msgs.length - 1].thread !== chat.thread()) { input.focus(); return; }   // already a fresh one
    chat.newThread();
    render();
    scrollEnd(true);
  }

  // ---------------------------------------------------------------- the photo
  function openCamera() {
    if (chat.isBusy()) return;
    fileInput.click();
  }
  async function onFile() {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    preparing = true;
    updateComposer();
    photoBox.hidden = false;
    photoBox.replaceChildren(h('p', { className: 'small', text: '照片准备中…' }));
    try {
      const r = await imageToJpeg(f, { maxSide: 1600, quality: 0.8 });
      pendingImage = r.dataUrl;
      showPhoto();
    } catch (e) {
      clearPhoto();
      toast((e && e.message) || '这张照片打不开，换一张再试。', 3000);
    } finally {
      preparing = false;
      updateComposer();
    }
  }
  function showPhoto() {
    if (!pendingImage) { clearPhoto(); return; }
    photoBox.hidden = false;
    photoBox.replaceChildren(
      h('img', { className: 'chat-photo-img', src: pendingImage, alt: '要问的题' }),
      h('div', { className: 'chat-photo-side' },
        h('p', { className: 'small', text: '加一句想问什么，比如“第 3 题为什么选 B”。不写也可以，直接发送。' }),
        h('button', { type: 'button', className: 'text-btn', on: { click: () => { clearPhoto(); updateComposer(); } } }, icon('close'), h('span', { text: '不要这张' }))));
    updateComposer();
  }
  function clearPhoto() {
    pendingImage = null;
    photoBox.hidden = true;
    photoBox.replaceChildren();
  }

  // ---------------------------------------------------------------- a word she taps
  function wordInfo(raw) {
    const w = String(raw || '').replace(/[’‘]/g, "'").trim();
    const q = w === 'I' ? w : w.toLowerCase();
    let word = q, base = q, cn = '', note = '';
    try {
      const e = ctx.words && ctx.words.get && ctx.words.get(slugify(q));
      if (e && e.brief_cn) { cn = e.brief_cn; word = base = e.headword || q; }
    } catch (e) { /* the dictionary next */ }
    if (!cn) {
      try {
        const d = ctx.dict && ctx.dict.find ? ctx.dict.find(q) : null;
        if (d) { cn = briefCn(d.cn); if (d.via && d.word && d.word.toLowerCase() !== q) { note = `是 ${d.word} 的变化形式`; base = d.word; } }
      } catch (e) { /* nothing found */ }
    }
    return { word, base, cn, note };
  }
  function openWord(raw) {
    const info = wordInfo(raw);
    if (!info.word) return;
    pop.replaceChildren(
      h('div', { className: 'chat-pop-top' },
        h('span', { className: 'chat-pop-w', lang: 'en', text: info.word }),
        h('button', { type: 'button', className: 'say', 'aria-label': '读一遍', on: { click: e => ctx.say(info.word, e.currentTarget) } }, icon('speak')),
        info.note ? h('span', { className: 'small', text: info.note }) : null,
        h('button', { type: 'button', className: 'text-btn chat-pop-close', 'aria-label': '收起', on: { click: closePop } }, icon('close'))),
      h('p', { className: 'chat-pop-cn', text: info.cn || '这里没有现成的意思，点“查词”看看。' }),
      h('button', { type: 'button', className: 'text-btn accent chat-pop-look', on: { click: () => { closePop(); if (ctx.lookup) ctx.lookup(info.base || info.word); } } },
        h('span', { text: '查词' }), icon('chev')));
    pop.hidden = false;
    try { if (ctx.events && ctx.events.log) ctx.events.log({ type: 'lookup', step: 'chat', query: info.word, source: 'chat', from: 'chat' }); } catch (e) { /* never blocks */ }
  }
  function closePop() { pop.hidden = true; pop.replaceChildren(); }

  // ---------------------------------------------------------------- hold to talk (voice-input.js through ctx.voiceInput)
  function voiceApi() {
    let v = ctx.voiceInput;
    if (!v) return null;
    if (typeof v === 'function' && !v.start && !v.startRecording) { try { v = v(); } catch (e) { return null; } }
    if (!v || !(v.start || v.startRecording) || !(v.stop || v.stopRecording)) return null;
    try { if (typeof v.available === 'function' && v.available() === false) return null; } catch (e) { return null; }
    return v;
  }
  function voiceError(err) {
    if (err && err.name === 'NotAllowedError') return '要先允许用麦克风，再按住说一次。';
    if (err && typeof err.kid === 'string' && err.kid) return err.kid;
    if (err && (err.code === 'network' || err.code === 'offline' || err.code === 'timeout')) return '语音这会儿连不上，先打字问吧。';
    return '没听清，再按住说一次。';
  }
  function setMic(state) {
    micBtn.classList.toggle('on', state === true);
    micBtn.classList.toggle('wait', state === 'wait');
    micLabel.textContent = state === true ? '松开就好' : state === 'wait' ? '在听写…' : '按住说话';
    input.placeholder = state === true ? '正在听你说…' : '问老师……';
  }
  function setupMic() {
    micBtn.addEventListener('contextmenu', e => e.preventDefault());
    micBtn.addEventListener('pointerdown', async e => {
      if (chat.isBusy() || rec) return;
      e.preventDefault();
      const api = voiceApi();
      if (!api) { toast('语音输入还没接好，先打字问吧。', 2500); return; }
      try { micBtn.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      const r = { api, base: input.value, t0: Date.now(), started: null };
      rec = r;
      setMic(true);
      const start = api.start || api.startRecording;
      try {
        r.started = Promise.resolve(start.call(api, { lang: 'zh-CN', onPartial: t => { if (rec === r) { input.value = joinText(r.base, String(t || '')); grow(); } } }));
        await r.started;
      } catch (err) {
        if (rec === r) { rec = null; setMic(false); input.value = r.base; toast(voiceError(err), 2500); }
      }
    });
    const end = async cancel => {
      const r = rec;
      if (!r) return;
      rec = null;
      const quick = Date.now() - r.t0 < 350;
      if (cancel || quick) {
        setMic(false);
        try { const c = r.api.cancel || r.api.stop || r.api.stopRecording; if (c) await c.call(r.api); } catch (err) { /* dropped anyway */ }
        input.value = r.base;
        grow();
        if (quick && !cancel) toast('按住说话，说完再松开。', 2000);
        return;
      }
      setMic('wait');
      try {
        await r.started;
        const stop = r.api.stop || r.api.stopRecording;
        const text = String((await stop.call(r.api)) || '').trim();
        if (text) input.value = joinText(r.base, text);
        else if (input.value === r.base) toast('没听清，再按住说一次。', 2000);
      } catch (err) {
        toast(voiceError(err), 2500);
      } finally {
        setMic(false);
        grow();
        updateComposer();
      }
    };
    micBtn.addEventListener('pointerup', () => end(false));
    micBtn.addEventListener('pointercancel', () => end(true));
  }

  return {
    show(params = {}) {
      const p = params || {};
      render();
      const notes = refreshNotebook();
      if (p.retell) {
        notes.then(() => {
          const e = offer && offer.key === p.retell ? offer : null;
          if (e) startRetell(e); else render();
        });
        return;
      }
      notes.then(() => { if (!chat.isBusy()) { const near = nearEnd(); render(); if (near) scrollEnd(true); } });
      if (p.image) { pendingImage = String(p.image); showPhoto(); }
      // send as a string: the bubble shows ask, the teacher gets the longer question with its background
      if (p.ask && typeof p.send === 'string' && p.send.trim() && !p.image && !chat.isBusy() && !preparing) {
        doSend({ text: String(p.ask), send: p.send.trim() });
        return;
      }
      if (p.ask) { input.value = String(p.ask); grow(); updateComposer(); }
      if (p.send && (p.ask || p.image)) doSend();
      else scrollEnd(true);
    },
    onChange() { if (!chat.isBusy()) render(); },
    hide() {
      closePop();
      if (rec) { const r = rec; rec = null; setMic(false); try { const c = r.api.cancel || r.api.stop || r.api.stopRecording; if (c) c.call(r.api); } catch (e) { /* dropped */ } }
    },
    inSession: () => chat.isBusy() || !!rec,
    holding: () => !!input.value.trim() || !!pendingImage,
  };
}
