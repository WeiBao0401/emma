# 模块接口约定（v0.1）

给并行开发的 agent 看。v0.1（0.1.2）各模块已接通，下面的表是现在代码的样子。先读这一页，再读自己负责的文件顶部注释（那里有参数和返回值的细节）。设计在 `../../DESIGN.md`，老师笔记本在 `../../design/teacher-memory.md`。

**三条规矩**
1. 只改分配给自己的文件（见第 1 节）。需要别人文件里的改动，写进返回值的 `needs`，由接线 agent 合并。
2. 第 2 到 9 节的名字和形状是约定：可以加字段、加函数，不改名、不删、不改含义。
3. 在 `output/emma-english/` 下跑 `node tests/all.mjs`，必须全过（绝对路径见 `../../CLAUDE.md`）。`tests/scaffold.test.mjs` 锁着这些形状。

---

## 1. 文件和负责人

| 负责 | 文件 | v0 要做到 |
|---|---|---|
| 课标数据 | `curriculum.js`、`../curriculum/standard-words.json`、`kebiao.json`、`prereq.json`、`tags.json`、`../../tools/build_curriculum.mjs`、`pdf_text.swift` | 课标 505 和 1600 词表做成数据；课本单元词的导入格式（私有，见 5.3） |
| 英语小对话 | `lines.js`、`../curriculum/lines.json`、`questions.json`、`intake.json` | 打招呼、收尾、第一周 5 个按钮问题、夸她的句子；字幕按次数收起；家长开机问卷的题目 |
| 今天的课 | `plan.js` | 复习容量、优先级、新词数、轻松版、21:00 以后、有听写的晚上 |
| 记录与花费 | `events.js`、`budget.js` | 事件日志、180 天清理；花费估算、每天封顶、预算用完的 429 |
| 题型 | `modes/choice.js`、`dictation.js`、`../css/choice.css` | 四选一（干扰项带标签、第一张放最有把握的）；纸笔听写的逻辑 |
| 今天标签 UI | `ui-home.js`、`ui-lesson.js`、`ui-dictation.js`、`ui-review.js`（旧闪卡，可复用）、`../css/home.css`、`lesson.css`、`dictation.css` | 首页草图（DESIGN 2.0）、上课四格、听写两张草图（5.3） |
| 家长区 UI | `ui-parent.js`、`ui-onboard.js`、`ui-me.js`、`../css/parent.css`、`onboard.css` | 4 位数字码、Key、日限额、花费、进度和期中日期、开机问卷、导入课本、备份；第一次打开 |
| 孩子版报错与查词 | `kid-errors.js`、`prompts.js` | 孩子看到的报错；初一版查词提示词（课本义项在前，1-2 个义项，例句只用她认识的词） |
| 体检页 | `../check/`、`../../tests/check-page.test.mjs` | DESIGN 10.2 的七项；`check/` 独立能打开，永远不建 `emma` 库 |
| 接线 | `app.js`、`nav.js`、`config.js`、`db.js`、`ai.js`、`words.js`、`banners.js`、`ui-look.js`、`ui-lib.js`、`ui-entry.js`、`ui-dom.js`、`../index.html`、`../sw.js`、`../manifest.webmanifest`、本文件、`tests/run.mjs`、`scaffold.test.mjs`、`wiring.test.mjs`、`all.mjs`、`lib.mjs` | 合并 needs |
| 锁定，不改 | `dict.js`、`fsrs.js`、`session.js`、`speech.js`、`tts.js` | 和 Wei 的词典逐字一致（`tests/base-verbatim.test.mjs`）。要改先问 Wei |

新加文件尽量不要。确实要加，写进 needs：接线 agent 要把它加进 `sw.js` 的 SHELL（不加的话 `run.mjs` 的“SHELL is missing”会失败，这是预期的）。`web/curriculum/` 里新加公开 JSON，还要加进 `run.mjs` 那条 `no API key, textbook file or word data inside web/` 的 `PUBLIC_JSON`。

---

## 2. 路由（`nav.js`）

| 路由 | 页面 | 亮哪个标签 | 返回到 | 全屏（藏标签栏） | 谁画 |
|---|---|---|---|---|---|
| `home` | 今天 | 今天 | | | `ui-home.js` → `#tab-home` |
| `lesson` | 上课 | 今天 | `home` | 是 | `ui-lesson.js` → `#tab-lesson` |
| `dictation` | 明天有听写 | 今天 | `home` | 是 | `ui-dictation.js` → `#tab-dictation` |
| `look` | 查词 | 查词 | | | `ui-look.js` → `#tab-look` |
| `lib` | 单词 | 单词 | | | `ui-lib.js` → `#tab-lib` |
| `parent` | 家长区 | 单词 | `lib` | | `ui-parent.js` → `#tab-parent` |
| `onboard` | 第一次打开 | 无 | | 是 | `ui-onboard.js` → `#tab-onboard` |

- 旧名字还能用：`review` → `home`，`me` → `parent`。不认识的名字回到 `home`。
- 跳转：`ctx.go(route, params)`。`params` 原样传给那个 view 的 `show(params, { from })`；`from` 是从哪个路由来的。
- 启动时 `onboard.needed()` 为真先进 `onboard`，否则进 `home`。

---

## 3. ctx（app.js 传给每个 view 的对象）

每个 view 的工厂都是 `createXxx(ctx)`。词典原来的 view 里它叫 `app`，是同一个对象。

**数据和服务**

| 名字 | 是什么 |
|---|---|
| `store` | `db.js` 的 `idbStore`（见第 4 节）。一般不直接用，用下面封装好的 |
| `kv` | `{ peek(key, fallback), get(key, fallback), set(key, value), delete(key), keys(prefix) }`。启动时整表读进内存：`peek` 同步，`get`/`set` 异步。键名见第 5 节 |
| `words` | `words.js` 实例：`favorites()`、`get(slug)`、`review(slug, rating, mode)`、`lookup(q)`、`reviewQueue(n)`、`dueCount(n)`、`newDoneToday()`、`onChange(fn)` 等 |
| `dict` | 离线词典（`dict.js`）：`get(word)`、`find(q)`、`lemma(q)`、`loaded()` |
| `ai` | `ai.js` 实例：`askJSON(kind, user, { signal })`。已接预算（见 9.9） |
| `tts`、`voice`、`speech` | 朗读。一般只用 `ctx.say` |
| `say(text, button?, opts?)` | 读出来（千问声音，失败退回系统声音）；`button` 用来显示“正在读”，可以是 `null` |
| `events` | `events.js` 实例（9.4） |
| `budget` | `budget.js` 实例（9.5） |
| `curriculum` | `curriculum.js` 的 Curriculum（9.1），启动时已加载 |
| `reloadCurriculum()` | 课本导入写完 kv `textbook` 后调用，重新加载。导入词条（`words.importData`）以后 app.js 自己调 `curriculum.refresh()` 重建单元索引 |
| `lines` | `lines.js` 实例（9.2），启动时已加载 |

**今天的课**

| 名字 | 是什么 |
|---|---|
| `planState(extra)` | 拼好 `plan.planToday` 要的 state（9.3），`extra` 覆盖其中字段（比如 `{ light: true }`）。现在给：`words`（`wordsForPlan(…, { now })`，带 r / last / order / source）、`newPerDay`、`newDoneToday`、`doneToday`（kv `day:`）、`dictationTonight`（今天有 kv `dictation:` 记录就算）、`progress`、`weekGoal`、`lessonDays`（`ui-home.js` 的 `lessonDays(kv)`）、`unitRanks`（`curriculum.units()` 的 order） |
| `todayPlan(extra)` | `planToday(planState(extra), new Date())` |

**设置**

| 名字 | 是什么 |
|---|---|
| `settings()` | 当前设置（`config.js` 的 `DEFAULT_SETTINGS` 加 kv `settings`） |
| `saveSettings(patch)` | 合并并写 kv `settings` |
| `mockForced()` | 地址里有 `?mock=1` |

**界面**

| 名字 | 是什么 |
|---|---|
| `go(route, params)`、`back()` | 跳转；`back` 回到当前路由的上一级 |
| `currentRoute()`、`currentTab()` | 现在在哪 |
| `toast(msg, ms)` | 底部一句提示 |
| `kidError(err, { where, dict })` | 孩子看的报错一句（`kid-errors.js`），里面的“家长”换成 `parentName()` |
| `parentName()` | 家长设的称呼（kv `profile.parentCall`），没设是“家长” |
| `needsParent(err)` | 这个错要家长处理 |
| `statusSlot(el)` | 把一个元素登记成“状态行”的位置（离线、模拟模式、新版本……一次只显示最重要的一条） |
| `chrome()` | 重新判断要不要藏标签栏 |
| `applyTheme(name)` | 主题色：`''`（藏青，默认，v0.1.1 的配色）、`'green'`、`'rose'`、`'violet'`（`'blue'` 的样式还在，界面上不再给） |
| `openSheet(slug, { back })` | 整页打开一个词的完整讲解（从卡片上点“看完整讲解”） |
| `busy(+1 / -1)` | 有不能被自动更新打断的事在做 |
| `lookup(q)`、`toggleFav(slug, on)`、`openMe(opts)`、`closeMe()`、`showTab(name)` | 词典原来的接口，查词和单词页在用 |

**每个 view 返回的对象**：`show(params, { from })` 必须有；`onChange()` 词或设置变了以后调用（节流过）；`inSession()` 为真时 App 不自动更新；`holding()` 同理（家长区有没导完的备份）。

---

## 4. 数据库

`emma` 版本 1（`db.js` `upgradeDB`），一次建好以后要用的表，版本号以后不升。新字段直接加在记录里。

| 表 | 主键 | 放什么 | 谁写 |
|---|---|---|---|
| `entries` | `slug` | 词条：查过的词、单词本、课本词 | `words.js` |
| `zh` | `key` | 中译英缓存 | `words.js` |
| `log` | 自增 | 查词日志（最多 3000 条） | `words.js` |
| `meta` | 外置键 | 词典层自己的小值：`dailyNew`、`lastExport` | `words.js`、`app.js` |
| `events` | `id` 自增；索引 `at`、`type`、`slug` | 事件（第 6 节） | 只经过 `events.js` |
| `kv` | `key`；记录是 `{ key, value, updated }` | 第 5 节的键 | 只经过 `ctx.kv` |
| `notebook` | `id` | 老师的笔记本和快照（v2） | 以后 |
| `jobs` | `id` | 每周反思这类请求的状态（v2） | 以后 |
| `predictions` | `id` 自增 | 每题预测（teacher-memory 10） | 以后 |
| `outbox` | `id` 自增 | 发给模型的原文，家长区能看（teacher-memory 9.2） | 以后 |

声音缓存在另一个库 `emma-audio`。`idbStore` 给新表的方法：`kvGet / kvSet / kvDelete / kvAll`、`addEvent / eventsBetween(lo, hi, limit) / eventsBy(index, value) / countEvents / deleteEventsBefore(iso)`、通用的 `get(name, key) / put(name, rec) / all(name) / del(name, key)`。

**和 Wei 的词典同一个源**（`weibao0401.github.io`）：库名、缓存名、localStorage 键一律 `emma` 开头，绝不读写 `wordcoach*`、`wc.*`。`tests/run.mjs` 有测试看着。

### 4.1 词条的新字段（v0 起陆续加，不升库版本）

| 字段 | 值 | 谁写 |
|---|---|---|
| `unit` | 课本单元 id（`'S'`、`'U1'`…） | 课本导入 |
| `order` | 在单元里的顺序 | 课本导入 |
| `unit_order`、`unit_title` | 单元的先后和标题（kv `textbook` 没有时 `curriculum.js` 用它们） | 课本导入 |
| `tier` | `'primary'` / `'required'` / `'recognize'` / `'extra'` | 课本导入（没有就由 `curriculum.tierOf` 现算） |
| `required` | 在课标 1600 词里（含变化形式），必会 | 课本导入 |
| `phrase` | 是短语 | 课本导入 |
| `derived_from` | 只是提示（sunlight ← sun），不改 tier | 课本导入 |
| `write`、`write_at`、`write_from` | “写得出”线开着没有、什么时候、从哪来（`'dictation'`） | 听写（`words.patch`） |
| `scope` | 在期中范围里（v0 由 `plan.js` 用 kv `progress` 现算，词条上一般不写） | `words.patch` |
| `source` | 导入来的词：`'textbook'`；第三方抓来、等 Wei 拍课本核对的是 `'textbook-draft'`；history 里导入的那条也带 `source` | 课本导入 |
| `needs_core: true` | 还没有 AI 讲解，第一次打开时补 | 课本导入 |
| `level` | 词页上的等级标签，由程序定（`prompts.levelLabel`：“课本 Unit 3 / 小学词 / 初中词 / 课外词”），模型回的值不用 | `words.js`（`levelFor`） |

别的模块要改词条，只能走 `words.patch(slug, fields)`：只认 `PATCH_FIELDS`（`write`、`write_at`、`write_from`、`scope`），存库后触发 `onChange`（type `'patch'`）。

课本词进单词本时 `favorited: true`，这样 `words.review()` 和复习队列直接能用。

---

## 5. kv 键名

| 键 | 值 | 谁写 / 谁读 |
|---|---|---|
| `settings` | 设置（Key 在这里，**永远不进备份和导出**） | app.js / 家长区 |
| `onboard` | `{ done, at, version, handed }`；`handed` 是家长在装机清单点了“都好了，交给 Emma”（有它和 `parent.pin` 才进 Emma 的流程） | 家长区 / 第一次打开 |
| `profile` | `{ name, teacherName, theme, weeklyGoal, pledge, pledgeWhen, parentCall }`；`parentCall` 家长称呼（家长区写，默认“家长”） | 第一次打开 / 家长区 / 首页、上课 |
| `parent.pin` | `{ salt, hash }`（4 位码的 SHA-256，不存明文） | 家长区 |
| `parent.intake` | 开机问卷的回答 `{ version: 1, at, updated, answers: { 题 id: 值 } }`（题目在 `curriculum/intake.json`） | 家长区 |
| `ask.answers` | 第一周按钮问题的回答 `{ qid: { answer, skipped, at, day, n, who: 'emma' } }` | 上课收尾 |
| `progress` | `{ unit, examFrom, examTo, examDate, updated }` | 家长区 / 今天的课、听写 |
| `textbook` | 私有课本数据（5.3），可另带 `source`、`note` | 课本导入 / `curriculum.js` |
| `lines.seen` | `{ id: { n, zh, last } }` | `lines.js` |
| `budget` | `{ days: { 'YYYY-MM-DD': { kind: 元 } }, exhausted?: 'YYYY-MM-DD' }`，留 62 天；`exhausted` 是百炼说 Key 的预算用完的那天 | `budget.js` |
| `day:YYYY-MM-DD` | `{ cells: { warmup: true, ... }, minutes, light }` | 上课 / 今天的课 |
| `dictation:YYYY-MM-DD` | DictationRecord（`dictation.js` 注释） | 听写 / 首页提醒 |

新键：用 `模块.名字` 或 `名字:日期`，写进这张表（needs 给接线）。

### 5.1 备份（家长区“导出备份”）
格式 `emma-export` 版本 1：`{ format, version, source: 'ipad', exported_at, entries, zh, kv, events }`。`kv` 是除 `settings`、`parent.pin` 以外的全部键（Key 和数字码永远不进备份）；`events` 全带（家长区定的）。
恢复：`textbook` 按单元 id 合并，`progress` 新的那份生效，其他 kv 只补本机没有的键（`budget` 不恢复）；`events` 按 `${at}|${type}|${sid}|${item || slug}` 去重合并（`ui-parent.js` 的 `newEvents`），本机已有的那条不重复写。Wei 的 `wordcoach-export` 文件故意不认，两个 App 的数据不串。

### 5.2 课本导入
Wei 拍的课本照片由 Claude 在电脑上识别，生成导入文件放在 `../../private/`（永远不进 `web/`）。格式就是 `emma-export`：`entries` 是课本词（4.1 的字段），`kv.textbook` 是单元表。家长区的“导入文件”在 `words.importData` 之后把 `kv` 里的 `textbook`、`progress` 写进 kv，再调 `ctx.reloadCurriculum()`。

### 5.3 kv `textbook` 的形状
```
{ book: '外研版七上', units: [{ id: 'S', title: 'Starter', order: 0, words: [{ w: 'hello', cn: '你好', phrase?: true }] }], importedAt }
```

---

## 6. 事件（`events.js`）

一条事件的字段名是约定：

| 字段 | 说明 |
|---|---|
| `type` | `EVENT_TYPES` 之一：`session_start`、`session_end`、`answer`、`skip`、`exit`、`feel`、`flag`、`review`、`dictation`、`lookup`、`ask`、`parent_note`、`predict`、`hint`、`spell`、`line`、`onboard` |
| `at` | 本地时间带时区，`2026-11-03T19:42:11+08:00`（`log` 自动补） |
| `sid` | 这节课的编号，`ctx.events.sessionId()` 返回 `YYYY-MM-DD-HHMMSS` |
| `step` | `warmup` / `read` / `write` / `wrap` / `dictation` / `onboard` / `look` |
| `item` | `w:<slug>`、`g:<语法点>:<题>`、`ep:<集>:<题>`、`line:<句子 id>` |
| `slug` | 单词 |
| `unit` | 课本单元（不知道就不写） |
| `mode` | `mc4` 四选一、`listen`、`tiles`、`keys`、`cloze`、`order`、`paper` 纸笔、`card`（热身凑不齐干扰项时退回的闪卡） |
| `choice` | 她选的那个（文字或 id） |
| `correct` | 对不对 |
| `first_try` | 是不是这题第一次作答 |
| `ms` | 出题到作答的毫秒数 |
| `hint_level` | 看到第几级提示，0 是没看 |
| `misconception` | 她选的干扰项的误解标签（`curriculum/tags.json`），答对为 `null` |

各类型自己的字段（teacher-memory 2.1）：`session_start` 带 `kind`（standard / easy / dictation / weekend）、`hour`；`session_end` 带 `min`、`steps_done`、`completed`；`exit` 带 `after_item`、`wrong_streak`；`ask` 带 `qid`、`who`（emma / parent）、`answer`（选项 id，跳过是 `'skip'`）、`about`（选项的标签，`lines.answerEvent` 给）；`lookup` 带 `query`、`source`、`from`。`answer` 另有四选一给的 `direction`、`choice_slug`、`distractor`（她选的干扰项 slug）、`retry`；`predict` 带 `p_base`、`p_teacher`（v0 相同）。

`log(event)` 写失败不抛错，返回 `null`：作答不能因为记录失败卡住。

---

## 7. 首页和上课的四格

`plan.planToday` 的 `cells` 永远是这四格、这个顺序：`warmup` 热身、`read` 读一段、`write` 写几个词、`wrap` 收尾。`status`：`ready` / `done` / `soon`（没上线，显示“下周开播”，不占时间）/ `skip`。v0 只有热身和收尾是 `ready`。

---

## 8. CSS

- 共用的颜色、字号、间距（`--ink`、`--paper`、`--accent`、`--rule`、`--serif`、`--gutter`、`--col` 等）和词典原来的样式都在 `../index.html` 里，别重新定义。
- 每个 UI agent 只写自己的文件，`index.html` 已经引用：`css/home.css`（类名 `home-`）、`lesson.css`（`lesson-`）、`dictation.css`（`dict-`）、`choice.css`（`mc4-`）、`parent.css`（`parent-`）、`onboard.css`（`onboard-`）。
- 现成可用的类：`.btn`（一屏一个实心按钮）、`.text-btn`、`.text-btn.accent`、`.lede`（大号衬线句子）、`.small`、`.runhead`、`.say`（朗读小按钮）、`.serif`、`.num`。
- iPad 竖屏一栏，最宽 `--col`（720px），横屏居中。主题色由 `:root[data-accent]` 换 `--accent` 和 `--tag-bg`。
- 风格：词典的安静干净（衬线词头、细线、留白），不要卡通吉祥物。文案中文为主，弯引号“ ”，不用破折号，句子短。

---

## 9. 各模块接口

细节（参数、返回值的每个字段）在各文件顶部注释。这里是总表。

### 9.1 `curriculum.js`
- `loadCurriculum({ fetchJSON, kv, entries?, lemma?, dict? }) -> Promise<Curriculum>`；`createCurriculum({ standard, prereq, tags, textbook, entries, lemma, details, fetchJSON })`。app.js 传 `{ fetchJSON, kv, dict, entries: () => words.all() }`
- Curriculum：`isPrimary(word)`、`isRequired(word)`、`levelOf(word)`、`baseOf(word)`、`tierOf(word)`、`unitOf(word)`、`unitWords(unit)`、`units()`、`unitOrder(unit)`、`unitTitle(unit)`、`prereq`、`grammar(unit)`、`foundations(unitOrItem)`、`grammarName(item)`、`tags`、`hasTextbook()`、`counts()`、`standardWords()`、`refresh()`、`loadDetails()`、`detail(word)`、`posOf(word)`
- `standard-words.json`：`{ version, source, counts, primary, junior, listed, forms }`；详表 `DETAIL_FILE = 'curriculum/kebiao.json'`（词性等），`loadDetails()` 时才下载
- 单元两处都认：kv `textbook` 和导入词条上的 `unit`（`unit_order`、`unit_title`），两处都有时 kv 优先
- 公开数据只放课标词表、前置关系、标签。课本单元词只在 kv `textbook` 和 iPad 的词条里。

### 9.2 `lines.js`
- `createLines({ data, questions?, kv, now?, fetchJSON? }) -> { load, pick(scene, ctx), markSeen(id), tapZh(id) / markZhTapped(id), shouldShowZh(id), questionsForDay(n), question(id), weekly(), answerEvent(q, optionId, extra), all() }`；app.js 传 `fetchJSON`，`load()` 自己读 `questions.json`
- 导出 `SCENES`（`open` / `ask` / `praise` / `close` / `back` / `late` / `easy` / `dictation`）、`SCENE_ALIASES`（`welcome_back` → `back`，`light` → `easy`）、`FILE`、`QUESTIONS_FILE`、`INTAKE_FILE`
- `pick` 返回 `{ id, scene, en, zh, showZh }`；ctx 认 `name`、`word`、`minutes`、`hour`、`phase`（`'before'` / `'after'`）、`wrong`、`perfect`、`spelled`、`hard`、`recent`
- Question = `{ id, day, pool, about, to, en, zh, showZh, options: [{ id, en, zh, about, kind: 'answer' | 'none' }], skip: { id: 'skip', en: 'Not now', zh: '先跳过', kind: 'skip' } }`；跳过不在 `options` 里，界面自己摆
- 一句不超过 8 个词（测试检查）。回答按钮问题记 `answerEvent(...)` 返回的事件。

### 9.3 `plan.js`
- `planToday(state, now) -> Plan`（纯函数）；`wordsForPlan(entries, curriculum, opts?)`（`opts = { now }` 时多给 r、last、order、source）；`dayOf(date)`
- state 新字段：`lessonDays`（空 = 第一节课，最后一天早于昨天 = 回归日，也用来算 `weekDays`）、`firstLesson`、`standard`（回归日点了标准版）、`unitRanks`、`introDoneToday`、`textbookPerDay`
- Plan 新字段：`kind`（standard / easy / weekend）、`lightReason`（late / exam / dictation / comeback / chosen）、`first`、`weekend`、`dictation`、`comeback`、`cap`、`allDone`、`week: { days, goal }`、`counts.reviews / intro / newWords / deferred / cutNew`，别名 `slots` / `easy` / `reason`
- 字段的细节见文件注释。`ctx.planState()` 负责拼 state；要加 state 字段写进 needs。

### 9.4 `events.js`
- `createEvents({ store, now }) -> { log(event), query({ since, until, type, slug, unit, mode, limit }), recent(n), count(), sessionId(), trim(days), predict(entry, { mode }), logPrediction(...), stats(), predictionStats(), weekDays(), lessonDays() }`
- 纯函数：`predictCorrect(entry, now, { mode })`、`summarize`、`scorePredictions`、`pairPredictions`、`weekDaysOf`、`lessonDaysOf`、`normalizeEvent`
- `query` 读不到时返回 `[]`，`trim` 返回删了几条。

### 9.5 `budget.js`
- `createBudget({ kv, now, getCap, getKindCaps? }) -> { load, record(usage, kind, model), canSpend(kind), blockReason(kind), today(), month(), markExhausted(), clearExhausted(), exhausted(), reset() }`
- `blockReason` 返回 `''` / `'day'` / `'kind'` / `'month'`；app.js 传 `getKindCaps: () => settings.kindCapsYuan || {}`
- 纯函数：`isBudgetExhausted(status, data)`、`costOf(usage, kind, model)`、`budgetKindOf(aiKind)`；给 tts 用的 `wrapFetch(fetchImpl, budget)`。`PRICES`、`FALLBACK_PRICE` 从 `config.js` 的模型表读
- 类别：`lookup`、`tts`、`hint`、`story`、`reflect`、`photo`、`other`
- 家长区：`exhausted()` 为真时显示“百炼说这个 Key 的预算用完了”和“再试”（`clearExhausted()`）

### 9.6 `modes/choice.js`
- `makeQuestion(entry, pool, { direction, rng })`、`makeChoice(...)`、`renderChoice(container, q, { onAnswer, onDone, say })`、`createAttempt(q)`、`gradeOf({ correct, firstTry, hintLevel })`、`meaningOf(entry)`、`explain`、`hintFor`、`directionFor`、`isRetry`、`fillerFor(entry, app)`、`sureFirst(items, get)`
- `choiceMode.render(entry, ctx) -> { el, footer, onKey }`，和 `ui-review.js` 的 `flashcard` 同一个 mode 接口；`ctx` 是 `{ app, rate(g), say, position, pool, onAnswer(ev) }`；`ctx.rate` 收到 `(grade, { modeId: 'mc4' })`
- 评分：第一次就对 3，用了“再看一次”才对 2，答错 1。上课里答对一次就收，答错的隔约 4 张再出（`session.js`）。干扰项不够时用同单元课本词和 `curriculum.standardWords()` 补。

### 9.7 `dictation.js`
- `METHODS`、`promptFor(word, method)`、`buildDictation(...)`、`createDictation({ words, method, unit, now, rounds, kind, sid, info })`、`selfCheck`、`saveDictation({ kv, d, words })`、`openWriteLine(words, slugs)`、`reminders(record, now)`、`reminderState`、`homeReminders(kv, now)`、`tonightDictation(record)`、`morningList(record)`、`markTonightDone` / `markMorningDone`、`markEvent`
- word 是 `{ slug, w, cn }`。每个打勾记 `events` `{ type: 'dictation', slug, correct, mode: 'paper', choice: method, pass, round }`。
- DictationRecord（kv `dictation:<日期>`）：`{ date, method, unit, rounds: [{ sid, kind, unit, method, ... }], info / items, done, wrong, remindAt, eveningDone, morningDone, write, writeOpened }`；写错的词经 `words.patch` 开“写得出”线。短语考法读中文、写英文短语。

### 9.8 `kid-errors.js`
- `KID_COPY`、`WHERE_COPY`、`BANNED`、`kidMessage(err, { where, dict })`、`needsParent(err)`、`parentDetail(err)`
- `dict` 为真（查词页下面有离线词典的意思）时句子带“先看看词典里的意思吧”。孩子看到的话里不出现 Key、API、欠费、预算、模型、百炼、Poe、qwen、千问、429（测试检查）。

### 9.9 `ai.js`（接线）和 `prompts.js`
- `createAI({ getSettings, budget, poeEnabled? })`：调用前 `budget.canSpend` 为假抛 `AIError` `budget-day`，不发请求；百炼“预算用完”的 429 抛 `budget`，不重试，`markExhausted()`；成功后 `budget.record(usage, kind, model)`（截断的也记）。`ai.recent()` 是最近 50 次请求（不含原文）
- 路由：`route(kind, settings)`、`routingOf(settings)`、`ROUTE_TASKS`；读 `settings.routing = { core, lexicon, practice, zh, tts }`，每行 `{ provider, model }`，没写就按 `models` 三个槽；`saveSettings` 按任务合并 `routing`。任务 `hint`（答错后的一句巧记，花费类别 hint）跟 core
- `AIError.code` 一览：`nokey`、`badkey`、`billing`、`budget`、`budget-day`、`model`、`forbidden`、`inspection`、`ratelimit`、`server`、`timeout`、`network`、`empty`、`truncated`、`incomplete`、`http`、`abort`。`err.message` 是给家长区看的，孩子看的一律走 `ctx.kidError(err)`。
- Poe 代码保留，`config.js` `POE_ENABLED = false`：家长区不显示 Poe，存过的 `provider: 'poe'` 读成百炼。
- `prompts.js`：`levelLabel(word, curriculum)`、`lookupHints(word, { curriculum, progress })`、`userMsg(q, context, fromCn, hints)`、`zhUserMsg(q, scene, { known })`、`storyUserMsg(words, hints)`、`hintUserMsg(...)`。`words.js` 经 `createWords({ hintsFor, levelFor })` 用它们：等级和课本义项由程序定，查词不再生成巧记。

### 9.10 UI 工厂

| 文件 | 导出 | `show(params)` 的 params |
|---|---|---|
| `ui-home.js` | `createHomeTab(ctx)`；纯函数 `lessonDays(kv)`、`dictationToday(kv)`、`dictationNotice(kv, now)`、`phaseText` 等 | 无 |
| `ui-lesson.js` | `createLessonView(ctx)` | `{ light, standard?（回归日点了标准版）, again?（今天上完了再练一会儿）, first?（第一次打开直接进来） }` |
| `ui-dictation.js` | `createDictationView(ctx)` | `{ unit?, retry?（再写一次错的）, glance?（出门前看一眼） }` |
| `ui-parent.js` | `createParentView(ctx)` | `{ open?, setup? }`；`open` 认 `key`、`import`、`backup`、`unit`、`exam`、`intake`、`pname`、`cap` |
| `ui-onboard.js` | `createOnboardView(ctx)`，另有同步的 `needed()`；结束时 `ctx.go('lesson', { first: true })` | 无 |
| `ui-me.js` | `createMeTab(ctx, { root, back, layout, hooks })`，由 `ui-parent.js` 调用；`hooks` 是 `exportExtra`、`previewExtra`、`afterImport` | `{ open? }` |
| `ui-lib.js` | `createLibTab(ctx)`；导入课本后多一行单元筛选（全部单元 / 各单元 / 课外），单元里按必会、认读、小学词和课本顺序排 | 无 |

---

## 10. 测试

- 全部：在 `output/emma-english/` 下 `node tests/all.mjs`（可以加一个过滤词，比如 `node tests/all.mjs plan`）。
- 自己的测试写成 `tests/<模块>.test.mjs`，用 `tests/lib.mjs`：

```js
import { test, run, assert, load, memStore, memKv } from './lib.mjs';
const P = await load('plan.js');
test('热身最多 20 张', () => { assert.ok(P.planToday({ words: [] }).cells[0].items.length <= 20); });
await run();
```

- 浏览器检查用模拟模式 `?mock=1`（不调模型、不花钱）；`?mock=offline` 模拟断网。本机预览要从 `/emma/` 路径打开（manifest 和 service worker 的 scope 是 `/emma/`）。
- 不联网发带 Key 的请求，不建仓库，不 push。

---

## 11. 还没定的事（遇到了写进 needs）

- 已定：FSRS 新卡答对后当天的短间隔，`plan` 按词条的 `last`（今天复习过）跳过，做完的格子按 kv `day:` 标 done。
- 已定：备份带 `events`（见 5.1）。
- iPad 上没有用户点击时自动播放声音可能被拦。题目和听写里的自动朗读，拦了就等她点“再听一遍”。
- 开机问卷的回答还没人读：`mistakes` 的词进待学、`dictation_way` 当默认考法、`on_praise` 影响夸她的句式、`free_time` / `busy_days` 影响课的轻重。
- 导入的课本词中文取自第三方词表（`cn_source: 'book-list'`，网页抓取可能缺字），没有的留空等 AI 补（`needs_core`）；整份包要等 Wei 拍课本核对后再给 Emma 用。
