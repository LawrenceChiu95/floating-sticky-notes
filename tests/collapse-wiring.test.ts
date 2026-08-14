import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
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
    const viewportWaitIndex = appSource.indexOf('await waitForExpandedViewport();');
    // 从收起确认调用之后找，避免命中 dock-applied 等其他路径的同名调用。
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

  it('applies magnetic dock and expand from native move events, never on release', () => {
    // 收起横条与贴边书签头都走原生 app-region 拖窗；主进程在每个 move 上看当
    // 前矩形：横条进左右缘 24px 立即贴边，书签头离边 ≥48px 立即展开，未过阈
    // 值把 x 钉回边缘（slide）。没有「松手判定」，也没有 240ms 过渡编排。
    expect(mainSource).toContain("noteWindow.on('move'");
    expect(mainSource).toContain('resolveCollapsedDockSide');
    expect(mainSource).toContain('resolveDockedEdgeRelease');
    expect(mainSource).toContain('buildExpandBoundsFromDock');
    expect(mainSource).toContain("kind: 'slide'");
    expect(mainSource).toContain("'sticky-notes:dock-applied'");
    expect(mainSource).toContain('dockNoteForWebContents');
    expect(mainSource).toContain('undockNoteForWebContents');
    // 自定义拖窗整条链路不许回来：拖动 IPC、轮询跟光标、松手判定、offer/accept。
    expect(mainSource).not.toContain('note-window-drag');
    expect(mainSource).not.toContain('noteWindowDragSessions');
    expect(mainSource).not.toContain('noteWindowDragOffsets');
    expect(mainSource).not.toContain('NOTE_WINDOW_DRAG_FOLLOW_INTERVAL_MS');
    expect(mainSource).not.toContain('setInterval');
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
    // 三态同一套原生拖窗：展开/收起横条与贴边书签头全部 app-region drag，
    // 收起态不得再有 no-drag 覆盖（那是自定义拖窗时代的残留）。
    expect(styles).toMatch(/\.drag-bar\s*{[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).not.toMatch(
      /\.note-shell--collapsed \.drag-bar\s*{[^}]*-webkit-app-region:\s*no-drag;/s
    );
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*drag;/s);
  });

  it('restores persisted docks as sliver-sized windows', () => {
    expect(mainSource).toContain('restoreDockedBounds');
    expect(mainSource).toContain('applyRestoredDock');
  });

  it('renders the docked state as a draggable bookmark tab without note chrome', () => {
    expect(appSource).toContain('note-shell--docked');
    expect(styles).toMatch(/\.note-shell--docked\s*{[^}]*-webkit-app-region:\s*drag;/s);
    expect(styles).toMatch(
      /\.note-shell--docked\s*{[^}]*width:\s*var\(--note-dock-width\);[^}]*height:\s*var\(--note-dock-height\);/s
    );
    expect(appSource).toContain("'--note-dock-width': `${NOTE_DOCK_WIDTH}px`");
    expect(appSource).toContain("'--note-dock-height': `${NOTE_DOCK_HEIGHT}px`");
    // 有名字时书签头上横排露出一小段；没名字就是纯色头。名字不可交互（不抢拖动）。
    expect(appSource).toContain('dock-tab-name');
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*max-width:\s*100%;/s);
    expect(styles).not.toMatch(/\.dock-tab-name\s*{[^}]*writing-mode/s);
    expect(styles).toMatch(/\.dock-tab-name\s*{[^}]*pointer-events:\s*none;/s);
    // 书签头走原生拖窗，renderer 不挂任何窗口拖动的指针处理器。
    expect(appSource).not.toContain('onPointerDown={handleNoteWindowDragPointerDown}');
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
