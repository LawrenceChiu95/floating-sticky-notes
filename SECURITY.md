# 安全策略

## 支持范围

安全修复会应用到最新发布版本。

## 报告安全漏洞

发现疑似安全漏洞时，请勿提交公开 Issue。请通过本仓库的 GitHub 私密漏洞报告入口提交：

<https://github.com/LawrenceChiu95/floating-sticky-notes/security/advisories/new>

请提供受影响版本、复现步骤、预期影响和可能的缓解方式。在问题得到复现和修复前，请留出合理时间并避免公开披露。

## 更新信任边界

Windows 与 macOS 更新元数据和安装包通过 HTTPS 从公开仓库 [`floating-sticky-notes-updates`](https://github.com/LawrenceChiu95/floating-sticky-notes-updates) 下载，Release 写权限仅限维护者。下载时会校验更新元数据中的 SHA-512 和文件大小，但当前安装包没有代码签名，因此 Windows 可能显示“未知发布者”，macOS 也可能阻止或警告首次打开。
