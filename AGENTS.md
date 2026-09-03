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
- 引用 Issue 或 PR 时一律给可点击超链接（`https://github.com/LawrenceChiu95/floating-sticky-notes/issues/<编号>`），回执、评论、PR 描述、`HANDOFF.md` 等任何场景都不准只写编号。
- 便签窗口拖动必须走原生 `-webkit-app-region: drag`。不要用 renderer 指针 + IPC 移窗，也不要用主进程轮询光标跟手；这两种在 Mac 真机上都已被否。

## GitHub 身份

- 本项目是个人仓库 [`LawrenceChiu95/floating-sticky-notes`](https://github.com/LawrenceChiu95/floating-sticky-notes)。创建或编辑 Issue、评论、PR、Release、标签等所有 GitHub 写操作，必须使用仓库所有者账号 `LawrenceChiu95`，不得使用其他 GitHub 身份。
- 每个会话第一次执行 GitHub 写操作前，必须用 `gh api user --jq .login` 核对当前活动身份；不能只根据 remote URL 或仓库 owner 推断。
- 若活动身份不是 `LawrenceChiu95`，停止写操作并先执行 `gh auth switch --hostname github.com --user LawrenceChiu95`，再次核对成功后才能继续。本机 `~/.gitconfig` 把 `https://github.com/` 改写成 SSH，默认 SSH 会落到公司号；个人仓库 push 必须绕开 insteadOf，用 `LawrenceChiu95` token 的 `x-access-token` HTTPS URL，且不要把 token URL 写进 branch upstream。

## 不可随意改变的边界

- 除非已有获批迁移方案处理安装身份和 userData 后果，否则保持 runtime `name: floating-sticky-notes`、`appId: local.lawrence.floating-sticky-notes` 和 `productName: 悬浮便签`。
- 保持 `%APPDATA%\floating-sticky-notes` 数据兼容；开发模式必须使用独立 userData 目录 `<appData>/floating-sticky-notes-dev`（`main/app-lifecycle.ts` 的 `getDevUserDataPath`），正式版路径与身份不变，dev 里的删除不得影响正式数据。开发进程不得自动应用全局开机启动默认值，避免独立 dev 目录重新启用或改写系统登录项；托盘中的显式开关仍可用于人工调试。
- Windows 自动更新继续使用现有公开更新仓库，但改用 GitHub provider 读取按版本归档的 Release 资源和 blockmap。
- macOS 半自动更新继续使用同一更新源的 `latest-mac.yml`，只下载并校验 DMG，不要在未签名条件下改成 `quitAndInstall`。
- 在没有 Apple Developer ID 的阶段，Mac 构建必须继续对完整 app bundle 使用 ad-hoc 签名，并让 `codesign --verify --deep --strict` 成为打包后置条件；未经公证的构建仍需用户在“系统设置 → 隐私与安全性”中手动放行，不能描述为已通过 Gatekeeper。
- 不要增加 portable Windows 构建目标。
- 不要重新加入 `win.signAndEditExecutable: false`，否则 Windows exe 无法写入图标资源。
- 开机启动是全局设置，应保留在托盘菜单中，不要放进每张便签的外观面板。
- Windows 原生问题应先判断进程、文件锁、注册表、快捷方式、资源、系统策略或 Shell 缓存中哪一层失败，再修改代码。
- 不要把 macOS 交叉构建结果描述成 Windows 真机验证。
- 三个启用 `sandbox: true` 的 preload 必须继续构建为 CommonJS，并使用 `.cjs` 路径加载；修改 Electron 或 electron-vite 构建配置后必须检查打包产物，不能只看源码测试。

- Node.js 22 / npm 10 仍是开发与 CI 安装边界；`npm ci` 可直接消费仓库 lockfile。若修改依赖或 overrides，需要用 `npx --yes npm@11 install --package-lock-only` 重新生成 lockfile，再在干净临时目录用 npm 10 执行 `npm ci`，并分别运行 npm 10 的 `npm audit` 与 npm 11 的 `npx --yes npm@11 audit`。

## 验证要求

push 前运行：

```bash
npm test
npm run build
npm audit
git diff --check
```

发布 Windows 版本前还要运行 `npm run dist:win`、检查打包后的 asar、直接启动打包应用，并完成 `docs/releasing.md` 中的 Windows 真机流程。发布 Mac 版本前还要运行 `npm run dist:mac`、直接启动生成的 `.app`、执行 `hdiutil verify`，并完成 Apple Silicon Mac 真机流程。打包命令成功不能替代打包应用启动验证。
