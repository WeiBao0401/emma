// 周小结页（DESIGN 9 周小结草图、3.6）：Emma 和家长看同一页。上面是这一周（做了几天、新会写的词、进步最大、课本进度、
// 可以聊的、提醒），底部“发给家长”；下面是“老师记得的你”四段，每条（下周的计划除外）后面有“这不对”。
// 负责：周小结 agent（weekly.js、ui-weekly.js、css/weekly.css）。数字和句子都在 weekly.js，这里只画。
//
// 导出
//   createWeeklyView(ctx, { root }) -> { show(params), onChange(), holding(), inSession() }
//     渲染进 #tab-weekly（root 不给时）。params：{ week?: 'YYYY-MM-DD'（那周的周一） }，不给按 weekly.defaultWeek：
//     周日 18:00 起和周一、周二没看过的那一周优先。左上角“今天”回首页。打开那周的新小结就记“看过了”（kv 'weekly.seen'）。
//   buildBackup(ctx) -> Promise<{ file, plain(), at, count, total }>   “发给家长”附的备份，格式和家长区导出的一样
//     （CONTRACTS 5.1：words.exportData() 加 kv（除 settings、parent.pin）和全部 events，gzip）。ctx.backupFile 有的话用它。
//
// 发给家长：系统分享（navigator.share）发这页的文字，同时附上备份文件。打开页面就先在后台把备份打好包，点的时候直接分享
//   （iPad 上分享必须紧跟着点按，不能先等打包）。不能分享文件的设备只发文字，并提示去家长区导出；完全不能分享的显示文字让人抄。
//   分享带上了文件就调 ctx.recordExport，“上次备份”跟着更新。
//
// 用到的 ctx：kv、events（query、log）、words（get、exportData）、curriculum（unitTitle、unitOf、tags）、go、toast、
//   statusSlot、parentName、recordExport、busy；可选 backupFile。
import { h, icon, toast as baseToast, localYmd } from './ui-dom.js';
import { gzipJSON } from './db.js';
import { exportKv } from './ui-parent.js';
import * as W from './weekly.js';

export async function buildBackup(ctx) {
  if (typeof ctx.backupFile === 'function') return ctx.backupFile();
  const at = new Date();
  const data = await ctx.words.exportData();
  data.kv = exportKv(ctx.kv.keys('').map(k => [k, ctx.kv.peek(k)]));
  try { data.events = await ctx.events.query({ limit: 1e6 }); } catch (e) { data.events = []; }
  const gz = await gzipJSON(data);
  const name = `emma-backup-${localYmd(at)}.json.gz`;
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return {
    file: new File([gz], name, { type: 'application/gzip' }),
    // some share sheets refuse .gz; plain JSON is bigger but goes through
    plain: () => new File([JSON.stringify(data)], name.replace(/\.gz$/, ''), { type: 'application/json' }),
    at: at.toISOString(), count: entries.filter(e => e && e.favorited).length, total: entries.length,
  };
}

const canShareFiles = files => { try { return !!(navigator.canShare && navigator.canShare({ files })); } catch (e) { return false; } };

export function createWeeklyView(ctx, { root = null } = {}) {
  const el = root || document.getElementById('tab-weekly');
  const toast = (m, ms) => (ctx.toast ? ctx.toast(m, ms) : baseToast(m, ms));
  let week = null;
  let weekly = null;
  let memory = null;
  let backup = null;          // { file, plain, at, count, total } once packed
  let packing = null;         // the promise while packing
  let packFailed = false;
  let sharing = false;
  let openDispute = '';       // the line whose three choices are open
  let loadN = 0;

  const page = h('div', { className: 'weekly' });
  const statusSlot = h('div', { className: 'status-slot' });
  const body = h('div', { className: 'weekly-body' });
  page.append(
    h('header', { className: 'runhead weekly-head' },
      h('button', { type: 'button', className: 'text-btn weekly-back', on: { click: () => ctx.go('home') } }, icon('back'), h('span', { text: '今天' })),
      h('span', { className: 'runhead-title', text: '这周小结' }),
      h('span', { className: 'weekly-head-end' })),
    statusSlot, body);
  if (el) { el.replaceChildren(page); }
  if (ctx.statusSlot) ctx.statusSlot(statusSlot);

  const wordOf = slug => { try { const e = ctx.words.get(slug); return (e && e.headword) || slug; } catch (e) { return slug; } };
  const cur = () => ctx.curriculum || {};
  const unitTitle = id => { try { return (cur().unitTitle && cur().unitTitle(id)) || id; } catch (e) { return id; } };
  const unitOf = slug => { try { return (cur().unitOf && cur().unitOf(wordOf(slug))) || ''; } catch (e) { return ''; } };
  const tags = () => { try { return cur().tags || {}; } catch (e) { return {}; } };

  async function load(params = {}) {
    const n = ++loadN;
    const now = new Date();
    week = params.week ? W.weekByKey(params.week) : W.defaultWeek(ctx.kv, now);
    body.replaceChildren(h('p', { className: 'weekly-loading small', text: '正在翻这周的记录…' }));
    await W.catchUp(ctx);
    let events = [];
    try { events = await ctx.events.query({ since: W.addDays(week.from, -W.HISTORY_DAYS), until: week.to, limit: 1e6 }); }
    catch (e) { events = []; }
    if (n !== loadN) return;
    weekly = W.buildWeekly({ kv: ctx.kv, events, now, week, unitTitle, wordOf, tags: tags() });
    W.rememberWritten(ctx.kv, weekly.written.met);
    const mem = W.memoryOf({ kv: ctx.kv, events, now, date: week.to, wordOf, unitTitle, unitOf, tags: tags(), written: weekly.written });
    memory = W.hideDisputed(mem, ctx.kv.peek(W.DISPUTE_KEY, {}) || {});
    if (week.key === W.newWeeklyWeek(ctx.kv, now)) W.markSeen(ctx.kv, week.key, now);
    render();
    pack();
  }

  // the backup goes along with the text; packed ahead so the share runs inside the tap
  function pack() {
    if (packing || (backup && Date.now() - Date.parse(backup.at) < 5 * 60 * 1000)) return packing;
    packFailed = false;
    packing = buildBackup(ctx).then(b => { backup = b; }, e => { console.warn('weekly: backup:', (e && e.message) || e); packFailed = true; })
      .finally(() => { packing = null; render(); });
    return packing;
  }

  async function send({ textOnly = false } = {}) {
    if (!weekly || sharing) return;
    const title = `${weekly.title}（${weekly.range}）`;
    let files = null;
    if (!textOnly && backup) {
      if (canShareFiles([backup.file])) files = [backup.file];
      else { const p = backup.plain(); if (canShareFiles([p])) files = [p]; }
    }
    const text = W.shareText(weekly, { withFile: !!files });
    if (!navigator.share) {
      showCopy(text);
      toast('这台设备不能直接分享。备份请到家长区导出。', 4000);
      return;
    }
    sharing = true;
    ctx.busy && ctx.busy(+1);
    try {
      await navigator.share(files ? { title, text, files } : { title, text });
      if (files && ctx.recordExport) await ctx.recordExport({ at: backup.at, count: backup.count, total: backup.total });
      if (files) toast('发出去了，备份也带上了', 3000);
      else if (textOnly) toast('文字发出去了', 2500);
      else toast('文字发出去了。备份文件没带上，请到家长区导出。', 4500);
    } catch (err) {
      if (err && err.name === 'AbortError') toast('取消了，还没发');
      else toast('没发出去，再点一次试试', 3000);
    } finally {
      sharing = false;
      ctx.busy && ctx.busy(-1);
    }
  }

  function showCopy(text) {
    const box = body.querySelector('.weekly-copy');
    if (box) { box.hidden = false; box.textContent = text; }
  }

  // ---------------------------------------------------------------- drawing

  function rowEl(r) {
    return h('div', { className: 'weekly-row weekly-row-' + r.id },
      h('dt', { className: 'weekly-label', text: r.label }),
      h('dd', { className: 'weekly-value', lang: r.id === 'written' ? 'en' : null, text: r.value }));
  }

  function sendBlock() {
    const ready = !!backup;
    const label = packing && !ready ? '正在准备…' : '发给家长';
    return h('div', { className: 'weekly-send' },
      h('button', { type: 'button', className: 'btn weekly-share', disabled: !!(packing && !ready), on: { click: () => send() } }, h('span', { text: label })),
      h('p', { className: 'small weekly-send-note', text: packFailed
        ? '这次备份没打好包，只能发文字。备份请到家长区导出。'
        : '把这一页的文字发出去，再附上一份学习备份。' }),
      h('div', { className: 'btn-row weekly-send-more' },
        h('button', { type: 'button', className: 'text-btn accent', text: '只发文字', on: { click: () => send({ textOnly: true }) } })),
      h('pre', { className: 'weekly-copy', hidden: true }));
  }

  function weekNav() {
    const thisWeek = W.weekOf(new Date()).key;
    const prev = W.shiftWeek(week, -1), next = W.shiftWeek(week, 1);
    return h('div', { className: 'weekly-weeks' },
      h('button', { type: 'button', className: 'text-btn', text: '上一周', on: { click: () => load({ week: prev.key }) } }),
      week.key < thisWeek ? h('button', { type: 'button', className: 'text-btn', text: next.key === thisWeek ? '这一周' : '下一周', on: { click: () => load({ week: next.key }) } }) : null);
  }

  function lineEl(l) {
    const li = h('li', { className: 'weekly-mline' }, h('span', { className: 'weekly-mtext', text: l.text }));
    if (!l.disputable) return li;
    if (openDispute === l.id) {
      li.classList.add('open');
      li.append(h('div', { className: 'weekly-choices', role: 'group', 'aria-label': '哪里不对' },
        W.DISPUTE_CHOICES.map(c => h('button', { type: 'button', className: 'weekly-choice', text: c.zh, on: { click: () => choose(l, c.id) } })),
        h('button', { type: 'button', className: 'text-btn', text: '算了', on: { click: () => { openDispute = ''; render(); } } })));
    } else {
      li.append(h('button', { type: 'button', className: 'text-btn weekly-dispute', text: '这不对', on: { click: () => { openDispute = l.id; render(); } } }));
    }
    return li;
  }

  async function choose(l, choice) {
    openDispute = '';
    await W.dispute(ctx, l, choice);
    memory = W.hideDisputed(memory, ctx.kv.peek(W.DISPUTE_KEY, {}) || {});
    render();
    toast(choice === 'forget' ? '好，老师不记这个了。' : '老师记下了，会再看看。', 2500);
  }

  function memoryBlock() {
    if (!memory) return null;
    return h('section', { className: 'weekly-memory', 'aria-label': '老师记得的你' },
      h('h2', { className: 'weekly-mtitle', text: memory.title }),
      memory.sections.map(s => {
        if (!s.lines.length && !s.empty) return null;
        return h('div', { className: 'weekly-msec weekly-msec-' + s.id },
          h('h3', { className: 'weekly-mhead', text: s.title }),
          s.lines.length ? h('ul', { className: 'weekly-mlist' }, s.lines.map(lineEl)) : h('p', { className: 'small weekly-mempty', text: s.empty }));
      }));
  }

  function render() {
    if (!weekly) return;
    const y = window.scrollY;
    body.replaceChildren(
      h('section', { className: 'weekly-sum', 'aria-label': '这一周' },
        h('p', { className: 'weekly-kicker' }, h('span', { className: 'weekly-tag', text: weekly.range })),
        h('h1', { className: 'weekly-title', text: weekly.title }),
        h('dl', { className: 'weekly-rows' }, weekly.rows.map(rowEl)),
        h('div', { className: 'weekly-talk' },
          h('p', { className: 'weekly-label', text: '可以聊的' }),
          h('p', { className: 'weekly-quote', text: `“${weekly.topic}”` })),
        h('div', { className: 'weekly-tip' },
          h('p', { className: 'weekly-label', text: '提醒' }),
          h('p', { className: 'weekly-tip-text', text: weekly.tip })),
        sendBlock(),
        weekNav()),
      memoryBlock());
    window.scrollTo(0, y);
  }

  return {
    show(params = {}) { openDispute = ''; load(params || {}); },
    onChange() { /* the page reads everything on show; nothing live to redraw */ },
    holding: () => sharing,
    inSession: () => false,
  };
}
