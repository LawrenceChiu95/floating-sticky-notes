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
  beforeInstall?: () => Promise<void>;
  quit?: () => void;
  setProgress?: (progress: number) => void;
  logError?: (message: string, error: unknown) => void;
};

type MacUpdatePhase = 'idle' | 'checking' | 'prompting' | 'downloading';

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
  let phase: MacUpdatePhase = 'idle';

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

    let reportErrors = isManual;
    phase = 'checking';

    try {
      const update = await options.service.getLatest();
      if (!valid(options.currentVersion) || !gt(update.version, options.currentVersion)) {
        phase = 'idle';
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
      setProgress(0);
      const filePath = await options.service.download(update, setProgress);
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

      await beforeInstall();
      await options.service.openInstaller(filePath);
      quit();
    } catch (error) {
      phase = 'idle';
      setProgress(-1);
      logError('macOS update failed', error);
      if (reportErrors) {
        options.dialog.showErrorBox(
          '检查更新失败',
          '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络和下载目录权限。'
        );
      }
    }
  };

  return {
    checkManually: () => startCheck(true),
    checkSilently: () => startCheck(false)
  };
}
