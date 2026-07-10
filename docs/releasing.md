# 发布流程

源码与安装包资源使用两个公开仓库：

- 源码、Issue 和变更日志：`LawrenceChiu95/floating-sticky-notes`
- Windows 更新资源：`LawrenceChiu95/floating-sticky-notes-updates`

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
   ```

4. 检查打包后的 asar，确认 runtime 包名、版本、更新源和资源符合预期。
5. 在更新仓库创建 Draft Release，只上传：

   ```text
   latest.yml
   StickyNotes-Setup-<version>.exe
   StickyNotes-Setup-<version>.exe.blockmap
   ```

6. 在 Windows 上验证安装、启动、托盘、本地数据保留、更新检查、下载和重启安装。
7. 真机验证通过后再发布 Draft。发布后，已安装客户端才能访问 `releases/latest/download/latest.yml`。
8. 为对应源码 commit 创建 tag，并发布源码 Release 说明。

禁止上传用户数据、本地 profile、凭据、调试日志，以及上述三项更新资源以外的生成包。

## 回退处理

验证完成前始终保持 Draft。已经发布的版本如果需要撤回，应先停止让它成为 latest，再发布版本号更高的修复版本。客户端按照语义化版本比较更新，不应通过重新发布旧版本号来回退。
