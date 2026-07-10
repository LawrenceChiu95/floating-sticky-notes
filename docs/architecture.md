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

为兼容既有安装，主进程可以读取 `userData` 中可选的 `personalization.json`，并根据其中的 `displayName` 生成本地占位文案。源码仓库和公开安装包不会创建或内置这个文件；文件缺失或格式不合法时使用中性文案。

## 窗口与托盘生命周期

每张便签对应一个透明、无边框的 `BrowserWindow`。恢复窗口时会把位置与尺寸限制在可用显示器范围内。在 Windows 上关闭最后一张便签不会终止应用，因为托盘仍然常驻；托盘的“退出”会先完成数据保存，再真正结束进程。

## 更新机制

更新能力只在打包应用中启用，开发环境不会请求公开更新源。Windows 与 macOS 共用同一个 GitHub Release，但读取不同的元数据文件。

### Windows

只有同时满足以下条件才启用 Windows 自动更新：

- `process.platform === 'win32'`
- `app.isPackaged === true`

`electron-updater` 使用以下通用更新源：

```text
https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download
```

应用启动后静默检查一次更新；用户也可以从托盘手动检查。发现新版本后，下载和重启安装都需要用户确认；执行 `quitAndInstall` 前会先保存便签数据。

### macOS

只有 `process.platform === 'darwin'` 且 `app.isPackaged === true` 时，才启用 Mac 半自动更新。Mac 不调用 `electron-updater` 的 `quitAndInstall`，而是读取同一更新源中的 `latest-mac.yml`，并只接受符合 `StickyNotes-Mac-<version>.dmg` 格式的安装镜像。

应用启动后静默检查，托盘也可以手动检查。用户确认下载后，主进程把 DMG 流式写入“下载”文件夹，并校验元数据声明的文件大小和 SHA-512；校验通过后才会询问是否保存便签、打开安装镜像并退出。由于 Mac 构建未签名，用户仍需把应用拖到 Applications 并确认替换。
