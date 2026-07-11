import type { BrowserWindowConstructorOptions } from 'electron';
import type { DisplayWorkArea } from './window-options';
import {
  createDownloadingSnapshot,
  createPreparingSnapshot,
  type UpdateProgressSnapshot
} from '../shared/update-progress';

const UPDATE_PROGRESS_WINDOW_WIDTH = 360;
const UPDATE_PROGRESS_WINDOW_HEIGHT = 180;

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
  setFallbackProgress?: (progress: number) => void;
  logError?: (message: string, error: unknown) => void;
};

export function createUpdateProgressWindowManager(
  options: UpdateProgressWindowManagerOptions
): UpdateProgressPresenter {
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  const setFallbackProgress = options.setFallbackProgress ?? (() => undefined);
  let activeWindow: UpdateProgressWindowPort | undefined;
  let latestSnapshot: UpdateProgressSnapshot | undefined;
  let version: string | undefined;
  let rendererReady = false;
  let disposed = false;

  const setFallbackTaskbarProgress = (progress: number): void => {
    try {
      setFallbackProgress(progress);
    } catch (error) {
      logError('Unable to update fallback taskbar progress', error);
    }
  };

  const setWindowTaskbarProgress = (
    window: UpdateProgressWindowPort,
    progress: number
  ): void => {
    try {
      window.setProgressBar(progress);
    } catch (error) {
      logError('Unable to update progress window taskbar state', error);
    }
  };

  const setSnapshotProgress = (snapshot: UpdateProgressSnapshot): void => {
    const progress = snapshot.percent === undefined ? 2 : snapshot.percent / 100;
    setFallbackTaskbarProgress(progress);
    if (activeWindow) {
      setWindowTaskbarProgress(activeWindow, progress);
    }
  };

  const sendLatestSnapshot = (): void => {
    if (!activeWindow || !rendererReady || !latestSnapshot) {
      return;
    }

    try {
      activeWindow.send(latestSnapshot);
    } catch (error) {
      logError('Unable to send update progress snapshot', error);
    }
  };

  const ensureWindow = (): UpdateProgressWindowPort | undefined => {
    if (disposed) {
      return undefined;
    }

    if (activeWindow) {
      return activeWindow;
    }

    let window: UpdateProgressWindowPort;
    try {
      window = options.createWindow();
    } catch (error) {
      logError('Unable to create update progress window', error);
      return undefined;
    }
    activeWindow = window;
    rendererReady = false;

    try {
      window.onReady(() => {
        if (activeWindow !== window || disposed) {
          return;
        }

        rendererReady = true;
        sendLatestSnapshot();
      });
      window.onClosed(() => {
        if (activeWindow === window) {
          activeWindow = undefined;
          rendererReady = false;
        }
      });
      window.show();
      window.focus();
    } catch (error) {
      logError('Unable to initialize update progress window', error);
      activeWindow = undefined;
      rendererReady = false;
      try {
        window.destroy();
      } catch (destroyError) {
        logError('Unable to destroy update progress window', destroyError);
      }
      return undefined;
    }
    void Promise.resolve()
      .then(() => window.load())
      .catch((error) => {
        logError('Unable to load update progress window', error);
        if (activeWindow !== window) {
          return;
        }

        activeWindow = undefined;
        rendererReady = false;
        setWindowTaskbarProgress(window, -1);
        try {
          window.destroy();
        } catch (destroyError) {
          logError('Unable to destroy update progress window', destroyError);
        }
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
      ensureWindow();
      setSnapshotProgress(latestSnapshot);
      sendLatestSnapshot();
    },
    update: (value) => {
      if (disposed || !latestSnapshot) {
        return;
      }

      latestSnapshot = createDownloadingSnapshot(value, version);
      setSnapshotProgress(latestSnapshot);
      sendLatestSnapshot();
    },
    focus: () => {
      if (!activeWindow || disposed) {
        return;
      }

      try {
        activeWindow.show();
        activeWindow.focus();
      } catch (error) {
        logError('Unable to focus update progress window', error);
      }
    },
    close: () => {
      const window = activeWindow;
      activeWindow = undefined;
      rendererReady = false;
      latestSnapshot = undefined;
      version = undefined;
      setFallbackTaskbarProgress(-1);
      if (window) {
        setWindowTaskbarProgress(window, -1);
        try {
          window.close();
        } catch (error) {
          logError('Unable to close update progress window', error);
        }
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
      setFallbackTaskbarProgress(-1);
      if (window) {
        setWindowTaskbarProgress(window, -1);
        try {
          window.destroy();
        } catch (error) {
          logError('Unable to destroy update progress window', error);
        }
      }
    }
  };
}
