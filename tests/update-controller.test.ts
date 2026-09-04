import { describe, expect, it, vi } from 'vitest';
import {
  createUpdateController,
  shouldEnableAutoUpdates,
  type UpdateClient,
  type UpdateDialog
} from '../main/update-controller';
import type { UpdateProgressPresenter } from '../main/update-progress-window';

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
  disableWebInstaller = false;
  readonly checkForUpdates = vi.fn(async (): Promise<unknown> => undefined);
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

function createProgressPresenter() {
  return {
    showPreparing: vi.fn(),
    update: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    dispose: vi.fn()
  } satisfies UpdateProgressPresenter;
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
    expect(updater.disableWebInstaller).toBe(true);
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
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog, beforeInstall, progress });

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
    expect(progress.showPreparing).toHaveBeenCalledWith('0.1.10');
    expect(progress.showPreparing.mock.invocationCallOrder[0]).toBeLessThan(
      updater.downloadUpdate.mock.invocationCallOrder[0]
    );

    updater.emit('download-progress', { percent: 51.2 });
    expect(progress.update).toHaveBeenCalledWith({ percent: 51.2 });

    updater.emit('update-downloaded', { version: '0.1.10' });
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
    expect(progress.close).toHaveBeenCalledTimes(1);
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(
      updater.quitAndInstall.mock.invocationCallOrder[0]
    );
  });

  it('recovers when quitAndInstall emits an updater error', async () => {
    const updater = new FakeUpdater();
    const error = new Error('installer launch failed');
    updater.quitAndInstall.mockImplementationOnce(() => {
      updater.emit('error', error);
    });
    const dialog = createDialog([0, 0]);
    const logError = vi.fn();
    const controller = createUpdateController({ updater, dialog, logError });

    await controller.checkManually();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    updater.emit('update-downloaded', { version: '0.1.10' });
    await flushMicrotasks();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '安装更新失败',
      expect.stringContaining('请稍后再试')
    );

    await controller.checkManually();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not let an old confirmation start a download after failure', async () => {
    const updater = new FakeUpdater();
    let resolveUpdatePrompt: ((value: { response: number }) => void) | undefined;
    const updatePrompt = new Promise<{ response: number }>((resolve) => {
      resolveUpdatePrompt = resolve;
    });
    const dialog = {
      showMessageBox: vi.fn(() => updatePrompt),
      showErrorBox: vi.fn()
    } satisfies UpdateDialog;
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog, progress, logError: vi.fn() });

    await controller.checkSilently();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    updater.emit('error', new Error('metadata invalidated'));
    resolveUpdatePrompt?.({ response: 0 });
    await flushMicrotasks();

    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(progress.showPreparing).not.toHaveBeenCalled();
  });

  it('handles download rejection and updater error only once', async () => {
    const updater = new FakeUpdater();
    const error = new Error('offline');
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('error', error);
      throw error;
    });
    const dialog = createDialog([0]);
    const progress = createProgressPresenter();
    const logError = vi.fn();
    const controller = createUpdateController({ updater, dialog, progress, logError });

    await controller.checkManually();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();

    expect(progress.close).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(dialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '下载更新失败',
      expect.stringContaining('请稍后重试')
    );
  });

  it('does not start a new check until a failed check promise settles', async () => {
    const updater = new FakeUpdater();
    let resolveCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        resolveCheck = () => resolve(undefined);
      })
    );
    const dialog = createDialog();
    const controller = createUpdateController({ updater, dialog, logError: vi.fn() });

    void controller.checkManually();
    await flushMicrotasks();
    updater.emit('error', new Error('offline'));
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not start a new check until a successful check promise settles', async () => {
    const updater = new FakeUpdater();
    let resolveCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        resolveCheck = () => resolve(undefined);
      })
    );
    const controller = createUpdateController({
      updater,
      dialog: createDialog(),
      logError: vi.fn()
    });

    void controller.checkManually();
    await flushMicrotasks();
    updater.emit('update-not-available', { version: '0.1.10' });
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not start a new check after deferring while the check promise is pending', async () => {
    const updater = new FakeUpdater();
    let resolveCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        resolveCheck = () => resolve(undefined);
      })
    );
    const controller = createUpdateController({
      updater,
      dialog: createDialog([1]),
      logError: vi.fn()
    });

    void controller.checkManually();
    await flushMicrotasks();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not start a new check until a failed download promise settles', async () => {
    const updater = new FakeUpdater();
    let resolveDownload: (() => void) | undefined;
    updater.downloadUpdate.mockImplementationOnce(
      () => new Promise<never[]>((resolve) => {
        resolveDownload = () => resolve([]);
      })
    );
    const dialog = createDialog([0]);
    const controller = createUpdateController({ updater, dialog, logError: vi.fn() });

    await controller.checkManually();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    updater.emit('error', new Error('download interrupted'));
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveDownload?.();
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '0.1.9'])(
    'fails a downloaded event whose version is %s',
    async (receivedVersion) => {
      const updater = new FakeUpdater();
      const dialog = createDialog([0]);
      const progress = createProgressPresenter();
      const logError = vi.fn();
      const controller = createUpdateController({ updater, dialog, progress, logError });

      await controller.checkManually();
      updater.emit('update-available', { version: '0.1.10' });
      await flushMicrotasks();
      updater.emit(
        'update-downloaded',
        receivedVersion === undefined ? {} : { version: receivedVersion }
      );
      await flushMicrotasks();

      expect(progress.close).toHaveBeenCalledTimes(1);
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        '下载更新失败',
        expect.stringContaining('请稍后重试')
      );
      expect(logError).toHaveBeenCalledWith(
        'Auto-update failed',
        expect.objectContaining({
          expectedVersion: '0.1.10',
          receivedVersion
        })
      );

      await controller.checkManually();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    }
  );

  it('ignores progress outside the downloading phase', async () => {
    const updater = new FakeUpdater();
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog: createDialog(), progress });

    updater.emit('download-progress', { percent: 25 });
    await controller.checkSilently();
    updater.emit('download-progress', { percent: 50 });

    expect(progress.update).not.toHaveBeenCalled();
  });

  it('focuses the existing progress window for a manual check during download', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog([0]);
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog, progress });

    await controller.checkSilently();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(progress.focus).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('does not check or download again after the install prompt is deferred', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog([0, 1]);
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog, progress });

    await controller.checkManually();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    updater.emit('update-downloaded', { version: '0.1.10' });
    await flushMicrotasks();
    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '更新已经下载' })
    );
  });

  it('disposes progress UI and ignores later updater events', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog([0]);
    const progress = createProgressPresenter();
    const controller = createUpdateController({ updater, dialog, progress, logError: vi.fn() });

    await controller.checkSilently();
    updater.emit('update-available', { version: '0.1.10' });
    await flushMicrotasks();
    controller.dispose();
    updater.emit('error', new Error('late failure'));
    updater.emit('update-downloaded', { version: '0.1.10' });
    await flushMicrotasks();

    expect(progress.dispose).toHaveBeenCalledTimes(1);
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
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

  it('records automatic/manual operation and busy-check diagnostics without changing behavior', async () => {
    const updater = new FakeUpdater();
    let resolveCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        resolveCheck = () => resolve(undefined);
      })
    );
    const record = vi.fn();
    const controller = createUpdateController({
      updater,
      dialog: createDialog(),
      diagnostics: { record }
    });

    void controller.checkSilently();
    await flushMicrotasks();
    await controller.checkManually();
    updater.emit('update-not-available', { version: '0.1.17' });
    resolveCheck?.();
    await flushMicrotasks();

    expect(record).toHaveBeenCalledWith(
      'update_check_started',
      expect.objectContaining({ operationId: 1, source: 'startup' })
    );
    expect(record).toHaveBeenCalledWith(
      'update_check_busy',
      expect.objectContaining({
        operationId: 1,
        requestedSource: 'manual',
        activeSource: 'startup',
        phase: 'checking'
      })
    );
    expect(record).toHaveBeenCalledWith(
      'updater_event',
      expect.objectContaining({ event: 'update-not-available' })
    );
    expect(record).toHaveBeenCalledWith(
      'update_check_resolved',
      expect.objectContaining({ operationId: 1 })
    );
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('records updater rejection details while preserving manual error feedback', async () => {
    const updater = new FakeUpdater();
    const error = Object.assign(new Error('network failed'), { code: 'ERR_CONNECTION_RESET' });
    updater.checkForUpdates.mockRejectedValue(error);
    const dialog = createDialog();
    const record = vi.fn();
    const controller = createUpdateController({
      updater,
      dialog,
      diagnostics: { record },
      logError: vi.fn()
    });

    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      'update_check_rejected',
      expect.objectContaining({ operationId: 1, error, attempt: 0 })
    );
    expect(record).toHaveBeenCalledWith(
      'update_check_retry',
      expect.objectContaining({ operationId: 1, action: 'retry', attempt: 1 })
    );
    expect(record).toHaveBeenCalledWith(
      'update_operation_failed',
      expect.objectContaining({ operationId: 1, source: 'manual', failedPhase: 'checking' })
    );
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '检查更新失败',
      '连接更新服务器超时或被中断，请稍后重试。'
    );
  });

  it('ignores diagnostic recorder failures without changing update behavior', async () => {
    const updater = new FakeUpdater();
    const dialog = createDialog();
    const controller = createUpdateController({
      updater,
      dialog,
      diagnostics: {
        record: () => {
          throw new Error('log target unavailable');
        }
      }
    });

    const check = controller.checkManually();
    updater.emit('update-not-available', { version: '0.1.17' });
    await check;

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: '检查更新', message: '已经是最新版本' })
    );
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

  it('explains proxy and tunnel failures on a manual check', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'));
    const dialog = createDialog();
    const setProxyMode = vi.fn(async () => undefined);
    const controller = createUpdateController({
      updater,
      dialog,
      network: { setProxyMode },
      logError: vi.fn()
    });

    await controller.checkManually();

    expect(setProxyMode).toHaveBeenNthCalledWith(1, 'system');
    expect(setProxyMode).toHaveBeenNthCalledWith(2, 'direct');
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '检查更新失败',
      '当前网络代理或 VPN 连不上更新服务器。请关闭失效的代理/VPN，或换一个网络后再试。'
    );
  });

  it('retries a timed-out check once without changing proxy settings', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates
      .mockImplementationOnce(async () => {
        const error = new Error('net::ERR_CONNECTION_TIMED_OUT');
        updater.emit('error', error);
        throw error;
      })
      .mockResolvedValueOnce({ updateInfo: { version: '0.1.19' } });
    const dialog = createDialog();
    const setProxyMode = vi.fn(async () => undefined);
    const record = vi.fn();
    const controller = createUpdateController({
      updater,
      dialog,
      network: { setProxyMode },
      diagnostics: { record },
      logError: vi.fn()
    });

    const check = controller.checkManually();
    await flushMicrotasks();
    updater.emit('update-not-available', { version: '0.1.19' });
    await check;

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(setProxyMode).toHaveBeenCalledTimes(1);
    expect(setProxyMode).toHaveBeenCalledWith('system');
    expect(record).toHaveBeenCalledWith(
      'update_check_retry',
      expect.objectContaining({ action: 'retry', attempt: 1 })
    );
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: '已经是最新版本' })
    );
  });

  it('retries a proxy failure over a direct connection', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates
      .mockImplementationOnce(async () => {
        const error = new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
        updater.emit('error', error);
        throw error;
      })
      .mockResolvedValueOnce({ updateInfo: { version: '0.1.19' } });
    const dialog = createDialog();
    const setProxyMode = vi.fn(async () => undefined);
    const record = vi.fn();
    const controller = createUpdateController({
      updater,
      dialog,
      network: { setProxyMode },
      diagnostics: { record },
      logError: vi.fn()
    });

    const check = controller.checkManually();
    await flushMicrotasks();
    updater.emit('update-not-available', { version: '0.1.19' });
    await check;

    expect(setProxyMode).toHaveBeenNthCalledWith(1, 'system');
    expect(setProxyMode).toHaveBeenNthCalledWith(2, 'direct');
    expect(setProxyMode.mock.invocationCallOrder[1]).toBeLessThan(
      updater.checkForUpdates.mock.invocationCallOrder[1]
    );
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      'update_check_retry',
      expect.objectContaining({ action: 'retry-direct', attempt: 1 })
    );
    expect(dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it('does not retry a second timeout and still reports the last error', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_TIMED_OUT'))
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'));
    const dialog = createDialog();
    const controller = createUpdateController({ updater, dialog, logError: vi.fn() });

    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(dialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '检查更新失败',
      '连接更新服务器超时或被中断，请稍后重试。'
    );
  });

  it('does not retry generic check failures', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    const dialog = createDialog();
    const setProxyMode = vi.fn(async () => undefined);
    const controller = createUpdateController({
      updater,
      dialog,
      network: { setProxyMode },
      logError: vi.fn()
    });

    await controller.checkManually();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(setProxyMode).toHaveBeenCalledTimes(1);
    expect(setProxyMode).toHaveBeenCalledWith('system');
    expect(dialog.showErrorBox).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
