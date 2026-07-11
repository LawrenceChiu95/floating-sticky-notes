import { describe, expect, it, vi } from 'vitest';
import {
  createUpdateProgressWindowManager,
  type UpdateProgressWindowPort
} from '../main/update-progress-window';
import type { UpdateProgressSnapshot } from '../shared/update-progress';

class FakeProgressWindow implements UpdateProgressWindowPort {
  readonly sent: UpdateProgressSnapshot[] = [];
  readonly setProgressBar = vi.fn();
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly close = vi.fn();
  readonly destroy = vi.fn();
  readonly load = vi.fn(async () => undefined);
  private readyListener?: () => void;
  private closedListener?: () => void;

  onReady(listener: () => void): void {
    this.readyListener = listener;
  }

  onClosed(listener: () => void): void {
    this.closedListener = listener;
  }

  send(snapshot: UpdateProgressSnapshot): void {
    this.sent.push(snapshot);
  }

  emitReady(): void {
    this.readyListener?.();
  }

  emitClosed(): void {
    this.closedListener?.();
  }
}

describe('update progress window manager', () => {
  it('replays progress received before renderer ready', () => {
    const window = new FakeProgressWindow();
    const manager = createUpdateProgressWindowManager({ createWindow: () => window });

    manager.showPreparing('0.1.11');
    manager.update({ percent: 37.6 });

    expect(window.sent).toEqual([]);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.setProgressBar).toHaveBeenLastCalledWith(0.38);

    window.emitReady();

    expect(window.sent).toEqual([
      { state: 'downloading', version: '0.1.11', percent: 38 }
    ]);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('reuses and focuses the existing window', () => {
    const window = new FakeProgressWindow();
    const createWindow = vi.fn(() => window);
    const manager = createUpdateProgressWindowManager({ createWindow });

    manager.showPreparing('0.1.11');
    window.emitReady();
    manager.focus();

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(2);
    expect(window.focus).toHaveBeenCalledTimes(2);
  });

  it('keeps invalid progress indeterminate', () => {
    const window = new FakeProgressWindow();
    const manager = createUpdateProgressWindowManager({ createWindow: () => window });

    manager.showPreparing();
    manager.update({ percent: Number.NaN });
    window.emitReady();

    expect(window.setProgressBar).toHaveBeenLastCalledWith(2);
    expect(window.sent.at(-1)).toEqual({ state: 'downloading' });
  });

  it('clears taskbar state and programmatically closes', () => {
    const window = new FakeProgressWindow();
    const manager = createUpdateProgressWindowManager({ createWindow: () => window });

    manager.showPreparing();
    manager.close();

    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale closed event clear a replacement window', () => {
    const firstWindow = new FakeProgressWindow();
    const secondWindow = new FakeProgressWindow();
    const createWindow = vi
      .fn((): UpdateProgressWindowPort => firstWindow)
      .mockReturnValueOnce(firstWindow)
      .mockReturnValueOnce(secondWindow);
    const manager = createUpdateProgressWindowManager({ createWindow });

    manager.showPreparing('0.1.11');
    manager.close();
    manager.showPreparing('0.1.12');
    firstWindow.emitClosed();
    manager.update({ percent: 10 });
    secondWindow.emitReady();

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(secondWindow.sent.at(-1)).toEqual({
      state: 'downloading',
      version: '0.1.12',
      percent: 10
    });
  });

  it('destroys a window whose page fails to load without throwing', async () => {
    const window = new FakeProgressWindow();
    const error = new Error('load failed');
    window.load.mockRejectedValueOnce(error);
    const logError = vi.fn();
    const setFallbackProgress = vi.fn();
    const manager = createUpdateProgressWindowManager({
      createWindow: () => window,
      setFallbackProgress,
      logError
    });

    manager.showPreparing();
    await flushMicrotasks();

    expect(logError).toHaveBeenCalledWith('Unable to load update progress window', error);
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(window.destroy).toHaveBeenCalledTimes(1);

    manager.update({ percent: 64 });
    expect(setFallbackProgress).toHaveBeenLastCalledWith(0.64);
  });

  it('keeps downloading when creating the progress window throws', () => {
    const error = new Error('window unavailable');
    const setFallbackProgress = vi.fn();
    const logError = vi.fn();
    const manager = createUpdateProgressWindowManager({
      createWindow: () => {
        throw error;
      },
      setFallbackProgress,
      logError
    });

    expect(() => manager.showPreparing('0.1.11')).not.toThrow();
    manager.update({ percent: 25 });

    expect(logError).toHaveBeenCalledWith('Unable to create update progress window', error);
    expect(setFallbackProgress).toHaveBeenNthCalledWith(1, 2);
    expect(setFallbackProgress).toHaveBeenLastCalledWith(0.25);
  });

  it('falls back when initializing the progress window throws', () => {
    const window = new FakeProgressWindow();
    const error = new Error('show failed');
    window.show.mockImplementationOnce(() => {
      throw error;
    });
    const setFallbackProgress = vi.fn();
    const logError = vi.fn();
    const manager = createUpdateProgressWindowManager({
      createWindow: () => window,
      setFallbackProgress,
      logError
    });

    expect(() => manager.showPreparing()).not.toThrow();

    expect(logError).toHaveBeenCalledWith('Unable to initialize update progress window', error);
    expect(window.destroy).toHaveBeenCalledTimes(1);
    expect(setFallbackProgress).toHaveBeenLastCalledWith(2);
  });

  it('does not let fallback taskbar errors interrupt downloading', () => {
    const window = new FakeProgressWindow();
    const error = new Error('taskbar unavailable');
    const logError = vi.fn();
    const manager = createUpdateProgressWindowManager({
      createWindow: () => window,
      setFallbackProgress: () => {
        throw error;
      },
      logError
    });

    expect(() => manager.showPreparing()).not.toThrow();
    expect(() => manager.update({ percent: 50 })).not.toThrow();

    expect(window.setProgressBar).toHaveBeenLastCalledWith(0.5);
    expect(logError).toHaveBeenCalledWith('Unable to update fallback taskbar progress', error);
  });

  it('destroys the active window and ignores new UI after dispose', () => {
    const window = new FakeProgressWindow();
    const createWindow = vi.fn(() => window);
    const manager = createUpdateProgressWindowManager({ createWindow });

    manager.showPreparing();
    manager.dispose();
    manager.showPreparing('0.1.12');

    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(window.destroy).toHaveBeenCalledTimes(1);
    expect(createWindow).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
