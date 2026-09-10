# 悬浮便签展示素材

这套素材以 **记下，也要看见** 为主张。先展示工作窗口切换时便签持续置顶，再展示收起与贴边怎样给工作腾出空间。传播目标是让陌生用户快速看懂并愿意尝试；朋友倾向 B 版，尚未做系统的三秒理解测试。

## 传播主张对照稿

[B 版：看见的力量](visibility-direction.md)补充了纸质便利贴与书签的产品灵感，已作为根目录 README 的方向；[B 版预览副本](README-seen.md)与[原 A 版](README-a.md)用于对比。首屏只解释置顶，不让半露的书签承担辅助功能说明。

## 给朋友看的分享页

公开地址：<https://lawrence-sticky-notes-review.gzf8cmm4hd.chatgpt.site>。提供中性 A/B 对比、两版完整介绍和修正后的演示视频；没有 Lead 推荐结论或投票表单。产品 GitHub 页面更新仍按选版流程单独决定。

国内网络已出现访问失败，旧地址暂不能视为可靠的国内分享入口。改用 WorkBuddy 临时分享地址：<https://96ea5807e0c74a7fb2a93adc71066d19.app.workbuddy.link/>。静态成品位于 `release/workbuddy-deploy/site/`；平台未返回确切有效期，验证与后续状态见项目交接。

## 直接使用

- [整套素材预览](../../assets/showcase/source/gallery.html)
- [README 首屏](../../assets/showcase/seen/hero.png)
- [持续置顶动图](../../assets/showcase/github/visibility.gif) / [清晰版 MP4](../../assets/showcase/video/visibility.mp4)
- [三种形态](../../assets/showcase/github/states.png)
- [待办与参考图](../../assets/showcase/github/features.png)
- [README 动图](../../assets/showcase/github/edge-dock.gif) / [清晰版 MP4](../../assets/showcase/video/edge-dock.mp4)
- [B 版小红书图组目录](../../assets/showcase/xhs-b/) / [配套标题和正文](xiaohongshu.md)

README 已引用相应素材。更新页面时，README 和 `assets/showcase/` 要一起提交。小红书 B 版按 `xhs-b/` 的 01 → 06 使用，原 A 版保留在 `xhs/`。Star 邀请放在 README 的产品介绍之后，免费与 MIT 说明放在下载区；软件内赞赏和作者说明另行处理。

## 画面来源

便签像素来自本项目 **0.1.21 未修改的生产 renderer**：先执行 `npm run build`，再在 Chromium 中加载构建结果，以内存 fixture 替代 IPC 数据，按 2 倍像素密度截图。文字、勾选框、工具栏、颜色、图片区域、收起横条和书签头均由真实产品界面绘制。

- [界面截图](../../assets/showcase/ui/) / [截图记录](../../assets/showcase/ui/capture-evidence.json)
- [演示内容](../../assets/showcase/source/fixtures.json)：全部为虚构记录，未读取私人便签、工作文档或系统桌面。
- 参考图 `ui/art.svg` 是本次用 SVG 绘制的原创演示图。
- 产品图标来自仓库 `assets/icons/app-icon.png`。
- 海报中的桌面背景、工作文档背景与窗口位置为排版布景。收起和横条贴边动效使用真实 renderer 的 CSS/WAAPI 连续帧，保留产品缓动、标题与工具栏移动；拖动路线为演示编排，**不是原生操作录屏，也不构成 Windows 真机验证**。
- 界面尺寸和文字可整体放大，未重画或替换产品控件。画面里的安装平台以 Windows x64 与 Apple Silicon Mac 为准。

不将「始终置顶」说成所有系统级窗口或全屏空间之上；不将书签悬停说成全文展开；不宣称提醒、云同步、快捷键呼出或点击穿透。免费开源、无需账号、本地保存来自当前产品实际边界，不代表其他工具没有这些能力。

## 再生成

需要能从 Node.js 加载 Playwright 和 sharp。也可将它们安装到独立工具目录，通过 `SHOWCASE_NODE_MODULES` 指定该目录下的 `node_modules`，无需修改应用依赖；默认浏览器可用 `npx playwright install chromium` 准备。

在仓库根目录执行：

```bash
npm run build
node assets/showcase/source/capture-ui.cjs
node assets/showcase/source/capture-motion.cjs
node assets/showcase/source/render.mjs
```

截图工具使用 Playwright 与 sharp，不向应用安装新依赖。`capture-ui.cjs` 的 `SHOWCASE_NODE_MODULES` 可指向已安装这两个包的目录，`SHOWCASE_CHROME` 可指定 Chromium/Chrome 可执行文件；未设置时从常规 Node.js 模块路径加载依赖，并使用 Playwright 管理的 Chromium。排版与动效源文件在 [source](../../assets/showcase/source/) 中。

动态素材使用 HyperFrames 0.7.68；本次调用的是本机已有的 CLI 缓存。以下命令可重现相同版本的导出，渲染项目根必须是 `source/motion`：

```bash
npx --yes hyperframes@0.7.68 lint assets/showcase/source/motion
npx --yes hyperframes@0.7.68 validate assets/showcase/source/motion
npx --yes hyperframes@0.7.68 inspect assets/showcase/source/motion
npx --yes hyperframes@0.7.68 render assets/showcase/source/motion --fps 60 --quality high --workers 2 --strict -o assets/showcase/video/edge-dock.mp4
ffmpeg -y -i assets/showcase/video/edge-dock.mp4 -filter_complex '[0:v]fps=30,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' -loop 0 assets/showcase/github/edge-dock.gif
```

`capture-ui.cjs` 同步静态截图；`capture-motion.cjs` 通过虚构 IPC 和暂停/逐帧推进动画，生成两组各 19 帧的真实界面连续帧及几何记录。视频为 60fps，GIF 为 30fps。版式使用 macOS 的苹方字体；在其他系统重现时需选择可用中文字体，并重新检查排版。

动效所附 GSAP 为制作工具，遵循文件内注明的上游许可，不进入桌面应用安装包。应用自身依赖、功能和版本未变。

本轮事项与发布状态统一记录在 [Issue #30](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/30)，不在本文件另建任务状态表。
