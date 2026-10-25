// 读出来（roadmap-gaps 4、DESIGN 2.3、5.7）：读完一集或每日阅读以后，挑含目标词的 2 句，一句一句来：
// 听老师读一句 → 按住读一句（本机录音）→ 听自己读的 → 再听老师读，对比。不打分。
// 可选“老师听听”：把她这一段交给语音识别，只标出好像没读到的词（rec.js missedWords），对上的不到一半就说没听清，不冤枉她。
// 录音只存在这台 iPad 上（rec.js：库 emma-rec，留 7 天、最多 30 段）。样式 css/readaloud.css（类名 ra-）。
// 负责：读出来（rec.js、ui-readaloud.js、css/readaloud.css、tests/gaps-c.test.mjs）。
//
// 导出
//   renderReadAloud(container, ctx, { sentences, onDone, sid?, step = 'read', label = '读出来', doneLabel = '接着上课', teacher = true, rec? }) -> Controller
//     sentences：[{ en, zh?, words?: [目标词], item?, ref? }]，通常是 reader.js readAloudPick(ep) 或 ui-reader onDone 的 readAloud；最多读前 4 句。
//     teacher：给不给“老师听听”。只有 ctx.voiceInput.transcribe(blob, { lang: 'en' }) -> Promise<文字> 有的时候才显示（模拟模式假装听到少了一个词）。
//     rec：测试用，换掉 rec.js 的 createRec(ctx)。
//     做完点 doneLabel：onDone({ done: true, n, recorded, compared, checked, ms, results: [{ item, en, recorded, plays, compared, checked, missed }] })；
//     没有句子：马上 onDone({ done: false, n: 0 })。中途离开：调 stop()，不调 onDone。
//     每句离开时记一条事件 read_aloud { item, mode: 'read', step, sid, sentence, recorded, ms, plays, compared, checked, missed }
//     （events.js 还没有这个类型时 log 返回 null，照样往下走；见 wip/b6/gaps-c-needs.md）。
//   Controller = { el, onKey(ev), stop() }   onKey：空格 = 听老师读这句。
//   ctx 用到：say、voice（stop）、events（log、sessionId）、voiceInput（transcribe，可选）、settings()、mockForced()、toast。
import { h, icon } from './ui-dom.js';
import { createRec, missedWords, REC_COPY } from './rec.js';

export const MAX_SENTENCES = 4;
const MOCK_HEARD = en => { const ws = String(en).split(/\s+/); if (ws.length > 3) ws.splice(Math.floor(ws.length / 2), 1); return ws.join(' '); };

function sidOf(ctx, sid) {
  if (sid) return sid;
  try { return ctx && ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : ''; } catch (e) { return ''; }
}
const isMock = ctx => { try { return !!((ctx.settings && ctx.settings() || {}).mock) || !!(ctx.mockForced && ctx.mockForced()); } catch (e) { return false; } };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the sentence with its target words in bold (notebooks counts for notebook)
function sentenceNodes(en, words = []) {
  const ws = words.map(w => String(w || '').trim()).filter(Boolean);
  if (!ws.length) return [en];
  const re = new RegExp(`\\b(${ws.map(w => escRe(w) + '[a-z]*').join('|')})\\b`, 'gi');
  const out = [];
  let at = 0;
  for (const m of String(en).matchAll(re)) {
    if (m.index > at) out.push(en.slice(at, m.index));
    out.push(h('b', { className: 'ra-target' }, m[0]));
    at = m.index + m[0].length;
  }
  if (at < en.length) out.push(en.slice(at));
  return out;
}

export function renderReadAloud(container, ctx = {}, opts = {}) {
  const { onDone = () => {}, step = 'read', label = '读出来', doneLabel = '接着上课', teacher = true } = opts;
  const list = (Array.isArray(opts.sentences) ? opts.sentences : []).filter(s => s && String(s.en || '').trim()).slice(0, MAX_SENTENCES)
    .map((s, k) => ({ en: String(s.en).trim(), zh: String(s.zh || ''), words: Array.isArray(s.words) ? s.words : [], item: String(s.item || s.ref || `ra:${k + 1}`) }));
  const el = h('div', { className: 'ra' });
  container.replaceChildren(el);
  const st = { stopped: false };
  const ctl = { el, onKey: () => {}, stop: () => { st.stopped = true; try { rec.release(); } catch (e) { /* fine */ } stopVoice(); } };
  const rec = opts.rec || createRec(ctx);
  if (!list.length) { setTimeout(() => { if (!st.stopped) onDone({ done: false, n: 0 }); }, 0); return ctl; }
  const sid = sidOf(ctx, opts.sid);
  const t00 = Date.now();
  const results = [];
  const transcribe = ctx.voiceInput && typeof ctx.voiceInput.transcribe === 'function' ? (b => ctx.voiceInput.transcribe(b, { lang: 'en' })) : null;
  const canCheck = () => !!teacher && (isMock(ctx) || !!transcribe);
  let micOk = rec.supported(), opened = false;
  function stopVoice() { try { if (ctx.voice && typeof ctx.voice.stop === 'function') ctx.voice.stop(); } catch (e) { /* fine */ } }
  const say = (text, btn) => { try { rec.stopPlay(); if (typeof ctx.say === 'function') return ctx.say(text, btn || null); } catch (e) { /* fine */ } return null; };
  const log = ev => { try { return ctx.events && typeof ctx.events.log === 'function' ? ctx.events.log({ sid, step, mode: 'read', ...ev }) : null; } catch (e) { return null; } };

  function show(k) {
    if (st.stopped) return;
    const s = list[k];
    const r = { item: s.item, en: s.en, recorded: false, plays: 0, compared: false, checked: false, missed: null };
    let clip = null, holding = false, recording = false, checking = false;
    const msg = h('p', { className: 'ra-msg small', 'aria-live': 'polite' });
    const say1 = h('button', { type: 'button', className: 'text-btn accent ra-listen', on: { click: ev => say(s.en, ev.currentTarget) } }, icon('speak'), ' 听老师读');
    const hold = h('button', { type: 'button', className: 'btn ra-hold' }, micOk ? '按住读' : '读好了');
    const mine = h('button', { type: 'button', className: 'text-btn ra-mine', hidden: true, on: { click: () => playMine() } }, '听我读的');
    const both = h('button', { type: 'button', className: 'text-btn ra-both', hidden: true, on: { click: () => compare() } }, '对比听');
    const check = h('button', { type: 'button', className: 'text-btn ra-check', hidden: true, on: { click: () => listen() } }, '老师听听');
    const heard = h('p', { className: 'ra-heard', hidden: true });
    const last = k === list.length - 1;
    const next = h('button', { type: 'button', className: 'text-btn accent ra-next', on: { click: () => leave() } }, last ? '读完了' : '下一句');
    const after = () => {
      mine.hidden = !clip || !clip.blob && !clip.mock;
      both.hidden = mine.hidden;
      check.hidden = !(clip && canCheck()) || r.checked;
    };
    function playMine() {
      if (!clip) return Promise.resolve();
      stopVoice();
      r.plays++;
      mine.disabled = true;
      return rec.play(clip).finally(() => { mine.disabled = false; });
    }
    async function compare() {
      r.compared = true;
      both.disabled = true;
      try {
        msg.textContent = '先听你读的……';
        await playMine();
        if (st.stopped) return;
        msg.textContent = '再听老师读。';
        await say(s.en, null);
        msg.textContent = '哪里不一样，就再按住读一次。';
      } finally { both.disabled = false; }
    }
    async function listen() {
      if (!clip || checking) return;
      checking = true;
      check.disabled = true;
      heard.hidden = false;
      heard.textContent = '老师在听……';
      try {
        const text = clip.mock || !clip.blob ? MOCK_HEARD(s.en) : await transcribe(clip.blob);
        if (st.stopped) return;
        const res = missedWords(s.en, text);
        r.checked = true;
        r.missed = res.unsure ? null : res.missed;
        heard.replaceChildren(...(res.unsure ? ['老师没听清，没关系。读出声就有用。']
          : res.ok ? ['每个词都读到了。']
          : ['这几个词好像没读到：', ...res.missed.map((w, i) => [i ? '、' : '', h('b', { className: 'ra-miss', lang: 'en' }, w)]).flat(), '。再听老师读一遍，跟着读。']));
      } catch (e) {
        heard.textContent = '老师这会儿听不了，读出声就有用。';
      } finally { checking = false; check.disabled = false; after(); }
    }
    async function down(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (!micOk || recording) return;
      holding = true;
      rec.stopPlay();
      stopVoice();
      try {
        if (!opened) { await rec.open(); opened = true; }
        if (!holding || st.stopped) { msg.textContent = REC_COPY.short; return; }
        await rec.start();
        recording = true;
        hold.classList.add('on');
        hold.textContent = '在录，读完松开';
        msg.textContent = '';
        if (!holding) up();
      } catch (e) {
        holding = false;
        if (e && (e.name === 'NotAllowedError' || /nodevice/.test(e.message || ''))) { micOk = false; hold.textContent = '读好了'; }
        msg.textContent = (e && e.kid) || REC_COPY.failed;
      }
    }
    async function up() {
      holding = false;
      if (!recording) return;
      recording = false;
      hold.classList.remove('on');
      hold.textContent = '再按住读一次';
      let c = null;
      try { c = await rec.stop({ item: s.item, en: s.en }); } catch (e) { c = null; }
      if (st.stopped) return;
      if (!c) { msg.textContent = REC_COPY.short; if (!clip) hold.textContent = '按住读'; return; }
      clip = c;
      r.recorded = true;
      r.ms = c.ms;
      r.checked = false;
      heard.hidden = true;
      msg.textContent = '录好了。听听自己读的，再听老师读。';
      after();
    }
    hold.addEventListener('pointerdown', down);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) hold.addEventListener(t, () => { if (holding || recording) up(); });
    hold.addEventListener('contextmenu', ev => { if (ev && ev.preventDefault) ev.preventDefault(); });
    hold.addEventListener('click', () => { if (!micOk) { r.recorded = false; r.spoke = true; msg.textContent = '好。再听老师读一遍，对一对。'; } });
    function leave() {
      rec.stopPlay();
      stopVoice();
      if (recording) { recording = false; rec.cancel(); }
      log({ type: 'read_aloud', item: s.item, sentence: s.en, recorded: r.recorded, ms: r.ms || 0, plays: r.plays, compared: r.compared, checked: r.checked,
        ...(r.missed ? { missed: r.missed } : {}) });
      results.push(r);
      if (last) finish(); else show(k + 1);
    }
    ctl.onKey = ev => { if (ev && (ev.key === ' ' || ev.code === 'Space')) { if (ev.preventDefault) ev.preventDefault(); say(s.en, say1); } };
    el.replaceChildren(
      h('p', { className: 'ra-chip' }, h('span', { className: 'ra-tag' }, label), h('span', { className: 'ra-sub' }, `第 ${k + 1} 句 / 共 ${list.length} 句`)),
      k === 0 ? h('p', { className: 'ra-how small' }, '先听老师读，再按住按钮自己读。读完听听自己的，和老师的比一比。不打分。') : null,
      h('p', { className: 'ra-en', lang: 'en' }, ...sentenceNodes(s.en, s.words)),
      s.zh ? h('p', { className: 'ra-zh' }, s.zh) : null,
      h('div', { className: 'ra-row' }, say1),
      h('div', { className: 'ra-hold-wrap' }, hold),
      msg,
      h('div', { className: 'ra-row' }, mine, both, check),
      heard,
      h('div', { className: 'ra-foot' }, next));
    if (!micOk) msg.textContent = REC_COPY.nodevice;
  }
  function finish() {
    try { rec.release(); } catch (e) { /* fine */ }
    const recorded = results.filter(r => r.recorded).length;
    const sum = { done: true, n: results.length, recorded, compared: results.filter(r => r.compared).length, checked: results.filter(r => r.checked).length,
      ms: Date.now() - t00, results: results.map(r => ({ ...r })) };
    ctl.onKey = () => {};
    el.replaceChildren(
      h('p', { className: 'ra-chip' }, h('span', { className: 'ra-tag' }, label), h('span', { className: 'ra-sub' }, '读完了')),
      h('p', { className: 'lede' }, recorded ? `读出声了 ${results.length} 句。` : '跟着读了一遍。'),
      h('p', { className: 'ra-msg small' }, '出声读过的句子，记得更牢。录音只留在这台 iPad 上，7 天后自己删掉。'),
      h('div', { className: 'ra-foot' }, h('button', { type: 'button', className: 'btn ra-done', on: { click: () => onDone(sum) } }, doneLabel)));
  }
  show(0);
  return ctl;
}
