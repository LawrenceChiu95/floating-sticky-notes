import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const expandTransactionSource = readFileSync(
  resolve(__dirname, '../main/dock-expand-transaction.ts'),
  'utf8'
);
const ackSource = readFileSync(resolve(__dirname, '../main/dock-renderer-ack.ts'), 'utf8');
const monitorSource = readFileSync(
  resolve(__dirname, '../main/mouse-button-monitor.ts'),
  'utf8'
);
const collapseControllerSource = readFileSync(
  resolve(__dirname, '../main/note-window-collapse.ts'),
  'utf8'
);
const preloadSource = readFileSync(resolve(__dirname, '../preload/preload.ts'), 'utf8');
const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const dockedShellSource = readFileSync(
  resolve(__dirname, '../renderer/src/docked-note-shell.tsx'),
  'utf8'
);
const globalTypes = readFileSync(resolve(__dirname, '../renderer/src/global.d.ts'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../renderer/src/styles.css'), 'utf8');

describe('sticky note collapse wiring', () => {
  it('exposes only the typed collapse command through preload', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('sticky-notes:set-collapsed', collapsed)");
    expect(globalTypes).toContain('setCollapsed: (collapsed: boolean) => Promise<boolean>;');
  });

  it('keeps Electron native bounds changes non-animated', () => {
    expect(mainSource).toContain('createNoteWindowCollapseController');
    expect(collapseControllerSource).toContain('noteWindow.setBounds(');
    expect(collapseControllerSource).toContain('false');
    expect(collapseControllerSource).not.toContain('setSize(');
    expect(collapseControllerSource).not.toContain(', true');
  });

  it('finishes the visible collapse before shrinking native bounds', () => {
    const visualTransitionIndex = appSource.indexOf(
      'const visualTransition = waitForHeightTransition(noteShellRef.current);'
    );
    const visualTransitionWaitIndex = appSource.indexOf('await visualTransition;');
    const nativeCollapseIndex = appSource.indexOf(
      'window.stickyNotes.setCollapsed(collapsed)'
    );

    expect(visualTransitionIndex).toBeGreaterThan(-1);
    expect(visualTransitionWaitIndex).toBeGreaterThan(visualTransitionIndex);
    expect(nativeCollapseIndex).toBeGreaterThan(visualTransitionWaitIndex);
    expect(appSource).toContain('{shouldRenderContent ? (');
  });

  it('grows the native window before revealing expanded content', () => {
    const nativeExpandIndex = appSource.indexOf('window.stickyNotes.setCollapsed(collapsed)');
    // 从收起确认调用之后找，避免命中 dock 展开揭示动画里的同名调用。
    const viewportWaitIndex = appSource.indexOf('await waitForExpandedViewport();', nativeExpandIndex);
    const revealExpandedIndex = appSource.indexOf('setIsCollapsed(false);', nativeExpandIndex);

    expect(viewportWaitIndex).toBeGreaterThan(nativeExpandIndex);
    expect(revealExpandedIndex).toBeGreaterThan(nativeExpandIndex);
    expect(revealExpandedIndex).toBeGreaterThan(viewportWaitIndex);
    expect(appSource).toContain('window.innerHeight > NOTE_COLLAPSED_HEIGHT');
    expect(appSource).toContain('setTimeout(handleResize, NOTE_VIEWPORT_RESIZE_FALLBACK_MS)');
    expect(appSource).not.toContain('setTimeout(finish, NOTE_VIEWPORT_RESIZE_FALLBACK_MS)');
  });

  it('restores the shared content scroll position after the expanded viewport returns', () => {
    const captureIndex = appSource.indexOf(
      'collapsedScrollTopRef.current = noteContentRef.current?.scrollTop ?? 0;'
    );
    const helperSource = appSource.slice(
      appSource.indexOf('const restoreCollapsedScrollTop = (): void => {'),
      appSource.indexOf('const captureCollapsedScrollTop')
    );
    const collapseHandlerIndex = appSource.indexOf('const handleCollapsedChange');
    const collapseViewportWaitIndex = appSource.indexOf(
      'await waitForExpandedViewport();',
      collapseHandlerIndex
    );
    const collapseRestoreIndex = appSource.indexOf(
      'restoreCollapsedScrollTop();',
      collapseHandlerIndex
    );
    const missingContentGuardIndex = helperSource.indexOf(
      'if (scrollTop === undefined || !noteContent)'
    );
    const collapsedViewportGuardIndex = helperSource.indexOf(
      'window.innerHeight <= NOTE_COLLAPSED_HEIGHT'
    );
    const restoreWriteIndex = helperSource.indexOf('noteContent.scrollTop = scrollTop;');
    const keepClampedIndex = helperSource.indexOf(
      'if (scrollTop === 0 || noteContent.scrollTop > 0)'
    );
    const keepClampedBlock = helperSource.slice(keepClampedIndex, helperSource.indexOf('};', keepClampedIndex));
    const clearBeforeKeep = helperSource.slice(0, keepClampedIndex);
    const clearIndex = keepClampedBlock.indexOf('collapsedScrollTopRef.current = undefined;');

    expect(appSource).toContain('ref={noteContentRef}');
    expect(captureIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(appSource.indexOf('setIsCollapseTransitioning(true);'));
    expect(missingContentGuardIndex).toBeGreaterThan(-1);
    expect(collapsedViewportGuardIndex).toBeGreaterThan(missingContentGuardIndex);
    expect(restoreWriteIndex).toBeGreaterThan(collapsedViewportGuardIndex);
    expect(keepClampedIndex).toBeGreaterThan(restoreWriteIndex);
    expect(clearBeforeKeep).not.toContain('collapsedScrollTopRef.current = undefined;');
    expect(clearIndex).toBeGreaterThan(-1);
    expect(keepClampedBlock).toMatch(
      /if \(scrollTop === 0 \|\| noteContent\.scrollTop > 0\) \{\s*collapsedScrollTopRef\.current = undefined;\s*\}/s
    );
    expect(collapseHandlerIndex).toBeGreaterThan(-1);
    expect(collapseViewportWaitIndex).toBeGreaterThan(collapseHandlerIndex);
    expect(collapseRestoreIndex).toBeGreaterThan(collapseViewportWaitIndex);
  });

  it('restores the shared content scroll position after a docked note expands', () => {
    // 贴边只能从收起横条进去：收起时已经记下 scrollTop。拖出展开重挂正文后
    // 必须等窗口长开再写回，不能在 flushSync 里趁书签头尺寸把值夹成 0。
    const startExpandSource = appSource.slice(
      appSource.indexOf('const startDockExpandReveal'),
      appSource.indexOf('const prepareDockExpandReveal')
    );
    const prepareExpandSource = appSource.slice(
      appSource.indexOf('const prepareDockExpandReveal'),
      appSource.indexOf('const runPendingDockExpandReveal')
    );
    const revealSource = appSource.slice(
      appSource.indexOf('const beginExpandHoldReveal'),
      appSource.indexOf('const pinExpandClipToBookmark')
    );
    const shrinkSource = appSource.slice(
      appSource.indexOf('const startDockShrinkToBookmark'),
      appSource.indexOf('// 恢复性聚焦守卫')
    );

    const startWaitIndex = startExpandSource.indexOf('await waitForExpandedViewport();');
    const startFrameIndex = startExpandSource.indexOf('await waitForAnimationFrame();');
    const startRestoreIndex = startExpandSource.indexOf('restoreCollapsedScrollTop();');
    const prepareWaitIndex = prepareExpandSource.indexOf('await waitForExpandedViewport();');
    const prepareFrameIndex = prepareExpandSource.indexOf('await waitForAnimationFrame();');
    const prepareRestoreIndex = prepareExpandSource.indexOf('restoreCollapsedScrollTop();');

    expect(startWaitIndex).toBeGreaterThan(-1);
    expect(startFrameIndex).toBeGreaterThan(startWaitIndex);
    expect(startRestoreIndex).toBeGreaterThan(startFrameIndex);
    expect(prepareWaitIndex).toBeGreaterThan(-1);
    expect(prepareFrameIndex).toBeGreaterThan(prepareWaitIndex);
    const revealRestoreIndex = revealSource.indexOf('restoreCollapsedScrollTop();');
    const revealClipIndex = revealSource.indexOf('runExpandClipReveal');
    expect(prepareRestoreIndex).toBeGreaterThan(prepareFrameIndex);
    expect(revealRestoreIndex).toBeGreaterThan(-1);
    expect(revealClipIndex).toBeGreaterThan(revealRestoreIndex);
    expect(shrinkSource).toContain('captureCollapsedScrollTop();');
    expect(shrinkSource).not.toContain('?? 0');
  });

  it('animates the visible shell instead of the BrowserWindow viewport', () => {
    // 高度动画只挂在收起/展开过渡态:基础态过渡会让用户手动缩放窗口时纸面
    // 滞后于 100vh(底边先缩再弹回),所以这里锁定的是 transitioning 选择器。
    expect(styles).toMatch(
      /\.note-shell--collapse-transitioning\s*{[^}]*transition:\s*height 240ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\)/s
    );
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*height/s);
    expect(styles).toMatch(
      /\.note-shell--collapsed\s*{[^}]*height:\s*var\(--note-collapsed-height\);/s
    );
    expect(appSource).toContain("'--note-collapsed-height': `${NOTE_COLLAPSED_HEIGHT}px`");
    expect(styles).toMatch(
      /\.note-shell--collapsed \.note-content\s*{[^}]*opacity:\s*0;/s
    );
    expect(styles).toMatch(
      /\.note-shell--collapsed \.drag-bar\s*{[^}]*height:\s*calc\(var\(--note-collapsed-height\) - 2px\);/s
    );
    expect(styles).toMatch(/\.note-shell--collapsed\s*{[^}]*box-shadow:\s*inset/s);
    expect(appSource).toContain('const collapsedLabel = statusMessage || noteNaming.name;');
  });

  it('stages toolbar, title and content reveals along the shell motion', () => {
    // The drag bar height follows the shell easing instead of snapping.
    expect(styles).toMatch(
      /\.drag-bar\s*{[^}]*transition:\s*height 240ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\)/s
    );
    // The toolbar folds away by width instead of unmounting mid-animation.
    expect(styles).toMatch(/\.toolbar-wrap\s*{[^}]*grid-template-columns:\s*1fr;/s);
    expect(styles).toMatch(
      /\.note-shell--collapsed \.toolbar-wrap\s*{[^}]*grid-template-columns:\s*0fr;/s
    );
    // Expanded-state reveals are delayed so content fades in behind the growing shell.
    expect(styles).toMatch(/\.note-content\s*{[^}]*transition:\s*opacity 170ms ease-out 70ms/s);
    expect(styles).toMatch(/\.status-label\s*{[^}]*transition:\s*opacity 160ms ease 50ms/s);
    // Both title variants cross-fade while they stay mounted during the transition.
    expect(styles).toMatch(
      /\.note-shell:not\(\.note-shell--collapsed\) \.collapsed-title\s*{[^}]*opacity:\s*0;/s
    );
    expect(styles).toMatch(
      /\.note-shell--collapsed \.status-label\s*{[^}]*opacity:\s*0;/s
    );
    expect(appSource).toContain('{!isCollapsed || isCollapseTransitioning ? (');
    expect(appSource).toContain('{isCollapsed || isCollapseTransitioning ? (');
    // The collapse flip waits one painted frame so incoming elements mount hidden.
    expect(appSource).toContain('await waitForNextPaint();');
    // The transition fallback outlives the 240ms shell motion.
    expect(appSource).toContain('NOTE_SHELL_TRANSITION_FALLBACK_MS = 320');
  });

  it('exposes only the dock-applied notification through preload', () => {
    // 磁吸由主进程在原生拖动的 move 上直接改窗口几何，renderer 只收单向通知
    // 切 DOM；offer/accept 与 start/move/finish 自定义拖窗通道不允许回来。
    expect(preloadSource).toContain("ipcRenderer.on('sticky-notes:dock-applied'");
    expect(globalTypes).toContain('onDockApplied:');
    expect(preloadSource).not.toContain('dock-offer');
    expect(preloadSource).not.toContain('undock-offer');
    expect(preloadSource).not.toContain('accept-dock');
    expect(preloadSource).not.toContain('accept-undock');
    expect(preloadSource).not.toContain('note-window-drag');
    expect(globalTypes).not.toContain('startNoteWindowDrag');
    expect(globalTypes).not.toContain('acceptDock');
    expect(globalTypes).not.toContain('epoch');
  });

  it('keeps drags free of window writes and docks only after a confirmed release', () => {
    // 松手才吸附：原生拖拽会话进行中任何写窗都两头坏（写中 = x 每帧被重置、
    // 位移攒不到 48px 阈值 = 拖不出来；吞一半 = 抽搐），「停歇≈松手」的 settle
    // 模型按住不动也停歇，两轮被否。新模型：move 流全程零写窗（唯一例外是
    // 贴边拖离 ≥48px 的一次性展开），吸附/钉回都等 settle watch 确认（连续
    // 3 拍 bounds 静止 + 光标停稳 + 光标不在抓取点 = 拖拽会话已结束）才落位。
    expect(mainSource).toContain("noteWindow.on('move'");
    expect(mainSource).toContain('resolveCollapsedDockSide');
    expect(mainSource).toContain('resolveDockedEdgeOffset');
    expect(mainSource).toContain('buildExpandBoundsFromDock');
    // settle 整套不许回来：停歇计时器、钉回函数都不许存在。
    expect(mainSource).not.toContain('dockSettleTimer');
    expect(mainSource).not.toContain('settleDockedPose');
    expect(mainSource).not.toContain('scheduleDockSettle');
    // settle watch：move 停歇 100ms 启动，60ms 一拍。helper 活着时松手判定
    // 权威（isDown 护栏），只需 1 拍 bounds 静止等尾部 move 冲刷，光标判据
    // 不启用（松手后跟随动作不该推迟收尾）；helper 缺席/死亡的启发式路径
    // 连续 3 拍「bounds 没变 + 光标位移 <3px + 光标不在抓取点上」才收尾。
    // live 信号是光标不是 bounds：getBounds 在 move 事件被 macOS 合并的间隙
    // 里是冻住的（真机日志：快速甩动间隙 >220ms，「两拍 bounds 静止」在活
    // 拖拽中也成立——bounds 判据已被真机证伪）；活拖拽中光标不可能连续静止。
    // 「光标在抓取点上且静止」= 按住不动，绝不写窗（松手后手停抓取点 =
    // 软失败，下次动鼠标才收尾）。
    expect(mainSource).toContain('NOTE_DOCK_DRAG_QUIET_MS = 100');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_POLL_MS = 60');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_TICKS = 3');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_TICKS_AFTER_RELEASE = 1');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_CURSOR_STILL_PX = 3');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_GRAB_PX = 24');
    expect(mainSource).toContain("armSettleWatch('dock', { ignoreCursor: fromRelease })");
    expect(mainSource).toContain("armSettleWatch('docked', { ignoreCursor: fromRelease })");
    // 快速甩边：松手瞬间窗口可能还没进吸附区（真机 side=null、光标已贴边），
    // 物理松手无条件武装；settle fire 用冲刷后的 bounds + 松手瞬间光标裁决。
    expect(mainSource).toContain('if (fromRelease || side || pendingStripRestore !== null)');
    expect(mainSource).toContain('dockReleaseIntentCursor');
    expect(mainSource).toContain('postReleaseCoasting');
    // bounds 动了 = 拖拽活着，整个比对作废；光标判据只在 helper 缺席/死亡时
    // 启用（helper 活着时 isDown 是权威，松手后跟随动作不许推迟收尾）。
    expect(mainSource).toContain('if (boundsMoved) {');
    expect(mainSource).toContain(
      'if (!options?.ignoreCursor && mouseButtonMonitor?.isActive() !== true) {'
    );
    expect(mainSource).toContain('isCursorOnGrab(bounds, cursor)');
    // 物理按键护栏（macOS helper）：按键还按着 = 拖拽会话确定活着，settle
    // watch 绝不累积——「bounds 冻结 + 光标静止」的同构误伤在原理上被封死。
    // 松手翻转直接武装 settle watch（跳过光标检查，bounds 静止比对等尾部
    // move 冲刷，不猜固定延迟），release-still（松手后手停抓取点）照常收尾。
    // helper 缺席/死亡的平台退回纯光标判据（isActive 假阴性防护）。
    expect(mainSource).toContain('createMouseButtonMonitor');
    expect(mainSource).toContain('mouseButtonMonitor?.isDown()');
    expect(mainSource).toContain('mouseButtonMonitor?.isActive()');
    expect(mainSource).toContain('mouseButtonMonitor.onRelease(');
    expect(mainSource).toContain("'dock_button_release'");
    // 松手归属证据：helper 的 release 是全局广播，只有「按下时光标在本窗上」
    // 的松手才允许收尾本窗——别处的点击撞上本窗程序性 move（show 回拉等）
    // 会造成误吸附/误钉回。
    expect(mainSource).toContain('pressOnWindow');
    expect(mainSource).toContain('isCursorOverWindow(4)');
    // 吸附滑行被抢拖熔断后不提交 dock（commit 内部 setBounds 会撞上活拖拽），
    // 记下熔断前横条矩形，拖拽结束且未停进吸附区时恢复横条几何与 DOM。
    expect(mainSource).toContain('pendingStripRestore ??= {');
    expect(mainSource).toContain('sourceBounds,');
    expect(mainSource).toContain('stripOffset: context.stripOffset');
    expect(mainSource).toContain("'dock_abort_strip_restore'");
    // helper 死亡降级与退出收尸：helper 是独立子进程，app.exit 不会替我们杀。
    expect(monitorSource).toContain('isActive');
    expect(monitorSource).toContain("child.on('exit'");
    expect(mainSource).toContain('mouseButtonMonitor?.dispose()');
    // 滑行/展开会话带代际令牌：旧会话迟到的 finally 不许清新会话的
    // peekGlide/inFlight（共享布尔竞态，双 reviewer 实锤）。
    expect(mainSource).toContain('transitionEpoch');
    expect(mainSource).toContain('if (epoch !== transitionEpoch) {');
    expect(mainSource).toContain('finishMagneticTransition(epoch)');
    // 沿边上下拖的手抖回差：x 偏移 48~72px = 竖拖带出的横向抖动，不展开
    // （松手后照常滑回钉边）。位移取绝对值：往屏缘外侧拖过 72px 也展开
    // （多屏时那是把书签头甩上邻屏，应在邻屏展开而不是松手后跨屏钉回——
    // 真机日志 tuck 跨屏 1900~2400px 就是「抽搞」主根因）。
    expect(mainSource).toContain('NOTE_DOCK_UNFOLD_HYSTERESIS_PX');
    // 收尾事件的诊断桩：真机再抽搐时日志能指认是哪条写窗链。
    expect(mainSource).toContain("'dock_settle_fire'");
    // 归位滑行距离门槛：|dx|+|dy| ≤ 48px 直接落位（日志里大多数吸附只挪
    // 0~14px，零距离也滑 120ms 就是「黏腻」）；钉回超 160px 状态已脱臼，
    // 长距飞行不如瞬移。
    expect(mainSource).toContain('NOTE_DOCK_GLIDE_MIN_PX = 48');
    expect(mainSource).toContain('NOTE_DOCK_TUCK_GLIDE_MAX_PX = 160');
    // 吸附调用点在 release 收尾函数里，不许回到 move 流上：move 处理器声明
    // 之前必须已经出现最终 commit（finalize 定义在 move 之前）。
    const dockCallIndex = mainSource.indexOf('collapseController.commitDocked({');
    const moveHandlerIndex = mainSource.indexOf("noteWindow.on('move'");
    const finalizeDockIndex = mainSource.indexOf('const finalizeDockOnRelease');
    expect(finalizeDockIndex).toBeGreaterThan(-1);
    expect(dockCallIndex).toBeGreaterThan(finalizeDockIndex);
    expect(dockCallIndex).toBeLessThan(moveHandlerIndex);
    // 惰性钉回只剩一个合法调用点：settle watch 确认松手后的 settleDockedIdle。
    // 钉回姿势按光标真相一次算对（光标在窗上 → 露出位，不在 → 半藏位），
    // commit 走 kind:'peek' 带完整矩形——旧版钉回提交姿势（露出态抓走的就是
    // 露出）再补一发 hide 滑行的两段动不许回来。
    // move 流上的钉回（pinback_immediate 那类「系统动窗」闸门）被真机实锤会
    // 进死锁（拖出 200~400px 仍被反复钉回 = 完全拖不出来），不许回来。
    expect(mainSource.split('dock_tuck_glide').length - 1).toBe(1);
    expect(mainSource).toContain('tuckHovered');
    expect(mainSource).toContain("setDocked({ kind: 'peek', bounds: target })");
    expect(mainSource).not.toContain('dock_pinback_immediate');
    expect(mainSource).toContain("'sticky-notes:dock-applied'");
    expect(mainSource).toContain('undockNoteForWebContents');
    // 拖出展开的揭示动画：原生 setBounds 一帧到位（活拖拽中多帧写窗是红线），
    // 但窗口透明——主进程把书签头在新窗口坐标系内的矩形随 dock-applied 发给
    // renderer，纸面 DOM 从书签头位置 clip 揭示到全窗（WAAPI，与收起/展开
    // 同一组缓动），可见运动轨迹全在 DOM 层。
    expect(mainSource).toContain('expandFrom');
    expect(appSource).toContain('startDockExpandReveal');
    expect(appSource).toContain('shell.animate(');
    expect(appSource).toContain('shell.style.clipPath');
    // 落点长成：prepare 阶段主壳隐身、替身钉在 expandFrom 顶住上屏首帧；
    // clip 起播后替身再留 ~120ms 溶进标题栏。ACK 前不得卸替身——右贴边落点
    // 在窗右上，没有替身就会先露出工具栏图标。
    expect(appSource).toContain('note-shell--expand-hold');
    expect(appSource).toContain('dock-expand-bookmark');
    expect(appSource).toContain("phase: 'prepare'");
    expect(appSource).toContain('beginExpandHoldReveal');
    expect(appSource).toContain('NOTE_DOCK_EXPAND_HOLD_MS = 120');
    expect(appSource).toContain("shell.style.willChange = 'clip-path';");
    expect(styles).toContain('.note-shell--expand-hold');
    expect(styles).toContain('.dock-expand-bookmark');
    expect(styles).toContain('.dock-expand-bookmark--dissolve');
    expect(styles).toContain('.dock-expand-bookmark .note-shell');
    expect(appSource).toContain("dockExpandHold?.phase === 'prepare' ? ' note-shell--expand-hold'");
    const prepareHoldIndex = appSource.indexOf("phase: 'prepare'");
    const dissolveIndex = appSource.indexOf("phase: 'dissolve'");
    expect(prepareHoldIndex).toBeGreaterThan(-1);
    expect(dissolveIndex).toBeGreaterThan(prepareHoldIndex);
    expect(appSource.indexOf('setDockExpandHold(null);', dissolveIndex)).toBeGreaterThan(
      dissolveIndex
    );
    // 过回差带的物理松手直接展开，不再先等 60ms settle 拍。
    expect(mainSource).toContain('if (releaseOffset >= NOTE_DOCK_UNFOLD_HYSTERESIS_PX) {');
    expect(mainSource).toContain('expandDockedNote(side, current);');
    // transparent + frameless 的原生阴影在 macOS 几何切换时会重算成黑色轮廓。
    // 阴影配置必须在建窗时一次决定；运行中切换会重新引入闪烁和时序竞态。
    expect(mainSource).not.toContain('setHasShadow(');
    // 吸附逆揭示（窗口交接版，2026-09-01）：可见运动全在 DOM；native 几何只有
    // union 生长（只长大不缩小）。**落定不再有 union→target 裁窗**——可见时刻
    // 改透明窗尺寸必闪（Electron 结构性缺陷，官方 issue 2017→2025 全
    // not_planned）；改由预渲染的独立恒尺寸书签头窗 showInactive 上屏交接，
    // 主窗随后 hide。顺序必须「先 show 新窗、后 hide 旧窗」。
    const dockShrinkNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n          dock: { side },"
    );
    const unionBoundsIndex = mainSource.indexOf('noteWindow.setBounds(union, false);');
    expect(dockShrinkNotifyIndex).toBeGreaterThan(-1);
    expect(unionBoundsIndex).toBeGreaterThan(dockShrinkNotifyIndex);
    // 交接在回执（dock-shrink-finished）之后、commit 之前；回执等待要有超时
    // 兜底与 epoch 抢拖熔断。裁窗不允许回来。
    expect(mainSource).toContain("'sticky-notes:dock-shrink-finished'");
    expect(dockShrinkNotifyIndex).toBeLessThan(unionBoundsIndex);
    expect(mainSource).not.toContain('noteWindow.setBounds(target, false);');
    expect(mainSource).not.toContain('unionAtTarget');
    const handoverIndex = mainSource.indexOf('tab.showInactive();', unionBoundsIndex);
    expect(handoverIndex).toBeGreaterThan(unionBoundsIndex);
    expect(mainSource.indexOf('noteWindow.hide();', handoverIndex)).toBeGreaterThan(handoverIndex);
    expect(mainSource.indexOf('collapseController.commitDocked({', handoverIndex)).toBeGreaterThan(
      handoverIndex
    );
    expect(mainSource).not.toContain('NOTE_DOCK_IN_GLIDE_DURATION_MS');
    expect(mainSource).not.toContain('setHasShadow(');
    // 自定义拖窗整条链路不许回来：拖动 IPC、轮询跟光标、松手判定、offer/accept。
    expect(mainSource).not.toContain('note-window-drag');
    expect(mainSource).not.toContain('noteWindowDragSessions');
    expect(mainSource).not.toContain('noteWindowDragOffsets');
    expect(mainSource).not.toContain('NOTE_WINDOW_DRAG_FOLLOW_INTERVAL_MS');
    // 红线是「轮询光标驱动窗口」：光标轮询只允许做判定（settle watch、leave
    // 兜底），「定时器里读光标又写窗」这个组合不许回来（180ms 滑行定时器只写
    // 窗不读光标，合法）。
    expect(mainSource).not.toMatch(/setInterval[\s\S]{0,200}getCursorScreenPoint[\s\S]{0,200}setBounds/);
    expect(mainSource).not.toContain('dock-offer');
    expect(mainSource).not.toContain('undock-offer');
    expect(mainSource).not.toContain('accept-dock');
    expect(mainSource).not.toContain('accept-undock');
    expect(mainSource).not.toContain('snapBackDockForWebContents');
    expect(appSource).not.toContain('startNoteWindowDrag');
    expect(appSource).not.toContain('handleNoteWindowDragPointerDown');
    expect(appSource).not.toContain('handleDockOffer');
    expect(appSource).not.toContain('handleUndockOffer');
  });

  it('keeps collapsed and docked surfaces on the native app-region drag', () => {
    // 展开/收起横条与贴边书签头都走原生拖窗。收起态不得再有 no-drag 覆盖
    // （那是自定义拖窗时代的残留）；贴边书签头的拖动面是透明 pill，永久
    // drag——外壳只在朝桌面那一侧留 5px no-drag 传感条，enter/leave 在应用
    // 非激活时也照收（leave 实验 6/6 双向送达）；从上下沿进入丢的 enter 由
    // 主进程 120ms 悬停复核轮询兜底，不需要任何运行时翻转。
    expect(styles).toMatch(/\.drag-bar\s*{[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).not.toMatch(
      /\.note-shell--collapsed \.drag-bar\s*{[^}]*-webkit-app-region:\s*no-drag;/s
    );
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*-webkit-app-region:\s*drag;/s);
  });

  it('restores persisted docks as sliver-sized windows', () => {
    expect(mainSource).toContain('restoreDockedBounds');
    expect(mainSource).toContain('applyRestoredDock');
  });

  it('remounts note content when a docked note is dragged back out', () => {
    // 收起成横条时正文会卸载（setShouldRenderContent(false)）；贴边 → 拖出展开
    // 只切 dock 不恢复该标记的话，窗口长开后只剩工具栏、正文空白。
    const handlerIndex = appSource.indexOf('window.stickyNotes.onDockApplied');
    expect(handlerIndex).toBeGreaterThan(-1);
    const restoreIndex = appSource.indexOf('setShouldRenderContent(true);', handlerIndex);
    expect(restoreIndex).toBeGreaterThan(handlerIndex);
    expect(appSource).toContain('restoreCollapsedScrollTop();');
  });

  it('renders the docked state as a bookmark tab without note chrome', () => {
    expect(dockedShellSource).toContain('note-shell--docked');
    // 环 + 芯：壳永久 no-drag，承载视觉；朝桌面那一侧留 5px no-drag 传感条
    // （drag 区在应用非激活时收不到 OS 的 enter/leave，no-drag 面双向照收），
    // 其余三边与壳齐平的透明 pill 是永久 drag 的拖动面，上下沿可直接抓取。
    // 光标诚实：壳（含传感条）不是 drag 面，不许再挂 grab 小手；grab 只标在
    // 真能拖的 pill 上。
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*cursor:\s*default;/s);
    expect(styles).not.toMatch(/\.note-shell--docked\s*{[^}]*cursor:\s*grab;/s);
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*cursor:\s*grab;/s);
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0 5px 0 0;/s);
    expect(styles).toMatch(/\.note-shell--dock-right \.dock-tab-pill\s*{[^}]*inset:\s*0 0 0 5px;/s);
    // 书签头 DOM 铺满整个窗口：半藏由窗口几何实现（一半探出屏外），DOM 永远
    // 填满窗口，屏内不会出现透明死区。
    expect(styles).toMatch(
      /\.note-shell--docked\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;/s
    );
    // 左贴边内侧两角圆角、右贴边反过来；半藏时外侧两角在屏外。
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*border-radius:\s*0 10px 10px 0;/s);
    expect(styles).toMatch(
      /\.note-shell--dock-right\.note-shell--docked\s*{[^}]*border-radius:\s*10px 0 0 10px;/s
    );
    // 有名字时书签头上横排露出一小段；没名字就是纯色头。名字不可交互（不抢拖动）。
    expect(dockedShellSource).toContain('dock-tab-name');
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*max-width:\s*100%;/s);
    expect(styles).not.toMatch(/\.dock-tab-name\s*{[^}]*writing-mode/s);
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*pointer-events:\s*none;/s);
    // 书签头走原生拖窗，renderer 不挂任何窗口拖动的指针处理器。
    expect(appSource).not.toContain('onPointerDown={handleNoteWindowDragPointerDown}');
  });

  it('glides only where no drag session can fight it: hover peek, release dock and idle tuck', () => {
    // 180ms 滑行只属于「没有拖拽会话争写」的时刻：悬停探头（拖动已停）、松手
    // 吸附与惰性钉回（settle watch 已确认光标停稳、不在抓取点）。三条滑行
    // 路径都挂走廊熔断（peekGlide），滑行途中抢拖第一帧就交还几何。
    expect(mainSource).toContain('glideNoteWindowTo');
    expect(mainSource).toContain('easeOutCubic');
    expect(mainSource).toContain('NOTE_DOCK_GLIDE_DURATION_MS = 180');
    expect(mainSource).toContain('settleDockedIdle');
    expect(styles).not.toContain('dock-tab-settle');
  });

  it('shows a dock preview hint while the bar is inside the snap zone', () => {
    // 拖动中预览（Windows Snap 式承诺）：主进程在 move 上检测横条进入吸附区，
    // 只发 dock-preview 状态 IPC（不写窗），renderer 在横条上显示「松手贴边」
    // chip；离开吸附区 side 为 null，吸附/展开落地时清除。
    expect(mainSource).toContain("'sticky-notes:dock-preview'");
    expect(mainSource).toContain('dockPreviewSide');
    expect(preloadSource).toContain("ipcRenderer.on('sticky-notes:dock-preview'");
    expect(globalTypes).toContain('onDockPreview:');
    expect(appSource).toContain('window.stickyNotes.onDockPreview');
    expect(appSource).toContain('dock-preview-chip');
    // chip 绝对定位不参与布局（拖动中标题不跳）、pointer-events 关闭（不在
    // drag 区上挖洞）。
    expect(styles).toMatch(/\.dock-preview-chip\s*{[^}]*position:\s*absolute;/s);
    expect(styles).toMatch(/\.dock-preview-chip\s*{[^}]*pointer-events:\s*none;/s);
  });

  it('snaps only after the bar overhangs the screen edge', () => {
    // 触发语义：横条探出屏外 ≥8px（光标顶到屏幕边）才吸附；探出部分落在
    // 相邻显示器上（跨屏拖动）不吸。路过、靠近不再误吸。快速甩边时窗口
    // 滞后，松手光标贴边视为同一意图，交给共享判定，不在 main 里另写一套。
    expect(mainSource).toContain('resolveCollapsedDockSide(\n        current,\n        workArea,');
    expect(mainSource).toContain('neighborWorkAreas');
    expect(mainSource).toContain('dockReleaseIntentCursor');
    expect(mainSource).toContain('screen.getCursorScreenPoint()');
  });

  it('reveals the full tab on hover and slides it back half-hidden, geometry only', () => {
    // 悬停探头：书签头静止半藏；mouseenter/leave 只是扳机，主进程一次性查
    // 光标判定真实悬停（红线是轮询跟光标，单次查询合法），悬上滑行露整条、
    // 移开滑回半藏。藏与露只是几何，不搬 DOM。扳机挂在 no-drag 壳上：drag 区
    // 在应用非激活时收不到 OS 的 enter/leave，no-drag 传感环双向照收。
    expect(preloadSource).toContain("ipcRenderer.send('sticky-notes:dock-peek'");
    expect(globalTypes).toContain('dockPeekHover: (hovered: boolean) => void;');
    // enter/leave 扳机挂在共享的书签头壳组件上（便签主窗 overlay 与独立
    // 书签头窗同一份）。
    expect(dockedShellSource).toContain('window.stickyNotes.dockPeekHover(true)');
    expect(dockedShellSource).toContain('onMouseLeave={() => window.stickyNotes.dockPeekHover(false)}');
    expect(mainSource).toContain("noteWindow.webContents.on('ipc-message'");
    expect(mainSource).toContain("channel === 'sticky-notes:dock-peek'");
    expect(mainSource).toContain('requestDockPeekReconcile');
    expect(mainSource).toContain('reconcileDockPeekHover');
    expect(mainSource).toContain('screen.getCursorScreenPoint()');
    expect(mainSource).toContain('reveal: hovered');
    expect(mainSource).toContain("kind: 'peek'");
    // 贴边态的滑行收尾补一发悬停复核（直调，能走到那说明写窗路径已完结）：
    // enter/leave 是一次性事件，「缩回途中光标折返」等断拍靠它自愈；非贴边态
    // 时推迟扳机直接清掉，不对 expanded 窗口复核。
    expect(mainSource).toContain('dockPeekReconcilePending = true');
    expect(mainSource).toContain('finishMagneticTransition');
    // 吸附落位姿势按光标真相一次算对：光标还在书签头矩形上就以露出姿势落位
    // （不再「先落半藏、探头复核再反向探出 48px」的两段动——真机「吸进去抽
    // 一下」的来源）；光标不在则落半藏，复核轮询以光标真相维持姿势不会误
    // 探出。suppress 压制状态机（until-leave/边距/计时）因此整体拆除，不许
    // 回来。
    expect(mainSource).toContain('revealTarget');
    expect(mainSource).toContain('landedHovered');
    expect(mainSource).toContain('const target = landedHovered ? revealTarget : restTarget;');
    expect(mainSource).not.toContain('suppressDockPeekUntilLeave');
    expect(mainSource).not.toContain('suppressDockPeekUntilMs');
    expect(mainSource).not.toContain('cursorAwayFromDockEdge');
    expect(mainSource).not.toContain('suppressDockPeekMarginPx');
    // 拖动/停歇比对进行中（move 流在刷新 quiet 计时，或 settle watch 在等
    // 光标停稳）不演探头滑行：多帧写入会撞上原生拖拽会话；扳机记下，停稳
    // 收尾用光标真相统一复核。
    expect(mainSource).toContain('if (dragQuietTimer !== null || settleWatchTimer !== null) {');
    // 物理按键护栏：「刚吸附落位马上拖出来」的按下时刻，move 还没流第一帧
    // （quiet 未武装、上面的护栏全落空），而 morph 切 DOM 补发的 mouseenter
    // 正好落进这个空档——按住时绝不发起探头滑行，否则多帧写窗撞原生拖拽
    // 会话 = 拖不出来。扳机记下，拖拽收尾用光标真相补复核。
    const reconcileGuardIndex = mainSource.indexOf(
      'if (dragQuietTimer !== null || settleWatchTimer !== null) {'
    );
    expect(
      mainSource.indexOf('if (mouseButtonMonitor?.isDown()) {', reconcileGuardIndex)
    ).toBeGreaterThan(reconcileGuardIndex);
    // 探头滑行途中用户抓住书签头抢拖：偏离滑行走廊的第一帧 move 熔断滑行、
    // 交还几何——拖拽会话进行中争写 setBounds 会被吞（fast-drag 变形同款根因）。
    expect(mainSource).toContain('peekGlide.aborted = true');
    // 窗口交接：滑行对象在 docked 态是书签头窗（活动窗），不再是便签主窗。
    expect(mainSource).toContain(
      'await glideNoteWindowTo(getDockActiveWindow(), target, () => glide.aborted)'
    );
    // enter/leave 双兜底轮询：OS 投递都不可靠——应用非激活时 leave 会丢（快速
    // 甩出、贴屏边滑走），而 no-drag 传感条只留朝桌面一侧后，从上下沿进入
    // （落在 drag 面上）会丢 enter。贴边态全程每 120ms 比对「光标在窗内 ↔
    // 窗口已露出」，不一致就走 reconcile（光标真相裁决）；离开贴边态、展开、
    // 关窗即停。只读光标位置、不逐帧驱动窗口，与轮询跟光标拖窗无关。
    expect(mainSource).toContain('peekLingerTimer = setInterval(');
    expect(mainSource).toContain('ensurePeekLinger();');
    expect(mainSource).toContain('stopPeekLinger();');
    // 探头不借道 dock-applied 切 DOM，也不演壳体过渡。
    expect(appSource).not.toContain('note-shell--dock-peek');
  });

  it('switches the DOM before changing window geometry on dock and expand', () => {
    // 先切 DOM 再改几何：吸附时 overlay 先就位窗口再并集/裁剪，展开时完整便签
    // 先就位窗口再长开——避免「小窗里压扁横条」和「大窗里一枚书签头」两个
    // 空白节拍，持久化（写盘）不再挡 DOM 切换。失败回滚会把 DOM 切回真实状态。
    const dockNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n          dock: { side },"
    );
    const dockCallIndex = mainSource.indexOf('collapseController.commitDocked({');
    expect(dockNotifyIndex).toBeGreaterThan(-1);
    expect(dockNotifyIndex).toBeLessThan(dockCallIndex);
    // 吸附在确认松手后触发 = 拖拽会话已结束（写窗安全）：先预算错开后的
    // 目标 y（resolveDockYForWebContents），落位姿势按光标真相（landedHovered
    // 选 rest/reveal）。可见运动全在 DOM：主进程只在 source-size、union-origin、
    // target-origin、target-size 四个边界写窗；逐帧滑行不许回来。
    expect(mainSource).toContain('resolveDockYForWebContents(noteWebContentsId');
    expect(mainSource).toContain('landedHovered');
    expect(mainSource).toContain('const shrinkFromStrip = {');
    expect(mainSource).toContain('noteWindow.setBounds(union, false);');
    expect(mainSource).not.toContain('NOTE_DOCK_IN_GLIDE_DURATION_MS');
    expect(mainSource).not.toContain('easeOutQuad');
    expect(mainSource).not.toContain('const keepCorner = {');
    // renderer 逆揭示：overlay 纸面演 clip 收缩 + 平移（300ms 同族缓动），
    // 主壳同 commit 隐身；演完回执主进程裁窗。旧的淡变/短滑 morph 不许回来。
    expect(appSource).toContain('startDockShrinkToBookmark');
    expect(appSource).toContain('NOTE_DOCK_SHRINK_MS = 300');
    expect(appSource).toContain('dock-shrink-stub');
    expect(appSource).toContain('note-shell--shrink-hold');
    expect(appSource).toContain('dockShrinkFinished');
    expect(appSource).toContain('waitForViewportSize');
    // 闪/抽接缝：同一枚 DockedNoteShell overlay 在动画结束后只改 phase 和
    // 几何，不换 key、不换 wrapper、不重新挂载另一张皮；裁窗后的第一帧仍由
    // 同一枚节点重钉到 (0,0)。
    const stablePhaseIndex = appSource.indexOf("phase: 'stable' } : previous");
    const shrinkAckIndex = appSource.indexOf(
      'window.stickyNotes.dockShrinkFinished(transitionId);'
    );
    expect(stablePhaseIndex).toBeGreaterThan(-1);
    expect(shrinkAckIndex).toBeGreaterThan(stablePhaseIndex);
    expect(appSource).not.toContain('key="landed"');
    expect(appSource).not.toContain('key="animating"');
    expect(appSource).toContain('noteShellRef={dockShrinkStubRef}');
    expect(appSource).toContain(
      'pinDockShrinkStubToScreenPoint(targetScreenPoint, payload.bookmark)'
    );
    // 窗口交接（2026-09-01）：动画末帧 paint 后直接回 finished，不再有
    // target 原点平移与裁窗两段几何等待（那是落定闪烁的裁窗路径，已拆除）。
    expect(appSource).not.toContain('const targetPositionReady = await waitForWindowGeometry(');
    expect(appSource).not.toContain('const targetViewportReady = await waitForWindowGeometry(');
    // 「变长又变短」抽搓（方案 A 续 2）：DockedNoteShell 是 100% 铺满当前窗口的，
    // 视口还是 union 就 setDock 会把书签头拉满整个 union 再缩回。红线：shrink
    // overlay 还在时绝不走 `if (dock)` 全窗渲染；主进程裁窗后不发裸 {dock}
    // 抢跑切换（macOS setBounds 对 renderer 异步，裸消息到时视口还是 union）
    // ——带 transitionId 的 dock 回滚只允许出现在展开失败路径，主窗都还在
    // 隐藏态，不构成可见 surface 切换。
    expect(appSource).toContain('if (dock && !dockShrink) {');
    const rollbackPortIndex = mainSource.indexOf('sendRollback: () => {');
    expect(rollbackPortIndex).toBeGreaterThan(-1);
    expect(mainSource.slice(rollbackPortIndex, rollbackPortIndex + 260)).toContain(
      'dock: { side },'
    );
    expect(styles).toContain('.note-shell--shrink-hold');
    expect(styles).toContain('.dock-shrink-stub');
    expect(appSource).not.toContain('startDockMorphToBookmark');
    expect(appSource).not.toContain('dock-morph-bookmark');
    expect(styles).not.toContain('dock-morph-bookmark-in');
    expect(styles).not.toContain('note-shell-dock-morph-out');
    expect(mainSource).not.toContain('actual.width !== restBounds.width');

    const expandCheckIndex = mainSource.indexOf(
      'resolveDockedEdgeOffset({ side, current, dockedX: dockedBounds.x })'
    );
    // 窗口交接的展开通知带 transitionId 与 expandFrom（prepare 阶段）。
    const expandNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n          dock: null,\n          transitionId,\n          expandFrom",
      expandCheckIndex
    );
    const undockCallIndex = mainSource.indexOf('undockNoteForWebContents(');
    expect(expandCheckIndex).toBeGreaterThan(dockCallIndex);
    expect(expandNotifyIndex).toBeGreaterThan(expandCheckIndex);
    expect(expandNotifyIndex).toBeLessThan(undockCallIndex);
    // 展开无闸门：过回差带（≥72px）即展开。「拖动早期 stay 帧记到抓取点」
    // 的锁存一旦被意外写窗打破就永远记不上，系统进入「每帧钉回」死锁
    // （真机日志实锤）；show 回拉恰好 48px 落在回差带内不写窗，由 quiet →
    // settle watch（无抓取记录时退化为「光标在窗外才累积停稳拍」）自愈滑回，
    // 不需要 move 上的钉回分支。
    expect(mainSource).not.toContain('cursorOnTab');
    expect(mainSource).not.toContain('nearGrab');
    const expandAfterBand = mainSource.indexOf('NOTE_DOCK_UNFOLD_HYSTERESIS_PX');
    expect(expandNotifyIndex).toBeGreaterThan(expandAfterBand);
    // 无抓取记录的退化：光标在窗内就无法区分「按住不动」和「松手停放」——
    // 不收尾（安全方向）；光标在窗外才累积停稳拍。惰性钉回（drifted 才滑行、
    // 没偏只复核悬停）是删掉钉回闸门后「离边 20px」还能吸回去的兜底。
    expect(mainSource).toContain("'dock_tuck_glide'");
  });

  it('gates the union expansion behind the renderer dock-shrink-ready handshake', () => {
    // ①通道存在：preload expose、类型声明、renderer 调用、主进程监听四处齐
    // 全（照 dockShrinkFinished 家族写法）。
    expect(preloadSource).toContain(
      "ipcRenderer.send('sticky-notes:dock-shrink-ready', transitionId)"
    );
    expect(preloadSource).toContain('dockShrinkReady:');
    expect(globalTypes).toContain('dockShrinkReady: (transitionId: number) => void;');
    expect(appSource).toContain('window.stickyNotes.dockShrinkReady(transitionId);');
    expect(preloadSource).toContain(
      "ipcRenderer.send('sticky-notes:dock-shrink-union-sized', transitionId)"
    );
    expect(globalTypes).toContain('dockShrinkUnionSized: (transitionId: number) => void;');
    expect(appSource).toContain('window.stickyNotes.dockShrinkUnionSized(transitionId);');
    expect(preloadSource).toContain(
      "ipcRenderer.send('sticky-notes:dock-expand-ready', transitionId)"
    );
    expect(globalTypes).toContain('dockExpandReady: (transitionId: number) => void;');
    expect(appSource).toContain('window.stickyNotes.dockExpandReady(transitionId);');
    // 窗口交接架构不再使用裁窗时代的一对回执。
    expect(preloadSource).not.toContain('dock-shrink-target-positioned');
    expect(preloadSource).not.toContain('dock-visual-committed');
    const shrinkNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n          dock: { side },"
    );
    const readyListenerIndex = mainSource.indexOf('const readyPromise = waitForDockRendererAck(');
    const readyAwaitIndex = mainSource.indexOf('const readyResult = await readyPromise;');
    const unionResizeIndex = mainSource.indexOf('noteWindow.setBounds(unionAtSource, false);');
    const unionSizeAckIndex = mainSource.indexOf('const unionSizeResult = await unionSizePromise;');
    const unionBoundsIndex = mainSource.indexOf('noteWindow.setBounds(union, false);');
    expect(shrinkNotifyIndex).toBeGreaterThan(-1);
    expect(readyListenerIndex).toBeGreaterThan(-1);
    expect(unionResizeIndex).toBeGreaterThan(-1);
    expect(unionSizeAckIndex).toBeGreaterThan(unionResizeIndex);
    expect(unionBoundsIndex).toBeGreaterThan(unionSizeAckIndex);
    // ②扩窗时机：主进程必须先注册 waiter、再发逆揭示 payload、再等 ready
    // 回执，收到后才 setBounds(union)。旧的「发消息后立刻
    // 扩窗」无条件复轨——无握手的开场竞态会把靠 100vw 铺满旧视口的 stub 拉
    // 满整个 union = 「变长又变短」。
    expect(readyListenerIndex).toBeLessThan(shrinkNotifyIndex);
    expect(shrinkNotifyIndex).toBeLessThan(readyAwaitIndex);
    expect(readyAwaitIndex).toBeLessThan(unionResizeIndex);
    const readySegment = mainSource.slice(shrinkNotifyIndex, unionResizeIndex);
    expect(ackSource).toContain("export type DockRendererAck = 'received' | 'timeout' | 'aborted';");
    expect(readySegment).toContain('const readyResult = await readyPromise;');
    expect(readySegment).not.toContain('noteWindow.setResizable(false);');
    // 等待期挂 epoch 抢拖熔断（50ms 轮询）与超时兑底（丢回执不卡死吸附）。
    expect(ackSource).toContain(
      'incomingChannel !== channel || incomingId !== transitionId'
    );
    expect(ackSource).toContain("finish('aborted')");
    expect(ackSource).toContain("finish('timeout'), timeoutMs");
    // ③renderer 侧：握手发出前 stub 已同步提交、按旧视口不变边缘锚定，并
    // 真实经过一次 paint。flushSync 只保证 DOM commit，不保证 WindowServer
    // 已看到这一帧；双 rAF barrier 必须位于钉位与 ready ACK 之间。
    const shrinkStartIndex = appSource.indexOf('const startDockShrinkToBookmark');
    const stubPinIndex = appSource.indexOf(
      'pinDockShrinkSourceToViewportEdge(',
      shrinkStartIndex
    );
    const flushSyncIndex = appSource.indexOf('flushSync(() => {', shrinkStartIndex);
    const readySendIndex = appSource.indexOf(
      'window.stickyNotes.dockShrinkReady(transitionId);',
      shrinkStartIndex
    );
    const firstPaintIndex = appSource.indexOf('await waitForNextPaint();', stubPinIndex);
    expect(shrinkStartIndex).toBeGreaterThan(-1);
    expect(flushSyncIndex).toBeGreaterThan(-1);
    expect(stubPinIndex).toBeGreaterThan(flushSyncIndex);
    expect(firstPaintIndex).toBeGreaterThan(stubPinIndex);
    expect(readySendIndex).toBeGreaterThan(firstPaintIndex);
    // 原生 setBounds 在 macOS 上不是视觉原子操作：renderer 会先看到 viewport
    // 尺寸，下一帧 screenX/screenY 才追上 WindowServer 原点。overlay 必须每帧
    // 用全局目标点减当前 screenX/screenY 重钉，不能再靠 left/right CSS 猜顺序。
    expect(appSource).toContain('screenPoint.x - window.screenX');
    expect(appSource).toContain('screenPoint.y - window.screenY');
    expect(appSource).toContain('const sourceScreenPoint = { x: window.screenX, y: window.screenY };');
    expect(appSource).toContain('const unionScreenPoint = {');
    expect(appSource).toContain('const targetScreenPoint = {');
    // union 视口的全局原点不是 source 原点：左贴边或纵向错开时两者会不同。
    // 等错原点会在 500ms 后回滚，表现为动画末尾突然抽回横条。
    const shrinkEndIndex = appSource.indexOf('\n  useEffect(() => {', shrinkStartIndex);
    const shrinkSource = appSource.slice(shrinkStartIndex, shrinkEndIndex);
    expect(shrinkSource).toMatch(
      /waitForWindowGeometry\(\s*payload\.unionWidth,\s*payload\.unionHeight,\s*sourceScreenPoint,/
    );
    expect(shrinkSource).toMatch(
      /waitForWindowGeometry\(\s*payload\.unionWidth,\s*payload\.unionHeight,\s*unionScreenPoint,/
    );
    expect(appSource).not.toContain('extendsLeft');
    expect(appSource).not.toContain('extendsUp');
    expect(appSource).toContain('stub.style.width = `${payload.strip.width}px`;');
    expect(appSource).toContain('stub.style.height = `${payload.strip.height}px`;');
    expect(mainSource).toContain('const unionAtSource = {');
    // 窗口交接：不再有 unionAtTarget（原点平移 + 裁窗的裁窗口径已拆除）。
    expect(mainSource).not.toContain('const unionAtTarget = {');
  });

  it('treats dock shrink as a painted, fail-closed transaction', () => {
    const shrinkStartIndex = appSource.indexOf('const startDockShrinkToBookmark');
    const shrinkEndIndex = appSource.indexOf('\n  useEffect(() => {', shrinkStartIndex);
    const shrinkSource = appSource.slice(shrinkStartIndex, shrinkEndIndex);

    // renderer 只有尺寸真实命中才继续；timeout 返回 false，不再冒充成功。
    expect(appSource).toContain('): Promise<boolean> {');
    expect(appSource).toContain('fallbackTimer = setTimeout(() => finish(false)');
    expect(appSource).toContain('finish(true);');
    expect(shrinkSource).toContain('const unionSizeReady = await waitForWindowGeometry(');
    expect(shrinkSource).toContain('if (!unionSizeReady) {');
    expect(shrinkSource).toContain('const unionPositionReady = await waitForWindowGeometry(');
    expect(shrinkSource).toContain('if (!unionPositionReady) {');
    // 裁窗时代的两段几何等待（target 原点平移、最终裁窗）已随窗口交接拆除。
    expect(shrinkSource).not.toContain('const targetPositionReady = await waitForWindowGeometry(');
    expect(shrinkSource).not.toContain('if (!targetPositionReady) {');
    expect(shrinkSource).not.toContain('const targetViewportReady = await waitForWindowGeometry(');
    expect(shrinkSource).not.toContain('if (!targetViewportReady) {');
    expect(shrinkSource).toContain('transaction.animation = animation;');
    const animationCreateIndex = shrinkSource.indexOf('const animation = stub.animate(');
    const animationStoreIndex = shrinkSource.indexOf(
      'transaction.animation = animation;',
      animationCreateIndex
    );
    const animationAwaitIndex = shrinkSource.indexOf(
      'await animation.finished;',
      animationCreateIndex
    );
    // 落地重叠交接：动画结束后先把末帧静态替身挂上并等它上屏，才允许 cancel；
    // 稳定壳上屏后才撤替身、发 finished ACK。2026-08-31 两次真机录屏实锤：
    // commitStyles + cancel + 双 rAF 仍会在拆动画层那拍露一帧空 surface，
    // 所以收尾不再依赖 commitStyles/cancel 时序，改由像素一致的替身兜底。
    const landingMountIndex = shrinkSource.indexOf(
      'setDockShrinkLanding(true);',
      animationAwaitIndex
    );
    const landingPaintIndex = shrinkSource.indexOf('await waitForNextPaint();', landingMountIndex);
    const animationCancelIndex = shrinkSource.indexOf('animation.cancel();', landingPaintIndex);
    expect(animationStoreIndex).toBeGreaterThan(animationCreateIndex);
    expect(animationStoreIndex).toBeLessThan(animationAwaitIndex);
    expect(landingMountIndex).toBeGreaterThan(animationAwaitIndex);
    expect(landingPaintIndex).toBeGreaterThan(landingMountIndex);
    expect(animationCancelIndex).toBeGreaterThan(landingPaintIndex);
    expect(shrinkSource).not.toContain('animation.commitStyles()');
    expect(shrinkSource).toContain('landing.style.transform = `translate(${dx}px, ${dy}px)`;');
    expect(shrinkSource).toContain('landing.style.clipPath = clipTo;');
    // 跨进程边界都以 paint 为准：source、union size、union origin、landing、
    // stable。WindowServer 的 move/resize 不能被当作一笔视觉原子提交。
    expect(shrinkSource.split('await waitForNextPaint();').length - 1).toBeGreaterThanOrEqual(5);
    const stableIndex = shrinkSource.indexOf("phase: 'stable'");
    const finishedAckIndex = shrinkSource.indexOf(
      'window.stickyNotes.dockShrinkFinished(transitionId);'
    );
    const stablePaintIndex = shrinkSource.indexOf('await waitForNextPaint();', stableIndex);
    expect(stableIndex).toBeGreaterThan(-1);
    expect(stablePaintIndex).toBeGreaterThan(stableIndex);
    expect(stablePaintIndex).toBeLessThan(finishedAckIndex);
    // 落地替身只在稳定壳上屏之后、finished ACK 之前撤掉。
    const landingUnmountIndex = shrinkSource.indexOf('setDockShrinkLanding(false);', stableIndex);
    expect(landingUnmountIndex).toBeGreaterThan(stablePaintIndex);
    expect(landingUnmountIndex).toBeLessThan(finishedAckIndex);
    // 窗口交接：finished ACK 之前切到 visual-committed 相位（等 committed 提交），
    // 之后 renderer 不再有任何几何等待——裁窗时代的 target 平移/裁窗回执已拆除。
    const committedPhaseIndex = shrinkSource.indexOf("transaction.phase = 'visual-committed';");
    expect(committedPhaseIndex).toBeGreaterThan(-1);
    expect(committedPhaseIndex).toBeLessThan(finishedAckIndex);
    expect(shrinkSource).not.toContain('window.stickyNotes.dockVisualCommitted');
    // visual ACK 时仍由已经 paint 的真书签头 overlay 覆盖；主进程应在同一
    // turn 同步提交 controller/renderer，再通过现有 bounds 通道异步保存。
    // 可交互的 96×32 窗口不能继续以 collapsed 身份等待磁盘，否则重新抓取会
    // 让旧事务的回滚污染下一次吸附。
    expect(shrinkSource).not.toContain('setDock({ side });');
    expect(preloadSource).toContain('committed?: boolean;');
    expect(globalTypes).toContain('committed?: boolean;');
    expect(mainSource).toContain('committed: true');
    expect(mainSource).toContain('collapseController.commitDocked({');
    expect(mainSource).not.toContain('.commitDockNoteForWebContents(');
    const controllerCommitIndex = mainSource.indexOf('collapseController.commitDocked({');
    const committedNotifyIndex = mainSource.indexOf('committed: true', controllerCommitIndex);
    const persistScheduleIndex = mainSource.indexOf('saveBounds.schedule(undefined);', controllerCommitIndex);
    expect(committedNotifyIndex).toBeGreaterThan(controllerCommitIndex);
    expect(persistScheduleIndex).toBeGreaterThan(controllerCommitIndex);

    // shrink ACK 包含最多 500ms 的几何等待、300ms 动画与两次 paint barrier；
    // 600ms 会把合法路径误判成 timeout。这个阶段必须使用独立的更长预算。
    expect(mainSource).toContain('const NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS = 1_200;');
    expect(mainSource).toMatch(
      /'sticky-notes:dock-shrink-finished',[\s\S]*?transitionId,[\s\S]*?epoch,[\s\S]*?NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS/
    );

    // 事务开始保持 collapsed + dock:null；重复 start 不重入，迟到 abort 不得
    // 清掉已提交的书签头。逻辑 dock 只在最终画面 paint 后提交。
    expect(appSource).toContain('activeDockShrinkTransactionRef');
    expect(appSource).toContain('activeDockShrink?.id === payload.transitionId');
    expect(appSource).toContain('dockRef.current = { side };');
    expect(appSource).toContain('setIsCollapsed(true);');
    expect(appSource).toContain('setShouldRenderContent(false);');

    // main 的 ACK 只有 received 能前进；timeout、abort、catch 都走同一个
    // 横条恢复入口。真实按下时只登记 pending，不能和原生拖拽争写窗口。
    expect(expandTransactionSource).toContain("if (ready !== 'received' || !port.isEpochCurrent()) {");
    expect(mainSource).toContain("if (unionSizeResult !== 'received') {");
    expect(mainSource).toContain("if (shrinkResult !== 'received') {");
    // 窗口交接：裁窗时代的 targetPosition/visualCommit 两道 ACK 已拆除；
    // 书签头窗 ready 与展开 prepare 失败同样 fail-closed。
    expect(mainSource).not.toContain("if (targetPositionResult !== 'received') {");
    expect(mainSource).not.toContain("if (visualCommitResult !== 'received') {");
    expect(mainSource).toContain('if (!tabReady || tab.isDestroyed() || epoch !== transitionEpoch) {');
    expect(expandTransactionSource).toContain("if (!port.isEpochCurrent()) {");
    const unionResizeIndex = mainSource.indexOf('noteWindow.setBounds(unionAtSource, false);');
    const unionMoveIndex = mainSource.indexOf('noteWindow.setBounds(union, false);');
    // 交接顺序：union 移动（动画在其上播放）→ 书签头窗上屏 → 主窗隐藏 → 提交。
    // 注意从 unionMoveIndex 之后找：启动恢复路径更早处也有一次 showInactive。
    const tabShowIndex = mainSource.indexOf('tab.showInactive();', unionMoveIndex);
    const mainHideIndex = mainSource.indexOf('noteWindow.hide();', tabShowIndex);
    const commitIndex = mainSource.indexOf('collapseController.commitDocked({', mainHideIndex);
    expect(unionResizeIndex).toBeGreaterThan(-1);
    expect(unionMoveIndex).toBeGreaterThan(unionResizeIndex);
    expect(tabShowIndex).toBeGreaterThan(unionMoveIndex);
    expect(mainHideIndex).toBeGreaterThan(tabShowIndex);
    expect(commitIndex).toBeGreaterThan(mainHideIndex);
    const finalizeStartIndex = mainSource.indexOf('const finalizeDockOnRelease = (): void => {');
    const finalizeEndIndex = mainSource.indexOf(
      'const settleDockedIdle = (): void => {',
      finalizeStartIndex
    );
    const finalizeSource = mainSource.slice(finalizeStartIndex, finalizeEndIndex);
    // 吸附事务只剩 union 两刀（生长 + 移原点）；裁窗与原点平移已拆除。
    expect(finalizeSource.match(/noteWindow\.setBounds\(/g) ?? []).toHaveLength(2);
    expect(mainSource).toContain('abortDockTransition({');
    expect(mainSource).toContain('mouseButtonMonitor?.isDown() === true');
    expect(mainSource).toContain('collapseController.restoreCollapsed(sourceBounds);');
    expect(mainSource).toContain("diagnosticLogger?.record('dock_transition_stage'");
    // 抢拖可能持续超过 viewport waiter 的 500ms。主进程松手恢复横条后发来的
    // 普通 dock:null 必须重新武装 aborted cleanup，不能把 overlay 永久留住。
    expect(appSource).toContain('abortDockShrinkTransaction(activeDockShrink);');
    // 旧事务的 rAF waiter 只能重钉自己的 overlay；新事务复用 ref 后，迟到回调
    // 不得把它拉回旧坐标。
    expect(shrinkSource).toMatch(
      /\(\) => \{\s*if \(!isActiveDockShrinkTransaction\(transaction\)\) \{\s*return;\s*\}\s*pinDockShrinkStubToScreenPoint\(sourceScreenPoint, payload\.strip\);\s*\}/
    );
    // 稳定落位后 overlay 直接钉在 target 全局点（窗口交接：钉点之后不再有
    // 几何等待，书签头窗同像素上屏接管）。
    expect(shrinkSource).toContain('pinDockShrinkStubToScreenPoint(targetScreenPoint, payload.bookmark);');
  });

  it('keeps the final bookmark and shrink paper free of native outlines', () => {
    expect(styles).toMatch(
      /\.note-shell--docked\s*{[^}]*border:\s*none;[^}]*box-shadow:\s*inset 0 0 0 1px rgba\(43, 42, 39, 0\.1\);/s
    );
    expect(styles).toMatch(
      /\.dock-shrink-stub\s*{[^}]*border:\s*none;[^}]*box-shadow:\s*none;/s
    );
    // 内描边与 pointer-events 解耦：--interactive 只管事件；shadow 只在
    // 裁窗 ACK 之后（settled）或 abort 回退时由 --stroked 补回，不参与
    // union 平移与 416×40 → 96×32 裁窗的 surface 重算（crop 期挂 inset
    // shadow 会让透明窗重算轮廓、原地闪一帧）。
    expect(styles).toMatch(/\.dock-shrink-stub--interactive\s*{[^}]*pointer-events:\s*auto;/s);
    expect(styles).not.toMatch(/\.dock-shrink-stub--interactive\s*{[^}]*box-shadow/s);
    expect(styles).toMatch(
      /\.dock-shrink-stub--stroked\s*{[^}]*box-shadow:\s*inset 0 0 0 1px rgba\(43, 42, 39, 0\.1\);/s
    );
    expect(appSource).toContain("? ' dock-shrink-stub--stroked'");
    expect(appSource).toContain("phase: 'settled'");

    // Electron 的 native shadow 是窗口级配置；运行时切换会在透明窗 resize/move
    // 时重新计算黑色轮廓。所有状态沿用建窗时的单一配置。
    expect(mainSource).not.toContain('setHasShadow(');
  });

  it('renders the first frame as a sliver for restored docked notes', () => {
    // 主进程按持久化 dock 建 96×32 书签头窗口时把 side 写进 URL query；preload 同步
    // 读取，renderer 的 dock 初始 state 在 getCurrentNote resolve 之前就是
    // 贴边态——首帧 DOM 就是书签头，不会先挂完整便签再切。
    expect(mainSource).toContain('?dock=${initialDockSide}');
    expect(mainSource).toContain('query: { dock: initialDockSide }');
    expect(preloadSource).toContain('getInitialDockSide');
    expect(preloadSource).toContain('URLSearchParams(window.location.search)');
    expect(globalTypes).toContain("getInitialDockSide: () => 'left' | 'right' | null;");
    expect(appSource).toMatch(
      /useState<\{ side: DockSide \} \| null>\(\(\) => \{[\s\S]*?window\.stickyNotes\.getInitialDockSide\(\)/
    );
  });

  it('keeps dock geometry changes free of shell size transitions', () => {
    // 磁吸直接改窗口几何，进出贴边不演 240ms 壳体过渡：dock 相关的过渡态
    // class 与 CSS 块都不允许回来（基础态挂尺寸过渡的红线不变）。
    expect(styles).not.toContain('note-shell--dock-transitioning');
    expect(styles).not.toContain('note-shell--dock-shrinking');
    expect(styles).not.toContain('note-shell--undock-grow');
    expect(appSource).not.toContain('note-shell--dock-transitioning');
    expect(appSource).not.toContain('note-shell--dock-shrinking');
    expect(appSource).not.toContain('note-shell--undock-grow');
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*width/s);
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*height/s);
  });

  it('keeps a failed dock expansion at its release point until a new drag', () => {
    expect(mainSource).toContain('const handleDockTabMove = createDockWindowMoveHandler(');
    expect(mainSource).toContain('tab.on(\'move\', handleDockTabMove);');
    expect(mainSource).toContain('dockWindowMoveHandlerReady = true;');
    expect(mainSource).toContain('dockExpandFailureHold = true;');
    expect(expandTransactionSource).toContain("port.recordStage('rollback'");
    expect(mainSource).toContain("recordDockExpandStage(expandContext, 'prepare-ack-late'");
    expect(mainSource).toContain(
      'if (isMagneticTransitionInFlight || dockExpandFailureHold || noteWindow.isDestroyed())'
    );
    expect(mainSource).toContain(
      "if (dockExpandFailureHold) {\n        // Failed prepare/undock stays at the release point."
    );
    expect(mainSource).toContain('dockExpandFailureHold = false;');
    expect(mainSource).toContain('transitionId,\n      side,\n      sourceBounds: sliverBounds');
  });

  it('folds toolbar buttons into the toggle with a right-to-left cascade on collapse', () => {
    // Buttons anchor at the fixed right edge so the fold yields space without sliding.
    expect(styles).toMatch(/\.toolbar\s*{[^}]*justify-content:\s*flex-end;/s);
    // Each button drifts toward the toggle while fading; there is no uniform block fade.
    expect(styles).toMatch(
      /\.note-shell--collapsed \.toolbar button\s*{[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(8px\);/s
    );
    expect(styles).not.toMatch(/\.note-shell--collapsed \.toolbar-wrap\s*{[^}]*opacity:\s*0;/s);
    // The stagger runs from the toggle outward: the rightmost button leaves first.
    expect(styles).toMatch(
      /\.note-shell--collapsed \.toolbar button:nth-last-child\(1\)\s*{[^}]*transition-delay:\s*0ms;/s
    );
    expect(styles).toMatch(
      /\.note-shell--collapsed \.toolbar button:nth-last-child\(4\)\s*{[^}]*transition-delay:\s*66ms;/s
    );
    // The width fold trails the cascade and only sweeps what is already faded.
    expect(styles).toMatch(
      /\.note-shell--collapsed \.toolbar-wrap\s*{[^}]*transition:\s*grid-template-columns 220ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\) 50ms;/s
    );
    // Expansion is untouched: the wrap still reveals with its original delayed fade.
    expect(styles).toMatch(
      /\.toolbar-wrap\s*{[^}]*transition:\s*grid-template-columns 240ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\) 60ms,\s*opacity 150ms ease 60ms;/s
    );
    // Reduced motion collapses the cascade as well.
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.toolbar button,/s
    );
  });
});
