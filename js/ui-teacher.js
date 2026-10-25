// 家长区“老师每周想一次”（design/teacher-next.md 6.5）：最近一次的想法（进步了、还卡着、下周怎么教、给 Emma 看的那一句）、
// 老师看到的证据、“我问过的”再考到哪了、前几周的想法，和一个“让老师现在想一想”按钮（teacher.js thinkWeek，同一个函数）。
// 只读 kv，不改别的模块的数据。用 h() 拼，不用 innerHTML。类名一律 teacher-（css/teacher.css）。
// 负责：问老师 agent。
//
// 导出
//   renderTeacherWeek(container, ctx, { now? }) -> { el, refresh() }   画进 container（家长区那一行展开的面板里）
//       ctx 用到：kv、events、settings、mockForced、budget、curriculum、words、lines、toast、busy（都和别的 view 一样）
//   teacherRow(ctx, now?) -> { label, sub, value }   家长区那一行的字（teacher.js weekRow）
import { h, toast as baseToast } from './ui-dom.js';
import * as T from './teacher.js';

const md = day => String(day || '').slice(5, 10);
const hm = iso => { const m = String(iso || '').match(/T(\d{2}:\d{2})/); return m ? m[1] : ''; };
const PROVIDER = { poe: 'Poe', bailian: '百炼' };
const STATUS_ZH = { wait: '等再考', retell: '要换讲法', learned: '懂了', dropped: '还卡着', stale: '没考到' };

export const teacherRow = (ctx, now = new Date()) => T.weekRow(ctx.kv, now);

function listOf(items, cls = 'teacher-list') {
  return h('ul', { className: cls }, items.map(x => h('li', null,
    h('p', { className: 'teacher-item', text: x.text || x.label || '' }),
    x.evidence || x.why ? h('p', { className: 'small teacher-why', text: x.evidence || x.why }) : null)));
}

export function renderTeacherWeek(container, ctx, { now = null } = {}) {
  const el = h('section', { className: 'teacher' });
  const clock = () => (now ? new Date(now) : new Date());
  const toast = (m, ms) => (ctx.toast ? ctx.toast(m, ms) : baseToast(m, ms));
  let thinking = false, status = '';

  function head(r) {
    if (!r) return h('p', { className: 'small teacher-when', text: '每周第一次上课时，老师会把上一周的作答、读的时候卡在哪、问过的问题想一遍，写下她哪里进步了、哪里还卡着、下周怎么教。' });
    const who = r.mock ? '模拟模式，这是假的结果，不花钱' : [PROVIDER[r.provider] || '', r.model ? `（${r.model}）` : ''].join('');
    return h('p', { className: 'small teacher-when', text: `${md(r.from)} 到 ${md(r.to)}` + (r.complete ? ' 这一周' : ' 这几天') +
      `，上了 ${r.days || 0} 天课 · ${md(String(r.at).slice(0, 10))} ${hm(r.at)} 想的` + (who ? ' · ' + who : '') });
  }
  function block(title, kids) { return kids ? [h('h4', { className: 'teacher-h', text: title }), kids] : null; }

  function draw() {
    const n = clock();
    const r = T.latestWeek(ctx.kv);
    const failed = (() => { const last = T.weekKeys(ctx.kv).slice(-1)[0]; const x = last ? T.readWeek(ctx.kv, last.slice(T.WEEK_PREFIX.length)) : null; return x && x.error ? x : null; })();
    const kids = [head(r)];
    if (failed && (!r || failed.week >= r.week)) kids.push(h('p', { className: 'small teacher-err', text: `${md(String(failed.at).slice(0, 10))} 没想成：${failed.detail || failed.error}` }));
    if (r) {
      kids.push(block('进步了', (r.progress || []).length ? listOf(r.progress) : h('p', { className: 'small', text: '这一周的证据还不够，老师没写。' })));
      kids.push(block('还卡着', (r.stuck || []).length ? listOf(r.stuck) : h('p', { className: 'small', text: '没看出明显的卡点。' })));
      kids.push(block('下周怎么教', (r.next || []).length ? h('ol', { className: 'teacher-list teacher-next' }, r.next.map(x => h('li', null,
        h('p', { className: 'teacher-item', text: x.label }), x.why ? h('p', { className: 'small teacher-why', text: x.why }) : null))) : h('p', { className: 'small', text: '没挑出来。' })));
      if (r.kid) kids.push(block('给 Emma 看的一句', [h('p', { className: 'teacher-kid', text: r.kid }),
        h('p', { className: 'small', text: '她在问老师的第一页看到这一句（只说正面的）。' })]));
      if (r.evidence) kids.push(h('details', { className: 'teacher-more' }, h('summary', { text: '老师看到的证据' }), h('div', { className: 'teacher-evidence', text: r.evidence })));
    }
    const asked = T.askedSummary(T.readAsked(ctx.kv), n);
    if (asked.length) {
      kids.push(block('“我问过的”', h('ul', { className: 'teacher-list teacher-asked' }, asked.map(x => h('li', null,
        h('p', { className: 'teacher-item' }, h('span', { text: x.label }), h('span', { className: `teacher-tag teacher-${x.status}`, text: STATUS_ZH[x.status] || '' })),
        h('p', { className: 'small teacher-why', text: x.text }))))));
      kids.push(h('p', { className: 'small', text: '问老师讲过的语法点和词，讲完第 2 天、第 5 天在热身里各再考一道；做错了，她下次打开问老师，老师换个讲法再讲。' }));
    }
    const btn = h('button', { type: 'button', className: 'btn teacher-go', disabled: thinking, on: { click: think } }, thinking ? '老师在想……' : '让老师现在想一想');
    kids.push(h('div', { className: 'teacher-actions' }, btn,
      h('p', { className: 'small teacher-status', text: status || '想一次大约半分钟，花几分钱。这一周还没过完，就先想这几天的。' })));
    const older = T.weekKeys(ctx.kv).reverse().map(k => T.readWeek(ctx.kv, k.slice(T.WEEK_PREFIX.length)))
      .filter(x => x && !x.error && (!r || x.week !== r.week)).slice(0, 4);
    if (older.length) {
      kids.push(h('details', { className: 'teacher-more' }, h('summary', { text: '前几周' }), ...older.map(x => h('div', { className: 'teacher-old' },
        h('p', { className: 'teacher-item', text: `${md(x.from)} 到 ${md(x.to)}` }),
        (x.stuck || []).length ? h('p', { className: 'small', text: '还卡着：' + x.stuck.map(s => s.text).join('；') }) : null,
        (x.next || []).length ? h('p', { className: 'small', text: '下周怎么教：' + x.next.map(s => s.label).join('；') }) : null))));
    }
    el.replaceChildren(...kids.flat(3).filter(Boolean));
  }

  async function think() {
    if (thinking) return;
    thinking = true;
    status = '老师在想，大约要半分钟。可以先做别的，想好了会显示在这里。';
    draw();
    try { if (ctx.busy) ctx.busy(+1); } catch (e) { /* fine */ }
    try {
      await T.thinkWeek(ctx, { now: clock(), manual: true });
      status = '想好了。';
      toast('老师想好了');
    } catch (err) {
      status = '没想成：' + ((err && err.message) || '出了点问题，再试一次。');
    } finally {
      thinking = false;
      try { if (ctx.busy) ctx.busy(-1); } catch (e) { /* fine */ }
      draw();
    }
  }

  draw();
  if (container) container.replaceChildren(el);
  return { el, refresh: draw };
}
