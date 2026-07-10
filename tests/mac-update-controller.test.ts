import { describe, expect, it, vi } from 'vitest';
import {
  createMacUpdateController,
  shouldEnableMacManualUpdates,
  type MacUpdateDialog,
  type MacUpdateInfo,
  type MacUpdateService
} from '../main/mac-update-controller';

const newerUpdate: MacUpdateInfo = {
  version: '0.1.10',
  fileName: 'StickyNotes-Mac-0.1.10.dmg',
  sha512: Buffer.alloc(64, 1).toString('base64'),
  size: 128
};

function createDialog(responses: number[] = []): MacUpdateDialog {
  return {
    showMessageBox: vi.fn(async () => ({ response: responses.shift() ?? 0 })),
    showErrorBox: vi.fn()
  };
}

function createService(update: MacUpdateInfo = newerUpdate): MacUpdateService {
  return {
    getLatest: vi.fn(async () => update),
    download: vi.fn(async (_update, onProgress) => {
      onProgress(0.5);
      onProgress(1);
      return `/Downloads/${update.fileName}`;
    }),
    openInstaller: vi.fn(async () => undefined)
  };
}

describe('macOS manual update platform policy', () => {
  it('enables the flow only for packaged macOS builds', () => {
    expect(shouldEnableMacManualUpdates('darwin', true)).toBe(true);
    expect(shouldEnableMacManualUpdates('darwin', false)).toBe(false);
    expect(shouldEnableMacManualUpdates('win32', true)).toBe(false);
    expect(shouldEnableMacManualUpdates('linux', true)).toBe(false);
  });
});

describe('macOS manual update controller', () => {
  it('reports an up-to-date result after a manual check', async () => {
    const dialog = createDialog();
    const service = createService({ ...newerUpdate, version: '0.1.9' });
    const controller = createMacUpdateController({
      currentVersion: '0.1.9',
      dialog,
      service
    });

    await controller.checkManually();

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: '检查更新', message: '已经是最新版本' })
    );
    expect(service.download).not.toHaveBeenCalled();
  });

  it('downloads after confirmation, opens the DMG, then quits', async () => {
    const dialog = createDialog([0, 0]);
    const service = createService();
    const beforeInstall = vi.fn(async () => undefined);
    const quit = vi.fn();
    const setProgress = vi.fn();
    const controller = createMacUpdateController({
      currentVersion: '0.1.9',
      dialog,
      service,
      beforeInstall,
      quit,
      setProgress
    });

    await controller.checkSilently();

    expect(dialog.showMessageBox).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: '发现新版本',
        message: '发现新版本 0.1.10',
        buttons: ['下载更新', '稍后']
      })
    );
    expect(service.download).toHaveBeenCalledWith(newerUpdate, expect.any(Function));
    expect(setProgress).toHaveBeenCalledWith(0.5);
    expect(setProgress).toHaveBeenCalledWith(1);
    expect(setProgress).toHaveBeenLastCalledWith(-1);
    expect(dialog.showMessageBox).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: '更新已下载',
        buttons: ['退出并打开安装镜像', '稍后安装']
      })
    );
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(service.openInstaller).toHaveBeenCalledWith('/Downloads/StickyNotes-Mac-0.1.10.dmg');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(beforeInstall.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(service.openInstaller).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(service.openInstaller).mock.invocationCallOrder[0]).toBeLessThan(
      quit.mock.invocationCallOrder[0]
    );
  });

  it('does not download when the user postpones the update', async () => {
    const dialog = createDialog([1]);
    const service = createService();
    const controller = createMacUpdateController({
      currentVersion: '0.1.9',
      dialog,
      service
    });

    await controller.checkSilently();

    expect(service.download).not.toHaveBeenCalled();
  });

  it('keeps silent startup failures quiet but reports manual failures', async () => {
    const service = createService();
    vi.mocked(service.getLatest).mockRejectedValue(new Error('offline'));
    const dialog = createDialog();
    const controller = createMacUpdateController({
      currentVersion: '0.1.9',
      dialog,
      service,
      logError: vi.fn()
    });

    await controller.checkSilently();
    expect(dialog.showErrorBox).not.toHaveBeenCalled();

    await controller.checkManually();
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '检查更新失败',
      expect.stringContaining('请稍后重试')
    );
  });
});
