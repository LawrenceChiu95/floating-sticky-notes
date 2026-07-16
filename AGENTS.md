# 项目开发规则

## 开工前阅读

- `HANDOFF.md`（若本地存在）
- `README.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `docs/architecture.md`
- `docs/releasing.md`
- 涉及需求、Bug、用户反馈、实现、验证、版本或发布时，另读 `docs/project-management.md`

## 对话式项目管理

- 用户只需在聊天中描述反馈、灵感、决定、进展和验证结果；AI 负责搜索重复项、分类、维护 GitHub Issue，并同步 `HANDOFF.md`。
- 涉及项目事项时，开工前检查相关 GitHub Issue 与 `HANDOFF.md`；收尾前检查状态、证据、版本归属和下一步是否已同步。
- 默认静默维护，完成后只给一行回执。只有产品取舍、信息无法可靠推断、公开敏感内容、发布或不可逆操作需要询问用户。
- 实现、自动验证、产物验证、目标环境验证、发布和监测必须分开记录，不得互相推导；细则以 `docs/project-management.md` 为准。

## 不可随意改变的边界

- 除非已有获批迁移方案处理安装身份和 userData 后果，否则保持 runtime `name: floating-sticky-notes`、`appId: local.lawrence.floating-sticky-notes` 和 `productName: 悬浮便签`。
- 保持 `%APPDATA%\floating-sticky-notes` 数据兼容。
- Windows 自动更新继续使用现有公开更新仓库，但改用 GitHub provider 读取按版本归档的 Release 资源和 blockmap。
- macOS 半自动更新继续使用同一更新源的 `latest-mac.yml`，只下载并校验 DMG，不要在未签名条件下改成 `quitAndInstall`。
- 在没有 Apple Developer ID 的阶段，Mac 构建必须继续对完整 app bundle 使用 ad-hoc 签名，并让 `codesign --verify --deep --strict` 成为打包后置条件；未经公证的构建仍需用户在“系统设置 → 隐私与安全性”中手动放行，不能描述为已通过 Gatekeeper。
- 不要增加 portable Windows 构建目标。
- 不要重新加入 `win.signAndEditExecutable: false`，否则 Windows exe 无法写入图标资源。
- 开机启动是全局设置，应保留在托盘菜单中，不要放进每张便签的外观面板。
- Windows 原生问题应先判断进程、文件锁、注册表、快捷方式、资源、系统策略或 Shell 缓存中哪一层失败，再修改代码。
- 不要把 macOS 交叉构建结果描述成 Windows 真机验证。
- 三个启用 `sandbox: true` 的 preload 必须继续构建为 CommonJS，并使用 `.cjs` 路径加载；修改 Electron 或 electron-vite 构建配置后必须检查打包产物，不能只看源码测试。

## 验证要求

push 前运行：

```bash
npm test
npm run build
npm audit
git diff --check
```

发布 Windows 版本前还要运行 `npm run dist:win`、检查打包后的 asar、直接启动打包应用，并完成 `docs/releasing.md` 中的 Windows 真机流程。发布 Mac 版本前还要运行 `npm run dist:mac`、直接启动生成的 `.app`、执行 `hdiutil verify`，并完成 Apple Silicon Mac 真机流程。打包命令成功不能替代打包应用启动验证。
