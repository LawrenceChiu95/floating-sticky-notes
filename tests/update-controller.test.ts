import { describe, expect, it, vi } from 'vitest';
import {
  createUpdateController,
  shouldEnableAutoUpdates,
  type UpdateClient,
  type UpdateDialog
} from '../main/update-controller';

type UpdateEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error';

class FakeUpdater implements UpdateClient {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  readonly checkForUpdates = vi.fn(async () => undefined);
  readonly downloadUpdate = vi.fn(async () => []);
  readonly quitAndInstall = vi.fn();
  private readonly listeners = new Map<UpdateEvent, Array<(value: unknown) => void>>();

  on(event: UpdateEvent, listener: (value: unknown) => void): this {
    const eventListeners = this.listeners.get(event) ?? [];
    eventListeners.push(listener);
    this.listeners.set(event, eventListeners);
    return this;
  }

  emit(event: UpdateEvent, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }
}

function createDialog(responses: number[] = []) {
  return {
    showMessageBox: vi.fn(async (_options: Parameters<UpdateDialog['showMessageBox']>[0]) => ({
      response: responses.shift() ?? 0
    })),
    showErrorBox: vi.fn((_title: string, _content: string) => undefined)
  } satisfies UpdateDialog;
}

describe('auto-update platform policy', () => {
  it('enables updates only for packaged Windows builds', () => {
    expect(shouldEnableAutoUpdates('win32', true)).toBe(true);
    expect(shouldEnableAutoUpdates('win32', false)).toBe(false);
    expect(shouldEnableAutoUpdates('darwin', true)).toBe(false);
    expect(shouldEnableAutoUpdates('linux', true)).toBe(false);
  });
});

describe('update controller', () => {
  it('keeps downloads user-confirmed and allows install on app quit', () => {
    const updater = new FakeUpdater();

    createUpdateController({ updater, dialog: createDialog() });

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('reports an up-to-date result after a manual check', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog();
    const controller = createUpdateController({ updater, dialog });

    await controller.checkManually();
    updater.emit('update-not-available', { version: '0.1.9' });
    await flushMicrotasks();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        title: '检查更新',
        message: '已经是最新版本'
      })
    );
  });

  it('downloads after confirmation, saves data, then restarts to install', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog([0, 0]);
    const beforeInstall = vi.fn(async () => undefined);
    const controller = createUpdateController({ updater, dialog, beforeInstall });

    await controller.checkSilently();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();

    expect(dialog.showMessageBox).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'info',
        title: '发现新版本',
        message: '发现新版本 0.1.10',
        buttons: ['下载更新', '稍后']
      })
    );
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);

    updater.emit('update-downloaded', { version: '0.1.10' });
    await flushMicrotasks();

    expect(dialog.showMessageBox).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'info',
        title: '更新已下载',
        buttons: ['重启并安装', '稍后']
      })
    );
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(
      updater.quitAndInstall.mock.invocationCallOrder[0]
    );
  });

  it('does not start another check while the update confirmation is open', async () => {
    const updater = new FakeUpdater();
    let resolveUpdatePrompt: ((value: { response: number }) => void) | undefined;
    const updatePrompt = new Promise<{ response: number }>((resolve) => {
      resolveUpdatePrompt = resolve;
    });
    const showMessageBox = vi.fn(
      async (_options: Parameters<UpdateDialog['showMessageBox']>[0]) => ({ response: 0 })
    );
    showMessageBox.mockImplementationOnce(() => updatePrompt);
    const dialog = {
      showMessageBox,
      showErrorBox: vi.fn()
    } satisfies UpdateDialog;
    const controller = createUpdateController({ updater, dialog });

    await controller.checkSilently();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    void controller.checkManually();
    await flushMicrotasks();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveUpdatePrompt?.({ response: 1 });
    await flushMicrotasks();
  });

  it('does not interrupt the user when a silent startup check fails', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog();
    const logError = vi.fn();
    const controller = createUpdateController({ updater, dialog, logError });

    await controller.checkSilently();
    updater.emit('error', new Error('offline'));
    await flushMicrotasks();

    expect(dialog.showErrorBox).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('explains failures triggered by a manual check', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog();
    const controller = createUpdateController({ updater, dialog, logError: vi.fn() });

    await controller.checkManually();
    updater.emit('error', new Error('offline'));
    await flushMicrotasks();

    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '检查更新失败',
      expect.stringContaining('请稍后重试')
    );
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
