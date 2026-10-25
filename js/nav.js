// Where things live (CONTRACTS.md "路由"): five tabs (0.7.0), 今天 / 问老师 / 错题 / 查词 / 单词. Lesson and dictation are full-screen
// pages pushed from 今天, and so is 这周小结 (with the tab bar); 问老师 (ui-chat.js, v0.3.0) is a tab of its own;
// 家长区 is a page pushed from 单词, 拍课本 a full-screen page pushed from it; the first open is its own full-screen page.
// Pure data and functions, no DOM, so Node tests can check the routing.
// Owner: 接线 (app.js wiring). Other agents ask for changes through their `needs`.

// [route, label, icon]
// 0.7.0: five tabs, 错题 (ui-mistakes.js) after 问老师
export const TABS = [['home', '今天', 'sun'], ['chat', '问老师', 'chat'], ['mistakes', '错题', 'note'], ['look', '查词', 'search'], ['lib', '单词', 'book']];

// route -> the section shown (#tab-<section> in index.html), the tab lit in the tab bar, and for a pushed page its
// parent route and back label. immersive: the tab bar steps aside (a lesson, dictation, the first open).
export const ROUTES = {
  home: { section: 'home', tab: 'home' },
  // 0.3.0: 问老师, free questions to the teacher (params { ask?, send?, image? }: another page can bring a question in)
  chat: { section: 'chat', tab: 'chat' },
  lesson: { section: 'lesson', tab: 'home', parent: 'home', back: '今天', immersive: true },
  dictation: { section: 'dictation', tab: 'home', parent: 'home', back: '今天', immersive: true },
  look: { section: 'look', tab: 'look' },
  lib: { section: 'lib', tab: 'lib' },
  parent: { section: 'parent', tab: 'lib', parent: 'lib', back: '单词' },
  onboard: { section: 'onboard', tab: null, immersive: true },
  // v1: 这周小结 (ui-weekly.js) from 今天, the tab bar stays; 拍课本 (ui-capture.js) from 家长区, full screen
  weekly: { section: 'weekly', tab: 'home', parent: 'home', back: '今天' },
  capture: { section: 'capture', tab: 'lib', parent: 'parent', back: '家长区', immersive: true },
  // 0.7.0: 错题 (a tab: 拍题、讲题、错题本、再考; params { id?, review?, take? }), 孩子端“我” (ui-kid-me.js, from 今天's
  // top right corner), 我要复习考试 (ui-review-request.js, full screen; not "review", that alias goes to 今天)
  mistakes: { section: 'mistakes', tab: 'mistakes' },
  kidme: { section: 'kidme', tab: 'home', parent: 'home', back: '今天' },
  revise: { section: 'revise', tab: 'home', parent: 'home', back: '今天', immersive: true },
};
export const SECTIONS = [...new Set(Object.values(ROUTES).map(r => r.section))];

// Old names from the dictionary: 复习 is part of 今天 now, 我 became 家长区.
export const ALIASES = { review: 'home', me: 'parent' };
export const DEFAULT_ROUTE = 'home';

// Unknown names fall back to 今天.
export function resolveRoute(name) {
  const n = ALIASES[name] || name;
  const r = ROUTES[n] || ROUTES[DEFAULT_ROUTE];
  return { name: ROUTES[n] ? n : DEFAULT_ROUTE, ...r };
}

// Tapping the lit tab again: on a pushed page it goes back to the tab's root, otherwise it scrolls up.
export const reselectAction = route => {
  const r = resolveRoute(route);
  return r.parent ? { go: r.parent } : { scrollTop: true };
};
