import { describe, expect, it, vi } from 'vitest';
import {
  computeImagePreviewSize,
  computeResizedBounds,
  createImagePreviewWindowOptions,
  ImagePreviewController,
  type ImagePreviewWindowPort
} from '../main/image-preview-window';
import type { ImagePreviewSnapshot } from '../shared/image-preview';

const SNAPSHOT: ImagePreviewSnapshot = {
  noteId: 'note-1',
  activeImageId: 'image-1',
  images: [
    {
      id: 'image-1',
      src: 'sticky-notes-image://local/image-1.png',
      width: 320,
      height: 180
    }
  ]
};

describe('ImagePreviewController', () => {
  it('creates and opens the preview when a snapshot is available', () => {
    const testWindow = createTestWindow();
    const createWindow = vi.fn(() => testWindow.port);
    const controller = new ImagePreviewController({
      createWindow,
      getSnapshot: () => SNAPSHOT,
      focusSource: vi.fn()
    });

    expect(
      controller.open(
        7,
        'note-1',
        'image-1',
        { x: 0, y: 0, width: 1200, height: 800 },
        { x: 20, y: 30, width: 280, height: 220 }
      )
    ).toBe(true);
    expect(createWindow).toHaveBeenCalledOnce();
    expect(createWindow).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 1200, height: 800 },
      { x: 20, y: 30, width: 280, height: 220 },
      { width: 320, height: 180 }
    );
    expect(testWindow.load).toHaveBeenCalledOnce();

    testWindow.ready();

    expect(testWindow.send).toHaveBeenCalledWith(SNAPSHOT);
    expect(testWindow.show).toHaveBeenCalledOnce();
    expect(testWindow.focus).toHaveBeenCalledOnce();
    expect(controller.getSnapshotForWebContents(99)).toEqual(SNAPSHOT);
  });

  it('closes without focusing a note when its source closes', () => {
    const testWindow = createTestWindow();
    const focusSource = vi.fn();
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: () => SNAPSHOT,
      focusSource
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );

    controller.handleSourceClosed(7);

    expect(testWindow.close).toHaveBeenCalledOnce();
    expect(focusSource).not.toHaveBeenCalled();
  });
  it('closes without focusing a deleted note', () => {
    const testWindow = createTestWindow();
    const focusSource = vi.fn();
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: () => SNAPSHOT,
      focusSource
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );

    controller.handleNoteDeleted('note-1');

    expect(testWindow.close).toHaveBeenCalledOnce();
    expect(focusSource).not.toHaveBeenCalled();
  });

  it('refreshes the image list after a non-active image is deleted', () => {
    const testWindow = createTestWindow();
    const initialSnapshot: ImagePreviewSnapshot = {
      ...SNAPSHOT,
      images: [
        SNAPSHOT.images[0],
        {
          id: 'image-2',
          src: 'sticky-notes-image://local/image-2.png',
          width: 320,
          height: 180
        }
      ]
    };
    const refreshedSnapshot: ImagePreviewSnapshot = {
      ...SNAPSHOT,
      images: [SNAPSHOT.images[0]]
    };
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: (_noteId, imageId) =>
        imageId === 'image-1' ? refreshedSnapshot : undefined,
      focusSource: vi.fn()
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );
    testWindow.ready();
    testWindow.send.mockClear();
    (controller as unknown as { active: { snapshot: ImagePreviewSnapshot } }).active.snapshot = initialSnapshot;

    controller.handleImageDeleted('note-1', 'image-2');

    expect(testWindow.send).toHaveBeenCalledWith(refreshedSnapshot);
  });

  it('marks an explicit open request when reusing the preview for another image', () => {
    const testWindow = createTestWindow();
    const snapshots: Record<string, ImagePreviewSnapshot> = {
      'image-1': {
        ...SNAPSHOT,
        images: [
          SNAPSHOT.images[0],
          {
            id: 'image-2',
            src: 'sticky-notes-image://local/image-2.png',
            width: 640,
            height: 360
          }
        ]
      },
      'image-2': {
        ...SNAPSHOT,
        activeImageId: 'image-2',
        images: [
          SNAPSHOT.images[0],
          {
            id: 'image-2',
            src: 'sticky-notes-image://local/image-2.png',
            width: 640,
            height: 360
          }
        ]
      }
    };
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: (_noteId, imageId) => snapshots[imageId],
      focusSource: vi.fn()
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );
    testWindow.ready();
    testWindow.send.mockClear();

    expect(
      controller.open(
        7,
        'note-1',
        'image-2',
        { x: 0, y: 0, width: 1200, height: 800 },
        { width: 280, height: 220 }
      )
    ).toBe(true);
    expect(testWindow.send).toHaveBeenCalledWith({
      ...snapshots['image-2'],
      requestedActiveImageId: 'image-2'
    });
  });

  it('routes resize deltas to the active preview window only', () => {
    const testWindow = createTestWindow();
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: () => SNAPSHOT,
      focusSource: vi.fn()
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );

    expect(controller.resize(123, 'se', 10, 20)).toBe(false);
    expect(controller.resize(99, 'se', Number.NaN, 20)).toBe(false);
    expect(controller.resize(99, 'se', 10, 20)).toBe(true);
    expect(testWindow.resize).toHaveBeenCalledWith('se', 10, 20);
  });

  it('routes move deltas to the active preview window only', () => {
    const testWindow = createTestWindow();
    const controller = new ImagePreviewController({
      createWindow: () => testWindow.port,
      getSnapshot: () => SNAPSHOT,
      focusSource: vi.fn()
    });
    controller.open(
      7,
      'note-1',
      'image-1',
      { x: 0, y: 0, width: 1200, height: 800 },
      { width: 280, height: 220 }
    );

    expect(controller.move(123, 10, 20)).toBe(false);
    expect(controller.move(99, 10, Number.NaN)).toBe(false);
    expect(controller.move(99, Number.POSITIVE_INFINITY, 20)).toBe(false);
    expect(controller.move(99, 10, 20)).toBe(true);
    expect(testWindow.move).toHaveBeenCalledWith(10, 20);
  });
});

describe('image preview sizing', () => {
  const workArea = { width: 1200, height: 800 };

  it('keeps small images at natural size subject to the minimum', () => {
    expect(computeImagePreviewSize({ width: 320, height: 180 }, workArea)).toEqual({
      width: 320,
      height: 240
    });
  });

  it('caps large images to 80% of the work area without upscaling', () => {
    expect(computeImagePreviewSize({ width: 4000, height: 3000 }, workArea)).toEqual({
      width: 853,
      height: 640
    });
    expect(computeImagePreviewSize({ width: 606, height: 514 }, workArea)).toEqual({
      width: 606,
      height: 514
    });
  });

  it('scales by the limiting dimension and preserves aspect ratio', () => {
    const size = computeImagePreviewSize({ width: 2000, height: 500 }, workArea);
    expect(size).toEqual({ width: 960, height: 240 });
  });
});

describe('computeResizedBounds', () => {
  const bounds = { x: 100, y: 100, width: 400, height: 300 };
  const minimum = { width: 320, height: 240 };
  const maximum = { width: 1200, height: 800 };

  it('grows from the east edge keeping the west edge anchored', () => {
    expect(computeResizedBounds(bounds, 'e', 50, 999, minimum, maximum)).toEqual({
      x: 100,
      y: 100,
      width: 450,
      height: 300
    });
  });

  it('moves the west edge while keeping the east edge anchored', () => {
    expect(computeResizedBounds(bounds, 'w', 50, 0, minimum, maximum)).toEqual({
      x: 150,
      y: 100,
      width: 350,
      height: 300
    });
  });

  it('moves the north edge while keeping the south edge anchored', () => {
    expect(computeResizedBounds(bounds, 'n', 0, -40, minimum, maximum)).toEqual({
      x: 100,
      y: 60,
      width: 400,
      height: 340
    });
  });

  it('handles diagonal directions', () => {
    expect(computeResizedBounds(bounds, 'se', 20, 30, minimum, maximum)).toEqual({
      x: 100,
      y: 100,
      width: 420,
      height: 330
    });
    expect(computeResizedBounds(bounds, 'nw', -10, -10, minimum, maximum)).toEqual({
      x: 90,
      y: 90,
      width: 410,
      height: 310
    });
  });

  it('clamps to the minimum size without drifting the anchored edge', () => {
    expect(computeResizedBounds(bounds, 'w', 500, 0, minimum, maximum)).toEqual({
      x: 180,
      y: 100,
      width: 320,
      height: 300
    });
  });

  it('clamps to the maximum size', () => {
    expect(computeResizedBounds(bounds, 'se', 5000, 5000, minimum, maximum)).toEqual({
      x: 100,
      y: 100,
      width: 1200,
      height: 800
    });
  });
});

describe('image preview window options', () => {
  it('uses a sandboxed frameless resizable window fitted to the image near the source note', () => {
    const options = createImagePreviewWindowOptions(
      { x: 0, y: 0, width: 1200, height: 800 },
      { x: 20, y: 30, width: 280, height: 220 },
      { width: 320, height: 180 },
      '/app/imagePreviewPreload.cjs',
      '/app/icon.ico'
    );

    expect(options).toMatchObject({
      x: 316,
      y: 30,
      width: 320,
      height: 240,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      resizable: true,
      minimizable: false,
      webPreferences: {
        preload: '/app/imagePreviewPreload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
  });
});

function createTestWindow() {
  let readyListener = (): void => undefined;
  let closedListener = (): void => undefined;
  const load = vi.fn(async () => undefined);
  const send = vi.fn();
  const show = vi.fn();
  const focus = vi.fn();
  const close = vi.fn(() => closedListener());
  const destroy = vi.fn();
  const resize = vi.fn();
  const move = vi.fn();
  const port: ImagePreviewWindowPort = {
    webContentsId: 99,
    load,
    onReady: (listener) => {
      readyListener = listener;
    },
    onClosed: (listener) => {
      closedListener = listener;
    },
    send,
    show,
    focus,
    close,
    destroy,
    resize,
    move
  };
  return {
    port,
    load,
    send,
    show,
    focus,
    close,
    destroy,
    resize,
    move,
    ready: () => readyListener()
  };
}
