// Pure logic for the device check page (check/index.html + page.js). No DOM, no network, no storage here, so
// tests/check-page.test.mjs can import it in node. DESIGN.md 10.2 says what is tested and why.
//
// Every check ends in one of: pass 通过 / fail 不通过 / look 要人看一眼, or is still todo 没测 / run 检测中 / skip 跳过.
// The page never calls a model, never sends anything anywhere (CSP connect-src 'self'), never reads a key, and never
// opens the app's "emma" database: its own storage is the "emma-check" database and "emma-check." localStorage keys.

export const CHECK_VERSION = '2';                    // keep equal to CACHE in check/sw.js ('emma-check-' + this)
export const DB_NAME = 'emma-check';                  // the only IndexedDB database this page ever opens
export const LS = 'emma-check.';                      // prefix of every localStorage key this page writes

export const STATUS = {
  pass: '通过', fail: '不通过', look: '要人看一眼', todo: '没测', run: '检测中', skip: '跳过',
};

// Report order. auto: runs when the page opens; hand: needs Wei's hands, eyes or ears.
export const ITEMS = [
  { key: 'version', group: 'auto', title: '系统版本', why: '18.4 以上才有 webm 录音和主屏幕 App 的屏幕常亮；26 有数据库偶尔卡住的已知问题' },
  { key: 'standalone', group: 'auto', title: '从主屏幕打开', why: '主屏幕 App 和 Safari 标签页的数据是分开的两份，要从图标打开才准' },
  { key: 'idb', group: 'auto', title: '本机数据库', why: '单词本、作答记录都存在这里（IndexedDB）' },
  { key: 'persist', group: 'auto', title: '数据不被系统清掉', why: 'persist() 拿到了，空间紧张时系统也不会自动清' },
  { key: 'sw', group: 'auto', title: '离线也能打开', why: 'Service Worker 把页面存在本机，没网也能开' },
  { key: 'wake', group: 'auto', title: '屏幕常亮', why: '上课和录音时屏幕不自己黑掉（wakeLock）' },
  { key: 'screen', group: 'auto', title: '横竖屏宽度', why: '竖屏一栏最宽 720，横屏居中' },
  { key: 'camera', group: 'hand', title: '拍照', why: '拍课本、拍老师批改过的听写本' },
  { key: 'mic', group: 'hand', title: '麦克风录音', why: '以后的“读出来”要录音；看格式和权限隔天还弹不弹' },
  { key: 'tts', group: 'hand', title: '系统语音', why: '千问的声音出问题时退回系统声音' },
  { key: 'keyboard', group: 'hand', title: '键盘联想条', why: '候选词会露答案：露的话拼写题改用字母块' },
  { key: 'pencil', group: 'hand', title: 'Apple Pencil 随手写', why: '会不会把她写错的词自动改对，改对了听写就测不准' },
];

// The misspelled words Wei writes with the Pencil (and one for the keyboard). Kid-level words, common mistakes.
export const PENCIL_WORDS = [
  { wrong: 'freind', right: 'friend' },
  { wrong: 'scool', right: 'school' },
  { wrong: 'beatiful', right: 'beautiful' },
  { wrong: 'tomorow', right: 'tomorrow' },
  { wrong: 'wensday', right: 'wednesday' },
];
export const KEYBOARD_WORD = { prefix: 'beau', wrong: 'freind', right: 'friend' };

// Recording formats, best first (DESIGN 10.3: webm/opus if there is one, else mp4).
export const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'];
export function pickMime(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';
  for (const m of MIME_CANDIDATES) { try { if (isTypeSupported(m)) return m; } catch (_) {} }
  return '';
}

// ---------------------------------------------------------------- versions
export function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

// iPadOS Safari sends a Mac UA by default ("Macintosh; Intel Mac OS X 10_15_7"), so an iPad is a Mac UA with touch.
// Since 26 the OS number in the UA is frozen at 18_6; Safari's Version/ follows the real system version. A Home Screen
// web app's UA may have no Version/ at all.
export function parseUA(ua, maxTouchPoints = 0) {
  ua = String(ua || '');
  const mac = /Macintosh/.test(ua);
  const device = /\biPad\b/.test(ua) || (mac && maxTouchPoints > 1) ? 'iPad' : /\biPhone\b/.test(ua) ? 'iPhone' : mac ? 'Mac' : 'other';
  const m = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)_(\d+)(?:_(\d+))?/);
  const os = m ? m.slice(1).filter(Boolean).join('.') : null;
  const safari = (ua.match(/Version\/(\d+(?:\.\d+)*)/) || [])[1] || null;
  return { device, os, safari, frozen: !!os && cmpVer(os, '18.6') >= 0 };
}

// feats: { atLeast: '26' | '18.4' | '' } from feature detection (page.js). manual: what Wei typed from Settings.
export function versionVerdict(ua, feats = {}, manual = '') {
  const man = String(manual || '').trim().match(/^\d+(?:\.\d+){0,2}$/) ? String(manual).trim() : '';
  let v = null, from = '';
  if (man) { v = man; from = '你在“设置”里看到的'; }
  else if (ua.safari && ua.device !== 'other') { v = ua.safari; from = '读自 Safari Version/' + ua.safari; }
  else if (ua.os && !ua.frozen) { v = ua.os; from = '读自 UA 里的系统号'; }
  const dev = ua.device === 'iPad' ? 'iPad' : ua.device === 'iPhone' ? '这是 iPhone，不是 iPad' : ua.device === 'Mac' ? '这是 Mac，不是 iPad' : '认不出设备';
  const guess = feats.atLeast ? `按功能推断至少 ${feats.atLeast}` : '';
  if (!v) {
    return { status: 'look', version: null, detail: ['UA 里读不到真实版本', guess, dev, '请到“设置 → 通用 → 关于本机”看 iPadOS 版本，填在下面'].filter(Boolean).join(' · ') };
  }
  const name = (ua.device === 'iPhone' ? 'iOS ' : ua.device === 'Mac' ? 'Safari ' : 'iPadOS ') + v;
  const parts = [name + `（${from}）`, dev];
  let status;
  if (cmpVer(v, '18.4') < 0) { status = 'fail'; parts.push('低于 18.4：录音没有 webm，主屏幕 App 的屏幕常亮不可靠。请先升级系统'); }
  else if (parseInt(v, 10) === 26) { status = 'look'; parts.push('26 有数据库偶尔卡住的已知问题：看“本机数据库”那一行；能升 27 最好'); }
  else status = 'pass';
  if (ua.device !== 'iPad' && status === 'pass') status = 'look';
  return { status, version: v, detail: parts.join(' · ') };
}

// ---------------------------------------------------------------- handwriting / keyboard
const norm = s => String(s || '').trim().toLowerCase().replace(/[.,!?;:'"“”‘’]+$/g, '');
// kept: written as is (good) · fixed: turned into the right spelling (bad) · other: read as something else · empty
export function classifyWord(got, wrong, right) {
  const g = norm(got);
  if (!g) return 'empty';
  if (g === norm(wrong)) return 'kept';
  if (g === norm(right)) return 'fixed';
  return 'other';
}
export const WORD_RESULT = { kept: '保留原样', fixed: '被改对了', other: '认成了别的', empty: '没写' };

export function pencilVerdict(rows) {
  const r = rows.map(x => ({ ...x, result: classifyWord(x.got, x.wrong, x.right) }));
  const n = k => r.filter(x => x.result === k).length;
  const list = r.filter(x => x.result !== 'empty').map(x => `${x.wrong} → ${norm(x.got)}（${WORD_RESULT[x.result]}）`).join('；');
  let status, head;
  if (n('fixed')) { status = 'fail'; head = `${n('fixed')} 个被改成了正确拼写：随手写会帮她改错，听写和拼写题不能用笔写进输入框`; }
  else if (n('empty') === r.length) { status = 'todo'; head = '还没写'; }
  else if (n('empty')) { status = 'todo'; head = `写了 ${r.length - n('empty')} / ${r.length} 个`; }
  else if (n('kept') === r.length) { status = 'pass'; head = '5 个都保留原样，没有被改对'; }
  else { status = 'look'; head = `${n('other')} 个认成了别的词（不是改对，是没认准）：看一眼是不是字写得太潦草`; }
  return { status, rows: r, detail: [head, list].filter(Boolean).join(' · ') };
}

// suggest: Wei's answer about the bar ('none' | 'shown' | ''), typed: what the field holds after "freind" + space
export function keyboardVerdict({ suggest = '', typed = '' } = {}) {
  const words = String(typed || '').toLowerCase().match(/[a-z]+/g) || [];
  const auto = words.includes(KEYBOARD_WORD.right) ? 'fixed' : words.includes(KEYBOARD_WORD.wrong) ? 'kept' : '';
  const parts = [];
  if (auto === 'fixed') parts.push(`打 ${KEYBOARD_WORD.wrong} 加空格被自动改成了 ${KEYBOARD_WORD.right}`);
  if (auto === 'kept') parts.push(`打 ${KEYBOARD_WORD.wrong} 加空格没有被改`);
  if (suggest === 'shown') parts.push('键盘上方出现了候选词，会露答案');
  if (suggest === 'none') parts.push('键盘上方没有候选词');
  let status;
  if (suggest === 'shown' || auto === 'fixed') status = 'fail';
  else if (suggest === 'none' && auto === 'kept') status = 'pass';
  else if (suggest === 'none') status = 'look';
  else status = 'todo';
  if (status === 'fail') parts.push('拼写题改用字母块');
  if (status === 'look') parts.push(`还差一步：清空后打 ${KEYBOARD_WORD.wrong} 再按空格`);
  if (status === 'todo' && !parts.length) parts.push('还没测');
  return { status, auto, detail: parts.join(' · ') };
}

// ---------------------------------------------------------------- storage, screen, wake lock
export const fmtBytes = n => (!Number.isFinite(n) ? '?' : n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB'
  : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

export function persistVerdict({ supported, persisted, usage, quota, standalone, error } = {}) {
  if (!supported) return { status: 'fail', detail: '这个系统没有 navigator.storage.persist()' };
  if (error) return { status: 'fail', detail: '申请出错：' + error };
  const room = Number.isFinite(quota) ? `已用 ${fmtBytes(usage)} / 配额约 ${fmtBytes(quota)}` : '读不到配额';
  if (Number.isFinite(quota) && quota < 200 * 1048576) return { status: 'look', detail: `${persisted ? '已拿到持久存储' : '没拿到持久存储'} · ${room} · 配额偏小，看一眼 iPad 存储是不是快满了` };
  if (persisted) return { status: 'pass', detail: `已拿到持久存储，系统不会自动清 · ${room}` };
  return { status: 'look', detail: `没拿到持久存储 · ${room} · ` + (standalone ? '主屏幕 App 里也没拿到：数据有被系统清掉的风险，要靠每周备份' : 'Safari 标签页里通常拿不到，从主屏幕图标打开再看') };
}

// seen: { portrait: { w, h }, landscape: { w, h } } in CSS px. col: the app's column (720) plus 16 px each side.
export function screenVerdict(seen = {}, col = 720) {
  const p = seen.portrait, l = seen.landscape;
  const fmt = (o, label) => `${label} ${o.w} × ${o.h}`;
  const parts = [];
  if (p) parts.push(fmt(p, '竖屏'));
  if (l) parts.push(fmt(l, '横屏'));
  const narrow = [p, l].some(o => o && o.w < 600);
  if (p) parts.push(p.w >= col + 32 ? `竖屏放得下 ${col} 的一栏` : `竖屏比 ${col} 窄，一栏会占满宽度`);
  if (narrow) return { status: 'look', detail: parts.concat('有一个方向不到 600 宽：是不是开了分屏或台前调度？关掉再转一次').join(' · ') };
  if (p && l) return { status: 'pass', detail: parts.join(' · ') };
  return { status: 'todo', detail: parts.concat(p ? '把 iPad 横过来' : '把 iPad 竖过来').join(' · ') };
}

// ok: the lock was granted; confirm: Wei's answer ('on' | 'off' | ''); version: the real system version if known
export function wakeVerdict({ supported, ok, error, version, standalone, confirm = '' } = {}) {
  if (!supported) return { status: 'fail', detail: '没有 navigator.wakeLock（16.4 起才有）' };
  if (confirm === 'off') return { status: 'fail', detail: '接口说开了，但屏幕还是黑了' };
  if (!ok) return { status: error ? 'todo' : 'run', detail: error ? `没开成（${error}）· 点“再试一次”` : '正在申请' };
  if (confirm === 'on') return { status: 'pass', detail: '已开，放着不动屏幕也一直亮着' };
  if (standalone && version && cmpVer(version, '18.4') < 0) return { status: 'look', detail: '接口开了，但 18.4 以前的主屏幕 App 里不一定真有效：放着别动，过了自动锁定时间看屏幕黑不黑' };
  return { status: 'pass', detail: '已开（本页开着时屏幕不会自己黑）。想确认的话，放着别动等过了自动锁定时间' };
}

// ---------------------------------------------------------------- the copied text
const pad = n => String(n).padStart(2, '0');
export function fmtLocal(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}（${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}）`;
}

// Anything that looks like a key or token is cut, in case one was typed into a test field.
export function scrub(text) {
  return String(text)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-（已隐去）')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer（已隐去）')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '（长串已隐去）');
}

export function counts(results) {
  const c = { pass: 0, fail: 0, look: 0, todo: 0, skip: 0, run: 0 };
  for (const it of ITEMS) { const s = (results[it.key] || {}).status || 'todo'; c[s] = (c[s] || 0) + 1; }
  return c;
}
export const countLine = c => `通过 ${c.pass} · 不通过 ${c.fail} · 要人看一眼 ${c.look} · 没测 ${c.todo + c.run}` + (c.skip ? ` · 跳过 ${c.skip}` : '');

// results: { key: { status, detail, extra: [lines] } }; env: { at, href, mode, ua, screen }
export function reportText(results, env = {}) {
  const lines = [
    'Emma 的英语老师 · 设备体检结果',
    `时间：${env.at || fmtLocal()}`,
    `页面：体检 v${CHECK_VERSION} · ${env.href || ''}`,
    `打开方式：${env.mode || '不知道'}`,
    `汇总：${countLine(counts(results))}`,
    '',
  ];
  for (const it of ITEMS) {
    const r = results[it.key] || { status: 'todo', detail: '还没测' };
    lines.push(`[${STATUS[r.status] || r.status}] ${it.title}：${r.detail || ''}`);
    for (const x of r.extra || []) lines.push('    ' + x);
  }
  lines.push('', '明细');
  if (env.ua) lines.push('UA：' + env.ua);
  if (env.screen) lines.push('屏幕：' + env.screen);
  for (const x of env.more || []) lines.push(x);
  lines.push('（本页不联网、不调用模型、不含任何 Key）');
  return scrub(lines.join('\n'));
}
