import type { NoteBounds, NoteDock } from './note-state';
import {
  buildDockedBounds,
  findNearestWorkArea,
  NOTE_DOCK_HEIGHT,
  NOTE_DOCK_WIDTH,
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
  | { kind: 'snap-back' };

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
    bestEffort(() => noteWindow.setMinimumSize(NOTE_DOCK_WIDTH, NOTE_DOCK_HEIGHT));
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
      const workArea = findNearestWorkArea(collapsedBounds, options.getWorkAreas());

      if (!workArea) {
        return;
      }

      const targetBounds = buildDockedBounds({ side: next.side, y: next.y, workArea });

      try {
        noteWindow.setMinimumSize(NOTE_DOCK_WIDTH, NOTE_DOCK_HEIGHT);
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
        noteWindow.setResizable(true);
        noteWindow.setBounds(next.bounds, false);
        noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_MIN_HEIGHT);
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

    if (presentation !== 'docked' || !dockedBounds) {
      return;
    }

    const currentBounds = noteWindow.getBounds();
    if (
      currentBounds.x === dockedBounds.x &&
      currentBounds.y === dockedBounds.y &&
      currentBounds.width === dockedBounds.width &&
      currentBounds.height === dockedBounds.height
    ) {
      return;
    }

    noteWindow.setBounds(dockedBounds, false);
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

      return { side: dockSide, y: noteWindow.getBounds().y };
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
