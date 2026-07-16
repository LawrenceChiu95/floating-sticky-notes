import { describe, expect, it, vi } from 'vitest';
import {
  createReleaseFeedbackController,
  type ReleaseFeedbackPresenter
} from '../main/release-feedback';
import type { ReleaseFeedbackStateStore } from '../main/release-feedback-state';
import type { ReleaseNotesArchive } from '../shared/release-notes';

const archive: ReleaseNotesArchive = {
  releases: [
    {
      version: '0.1.13',
      date: '2026-07-15',
      sections: [{ title: '变更', items: ['恢复差分更新'] }]
    },
    {
      version: '0.1.14',
      date: '2026-07-16',
      sections: [
        { title: '新增', items: ['支持一层可选子任务'] },
        { title: '修复', items: ['窄便签中的待办文字可以完整换行'] }
      ]
    },
    {
      version: '0.1.15',
      date: '2026-07-17',
      sections: [{ title: '新增', items: ['自有更新说明窗口'] }]
    }
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

function createPresenter(
  result: { shown: boolean; source: 'automatic' | 'manual' } = {
    shown: true,
    source: 'automatic'
  }
): ReleaseFeedbackPresenter & { show: ReturnType<typeof vi.fn> } {
  return {
    show: vi.fn(async () => result),
    dispose: vi.fn()
  };
}

describe('release feedback controller', () => {
  it('shows every unseen stable release in ascending order and then records the current version', async () => {
    const store = createStore('0.1.12');
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.15',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();
    await controller.showAutomaticallyIfNeeded();

    expect(presenter.show).toHaveBeenCalledOnce();
    expect(presenter.show).toHaveBeenCalledWith({
      initiatedBy: 'automatic',
      version: '0.1.15',
      releases: archive.releases
    });
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith('0.1.15');
  });

  it('shows all archived releases through the current version for an old install without a baseline', async () => {
    const store = createStore();
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(presenter.show).toHaveBeenCalledWith({
      initiatedBy: 'automatic',
      version: '0.1.14',
      releases: archive.releases.slice(0, 2)
    });
    expect(store.save).toHaveBeenCalledWith('0.1.14');
  });

  it.each([
    ['same version', '0.1.14'],
    ['downgrade', '0.1.15']
  ])('does not auto-show or overwrite state for %s', async (_label, lastShownReleaseVersion) => {
    const store = createStore(lastShownReleaseVersion);
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(presenter.show).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('establishes a baseline for a fresh install without showing a window', async () => {
    const store = createStore();
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: false,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.save).toHaveBeenCalledWith('0.1.14');
    expect(presenter.show).not.toHaveBeenCalled();
  });

  it.each([
    ['development', false, '0.1.14'],
    ['prerelease', true, '0.1.14-rc.1']
  ])('does not auto-show or touch state for %s builds', async (_label, isPackaged, version) => {
    const store = createStore('0.1.13');
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: version,
      isPackaged,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(presenter.show).not.toHaveBeenCalled();
  });

  it('still permits manual viewing in development and prerelease builds using only the stable core chapter', async () => {
    const store = createStore('0.1.13');
    const presenter = createPresenter({ shown: true, source: 'manual' });
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14-rc.1',
      isPackaged: false,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showCurrentRelease();

    expect(presenter.show).toHaveBeenCalledWith({
      initiatedBy: 'manual',
      version: '0.1.14-rc.1',
      releases: [archive.releases[1]]
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('opens manual viewing with an empty release list when the current chapter is unavailable', async () => {
    const presenter = createPresenter({ shown: true, source: 'manual' });
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.16',
      isPackaged: false,
      hadExistingInstallation: false,
      releaseNotes: archive,
      stateStore: createStore(),
      presenter
    });

    await controller.initialize();
    await controller.showCurrentRelease();

    expect(presenter.show).toHaveBeenCalledWith({
      initiatedBy: 'manual',
      version: '0.1.16',
      releases: []
    });
  });

  it('records an automatic baseline without opening a window when no release is available', async () => {
    const store = createStore('0.1.15');
    const presenter = createPresenter();
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.16',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });

    await controller.initialize();
    await controller.showAutomaticallyIfNeeded();

    expect(presenter.show).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledWith('0.1.16');
  });

  it('does not mark a manual-first single-flight as automatically shown', async () => {
    let resolvePresentation:
      | ((value: { shown: boolean; source: 'automatic' | 'manual' }) => void)
      | undefined;
    const store = createStore('0.1.13');
    const presenter: ReleaseFeedbackPresenter = {
      show: vi.fn(
        () =>
          new Promise<{ shown: boolean; source: 'automatic' | 'manual' }>((resolve) => {
            resolvePresentation = resolve;
          })
      ),
      dispose: vi.fn()
    };
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: store,
      presenter
    });
    await controller.initialize();

    const manual = controller.showCurrentRelease();
    const automatic = controller.showAutomaticallyIfNeeded();
    resolvePresentation?.({ shown: true, source: 'manual' });
    await Promise.all([manual, automatic]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not mark the version when automatic presentation fails or reuses a manual window', async () => {
    for (const result of [
      { shown: false, source: 'automatic' as const },
      { shown: true, source: 'manual' as const }
    ]) {
      const store = createStore('0.1.13');
      const controller = createReleaseFeedbackController({
        currentVersion: '0.1.14',
        isPackaged: true,
        hadExistingInstallation: true,
        releaseNotes: archive,
        stateStore: store,
        presenter: createPresenter(result)
      });

      await controller.initialize();
      await controller.showAutomaticallyIfNeeded();
      expect(store.save).not.toHaveBeenCalled();
    }
  });

  it('disposes the presenter and refuses to create windows after quit begins', async () => {
    const presenter = createPresenter({ shown: true, source: 'manual' });
    const controller = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: false,
      hadExistingInstallation: false,
      releaseNotes: archive,
      stateStore: createStore(),
      presenter
    });
    await controller.initialize();

    controller.beginQuit();
    await controller.showCurrentRelease();

    expect(presenter.dispose).toHaveBeenCalledOnce();
    expect(presenter.show).not.toHaveBeenCalled();
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
      releaseNotes: archive,
      stateStore,
      presenter: createPresenter(),
      logWarning
    });

    await controller.initialize();
    await expect(controller.showAutomaticallyIfNeeded()).resolves.toBeUndefined();
    expect(logWarning).toHaveBeenCalledWith(
      'Unable to save release feedback state',
      expect.any(Error)
    );
  });

  it('skips automatic feedback on unreliable reads and tolerates fresh-install baseline writes failing', async () => {
    const unreliableStore: ReleaseFeedbackStateStore = {
      load: vi.fn(async () => ({ kind: 'unavailable' as const })),
      save: vi.fn(async () => undefined)
    };
    const unreliablePresenter = createPresenter();
    const unreliableController = createReleaseFeedbackController({
      currentVersion: '0.1.14',
      isPackaged: true,
      hadExistingInstallation: true,
      releaseNotes: archive,
      stateStore: unreliableStore,
      presenter: unreliablePresenter
    });

    await unreliableController.initialize();
    await unreliableController.showAutomaticallyIfNeeded();
    expect(unreliablePresenter.show).not.toHaveBeenCalled();

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
      releaseNotes: archive,
      stateStore: failingStore,
      presenter: createPresenter(),
      logWarning
    });

    await expect(freshController.initialize()).resolves.toBeUndefined();
    expect(logWarning).toHaveBeenCalledWith(
      'Unable to save release feedback state',
      expect.any(Error)
    );
  });
});
