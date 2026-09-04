import {
  describeUpdateFailure,
  planUpdateCheckRetry,
  type UpdateNetwork
} from '../shared/update-error';
import { createSafeDiagnosticRecorder, type DiagnosticRecorder } from './diagnostics';
import { gt, valid } from 'semver';

export type MacUpdateInfo = {
  version: string;
  fileName: string;
  sha512: string;
  size: number;
};

export type MacUpdateService = {
  getLatest: () => Promise<MacUpdateInfo>;
  download: (update: MacUpdateInfo, onProgress: (progress: number) => void) => Promise<string>;
  openInstaller: (filePath: string) => Promise<void>;
};

export type MacUpdateMessageBoxOptions = {
  type: 'info';
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  noLink?: boolean;
};

export type MacUpdateDialog = {
  showMessageBox: (options: MacUpdateMessageBoxOptions) => Promise<{ response: number }>;
  showErrorBox: (title: string, content: string) => void;
};

export type MacUpdateController = {
  checkManually: () => Promise<void>;
  checkSilently: () => Promise<void>;
};

type MacUpdateControllerOptions = {
  currentVersion: string;
  dialog: MacUpdateDialog;
  service: MacUpdateService;
  diagnostics?: DiagnosticRecorder;
  network?: UpdateNetwork;
  beforeInstall?: () => Promise<void>;
  quit?: () => void;
  setProgress?: (progress: number) => void;
  logError?: (message: string, error: unknown) => void;
};

type MacUpdatePhase = 'idle' | 'checking' | 'prompting' | 'downloading' | 'installing';

export function shouldEnableMacManualUpdates(
  platform: NodeJS.Platform,
  isPackaged: boolean
): boolean {
  return platform === 'darwin' && isPackaged;
}

export function createMacUpdateController(
  options: MacUpdateControllerOptions
): MacUpdateController {
  const beforeInstall = options.beforeInstall ?? (async () => undefined);
  const quit = options.quit ?? (() => undefined);
  const setProgress = options.setProgress ?? (() => undefined);
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  const recordDiagnostic = createSafeDiagnosticRecorder(options.diagnostics).record;
  let phase: MacUpdatePhase = 'idle';

  const loadLatestWithRetry = async (source: 'manual' | 'startup') => {
    if (options.network) {
      try {
        await options.network.setProxyMode('system');
      } catch (proxyError) {
        recordDiagnostic('mac_update_proxy_mode_failed', {
          source,
          error: proxyError
        });
      }
    }
    let checkAttempt = 0;
    for (;;) {
      try {
        const update = await options.service.getLatest();
        recordDiagnostic('mac_update_metadata_loaded', {
          source,
          latestVersion: update.version,
          attempt: checkAttempt
        });
        return update;
      } catch (error) {
        const retryAction = planUpdateCheckRetry(error, checkAttempt);
        if (retryAction === 'none') {
          throw error;
        }
        if (retryAction === 'retry-direct') {
          if (!options.network) {
            throw error;
          }
          try {
            await options.network.setProxyMode('direct');
            recordDiagnostic('mac_update_proxy_mode_changed', {
              source,
              mode: 'direct'
            });
          } catch (proxyError) {
            recordDiagnostic('mac_update_proxy_mode_failed', {
              source,
              error: proxyError
            });
            throw error;
          }
        }
        checkAttempt += 1;
        recordDiagnostic('mac_update_check_retry', {
          source,
          action: retryAction,
          attempt: checkAttempt
        });
      }
    }
  };

  const startCheck = async (isManual: boolean): Promise<void> => {
    const source = isManual ? 'manual' : 'startup';
    if (phase !== 'idle') {
      recordDiagnostic('mac_update_check_busy', { source, phase });
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

    let reportErrors = isManual;
    phase = 'checking';
    recordDiagnostic('mac_update_check_started', { source });

    try {
      const update = await loadLatestWithRetry(source);
      if (!valid(options.currentVersion) || !gt(update.version, options.currentVersion)) {
        phase = 'idle';
        recordDiagnostic('mac_update_not_available', { source, latestVersion: update.version });
        if (isManual) {
          await options.dialog.showMessageBox({
            type: 'info',
            title: '检查更新',
            message: '已经是最新版本',
            noLink: true
          });
        }
        return;
      }

      phase = 'prompting';
      const downloadPrompt = await options.dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${update.version}`,
        detail: '是否现在下载 macOS 安装镜像？下载完成后会再询问是否退出并打开。',
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (downloadPrompt.response !== 0) {
        phase = 'idle';
        return;
      }

      phase = 'downloading';
      reportErrors = true;
      recordDiagnostic('mac_update_download_started', {
        version: update.version,
        expectedSize: update.size
      });
      setProgress(0);
      const filePath = await options.service.download(update, setProgress);
      recordDiagnostic('mac_update_download_verified', {
        version: update.version,
        expectedSize: update.size
      });
      setProgress(-1);

      phase = 'prompting';
      const installPrompt = await options.dialog.showMessageBox({
        type: 'info',
        title: '更新已下载',
        message: `版本 ${update.version} 已下载完成`,
        detail:
          '安装镜像已保存到“下载”文件夹。应用将保存所有便签并退出，然后打开安装镜像。请把“悬浮便签”拖到 Applications，并确认替换。',
        buttons: ['退出并打开安装镜像', '稍后安装'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (installPrompt.response !== 0) {
        phase = 'idle';
        return;
      }

      phase = 'installing';
      await beforeInstall();
      await options.service.openInstaller(filePath);
      recordDiagnostic('mac_update_installer_opened', { version: update.version });
      quit();
    } catch (error) {
      const failedPhase = phase;
      recordDiagnostic('mac_update_failed', { source, phase: failedPhase, error });
      phase = 'idle';
      setProgress(-1);
      logError('macOS update failed', error);
      if (reportErrors) {
        const { title, content } = describeUpdateFailure(
          failedPhase === 'installing'
            ? 'install'
            : failedPhase === 'downloading'
              ? 'download'
              : 'check',
          error,
          { includeDownloadDirectory: failedPhase === 'downloading' }
        );
        options.dialog.showErrorBox(title, content);
      }
    }
  };

  return {
    checkManually: () => startCheck(true),
    checkSilently: () => startCheck(false)
  };
}
