// 家长区（DESIGN 9）：从“单词”页右上角“家长”进来，先输 4 位数字码（防误操作，不是保密）。里面放：Key、每天费用
// 上限、今日和本月估算花费、进度和期中日期范围、开机问卷、拍课本导入、导出备份、设备体检页；以后加老师的笔记本。
// 负责：家长区 UI agent（ui-parent.js、ui-onboard.js、ui-me.js、css/parent.css、css/onboard.css）。
// 状态：骨架。还没有数字码，直接进；里面先放词典照搬来的“设置与数据”（ui-me.js），保证 v0 现在就能填 Key。
// 数字码、花费、进度、问卷由负责的 agent 补。
//
// 导出
//   createParentView(ctx) -> { show(params), onChange(), holding() }
//     渲染进 #tab-parent。params.open：直接展开的一行（'key'、'import'…，“去恢复”“去设置”用）。
//     holding()：这一页有没导完的备份或导入，自动更新会等它。
//
// 用到的 ctx：kv.peek / set（'parent.pin'、'parent.intake'、'progress'）、budget.today / month、settings / saveSettings、
// go('lib')、closeMe。
// kv 'parent.pin'：{ salt, hash }（4 位码的 SHA-256，不存明文）；一次输对，这次打开 App 期间不再问。
import { h } from './ui-dom.js';
import { createMeTab } from './ui-me.js';

export function createParentView(ctx) {
  const root = document.getElementById('tab-parent');
  root.replaceChildren();
  const settingsBox = h('div', { className: 'parent-settings' });
  root.append(settingsBox);
  const me = createMeTab(ctx, { root: settingsBox, back: { label: '单词', onClick: () => ctx.go('lib') } });

  // the code gate comes here: until then, the parent area opens directly
  const unlocked = () => true;

  return {
    show(params = {}) { if (unlocked()) me.show(params); },
    onChange() { me.onChange(); },
    holding: () => me.holding(),
  };
}
