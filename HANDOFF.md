# 当前交接

> 最后同步：2026-07-12。本文件只记录当前活状态和下一窗口入口；长期架构见 `docs/architecture.md`，发布闸门见 `docs/releasing.md`。

## 版本与工作位置

- 已公开发布的最新版本：`0.1.10`。
- 当前开发中的下一版本：计划为 `0.1.11`，但源码版本号暂时仍保持 `0.1.10`，只在发布收口时统一升级。
- 公开源码仓库：`/Users/lawrence/Desktop/My Life/工具/floating-sticky-notes`。
- 当前分支：`feat/note-naming`。
- 分支起点：`32b86ed docs(handoff): 同步更新进度功能交接状态`。
- 当前工作区：干净；`feat/note-naming` 从最新 `main` 创建，目前只有本交接文档提交，尚无命名功能代码提交。
- `main` 与 `origin/main` 已包含 Issue #1 的更新进度功能，均位于 `32b86ed`。
- 当前目录名为“悬浮便签”的私有仓库只是只读历史归档，不得在其中继续开发。

## 0.1.11 功能范围

这个版本计划包含三个彼此独立的用户功能：

1. Windows 自动更新下载进度窗口：已开发、已合入并推送到 `main`，尚未随正式版本发布。
2. 便签命名：下一窗口立即实现，当前分支已经准备好。
3. “关于悬浮便签”：命名合入后再单独开分支实现，尚未设计、实现或测试。

功能进入 `main` 只代表源码集成完成，不代表软件已经发布。只有完成版本号、变更日志、安装包、真机验证，并把更新元数据发布到更新仓库后，用户才会收到 `0.1.11`。

## 已完成：更新进度

Windows 自动更新的非阻塞下载进度窗口已经实现。窗口独立于便签，可拖动、最小化并从任务栏恢复；下载期间便签和托盘继续工作。更新控制器使用显式阶段和 operation ID 防止迟到事件、重复下载与重复安装提示，关闭全部便签后 Windows 仍由托盘常驻。

真机故障的根因不是 updater 没有发送进度，而是 `sandbox: true` 的进度 preload 曾被构建为 ESM，导致 bridge 没有执行。当前构建强制两个 preload 输出 CommonJS，主窗口加载 `preload.cjs`，进度窗口加载 `updateProgressPreload.cjs`。

已有证据：

- Windows 11、Node 22.11.0、npm 10.9.0。
- 本地限速更新持续 49.002 秒，进度从 2% 连续更新到 100%。
- 已验证进度窗口最小化与任务栏恢复；下载完成后出现安装确认，选择“稍后安装”后应用继续运行并清理进度状态。
- 使用隔离 profile，未修改用户现有便签数据。
- Codex 与 Opus 已审查最终更新功能 diff，没有高、中、低等级发现。
- 基线验证：37 个测试文件、176 个测试通过；`npm run build`、`npm audit --omit=dev`、`git diff --check` 均通过。
- 内部验证包使用了 `0.1.10` 文件名，但公开 `0.1.10` 已经存在，正式发布不得覆盖或重发该版本号。

发布前仍需验证正式 `0.1.10 -> 0.1.11` 线上覆盖安装、断网恢复、多显示器和 DPI、进度窗口禁止关闭，以及便签和图片保留；完整清单以 `docs/releasing.md` 为准。

## 下一项：便签命名

### 产品目标

每张便签可以有一个名字，帮助用户区分项目、工作和生活等不同用途；名字只是安静的识别锚点，不引入分类、标签、文件夹、筛选或工作区，也不新增一行标题表单。

### 已确定交互

- 名字写在顶部拖拽条中间，复用当前 `status-label` 的位置。
- 空名字默认不显示，保持现有界面干净。
- 鼠标悬停顶部拖拽条时，中间淡淡显示“`双击命名`”。这是本版本的显式发现入口。
- 双击中间区域后，原地变成无边框输入框，自动聚焦并全选。
- `Enter` 或失焦保存，`Esc` 取消并恢复编辑前的名字。
- 有名字后，顶部中间常驻显示小号、muted、单行省略的名字；完整名字通过 tooltip 查看。
- 临时状态优先级最高：`保存失败 / 贴图失败 / 读取失败` 等状态显示时覆盖名字和 hover 提示，状态结束后回到名字或空态。
- 空白或只含空格的输入保存为空名字；输入在可信边界统一 `trim`，并限制为最多 60 个字符。
- 编辑输入框必须使用 `-webkit-app-region: no-drag`；非编辑状态仍属于拖拽区，单击和拖动不能受影响。
- 不增加常驻重命名图标。
- 本版本不做便签右键菜单。以后完整实现时再把“重命名 / 新建 / 颜色 / 透明度 / 置顶 / 删除”一起放入，避免现在出现只有一项的不完整菜单。

显示优先级只有一个顺序：

```text
临时状态 > 正在编辑 > 已有名字 > 空名 hover 提示 > 空白
```

### 现有代码事实

`name` 全链路已经存在，不需要修改数据格式或迁移旧数据：

- `main/note-state.ts`：`NoteRecord.name` 和新便签默认空名字。
- `main/storage.ts`：读取和保存名字。
- `main/notes-manager.ts`：`updateNameForWebContents`。
- `main/main.ts`：`sticky-notes:update-name` IPC。
- `preload/preload.ts`、`renderer/src/global.d.ts`：`updateName(name)` bridge 与类型。
- `tests/notes-manager.test.ts`、`tests/storage.test.ts`：已有名字持久化基线测试。

主要实现面在 `renderer/src/App.tsx` 和 `renderer/src/styles.css`。主进程仍应补充名字归一化，保证 renderer 之外的调用也不能保存超长或未 trim 的名字。

### 实施与验收

按测试先行完成以下行为：

1. 为名字归一化补纯函数或主进程单元测试：trim、空名、60 字符边界和超长截断。
2. 为 renderer 的命名状态和键盘行为补可测试逻辑，避免只用源码字符串断言覆盖核心交互。
3. 在 `App.tsx` 加载 `note.name`，实现开始编辑、提交、取消和失败状态；保存成功后使用主进程返回的规范化名字。
4. 在现有拖拽条槽位渲染状态、名字和 hover 提示；不要恢复正文上方的独立标题输入行。
5. 在 `styles.css` 保持 12px muted、ellipsis/nowrap，并保证输入框为 `no-drag`、无边框、无底色。
6. 在 `CHANGELOG.md` 的 `[未发布] / 新增` 记录用户可见的便签命名功能。
7. 运行 `npm test`、`npm run build`、`npm audit --omit=dev`、`git diff --check`。
8. 人工运行应用，至少检查空名、hover、双击、Enter、失焦、Esc、超长名字、窄窗口、拖动窗口和状态覆盖。
9. push 或 PR 前按全局规则对最新 diff 做本地 Codex/Opus review；review 后如有实质修改，必须复审新增 diff。

不要在命名功能分支中顺手实现“关于”、右键菜单或版本号升级。

## 后续项：关于悬浮便签

命名功能合入 `main` 后，从最新 `main` 新建 `feat/about`。当前只记录已选择的最小方向：

- 托盘菜单增加“关于悬浮便签”。
- 点击后使用系统信息框显示应用信息。
- 版本号必须通过 `app.getVersion()` 读取实际安装版本，不能硬编码。
- 具体文案、信息项、平台表现和测试方案在该分支开工前单独确认。

该功能目前不是“已完成”，也不应提前写入 `CHANGELOG.md`。

## 多功能进入同一版本的分支流程

`main` 是下一版本的集成线，不等于已发布版本。每个功能使用自己的短分支，完成后依次回到 `main`：

```text
已发布 v0.1.10
    |
main + 更新进度
    |
feat/note-naming -> 验证、review、合入 main
    |
feat/about       -> 验证、review、合入 main
    |
main             -> 统一升版 0.1.11、打包、真机验证、发布
```

当前窗口切换到新窗口时，不需要再建命名分支；新窗口直接在公开仓库的 `feat/note-naming` 继续。开工先运行：

```bash
cd "/Users/lawrence/Desktop/My Life/工具/floating-sticky-notes"
git status --short --branch
git log -3 --oneline --decorate
```

命名完成后的切换顺序：

1. 保持 `package.json` 仍为 `0.1.10`，完成命名测试、构建、审查和提交。
2. 获得用户明确许可后 push `feat/note-naming`，再通过 PR 或确认后的 fast-forward 合入 `main`。
3. 更新本地 `main`，确认工作区干净且 `main` 包含命名提交。
4. 从该最新 `main` 创建 `feat/about`，不要从旧的更新分支或未合入的工作树创建。
5. “关于”完成后重复测试、review、push 和合入流程。
6. 三项功能都在 `main` 后再做一次发布收口：把 `package.json` 与 lockfile 升到 `0.1.11`，把 `[未发布]` 归档为正式版本，构建候选包并执行全量发布验证。
7. 真机闸门通过后才创建 tag、源码 Release 和更新仓库 Release；`latest.yml` 与 `latest-mac.yml` 最后上传，它们才是客户端真正发现新版本的开关。

任何分支存在未提交改动时都不要切换到下一功能；任何功能尚未合入 `main` 时都不要只靠另一个分支“顺带带入”。这样每个功能都能独立审查、回退，同时最终仍进入同一个 `0.1.11`。

## 新窗口第一句话

建议直接说：

> 请先阅读 `AGENTS.md` 和 `HANDOFF.md`，确认位于公开源码仓库的 `feat/note-naming` 且工作区干净，然后按交接中的既定交互用测试先行实现便签命名。不要实现“关于”、右键菜单或发布；完成后运行全部闸门并对最新 diff 做本地 review。
