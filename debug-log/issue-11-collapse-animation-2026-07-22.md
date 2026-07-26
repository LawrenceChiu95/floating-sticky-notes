# Issue #11 收起动画诊断（2026-07-22）

## 症状

应用内收起原型在 macOS 真实 Electron 窗口中有明显停顿和末帧跳变。原型当时由 renderer 等待 IPC 返回后再切换收起 DOM，主进程使用 `setSize(..., true)` 收起、`setBounds(..., true)` 展开。

## 诊断环境

- macOS 26.4（Apple Silicon）
- Electron 41.7.1
- 独立 `--user-data-dir`，真实 `BrowserWindow`，不是浏览器预览
- 同时采样主进程 `resize` / `resized` / bounds 与 renderer `requestAnimationFrame` / `innerHeight` / DOM 状态

## 证据与根因

- 收起请求后，`setResizable(false)` 在约 2ms 内完成，不是主要停顿层。
- `setSize(..., true)` 同步运行约 679ms。原生 bounds 前段连续从 220px 降低，但 renderer viewport 在 54px 停留约 400ms，最后才跳到 40px。
- 因 IPC 要等同步原生动画返回，React 收起态直到约 686ms 才生效；正文卸载与 viewport 最后一跳落在同一帧。
- 展开同样如此：`setBounds(..., true)` 约 299ms 后才返回，renderer 在 66px 停留，随后同时跳到 220px并挂载正文。
- 把原生动画改为多次 `setBounds(..., false)` 仍会触发 macOS live-resize 合并：收起方向曾在 171px 冻结后跳到 40px；因此逐帧调用 BrowserWindow 几何 API 不是可靠修复。
- 单独改成 `setBounds(..., true)` 收起更差，renderer 可被阻塞超过 1 秒，排除“只替换 setSize API”的方案。

根因位于 Electron/macOS 原生窗口 live-resize 与 renderer viewport 提交边界；renderer 在 IPC 结束后才替换 DOM 会放大末帧跳变。CSS 时长和 `setResizable` 不是第一失败层。

## 选定方案

- 不再使用 Electron `animate: true`，也不循环调用原生 bounds 做逐帧动画。
- renderer 负责可见壳体高度与正文透明度过渡；初版为 180ms，最终视觉打磨统一为 240ms 运动族。
- 收起：先把可见壳体完整过渡到 40px，再用一次非动画 `setBounds` 提交真实窗口高度并卸载正文。
- 展开：先用一次非动画 `setBounds` 恢复真实窗口，等 renderer 观察到 `innerHeight > 40` 并再等一帧，然后把已挂载但透明的内容随可见壳体展开。
- 原生边界提交实测为 2–4ms；展开后才恢复 140px 最小高度，避免第一帧从 40px 被约束直接弹到 140px。
- 原生操作全部成功后才提交主进程折叠状态；任一步异常时 best-effort 回滚窗口并保留重试能力。
- 收起顶栏固定为最终内高，避免动画一开始就把正文挤到 0；壳体改用内投影，避免透明原生窗口在最后一帧裁掉外投影。

## 初版自动验证

- `npm test`：139 个 test files、817 项测试通过。
- `npm run build`：TypeScript 与 Electron/Vite 三端构建通过，preload 产物仍为 `.cjs`。
- `npm audit --offline`：0 vulnerabilities。联网 `npm audit` 因当前沙箱无法解析 `registry.npmjs.org` 而未完成在线查询。
- `git diff --check`：通过。
- 独立只读 review 已关闭异常回滚、多屏锚点、viewport 提交竞态、投影裁切和顶栏挤压问题，最新 diff 无 blocker / major。

## 初版验证边界

自动测试与构建只能证明时序契约、bounds 逻辑和类型边界。该阶段的主观丝滑度仍待前台真实 Electron 窗口人工体验，且 Opus / Claude Code review 当时因 Anthropic API 在沙箱内被拒而未完成；这些缺口已在后续打磨与最终 review 中补齐。Windows 目标环境验证仍待单独完成。

## 动效打磨（2026-07-23，第二轮）

第一版 180ms 原型功能正确但感知僵硬。逐帧核对后定位到五个感知断点：

1. 工具栏 5 个按钮在收起第 0 帧直接卸载、展开时满透明度 pop，布局瞬移。
2. `status-label` 与 `collapsed-title` 单帧 DOM 互换，无交叉淡入。
3. drag-bar 28px→38px 无过渡，壳体动 180ms、顶栏跳 1 帧，两个时钟。
4. 展开时正文/工具栏/标题与 class 翻转同一 commit 挂载为最终值，壳还在长、内容已 pop（"空黄后硬弹"的主因之一）。
5. `cubic-bezier(0.22, 1, 0.36, 1)`（easeOutQuint）前 30% 时间走完约 60% 路程，暴起+长尾，读作"急"。

打磨方案（renderer-only，原生边界不变）：

- 几何统一一条运动族：壳高、drag-bar 高度（flex-basis 不可插值，改用 height + `flex: 0 0 auto`）、工具栏 `grid-template-columns: 1fr↔0fr` 折叠，全部 240ms `cubic-bezier(0.33, 0.75, 0.35, 1)`。
- "进入态定义过渡"实现方向性分幕：收起时正文 110ms 快消、工具栏 200ms 折叠、标题 120-150ms 交叉淡入；展开时壳先长，正文延迟 70ms、工具栏延迟 60ms、名称区延迟 50ms 淡入。
- 过渡期间双标题与工具栏保持挂载（由 `isCollapseTransitioning` 驱动），稳态 DOM 与挂载条件不变；收起起点加一帧 `waitForNextPaint()`，让进入元素先以隐藏态挂载再翻 class 启动过渡。
- 收起/展开按钮图标改为双图标叠放旋转交叉淡入，消除最后一处硬切。
- `prefers-reduced-motion: reduce` 下时长压到 1ms（transitionend 仍触发，320ms fallback 兜底）。
- `NOTE_SHELL_TRANSITION_FALLBACK_MS` 260→320，覆盖新的 240ms 壳体运动。
- 标题叠放容器 `.drag-bar-title` 必须 `grid-template-columns: minmax(0, 1fr)`；隐式 auto 列按 max-content 撑宽会让长标题在过渡期溢出而非省略。

自动验证：`npm test` 818/818、`npm run build`、`git diff --check` 通过。主观丝滑度仍以真实 Electron 窗口人工验收为准。

## 工具栏收起级联（2026-07-23，第三轮）

用户认可整体编排后，唯一剩余不足：收起时 5 个工具按钮收拢紧促。根因：`.toolbar` 左对齐于收缩中的 grid 轨道，按钮排整体右滑并被 overflow 裁切，叠加 wrap 140ms 统一淡出，读作"一整块被挤掉"。

调整（只动收起段，展开不变）：

- `.toolbar` 改 `justify-content: flex-end`，按钮锚定在 toggle 旁固定右缘，不再滑动；空间从左侧让出。
- 去掉 wrap 统一 fade，改为逐钮级联：opacity 150ms + translateX(8px) 向 toggle 漂移，从右向左 22ms 步进（删除先走，新建最后，88ms 起）。
- wrap 宽度折叠 220ms、延迟 50ms，尾随级联只扫已淡出的残余。
- 展开契约不变：按钮基态无 transition，仍由 wrap 原有 240ms/60ms + opacity 150ms/60ms 呈现。
- reduced-motion 块纳入 `.toolbar button`。

自动验证：`npm test` 819/819、`npm run build`、`git diff --check` 通过。

## 第一轮顶栏空间方案与验证（2026-07-23，后续已调整）

收起按钮进入顶栏后，默认 `280px` 窗口的命名区曾被五个一级工具按钮挤到只能显示“`双…`”。第一轮方案没有继续压缩文案或按钮，而是调整信息层级：

- 一级工具栏保留“新建 / 待办 / 更多”三个按钮，外观、从剪贴板贴图和删除便签进入“更多”菜单；贴图项保留文字标签并显示 `⌘V` / `Ctrl+V`，继续教会用户更快的粘贴路径。
- 空名称补充原生 `title="双击命名"`；进入命名编辑时，一级工具栏平滑折叠让位，输入框扩展但仍受 `160px` 最大宽度约束，收起按钮保持原位。
- 工具栏收起级联按三个一级按钮调整为 `44ms / 22ms / 0ms`，延续从左到右依次让位的运动语言。
- 真实 Electron 窗口量测：`280px` 下名称轨道 `105px`；`200px` 下名称轨道 `70px`，“双击命名”完整显示；`200px` 命名编辑态输入框约 `136px`，工具栏宽度与透明度均归零。
- “更多”菜单在 `280px` 与 `200px` 窗口中均完整落在窗口内，并完成鼠标、方向键、Home / End、Esc、Tab 与焦点回归检查。

当轮自动验证：`npm test` 140 个 test files、824 项测试通过；`npm run build` 与 `git diff --check` 通过。联网 `npm audit` 唯一命中开发依赖链中的 `fast-uri@3.1.3` 安全公告，已独立记录为 Issue #12，不混入本功能变更。

用户当时已在真实 Electron 窗口认可主动画；Opus 与 Kimi 对同一份当轮 diff 完成独立只读 review，均给出 GO，未发现 blocker 或 major。此后顶栏信息层级与名称布局被重新打开，所以上述工具栏结构和几何数据只保留为第一轮诊断记录，不代表最终产品状态。

## 第二轮顶栏定稿（2026-07-24）

用户要求删除继续保持一级可发现，并认为为消除动效漂移而把展开名称改为左对齐破坏了原有展示。最终方案保留两种稳态各自自然的布局，并隔离过渡中的变化参照物：

- 一级工具栏恢复“新建 / 待办 / 删除 / 更多”四个按钮；删除使用顶栏内联确认，“更多”只包含外观和从剪贴板贴图。
- 默认按钮宽度由候选的 `24px` 回调为 `26px`，`220px` 及以下仍为 `20px`；抓手容器为 `28px`，窄窗为 `22px`，按钮和顶栏高度不变。
- 展开态名称与编辑输入框恢复居中；收起态名称在抓手右侧左对齐。折叠/展开开始时冻结展开标题轨道宽度，使工具栏收放不再带着居中名称横向滑动。
- 未命名便签收起后保持空白，可在收起横条中直接双击命名。已命名展开态移除重复的原生名称 tooltip，hover 弱底色继续提示可编辑。
- 真实 Electron `280×220` 窗口强制 reload 后量测：折叠时展开名称轨迹约 `61.5→62.5px`，展开时收起名称轨迹约 `58→59px`，各自单轨位移均不超过 `1px`，不再出现修复前约 `50px` 的横向纠错滑行。

用户于 2026-07-24 明确验收该版本。Mac 打包产物、Windows 无边框窗口 / DPI / 阴影与多显示器边缘展开仍属于发布前目标环境验证，不由开发态证据替代。

## 收起态命名最终修正（2026-07-25）

后续真实操作暴露出第二轮定稿仍保留了错误边界：收起态名称与编辑槽继续左锚定，而且用 `text-indent` 补偿文字，会在双击时先显示左侧短槽再向右移动。最终要求改为收起态的展示名称与编辑器都以整个窗口中心为不变量，编辑样式与展开态一致。

最终实现：

- `.collapsed-title` 使用居中 flex 轨；默认窗口以右侧 `7px`、≤220px 窄窗以 `5px` 补偿抓手与折叠按钮的 chrome 宽度差。
- 双击只量取当前名称槽宽度，编辑槽在 200ms 内从该宽度向两侧增长到 `min(160px, 100%)`；删除文字宽度测量、`text-indent` 和对应 JS helper。
- 真实 Electron `280px` 窗口强制 reload 后，展示槽为 `72px`、中心 `x=140`；动画宽度约 `72→89→106→121→135→144→151→157→160px`，每一帧中心均为 `x=140`。
- `280px` / `200px` 的几何测试从实际 CSS 复算窗口中心，分别锁定 `140px` / `100px`。

Kimi 对最终命名 diff 完成独立只读复审，结论为 GO，无 blocking 或越界修改。

## 删除内联确认无响应（2026-07-25）

真实坐标点击复现：删除确认按钮命中正确，但在 `pointerdown` 后提示框立即卸载，`click` 没有机会触发删除；直接调用 DOM `.click()` 则删除成功，说明 preload、IPC、存储和关窗链路正常，失败层位于 renderer 事件顺序。

根因是“更多菜单”和“删除确认”已经合并为互斥的 `openPopover` 状态，但外部点击监听仍分别关闭两个旧布尔状态。点击删除确认内部时，监听器先以“点击在更多菜单外”为由清空共享状态，导致确认按钮在 click 前消失；更多菜单项存在同源风险。

修复后外部点击监听只检查当前真正打开的弹层。用空白诊断便签和 CDP 真实鼠标事件复测，确认按钮收到 click、便签窗口关闭并从列表消失；两张诊断便签均已清理，既有便签未触碰。回归测试禁止重新使用两个独立 close helper。

“更多”菜单与便签纸面视觉语言不一致的后续反馈已拆到 [#15](https://github.com/LawrenceChiu95/floating-sticky-notes/issues/15)，下一窗口单独处理，不重新打开已定稿的顶栏动作层级。
