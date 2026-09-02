import type { CSSProperties, ReactElement, RefObject } from 'react';
import type { getNoteNamePresentation } from './note-naming';

export type NoteShellStyle = CSSProperties &
  Record<
    | '--note-menu-surface'
    | '--note-collapsed-height'
    | '--note-transition-title-width'
    | '--collapsed-name-edit-start-width',
    string
  >;

// 贴边书签头：壳永久 no-drag，承载视觉并充当悬停传感条——实测 drag 区在应用
// 非激活时收不到 OS 的 enter/leave，而 no-drag 面双向照收，所以 enter/leave
// 扳机挂壳上；传感条只留在朝桌面那一侧（5px），其余三边与壳齐平的透明 pill
// 是永久 drag 的拖动面，上下沿也能直接抓取拖出展开/沿边滑动。
// 窗口交接架构（2026-09-01）下，这个组件同时渲染在两处：便签主窗的吸附动画
// overlay，以及独立的 96×32 书签头窗（?view=tab）。
export function DockedNoteShell({
  dock,
  namePresentation,
  noteShellRef,
  preloadStatus,
  shellStyle,
  className,
  // 落地替身等纯视觉克隆用：不进入 a11y 树，避免与正主重复播报。
  ariaHidden
}: {
  dock: { side: 'left' | 'right' };
  namePresentation: ReturnType<typeof getNoteNamePresentation>;
  // 事务 overlay 复用时传独立 ref：同一时刻主壳与叠加层都挂着，不能共享 ref。
  noteShellRef?: RefObject<HTMLElement>;
  preloadStatus: string;
  shellStyle: NoteShellStyle;
  className?: string;
  // 落地替身等纯视觉克隆用：不进入 a11y 树，避免与正主重复播报。
  ariaHidden?: boolean;
}): ReactElement {
  return (
    <main
      ref={noteShellRef}
      className={`note-shell note-shell--docked${
        dock.side === 'right' ? ' note-shell--dock-right' : ''
      }${className ? ` ${className}` : ''}`}
      data-preload-status={preloadStatus}
      style={shellStyle}
      aria-label={ariaHidden ? undefined : '已贴边的便签，向右或向左拖动可展开'}
      aria-hidden={ariaHidden || undefined}
      onMouseEnter={() => window.stickyNotes.dockPeekHover(true)}
      onMouseLeave={() => window.stickyNotes.dockPeekHover(false)}
    >
      {namePresentation.kind === 'name' ? (
        <span className="dock-tab-name" aria-hidden="true">
          {namePresentation.text}
        </span>
      ) : null}
      <div className="dock-tab-pill" aria-hidden="true" />
    </main>
  );
}
