import type { BrowserWindowConstructorOptions } from 'electron';
import {
  isReleaseFeedbackRenderedPayload,
  RELEASE_FEEDBACK_RENDER_TIMEOUT_MS,
  type ReleaseFeedbackPresentationResult,
  type ReleaseFeedbackSnapshot
} from '../shared/release-feedback-window';
import type { DisplayWorkArea } from './window-options';
import type { ReleaseFeedbackPresenter } from './release-feedback';

const RELEASE_FEEDBACK_WINDOW_WIDTH = 440;
const RELEASE_FEEDBACK_MIN_CONTENT_HEIGHT = 180;
const RELEASE_FEEDBACK_MAX_CONTENT_HEIGHT = 560;

export type ReleaseFeedbackWindowBounds = DisplayWorkArea;

export function createReleaseFeedbackWindowOptions(
  workArea: DisplayWorkArea,
  preloadPath: string,
  iconPath: string
): BrowserWindowConstructorOptions {
  const width = Math.min(RELEASE_FEEDBACK_WINDOW_WIDTH, workArea.width);
  const height = Math.min(RELEASE_FEEDBACK_MIN_CONTENT_HEIGHT, workArea.height);

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
    title: '本版更新',
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    show: false,
    modal: false,
    closable: true,
    minimizable: false,
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

export function calculateReleaseFeedbackWindowBounds(
  workArea: DisplayWorkArea,
  contentHeight: number,
  chromeHeight: number
): ReleaseFeedbackWindowBounds {
  const width = Math.min(RELEASE_FEEDBACK_WINDOW_WIDTH, workArea.width);
  const maximumContentHeight = Math.max(
    RELEASE_FEEDBACK_MIN_CONTENT_HEIGHT,
    Math.min(
      RELEASE_FEEDBACK_MAX_CONTENT_HEIGHT,
      Math.floor(workArea.height * 0.75)
    )
  );
  const safeContentHeight = Number.isFinite(contentHeight) ? contentHeight : 0;
  const clampedContentHeight = Math.min(
    Math.max(safeContentHeight, RELEASE_FEEDBACK_MIN_CONTENT_HEIGHT),
    maximumContentHeight
  );
  const safeChromeHeight = Number.isFinite(chromeHeight)
    ? Math.max(0, chromeHeight)
    : 0;
  const height = Math.min(workArea.height, clampedContentHeight + safeChromeHeight);

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height
  };
}

export type ReleaseFeedbackWindowPort = {
  webContentsId: number;
  workArea: DisplayWorkArea;
  load: () => Promise<void>;
  onReady: (listener: () => void) => void;
  onShow: (listener: () => void) => void;
  onClosed: (listener: () => void) => void;
  send: (snapshot: ReleaseFeedbackSnapshot) => void;
  getChromeHeight: () => number;
  setBounds: (bounds: ReleaseFeedbackWindowBounds) => void;
  show: () => void;
  focus: () => void;
  destroy: () => void;
};

export type ReleaseFeedbackWindowManager = ReleaseFeedbackPresenter & {
  isCurrentSender: (webContentsId: number) => boolean;
  reportRendered: (webContentsId: number, value: unknown) => boolean;
  dismiss: (webContentsId: number) => boolean;
};

type ReleaseFeedbackWindowManagerOptions = {
  createWindow: () => ReleaseFeedbackWindowPort;
  logWarning?: (message: string, error: unknown) => void;
};

type ActivePresentation = {
  window: ReleaseFeedbackWindowPort;
  snapshot: ReleaseFeedbackSnapshot;
  result: Promise<ReleaseFeedbackPresentationResult>;
  resolve: (result: ReleaseFeedbackPresentationResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  settled: boolean;
  rendered: boolean;
  shown: boolean;
};

export function createReleaseFeedbackWindowManager(
  options: ReleaseFeedbackWindowManagerOptions
): ReleaseFeedbackWindowManager {
  const logWarning = options.logWarning ?? ((message, error) => console.warn(message, error));
  let active: ActivePresentation | undefined;
  let disposed = false;

  const finish = (presentation: ActivePresentation, shown: boolean): void => {
    if (presentation.settled) {
      return;
    }

    presentation.settled = true;
    presentation.shown = shown;
    clearTimeout(presentation.timeout);
    presentation.resolve({ shown, source: presentation.snapshot.initiatedBy });
  };

  const removeAndDestroy = (presentation: ActivePresentation): void => {
    if (active === presentation) {
      active = undefined;
    }
    try {
      presentation.window.destroy();
    } catch (error) {
      logWarning('Unable to destroy release feedback window', error);
    }
  };

  const fail = (
    presentation: ActivePresentation,
    message: string,
    error: unknown
  ): void => {
    if (active !== presentation || presentation.settled) {
      return;
    }

    logWarning(message, error);
    finish(presentation, false);
    removeAndDestroy(presentation);
  };

  const presenter: ReleaseFeedbackWindowManager = {
    show(snapshot) {
      if (disposed) {
        return Promise.resolve({ shown: false, source: snapshot.initiatedBy });
      }

      if (active) {
        try {
          active.window.focus();
        } catch (error) {
          logWarning('Unable to focus release feedback window', error);
        }
        return active.result;
      }

      let window: ReleaseFeedbackWindowPort;
      try {
        window = options.createWindow();
      } catch (error) {
        logWarning('Unable to create release feedback window', error);
        return Promise.resolve({ shown: false, source: snapshot.initiatedBy });
      }

      let resolveResult!: (result: ReleaseFeedbackPresentationResult) => void;
      const result = new Promise<ReleaseFeedbackPresentationResult>((resolve) => {
        resolveResult = resolve;
      });
      const presentation: ActivePresentation = {
        window,
        snapshot,
        result,
        resolve: resolveResult,
        timeout: setTimeout(() => {
          fail(
            presentation,
            'Release feedback window did not render in time',
            new Error(`Timed out after ${RELEASE_FEEDBACK_RENDER_TIMEOUT_MS}ms`)
          );
        }, RELEASE_FEEDBACK_RENDER_TIMEOUT_MS),
        settled: false,
        rendered: false,
        shown: false
      };
      active = presentation;

      try {
        window.onReady(() => {
          if (active !== presentation || presentation.settled) {
            return;
          }
          try {
            window.send(snapshot);
          } catch (error) {
            fail(presentation, 'Unable to send release feedback snapshot', error);
          }
        });
        window.onShow(() => {
          if (active === presentation) {
            finish(presentation, true);
          }
        });
        window.onClosed(() => {
          if (active !== presentation) {
            return;
          }
          active = undefined;
          finish(presentation, false);
        });
      } catch (error) {
        fail(presentation, 'Unable to initialize release feedback window', error);
        return result;
      }

      void Promise.resolve()
        .then(() => window.load())
        .catch((error) => {
          fail(presentation, 'Unable to load release feedback window', error);
        });
      return result;
    },

    isCurrentSender(webContentsId) {
      return active?.window.webContentsId === webContentsId;
    },

    reportRendered(webContentsId, value) {
      const presentation = active;
      if (
        !presentation ||
        presentation.window.webContentsId !== webContentsId ||
        presentation.settled ||
        presentation.rendered ||
        !isReleaseFeedbackRenderedPayload(value)
      ) {
        return false;
      }

      presentation.rendered = true;
      try {
        const bounds = calculateReleaseFeedbackWindowBounds(
          presentation.window.workArea,
          value.contentHeight,
          presentation.window.getChromeHeight()
        );
        presentation.window.setBounds(bounds);
        presentation.window.show();
      } catch (error) {
        fail(presentation, 'Unable to show release feedback window', error);
        return false;
      }
      return true;
    },

    dismiss(webContentsId) {
      const presentation = active;
      if (!presentation || presentation.window.webContentsId !== webContentsId) {
        return false;
      }

      finish(presentation, false);
      removeAndDestroy(presentation);
      return true;
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      const presentation = active;
      if (presentation) {
        finish(presentation, false);
        removeAndDestroy(presentation);
      }
    }
  };

  return presenter;
}
