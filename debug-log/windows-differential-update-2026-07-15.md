# Windows 差分更新诊断与验证

## 结论

`0.1.13` 已将 Windows 更新从 `generic + releases/latest/download` 切换为同一公开更新仓库的 GitHub provider。2026-07-15 的 Windows 真机 RC 验证证明，新实现能按版本读取旧、新 blockmap，并只下载发生变化的安装包区块。

## 原故障现象

`0.1.12` 及更早的 Windows 客户端使用以下滑动别名作为 generic feed：

```text
https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/latest/download
```

更新到 `0.1.12` 时，新 blockmap 可以通过 `latest/download` 找到，但旧 blockmap 也被错误组合到同一 latest Release 目录：

```text
.../releases/download/v0.1.12/StickyNotes-Setup-0.1.11.exe.blockmap
```

该资源实际位于 `v0.1.11` Release，因此返回 404。`electron-updater` 随后回退为完整下载，所以更新仍能完成，但差分带宽优势失效。

## 根因

generic provider 把新、旧 blockmap 当作同一目录下的资源；GitHub 的 `releases/latest/download` 只能指向当前 latest Release，无法同时表示旧版本 Release 目录。这是 URL 语义冲突，不是用户网络失败。

`previousBlockmapBaseUrlOverride` 不能在同一 GitHub host 上把绝对 pathname 改到另一 Release 目录，因此不是可行修复。关闭差分下载只能消除 404，但会让每次更新都下载完整安装包，也不符合目标。

## 修复

- Windows 构建改用 `electron-builder` GitHub provider，固定 owner `LawrenceChiu95` 和 repo `floating-sticky-notes-updates`。
- 正式版使用 `latest` 通道，预发布版根据 SemVer 预发布标识自动选择通道，例如 `0.1.13-rc.2` 使用 `rc`。
- GitHub provider 按 tag 读取安装包和 blockmap，使旧、新资源分别落在对应的 `releases/download/v<version>/` 目录。
- 禁用 GitHub 不支持的多段 Range 请求，保留单段 Range 差分下载。
- Windows 依然使用同一公开更新仓库，未改变 NSIS Setup、安装身份或 `%APPDATA%\floating-sticky-notes` 数据路径。

## Windows 真机证据

2026-07-15 安装 `0.1.13-rc.1` 后，通过应用内更新到 `0.1.13-rc.2`：

```text
Download block maps (old: ".../releases/download/v0.1.13-rc.1/StickyNotes-Setup-0.1.13-rc.1.exe.blockmap", new: .../releases/download/v0.1.13-rc.2/StickyNotes-Setup-0.1.13-rc.2.exe.blockmap)
Full: 98,946.83 KB, To download: 875.32 KB (1%)
Differential download: .../releases/download/v0.1.13-rc.2/StickyNotes-Setup-0.1.13-rc.2.exe
New version 0.1.13-rc.2 has been downloaded
```

日志同时确认：

- 旧、新 blockmap 分别来自各自版本 Release。
- 只请求变化区块，实际下载约为完整包的 `1%`。
- 无 blockmap 404、无多段 Range 501、无 fallback 到完整下载。
- 下载后成功触发 NSIS 安装。

## 发布状态与后续闸门

- `0.1.13` 源码 Release：<https://github.com/LawrenceChiu95/floating-sticky-notes/releases/tag/v0.1.13>
- `0.1.13` 更新资源 Release：<https://github.com/LawrenceChiu95/floating-sticky-notes-updates/releases/tag/v0.1.13>
- `0.1.12` 及更早客户端到 `0.1.13` 的第一跳仍由旧客户端逻辑驱动，可能 404 后回退完整下载。这不能作为新 provider 的差分验收。
