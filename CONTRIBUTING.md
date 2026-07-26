# 贡献指南

感谢你参与改进悬浮便签。

## 开始之前

- 新建 Issue 前先搜索是否已有相同问题。
- 小型修复可以直接提交 Pull Request，不要求先建 Issue。
- 大型功能、数据格式变化、安装器变化或更新系统变化，应先建 Issue 对齐方向。
- 安全漏洞不要提交公开 Issue，请按照 [安全策略](SECURITY.md) 私下报告。

## 开发环境

使用 Node.js 22 和 npm 10：

```bash
npm ci
npm run dev
```

开发模式使用独立的 userData 目录（`<appData>/floating-sticky-notes-dev`），与正式版数据完全隔离；开发窗口里看不到、也碰不到正式数据，两边可以同时运行。

提交 Pull Request 前运行：

```bash
npm test
npm run build
npx --yes npm@11 audit
```

## 依赖维护

项目继续使用 Node.js 22 和 npm 10 安装依赖，但安全审计使用 npm 11，避免 npm 10 的旧审计端点退役后造成无关失败。修改依赖或 `overrides` 时：

```bash
npx --yes npm@11 install --package-lock-only
npm audit
npx --yes npm@11 audit
```

随后把 `package.json`、`package-lock.json` 和本地 `vendor/` 依赖复制到一个干净临时目录，用 npm 10 执行 `npm ci`，确认仓库 lockfile 仍可被项目声明的安装环境重现。不要使用 `npm audit fix --force` 绕过兼容性评估。

当前 `vendor/brace-expansion-compat` 是开发 / 打包链的 CJS 兼容层：旧版 `minimatch` 需要 callable 或 default export，安全版 `brace-expansion@5.0.8` 只提供 named export。修改或移除该兼容层前，必须运行 `tests/brace-expansion-compat.test.ts`，确认 `minimatch` 3 / 5 / 9 / 10 的花括号 glob 和安全上限仍然成立。

## Pull Request

外部贡献者应先 Fork 本仓库，在自己的分支中完成修改，再提交 Pull Request。仓库维护者可以直接向 `main` 推送；对于需要讨论或分阶段审查的修改，也可以主动使用 Pull Request。

每个 Pull Request 应只处理一个明确问题，并说明：

- 要解决的用户问题和最终行为
- 为行为变化增加的测试
- 相关人工验证步骤
- 相对上一正式版本的用户可见变化，以及对应的 `CHANGELOG.md`“未发布”条目（若有）

`CHANGELOG.md` 面向从上一正式版本升级的用户，只记录最终发布包中用户能获得或直接感知的新增、改善和修复。不要把未进入正式版本的开发回归、临时错误、内部重构或测试补强直接写进更新说明；这类细节应留在 commit、Issue、设计文档或 `debug-log/` 中。

不要提交生成的安装包、release 目录、用户数据、凭据、本地环境文件或机器专属路径。

## 项目边界

- 除非迁移方案明确处理安装身份和本地数据，否则不要修改 runtime `name: floating-sticky-notes`、`appId: local.lawrence.floating-sticky-notes` 和 `productName: 悬浮便签`。
- Windows 更新必须继续兼容 `%APPDATA%\floating-sticky-notes`。
- Windows 打包版使用自动安装更新；macOS 打包版只自动检查、下载并校验 DMG，安装替换仍由用户完成。
- 不要增加 portable Windows 构建目标；自动更新只支持 NSIS Setup 安装路径。
- Windows 原生行为必须经过 Windows 实机或虚拟机验证，不能用 macOS 交叉构建结果代替。

## Commit 信息

使用简短、明确的祈使句，例如：

```text
修复托盘更新状态处理
增加清单键盘操作回归测试
补充 Windows 发布验证说明
```
