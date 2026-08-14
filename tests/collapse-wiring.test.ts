import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const collapseControllerSource = readFileSync(
  resolve(__dirname, '../main/note-window-collapse.ts'),
  'utf8'
);
const dragSessionSource = readFileSync(
  resolve(__dirname, '../main/note-window-drag.ts'),
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
    const viewportWaitIndex = appSource.indexOf('await waitForExpandedViewport();');
    const revealExpandedIndex = appSource.indexOf('setIsCollapsed(false);');

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

  it('exposes the dock offers and accept commands through preload', () => {
    expect(preloadSource).toContain("ipcRenderer.on('sticky-notes:dock-offer'");
    expect(preloadSource).toContain("ipcRenderer.on('sticky-notes:undock-offer'");
    expect(preloadSource).toContain("ipcRenderer.invoke('sticky-notes:accept-dock', epoch)");
    expect(preloadSource).toContain("ipcRenderer.invoke('sticky-notes:accept-undock', epoch)");
    expect(globalTypes).toContain('onDockOffer:');
    expect(globalTypes).toContain('onUndockOffer:');
    expect(globalTypes).toContain('acceptDock: (epoch: number) => Promise<boolean>;');
    expect(globalTypes).toContain('acceptUndock: (epoch: number) => Promise<boolean>;');
  });

  it('decides docking only when the renderer reports a finished pointer drag', () => {
    // macOS 的 moved 是 move 的别名，没有任何「拖动结束」窗口事件；收起/贴边态
    // 不走 app-region，由 renderer 指针拖动 + 增量 IPC 移窗，主进程只在
    // drag-end（pointerup/pointercancel）上判定贴边/拖出/弹回。
    expect(mainSource).toContain("ipcMain.handle('sticky-notes:drag-note-window'");
    expect(mainSource).toContain("ipcMain.handle('sticky-notes:finish-note-window-drag'");
    expect(mainSource).not.toContain("noteWindow.on('will-move'");
    expect(mainSource).not.toContain("noteWindow.on('moved'");
    expect(mainSource).not.toContain('scheduleDockDragFinish');
    expect(preloadSource).toContain("ipcRenderer.invoke('sticky-notes:drag-note-window'");
    expect(preloadSource).toContain("ipcRenderer.invoke('sticky-notes:finish-note-window-drag'");
    expect(appSource).toContain('setPointerCapture');
    expect(appSource).toContain('onPointerUp');
    expect(mainSource).toContain('resolveCollapsedDockSide');
    expect(mainSource).toContain("'sticky-notes:dock-offer'");
    expect(mainSource).toContain("'sticky-notes:undock-offer'");
  });

  it('scopes dock offers to an epoch so stale accepts are rejected', () => {
    // accept 只回传 epoch；主进程用会话里存的 offer 参数，重新拖动即刻作废旧
    // offer（epoch 对不上即拒绝），renderer 传的矩形不参与判定。
    expect(mainSource).toContain('acceptDockOffer(');
    expect(mainSource).toContain('acceptUndockOffer(');
    expect(dragSessionSource).toContain('pendingOffer = undefined;');
    expect(dragSessionSource).toContain('offerEpoch += 1;');
    expect(globalTypes).toContain('epoch: number;');
  });

  it('keeps manual drag surfaces off the native app-region in collapsed and docked states', () => {
    // 收起横条与贴边缝由 renderer 指针拖动；app-region drag 会与指针拖动重复
    // 触发（原生拖窗 + IPC 移窗），必须显式 no-drag。展开态横条仍是原生拖动。
    expect(styles).toMatch(
      /\.note-shell--collapsed \.drag-bar\s*{[^}]*-webkit-app-region:\s*no-drag;/s
    );
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(/\.drag-bar\s*{[^}]*-webkit-app-region:\s*drag;/s);
  });

  it('restores persisted docks as sliver-sized windows', () => {
    expect(mainSource).toContain('restoreDockedBounds');
    expect(mainSource).toContain('applyRestoredDock');
  });

  it('renders the docked state as a draggable colored sliver without note chrome', () => {
    expect(appSource).toContain('note-shell--docked');
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*no-drag;/s);
    expect(styles).toMatch(
      /\.note-shell--docked,\s*\.note-shell--dock-shrinking,\s*\.note-shell--undock-grow\s*{[^}]*width:\s*var\(--note-dock-width\);[^}]*height:\s*var\(--note-dock-height\);/s
    );
    expect(appSource).toContain("'--note-dock-width': `${NOTE_DOCK_WIDTH}px`");
    expect(appSource).toContain("'--note-dock-height': `${NOTE_DOCK_HEIGHT}px`");
    // 缝的拖动是 renderer 指针拖动（setPointerCapture + screenX 增量），松手才判定。
    expect(appSource).toContain('onPointerDown={handleNoteWindowDragPointerDown}');
  });

  it('scopes dock size transitions to the dock transitioning state', () => {
    expect(styles).toMatch(
      /\.note-shell--dock-transitioning\s*{[^}]*transition:\s*width 240ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\),\s*height 240ms cubic-bezier\(0\.33, 0\.75, 0\.35, 1\)/s
    );
    // 基础态禁止挂 width/height 过渡（与收起同一红线）。
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*width/s);
    expect(styles).not.toMatch(/\.note-shell\s*{[^}]*transition:[^;}]*height/s);
  });

  it('shrinks the bar visually before confirming native dock bounds', () => {
    const shrinkIndex = appSource.indexOf('setIsDockShrinking(true);');
    const shrinkWaitIndex = appSource.indexOf('await dockVisualTransition;');
    const acceptDockIndex = appSource.indexOf('window.stickyNotes.acceptDock(');

    expect(shrinkIndex).toBeGreaterThan(-1);
    expect(acceptDockIndex).toBeGreaterThan(shrinkIndex);
    expect(shrinkWaitIndex).toBeGreaterThan(shrinkIndex);
    expect(acceptDockIndex).toBeGreaterThan(shrinkWaitIndex);
  });

  it('grows native bounds before revealing the undock expand animation', () => {
    const acceptUndockIndex = appSource.indexOf('window.stickyNotes.acceptUndock(');
    const viewportWaitIndex = appSource.indexOf('await waitForResizedViewport(payload.bounds);');
    const growStartIndex = appSource.indexOf('setIsUndockGrowing(true);');
    const growReleaseIndex = appSource.indexOf('setIsUndockGrowing(false);');

    expect(acceptUndockIndex).toBeGreaterThan(-1);
    expect(viewportWaitIndex).toBeGreaterThan(acceptUndockIndex);
    expect(growStartIndex).toBeGreaterThan(viewportWaitIndex);
    expect(growReleaseIndex).toBeGreaterThan(growStartIndex);
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
