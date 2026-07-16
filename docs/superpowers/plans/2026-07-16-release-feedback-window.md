# 自有更新说明窗口 Implementation Plan

> **执行方式：** 由 Codex 主 agent 内联实现；GLM / Opus 只做独立只读 review，不修改文件、不代替实现。
>
> **计划定位：** 这是实现清单，不是第二份 Product Spec。产品行为以 [`docs/design/release-highlights.md`](../../design/release-highlights.md) 为准；本计划只固定必要的工程边界。reviewer 提出的、未列入“必须保留”的建议不是自动新增需求。

**Goal:** 在后续版本中用一个独立、非模态、视觉与下载进度窗一致的 `BrowserWindow` 替换版本更新反馈的系统 `MessageBox`，并让跳版本升级不漏掉中间稳定版本的用户可见变化。

**Architecture:** `main/release-feedback.ts` 保留版本选择、首次安装判断、降级保护和已读状态决策；离线生成器提供稳定版本归档；独立 presenter 管理唯一活动窗口。renderer 只接收经过校验的快照，独立 sandbox preload 只暴露快照订阅、渲染确认和关闭请求。

**Tech Stack:** Electron 35、electron-vite 3、TypeScript 5、Vitest 3、原生 HTML/CSS/DOM、electron-builder。

---

## 1. 不可改变的产品行为

实现前先读完整 Product Spec。以下行为是本计划的硬约束：

- 自动路径只在已有安装、当前稳定版本高于已读版本、且不是开发环境/预发布环境时触发。
- 有已读版本时，选择 `(lastShownReleaseVersion, currentVersion]` 内所有稳定章节，在一个窗口按版本升序展示。
- 有旧安装痕迹但没有已读基线时，展示构建归档中不高于当前版本的全部稳定章节；允许重复一次，但不能因为无法推断旧版本而永久漏掉信息。
- 全新安装建立当前版本基线，不自动展示；降级不覆盖较高的已读版本。
- 托盘手动入口只展示当前安装版本，永不写入已读状态。
- 自动路径没有可展示章节时不创建窗口，直接建立版本基线；手动路径没有内容时仍打开窗口并显示 fallback 文案。预发布版本可手动查看稳定核心版本内容，但不自动展示、不修改正式版本已读状态。
- 自动窗口真正渲染、主进程确认显示成功后才写入当前最高稳定版本；关闭按钮、标题栏 X、Escape 不改变已读状态。
- 自动/手动并发只保留一个窗口；窗口来源在创建时固定，后续聚焦不能把手动窗口变成自动窗口。
- `CHANGELOG.md` 是唯一人工内容源；所有稳定章节保留在离线归档中，运行时不读 Markdown、不联网取文案。

## 2. 复杂度预算：必须做与明确不做

### 必须做

1. 多版本归档和 controller 选择逻辑。
2. 独立 `BrowserWindow`、唯一活动窗口、来源固定、显示确认和有界超时。
3. 独立 sandbox preload，构建和加载为 CommonJS `.cjs`。
4. 最小 IPC：主进程下发快照，renderer 回报渲染高度/完成，renderer 请求关闭。
5. 本地页面 CSP、导航拦截、`window.open` 拒绝和 IPC sender 校验。
6. 自动化测试、真实 asar 检查和 Windows/macOS 状态分离记录。

### 明确不做

- 不创建通用窗口基类、通用窗口框架或第二套状态机；下载进度窗只作为壳和视觉参考。
- 不创建历史版本浏览中心；手动入口仍只看当前版本。
- 不预写完整实现代码到计划中；按现有项目模式实现最小代码，并以测试锁住行为。
- 不为每个 CSS token、极端分辨率或每条静态字符串建立独立测试文件。共享 token 只用一个小 CSS 文件；尺寸用纯函数测试正常工作区与小屏 clamp。
- 不为了本功能引入新依赖，不改 runtime `name`、`appId`、`productName`、userData、更新 provider、DMG 流程或 portable 策略。
- 不因 reviewer 的可选建议扩大产品范围。除非发现真实数据丢失、启动阻塞、权限越界、打包失败或用户路径错误，否则记录为后续观察，不在本轮加抽象。

## 3. 文件边界

新增或修改的最小范围如下；实现时若现有文件已提供同等能力，优先复用，不再复制：

**新增：**

- `shared/release-feedback-window.ts`：快照、展示结果、IPC channel、3 秒超时常量和跨边界校验。
- `main/release-feedback-window.ts`：窗口 options、尺寸 clamp、唯一活动窗口 presenter/manager。
- `preload/release-feedback-preload.ts`：最小 sandbox bridge。
- `renderer/release-feedback.html`：本地页面和严格 CSP。
- `renderer/src/release-feedback.ts`、`renderer/src/release-feedback.css`、`renderer/src/release-feedback-global.d.ts`：渲染、样式和 bridge 类型。

**修改：**

- `scripts/build-release-notes.cjs`、`shared/release-notes.ts`：单章产物改为稳定版本归档；`main/generated/release-notes.ts` 只生成、不手写、不提交。
- `main/release-feedback.ts`：从 MessageBox 端口迁移到 presenter，保留现有状态机。
- `main/main.ts`、`electron.vite.config.ts`：窗口、IPC、退出和第三个 `.cjs` preload/renderer 入口接线。
- `renderer/src/update-progress.css`：只抽取已批准的颜色/字体 token，不改变布局。
- 相关已有测试、`docs/architecture.md`、`docs/releasing.md`、`AGENTS.md`、`CHANGELOG.md`、`HANDOFF.md`。

不要一开始创建十几个测试文件。先使用现有 `tests/release-notes.test.ts`、`tests/release-feedback.test.ts`、`tests/update-progress-*` 和 wiring 测试；只有测试职责确实独立时再拆文件。

## 4. Task 0：从最新本地 main 建立实现分支

- [ ] 确认 `main` 是当前本地最新基线，工作区干净，版本仍为 `0.1.14`，安装身份和更新配置未被计划修改。
- [ ] 从最新本地 `main` 创建 `feat/release-feedback-window`。不要把计划分支快进到 `main`；将计划中的 Product Spec、实施计划和 README 变更带入实现分支即可，不修改 `main`。
- [ ] 记录分支起点、`package.json` 的 `name/version/appId/productName` 和 userData 路径。

推荐命令：

```bash
git switch main
git status --short
git switch -c feat/release-feedback-window
git restore --source plan/release-feedback-window -- README.md docs/design/release-highlights.md docs/superpowers/plans/2026-07-16-release-feedback-window.md
git add README.md docs/design/release-highlights.md docs/superpowers/plans/2026-07-16-release-feedback-window.md
git commit -m "docs: bring reviewed release feedback plan"
node -e "const p=require('./package.json'); console.log(p.name,p.version,p.build.appId,p.build.productName)"
```

若本地 `main` 已领先于计划分支，保留最新 `main` 的代码与配置，只带入上述三个文档文件。

## 5. Task 1：先完成离线归档和 controller 语义

**先改测试，再改实现。** 这一阶段不创建窗口，先把用户最在意的“不漏版本”锁住。

- [ ] 在 `tests/release-notes.test.ts` 增加归档测试：章节按 SemVer 升序；重复章节、空分类、无条目、当前正式版本缺章节时失败；预发布版本校验稳定核心章节但不把预发布号写入归档；生成产物保留所有稳定章节。
- [ ] 在 `tests/release-feedback.test.ts` 增加选择测试：`0.1.12 -> 0.1.15` 得到 `0.1.13/0.1.14/0.1.15`；无基线旧安装得到所有不高于当前版本的归档章节；全新安装不展示；降级不写低版本；手动只得到当前版本；空手动内容得到 `releases: []`。
- [ ] 修改 `shared/release-notes.ts` 和 `scripts/build-release-notes.cjs`，输出 `releases: [{ version, sections }]` 的离线归档；继续生成被 git 忽略的 `main/generated/release-notes.ts`，禁止手写或 `git add -f`。
- [ ] 修改 controller：输入快照范围，不再拼 `MessageBox.detail`；自动展示成功条件暂由 presenter 结果提供，只有 `source === 'automatic' && shown === true` 才保存当前最高版本。
- [ ] 运行：

```bash
npx vitest run tests/release-notes.test.ts tests/release-feedback.test.ts
node scripts/build-release-notes.cjs
```

- [ ] 提交一个只包含归档/controller 的提交。此时不应有窗口、preload 或构建配置变化。

## 6. Task 2：做一个最小可用的自有窗口纵切片

这一步把 renderer、preload、主进程窗口和托盘手动入口连通；不要先把所有失败情况写成大型抽象。

- [ ] 新增共享协议：快照为 `{ initiatedBy, version, releases }`；展示结果为 `{ shown, source }`；定义 `snapshot`、`rendered`、`dismiss` 三个 channel 和 `RELEASE_FEEDBACK_RENDER_TIMEOUT_MS = 3000`。
- [ ] 新增 renderer 页面：`lang="zh-CN"`、使用完整安装版本（含预发布后缀）的 `h1` 文案（自动“悬浮便签已更新到 v…”、手动“当前版本 v…”）、版本 `h2`、分类 `h3`、条目 `ul/li`；手动无内容显示“本版本暂无更新说明”；等待字体就绪后在更新条目区域内部滚动并回报高度；按钮和 Escape 关闭。
- [ ] 新增独立 preload：只暴露 `onSnapshot`、`reportRendered({ contentHeight })`、`dismiss`；不暴露便签、下载、文件系统或 `invoke` 权限。
- [ ] 新增窗口 presenter：`show(snapshot)` 有窗口时聚焦并复用，无窗口时 `show:false` 创建；来源固定；收到 renderer 渲染确认后校验高度、调整固定宽度窗口、调用 `show()` 并等待 `show` 事件；超时/加载失败/渲染失败销毁隐藏窗口并返回 `{ shown: false }`。
- [ ] 窗口壳遵循 Product Spec：ownerless、非模态、可关闭、不可调整大小、非置顶、可进任务栏、米白背景 `#f5f1e8`、正文 `#26231f`、标题 `#5e574d`、弱文字 `#746b60`、琥珀 `#d49a3a`、标准标题栏。尺寸使用 440 逻辑像素固定宽度（小屏按工作区缩小），内容高度下限 180、上限 `min(560, workArea.height * 0.75)`，外层最终不超出工作区；超出部分在内容区滚动，不为极端显示器增加新框架。
- [ ] 把 renderer 入口和 preload 加入 `electron.vite.config.ts`，确保第三个 sandbox preload 输出为 `releaseFeedbackPreload.cjs`，主进程只加载 `.cjs`。
- [ ] 先让托盘手动入口打开窗口并在开发环境验证，再接自动路径；这样能把 renderer/窗口问题和版本状态问题分开诊断。

最小测试覆盖：

- renderer 文案、h2/h3/ul/li、空内容、Escape、滚动容器；
- presenter 单窗口复用、来源固定、渲染确认后才显示、超时返回 false、关闭和 dispose 幂等；
- preload 只有三个允许操作；
- electron-vite 产物入口为 `.cjs` 和 `release-feedback.html`。

## 7. Task 3：接入自动路径和安全边界

- [ ] 在 `main/main.ts` 注册快照、渲染确认和关闭 IPC；每个 handler 校验 `event.sender.id` 属于当前更新说明窗口，渲染高度必须是有限非负数，非法输入无副作用。
- [ ] 为更新说明窗口挂 `will-navigate`、`will-frame-navigate` 和 `setWindowOpenHandler` deny；页面 CSP 至少为 `default-src 'self'; script-src 'self'; style-src 'self'`。
- [ ] 连接 controller 与 presenter，保留启动顺序：旧安装痕迹捕获 -> controller initialize -> notes 初始化 -> tray -> `showAutomaticallyIfNeeded()` -> `checkSilently()`。
- [ ] 自动路径不等待用户关闭，只等待显示成功/失败；渲染确认和 `show` 事件都成功后才写已读；手动先开的窗口被自动请求复用时不写已读。
- [ ] `before-quit` 调用 controller/presenter dispose；退出开始后不再创建新窗口；窗口关闭不触发应用退出、自动安装或下载进度清理。
- [ ] 将 `renderer/src/update-progress.css` 的颜色/字体抽成少量 CSS variables，确认下载进度窗布局和视觉值未变化。不创建共享 JS 基类、不改 progress manager。

定向测试至少覆盖：手动/自动单飞、来源复用、renderer bridge 缺失不落盘、3 秒 fake timer 不阻塞启动、迟到 close 不清理新窗口、导航/window.open 拒绝、退出 dispose。

## 8. Task 4：文档和提交边界

- [ ] `docs/architecture.md` 只记录长期架构摘要：三个 sandbox preload 均为 `.cjs`；反馈窗口独立于便签和下载进度窗；运行时不读 Markdown。
- [ ] `docs/releasing.md` 增加 `releaseFeedbackPreload.cjs`、`release-feedback.html` 的 asar 检查；保留现有安装包、provider、blockmap 和 latest 元数据顺序。
- [ ] `AGENTS.md` 把“两个 sandbox preload”更新为当前实现后的“三个”，并保留 `.cjs` 硬约束。
- [ ] `CHANGELOG.md` 只在 `## [未发布]` 写用户可见变化，不分配版本号。
- [ ] `HANDOFF.md` 分开记录实现、自动验证、产物、macOS、Windows、发布、监测；自有窗口未发布前全部保持诚实状态。Issue #4 只摘要并链接 Product Spec，不复制计划全文。
- [ ] 业务代码完成后由 Codex 先 review 最新 diff；GLM / Opus 再对同一 HEAD 只读 review。review 意见逐条裁决：只修真实 blocker/bug，若新增行为或代码改动，重新跑两轮 review；不要把所有 minor 直接变成新范围。

## 9. Task 5：自动化和产物闸门

先跑定向测试，再跑仓库闸门：

```bash
npm ci
npm test
npm run build
npm audit
git diff --check
```

检查未打包和打包入口：

```bash
find out/preload -maxdepth 1 -type f -print | sort
find out/renderer -maxdepth 2 -type f -print | sort | rg 'release-feedback|update-progress|index.html'
npm run dist:mac
npm run dist:win
```

- [ ] 确认 `out/preload/releaseFeedbackPreload.cjs` 存在且没有同名 `.mjs`；renderer 有 `release-feedback.html`；主进程只引用 `.cjs`。
- [ ] 检查 Windows 和 macOS `app.asar` 都包含三个 `.cjs` preload 与 `release-feedback.html`；不能用交叉构建代替 Windows 真机验证。
- [ ] macOS 运行 `hdiutil verify`，直接启动真实 `.app`，确认托盘、便签、手动窗口和下载进度窗都能加载。产物验证和 macOS 目标环境状态分开记录。

## 10. Task 6：最小真机矩阵和发布决策

目标环境只验证会改变用户判断的路径，不把每个边角都变成发布前新开发任务。

**macOS Apple Silicon：**

- [ ] 真实 `.app` 从旧安装状态启动，确认跳版本只出现一个按版本分组的窗口；展示成功后已读状态写入；同版重启不自动弹；托盘手动只看当前版本且不改状态。
- [ ] 确认标题栏 X、知道了、Escape、长内容滚动、焦点、退出和 Dock/Cmd-Tab 行为；下载进度窗仍正常。

**Windows PC：**

- [ ] 用 x64 NSIS 安装包完成同一核心矩阵，覆盖 100%/125%/150% DPI、任务栏可达和便签数据保留；Windows 结果必须来自 Windows 真机。
- [ ] 记录失败层、系统版本、DPI、显示器布局和截图/日志；Mac 结果不得代替 Windows。

**发布边界：**

- [ ] 在实现、自动验证、产物验证、两端目标环境验证都具备证据前，不 push、不合入 `main`、不发布。
- [ ] 得到用户明确授权后，另开版本准备流程；更新 package/lock/CHANGELOG、构建 Draft、验证旧版升级，最后才上传 `latest.yml` / `latest-mac.yml` 并记录监测状态。

## 完成定义

只有以下条件全部满足，才可以说“自有窗口实现完成”：

- 版本选择和跳版本归档测试通过；
- 自动/手动窗口语义、显示后落盘、超时、来源固定和退出测试通过；
- 第三个 sandbox preload 真实产物为 `.cjs`，CSP/导航/IPC sender 校验已接线；
- `npm test`、`npm run build`、`npm audit`、`git diff --check` 通过；
- Windows/macOS asar 内容检查通过；
- Codex 本地 review 与 GLM / Opus 独立只读 review 针对同一最终 diff 完成；
- HANDOFF 中实现、自动验证、产物验证、目标环境、发布和监测状态仍分别记录，没有互相推导。

任何一项缺失，都只报告到对应状态，不把“代码已接线”写成“已发布”。
