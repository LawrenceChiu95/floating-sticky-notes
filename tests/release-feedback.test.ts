import { describe, expect, it, vi } from 'vitest';
import {
  createReleaseFeedbackController,
  type ReleaseFeedbackDialog
} from '../main/release-feedback';
import type { ReleaseFeedbackStateStore } from '../main/release-feedback-state';
import type { ReleaseNotes } from '../shared/release-notes';

const notes: ReleaseNotes = {
  sourceVersion: '0.1.14',
  sections: [
    { title: '新增', items: ['支持一层可选子任务'] },
    { title: '修复', items: ['窄便签中的待办文字可以完整换行'] }
  ]
};

function createStore(lastShownReleaseVersion?: string): ReleaseFeedbackStateStore & {
  save: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => ({
      kind: 'available' as const,
      ...(lastShownReleaseVersion ? { lastShownReleaseVersion } : {})
    })),
    save: vi.fn(async () => undefined)
  };
}

function createDialog(): ReleaseFeedbackDialog & {
  showMessageBox: ReturnType<typeof vi.fn>;
} {
  return {
    showMessageBox: vi.fn(async () => ({ response: 0 }))
  };
}

describe('release feedback controller', () => {
  it('shows an existing stable packaged installation once and then records the version', async () => {
    const store = createStore('0.1.13');
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();
    await controller.showAutomaticallyIfNeeded();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '本版更新',
        message: '悬浮便签已更新到 v0.1.14',
        detail: expect.stringContaining('新增\n• 支持一层可选子任务')
      })
    );
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith('0.1.14');
  });

  it('uses missing state plus old-install traces to bootstrap the first supported upgrade', async () => {
    const store = createStore();
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith('0.1.14');
  });

  it.each([
    ['same version', '0.1.14'],
    ['downgrade', '0.1.15']
  ])('does not auto-show for %s state', async (_label, lastShownReleaseVersion) => {
    const store = createStore(lastShownReleaseVersion);
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('establishes a baseline for a fresh install before note files are created', async () => {
    const store = createStore();
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: false,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.save).toHaveBeenCalledWith('0.1.14');
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it.each([
    ['development', false, '0.1.14'],
    ['prerelease', true, '0.1.14-rc.1']
  ])('does not auto-show or touch state for %s builds', async (_label, isPackaged, version) => {
    const store = createStore('0.1.13');
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: version,
      isPackaged,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('does not auto-show or touch state before the first supported release', async () => {
    const store = createStore();
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.13',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: { ...notes, sourceVersion: '0.1.13' },
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('still permits manual viewing in development and prerelease builds without writing state', async () => {
    const store = createStore('0.1.13');
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14-rc.1',
      isPackaged: false,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showCurrentRelease();

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: '当前版本 v0.1.14-rc.1' })
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('shows an explicit empty-content fallback for manual viewing', async () => {
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: false,
      hadExistingInstallation: false,
      stateStore: createStore(),
      dialog
    });

    await controller.initialize();
    await controller.showCurrentRelease();

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ detail: '本版本暂无更新说明' })
    );
  });

  it('does not block startup with an empty automatic payload', async () => {
    const store = createStore('0.1.13');
    const dialog = createDialog();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: { sourceVersion: '0.1.14', sections: [] },
      stateStore: store,
      dialog
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledWith('0.1.14');
  });

  it('single-flights repeated clicks and refuses to create dialogs after quit begins', async () => {
    let resolveDialog: ((value: { response: number }) => void) | undefined;
    const showMessageBox = vi.fn(
      () => new Promise<{ response: number }>((resolve) => {
        resolveDialog = resolve;
      })
    );
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: false,
      hadExistingInstallation: false,
      releaseNotes: notes,
      stateStore: createStore(),
      dialog: { showMessageBox }
    });
    await controller.initialize();

    const first = controller.showCurrentRelease();
    const second = controller.showCurrentRelease();
    expect(showMessageBox).toHaveBeenCalledOnce();
    resolveDialog?.({ response: 0 });
    await Promise.all([first, second]);

    controller.beginQuit();
    await controller.showCurrentRelease();
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('does not mark a manual-first single-flight as automatically shown', async () => {
    let resolveDialog: ((value: { response: number }) => void) | undefined;
    const store = createStore('0.1.13');
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog: {
        showMessageBox: vi.fn(
          () => new Promise<{ response: number }>((resolve) => {
            resolveDialog = resolve;
          })
        )
      }
    });
    await controller.initialize();

    const manual = controller.showCurrentRelease();
    const automatic = controller.showAutomaticallyIfNeeded();
    resolveDialog?.({ response: 0 });
    await Promise.all([manual, automatic]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not mark the version when the automatic dialog fails', async () => {
    const store = createStore('0.1.13');
    const logWarning = vi.fn();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: store,
      dialog: {
        showMessageBox: vi.fn(async () => {
          throw new Error('dialog unavailable');
        })
      },
      logWarning
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.save).not.toHaveBeenCalled();
    expect(logWarning).toHaveBeenCalledWith(
      'Unable to show release feedback',
      expect.any(Error)
    );
  });

  it('continues after writing the automatic shown state fails', async () => {
    const logWarning = vi.fn();
    const stateStore: ReleaseFeedbackStateStore = {
      load: vi.fn(async () => ({
        kind: 'available' as const,
        lastShownReleaseVersion: '0.1.13'
      })),
      save: vi.fn(async () => {
        throw new Error('disk full');
      })
    };
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore,
      dialog: createDialog(),
      logWarning
    });

    await controller.initialize();
    await expect(controller.showAutomaticallyIfNeeded()).resolves.toBeUndefined();
    expect(logWarning).toHaveBeenCalledWith(
      'Unable to save release feedback state',
      expect.any(Error)
    );
  });

  it('skips automatic feedback on unreliable reads and tolerates baseline writes failing', async () => {
    const unreliableStore: ReleaseFeedbackStateStore = {
      load: vi.fn(async () => ({ kind: 'unavailable' as const })),
      save: vi.fn(async () => undefined)
    };
    const unreliableDialog = createDialog();
    const unreliableController = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: notes,
      stateStore: unreliableStore,
      dialog: unreliableDialog
    });

    await unreliableController.initialize();
    await unreliableController.showAutomaticallyIfNeeded();
    expect(unreliableDialog.showMessageBox).not.toHaveBeenCalled();

    const logWarning = vi.fn();
    const failingStore: ReleaseFeedbackStateStore = {
      load: vi.fn(async () => ({ kind: 'available' as const })),
      save: vi.fn(async () => {
        throw new Error('disk full');
      })
    };
    const freshController = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: false,
      releaseNotes: notes,
      stateStore: failingStore,
      dialog: createDialog(),
      logWarning
    });

    await expect(freshController.initialize()).resolves.toBeUndefined();
    expect(logWarning).toHaveBeenCalledWith(
      'Unable to save release feedback state',
      expect.any(Error)
    );
  });
});
