// Where things live (CONTRACTS.md "路由"): three tabs, 今天 / 查词 / 单词. Lesson and dictation are full-screen pages
// pushed from 今天; 家长区 is a page pushed from 单词 (its 4-digit code is ui-parent.js's job); the first open is its
// own full-screen page. Pure data and functions, no DOM, so Node tests can check the routing.
// Owner: 接线 (app.js wiring). Other agents ask for changes through their `needs`.

// [route, label, icon]
export const TABS = [['home', '今天', 'sun'], ['look', '查词', 'search'], ['lib', '单词', 'book']];

// route -> the section shown (#tab-<section> in index.html), the tab lit in the tab bar, and for a pushed page its
// parent route and back label. immersive: the tab bar steps aside (a lesson, dictation, the first open).
export const ROUTES = {
  home: { section: 'home', tab: 'home' },
  lesson: { section: 'lesson', tab: 'home', parent: 'home', back: '今天', immersive: true },
  dictation: { section: 'dictation', tab: 'home', parent: 'home', back: '今天', immersive: true },
  look: { section: 'look', tab: 'look' },
  lib: { section: 'lib', tab: 'lib' },
  parent: { section: 'parent', tab: 'lib', parent: 'lib', back: '单词' },
  onboard: { section: 'onboard', tab: null, immersive: true },
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
