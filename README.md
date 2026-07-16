# Floating Sticky Notes（悬浮便签）

<img src="assets/icons/app-icon.png" alt="悬浮便签图标" width="128">

悬浮便签是一款小巧的 Electron 桌面应用，用于把本地便签持续显示在普通窗口上方。当前界面使用中文，并以 Windows 为主要支持平台。

## 功能

- 创建多张始终置顶的便签
- 编辑纯文本和待办清单
- 待办清单支持一层可选子任务，可用 Tab / Shift+Tab 调整层级，并提供父任务行上的轻量鼠标入口
- 为每张便签设置可选名称，并在系统窗口切换界面中区分不同便签
- 粘贴剪贴板图片、系统截图，或直接拖入图片
- 分别调整每张便签的颜色和透明度
- 恢复窗口大小与位置
- 使用本地 JSON 和图片文件保存数据，不需要账号、云服务，也不包含遥测
- 通过系统托盘新建或恢复便签、设置开机启动和退出应用
- 在托盘中确认当前版本，并随时重新查看本版新增与修复
- 通过公开的 GitHub Release 更新源在应用内检查更新
- Windows 下载更新时显示独立、非阻塞的进度窗口

## 项目状态

当前正式版本为 [`0.1.15`](https://github.com/LawrenceChiu95/floating-sticky-notes/releases/tag/v0.1.15)。本版本将版本更新反馈改为紧凑、非模态的自有窗口，少量内容自然收紧，跳版本或长内容在固定页头和操作区之间滚动展示。

Windows x64 Setup 和 Apple Silicon Mac DMG 可从 [`floating-sticky-notes-updates v0.1.15`](https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/tag/v0.1.15) 下载。Windows 可以在应用内完成检查、下载和重启安装；macOS 会下载并校验 DMG、打开安装镜像，用户仍需手动拖到 Applications 并确认替换。当前安装包均未签名，系统可能显示未知发布者或安全提示。

`0.1.9` 是首个公开源码版本，也是首个具备 Windows 自动更新能力的版本；`0.1.10` 增加了 macOS 半自动更新。项目在公开前已经完成 `0.1.0` 至 `0.1.8` 的内部迭代；完整且经过隐私清洗的版本历史见 [变更日志](CHANGELOG.md)。

更新资源存放在 [`floating-sticky-notes-updates`](https://github.com/LawrenceChiu95/floating-sticky-notes-updates)。源码、Issue 和变更记录在本仓库维护。

## 从源码运行

环境要求：

- Node.js 22
- npm 10

```bash
npm ci
npm run dev
```

运行自动化检查：

```bash
npm test
npm run build
npm audit
```

## 构建安装包

构建 Windows x64 NSIS Setup 安装包：

```bash
npm run dist:win
```

在 macOS 上构建未签名的 Apple Silicon DMG：

```bash
npm run dist:mac
```

Windows 只维护 Setup 安装包。portable 便携包不在自动更新支持范围内，因此不再提供。

Windows 更新可在应用内完成下载、退出和安装；macOS 更新会自动下载并校验 DMG，但安装替换仍由用户完成。

## 本地数据

便签和导入的图片只保存在当前电脑：

- Windows：`%APPDATA%\floating-sticky-notes`
- macOS：`~/Library/Application Support/floating-sticky-notes`

安装更新不会删除这个目录。卸载应用时也会保留本地便签，除非用户手动删除。

## 参与贡献

欢迎提交 Bug、功能建议和 Pull Request。提交代码前请阅读 [贡献指南](CONTRIBUTING.md)；安全问题请按照 [安全策略](SECURITY.md) 私下报告。

架构和发布流程见 [`docs/architecture.md`](docs/architecture.md) 与 [`docs/releasing.md`](docs/releasing.md)。

## 开源许可证

本项目采用 MIT 许可证。具有法律效力的原文见 [LICENSE](LICENSE)，中文参考译文见 [LICENSE.zh-CN.md](LICENSE.zh-CN.md)。
