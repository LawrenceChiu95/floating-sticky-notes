import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
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
  });

  it('restores the shared content scroll position after the expanded viewport returns', () => {
    const captureIndex = appSource.indexOf(
      'collapsedScrollTopRef.current = noteContentRef.current?.scrollTop ?? 0;'
    );
    const viewportWaitIndex = appSource.indexOf('await waitForExpandedViewport();');
    const restoreIndex = appSource.indexOf('noteContentRef.current.scrollTop = scrollTop;');
    const clearIndex = appSource.indexOf('collapsedScrollTopRef.current = undefined;');

    expect(appSource).toContain('ref={noteContentRef}');
    expect(captureIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(appSource.indexOf('setIsCollapseTransitioning(true);'));
    expect(restoreIndex).toBeGreaterThan(viewportWaitIndex);
    expect(clearIndex).toBeGreaterThan(restoreIndex);
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
    // settle watch：move 停歇 100ms 启动，60ms 一拍，连续 3 拍「bounds 没变 +
    // 光标位移 <3px + 光标不在抓取点上」才收尾。live 信号是光标不是 bounds：
    // getBounds 在 move 事件被 macOS 合并的间隙里是冻住的（真机日志：快速
    // 甩动间隙 >220ms，「两拍 bounds 静止」在活拖拽中也成立——bounds 判据
    // 已被真机证伪）；活拖拽中光标不可能连续静止。「光标在抓取点上且静止」
    // = 按住不动，绝不写窗（松手后手停抓取点 = 软失败，下次动鼠标才收尾）。
    expect(mainSource).toContain('NOTE_DOCK_DRAG_QUIET_MS = 100');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_POLL_MS = 60');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_TICKS = 3');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_CURSOR_STILL_PX = 3');
    expect(mainSource).toContain('NOTE_DOCK_SETTLE_GRAB_PX = 24');
    expect(mainSource).toContain("armSettleWatch('dock', { ignoreCursor: fromRelease })");
    expect(mainSource).toContain("armSettleWatch('docked', { ignoreCursor: fromRelease })");
    // bounds 动了 = 拖拽活着，整个比对作废；光标在飞或在抓取点上 = 重新累积。
    expect(mainSource).toContain('if (boundsMoved) {');
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
    expect(mainSource).toContain('pendingStripRestore ??= current');
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
    // 沿边上下拖的手抖回差：x 偏移 48~72px 且光标仍贴抓取点 = 竖拖带出的
    // 横向抖动，不展开（松手后照常滑回钉边）。
    expect(mainSource).toContain('NOTE_DOCK_UNFOLD_HYSTERESIS_PX');
    // 收尾事件的诊断桩：真机再抽搐时日志能指认是哪条写窗链。
    expect(mainSource).toContain("'dock_settle_fire'");
    // 吸附调用点在 release 收尾函数里，不许回到 move 流上：move 处理器声明
    // 之前必须已经出现 dockNoteForWebContents（finalize 定义在 move 之前）。
    const dockCallIndex = mainSource.indexOf('dockNoteForWebContents(noteWebContentsId');
    const moveHandlerIndex = mainSource.indexOf("noteWindow.on('move'");
    const finalizeDockIndex = mainSource.indexOf('const finalizeDockOnRelease');
    expect(finalizeDockIndex).toBeGreaterThan(-1);
    expect(dockCallIndex).toBeGreaterThan(finalizeDockIndex);
    expect(dockCallIndex).toBeLessThan(moveHandlerIndex);
    // slide 钉边只剩一个合法调用点：settle watch 确认光标停稳后的惰性钉回。
    // move 流上的钉回（pinback_immediate 那类「系统动窗」闸门）被真机实锤会
    // 进死锁（拖出 200~400px 仍被反复钉回 = 完全拖不出来），不许回来。
    expect(mainSource.split("kind: 'slide'").length - 1).toBe(1);
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
    // 揭示的时序红线：原生窗口长开的 1~2 帧里主壳必须隐身（opacity 0，仍可
    // 命中拖动——visibility:hidden 不可命中会杀掉 app-region），视觉由钉在
    // expandFrom 的占位书签头 overlay 顶住；clip 写进 style 后与恢复可见同一
    // commit（不再 await 下一次 paint——等的那拍就是用户看到的纸面闪现）。
    expect(appSource).toContain('note-shell--expand-hold');
    expect(appSource).toContain('dock-expand-bookmark');
    expect(appSource).toContain('setDockExpandHold(from);');
    expect(appSource).toContain("shell.style.willChange = 'clip-path';");
    expect(styles).toContain('.note-shell--expand-hold');
    expect(styles).toContain('.dock-expand-bookmark');
    const revealClipIndex = appSource.indexOf('shell.style.clipPath = fromClip;');
    expect(revealClipIndex).toBeGreaterThan(-1);
    expect(appSource.indexOf('setDockExpandHold(null);', revealClipIndex)).toBeGreaterThan(
      revealClipIndex
    );
    // 大透明窗长开的一帧要分配 backing store + 重算阴影（掉帧感来源）：展开前
    // 关阴影、揭示动画结束后恢复。
    expect(mainSource).toContain('noteWindow.setHasShadow(false);');
    expect(mainSource).toContain('noteWindow.setHasShadow(true);');
    // 吸附滑行同款：横条比 peek 的 96×32 大得多，逐帧平移 + 逐帧阴影重算仍会
    // 爬（peek 不爬、吸附爬的差价）——滑行前关阴影，commit/熔断/回滚统一在
    // finally 恢复默认态。钉回 tuck（dock_tuck_glide）是 96×32 小窗，不许跟风。
    const dockGlideLogIndex = mainSource.indexOf("'dock_in_glide'");
    const dockShadowOffIndex = mainSource.indexOf(
      'noteWindow.setHasShadow(false);',
      dockGlideLogIndex
    );
    const dockGlideCallIndex = mainSource.indexOf('await glideNoteWindowTo(', dockGlideLogIndex);
    expect(dockGlideLogIndex).toBeGreaterThan(-1);
    expect(dockShadowOffIndex).toBeGreaterThan(dockGlideLogIndex);
    expect(dockShadowOffIndex).toBeLessThan(dockGlideCallIndex);
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
    // （那是自定义拖窗时代的残留）；贴边书签头的拖动面是内嵌 5px 的透明 pill，
    // 永久 drag——外壳留一圈 no-drag 传感环，enter/leave 在应用非激活时也照收
    // （leave 实验 6/6 双向送达），不需要任何运行时翻转。
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
  });

  it('renders the docked state as a bookmark tab without note chrome', () => {
    expect(appSource).toContain('note-shell--docked');
    // 环 + 芯：壳永久 no-drag，承载视觉并充当悬停传感环（drag 区在应用非激活
    // 时收不到 OS 的 enter/leave，no-drag 面双向照收）；内嵌 5px 的透明 pill
    // 是永久 drag 的拖动面，休息半藏时也能直接抓取拖出。
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).toMatch(/\.dock-tab-pill\s*{[^}]*position:\s*absolute;[^}]*inset:\s*5px;/s);
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
    expect(appSource).toContain('dock-tab-name');
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
    // 相邻显示器上（跨屏拖动）不吸。路过、靠近不再误吸。
    expect(mainSource).toContain('resolveCollapsedDockSide(\n        current,\n        workArea,');
    expect(mainSource).toContain('neighborWorkAreas');
  });

  it('reveals the full tab on hover and slides it back half-hidden, geometry only', () => {
    // 悬停探头：书签头静止半藏；mouseenter/leave 只是扳机，主进程一次性查
    // 光标判定真实悬停（红线是轮询跟光标，单次查询合法），悬上滑行露整条、
    // 移开滑回半藏。藏与露只是几何，不搬 DOM。扳机挂在 no-drag 壳上：drag 区
    // 在应用非激活时收不到 OS 的 enter/leave，no-drag 传感环双向照收。
    expect(preloadSource).toContain("ipcRenderer.send('sticky-notes:dock-peek'");
    expect(globalTypes).toContain('dockPeekHover: (hovered: boolean) => void;');
    expect(appSource).toContain('window.stickyNotes.dockPeekHover(true)');
    expect(appSource).toContain('onMouseLeave={() => window.stickyNotes.dockPeekHover(false)}');
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
    expect(mainSource).toContain('await glideNoteWindowTo(noteWindow, target, () => glide.aborted)');
    // leave 兜底：应用非激活时 OS 的 mouseleave 不是 100% 可靠（快速甩出、贴
    // 屏边滑走会丢），丢了就卡死在露出。露出期间每 120ms 用一次性光标查询复核
    // 「光标还在不在窗内」，不在就走与 leave 相同的收缩路径；缩回/展开/拖出/
    // 关窗即停。只读光标位置、不逐帧驱动窗口，与轮询跟光标拖窗无关。
    expect(mainSource).toContain('peekLingerTimer = setInterval(');
    expect(mainSource).toContain('ensurePeekLinger();');
    expect(mainSource).toContain('stopPeekLinger();');
    // 探头不借道 dock-applied 切 DOM，也不演壳体过渡。
    expect(appSource).not.toContain('note-shell--dock-peek');
  });

  it('switches the DOM before changing window geometry on dock and expand', () => {
    // 先切 DOM 再改几何：吸附时书签头先就位窗口再贴边，展开时完整便签
    // 先就位窗口再长开——避免「小窗里压扁横条」和「大窗里一枚书签头」两个
    // 空白节拍，持久化（写盘）不再挡 DOM 切换。失败回滚会把 DOM 切回真实状态。
    const dockNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n          dock: { side },\n          morphFromStrip: {"
    );
    const dockCallIndex = mainSource.indexOf('dockNoteForWebContents(noteWebContentsId');
    expect(dockNotifyIndex).toBeGreaterThan(-1);
    expect(dockNotifyIndex).toBeLessThan(dockCallIndex);
    // 吸附在确认松手后触发 = 拖拽会话已结束（写窗安全）：先预算错开后的
    // 目标 y（resolveDockYForWebContents），窗口保持横条尺寸纯平移滑到
    // 「书签头角与贴边矩形对齐」的位置（逐帧 resize 会逼 renderer 逐帧重排 +
    // macOS 逐帧重算阴影 = 抽动根因，不许回来），DOM 交叉淡变（书签头钉在
    // 保留角），到位后由 setDocked 一次性裁剪（视觉隐形）。
    expect(mainSource).toContain('resolveDockYForWebContents(noteWebContentsId');
    expect(mainSource).toContain('NOTE_DOCK_IN_GLIDE_DURATION_MS = 320');
    expect(mainSource).toContain('morphFromStrip: { width: target.width, height: target.height }');
    expect(mainSource).toContain('const glideTarget = {');
    expect(mainSource).not.toContain('y: stackedY, width: target.width');
    // renderer 交叉淡变与主进程滑行同拍：morph 叠加层 + 壳体淡出 class。
    expect(appSource).toContain('startDockMorphToBookmark');
    expect(appSource).toContain('NOTE_DOCK_MORPH_MS = 320');
    expect(appSource).toContain('dock-morph-bookmark');
    expect(appSource).toContain('note-shell--dock-morphing');
    expect(styles).toContain('@keyframes dock-morph-bookmark-in');
    expect(mainSource).not.toContain('actual.width !== restBounds.width');

    const expandCheckIndex = mainSource.indexOf(
      'resolveDockedEdgeOffset({ side, current, dockedX: dockedBounds.x })'
    );
    const expandNotifyIndex = mainSource.indexOf(
      "noteWindow.webContents.send('sticky-notes:dock-applied', {\n      dock: null,\n      expandFrom:",
      expandCheckIndex
    );
    const undockCallIndex = mainSource.indexOf('undockNoteForWebContents(noteWebContentsId');
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
      /useState<\{ side: 'left' \| 'right' \} \| null>\(\(\) => \{[\s\S]*?window\.stickyNotes\.getInitialDockSide\(\)/
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
