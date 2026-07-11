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
5. 直接启动生成的打包应用，确认主进程可以加载、便签窗口和托盘可以出现，且没有模块导入或其他仅在打包环境发生的启动错误。只通过 TypeScript、单元测试和打包命令不算完成这项验证。
6. 校验 Windows Setup 和 Mac DMG；在 macOS 上还要运行：

   ```bash
   hdiutil verify "release-mac/StickyNotes-Mac-<version>.dmg"
   ```

7. 在更新仓库创建 Draft Release，上传以下安装资源，但暂不上传两个更新元数据文件：

   ```text
   StickyNotes-Setup-<version>.exe
   StickyNotes-Setup-<version>.exe.blockmap
   StickyNotes-Mac-<version>.dmg
   StickyNotes-Mac-<version>.dmg.blockmap
   ```

8. 在 Windows 上验证安装、启动、托盘和本地数据保留；在 Apple Silicon Mac 上验证 DMG、启动、托盘和本地数据保留。Draft 资源不能通过 `releases/latest/download` 访问，因此这一阶段不能冒充线上更新闭环已经完成。
9. 真机基础验证通过后发布 Draft，并明确将该 Release 标记为 GitHub 的 latest，然后最后上传：

   ```text
   latest.yml
   latest-mac.yml
   ```

   这两个文件是更新开关：上传后，Windows 和 Mac 客户端才会分别发现新版本。
10. 立即用上一正式版本验证线上更新。Windows 使用足够慢的测试下载或限速代理，完成以下检查：
    - 确认下载后立即出现进度窗口，并从不定状态连续切换到百分比。
    - 下载期间便签仍可编辑、创建和关闭；关闭全部便签后托盘与进度仍存活。
    - 进度窗口可拖动、最小化并从任务栏恢复，但不能由用户关闭。
    - 从托盘重复检查只恢复已有进度窗口，不发起第二次下载。
    - 断网只产生一次易懂错误，窗口和任务栏进度均清理，随后可以重新检查。
    - 无便签窗口时下载完成仍先显示“重启并安装 / 稍后”；选择“稍后”不立即退出或安装。
    - 覆盖多显示器和不同 DPI，确认窗口首次出现时位于当前显示器可见范围内。
    - 选择“重启并安装”后完成退出和安装，并确认本地便签与图片保留。
11. Mac 应完成检查、下载、SHA-512 校验、打开 DMG 和退出，并由用户拖入 Applications 完成替换，同时确认本地便签保留。
12. 为对应源码 commit 创建 tag，并发布源码 Release 说明。

禁止上传用户数据、本地 profile、凭据、调试日志，以及上述更新资源以外的生成包。

## 回退处理

基础真机验证完成前始终保持 Draft，更新元数据始终最后上传。线上更新闭环失败时，应立即删除对应元数据或停止该 Release 成为 latest，再发布版本号更高的修复版本。客户端按照语义化版本比较更新，不应通过重新发布旧版本号来回退。
