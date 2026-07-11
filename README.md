# Floating Sticky Notes（悬浮便签）

<img src="assets/icons/app-icon.png" alt="悬浮便签图标" width="128">

悬浮便签是一款小巧的 Electron 桌面应用，用于把本地便签持续显示在普通窗口上方。当前界面使用中文，并以 Windows 为主要支持平台。

## 功能

- 创建多张始终置顶的便签
- 编辑纯文本和待办清单
- 粘贴剪贴板图片、系统截图，或直接拖入图片
- 分别调整每张便签的颜色和透明度
- 恢复窗口大小与位置
- 使用本地 JSON 和图片文件保存数据，不需要账号、云服务，也不包含遥测
- 通过系统托盘新建便签、设置开机启动和退出应用
- 通过公开的 GitHub Release 更新源在应用内检查更新

## 项目状态

`0.1.9` 是首个公开源码版本，也是首个具备 Windows 自动更新能力的版本。

`0.1.10` 增加 macOS 半自动更新：打包版会在启动后静默检查，托盘也可以手动检查；发现新版本后，应用会在用户确认后下载并校验 DMG，随后打开安装镜像。由于当前 Mac 包未签名，最后仍需用户手动拖到 Applications 并确认替换。旧版 Mac 用户需要先手动安装一次 `0.1.10`。

`0.1.10` 已发布到公开更新源。Windows 已完成 `0.1.9` 到 `0.1.10` 的真机检查、下载和重启安装闭环；当前下载期间缺少持续可见的进度反馈，后续改进见 [Issue #1](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/1)。Mac 已完成安装、启动和托盘入口验证，完整的更新下载流程仍需后续版本配合验证。

项目在公开前已经完成 `0.1.0` 至 `0.1.8` 的内部迭代；经过隐私清洗的版本历史见 [变更日志](CHANGELOG.md)。

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
npm audit --omit=dev
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
