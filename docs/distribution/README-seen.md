# 悬浮便签

**记下，也要看见。**

一张始终置顶的桌面便利贴，让要记的事留在眼前。

![悬浮便签：文档和网页在下面，便签始终留在工作视线里](../../assets/showcase/seen/hero.png)

<p align="center">
  <a href="https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/download/v0.1.21/StickyNotes-Setup-0.1.21.exe"><strong>下载 Windows 版</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/download/v0.1.21/StickyNotes-Mac-0.1.21.dmg"><strong>下载 Mac 版</strong></a>
  &nbsp; · &nbsp;
  <a href="https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest">所有安装包</a>
</p>

## 这是「看见」的力量

便利贴贴在眼前，书签露在书页外。每次看见，都是一次重新想起的机会。

悬浮便签把这个习惯带到电脑上：它持续显示在普通工作窗口上方。切换文档、打开网页时，刚才记下的事仍然看得见。

![文档和网页切换时，同一张便签始终留在它们上方的界面演示](../../assets/showcase/github/visibility.gif)

[查看清晰版演示](../../assets/showcase/video/visibility.mp4)

## 留在眼前，也懂得让开

需要给工作腾出地方，点一下收成标题横条，再拖到屏幕边上，留下一枚小书签。

**鼠标移上去，书签探出来；拖回桌面，完整便签展开。**

![便签收起、贴到屏幕边缘、再拖回桌面展开的界面演示](../../assets/showcase/github/edge-dock.gif)

[查看清晰版短视频](../../assets/showcase/video/edge-dock.mp4)

## 让你想记住的，留在眼前

![真实便签里的待办、子任务和参考图](../../assets/showcase/github/features.png)

- **想做的事。** 写成待办，拆一层子任务，边做边勾。
- **忽然的灵感。** 随手记两句，给每张便签命名，选喜欢的颜色与透明度。
- **正在参考的图。** 粘贴截图或拖入图片，点击打开独立预览，支持缩放、移动和多图切换。

无需账号，也没有云同步或遥测。便签和图片只保存在当前电脑，重新打开会恢复内容与窗口位置。

<sub>便签画面取自 0.1.21 的真实应用界面，使用虚构内容；工作窗口与动效为示意布景，非原生操作录屏。</sub>

## 下载与安装

当前版本免费下载，源码采用 [MIT 许可证](../../LICENSE) 开放。

当前版本：**[0.1.21](https://github.com/LawrenceChiu95/floating-sticky-notes/releases/tag/v0.1.21)** · [更新记录](../../CHANGELOG.md)

| 你的电脑 | 安装包 | 首次安装 |
| --- | --- | --- |
| Windows x64 | [下载 Setup](https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/download/v0.1.21/StickyNotes-Setup-0.1.21.exe) | 运行安装程序；安装包未签名，系统可能提示未知发布者 |
| Mac · Apple Silicon | [下载 DMG](https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/download/v0.1.21/StickyNotes-Mac-0.1.21.dmg) | 打开后拖入 Applications；首次运行可能需在「系统设置 → 隐私与安全性」选择「仍要打开」 |

Windows 支持应用内检查、下载和重启安装更新；Mac 会下载并校验 DMG，再由你手动替换应用。Mac 构建使用完整 ad-hoc 签名，尚未使用 Apple Developer ID 或经过公证。

遇到问题，可以[提交反馈](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/new/choose)。Windows 贴边拖出偶发不展开的问题已在本版修复相关逻辑，仍在收集[实际使用反馈](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/27)。

<details>
<summary><strong>便签存在哪里？更新后还在吗？</strong></summary>

便签和导入的图片保存在本机：

- Windows：`%APPDATA%\floating-sticky-notes`
- macOS：`~/Library/Application Support/floating-sticky-notes`

安装更新不会删除这个目录。卸载应用时也会保留本地便签，除非用户手动删除。

托盘可以新建或恢复便签、设置开机启动、检查更新和退出应用。

</details>

<details>
<summary><strong>从源码运行与构建</strong></summary>

环境要求：Node.js 22 / npm 10。

```bash
npm ci
npm run dev
```

开发模式使用独立的 `floating-sticky-notes-dev` 数据目录，不影响同机正式版数据，两边可以同时运行。

```bash
npm test
npm run build
npx --yes npm@11 audit
```

项目使用 npm 10 安装依赖、npm 11 执行安全审计。修改依赖或 `overrides` 时，参见[贡献指南中的依赖维护流程](../../CONTRIBUTING.md#依赖维护)。当前依赖审计事项见 [Issue #23](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/23)。

```bash
npm run dist:win  # Windows x64 NSIS Setup
npm run dist:mac  # Apple Silicon Mac DMG，ad-hoc 签名
```

Windows 只维护 Setup 安装包，不提供 portable 便携包。架构和发布流程见 [架构说明](../../docs/architecture.md)与[发布指南](../../docs/releasing.md)。

更新资源存放在 [floating-sticky-notes-updates](https://github.com/LawrenceChiu95/floating-sticky-notes-updates)；源码、Issue 和变更记录在本仓库维护。

</details>

## 喜欢这张便签？

如果它也帮你把重要的事留在眼前，欢迎点一下右上角的 **Star ⭐**，给这份小作品一点支持。

由 [Lawrence](https://github.com/LawrenceChiu95) 制作。欢迎告诉我，你把什么留在了眼前。

欢迎提交 Bug、建议和 Pull Request。[贡献指南](../../CONTRIBUTING.md) · [安全问题反馈](../../SECURITY.md) · [产品展示素材](../../docs/distribution/README.md)

本项目采用 MIT 许可证：[原文](../../LICENSE) · [中文参考译文](../../LICENSE.zh-CN.md)。
