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

提交 Pull Request 前运行：

```bash
npm test
npm run build
npm audit --omit=dev
```

## Pull Request

外部贡献者应先 Fork 本仓库，在自己的分支中完成修改，再提交 Pull Request。仓库维护者可以直接向 `main` 推送；对于需要讨论或分阶段审查的修改，也可以主动使用 Pull Request。

每个 Pull Request 应只处理一个明确问题，并说明：

- 要解决的用户问题和最终行为
- 为行为变化增加的测试
- 相关人工验证步骤
- 用户可见变化对应的 `CHANGELOG.md`“未发布”条目

不要提交生成的安装包、release 目录、用户数据、凭据、本地环境文件或机器专属路径。

## 项目边界

- 除非迁移方案明确处理安装身份和本地数据，否则不要修改 runtime `name: floating-sticky-notes`、`appId: local.lawrence.floating-sticky-notes` 和 `productName: 悬浮便签`。
- Windows 更新必须继续兼容 `%APPDATA%\floating-sticky-notes`。
- 自动更新只在 Windows 打包版本中启用。
- 不要增加 portable Windows 构建目标；自动更新只支持 NSIS Setup 安装路径。
- Windows 原生行为必须经过 Windows 实机或虚拟机验证，不能用 macOS 交叉构建结果代替。

## Commit 信息

使用简短、明确的祈使句，例如：

```text
修复托盘更新状态处理
增加清单键盘操作回归测试
补充 Windows 发布验证说明
```
