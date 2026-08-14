import { describe, expect, it } from 'vitest';
import {
  createNoteWindowCollapseController,
  type CollapsibleNoteWindow
} from '../main/note-window-collapse';
import type { NoteBounds } from '../main/note-state';

type NativeBounds = Required<NoteBounds>;

function createWindowHarness(initialBounds: NativeBounds): {
  window: CollapsibleNoteWindow;
  failNext: (operation: 'setBounds' | 'setMinimumSize' | 'setResizable') => void;
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
        maybeFail('setBounds');
        bounds = { ...nextBounds };
      },
      setMinimumSize: (width, height) => {
        maybeFail('setMinimumSize');
        minimumSize = [width, height];
      },
      setResizable: (nextResizable) => {
        maybeFail('setResizable');
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

const WORK_AREAS = [{ x: 0, y: 0, width: 1440, height: 900 }];

function createController(harness: ReturnType<typeof createWindowHarness>) {
  return createNoteWindowCollapseController({
    window: harness.window,
    getWorkAreas: () => WORK_AREAS
  });
}

describe('note window collapse controller', () => {
  it('rolls back a failed collapse and allows the same transition to be retried', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    harness.failNext('setResizable');

    await expect(controller.setCollapsed(true)).rejects.toThrow('Failed setResizable');
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
    const controller = createController(harness);
    await controller.setCollapsed(true);
    harness.moveTo(360, 200);
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 360,
      y: 200,
      width: 320,
      height: 260
    });
    harness.failNext('setMinimumSize');

    await expect(controller.setCollapsed(false)).rejects.toThrow('Failed setMinimumSize');
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

describe('note window dock controller', () => {
  it('docks a collapsed bar into a left sliver and keeps expanded bounds for persistence', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);

    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });

    expect(harness.getNativeState()).toEqual({
      bounds: { x: 0, y: 80, width: 96, height: 32 },
      minimumSize: [96, 32],
      resizable: false
    });
    expect(controller.getPresentation()).toBe('docked');
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 120,
      y: 80,
      width: 320,
      height: 260
    });
    expect(controller.getDockForPersistence()).toEqual({ side: 'left', y: 80 });
    expect(controller.getDockedBounds()).toEqual({ x: 0, y: 80, width: 96, height: 32 });
  });

  it('pins a right dock to the right work-area edge with the y clamped vertically', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);

    await controller.setDocked({ kind: 'dock', side: 'right', y: 5000 });

    expect(harness.getNativeState().bounds).toEqual({
      x: 1440 - 96,
      y: 900 - 32,
      width: 96,
      height: 32
    });
    expect(controller.getDockForPersistence()).toEqual({ side: 'right', y: 900 - 32 });
  });

  it('expands a docked sliver into the offered bounds and clears the dock', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });

    await controller.setDocked({
      kind: 'expand',
      bounds: { x: 48, y: 96, width: 320, height: 260 }
    });

    expect(harness.getNativeState()).toEqual({
      bounds: { x: 48, y: 96, width: 320, height: 260 },
      minimumSize: [200, 140],
      resizable: true
    });
    expect(controller.getPresentation()).toBe('expanded');
    expect(controller.getDockForPersistence()).toBeUndefined();
    expect(controller.getDockedBounds()).toBeUndefined();
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 48,
      y: 96,
      width: 320,
      height: 260
    });
  });

  it('snaps a docked sliver back to its pre-drag bounds', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });
    harness.moveTo(60, 132);

    await controller.setDocked({ kind: 'snap-back' });

    expect(harness.getNativeState()).toEqual({
      bounds: { x: 0, y: 80, width: 96, height: 32 },
      minimumSize: [96, 32],
      resizable: false
    });
    expect(controller.getPresentation()).toBe('docked');
    expect(controller.getDockForPersistence()).toEqual({ side: 'left', y: 80 });
  });

  it('rolls back a failed dock entry and allows the same transition to be retried', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    harness.failNext('setBounds');

    await expect(controller.setDocked({ kind: 'dock', side: 'left', y: 80 })).rejects.toThrow(
      'Failed setBounds'
    );
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 120, y: 80, width: 320, height: 40 },
      minimumSize: [200, 40],
      resizable: false
    });
    expect(controller.getPresentation()).toBe('collapsed');
    expect(controller.getDockForPersistence()).toBeUndefined();

    await expect(
      controller.setDocked({ kind: 'dock', side: 'left', y: 80 })
    ).resolves.toBeUndefined();
    expect(controller.getPresentation()).toBe('docked');
    expect(harness.getNativeState().bounds).toEqual({ x: 0, y: 80, width: 96, height: 32 });
  });

  it('rolls back a failed dock expansion and allows the same transition to be retried', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });
    harness.failNext('setBounds');

    await expect(
      controller.setDocked({
        kind: 'expand',
        bounds: { x: 48, y: 96, width: 320, height: 260 }
      })
    ).rejects.toThrow('Failed setBounds');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 0, y: 80, width: 96, height: 32 },
      minimumSize: [96, 32],
      resizable: false
    });
    expect(controller.getPresentation()).toBe('docked');

    await expect(
      controller.setDocked({
        kind: 'expand',
        bounds: { x: 48, y: 96, width: 320, height: 260 }
      })
    ).resolves.toBeUndefined();
    expect(controller.getPresentation()).toBe('expanded');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 48, y: 96, width: 320, height: 260 },
      minimumSize: [200, 140],
      resizable: true
    });
  });

  it('ignores a snap-back when the sliver never left its dock bounds', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });
    harness.failNext('setBounds');

    // 已经在贴边矩形上时 snap-back 不得再触发 setBounds（macOS 上 moved 连续
    // 触发，没有这道短路会反复重设同一个矩形）。
    await controller.setDocked({ kind: 'snap-back' });

    expect(controller.getPresentation()).toBe('docked');
    expect(harness.getNativeState().bounds).toEqual({ x: 0, y: 80, width: 96, height: 32 });
  });

  it('ignores collapse commands while docked', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);
    await controller.setCollapsed(true);
    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });

    await controller.setCollapsed(true);
    await controller.setCollapsed(false);

    expect(controller.getPresentation()).toBe('docked');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 0, y: 80, width: 96, height: 32 },
      minimumSize: [96, 32],
      resizable: false
    });
    expect(controller.getDockForPersistence()).toEqual({ side: 'left', y: 80 });
  });

  it('rejects docking from the expanded state', async () => {
    const harness = createWindowHarness({ x: 120, y: 80, width: 320, height: 260 });
    const controller = createController(harness);

    await controller.setDocked({ kind: 'dock', side: 'left', y: 80 });

    expect(controller.getPresentation()).toBe('expanded');
    expect(harness.getNativeState()).toEqual({
      bounds: { x: 120, y: 80, width: 320, height: 260 },
      minimumSize: [200, 140],
      resizable: true
    });
  });

  it('restores a persisted dock without moving the window', async () => {
    const harness = createWindowHarness({ x: 0, y: 120, width: 96, height: 32 });
    const controller = createController(harness);

    controller.applyRestoredDock(
      { side: 'left', y: 120 },
      { x: 100, y: 100, width: 320, height: 260 }
    );

    expect(controller.getPresentation()).toBe('docked');
    expect(controller.getBoundsForPersistence()).toEqual({
      x: 100,
      y: 100,
      width: 320,
      height: 260
    });
    expect(controller.getDockForPersistence()).toEqual({ side: 'left', y: 120 });
    expect(harness.getNativeState().bounds).toEqual({ x: 0, y: 120, width: 96, height: 32 });
  });
});
