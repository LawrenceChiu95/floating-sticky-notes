import type { NoteBounds } from './note-state';
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

type NoteWindowCollapseControllerOptions = {
  window: CollapsibleNoteWindow;
  getWorkAreas: () => DisplayWorkArea[];
};

export function createNoteWindowCollapseController(
  options: NoteWindowCollapseControllerOptions
): {
  getBoundsForPersistence: () => NativeNoteWindowBounds;
  setCollapsed: (collapsed: boolean) => Promise<void>;
} {
  const noteWindow = options.window;
  let isCollapsed = false;
  let expandedBounds = noteWindow.getBounds();

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

  const setCollapsed = async (collapsed: boolean): Promise<void> => {
    if (isCollapsed === collapsed || noteWindow.isDestroyed()) {
      return;
    }

    if (collapsed) {
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
      isCollapsed = true;
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
    isCollapsed = false;
  };

  return {
    getBoundsForPersistence: () => {
      if (!isCollapsed) {
        return noteWindow.getBounds();
      }

      const collapsedBounds = noteWindow.getBounds();
      return {
        ...expandedBounds,
        x: collapsedBounds.x,
        y: collapsedBounds.y
      };
    },
    setCollapsed
  };
}

function bestEffort(operation: () => void): void {
  try {
    operation();
  } catch {
    // Preserve the original native-window failure; a retry remains available.
  }
}
