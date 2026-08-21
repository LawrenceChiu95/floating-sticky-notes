import type { NoteBounds, NoteDock } from './note-state';
import {
  buildDockedBounds,
  findNearestWorkArea,
  NOTE_DOCK_HEIGHT,
  type DockSide
} from '../shared/note-dock';
import {
  NOTE_COLLAPSED_HEIGHT,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  clampNoteBoundsToWorkAreas,
  type DisplayWorkArea
} from './window-options';

type NativeNoteWindowBounds = Required<NoteBounds>;

export type CollapsibleNoteWindow = {
  getBounds: () => NativeNoteWindowBounds;
  isDestroyed: () => boolean;
  setBounds: (bounds: NativeNoteWindowBounds, animate: boolean) => void;
  setMinimumSize: (width: number, height: number) => void;
  setResizable: (resizable: boolean) => void;
};

export type NoteWindowPresentation = 'expanded' | 'collapsed' | 'docked';

export type NoteWindowDockTransition =
  | { kind: 'dock'; side: DockSide; y: number }
  | { kind: 'expand'; bounds: NativeNoteWindowBounds }
  | { kind: 'peek'; bounds: NativeNoteWindowBounds }
  | { kind: 'slide'; y: number };

type NoteWindowCollapseControllerOptions = {
  window: CollapsibleNoteWindow;
  getWorkAreas: () => DisplayWorkArea[];
};

export function createNoteWindowCollapseController(
  options: NoteWindowCollapseControllerOptions
): {
  getPresentation: () => NoteWindowPresentation;
  getBoundsForPersistence: () => NativeNoteWindowBounds;
  getDockForPersistence: () => NoteDock | undefined;
  getDockedBounds: () => NativeNoteWindowBounds | undefined;
  setCollapsed: (collapsed: boolean) => Promise<void>;
  setDocked: (next: NoteWindowDockTransition) => Promise<void>;
  applyRestoredDock: (
    dock: { side: DockSide; y: number },
    restoredExpandedBounds: NativeNoteWindowBounds
  ) => void;
} {
  const noteWindow = options.window;
  let presentation: NoteWindowPresentation = 'expanded';
  let expandedBounds = noteWindow.getBounds();
  let dockedBounds: NativeNoteWindowBounds | undefined;
  let dockSide: DockSide | undefined;

  const rollbackToExpanded = (bounds: NativeNoteWindowBounds): void => {
    bestEffort(() => noteWindow.setResizable(true));
    bestEffort(() => noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_MIN_HEIGHT));
    bestEffort(() => noteWindow.setBounds(bounds, false));
  };

  const rollbackToCollapsed = (bounds: NativeNoteWindowBounds): void => {
    bestEffort(() => noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_COLLAPSED_HEIGHT));
    bestEffort(() => noteWindow.setBounds(bounds, false));
    bestEffort(() => noteWindow.setResizable(false));
  };

  const rollbackToDocked = (bounds: NativeNoteWindowBounds): void => {
    bestEffort(() => noteWindow.setMinimumSize(bounds.width, NOTE_DOCK_HEIGHT));
    bestEffort(() => noteWindow.setBounds(bounds, false));
    bestEffort(() => noteWindow.setResizable(false));
  };

  const setCollapsed = async (collapsed: boolean): Promise<void> => {
    if (noteWindow.isDestroyed()) {
      return;
    }

    if (collapsed) {
      // 贴边不允许回到横条；只有展开态能收成横条。
      if (presentation !== 'expanded') {
        return;
      }

      const nextExpandedBounds = noteWindow.getBounds();

      try {
        noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_COLLAPSED_HEIGHT);
        noteWindow.setBounds(
          {
            ...nextExpandedBounds,
            height: NOTE_COLLAPSED_HEIGHT
          },
          false
        );
        if (!noteWindow.isDestroyed()) {
          noteWindow.setResizable(false);
        }
      } catch (error) {
        rollbackToExpanded(nextExpandedBounds);
        throw error;
      }

      expandedBounds = nextExpandedBounds;
      presentation = 'collapsed';
      return;
    }

    // 贴边的展开走 setDocked({ kind: 'expand' })，不能复用横条锚点路径。
    if (presentation !== 'collapsed') {
      return;
    }

    const collapsedBounds = noteWindow.getBounds();
    const clampedBounds = clampNoteBoundsToWorkAreas(
      {
        ...expandedBounds,
        x: collapsedBounds.x,
        y: collapsedBounds.y
      },
      options.getWorkAreas(),
      collapsedBounds
    );
    const restoredBounds: NativeNoteWindowBounds = {
      ...clampedBounds,
      x: clampedBounds.x ?? collapsedBounds.x,
      y: clampedBounds.y ?? collapsedBounds.y
    };

    try {
      noteWindow.setResizable(true);
      noteWindow.setBounds(restoredBounds, false);
      noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_MIN_HEIGHT);
    } catch (error) {
      rollbackToCollapsed(collapsedBounds);
      throw error;
    }

    expandedBounds = restoredBounds;
    presentation = 'expanded';
  };

  const setDocked = async (next: NoteWindowDockTransition): Promise<void> => {
    if (noteWindow.isDestroyed()) {
      return;
    }

    if (next.kind === 'dock') {
      // 只有横条能贴边；展开态不允许直接贴边。
      if (presentation !== 'collapsed') {
        return;
      }

      const collapsedBounds = noteWindow.getBounds();
      const workAreas = options.getWorkAreas();
      const workArea = findNearestWorkArea(collapsedBounds, workAreas);

      if (!workArea) {
        return;
      }

      const targetBounds = buildDockedBounds({
        side: next.side,
        y: next.y,
        workArea,
        neighborWorkAreas: workAreas.filter((area) => area !== workArea)
      });

      try {
        noteWindow.setMinimumSize(targetBounds.width, NOTE_DOCK_HEIGHT);
        noteWindow.setBounds(targetBounds, false);
        if (!noteWindow.isDestroyed()) {
          noteWindow.setResizable(false);
        }
      } catch (error) {
        rollbackToCollapsed(collapsedBounds);
        throw error;
      }

      // bounds 始终记展开态：横条 x/y + 展开宽高，与收起持久化口径一致。
      expandedBounds = {
        ...expandedBounds,
        x: collapsedBounds.x,
        y: collapsedBounds.y
      };
      dockedBounds = targetBounds;
      dockSide = next.side;
      presentation = 'docked';
      return;
    }

    if (next.kind === 'expand') {
      if (presentation !== 'docked') {
        return;
      }

      const sliverBounds = noteWindow.getBounds();

      try {
        // 几何写入排在标志位之前：原生拖动进行中切 resizable 会动 styleMask，
        // 紧随其后的 setBounds 有时被拖拽会话吞掉（窗口没长大、DOM 已展开 =
        // 变形）。先把矩形写到位，再恢复尺寸约束。
        noteWindow.setBounds(next.bounds, false);
        noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_MIN_HEIGHT);
        if (!noteWindow.isDestroyed()) {
          noteWindow.setResizable(true);
        }
      } catch (error) {
        rollbackToDocked(sliverBounds);
        throw error;
      }

      expandedBounds = next.bounds;
      dockedBounds = undefined;
      dockSide = undefined;
      presentation = 'expanded';
      return;
    }

    // 悬停探头：几何已由主进程滑行写到位，这里只换静止位基准（半藏 ↔ 整条
    // 全露）并钉一次，后续展开阈值、沿边滑动都从新基准起算。
    if (next.kind === 'peek') {
      if (presentation !== 'docked' || !dockedBounds || !dockSide) {
        return;
      }

      try {
        noteWindow.setMinimumSize(next.bounds.width, NOTE_DOCK_HEIGHT);
        noteWindow.setBounds(next.bounds, false);
      } catch (error) {
        rollbackToDocked(dockedBounds);
        throw error;
      }

      dockedBounds = { ...next.bounds };
      return;
    }

    // 磁吸沿边滑动：把 x 钉回当前贴边姿势（半藏/露出基准）、y 跟随并夹进
    // 工作区。只在确认松手后的钉回（主进程 release watch）或无光标的非拖动
    // move 上调用——原生拖拽会话进行中的 move 流上钉边会被吞或重置拖拽位移
    // （抽搐/拖不出来），所以拖动中窗口跟手自由拖，钉边在松手后一次性收尾；
    // 松手停在边上一定是贴边位置。
    if (presentation !== 'docked' || !dockedBounds || !dockSide) {
      return;
    }

    const currentBounds = noteWindow.getBounds();
    const workArea = findNearestWorkArea(currentBounds, options.getWorkAreas());
    const minY = workArea ? workArea.y : Number.NEGATIVE_INFINITY;
    const maxY = workArea
      ? workArea.y + workArea.height - NOTE_DOCK_HEIGHT
      : Number.POSITIVE_INFINITY;
    const targetBounds: NativeNoteWindowBounds = {
      x: dockedBounds.x,
      y: Math.min(Math.max(next.y, minY), Math.max(minY, maxY)),
      width: dockedBounds.width,
      height: NOTE_DOCK_HEIGHT
    };

    if (
      currentBounds.x === targetBounds.x &&
      currentBounds.y === targetBounds.y &&
      currentBounds.width === targetBounds.width &&
      currentBounds.height === targetBounds.height
    ) {
      return;
    }

    noteWindow.setBounds(targetBounds, false);
    dockedBounds = targetBounds;
  };

  return {
    getPresentation: () => presentation,
    getBoundsForPersistence: () => {
      if (presentation === 'docked') {
        return { ...expandedBounds };
      }

      if (presentation === 'expanded') {
        return noteWindow.getBounds();
      }

      const collapsedBounds = noteWindow.getBounds();
      return {
        ...expandedBounds,
        x: collapsedBounds.x,
        y: collapsedBounds.y
      };
    },
    getDockForPersistence: () => {
      if (presentation !== 'docked' || !dockSide) {
        return undefined;
      }

      // 静止位 x 一并持久化：多屏时 side+y 分不清贴在哪块屏的同名边，
      // 恢复靠 x 认屏（见 restoreDockedBounds）。
      const currentBounds = noteWindow.getBounds();
      return { side: dockSide, x: currentBounds.x, y: currentBounds.y };
    },
    getDockedBounds: () => (dockedBounds ? { ...dockedBounds } : undefined),
    setCollapsed,
    setDocked,
    applyRestoredDock: (dock, restoredExpandedBounds) => {
      presentation = 'docked';
      dockSide = dock.side;
      dockedBounds = noteWindow.getBounds();
      expandedBounds = restoredExpandedBounds;
    }
  };
}

function bestEffort(operation: () => void): void {
  try {
    operation();
  } catch {
    // Preserve the original native-window failure; a retry remains available.
  }
}
