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
};

type UpdateControllerOptions = {
  updater: UpdateClient;
  dialog: UpdateDialog;
  beforeInstall?: () => Promise<void>;
  logError?: (message: string, error: unknown) => void;
};

type UpdatePhase = 'idle' | 'checking' | 'prompting' | 'downloading';

export function shouldEnableAutoUpdates(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  return platform === 'win32' && isPackaged;
}

export function createUpdateController(options: UpdateControllerOptions): UpdateController {
  const beforeInstall = options.beforeInstall ?? (async () => undefined);
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  let phase: UpdatePhase = 'idle';
  let manualCheck = false;
  let reportOperationErrors = false;
  let failureHandled = false;

  options.updater.autoDownload = false;
  options.updater.autoInstallOnAppQuit = true;

  const handleError = (error: unknown): void => {
    if (failureHandled) {
      return;
    }

    failureHandled = true;
    const shouldNotify = manualCheck || reportOperationErrors;
    phase = 'idle';
    manualCheck = false;
    reportOperationErrors = false;
    logError('Auto-update failed', error);

    if (shouldNotify) {
      options.dialog.showErrorBox(
        '检查更新失败',
        '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络。'
      );
    }
  };

  options.updater.on('update-not-available', () => {
    const shouldNotify = manualCheck;
    phase = 'idle';
    manualCheck = false;
    reportOperationErrors = false;

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
    const version = info?.version?.trim();
    phase = 'prompting';
    manualCheck = false;

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
        if (response !== 0) {
          phase = 'idle';
          return;
        }

        phase = 'downloading';
        reportOperationErrors = true;
        failureHandled = false;
        await options.updater.downloadUpdate().catch(handleError);
      })
      .catch(handleError);
  });

  options.updater.on('update-downloaded', (value) => {
    const info = value as UpdateInfo | undefined;
    const version = info?.version?.trim();
    phase = 'prompting';
    reportOperationErrors = false;

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
        if (response !== 0) {
          phase = 'idle';
          return;
        }

        try {
          await beforeInstall();
          options.updater.quitAndInstall(true, true);
        } catch (error) {
          phase = 'idle';
          logError('Unable to prepare auto-update installation', error);
          options.dialog.showErrorBox('安装更新失败', '便签暂时无法退出安装，请稍后再试。');
        }
      })
      .catch((error) => {
        phase = 'idle';
        logError('Unable to show auto-update installation prompt', error);
      });
  });

  options.updater.on('error', handleError);

  const startCheck = async (isManual: boolean): Promise<void> => {
    if (phase !== 'idle') {
      if (isManual) {
        await options.dialog.showMessageBox({
          type: 'info',
          title: '检查更新',
          message:
            phase === 'downloading'
              ? '更新正在下载'
              : phase === 'prompting'
                ? '请先处理当前更新提示'
                : '正在检查更新',
          noLink: true
        });
      }
      return;
    }

    phase = 'checking';
    manualCheck = isManual;
    reportOperationErrors = false;
    failureHandled = false;
    await options.updater.checkForUpdates().catch(handleError);
  };

  return {
    checkManually: () => startCheck(true),
    checkSilently: () => startCheck(false)
  };
}
