// 家长区里的“设置与数据”（从词典的“我”页改来）：Key、模型、发音、每天新词、备份和恢复。ui-parent.js 把它放在
// 家长区里（4 位数字码之后）；这个文件不再自己占一个页面。
// 负责：家长区 UI agent（ui-parent.js、ui-onboard.js、ui-me.js、css/parent.css、css/onboard.css）。
// 状态：从词典照搬后删掉了 Wei 专用的东西（有道和 Mac 导入、搬到新图标、图标角标）；Poe 中转站的几行在
// config POE_ENABLED 为 false 时不显示，只留一行灰着的“以后开”。家长区自己的几组（进度、期中、花费、问卷、称呼、
// 装机清单）在 ui-parent.js，通过 layout 和 hooks 放进这一页。
//
// createMeTab(ctx, { root, back, layout, hooks }) -> { show(opts), onChange(), holding(), render(), open(key) }
//   root：要画进去的元素（默认 #tab-parent 里 ui-parent 给的容器）；back：{ label, onClick }，左上角的返回
//   layout(kit) -> 元素数组：整页按什么顺序画（不给就是下面 render 里的默认顺序）。kit 里有 group、row、toggle、
//     render、open、openRows，和这里的几组：ai（服务商、Key、测一下连接）、poe、study、data、advanced（模型、测速、
//     模拟模式）、about
//   hooks：exportExtra() -> { kv, events }，并进备份；previewExtra(data) -> 文字数组，导入前多说几句；
//     afterImport(data) -> 文字数组，words.importData 之后写 kv（课本、进度……），返回导入完成后多说的几句
//   opts.open：打开就展开的那一行（'key'、'import'、'backup'…）
// A grouped document list: rows with a value and a chevron open a panel in place; switches and buttons sit on their row.
import { h, icon, toast, ago, fmtBytes, localYmd } from './ui-dom.js';
import { MODEL_CHOICES, VERSION, TTS_VOICES, TTS_MODEL, POE_MODEL_CHOICES, POE_DIRECT_URL, POE_ENABLED } from './config.js';
import { gzipJSON, parseExportBytes } from './db.js';
import { normalizePoeUrl, poeHost, providerOf } from './ai.js';
import { pageShell } from './ui-entry.js';

const SAMPLE = 'meticulous. She is meticulous about details.';
const MODEL_ROWS = [['core', '核心释义模型', '拼写判断、释义，要快'], ['extras', '扩展讲解模型', '搭配、同义词、阅读、小测'], ['zh', '中译英模型', '中文找英文说法']];

export function createMeTab(app, { root = document.getElementById('tab-parent'), back = { label: '单词', onClick: () => app.closeMe() }, layout = null, hooks = {} } = {}) {
  root.replaceChildren();
  const shell = pageShell(app, { back });
  shell.barEl.hidden = true;
  shell.el.classList.add('no-bar', 'me-page');
  shell.setTitle('家长区', false, 'zh-CN');
  root.append(shell.el);

  let prepared = null;     // {file, json, count, total, size, via}
  let importState = null;  // {name, data, preview, via} | {done, via} | {error, via} | {busy, via}
  let importVia = 'import';
  let speed = null;        // speed test: {running, results: [...]} | {error}
  let speedBox = null;     // where the speed test draws (rebuilt by every render)
  let conn = null;         // connection test (the lookup model only): {running, model} | {model, result} | {model, error}
  let connBox = null;
  const openRows = new Set();

  // the one file input; importVia says which panel asked
  const fileIn = h('input', { type: 'file', className: 'visually-hidden', accept: '.json,.gz,application/json,application/gzip', 'aria-label': '选择导入文件', tabIndex: -1 });
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) readImport(f, importVia); });
  root.append(fileIn);
  const pickFile = via => { importVia = via; fileIn.click(); };

  // ---------------------------------------------------------------- building blocks
  const group = (title, rows, foot) => h('section', { className: 'sgroup' }, h('h2', { className: 'sec-h', text: title }),
    h('ul', { className: 'rows' }, ...rows.filter(Boolean)), foot ? h('p', { className: 'small foot', text: foot }) : null);

  // key + panel: a row that opens in place; value: text on the right; right: a control on the row
  // cls: extra classes on the row (ui-parent uses parent-off for a greyed-out row)
  function row({ key = '', label, sub = '', value = null, right = null, panel = null, after = null, cls = '' }) {
    const go = !!panel;
    const open = go && openRows.has(key);
    const k = h('span', { className: 'k' }, h('b', { text: label }), sub ? h('span', { text: sub }) : null);
    const v = value !== null && value !== undefined && value !== '' ? h('span', { className: 'v', text: String(value) }) : null;
    const head = go
      ? h('button', { type: 'button', className: 'srow-head', 'aria-expanded': String(open), on: { click: () => { if (openRows.has(key)) openRows.delete(key); else openRows.add(key); render(); } } },
        k, v, icon('chev', 'chev'))
      : h('div', { className: 'srow-head' }, k, v, right, icon('chev', 'chev none'));
    return h('li', { className: 'srow' + (go ? ' go' : '') + (open ? ' open' : '') + (cls ? ' ' + cls : ''), dataset: { row: key || null } },
      head, open ? h('div', { className: 'srow-panel' }, panel()) : null, after);
  }

  function toggle(on, onChange, { disabled = false, label = '' } = {}) {
    const b = h('button', { type: 'button', className: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, disabled });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); });
    return b;
  }

  // ---------------------------------------------------------------- 百炼 and Poe keys
  const KEYS = {
    bailian: { field: 'apiKey', row: 'key', placeholder: 'sk-…', aria: '百炼 API Key', from: '百炼控制台',
      note: '只在这里填，只存在这台 iPad 里，不进备份文件。用给 Emma 单独建的 Key，只开要用的几个模型。保存时会去掉复制带进来的看不见的字符；之后只显示最后 4 位。' },
    poe: { field: 'poeKey', row: 'poekey', placeholder: '粘贴 Poe 的 API Key', aria: 'Poe API Key', from: 'poe.com/api_key',
      note: '在 poe.com/api_key 复制。只存在这台 iPad 里，不进备份文件；中转站不存 Key，只是原样转给 Poe。' },
  };
  function keyPanelFor(which) {
    const K = KEYS[which];
    return () => {
      const has = !!app.settings()[K.field];
      const input = h('input', { type: 'password', className: 'field', placeholder: K.placeholder, autocomplete: 'off', autocapitalize: 'off',
        autocorrect: 'off', spellcheck: 'false', 'aria-label': K.aria });
      requestAnimationFrame(() => input.focus());
      return [
        h('p', { className: 'small', text: K.note }),
        input,
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '保存', on: { click: async () => {
            // chat apps often add invisible characters; any left over would break the request header
            const v = input.value.replace(/[\s​-‍⁠﻿]/g, '');
            if (!v) { toast('先粘贴 Key'); return; }
            if (!/^[\x21-\x7e]+$/.test(v)) { toast(`Key 里有不认识的字符，回${K.from}重新复制一次`, 3500); return; }
            await app.saveSettings({ [K.field]: v });
            input.value = '';
            openRows.delete(K.row);
            toast('Key 已保存在这台 iPad 里');
            render();
          } } }),
          h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { openRows.delete(K.row); render(); } } }),
          has ? h('button', { type: 'button', className: 'text-btn danger', text: '清除 Key', on: { click: async () => { await app.saveSettings({ [K.field]: '' }); toast('已清除'); render(); } } }) : null)];
    };
  }

  // The relay address (DESIGN 10.8): https://host/secret/v1
  function relayPanel() {
    const s = app.settings();
    const input = h('input', { type: 'url', className: 'field', placeholder: 'https://wc.example.com/暗号/v1', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '中转站地址' });
    requestAnimationFrame(() => input.focus());
    const save = async (v, msg) => { await app.saveSettings({ poeUrl: v }); openRows.delete('relay'); speed = null; toast(msg, 3000); render(); };
    return [
      h('p', { className: 'small', text: '粘贴中转站装好时给的地址（https:// 开头，带暗号和 /v1）。地址里有暗号，只存在这台 iPad 里，不进备份文件。' }),
      input,
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: () => {
          const v = normalizePoeUrl(input.value);
          if (v === '') { toast('先粘贴中转站地址'); return; }
          if (v === null) { toast('地址不对：要 https:// 开头，像 https://wc.example.com/暗号/v1 这样', 3500); return; }
          save(v, '中转站地址已保存');
        } } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { openRows.delete('relay'); render(); } } }),
        // abroad, or with a VPN on, Poe answers directly
        s.poeUrl !== POE_DIRECT_URL ? h('button', { type: 'button', className: 'text-btn', text: '改成直连', on: { click: () => save(POE_DIRECT_URL, '改成直连 api.poe.com（在国内要开 VPN）') } }) : null,
        s.poeUrl ? h('button', { type: 'button', className: 'text-btn danger', text: '清除', on: { click: () => save('', '已清除') } }) : null)];
  }

  // poe: the Poe model slots (no default migration there, so no modelsChosen)
  function modelPanel(k, label, poe = false) {
    return () => {
      const choices = poe ? POE_MODEL_CHOICES : MODEL_CHOICES;
      const field = poe ? 'poeModels' : 'models';
      const cur = app.settings()[field][k];
      const sel = h('select', { className: 'select', 'aria-label': label });
      const ids = choices.map(c => c.id);
      for (const m of [...new Set([...ids, cur].filter(Boolean))]) {
        const c = choices.find(x => x.id === m);
        sel.append(h('option', { value: m, text: c ? `${m} · ${c.label}` : m }));
      }
      sel.append(h('option', { value: '__custom', text: '自己填…' }));
      sel.value = cur;
      const custom = h('div', { className: 'custom', hidden: true });
      const ci = h('input', { type: 'text', className: 'field', placeholder: poe ? '模型名，比如 grok-4.7' : '模型名，比如 qwen-plus-latest', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': '自定义模型名' });
      // modelsChosen: from now on this profile keeps its models when a new version changes the defaults
      const pick = async v => {
        await app.saveSettings(poe ? { poeModels: { ...app.settings().poeModels, [k]: v } } : { models: { ...app.settings().models, [k]: v }, modelsChosen: true });
        toast(`${label}改用 ${v}`);
      };
      custom.append(ci, h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: async () => {
          const v = ci.value.trim();
          if (!v) return;
          await pick(v);
          render();
        } } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { custom.hidden = true; sel.value = cur; } } })));
      sel.addEventListener('change', async () => {
        if (sel.value === '__custom') { custom.hidden = false; ci.focus(); return; }
        await pick(sel.value);
        render();
      });
      return [sel, custom];
    };
  }

  // the speed test row, drawn in the group of whoever answers lookups now
  function speedRow() {
    speedBox = h('div', { className: 'speed-box' });
    paintSpeed();
    return h('li', { className: 'srow' }, speedBox);
  }

  // 服务商, the greyed Poe row (v0), the key and the connection test: what a parent needs
  function aiRows() {
    const s = app.settings();
    const poe = s.provider === 'poe';
    return [
      row({ label: '服务商', sub: poe ? '查词走 Poe，发音还用百炼' : '查词、讲解、朗读都走百炼', value: poe ? 'Poe' : '百炼' }),
      POE_ENABLED ? null : row({ label: 'Poe 中转站', sub: '中转站搭好了再开', value: '以后开', cls: 'parent-off' }),
      row({ key: 'key', label: 'Key', sub: poe ? '查词现在走 Poe，这个 Key 还用来发音' : '', value: s.apiKey ? '····' + s.apiKey.slice(-4) : '还没填', panel: keyPanelFor('bailian') }),
      connRow(),
    ];
  }
  // the three model slots, the full speed test and mock mode: rarely touched
  function advancedRows() {
    const s = app.settings();
    const forced = app.mockForced();
    const poe = s.provider === 'poe';
    return [
      ...(poe ? [] : MODEL_ROWS.map(([k, label, sub]) => row({ key: 'm-' + k, label, sub, value: s.models[k], panel: modelPanel(k, label) }))),
      poe ? null : speedRow(),
      row({ label: '模拟模式', sub: forced ? '地址里带了 ?mock=1，这次打开一直是模拟模式' : '不调模型，返回假数据（会存进本机单词本），只在测试时打开',
        right: toggle(s.mock || forced, v => app.saveSettings({ mock: v }).then(() => { toast(v ? '已打开模拟模式' : '已关闭模拟模式'); app.refreshBanners(); }), { disabled: forced, label: '模拟模式' }) }),
    ];
  }
  const bailianGroup = () => group('百炼', [...aiRows(), ...advancedRows()]);
  const aiGroup = () => group('AI 服务', aiRows());
  const advancedGroup = () => group('高级', advancedRows(), '模型一般不用改。测速会把每个模型都查一次。');

  // Connection test: the speed test's approach with one model, the lookup one (core); nothing is stored.
  function connRow() {
    connBox = h('div', { className: 'speed-box' });
    paintConn();
    return h('li', { className: 'srow' }, connBox);
  }
  async function runConn() {
    if (conn && conn.running) return;
    const model = providerOf(app.settings()).models.core;
    conn = { running: true, model };
    paintConn();
    try {
      const [r] = await app.ai.speedTest({ choices: [{ id: model }] });
      conn = { model, result: r };
    } catch (e) {
      conn = { model, error: (e && e.message) || String(e) };
    }
    paintConn();
  }
  function paintConn() {
    if (!connBox) return;
    const st = conn || {};
    const model = providerOf(app.settings()).models.core;
    const r = st.result;
    let line = null;
    if (st.error) line = h('p', { className: 'speed-err', role: 'alert', text: st.error });
    else if (r && r.ok && r.json) line = h('p', { className: 'small parent-good', role: 'status', text: `连上了：${(r.ms / 1000).toFixed(1)} 秒，查词正常（${st.model}）` });
    else if (r) line = h('p', { className: 'speed-err', role: 'alert', text: `${r.ok ? '连上了，但查词不正常' : '没连上'}：${r.error || '没有详情'}` });
    connBox.replaceChildren(...[
      h('div', { className: 'srow-head' },
        h('span', { className: 'k' }, h('b', { text: '测一下连接' }), h('span', { text: `用查词的模型 ${model} 查一个词，不到 1 分钱` })),
        h('button', { type: 'button', className: 'text-btn accent speed-btn', text: st.running ? '正在测…' : '测一下', disabled: !!st.running,
          'aria-busy': st.running ? 'true' : null, on: { click: runConn } })),
      line].filter(Boolean));
  }

  // Poe through the relay (SPEC 5.2): one switch says who answers lookups; the voice stays on Bailian.
  function poeGroup() {
    const s = app.settings();
    const on = s.provider === 'poe';
    const ready = !!s.poeUrl && !!s.poeKey;
    const flip = v => app.saveSettings({ provider: v ? 'poe' : 'bailian' }).then(() => { speed = null; toast(v ? '查词改走 Poe' : '查词改回百炼'); render(); });
    return group('Poe', [
      row({ label: '查词用 Poe', sub: on ? '查词、讲解、中译英、故事都走 Poe，发音还用百炼' : ready ? '打开后查词改走 Poe 的模型' : '先填下面的中转站地址和 Key',
        right: toggle(on, flip, { disabled: !on && !ready, label: '查词用 Poe' }) }),
      row({ key: 'relay', label: '中转站地址', value: s.poeUrl ? poeHost(s.poeUrl) : '还没填', panel: relayPanel }),
      row({ key: 'poekey', label: 'Key', value: s.poeKey ? '····' + s.poeKey.slice(-4) : '还没填', panel: keyPanelFor('poe') }),
      ...(on ? MODEL_ROWS.map(([k, label, sub]) => row({ key: 'pm-' + k, label, sub, value: s.poeModels[k], panel: modelPanel(k, label, true) })) : []),
      on ? speedRow() : null,
    ], on ? null : '在国内用 Poe 要走新加坡中转站；搭好后把地址和 Poe Key 填在这里。');
  }

  // Speed test (SPEC 2.4): each model once with the saved key, one after another; nothing is stored.
  async function runSpeed() {
    if (speed && speed.running) return;   // a second tap while it runs does nothing
    speed = { running: true, results: [] };
    paintSpeed();
    try {
      await app.ai.speedTest({ onResult: r => { if (speed && speed.results) { speed.results.push(r); paintSpeed(); } } });
      speed.running = false;
    } catch (e) {
      speed = { error: (e && e.message) || String(e) };
    }
    paintSpeed();
  }
  function paintSpeed() {
    if (!speedBox) return;
    const st = speed || {};
    // replaceChildren would print a null as text, so the optional parts are filtered out
    speedBox.replaceChildren(...[
      h('div', { className: 'srow-head' },
        h('span', { className: 'k' }, h('b', { text: '模型测速' }), h('span', { text: providerOf(app.settings()).id === 'poe' ? '每个模型查一次，总共约 5 美分的 Poe 积分' : '每个模型查一次，总共不到 5 分钱' })),
        h('button', { type: 'button', className: 'text-btn accent speed-btn', text: st.running ? '正在测…' : '测一下速度', disabled: !!st.running,
          'aria-busy': st.running ? 'true' : null, on: { click: runSpeed } })),
      st.error ? h('p', { className: 'speed-err', role: 'alert', text: st.error }) : null,
      st.results ? speedList(st) : null].filter(Boolean));
  }
  function speedList(st) {
    const done = st.results;
    const good = r => r.ok && r.json;
    // the fastest model whose reply came back as valid JSON, once every model has been tried
    const best = st.running ? null : done.filter(good).sort((a, b) => a.ms - b.ms)[0] || null;
    return h('div', { className: 'speed-result' },
      h('ul', { className: 'speed-list', 'aria-live': 'polite' },
        ...providerOf(app.settings()).choices.map((c, i) => {
          const r = done.find(x => x.id === c.id);
          const sub = h('span', { className: 'speed-sub', text: `${c.label} · ${c.note}` });
          if (!r) {
            const now = st.running && i === done.length;
            return h('li', { className: 'speed-item' + (now ? ' now' : ' wait') },
              h('span', { className: 'speed-id', text: c.id }), h('span', { className: 'speed-val' + (now ? ' dots' : ''), text: now ? '正在测' : '等待' }), sub);
          }
          return h('li', { className: 'speed-item' + (r === best ? ' best' : '') },
            h('span', { className: 'speed-id' }, c.id, r === best ? h('span', { className: 'tag', text: '最快' }) : null),
            h('span', { className: 'speed-val' + (good(r) ? '' : ' bad'), text: `${(r.ms / 1000).toFixed(1)} 秒 · ${good(r) ? 'JSON 正常' : r.ok ? 'JSON 出错' : '出错'}` }),
            sub,
            r.error ? h('span', { className: 'speed-err', text: r.error }) : null);
        })),
      h('p', { className: 'small', text: '价格是每百万 tokens 的输入 / 输出' }));
  }

  // ---------------------------------------------------------------- 查词与复习
  function newPanel() {
    const num = h('span', { className: 'num step-n', text: String(app.settings().newPerDay) });
    const step = d => async () => {
      const v = Math.max(0, Math.min(20, app.settings().newPerDay + d));
      await app.saveSettings({ newPerDay: v, newPerDayChosen: true });
      num.textContent = String(v);
      const val = root.querySelector('[data-row="new"] .v');
      if (val) val.textContent = String(v);
    };
    return [h('p', { className: 'small', text: '热身里每天最多开几个新词，每次加减 1' }),
      h('div', { className: 'stepper' },
        h('button', { type: 'button', className: 'step', 'aria-label': '减少', on: { click: step(-1) } }, icon('minus')), num,
        h('button', { type: 'button', className: 'step', 'aria-label': '增加', on: { click: step(1) } }, icon('plus')))];
  }

  // Pronunciation (SPEC 2.4): Qwen voice or system voice; the default follows whether a key is set.
  function voicePanel() {
    const s = app.settings();
    const mode = app.voice.mode();
    const canQwen = !!s.apiKey || !!s.mock || app.mockForced();
    const choice = (val, title, sub) => h('button', { type: 'button', className: 'choice' + (mode === val ? ' on' : ''), role: 'radio',
      'aria-checked': String(mode === val), on: { click: async () => { if (mode === val) return; app.voice.stop(); await app.saveSettings({ voiceMode: val }); render(); } } },
    h('span', { className: 'choice-dot', 'aria-hidden': 'true' }),
    h('span', { className: 'choice-main' }, h('span', { className: 'choice-title', text: title }), h('span', { className: 'choice-sub', text: sub })));
    let picker;
    if (mode === 'qwen') {
      picker = h('select', { className: 'select', 'aria-label': '千问音色' });
      for (const [name, cn] of TTS_VOICES) picker.append(h('option', { value: name, text: `${name} · ${cn}` }));
      picker.value = TTS_VOICES.some(v => v[0] === s.qwenVoice) ? s.qwenVoice : TTS_VOICES[0][0];
      picker.addEventListener('change', () => { app.voice.stop(); app.saveSettings({ qwenVoice: picker.value, voiceChosen: true }); });
    } else {
      const voices = app.speech.list();
      picker = h('select', { className: 'select', 'aria-label': '系统语音' });
      picker.append(h('option', { value: '', text: voices.length ? '自动选择' : '自动选择（还没读到语音）' }));
      for (const v of voices) picker.append(h('option', { value: v.name, text: `${v.name} · ${v.lang}` }));
      picker.value = voices.some(v => v.name === s.voice) ? s.voice : '';
      picker.addEventListener('change', () => app.saveSettings({ voice: picker.value }));
    }
    // 试听 always tries the Qwen voice again, even while it is paused after a failure
    const test = h('button', { type: 'button', className: 'text-btn accent say-test', on: { click: ev => app.say(SAMPLE, ev.currentTarget, { retry: true }) } }, icon('speak'), '试听');
    let note;
    const problem = mode === 'qwen' && canQwen ? app.voice.problem() : null;
    if (problem) note = problem.message;
    else if (mode === 'qwen') {
      note = canQwen ? `按字数计费，一个词不到 0.001 元；听过的存在 iPad 里，再听不花钱${audioCount ? `（已存 ${audioCount} 段）` : ''}。Key 要开通 ${TTS_MODEL}。`
        : '还没填百炼 Key，现在先用系统语音。';
    } else note = app.speech.supported ? '' : '这个浏览器不支持系统语音。';
    return [
      h('div', { className: 'choices', role: 'radiogroup', 'aria-label': '发音' },
        choice('qwen', '千问语音', '静音也能播，音质好，花费很少'),
        choice('system', '系统语音', '免费，静音时没声音')),
      h('div', { className: 'voice-pick' }, picker, test),
      note ? h('p', { className: 'small' + (problem ? ' danger' : ''), text: note }) : null];
  }

  function dictRow() {
    const st = app.dict.status();
    if (st.state === 'ready') return row({ label: '离线词典', sub: '查词时先显示基础释义，没网也能看', value: `${st.words.toLocaleString('zh-CN')} 个词` });
    if (st.state === 'error') {
      // app.js already words network failures in Chinese; anything else in English gets a plain line
      const why = m => (/[一-鿿]/.test(String(m)) ? String(m) : '网络不通，连上网后点“重试”');
      return row({ label: '离线词典', sub: '没载入：' + why(st.error), right: h('button', { type: 'button', className: 'text-btn accent', text: '重试', on: { click: () => {
        app.dict.load().then(() => toast('离线词典已载入'), e => toast('还是没载入：' + why((e && e.message) || e), 3000)).finally(render);
        render();
      } } }) });
    }
    return row({ label: '离线词典', sub: '查词时先显示基础释义，没网也能看', value: '正在载入…' });
  }

  function studyGroup() {
    const s = app.settings();
    return group('查词与复习', [
      row({ label: '先猜再看', sub: '查到单词本里的词，先想意思再看答案，并记一次复习', right: toggle(s.guessFirst, v => app.saveSettings({ guessFirst: v }), { label: '先猜再看' }) }),
      row({ key: 'new', label: '每天新词', value: s.newPerDay, panel: newPanel }),
      row({ key: 'voice', label: '发音', value: app.voice.mode() === 'qwen' ? '千问语音' : '系统语音', panel: voicePanel }),
      dictRow(),
    ]);
  }

  // ---------------------------------------------------------------- 数据
  // the export flow: pack, then share to 文件 inside the next tap
  function exportBox(via) {
    const label = '导出备份';
    if (!prepared) return h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: label, disabled: preparing, on: { click: () => prepare(via) } }));
    if (prepared.downloaded) {
      // a download gives no signal that a file was saved, so ask before clearing the reminder
      return h('div', {},
        h('p', { className: 'small', text: `已经开始下载“${prepared.file.name}”。确认文件存好了，再点“存好了”。` }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '存好了', on: { click: () => exported('download') } }),
          h('button', { type: 'button', className: 'text-btn accent', text: '存到“文件”', on: { click: share } }),
          h('button', { type: 'button', className: 'text-btn', text: '再下载一次', on: { click: () => download(prepared.file) } })));
    }
    return h('div', {},
      h('p', { className: 'small', text: `文件准备好了：${prepared.file.name}（${fmtBytes(prepared.size)}，${prepared.total} 个词）。在分享面板里选“存储到文件”。` }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '存到“文件”', on: { click: share } }),
        h('button', { type: 'button', className: 'text-btn', text: '改用下载', on: { click: () => download(prepared.file) } })));
  }

  function importCard(via) {
    const s = importState;
    if (!s || s.via !== via) return null;
    if (s.error) return h('p', { className: 'small danger', role: 'alert', text: s.error });
    if (s.busy) return h('p', { className: 'small dots', text: s.busy });
    if (s.done) {
      const r = s.done;
      return h('div', { className: 'result', role: 'status' },
        h('p', { text: `导入完成：新增 ${r.added} 个，合并 ${r.merged} 个，${r.unchanged} 个没变化${r.zhAdded ? `，中译英 ${r.zhAdded} 条` : ''}。` }),
        h('p', { className: 'small', text: `单词本 ${r.before.library} → ${r.after.library} 个，全部 ${r.before.total} → ${r.after.total} 个。` }),
        ...(s.extra || []).map(t => h('p', { className: 'small', text: t })));
    }
    const d = s.data, p = s.preview;
    return h('div', { className: 'result' },
      h('p', { className: 'small', text: `“${s.name}”：导出于 ${localYmd(d.exported_at) || '未知日期'}，${p.total} 个词（单词本里 ${p.incomingFav} 个），中译英 ${(d.zh || []).length} 条。` }),
      h('p', { className: 'small', text: `导入后：新增 ${p.added} 个，合并 ${p.merged} 个，${p.unchanged} 个没变化${p.skipped ? `，${p.skipped} 条格式不对跳过` : ''}。现在单词本 ${p.before.library} 个。导入不会删除任何东西。` }),
      ...(s.extra || []).map(t => h('p', { className: 'small', text: t })),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '导入', on: { click: doImport } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { importState = null; render(); } } })));
  }

  const backupPanel = () => {
    const le = app.lastExport();
    return [h('p', { className: 'small', text: le ? `上次备份：${ago(le.at)}（${le.count} 个收藏）` : '上次备份：还没有' }),
      h('p', { className: 'small', text: hooks.exportExtra ? '单词、课本、进度、问卷和学习记录打包成一个文件（不含 Key 和家长数字码），存到“文件”里。'
        : '单词和记录打包成一个文件（不含 Key），存到“文件”里。' }), exportBox('backup')];
  };
  const importPanel = () => [
    h('p', { className: 'small', text: '单元包（课本词）或这个 App 导出的备份（.json / .json.gz）。先看一眼要导入什么，再点“导入”。合并，不删除任何东西' }),
    h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '选择文件', on: { click: () => pickFile('import') } })),
    importCard('import')];

  function dataGroup() {
    const le = app.lastExport();
    const st = app.words.stats(app.settings().newPerDay);
    return group('数据', [
      row({ key: 'backup', label: '备份', value: le ? `上次 ${ago(le.at)}` : '还没有', panel: backupPanel }),
      row({ key: 'import', label: '导入文件', panel: importPanel }),
      row({ label: '存储', sub: storageText, value: storageUsed }),
      row({ label: '统计', sub: `单词本 ${st.library}（新词 ${st.fresh} · 学习中 ${st.learning} · 已掌握 ${st.mastered}）· 最近查过 ${st.cache} · 中译英 ${st.zh} · 复习记录 ${st.reviews} · 查询日志 ${logCount}` }),
    ], '数据只在这台 iPad 里。请一直从主屏幕图标打开，别删了图标再添加。');
  }

  function aboutGroup() {
    return group('关于', [
      row({ label: 'Emma 的英语老师', value: `v${VERSION}` }),
      h('li', { className: 'srow go link-row' }, h('a', { href: './check/', className: 'link', text: '设备体检页' }), icon('chev', 'chev')),
    ], '基础释义来自开源词典 ECDICT（MIT 协议）');
  }

  // ---------------------------------------------------------------- export
  let preparing = false;
  async function prepare(via = 'backup') {
    if (preparing) return;
    preparing = true;
    try {
      app.busy(+1);
      toast('正在打包…', 4000);
      const at = new Date();
      const data = await app.words.exportData();
      // the parent area adds kv (everything but settings and the code) and the events (CONTRACTS.md 5.1)
      if (hooks.exportExtra) Object.assign(data, (await hooks.exportExtra()) || {});
      const gz = await gzipJSON(data);
      const name = `emma-backup-${localYmd(at)}.json.gz`;
      prepared = { file: new File([gz], name, { type: 'application/gzip' }), data, size: gz.byteLength, at: at.toISOString(),
        count: data.entries.filter(e => e.favorited).length, total: data.entries.length, via };
      toast('文件准备好了');
    } catch (e) {
      toast('打包失败：' + (e.message || e), 4000);
    } finally { preparing = false; app.busy(-1); render(); }
  }
  async function exported(how) {
    if (!prepared) return;
    // the snapshot time, not the share time: “上次备份” and the shrink check follow the data in the file
    await app.recordExport({ at: prepared.at, count: prepared.count, total: prepared.total });
    toast(how === 'share' ? '备份好了' : '记下了这次备份', 3000);
    prepared = null;
    render();
  }
  function share() {
    const p = prepared;
    if (!p) return;
    const canFiles = files => { try { return !!(navigator.canShare && navigator.canShare({ files })); } catch (e) { return false; } };
    let files = [p.file];
    if (!canFiles(files)) {
      // some browsers refuse .gz in the share sheet; plain JSON is bigger but goes through
      const plain = new File([JSON.stringify(p.data)], p.file.name.replace(/\.gz$/, ''), { type: 'application/json' });
      files = canFiles([plain]) ? [plain] : null;
    }
    if (!files || !navigator.share) { download(p.file); return; }
    navigator.share({ files, title: files[0].name }).then(() => exported('share'), err => {
      if (err && err.name === 'AbortError') toast('取消了，还没保存');
      // no automatic download here: the tap is used up, and iOS may silently drop it
      else toast('没存成：' + ((err && err.message) || err) + '。可以点“改用下载”', 4000);
    });
  }
  function download(file) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name, className: 'visually-hidden' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 30000);
    if (prepared) prepared.downloaded = true;
    render();
  }

  // ---------------------------------------------------------------- import
  async function readImport(file, via = 'import') {
    importState = { busy: `正在读“${file.name}”`, via };
    render();
    try {
      const data = await parseExportBytes(await file.arrayBuffer());
      const preview = await app.words.previewImport(data);
      const extra = hooks.previewExtra ? (await hooks.previewExtra(data)) || [] : [];
      importState = { name: file.name, data, preview, extra, via };
    } catch (e) {
      importState = { error: '导入失败：' + (e.message || e), via };
    }
    render();
  }
  async function doImport() {
    const s = importState;
    if (!s || !s.data) return;
    const via = s.via;
    importState = { busy: '正在导入，词多的话要十几秒', via };
    render();
    app.busy(+1);
    try {
      const r = await app.words.importData(s.data);
      // kv (textbook, progress, ...) after the words, then the curriculum reloads (CONTRACTS.md 5.2)
      const extra = hooks.afterImport ? (await hooks.afterImport(s.data)) || [] : [];
      importState = { done: r, extra, via };
      toast('导入完成');
      app.refreshBanners();
      app.updateBadge();
    } catch (e) {
      importState = { error: '导入失败：' + (e.message || e), via };
    } finally { app.busy(-1); }
    render();
  }

  // ---------------------------------------------------------------- storage + render
  let storageText = '检查中…';
  let storageUsed = '';
  let logCount = 0;
  let audioCount = 0;
  async function refreshStorage() {
    const parts = [];
    try {
      if (navigator.storage && navigator.storage.persisted) parts.push((await navigator.storage.persisted()) ? '已锁定，系统不会清掉' : '没有持久存储（从主屏幕打开时通常会有）');
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        storageUsed = fmtBytes(est.usage || 0);
        if (est.quota) parts.push(`可用 ${fmtBytes(est.quota)}`);
      }
    } catch (e) { parts.push('读不到存储状态'); }
    storageText = parts.join(' · ') || '这个浏览器不提供存储状态';
    try { logCount = await app.store.countLog(); } catch (e) { /* ignore */ }
    try { audioCount = await app.store.countAudio(); } catch (e) { /* ignore */ }
  }

  // open one row (and scroll to it); ui-parent's checklist uses this
  function open(key) {
    openRows.add(key);
    render();
    requestAnimationFrame(() => { const r = root.querySelector(`[data-row="${key}"]`); if (r) r.scrollIntoView({ block: 'center' }); });
  }
  const kit = { group, row, toggle, render: () => render(), open, openRows,
    ai: aiGroup, poe: () => (POE_ENABLED ? poeGroup() : null), study: studyGroup, data: dataGroup, advanced: advancedGroup, about: aboutGroup };

  function render() {
    connBox = null;
    speedBox = null;
    if (layout) shell.body.replaceChildren(...layout(kit).filter(Boolean));
    else {
      shell.body.replaceChildren(
        h('h1', { className: 'page-title', text: '设置与数据' }),
        ...[bailianGroup(), POE_ENABLED ? poeGroup() : null, studyGroup(), dataGroup(), aboutGroup()].filter(Boolean));
    }
    shell.refreshRule();
  }

  const typing = () => root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  let changeTimer = 0;
  render();
  return {
    show({ open: key } = {}) {
      if (key) open(key); else render();
      refreshStorage().then(() => { if (!typing()) render(); });
    },
    onChange() {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => { if (app.currentRoute() === 'parent' && !(importState && importState.busy) && !typing()) render(); }, 200);
    },
    // something on this page would be lost by an automatic reload
    holding: () => !!prepared || preparing || !!(importState && (importState.data || importState.busy)) || !!(speed && speed.running) || !!(conn && conn.running),
    render: () => render(),
    open,
  };
}
