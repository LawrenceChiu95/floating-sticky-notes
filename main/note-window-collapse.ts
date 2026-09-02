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
  | { kind: 'dock'; side: DockSide; y: number; reveal?: boolean }
  | { kind: 'expand'; bounds: NativeNoteWindowBounds }
  | { kind: 'peek'; bounds: NativeNoteWindowBounds }
  | { kind: 'slide'; y: number };

export type NoteWindowDockCommit = {
  side: DockSide;
  bounds: NativeNoteWindowBounds;
  anchor: Pick<NativeNoteWindowBounds, 'x' | 'y'>;
};

type NoteWindowCollapseControllerOptions = {
  window: CollapsibleNoteWindow;
  getWorkAreas: () => DisplayWorkArea[];
  // 窗口交接架构（2026-09-01）：docked 态的可见窗口是独立的恒尺寸书签头窗。
  // 控制器在 docked 期间的一切几何读写（peek 钉回、沿边滑动、回滚、持久化
  // 取位置）都必须落在书签头窗上；未提供或已销毁时回退便签主窗（测试与
  // 旧路径保持可用）。
  getDockedWindow?: () => CollapsibleNoteWindow | undefined;
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
  commitDocked: (next: NoteWindowDockCommit) => void;
  restoreCollapsed: (bounds: NativeNoteWindowBounds) => void;
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

  // docked 态的活动窗口：书签头窗优先，缺席时退回便签主窗。
  const dockWindow = (): CollapsibleNoteWindow => options.getDockedWindow?.() ?? noteWindow;

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
    const target = dockWindow();
    bestEffort(() => target.setMinimumSize(bounds.width, NOTE_DOCK_HEIGHT));
    bestEffort(() => target.setBounds(bounds, false));
    bestEffort(() => target.setResizable(false));
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
        neighborWorkAreas: workAreas.filter((area) => area !== workArea),
        // 落位姿势由主进程按光标真相选定（光标在书签头上 → 露出落位，不再
        // 「先半藏再探出」两段动）；缺省半藏（启动恢复等路径不变）。
        reveal: next.reveal
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
        const target = dockWindow();
        target.setMinimumSize(next.bounds.width, NOTE_DOCK_HEIGHT);
        target.setBounds(next.bounds, false);
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

    const currentBounds = dockWindow().getBounds();
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

    dockWindow().setBounds(targetBounds, false);
    dockedBounds = targetBounds;
  };

  // The native target may already have been committed by a higher-level
  // visual transition.  Record that exact geometry without deriving it again
  // from the window's post-commit center (which can select another display)
  // and without issuing a second setBounds call.
  const commitDocked = (next: NoteWindowDockCommit): void => {
    if (noteWindow.isDestroyed() || presentation !== 'collapsed') {
      return;
    }

    expandedBounds = {
      ...expandedBounds,
      x: next.anchor.x,
      y: next.anchor.y
    };
    dockedBounds = { ...next.bounds };
    dockSide = next.side;
    presentation = 'docked';
  };

  // union-rect 吸附在 controller 提交前始终应能回到同一份 source 横条。
  // 这个入口同时恢复原生几何和逻辑态，处理 ACK timeout、epoch 作废或原生
  // 几何异常；磁盘保存发生在提交之后，不再参与这里的视觉回滚。
  const restoreCollapsed = (bounds: NativeNoteWindowBounds): void => {
    if (noteWindow.isDestroyed()) {
      return;
    }

    rollbackToCollapsed(bounds);
    dockedBounds = undefined;
    dockSide = undefined;
    presentation = 'collapsed';
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
      // 恢复靠 x 认屏（见 restoreDockedBounds）。docked 态读书签头窗。
      const currentBounds = dockWindow().getBounds();
      return { side: dockSide, x: currentBounds.x, y: currentBounds.y };
    },
    getDockedBounds: () => (dockedBounds ? { ...dockedBounds } : undefined),
    setCollapsed,
    setDocked,
    commitDocked,
    restoreCollapsed,
    applyRestoredDock: (dock, restoredExpandedBounds) => {
      presentation = 'docked';
      dockSide = dock.side;
      // 窗口交接：启动恢复时可见的是书签头窗，docked 几何以它为准。
      dockedBounds = dockWindow().getBounds();
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
