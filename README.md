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
- 通过公开的 GitHub Release 更新源在 Windows 应用内检查更新

## 项目状态

`0.1.9` 是首个公开源码版本，也是首个具备 Windows 自动更新能力的版本。Windows 安装包仍处于草稿状态，完成 Windows 真机安装和更新验证后才会正式发布。

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
