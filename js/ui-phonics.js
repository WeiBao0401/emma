// 语音小卡的界面（DESIGN 5.1 “语音小卡（v1）”）：本周的一个读音规律，一句中文说明，4-6 个例词（按音节分块、标出规律
// 在哪几个字母、音标、中文，点一下听老师读），然后一道小练习（3 小题：听音补字母、听音选词、按音节拼出来），最后一句结束语。
// 逻辑和内容在 phonics.js 和 curriculum/phonics.json。负责：语音小卡 agent（phonics.js、ui-phonics.js、css/phonics.css）。
//
// 导出
//   renderPhonicsCard(container, ctx, { ruleId?, onDone?, step?, sid?, now?, ipaTap?, skipReview? }) -> { el, ready, rule() }
//   renderPhonicsCard(container, ruleId | null, { app: ctx, say?, sid?, onAnswer?, onDone? })   上课“写几个词”格的叫法也认
//     把卡画进 container（清空后画）。ruleId 不给时用 phonics.weekRule 选本周的（kv 'progress' 的单元、kv 'phonics.state'）。
//     家长问卷说还没学会音标（intake.js 的 phonics.ipaTap）时音标先收起，点“看音标”才显示；说会音标（startFrom 'unit'）
//     就不先出开音节、闭音节两张复习卡。opts 里的 ipaTap / skipReview 优先。
//     给了 onAnswer 时事件交给它记（上课补 sid、step），没给就自己 ctx.events.log。
//     第一次看到这周的卡时 assignWeek 写 kv；做完 markDone 写 kv，再调 onDone({ ruleId, right, total, skipped })。
//     内容还没读时自己读（ctx.fetchJSON，没有就用 fetch）；读不到或没有可出的规律，显示一句话和“好了”，onDone 的 skipped 为真。
//     step 记进事件（默认 'write'），sid 默认 ctx.events.sessionId()。ready 是画好以后 resolve 的 Promise。
//   shuffleTiles(parts) -> [part]   字母块的顺序：打乱，但不会和正确顺序一样（纯函数，测试用）
//   focusMask(word, focus) -> [bool]   哪些字母要标出来（按 focus 里的字母组合从左往右找）
//
// 每小题记一条事件：{ type: 'answer', sid, step, item: 'ph:<规律>:<第几题>', mode: 'cloze' | 'listen' | 'mc4' | 'tiles',
//   word, choice, correct（第一次就对）, first_try: true, ms, hint_level: 0, misconception: null }
// 用到的 ctx：say、kv（peek / set）、events（log、sessionId）、curriculum（unitOf、unitOrder，可以没有）、fetchJSON（可以没有）。
import { h, icon } from './ui-dom.js';
import * as PH from './phonics.js';
import { intakeDefaults } from './intake.js';

const low = s => String(s ?? '').toLowerCase();

export function focusMask(word, focus = []) {
  const w = low(word);
  const mask = Array.from(w, () => false);
  let from = 0;
  for (const f of focus || []) {
    const k = w.indexOf(low(f), from);
    if (k < 0 || !f) continue;
    for (let i = k; i < k + f.length; i++) mask[i] = true;
    from = k + f.length;
  }
  return mask;
}

export function shuffleTiles(parts) {
  const a = parts.map((p, i) => ({ p, i }));
  if (a.length < 2) return a.map(x => x.p);
  let seed = [...parts.join('')].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.every((x, k) => x.i === k)) a.push(a.shift());
  return a.map(x => x.p);
}

// a word as syllable chunks with dots between, the rule's letters marked
function chunked(word, syl, focus, className = 'ph-chunks') {
  const mask = focusMask(word, focus);
  const out = h('span', { className, lang: 'en' });
  let pos = 0;
  syl.forEach((part, k) => {
    if (k) out.append(h('span', { className: 'ph-dot', 'aria-hidden': 'true', text: '·' }));
    const s = h('span', { className: 'ph-syl' });
    let run = '', on = null;
    const flush = () => { if (!run) return; s.append(on ? h('mark', { className: 'ph-focus', text: run }) : document.createTextNode(run)); run = ''; };
    for (const ch of part) {
      const m = !!mask[pos++];
      if (m !== on) { flush(); on = m; }
      run += ch;
    }
    flush();
    out.append(s);
  });
  out.setAttribute('aria-label', word);
  return out;
}

function sylOf(ex) {
  const parts = ex.syl ? String(ex.syl).split('·') : PH.syllables(ex.w);
  return parts.join('') === String(ex.w).replace(/\s+/g, '') ? parts : PH.syllables(ex.w);
}

const isCtx = x => !!x && typeof x === 'object' && ['kv', 'events', 'say', 'curriculum', 'go'].some(k => k in x);

export function renderPhonicsCard(container, a = {}, b = {}) {
  let ctx, opts;
  if (isCtx(a)) { ctx = a; opts = b || {}; }
  else {
    opts = { ...(b || {}) };
    ctx = opts.app || opts.ctx || {};
    const id = typeof a === 'string' ? a : a && a.id ? a.id : opts.ruleId;
    opts.ruleId = id || null;
  }
  const { onDone = null, step = 'write' } = opts;
  let profile = {};
  try { profile = (intakeDefaults(ctx.kv || {}) || {}).phonics || {}; } catch (e) { profile = {}; }
  const ipaTap = opts.ipaTap ?? !!profile.ipaTap;
  const skipReview = opts.skipReview ?? profile.startFrom === 'unit';
  const now = () => (opts.now instanceof Date ? opts.now : new Date());
  const el = container;
  el.replaceChildren();
  el.classList.add('ph');
  let rule = null;
  let finished = false;

  const sayFn = opts.say || ctx.say;
  const say = (text, btn) => { try { if (text && sayFn) sayFn(text, btn || null); } catch (e) { /* sound is a bonus */ } };
  const kvPeek = (k, d) => { try { return ctx.kv && ctx.kv.peek ? ctx.kv.peek(k, d) : d; } catch (e) { return d; } };
  const kvSet = async (k, v) => { try { if (ctx.kv && ctx.kv.set) await ctx.kv.set(k, v); } catch (e) { /* never blocks */ } };
  const sid = () => { try { return opts.sid || (ctx.events && ctx.events.sessionId ? ctx.events.sessionId() : undefined); } catch (e) { return undefined; } };
  const log = ev => {
    try {
      if (opts.onAnswer) opts.onAnswer(ev);
      else if (ctx.events && ctx.events.log) ctx.events.log({ sid: sid(), step, ...ev });
    } catch (e) { /* never blocks */ }
  };
  const put = (...nodes) => el.replaceChildren(...nodes.filter(Boolean));   // a missing note or button is just left out
  const finish = result => {
    if (finished) return;
    finished = true;
    if (onDone) { try { onDone(result); } catch (e) { /* the caller's problem */ } }
  };

  function pickRule() {
    if (opts.ruleId) return PH.ruleById(opts.ruleId);
    const cur = ctx.curriculum || null;
    const unitOf = cur && cur.unitOf ? w => { try { return cur.unitOf(w) || ''; } catch (e) { return ''; } } : null;
    const unitOrder = cur && cur.unitOrder ? u => { try { return cur.unitOrder(u); } catch (e) { return undefined; } } : null;
    return PH.weekRule(now(), kvPeek('progress', {}) || {}, { state: PH.readState(ctx.kv), unitOf, unitOrder, skipReview });
  }

  function nothing() {
    put(h('div', { className: 'ph-empty' },
      h('p', { className: 'lede', text: '这周的语音小卡还没准备好。' }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '好了', on: { click: () => finish({ ruleId: '', right: 0, total: 0, skipped: true }) } }))));
  }

  // ---------------------------------------------------------------- learn: the rule and its words
  function learn() {
    const state = PH.readState(ctx.kv);
    const wk = PH.weekKey(now());
    if (state.weeks[wk] !== rule.id) kvSet(PH.PHONICS_KEY, PH.assignWeek(state, now(), rule.id));
    const week = PH.weekInfo(now(), PH.assignWeek(state, now(), rule.id));
    const rows = (rule.words || []).map(ex => {
      const btn = h('button', { type: 'button', className: 'ph-word', 'aria-label': `听 ${ex.w}`, on: { click: ev => say(ex.w, ev.currentTarget) } },
        chunked(ex.w, sylOf(ex), ex.focus),
        h('span', { className: 'ph-ipa', lang: 'en', text: ex.ipa || '' }),
        h('span', { className: 'ph-cn', text: ex.cn || '' }),
        h('span', { className: 'ph-speak', 'aria-hidden': 'true' }, icon('speak')));
      return h('li', null, btn);
    });
    const go = h('button', { type: 'button', className: 'btn ph-go', on: { click: () => practice() } }, '做个小练习', icon('arrow'));
    el.classList.toggle('ph-ipa-tap', !!ipaTap);
    el.classList.remove('ph-ipa-on');
    const ipaBtn = ipaTap ? h('button', { type: 'button', className: 'text-btn accent ph-ipa-btn', text: '看音标', on: { click: ev => {
      const on = el.classList.toggle('ph-ipa-on');
      ev.currentTarget.textContent = on ? '收起音标' : '看音标';
    } } }) : null;
    put(
      h('p', { className: 'ph-kicker' }, h('span', { className: 'tag', text: '本周语音' }), h('span', { className: 'ph-week small', text: `第 ${week.n} 周` })),
      h('h2', { className: 'ph-title', text: rule.title }),
      h('p', { className: 'ph-rule', text: rule.rule }),
      h('div', { className: 'ph-tip-row' }, h('p', { className: 'ph-tip small', text: '点一个词，听老师读。小点把词按音节分开。' }), ipaBtn),
      h('ol', { className: 'ph-words' }, rows),
      rule.note ? h('p', { className: 'ph-note', text: rule.note }) : null,
      h('div', { className: 'btn-row ph-actions' }, go));
  }

  // ---------------------------------------------------------------- practice: three small items
  function practice() {
    const items = (rule.practice && rule.practice.items) || [];
    if (!items.length) return done(0, 0);
    let k = 0, right = 0;
    const cnOf = w => ((rule.words || []).find(x => low(x.w) === low(w)) || {}).cn || '';

    const next = () => { k++; if (k < items.length) show(); else done(right, items.length); };

    function show() {
      const item = items[k];
      const t0 = Date.now();
      let first = null, tries = 0, over = false;
      const ask = item.ask || (rule.practice && rule.practice.ask) || '';
      const feedback = h('p', { className: 'ph-feedback', role: 'status', 'aria-live': 'polite' });
      const nextBtn = h('button', { type: 'button', className: 'btn ph-next', text: k + 1 < items.length ? '下一题' : '做完了', hidden: true, on: { click: next } });
      const sayWord = item.kind === 'pick' ? item.say : item.word;
      const listen = sayWord ? h('button', { type: 'button', className: 'text-btn accent ph-listen', on: { click: ev => say(sayWord, ev.currentTarget) } }, icon('speak'), '再听一遍') : null;
      const mode = item.kind === 'gap' ? 'cloze' : item.kind === 'build' ? 'tiles' : item.say ? 'listen' : 'mc4';

      const settle = (ok, choice) => {
        if (over) return;
        over = true;
        if (first === null) first = choice;
        const firstTry = ok && tries === 0;
        if (firstTry) right++;
        log({ type: 'answer', item: `ph:${rule.id}:${k + 1}`, mode, word: item.word || item.answer, choice: first,
          correct: firstTry, first_try: true, ms: Date.now() - t0, hint_level: 0, misconception: null });
        nextBtn.hidden = false;
        try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* old WebKit */ }
      };

      let body;
      if (item.kind === 'build') {
        const parts = PH.syllables(item.word);
        const slots = parts.map(() => h('span', { className: 'ph-slot', lang: 'en' }));
        let at = 0;
        const tiles = shuffleTiles(parts).map(p => {
          const b = h('button', { type: 'button', className: 'ph-tile', lang: 'en', text: p });
          b.addEventListener('click', () => {
            if (over || b.disabled) return;
            if (p === parts[at]) {
              slots[at].textContent = p; slots[at].classList.add('on');
              b.disabled = true; b.classList.add('used');
              at++;
              if (at === parts.length) {
                feedback.textContent = tries ? `拼好了：${parts.join('·')}` : `对了：${parts.join('·')}`;
                el.classList.add('is-right');
                say(item.word);
                settle(true, parts.join('·'));
              }
            } else {
              if (first === null) first = p;
              tries++;
              b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
              feedback.textContent = `先找第 ${at + 1} 个音节，再听一遍。`;
              say(item.word);
            }
          });
          return b;
        });
        body = h('div', { className: 'ph-build' },
          h('div', { className: 'ph-slots', 'aria-label': '按顺序点音节' }, slots),
          h('p', { className: 'ph-cn ph-cue', text: cnOf(item.word) }),
          h('div', { className: 'ph-tiles' }, tiles));
      } else {
        const isGap = item.kind === 'gap';
        const gapBox = isGap ? h('span', { className: 'ph-gap', 'aria-label': '空' }, ' ') : null;
        let shown = null;
        if (isGap) {
          const [a, b] = String(item.show).split('_');
          shown = h('p', { className: 'ph-show', lang: 'en' }, a, gapBox, b);
        }
        const buttons = item.options.map(o => h('button', { type: 'button', className: 'ph-opt', lang: 'en', text: o }));
        buttons.forEach((b, i) => b.addEventListener('click', () => {
          if (over || b.disabled) return;
          const o = item.options[i];
          if (first === null) first = o;
          if (o === item.answer) {
            b.classList.add('right');
            buttons.forEach(x => { x.disabled = true; });
            if (gapBox) { gapBox.textContent = o; gapBox.classList.add('on'); }
            const w = item.word || item.answer;
            feedback.textContent = tries ? `对，是 ${o}。` : '对了。';
            el.classList.add('is-right');
            if (item.kind === 'pick' && !item.say) say(item.answer);
            else say(w);
            settle(true, o);
          } else {
            tries++;
            b.classList.add('wrong'); b.disabled = true;
            const left = buttons.filter(x => !x.disabled);
            if (left.length <= 1) {
              // only the right one is left: show it, that one counts as wrong
              const r = buttons[item.options.indexOf(item.answer)];
              r.classList.add('reveal');
              buttons.forEach(x => { x.disabled = true; });
              if (gapBox) { gapBox.textContent = item.answer; gapBox.classList.add('on'); }
              const w = item.word || item.answer;
              feedback.textContent = isGap ? `是 ${item.answer}：${PH.syllables(w).join('·')}。` : `是 ${item.answer}。`;
              say(item.say || w);
              settle(false, first);
            } else {
              feedback.textContent = '再听一遍，再选一次。';
              if (sayWord) say(sayWord);
            }
          }
        }));
        body = h('div', { className: 'ph-q' },
          shown,
          isGap && cnOf(item.word) ? h('p', { className: 'ph-cn ph-cue', text: cnOf(item.word) }) : null,
          h('div', { className: 'ph-options', role: 'group', 'aria-label': '选一个' }, buttons));
      }

      el.classList.remove('is-right');
      put(
        h('p', { className: 'ph-kicker' }, h('span', { className: 'tag', text: rule.title }), h('span', { className: 'ph-week small', text: `第 ${k + 1} / ${items.length} 题` })),
        h('p', { className: 'ph-ask', text: ask }),
        body,
        feedback,
        h('div', { className: 'ph-run-foot' }, listen, nextBtn));
      if (sayWord) say(sayWord);
    }
    show();
  }

  // ---------------------------------------------------------------- done
  function done(right, total) {
    kvSet(PH.PHONICS_KEY, PH.markDone(PH.readState(ctx.kv), rule.id, now(), { right, total }));
    el.classList.remove('is-right');
    const line = !total ? '' : right === total ? `${total} 题都对了。` : right ? `对了 ${right} 题。没对的那题，下次还会见到。` : '这几题下次还会见到，多听几遍就熟了。';
    put(h('div', { className: 'ph-done' },
      h('p', { className: 'ph-kicker' }, h('span', { className: 'tag', text: '本周语音' })),
      h('p', { className: 'lede', text: `“${rule.title}”这周练完了。` }),
      line ? h('p', { className: 'ph-done-line', text: line }) : null,
      h('p', { className: 'ph-rule ph-again small', text: rule.rule }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '好了', on: { click: () => finish({ ruleId: rule.id, right, total, skipped: false }) } }))));
  }

  const draw = () => {
    rule = pickRule();
    if (!rule) return nothing();
    learn();
  };
  let ready;
  if (PH.phonicsRules().length) { draw(); ready = Promise.resolve(); }
  else {
    put(h('p', { className: 'ph-wait small', text: '正在准备……' }));
    ready = PH.loadPhonics(ctx.fetchJSON || null).then(draw, draw);
  }
  return { el, ready, rule: () => rule };
}
