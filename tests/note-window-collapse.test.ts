import { describe, expect, it } from 'vitest';
import {
  createNoteWindowCollapseController,
  type CollapsibleNoteWindow
} from '../main/note-window-collapse';
import type { NoteBounds } from '../main/note-state';

type NativeBounds = Required<NoteBounds>;

function createWindowHarness(initialBounds: NativeBounds): {
  window: CollapsibleNoteWindow;
  failNext: (operation: string) => void;
  moveTo: (x: number, y: number) => void;
  getNativeState: () => {
    bounds: NativeBounds;
    minimumSize: [number, number];
    resizable: boolean;
  };
} {
  let bounds = { ...initialBounds };
  let minimumSize: [number, number] = [200, 140];
  let resizable = true;
  let failingOperation: string | undefined;

  const maybeFail = (operation: string): void => {
    if (failingOperation === operation) {
      failingOperation = undefined;
      throw new Error(`Failed ${operation}`);
    }
  };

  return {
    window: {
      getBounds: () => ({ ...bounds }),
      isDestroyed: () => false,
      setBounds: (nextBounds) => {
        maybeFail(nextBounds.height === 40 ? 'collapse-bounds' : 'expand-bounds');
        bounds = { ...nextBounds };
      },
      setMinimumSize: (width, height) => {
        maybeFail(height === 40 ? 'collapse-minimum' : 'expand-minimum');
        minimumSize = [width, height];
      },
      setResizable: (nextResizable) => {
        maybeFail(nextResizable ? 'expand-resizable' : 'collapse-resizable');
        resizable = nextResizable;
      }
    },
    failNext: (operation) => {
      failingOperation = operation;
    },
    moveTo: (x, y) => {
      bounds = { ...bounds, x, y };
    },
    getNativeState: () => ({
      bounds: { ...bounds },
      minimumSize: [...minimumSize],
      resizable
    })
  };
}

describe('note window collapse controller', () => {
  it('rolls back a failed collapse and allows the same transition to be retried', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createNoteWindowCollapseController({
      window: harness.window,
      getWorkAreas: () => [{ x: 0, y: 0, width: 1440, height: 900 }]
    });
    harness.failNext('collapse-resizable');

    await expect(controller.setCollapsed(true)).rejects.toThrow('Failed collapse-resizable');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 120, y: 80, width: 320, height: 260 },
      minimumSize: [200, 140],
      resizable: true
    });

    await expect(controller.setCollapsed(true)).resolves.toBeUndefined();
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 120, y: 80, width: 320, height: 40 },
      minimumSize: [200, 40],
      resizable: false
    });
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 120,
      y: 80,
      width: 320,
      height: 260
    });
  });

  it('rolls back a failed expansion and allows the same transition to be retried', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createNoteWindowCollapseController({
      window: harness.window,
      getWorkAreas: () => [{ x: 0, y: 0, width: 1440, height: 900 }]
    });
    await controller.setCollapsed(true);
    harness.moveTo(360, 200);
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 360,
      y: 200,
      width: 320,
      height: 260
    });
    harness.failNext('expand-minimum');

    await expect(controller.setCollapsed(false)).rejects.toThrow('Failed expand-minimum');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 360, y: 200, width: 320, height: 40 },
      minimumSize: [200, 40],
      resizable: false
    });

    await expect(controller.setCollapsed(false)).resolves.toBeUndefined();
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 360, y: 200, width: 320, height: 260 },
      minimumSize: [200, 140],
      resizable: true
    });
  });
});
