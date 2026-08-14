# 架构说明

## 依赖与构建链

构建链仍以 npm 10 执行 `npm ci`，但 lockfile 再生成和 CI 完整安全审计使用 npm 11。原因有两层：npm 10 的旧审计端点正在退役；npm 10 也不能从旧 lockfile 首次正确解析本项目的跨大版本 override。仓库 lockfile 必须继续经过干净临时目录中的 npm 10 `npm ci` 复核，避免“生成工具能读、声明的安装环境不能读”。

`electron-builder@26.15.3` 的传递链同时包含 `minimatch` 3、5、9 和 10；这些版本原本依赖 `brace-expansion` 1、2 或 5，而 [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) 覆盖所有 `<=5.0.7`。直接把旧版 `minimatch` 强制到官方 `brace-expansion@5.0.8` 会因 CJS 导出形态变化，让花括号 glob 在打包时抛出 `TypeError`。因此 `vendor/brace-expansion-compat` 只负责导出适配：底层固定转发官方 5.0.8，同时提供旧版本所需的 callable / default 与新版 named export。该包仅属于 devDependency，不进入应用生产依赖或 asar。`tests/brace-expansion-compat.test.ts` 锁定四条 `minimatch` 版本线的花括号匹配和 4,000,000 字符安全上限；上游旧版本发布兼容安全修复，或 electron-builder 稳定版完全移除旧链后，应删除本地兼容包与 override。

## 进程边界

悬浮便签基于 Electron，渲染窗口启用上下文隔离，并关闭 Node 集成。

- `main/`：窗口生命周期、持久化、图片存储、托盘、开机启动和自动更新
- `preload/`：向渲染进程提供受限的 IPC bridge
- `renderer/`：React 便签界面与编辑交互
- `shared/`：主进程和渲染进程共用的逻辑

渲染窗口不能直接读取任意本地文件或调用 Node API。图片导入和便签保存必须经过主进程中带校验的 IPC handler。

## 数据模型与存储

便签保存在 Electron `userData` 目录下的 `notes.json`。导入图片保存在相邻的 `images/` 目录，便签记录只保留图片引用和尺寸。开发模式在启动早期把 `userData` 改到独立的 `<appData>/floating-sticky-notes-dev`（`main/app-lifecycle.ts` 的 `getDevUserDataPath`），正式版路径不变；单实例锁随 `userData` 分离，因此开发实例与正式版可以同机同时运行，开发中的删除不会碰到正式数据。开机启动是系统全局设置，不随 userData 隔离；开发进程跳过首次默认启用逻辑，避免新的 dev 目录重新启用或改写用户已经关闭的登录项，只有托盘中的显式开关可以在调试时修改它。

清单记录使用可选的 `parentId` 表达一层子任务：缺少该字段的旧记录仍是普通任务，数组顺序继续作为显示顺序真源，不保存 `children` 或 `depth` 等派生字段。主进程和 renderer 边界共用幂等的层级归一化逻辑，确保子任务紧跟父任务，并将第三层、孤儿或自引用关系降级为普通任务，同时保留文字、完成状态和时间字段。父任务与子任务的完成状态彼此独立。

写入操作会进行防抖和串行化。应用退出或安装更新前，会保存渲染进程中的内容、窗口位置以及等待中的存储任务。读取数据时会归一化或跳过损坏记录，避免一条异常便签阻止应用启动。

便签名称是可选的识别信息，不承担标签或分类职责。主进程保存名称前会去除首尾空白，并按最多 60 个 Unicode code point 截断；空名称保持为空。非空名称以小号半粗体常驻显示在顶部中央；空名称平时保持空白，只在命名热区悬停时提示“双击命名”。名称编辑和保存失败恢复由 renderer 的独立命名状态管理，系统窗口标题仍由主进程设置。

为兼容既有安装，主进程可以读取 `userData` 中可选的 `personalization.json`，并根据其中的 `displayName` 生成本地占位文案。源码仓库和公开安装包不会创建或内置这个文件；文件缺失或格式不合法时使用中性文案。

## 窗口与托盘生命周期

每张便签对应一个透明、无边框的 `BrowserWindow`。有名称时，系统窗口标题使用该名称；空名称回退为“悬浮便签”。主进程阻止 renderer 的页面标题覆盖这个值，使任务栏和窗口切换界面可以使用稳定的便签身份。恢复窗口时会把位置与尺寸限制在可用显示器范围内。在 Windows 上关闭最后一张便签不会终止应用，因为托盘仍然常驻；托盘“显示所有便签”会重新创建仍保存在本地但已关闭的便签窗口。应用持有单实例锁，再次启动只会通知现有进程恢复便签，避免两个进程同时写入 `notes.json`。托盘的“退出”会先完成数据保存，再真正结束进程。

应用内收起由 renderer 与主进程共同编排，但不使用 Electron 原生窗口动画：renderer 负责 240ms 的壳体、标题、工具栏和正文过渡，主进程在过渡边界只执行一次非动画 `setBounds`。壳体的 height 过渡与 `will-change` 只允许挂在 `.note-shell--collapse-transitioning` 过渡态上，绝不能回到 `.note-shell` 基础态：`100vh` 属于视口单位，用户对窗口做任何边/角原生缩放都会触发它，基础态挂过渡会让纸面高度用 240ms 追赶窗口——顶边上拉时窗口底边锚定、纸面底部却先缩再弹回（该回归的证据与守卫测试见 `tests/note-shell-height-transition.test.ts`）。收起控制器始终保留完整展开尺寸；横条被拖动后，展开以当前左上角为锚，只有超出显示器工作区时才夹取。持久化窗口 bounds 时，即使窗口当前收起，也只保存展开宽高和横条当前位置，避免下次启动恢复成 40px 高窗口。收起状态目前只属于当前 renderer 会话，不进入 `NoteRecord` 或 `notes.json`。收起横条自身承载命名：未命名便签收起后标题区留白（不再回退显示应用名，应用名回退只存在于 OS 级窗口标题），双击标题区可原地命名，与展开态共用同一套命名组件、同一个输入框 ref 和提交流程（折叠过渡中途只渲染静态文本，过渡结束后才挂载交互组件）。展开态名称在当前标题轨道内居中，进入编辑时工具栏折叠让位，输入框以 `160×20px` 长槽居中；收起态的名称与编辑器都以整个窗口中心为不变量，双击时从实测名称槽宽度向两侧平滑增长到最大 `160px`，文字和槽中心不绕路。收起标题轨通过默认 `7px`、≤220px 窄窗 `5px` 的右侧补偿抵消抓手与折叠按钮的宽度差，几何测试分别锁定 `280px` 与 `200px` 窗口的精确中心。折叠或展开开始时，renderer 仍量取并冻结展开态标题轨道宽度，避免右侧工具栏收放时 flex 轨道改变、带着居中名称横向滑动；过渡结束后再解除冻结。macOS 原生 live-resize、命名轨迹和删除确认事件的诊断证据见 [`debug-log/issue-11-collapse-animation-2026-07-22.md`](../debug-log/issue-11-collapse-animation-2026-07-22.md)。

收起横条还有第三态「贴边」：窗口状态机为 `expanded → collapsed（40px 横条）→ docked（左右工作区边缘的 8×56 缝）`，由同一个收起控制器编排，复用「renderer 演视觉、主进程只在过渡两端各做一次非动画 `setBounds`」的约束；横条→贴边先演收缩视觉再缩窗口，贴边→展开先放大窗口再演生长视觉，且同样禁止 `setBounds(..., true)` 与 `.note-shell` 基础态尺寸过渡。贴边只允许从横条进入，展开只允许从缝进入，不支持展开直贴或贴边回横条。展开态横条的窗口拖动仍走 `-webkit-app-region: drag`；收起横条与贴边缝不走 app-region，改用 renderer 指针事件 + 增量 IPC + 主进程 `setBounds` 的手动拖动（与图片预览窗同一模式：指针捕获、`screenX` 增量、rAF 合帧）。原因是 macOS 的 `moved` 是 `move` 的别名（拖动中连续触发），平台没有任何「拖动结束」窗口事件，基于 `moved` 静默期的近似会把拖动中的停顿误判成松手；只有 renderer 的 `pointerup` / `pointercancel` 才是真实松手。「松手是否贴边（左右缘 24px 阈值，顶底不吸）」与「缝拖出是否展开（水平 48px 阈值，不足则弹回原缝）」因此只在 `finish-note-window-drag` IPC 上由主进程判定一次（每窗一份 `main/note-window-drag.ts` 会话）。判定通过后经 `dock-offer` / `undock-offer` 通知 renderer 播 240ms 过渡，renderer 再带 epoch `accept-dock` / `accept-undock` 确认：会话只认最后一次 offer，重新拖动即刻作废旧 offer，accept-dock 时主进程复核横条仍在该侧边缘，展开矩形永远由主进程在松手时算好（renderer 传值不参与），主进程此时才落原生矩形并持久化。几何阈值与矩形计算全部在 `shared/note-dock.ts`，主进程与测试共用。持久化只写 `NoteRecord.dock?: { side, y }`；`bounds` 始终表示最后一次展开态的位置与尺寸，进入贴边、拖动缝、弹回贴边都不改写 `bounds`，从贴边展开后用松手位置夹取过的展开矩形写回并删除 `dock`。启动时合法 `dock` 直接按 8×56 建窗（`minWidth/minHeight` 用 8/56 而非 `NOTE_MIN_WIDTH`），缝夹取后不落在任何可见工作区则丢弃 `dock` 按 `bounds` 展开。多张同侧缝即将重叠时沿边向下错开 64px（缝高 56 + 8 间隙），不够再向上，仍无空位保证至少 24px 可抓高度。贴边不做截图排除 API、悬停探出、快捷键或吸顶/底边；设计真源是 [`docs/design/edge-dock.md`](design/edge-dock.md)。

## 更新机制

更新能力只在打包应用中启用，开发环境不会请求公开更新源。Windows 与 macOS 共用同一个 GitHub Release，但读取不同的元数据文件。

### Windows

只有同时满足以下条件才启用 Windows 自动更新：

- `process.platform === 'win32'`
- `app.isPackaged === true`

`electron-updater` 使用更新仓库 `LawrenceChiu95/floating-sticky-notes-updates` 的 GitHub provider。它按 Release tag 读取安装包和 blockmap，例如：

```text
https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/download/v<version>/StickyNotes-Setup-<version>.exe
```

GitHub provider 会关闭不兼容的多段 Range 请求，但保留单段 Range 的差分下载；每个正式 Windows Release 的 `.exe.blockmap` 必须长期保留。`latest.yml` 仍由最新正式 Release 提供，旧版本的 blockmap 则从对应的版本 Release 目录读取。`0.1.13` 是首个切换到 GitHub provider 的正式版本；`0.1.12` 及更早客户端的首次迁移仍可能由旧通用源回退为完整下载。诊断与真机证据见 [`debug-log/windows-differential-update-2026-07-15.md`](../debug-log/windows-differential-update-2026-07-15.md)。

构建脚本根据 `package.json` 的版本号自动选择通道：`0.1.13-rc.1` 生成 `rc.yml`，正式版本生成 `latest.yml`。RC 验证使用两个连续的预发布版本验证差分下载，不依赖额外环境变量；正式构建继续使用 `latest`。

应用启动后静默检查一次更新；用户也可以从托盘手动检查。发现新版本后，下载和重启安装都需要用户确认；执行 `quitAndInstall` 前会先保存便签数据。

用户确认下载后，更新控制器通过窄 presenter 接口驱动独立的进度窗口。该窗口使用自己的 preload 和 renderer，只能接收只读进度快照，不具备便签读写 IPC 权限。控制器按 operation ID 和显式阶段接受 `download-progress`、`update-downloaded` 与错误事件，忽略迟到或重复事件；详细设计见 [`docs/design/windows-update-progress.md`](design/windows-update-progress.md)。

便签窗口不启用 sandbox（需要拖拽等原生交互），更新进度窗口、版本反馈窗口和图片预览窗口启用 Electron sandbox。electron-vite 必须把 preload 构建为 CommonJS，并由主进程加载 `.cjs` 文件；沙箱 preload 若输出为带 import 的 ESM，bridge 不会执行，renderer 只能停留在默认准备状态。另一条硬性约束：**沙箱 preload 必须是单文件自包含的**——沙箱内的 `require` 只允许 `electron` 和少量 Node 内置，不允许相对路径。若某个 `shared/` 模块被两个及以上 preload 入口引用，Rollup 会把公共代码拆成 `out/preload/chunks/*.cjs` 共享 chunk，沙箱 preload 加载即抛 "module not found"，bridge 永远不会建立（#10 图片预览窗曾因此整窗零渲染）。因此跨 preload 共享的常量应在各入口内联，构建产物 `out/preload/` 下不应存在 chunks 目录。

## 图片预览

便签内联图片点击后打开独立的单例预览窗口（无边框、置顶、层级不低于便签）。初始尺寸贴合图片原始大小（不放大，上限显示器工作区 80%，下限 320×240），优先放在源便签右侧、放不下放左侧，再退化到工作区居中。

渲染进程不直接传图：renderer 只发 `imageId`，主进程通过 `event.sender` 定位源便签并生成快照（图片列表 + 活动图片 id），经 `webContents` id 关联后由预览 renderer 主动 invoke 取回，不经 URL 参数。图片内容走自定义协议 `sticky-notes-image:`（主进程 `protocol.handle` 注册，CSP `img-src` 显式放行）。预览为只读且复用单例窗口：用户再次点击另一张内联图片时，主进程随快照发送一次性的显式选图意图；仅因图片列表变化而刷新快照时，renderer 保留当前图片，只有当前图片已被删除才回退到快照活动图。源便签窗口关闭或便签删除时，主进程控制器联动关闭预览。

预览 renderer 的缩放/平移为 refs + requestAnimationFrame 直写 `style.transform`，不经过 React state；缩放朝光标位置，平移在超过 fit 比例后启用。注意两个实测踩过的坑：dev 模式 `loadURL` 必须带 `.html` 后缀（vite 的 html fallback 拒绝无扩展路径）；首帧渲染 loading 态时视口元素不在 DOM，测量视口的 effect 必须等快照到达后重跑，否则 ResizeObserver 永不安装、fit 比例退化为 1/图片宽度（图片缩成一个像素点）。

预览窗口的移动与缩放都不使用 `-webkit-app-region`，统一走 renderer 指针事件 + IPC 增量 + 主进程 `setBounds`：按住背景、适配态图片或顶部 28px 拖动条拖拽，按 `screenX` 增量 rAF 合帧后经 `image-preview:move` 移动窗口，释放指针前会提交尚未发送的最后一帧位移；七向缩放手柄（S/E/W 与四角，不含上边缘）经 `image-preview:resize` 增量提交，西/北方向锚定右/下缘，尺寸上限每次按窗口当前所在显示器重新计算。窗口尺寸变化后，未手动缩放的图片重新 fit，已缩放图片保留比例并重新夹取平移量，避免视口变大后露出多余空白。放弃 app-region 的两个实测原因：CDP 与 CGEvent 合成输入都无法触发 macOS app-region 的 OS 级拖动，该路径无法自动化验证；根元素入场动画若用 `fill: both` 会永久残留 `transform: scale(1)`，祖先 transform 使 app-region 命中区计算失效（fill 已固定为 `backwards`）。上边缘不做缩放手柄——那是用户直觉里的标题栏，整段留给拖动条移动窗口，顶部缩放由 NE/NW 角承担。放大态图片拖拽仍为平移；背景单击关闭窗口，拖动条与图片单击不关闭。

便签内联图片上限为 `max-height: min(240px, 45vh)`：默认高度便签里方图/竖图不会把正文输入区顶出可视区，大窗口维持 240px。

Windows 关闭全部便签窗口后仍由系统托盘常驻。只有托盘“退出”、明确执行安装或系统退出才结束进程，避免进度窗口关闭时触发 `autoInstallOnAppQuit` 并绕过安装确认。

### macOS

只有 `process.platform === 'darwin'` 且 `app.isPackaged === true` 时，才启用 Mac 半自动更新。Mac 不调用 `electron-updater` 的 `quitAndInstall`，而是读取同一更新源中的 `latest-mac.yml`，并只接受符合 `StickyNotes-Mac-<version>.dmg` 格式的安装镜像。

应用启动后静默检查，托盘也可以手动检查。用户确认下载后，主进程把 DMG 流式写入“下载”文件夹，并校验元数据声明的文件大小和 SHA-512；校验通过后才会询问是否保存便签、打开安装镜像并退出。Mac 构建对完整 app bundle 使用 ad-hoc 签名和 hardened runtime，构建脚本会执行严格签名校验；由于它没有 Apple Developer ID 且未经过公证，Gatekeeper 不会直接信任，用户仍需把应用拖到 Applications，并在“系统设置 → 隐私与安全性”中选择“仍要打开”。

## 版本更新反馈

版本反馈使用独立的 `release-feedback.json` 保存已展示的稳定版本，不修改 `notes.json`。主进程在便签初始化和一次性开机启动 marker 创建前捕获旧安装痕迹；全新安装先建立当前版本基线，老用户升级则在便签窗口恢复后展示一次。托盘版本入口与自动路径共用独立、非模态的版本反馈窗口和离线生成的结构化内容，手动查看不改变已读状态；退出开始后不再创建新的反馈窗口。

`CHANGELOG.md` 是唯一人工内容源。`predev` 和 `prebuild` 运行 `scripts/build-release-notes.cjs`，按稳定核心版本提取版本号、发布日期、分类和条目，生成 `main/generated/release-notes.ts`，随后由主进程 bundle 打入应用。运行时不读取仓库 Markdown，也不联网获取 Release 文案。

版本反馈窗口使用自己的 renderer、最小 preload 和 presenter。离线归档按 SemVer 升序保存，自动路径在筛选未读范围后按 SemVer 倒序展示，确保最新版本位于最上方；手动路径只显示当前版本。窗口固定宽度并在显示前按内容测量高度；少量内容自然收紧，长内容只滚动中间版本/条目区域，编辑式页头和底部操作保持可见。自动与手动请求复用唯一活动窗口，只有来源为自动且窗口真实显示成功时才写入已读版本。完整产品行为见 [`docs/design/release-highlights.md`](design/release-highlights.md)。
