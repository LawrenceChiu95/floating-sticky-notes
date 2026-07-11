import type { BrowserWindowConstructorOptions } from 'electron';
import type { DisplayWorkArea } from './window-options';
import {
  createDownloadingSnapshot,
  createPreparingSnapshot,
  type UpdateProgressSnapshot
} from '../shared/update-progress';

const UPDATE_PROGRESS_WINDOW_WIDTH = 360;
const UPDATE_PROGRESS_WINDOW_HEIGHT = 150;

export function createUpdateProgressWindowOptions(
  workArea: DisplayWorkArea,
  preloadPath: string,
  iconPath: string
): BrowserWindowConstructorOptions {
  const width = Math.min(UPDATE_PROGRESS_WINDOW_WIDTH, workArea.width);
  const height = Math.min(UPDATE_PROGRESS_WINDOW_HEIGHT, workArea.height);

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
    title: '下载更新',
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    show: false,
    modal: false,
    closable: false,
    minimizable: true,
    maximizable: false,
    resizable: false,
    skipTaskbar: false,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

export type UpdateProgressWindowPort = {
  load: () => Promise<void>;
  onReady: (listener: () => void) => void;
  onClosed: (listener: () => void) => void;
  send: (snapshot: UpdateProgressSnapshot) => void;
  setProgressBar: (progress: number) => void;
  show: () => void;
  focus: () => void;
  close: () => void;
  destroy: () => void;
};

export type UpdateProgressPresenter = {
  showPreparing: (version?: string) => void;
  update: (value: unknown) => void;
  focus: () => void;
  close: () => void;
  dispose: () => void;
};

type UpdateProgressWindowManagerOptions = {
  createWindow: () => UpdateProgressWindowPort;
  logError?: (message: string, error: unknown) => void;
};

export function createUpdateProgressWindowManager(
  options: UpdateProgressWindowManagerOptions
): UpdateProgressPresenter {
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  let activeWindow: UpdateProgressWindowPort | undefined;
  let latestSnapshot: UpdateProgressSnapshot | undefined;
  let version: string | undefined;
  let rendererReady = false;
  let disposed = false;

  const setTaskbarProgress = (
    window: UpdateProgressWindowPort,
    snapshot: UpdateProgressSnapshot
  ): void => {
    window.setProgressBar(snapshot.percent === undefined ? 2 : snapshot.percent / 100);
  };

  const sendLatestSnapshot = (): void => {
    if (!activeWindow || !rendererReady || !latestSnapshot) {
      return;
    }

    activeWindow.send(latestSnapshot);
  };

  const ensureWindow = (): UpdateProgressWindowPort | undefined => {
    if (disposed) {
      return undefined;
    }

    if (activeWindow) {
      return activeWindow;
    }

    const window = options.createWindow();
    activeWindow = window;
    rendererReady = false;

    window.onReady(() => {
      if (activeWindow !== window || disposed) {
        return;
      }

      rendererReady = true;
      sendLatestSnapshot();
      window.show();
      window.focus();
    });
    window.onClosed(() => {
      if (activeWindow === window) {
        activeWindow = undefined;
        rendererReady = false;
      }
    });
    void window.load().catch((error) => {
      logError('Unable to load update progress window', error);
      if (activeWindow !== window) {
        return;
      }

      activeWindow = undefined;
      rendererReady = false;
      window.setProgressBar(-1);
      window.destroy();
    });

    return window;
  };

  return {
    showPreparing: (nextVersion) => {
      if (disposed) {
        return;
      }

      version = nextVersion;
      latestSnapshot = createPreparingSnapshot(version);
      const window = ensureWindow();
      if (window) {
        setTaskbarProgress(window, latestSnapshot);
        sendLatestSnapshot();
      }
    },
    update: (value) => {
      if (disposed || !latestSnapshot) {
        return;
      }

      latestSnapshot = createDownloadingSnapshot(value, version);
      if (activeWindow) {
        setTaskbarProgress(activeWindow, latestSnapshot);
        sendLatestSnapshot();
      }
    },
    focus: () => {
      if (!activeWindow || disposed) {
        return;
      }

      activeWindow.show();
      activeWindow.focus();
    },
    close: () => {
      const window = activeWindow;
      activeWindow = undefined;
      rendererReady = false;
      latestSnapshot = undefined;
      version = undefined;
      if (window) {
        window.setProgressBar(-1);
        window.close();
      }
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      const window = activeWindow;
      activeWindow = undefined;
      rendererReady = false;
      latestSnapshot = undefined;
      version = undefined;
      if (window) {
        window.setProgressBar(-1);
        window.destroy();
      }
    }
  };
}
