import { createSafeDiagnosticRecorder, type DiagnosticRecorder } from './diagnostics';
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
  disableWebInstaller: boolean;
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
  diagnostics?: DiagnosticRecorder;
  beforeInstall?: () => Promise<void>;
  logError?: (message: string, error: unknown) => void;
};

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'check-complete'
  | 'awaiting-download-confirmation'
  | 'downloading'
  | 'awaiting-install-confirmation'
  | 'downloaded-deferred'
  | 'installing'
  | 'failed';

type UpdateOperation = {
  id: number;
  manual: boolean;
  failureHandled: boolean;
  checkPending: boolean;
  downloadPending: boolean;
  version?: string;
};

export function shouldEnableAutoUpdates(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  return platform === 'win32' && isPackaged;
}

export function createUpdateController(options: UpdateControllerOptions): UpdateController {
  const beforeInstall = options.beforeInstall ?? (async () => undefined);
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  const recordDiagnostic = createSafeDiagnosticRecorder(options.diagnostics).record;
  let phase: UpdatePhase = 'idle';
  let currentOperation: UpdateOperation | undefined;
  let nextOperationId = 0;
  let downloadedVersion: string | undefined;
  let disposed = false;

  options.updater.autoDownload = false;
  options.updater.autoInstallOnAppQuit = true;
  options.updater.disableWebInstaller = true;

  const isCurrent = (operationId: number, expectedPhase: UpdatePhase): boolean => {
    return (
      !disposed &&
      currentOperation?.id === operationId &&
      phase === expectedPhase
    );
  };

  const setPhase = (nextPhase: UpdatePhase, operationId: number | undefined): void => {
    const previousPhase = phase;
    phase = nextPhase;
    if (previousPhase !== nextPhase) {
      recordDiagnostic('update_phase_changed', {
        operationId,
        from: previousPhase,
        to: nextPhase
      });
    }
  };

  const resetToIdle = (): void => {
    const operationId = currentOperation?.id;
    setPhase('idle', operationId);
    currentOperation = undefined;
  };

  const settleOperationPromise = (
    operationId: number,
    promise: 'check' | 'download'
  ): void => {
    const operation = currentOperation;
    if (!operation || operation.id !== operationId) {
      return;
    }

    if (promise === 'check') {
      operation.checkPending = false;
    } else {
      operation.downloadPending = false;
    }
    recordDiagnostic('update_promise_settled', {
      operationId,
      promise,
      phase,
      checkPending: operation.checkPending,
      downloadPending: operation.downloadPending
    });

    if (
      (phase === 'failed' || phase === 'check-complete') &&
      !operation.checkPending &&
      !operation.downloadPending
    ) {
      resetToIdle();
    }
  };

  const finishFailure = (error: unknown, operationId: number | undefined): void => {
    const operation = currentOperation;
    if (
      disposed ||
      !operation ||
      operation.id !== operationId ||
      operation.failureHandled ||
      !['checking', 'awaiting-download-confirmation', 'downloading', 'installing'].includes(phase)
    ) {
      return;
    }

    operation.failureHandled = true;
    const failedPhase = phase;
    const isDownloadFailure = failedPhase === 'downloading';
    const isInstallFailure = failedPhase === 'installing';
    const shouldNotify = operation.manual || isDownloadFailure || isInstallFailure;
    if (isDownloadFailure) {
      options.progress?.close();
    }
    setPhase('failed', operation.id);
    recordDiagnostic('update_operation_failed', {
      operationId: operation.id,
      source: operation.manual ? 'manual' : 'startup',
      failedPhase,
      error
    });
    logError('Auto-update failed', error);

    if (shouldNotify && !disposed) {
      options.dialog.showErrorBox(
        isInstallFailure
          ? '安装更新失败'
          : isDownloadFailure
            ? '下载更新失败'
            : '检查更新失败',
        isInstallFailure
          ? '便签暂时无法退出安装，请稍后再试。'
          : '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络。'
      );
    }

    if (!operation.checkPending && !operation.downloadPending) {
      resetToIdle();
    }
  };

  const recordUpdaterEvent = (
    event: UpdateEvent,
    details: Record<string, unknown> = {}
  ): void => {
    recordDiagnostic('updater_event', {
      operationId: currentOperation?.id,
      event,
      phase,
      ...details
    });
  };

  options.updater.on('checking-for-update', () => {
    recordUpdaterEvent('checking-for-update');
  });

  options.updater.on('update-not-available', (value) => {
    const info = value as UpdateInfo | undefined;
    const version = info?.version?.trim() || undefined;
    recordUpdaterEvent('update-not-available', { version });
    if (disposed || phase !== 'checking' || !currentOperation) {
      return;
    }

    const shouldNotify = currentOperation.manual;
    setPhase('check-complete', currentOperation.id);
    if (!currentOperation.checkPending) {
      resetToIdle();
    }
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
    const info = value as UpdateInfo | undefined;
    const version = info?.version?.trim() || undefined;
    recordUpdaterEvent('update-available', { version });
    if (disposed || phase !== 'checking' || !currentOperation) {
      return;
    }

    const operationId = currentOperation.id;
    currentOperation.version = version;
    setPhase('awaiting-download-confirmation', operationId);

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
          setPhase('check-complete', operationId);
          if (!currentOperation?.checkPending) {
            resetToIdle();
          }
          return;
        }

        setPhase('downloading', operationId);
        options.progress?.showPreparing(version);
        const operation = currentOperation;
        if (!operation || operation.id !== operationId) {
          return;
        }
        operation.downloadPending = true;
        try {
          await options.updater.downloadUpdate();
        } catch (error) {
          finishFailure(error, operationId);
        } finally {
          settleOperationPromise(operationId, 'download');
        }
      })
      .catch((error) => {
        finishFailure(error, operationId);
      });
  });

  options.updater.on('download-progress', (value) => {
    recordUpdaterEvent('download-progress', {
      percent: (value as { percent?: unknown } | undefined)?.percent
    });
    if (disposed || phase !== 'downloading' || !currentOperation) {
      return;
    }

    options.progress?.update(value);
  });

  options.updater.on('update-downloaded', (value) => {
    const receivedVersion = (value as UpdateInfo | undefined)?.version?.trim() || undefined;
    recordUpdaterEvent('update-downloaded', { version: receivedVersion });
    if (disposed || phase !== 'downloading' || !currentOperation) {
      return;
    }

    const expectedVersion = currentOperation.version;
    if (!expectedVersion || !receivedVersion || expectedVersion !== receivedVersion) {
      finishFailure(
        {
          reason: 'unexpected-downloaded-version',
          expectedVersion,
          receivedVersion
        },
        currentOperation.id
      );
      return;
    }
    const version = receivedVersion;
    const operationId = currentOperation.id;
    setPhase('awaiting-install-confirmation', operationId);
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
          setPhase('downloaded-deferred', operationId);
          currentOperation = undefined;
          return;
        }

        setPhase('installing', operationId);
        try {
          await beforeInstall();
          if (disposed || currentOperation?.id !== operationId || phase !== 'installing') {
            return;
          }
          options.updater.quitAndInstall(true, true);
        } catch (error) {
          finishFailure(error, operationId);
        }
      })
      .catch((error) => {
        if (!isCurrent(operationId, 'awaiting-install-confirmation')) {
          return;
        }
        downloadedVersion = version;
        setPhase('downloaded-deferred', operationId);
        currentOperation = undefined;
        logError('Unable to show auto-update installation prompt', error);
      });
  });

  options.updater.on('error', (error) => {
    recordUpdaterEvent('error', { error });
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
          : phase === 'check-complete'
            ? '正在结束本次更新检查'
            : phase === 'failed'
              ? '正在结束上一次更新操作'
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
      recordDiagnostic('update_check_busy', {
        operationId: currentOperation?.id,
        requestedSource: isManual ? 'manual' : 'startup',
        activeSource: currentOperation?.manual ? 'manual' : 'startup',
        phase
      });
      if (isManual) {
        await showBusyState();
      }
      return;
    }

    currentOperation = {
      id: ++nextOperationId,
      manual: isManual,
      failureHandled: false,
      checkPending: true,
      downloadPending: false
    };
    const operationId = currentOperation.id;
    setPhase('checking', operationId);
    recordDiagnostic('update_check_started', {
      operationId,
      source: isManual ? 'manual' : 'startup'
    });
    try {
      const result = await options.updater.checkForUpdates();
      const latestVersion = (result as { updateInfo?: UpdateInfo } | undefined)?.updateInfo?.version;
      recordDiagnostic('update_check_resolved', { operationId, latestVersion });
    } catch (error) {
      recordDiagnostic('update_check_rejected', { operationId, error });
      finishFailure(error, operationId);
    } finally {
      settleOperationPromise(operationId, 'check');
    }
  };

  return {
    checkManually: () => startCheck(true),
    checkSilently: () => startCheck(false),
    dispose: () => {
      if (disposed) {
        return;
      }
      recordDiagnostic('update_controller_disposed', {
        operationId: currentOperation?.id,
        phase
      });
      disposed = true;
      resetToIdle();
      options.progress?.dispose();
    }
  };
}
