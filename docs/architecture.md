# 架构说明

## 进程边界

悬浮便签基于 Electron，渲染窗口启用上下文隔离，并关闭 Node 集成。

- `main/`：窗口生命周期、持久化、图片存储、托盘、开机启动和自动更新
- `preload/`：向渲染进程提供受限的 IPC bridge
- `renderer/`：React 便签界面与编辑交互
- `shared/`：主进程和渲染进程共用的逻辑

渲染窗口不能直接读取任意本地文件或调用 Node API。图片导入和便签保存必须经过主进程中带校验的 IPC handler。

## 数据模型与存储

便签保存在 Electron `userData` 目录下的 `notes.json`。导入图片保存在相邻的 `images/` 目录，便签记录只保留图片引用和尺寸。

写入操作会进行防抖和串行化。应用退出或安装更新前，会保存渲染进程中的内容、窗口位置以及等待中的存储任务。读取数据时会归一化或跳过损坏记录，避免一条异常便签阻止应用启动。

便签名称是可选的识别信息，不承担标签或分类职责。主进程保存名称前会去除首尾空白，并按最多 60 个 Unicode code point 截断；空名称保持为空。非空名称以小号半粗体常驻显示在顶部中央；空名称平时保持空白，只在命名热区悬停时提示“双击命名”。名称编辑和保存失败恢复由 renderer 的独立命名状态管理，系统窗口标题仍由主进程设置。

为兼容既有安装，主进程可以读取 `userData` 中可选的 `personalization.json`，并根据其中的 `displayName` 生成本地占位文案。源码仓库和公开安装包不会创建或内置这个文件；文件缺失或格式不合法时使用中性文案。

## 窗口与托盘生命周期

每张便签对应一个透明、无边框的 `BrowserWindow`。有名称时，系统窗口标题使用该名称；空名称回退为“悬浮便签”。主进程阻止 renderer 的页面标题覆盖这个值，使任务栏和窗口切换界面可以使用稳定的便签身份。恢复窗口时会把位置与尺寸限制在可用显示器范围内。在 Windows 上关闭最后一张便签不会终止应用，因为托盘仍然常驻；托盘“显示所有便签”会重新创建仍保存在本地但已关闭的便签窗口。应用持有单实例锁，再次启动只会通知现有进程恢复便签，避免两个进程同时写入 `notes.json`。托盘的“退出”会先完成数据保存，再真正结束进程。

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

便签窗口与更新进度窗口都启用 Electron sandbox。electron-vite 必须把两个 preload 构建为 CommonJS，并由主进程加载 `.cjs` 文件；沙箱 preload 若输出为带 import 的 ESM，bridge 不会执行，renderer 只能停留在默认准备状态。

Windows 关闭全部便签窗口后仍由系统托盘常驻。只有托盘“退出”、明确执行安装或系统退出才结束进程，避免进度窗口关闭时触发 `autoInstallOnAppQuit` 并绕过安装确认。

### macOS

只有 `process.platform === 'darwin'` 且 `app.isPackaged === true` 时，才启用 Mac 半自动更新。Mac 不调用 `electron-updater` 的 `quitAndInstall`，而是读取同一更新源中的 `latest-mac.yml`，并只接受符合 `StickyNotes-Mac-<version>.dmg` 格式的安装镜像。

应用启动后静默检查，托盘也可以手动检查。用户确认下载后，主进程把 DMG 流式写入“下载”文件夹，并校验元数据声明的文件大小和 SHA-512；校验通过后才会询问是否保存便签、打开安装镜像并退出。由于 Mac 构建未签名，用户仍需把应用拖到 Applications 并确认替换。
