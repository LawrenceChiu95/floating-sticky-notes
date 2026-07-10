# 发布流程

源码与安装包资源使用两个公开仓库：

- 源码、Issue 和变更日志：`LawrenceChiu95/floating-sticky-notes`
- Windows 与 macOS 更新资源：`LawrenceChiu95/floating-sticky-notes-updates`

## 准备版本

1. 将 `package.json` 和 `package-lock.json` 更新为相同的语义化版本号。
2. 把 `CHANGELOG.md`“未发布”部分中已经完成的条目移到对应版本和发布日期下。
3. 运行：

   ```bash
   npm ci
   npm test
   npm run build
   npm audit --omit=dev
   npm run dist:win
   npm run dist:mac
   ```

4. 检查打包后的 asar，确认 runtime 包名、版本、更新源和资源符合预期。
5. 校验 Windows Setup 和 Mac DMG；在 macOS 上还要运行：

   ```bash
   hdiutil verify "release-mac/StickyNotes-Mac-<version>.dmg"
   ```

6. 在更新仓库创建 Draft Release，上传以下安装资源，但暂不上传两个更新元数据文件：

   ```text
   StickyNotes-Setup-<version>.exe
   StickyNotes-Setup-<version>.exe.blockmap
   StickyNotes-Mac-<version>.dmg
   StickyNotes-Mac-<version>.dmg.blockmap
   ```

7. 在 Windows 上验证安装、启动、托盘和本地数据保留；在 Apple Silicon Mac 上验证 DMG、启动、托盘和本地数据保留。Draft 资源不能通过 `releases/latest/download` 访问，因此这一阶段不能冒充线上更新闭环已经完成。
8. 真机基础验证通过后发布 Draft，并明确将该 Release 标记为 GitHub 的 latest，然后最后上传：

   ```text
   latest.yml
   latest-mac.yml
   ```

   这两个文件是更新开关：上传后，Windows 和 Mac 客户端才会分别发现新版本。
9. 立即用上一正式版本验证线上更新。Windows 应完成检查、下载、退出和安装；Mac 应完成检查、下载、SHA-512 校验、打开 DMG 和退出，并由用户拖入 Applications 完成替换。两端都要确认本地便签保留。
10. 为对应源码 commit 创建 tag，并发布源码 Release 说明。

禁止上传用户数据、本地 profile、凭据、调试日志，以及上述更新资源以外的生成包。

## 回退处理

基础真机验证完成前始终保持 Draft，更新元数据始终最后上传。线上更新闭环失败时，应立即删除对应元数据或停止该 Release 成为 latest，再发布版本号更高的修复版本。客户端按照语义化版本比较更新，不应通过重新发布旧版本号来回退。
