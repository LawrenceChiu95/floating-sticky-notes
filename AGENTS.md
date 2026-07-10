# 项目开发规则

## 开工前阅读

- `README.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `docs/architecture.md`
- `docs/releasing.md`

## 不可随意改变的边界

- 除非已有获批迁移方案处理安装身份和 userData 后果，否则保持 runtime `name: floating-sticky-notes`、`appId: local.lawrence.floating-sticky-notes` 和 `productName: 悬浮便签`。
- 保持 `%APPDATA%\floating-sticky-notes` 数据兼容。
- Windows 自动更新继续使用现有公开通用更新源。
- macOS 半自动更新继续使用同一更新源的 `latest-mac.yml`，只下载并校验 DMG，不要在未签名条件下改成 `quitAndInstall`。
- 不要增加 portable Windows 构建目标。
- 不要重新加入 `win.signAndEditExecutable: false`，否则 Windows exe 无法写入图标资源。
- 开机启动是全局设置，应保留在托盘菜单中，不要放进每张便签的外观面板。
- Windows 原生问题应先判断进程、文件锁、注册表、快捷方式、资源、系统策略或 Shell 缓存中哪一层失败，再修改代码。
- 不要把 macOS 交叉构建结果描述成 Windows 真机验证。

## 验证要求

push 前运行：

```bash
npm test
npm run build
npm audit --omit=dev
git diff --check
```

发布 Windows 版本前还要运行 `npm run dist:win`、检查打包后的 asar，并完成 `docs/releasing.md` 中的 Windows 真机流程。发布 Mac 版本前还要运行 `npm run dist:mac`、执行 `hdiutil verify`，并完成 Apple Silicon Mac 真机流程。
