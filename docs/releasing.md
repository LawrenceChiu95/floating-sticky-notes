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
   npm audit
   npm run dist:win
   npm run dist:mac
   ```

4. 检查打包后的 asar，确认 runtime 包名、版本、更新源和资源符合预期；三个 preload 应为 `preload.cjs`、`updateProgressPreload.cjs` 和 `releaseFeedbackPreload.cjs`，renderer 应包含 `release-feedback.html`，主进程不得引用 preload `.mjs`。
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

   Windows 构建使用 GitHub provider，构建配置固定指向 `LawrenceChiu95/floating-sticky-notes-updates`，不再使用 `releases/latest/download` 作为 Windows feed。正式版本必须保留每个 Windows Setup 的 `.exe.blockmap`；删除旧 blockmap 会让后续差分更新回退为完整下载。

8. 在 Windows 上验证安装、启动、托盘和本地数据保留；在 Apple Silicon Mac 上验证 DMG、启动、托盘和本地数据保留。Draft 资源不能通过 `releases/latest/download` 访问，因此这一阶段不能冒充线上更新闭环已经完成。
9. 真机基础验证通过后发布 Draft，并明确将该 Release 标记为 GitHub 的 latest，然后最后上传：

   ```text
   latest.yml
   latest-mac.yml
   ```

   这两个文件是更新开关：上传后，Windows 和 Mac 客户端才会分别发现新版本。

   在正式版本前验证 Windows provider 时，使用两个连续的预发布版本（例如 `0.1.13-rc.1` -> `0.1.13-rc.2`）：直接运行标准 Windows 构建命令，脚本会根据版本号自动生成 `rc.yml`；上传它到对应预发布 Release，并确认旧、新 blockmap 都来自各自的 `releases/download/v<version>/` 目录。RC 验证通过后把版本号改为正式版本，脚本会自动生成 `latest.yml`。
10. 立即用上一正式版本验证线上更新。Windows 使用足够慢的测试下载或限速代理，完成以下检查：
    - 确认下载后立即出现进度窗口，并从不定状态连续切换到百分比。
    - 下载期间便签仍可编辑、创建和关闭；关闭全部便签后托盘与进度仍存活。
    - 关闭全部便签后再次启动应用，确认没有第二个托盘进程，并能恢复原有便签；托盘“显示所有便签”也应恢复窗口且不创建重复便签。
    - 进度窗口可拖动、最小化并从任务栏恢复，但不能由用户关闭。
    - 从托盘重复检查只恢复已有进度窗口，不发起第二次下载。
    - 断网只产生一次易懂错误，窗口和任务栏进度均清理，随后可以重新检查。
    - 无便签窗口时下载完成仍先显示“重启并安装 / 稍后”；选择“稍后”不立即退出或安装。
    - 覆盖多显示器和 100%/125%/150% DPI，确认窗口首次出现时位于当前显示器可见范围内，状态、进度条、百分比和提示文字均不被标题栏裁切。
    - 为便签命名后，确认名称持久化并出现在任务栏和 Alt-Tab；空名称回退为“悬浮便签”。确认非空名称常驻显示，悬停名称时出现弱底色，空名称只在中央热区悬停时显示“双击命名”；同时检查普通双击编辑、Enter、失焦、Esc、保存失败保留草稿、窄窗口截断和窗口拖动。
    - 选择“重启并安装”后完成退出和安装，并确认本地便签与图片保留。

    对首次切换到 GitHub provider 的版本，上一正式版升级时允许出现一次旧客户端的 blockmap 404 和完整下载；这不代表新 provider 失效。真正的差分验收应使用已安装的切换后版本升级到下一个版本，并确认没有 blockmap 404、没有多段 Range 501，也没有 fallback 到完整下载。
11. Mac 应完成检查、下载、SHA-512 校验、打开 DMG 和退出，并由用户拖入 Applications 完成替换，同时确认本地便签保留；还要确认非空名称常驻显示，悬停名称时出现弱底色，空名称只在中央热区悬停时显示“双击命名”，并验证普通单指双击进入命名而不触发系统标题栏缩放，以及 Enter、失焦、Esc、保存失败保留草稿、窄窗口截断和窗口拖动。
12. 为对应源码 commit 创建 tag，并发布源码 Release 说明。

禁止上传用户数据、本地 profile、凭据、调试日志，以及上述更新资源以外的生成包。

## 回退处理

基础真机验证完成前始终保持 Draft，更新元数据始终最后上传。线上更新闭环失败时，应立即删除对应元数据或停止该 Release 成为 latest，再发布版本号更高的修复版本。客户端按照语义化版本比较更新，不应通过重新发布旧版本号来回退。
