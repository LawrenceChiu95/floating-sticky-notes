# 变更日志

本文件记录项目的重要变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- 建立公开仓库、贡献指南、Issue 模板和持续集成检查。

### 变更

- 将公开文档和 GitHub 协作界面统一为中文。

## [0.1.9] - 2026-07-11

### 新增

- 支持创建多张始终置顶并保存在本地的便签。
- 支持纯文本、可编辑待办清单、便签颜色和透明度。
- 支持粘贴剪贴板图片与系统截图、拖入图片和删除图片。
- 托盘菜单支持新建便签、开机启动、检查更新和退出。
- Windows 打包版通过 `electron-updater` 和 GitHub 通用更新源检查更新。
- 兼容既有本地 profile，但源码和公开安装包不包含任何 profile 数据。
- 提供 Windows x64 NSIS Setup 和未签名 Apple Silicon macOS 构建命令。

### 变更

- Windows 发行方式收敛为一个中性 Setup 安装包，不再构建 portable。
- 长内容在便签内部滚动，工具栏保持可操作。

### 修复

- 退出应用或重启安装更新前，会先保存尚未落盘的便签数据。
- 删除图片后恢复原有编辑焦点，不再调用原生模态确认框。
- 恢复窗口时会把位置和尺寸限制在可用显示器范围内。

[未发布]: https://github.com/LawrenceChiu95/floating-sticky-notes/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/LawrenceChiu95/floating-sticky-notes/releases/tag/v0.1.9
