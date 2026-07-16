import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateReleaseFeedbackWindowBounds,
  createReleaseFeedbackWindowManager,
  createReleaseFeedbackWindowOptions,
  type ReleaseFeedbackWindowPort
} from '../main/release-feedback-window';
import type { ReleaseFeedbackSnapshot } from '../shared/release-feedback-window';

const automaticSnapshot: ReleaseFeedbackSnapshot = {
  initiatedBy: 'automatic',
  version: '0.1.15',
  releases: [
    {
      version: '0.1.15',
      date: '2026-07-17',
      sections: [{ title: '新增', items: ['自有更新说明窗口'] }]
    }
  ]
};

class FakeFeedbackWindow implements ReleaseFeedbackWindowPort {
  readonly webContentsId: number;
  readonly workArea = { x: 100, y: 50, width: 1200, height: 800 };
  readonly load = vi.fn(async () => undefined);
  readonly send = vi.fn();
  readonly setBounds = vi.fn();
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly destroy = vi.fn();
  readonly getChromeHeight = vi.fn(() => 28);
  private readyListener?: () => void;
  private showListener?: () => void;
  private closedListener?: () => void;

  constructor(webContentsId = 42) {
    this.webContentsId = webContentsId;
  }

  onReady(listener: () => void): void {
    this.readyListener = listener;
  }

  onShow(listener: () => void): void {
    this.showListener = listener;
  }

  onClosed(listener: () => void): void {
    this.closedListener = listener;
  }

  emitReady(): void {
    this.readyListener?.();
  }

  emitShow(): void {
    this.showListener?.();
  }

  emitClosed(): void {
    this.closedListener?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('release feedback window geometry', () => {
  it('creates an ownerless, hidden, fixed and sandboxed window', () => {
    expect(
      createReleaseFeedbackWindowOptions(
        { x: 100, y: 50, width: 1200, height: 800 },
        '/app/releaseFeedbackPreload.cjs',
        '/app/icon.ico'
      )
    ).toMatchObject({
      x: 480,
      y: 360,
      width: 440,
      height: 180,
      title: '本版更新',
      show: false,
      modal: false,
      closable: true,
      minimizable: false,
      maximizable: false,
      resizable: false,
      skipTaskbar: false,
      backgroundColor: '#f5f1e8',
      webPreferences: {
        preload: '/app/releaseFeedbackPreload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
  });

  it('clamps measured content and final outer bounds to the active work area', () => {
    expect(
      calculateReleaseFeedbackWindowBounds(
        { x: 100, y: 50, width: 1200, height: 800 },
        900,
        28
      )
    ).toEqual({ x: 480, y: 156, width: 440, height: 588 });
    expect(
      calculateReleaseFeedbackWindowBounds(
        { x: -300, y: 10, width: 300, height: 140 },
        50,
        28
      )
    ).toEqual({ x: -300, y: 10, width: 300, height: 140 });
  });
});

describe('release feedback window manager', () => {
  it('waits for renderer measurement and the native show event before reporting success', async () => {
    const window = new FakeFeedbackWindow();
    const manager = createReleaseFeedbackWindowManager({ createWindow: () => window });

    const result = manager.show(automaticSnapshot);
    expect(window.show).not.toHaveBeenCalled();
    expect(window.send).not.toHaveBeenCalled();

    window.emitReady();
    expect(window.send).toHaveBeenCalledWith(automaticSnapshot);
    expect(manager.reportRendered(42, { contentHeight: 320 })).toBe(true);
    expect(window.setBounds).toHaveBeenCalledWith({
      x: 480,
      y: 276,
      width: 440,
      height: 348
    });
    expect(window.show).toHaveBeenCalledOnce();

    window.emitShow();
    await expect(result).resolves.toEqual({ shown: true, source: 'automatic' });
  });

  it('reuses the active window and preserves the source that created it', async () => {
    const window = new FakeFeedbackWindow();
    const manager = createReleaseFeedbackWindowManager({ createWindow: () => window });
    const manual = manager.show({ ...automaticSnapshot, initiatedBy: 'manual' });
    window.emitReady();
    manager.reportRendered(42, { contentHeight: 200 });
    window.emitShow();
    await manual;

    await expect(manager.show(automaticSnapshot)).resolves.toEqual({
      shown: true,
      source: 'manual'
    });
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('rejects invalid senders and measurements without changing the hidden window', () => {
    const window = new FakeFeedbackWindow();
    const manager = createReleaseFeedbackWindowManager({ createWindow: () => window });
    void manager.show(automaticSnapshot);
    window.emitReady();

    expect(manager.reportRendered(99, { contentHeight: 240 })).toBe(false);
    expect(manager.reportRendered(42, { contentHeight: Number.NaN })).toBe(false);
    expect(manager.reportRendered(42, { contentHeight: -1 })).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
  });

  it('times out a hidden window without marking it shown', async () => {
    vi.useFakeTimers();
    const window = new FakeFeedbackWindow();
    const logWarning = vi.fn();
    const manager = createReleaseFeedbackWindowManager({
      createWindow: () => window,
      logWarning
    });

    const result = manager.show(automaticSnapshot);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toEqual({ shown: false, source: 'automatic' });
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(logWarning).toHaveBeenCalledWith(
      'Release feedback window did not render in time',
      expect.any(Error)
    );
  });

  it('fails closed when loading rejects and can create a replacement afterward', async () => {
    const first = new FakeFeedbackWindow(42);
    first.load.mockRejectedValueOnce(new Error('load failed'));
    const second = new FakeFeedbackWindow(43);
    const createWindow = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const manager = createReleaseFeedbackWindowManager({
      createWindow,
      logWarning: vi.fn()
    });

    await expect(manager.show(automaticSnapshot)).resolves.toEqual({
      shown: false,
      source: 'automatic'
    });
    expect(first.destroy).toHaveBeenCalledOnce();

    void manager.show({ ...automaticSnapshot, initiatedBy: 'manual' });
    expect(createWindow).toHaveBeenCalledTimes(2);
    first.emitClosed();
    expect(manager.isCurrentSender(43)).toBe(true);
  });

  it('validates dismiss senders and makes dispose idempotent', () => {
    const window = new FakeFeedbackWindow();
    const manager = createReleaseFeedbackWindowManager({ createWindow: () => window });
    void manager.show(automaticSnapshot);

    expect(manager.dismiss(99)).toBe(false);
    expect(manager.dismiss(42)).toBe(true);
    expect(window.destroy).toHaveBeenCalledOnce();
    manager.dispose();
    manager.dispose();
    expect(window.destroy).toHaveBeenCalledOnce();
  });
});
