import type { UpdateProgressPresenter } from './update-progress-window';

export type UpdateEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error';

export type UpdateInfo = {
  version?: string;
};

export type UpdateClient = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: UpdateEvent, listener: (value: unknown) => void) => unknown;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export type UpdateMessageBoxOptions = {
  type: 'info' | 'warning';
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  noLink?: boolean;
};

export type UpdateDialog = {
  showMessageBox: (options: UpdateMessageBoxOptions) => Promise<{ response: number }>;
  showErrorBox: (title: string, content: string) => void;
};

export type UpdateController = {
  checkManually: () => Promise<void>;
  checkSilently: () => Promise<void>;
  dispose: () => void;
};

type UpdateControllerOptions = {
  updater: UpdateClient;
  dialog: UpdateDialog;
  progress?: UpdateProgressPresenter;
  beforeInstall?: () => Promise<void>;
  logError?: (message: string, error: unknown) => void;
};

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'awaiting-download-confirmation'
  | 'downloading'
  | 'awaiting-install-confirmation'
  | 'downloaded-deferred'
  | 'installing';

type UpdateOperation = {
  id: number;
  manual: boolean;
  failureHandled: boolean;
  version?: string;
};

export function shouldEnableAutoUpdates(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  return platform === 'win32' && isPackaged;
}

export function createUpdateController(options: UpdateControllerOptions): UpdateController {
  const beforeInstall = options.beforeInstall ?? (async () => undefined);
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  let phase: UpdatePhase = 'idle';
  let currentOperation: UpdateOperation | undefined;
  let nextOperationId = 0;
  let downloadedVersion: string | undefined;
  let disposed = false;

  options.updater.autoDownload = false;
  options.updater.autoInstallOnAppQuit = true;

  const isCurrent = (operationId: number, expectedPhase: UpdatePhase): boolean => {
    return (
      !disposed &&
      currentOperation?.id === operationId &&
      phase === expectedPhase
    );
  };

  const resetToIdle = (): void => {
    phase = 'idle';
    currentOperation = undefined;
  };

  const finishFailure = (error: unknown, operationId: number | undefined): void => {
    const operation = currentOperation;
    if (
      disposed ||
      !operation ||
      operation.id !== operationId ||
      operation.failureHandled ||
      !['checking', 'awaiting-download-confirmation', 'downloading'].includes(phase)
    ) {
      return;
    }

    operation.failureHandled = true;
    const failedPhase = phase;
    const isDownloadFailure = failedPhase === 'downloading';
    const shouldNotify = operation.manual || isDownloadFailure;
    if (isDownloadFailure) {
      options.progress?.close();
    }
    resetToIdle();
    logError('Auto-update failed', error);

    if (shouldNotify && !disposed) {
      options.dialog.showErrorBox(
        isDownloadFailure ? '下载更新失败' : '检查更新失败',
        '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络。'
      );
    }
  };

  options.updater.on('update-not-available', () => {
    if (disposed || phase !== 'checking' || !currentOperation) {
      return;
    }

    const shouldNotify = currentOperation.manual;
    resetToIdle();
    if (shouldNotify) {
      void options.dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '已经是最新版本',
        noLink: true
      });
    }
  });

  options.updater.on('update-available', (value) => {
    if (disposed || phase !== 'checking' || !currentOperation) {
      return;
    }

    const info = value as UpdateInfo | undefined;
    const version = info?.version?.trim() || undefined;
    const operationId = currentOperation.id;
    currentOperation.version = version;
    phase = 'awaiting-download-confirmation';

    void options.dialog
      .showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: version ? `发现新版本 ${version}` : '发现新版本',
        detail: '是否现在下载更新？下载完成后再由你确认是否重启安装。',
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      .then(async ({ response }) => {
        if (!isCurrent(operationId, 'awaiting-download-confirmation')) {
          return;
        }

        if (response !== 0) {
          resetToIdle();
          return;
        }

        phase = 'downloading';
        options.progress?.showPreparing(version);
        await options.updater.downloadUpdate().catch((error) => {
          finishFailure(error, operationId);
        });
      })
      .catch((error) => {
        finishFailure(error, operationId);
      });
  });

  options.updater.on('download-progress', (value) => {
    if (disposed || phase !== 'downloading' || !currentOperation) {
      return;
    }

    options.progress?.update(value);
  });

  options.updater.on('update-downloaded', (value) => {
    if (disposed || phase !== 'downloading' || !currentOperation) {
      return;
    }

    const info = value as UpdateInfo | undefined;
    const version = info?.version?.trim() || currentOperation.version;
    const operationId = currentOperation.id;
    phase = 'awaiting-install-confirmation';
    options.progress?.close();

    void options.dialog
      .showMessageBox({
        type: 'info',
        title: '更新已下载',
        message: version ? `版本 ${version} 已下载完成` : '更新已下载完成',
        detail: '重启应用后会自动完成安装，便签数据会保留。',
        buttons: ['重启并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      .then(async ({ response }) => {
        if (!isCurrent(operationId, 'awaiting-install-confirmation')) {
          return;
        }

        if (response !== 0) {
          downloadedVersion = version;
          phase = 'downloaded-deferred';
          currentOperation = undefined;
          return;
        }

        phase = 'installing';
        try {
          await beforeInstall();
          if (disposed || currentOperation?.id !== operationId || phase !== 'installing') {
            return;
          }
          options.updater.quitAndInstall(true, true);
        } catch (error) {
          resetToIdle();
          logError('Unable to prepare auto-update installation', error);
          if (!disposed) {
            options.dialog.showErrorBox(
              '安装更新失败',
              '便签暂时无法退出安装，请稍后再试。'
            );
          }
        }
      })
      .catch((error) => {
        if (!isCurrent(operationId, 'awaiting-install-confirmation')) {
          return;
        }
        downloadedVersion = version;
        phase = 'downloaded-deferred';
        currentOperation = undefined;
        logError('Unable to show auto-update installation prompt', error);
      });
  });

  options.updater.on('error', (error) => {
    finishFailure(error, currentOperation?.id);
  });

  const showBusyState = async (): Promise<void> => {
    if (phase === 'downloading') {
      options.progress?.focus();
      return;
    }

    if (phase === 'downloaded-deferred') {
      await options.dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '更新已经下载',
        detail: downloadedVersion
          ? `版本 ${downloadedVersion} 会在退出应用后安装。`
          : '更新会在退出应用后安装。',
        noLink: true
      });
      return;
    }

    await options.dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message:
        phase === 'checking'
          ? '正在检查更新'
          : phase === 'awaiting-download-confirmation' ||
              phase === 'awaiting-install-confirmation'
            ? '请先处理当前更新提示'
            : '正在准备安装更新',
      noLink: true
    });
  };

  const startCheck = async (isManual: boolean): Promise<void> => {
    if (disposed) {
      return;
    }

    if (phase !== 'idle') {
      if (isManual) {
        await showBusyState();
      }
      return;
    }

    phase = 'checking';
    currentOperation = {
      id: ++nextOperationId,
      manual: isManual,
      failureHandled: false
    };
    const operationId = currentOperation.id;
    await options.updater.checkForUpdates().catch((error) => {
      finishFailure(error, operationId);
    });
  };

  return {
    checkManually: () => startCheck(true),
    checkSilently: () => startCheck(false),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      resetToIdle();
      options.progress?.dispose();
    }
  };
}
