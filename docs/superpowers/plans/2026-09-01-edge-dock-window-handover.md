# 贴边吸附窗口交接实施计划（2026-09-01）

> 决策背景：落定闪烁根因 = Electron 可见时刻改透明窗尺寸的结构性缺陷（见 docs/design/edge-dock.md 2026-09-01 定案与 Issue #24 评论）。本计划用「窗口交接」取代 union→96×32 裁窗。不变量：**窗口可见时尺寸恒定**。
> 验收纪律：逐项实施、逐项真机验收（用户亲手拖 + 静默录屏），禁止合成输入；静态测试不算验收证据。

## 总体形态

- 便签主窗：expanded/collapsed 时可见；docked 时 hide 保活。
- 书签头窗（新）：每便签一枚，96×32（共边 48×32）恒尺寸，`?view=tab&note=<id>` 只渲染书签头壳；首次吸附预览时惰性创建 + 预渲染。
- controller（note-window-collapse）持有「活动窗口句柄」：docked 时指向书签头窗，其余指向主窗；peek 滑行/钉回/settle watch 对句柄透明。

## 阶段 1：书签头窗骨架（无用户可见变化）

1. `main/` 新增 tab window 管理：createTabWindow(noteId, {side, width}) → show:false、transparent、frameless、hasShadow:false、alwaysOnTop 同级、skipTaskbar 同主窗；加载 renderer `?view=tab&note=<id>&dock=<side>`；`getTabWindow(noteId)` / `destroyTabWindow(noteId)`；便签关闭时联动销毁。
2. renderer：`view=tab` 分支渲染 TabApp——只挂 DockedNoteShell（环+芯、传感条、pill drag 面、可选名称），数据走 getCurrentNote；`backgroundThrottling:false`；挂载 + 首帧 paint 后发 `dock-tab-ready` ACK。
3. preload：补 `view=tab` 所需通道子集（getCurrentNote、dock-peek 发送、ready ACK）——复用现有桥，不新增通道种类，仅允许 tab 窗使用。
4. 测试：建窗参数（尺寸恒定、show:false、query 正确）、联动销毁、TabApp 渲染书签头壳。

## 阶段 2：吸附交接（用户可见，验收点 ①）

1. main.ts 吸附事务：③动画 ACK（dock-shrink-finished）后，废除 target-position + crop 两步，改为——确认/创建书签头窗并已 paint（ACK 或已 ready）→ 书签头窗 setBounds(target)（隐藏态定位）→ `showInactive` → 收到书签头窗 paint ACK → hide 主窗 → commitDocked → `committed:true`。
2. 交接全程源窗 overlay 保持末帧钉在 target 全局点（现有 stable 段逻辑保留），hide 前不清 DOM。
3. fail-closed：书签头窗未 ready/ACK timeout → 不交接收尾，回滚回横条（现有 abort 路径）。
4. 清理 `STICKY_NOTES_SKIP_DOCK_CROP` 实验开关（转正或删除）。
5. 测试更新：collapse-wiring 事务流改为「交接而非裁窗」断言。
6. **真机验收 ①**：吸附收拢连续、落定瞬间不闪（60fps 录屏逐帧复核动画结束点 ±5 帧）。

## 阶段 3：贴边态交互迁移（用户可见，验收点 ②）

1. 悬停探头：enter/leave 来自书签头窗；peek 滑行作用于书签头窗（纯位移，复用 glideNoteWindowTo）；120ms 光标复核轮询改对书签头窗。
2. 抢拖熔断：move 事件源切换为书签头窗；物理按键监视器 pressOnWindow 判定用书签头窗 bounds。
3. 未过阈值拖离钉回、多屏共边 48 全露（书签头窗建窗宽度已定）。
4. **真机验收 ②**：悬停露出/缩回、上下沿抓拖、抢拖熔断与现有手感一致。

## 阶段 4：展开交接（用户可见，验收点 ③）

1. 拖书签头过 72px：主窗在隐藏态 setBounds 到展开矩形（隐藏 resize 不可见）→ 主窗 renderer 备 reveal 首帧（clip 钉书签头矩形，沿用 expandFrom 机制）→ paint ACK → showInactive 主窗 → hide 书签头窗 → 340ms clip 揭示。
2. 启动恢复 docked：建主窗 show:false + 建书签头窗定位后 show（沿用「不能出生即贴边」生命周期教训）。
3. **真机验收 ③**：拖出展开连续、邻屏甩出就地展开、重启恢复贴边。

## 阶段 5：收尾

- CHANGELOG（只写用户可见变化，基线相邻正式版）、Issue #24 补证据、Windows 真机列缺口（不放进对外说明）。
- 记忆沉淀：交接架构实测真相回填 project_macos_animation_truths。

## 明确不做

- 不改判定模型（松手才吸）、外观（96×32 横书签头）、持久化格式。
- 不引入点击穿透子系统（纯位移方案的坑，本架构不需要）。
- 不做 docked → collapsed 的直接路径。
