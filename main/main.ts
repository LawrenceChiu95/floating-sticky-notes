import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, screen, shell } from 'electron';
import { release as getOsRelease, arch as getOsArch, homedir } from 'node:os';
import { is } from '@electron-toolkit/utils';
import electronUpdater from 'electron-updater';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDevUserDataPath,
  shouldApplyAutoLaunchDefault,
  shouldCreateWindowOnActivate,
  shouldQuitWhenAllWindowsClosed
} from './app-lifecycle';
import {
  ensureAutoLaunchDefaultEnabled,
  getAutoLaunchStatus,
  setAutoLaunchEnabled,
  type AutoLaunchDefaultState
} from './auto-launch';
import { pasteClipboardImage } from './clipboard-image';
import { normalizeChecklistInput } from './checklist-input';
import { normalizeSaveImageInput } from './image-input';
import {
  computeResizedBounds,
  createImagePreviewWindowOptions,
  getImagePreviewMinimumSize,
  ImagePreviewController,
  type ImagePreviewSize,
  type ImagePreviewWindowPort
} from './image-preview-window';
import { IMAGE_PROTOCOL, LocalImageStorage } from './image-storage';
import { readLocalProfile } from './local-profile';
import { createNoteWindowCollapseController } from './note-window-collapse';
import {
  createMacUpdateController,
  shouldEnableMacManualUpdates
} from './mac-update-controller';
import { createMacUpdateService } from './mac-update-service';
import { type ManagedNoteWindow, NotesManager } from './notes-manager';
import { preventNoteWindowNavigation } from './navigation-guard';
import type { NoteRecord, NoteBounds } from './note-state';
import { createClosePersistenceHandler, createQuitPersistenceHandler } from './persistence-lifecycle';
import {
  createReleaseFeedbackController,
  type ReleaseFeedbackController
} from './release-feedback';
import {
  createReleaseFeedbackWindowManager,
  createReleaseFeedbackWindowOptions,
  type ReleaseFeedbackWindowManager,
  type ReleaseFeedbackWindowPort
} from './release-feedback-window';
import {
  createReleaseFeedbackStateStore,
  RELEASE_FEEDBACK_STATE_FILENAME
} from './release-feedback-state';
import { JsonNotesStorage } from './storage';
import { createTray } from './tray';
import {
  createUpdateController,
  shouldEnableAutoUpdates,
  type UpdateController
} from './update-controller';
import {
  attachUpdaterRequestDiagnostics,
  createDiagnosticLogger,
  type DiagnosticLogger
} from './diagnostics';
import {
  createUpdateProgressWindowManager,
  createUpdateProgressWindowOptions,
  type UpdateProgressWindowPort
} from './update-progress-window';
import {
  NOTE_ALWAYS_ON_TOP_LEVEL,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_WINDOW_ICON_PATH,
  createNoteWindowOptions,
  type DisplayWorkArea
} from './window-options';
import { createDebouncedValueAction } from '../shared/debounced-action';
import {
  buildExpandBoundsFromDock,
  resolveCollapsedDockSide,
  resolveDockedEdgeRelease,
  restoreDockedBounds
} from '../shared/note-dock';
import { DEFAULT_APP_COPY, getAppCopy, type AppCopy } from '../shared/app-copy';
import {
  isReleaseFeedbackRenderedPayload,
  RELEASE_FEEDBACK_CHANNELS,
  type ReleaseFeedbackSnapshot
} from '../shared/release-feedback-window';
import { UPDATE_PROGRESS_CHANNEL, type UpdateProgressSnapshot } from '../shared/update-progress';
import {
  IMAGE_PREVIEW_CHANNELS,
  isImagePreviewResizeDirection
} from '../shared/image-preview';
import { BUILT_RELEASE_NOTES } from './generated/release-notes';

let notesManager: NotesManager | undefined;
let appCopy: AppCopy = DEFAULT_APP_COPY;
let releaseFeedbackController: ReleaseFeedbackController | undefined;
let releaseFeedbackWindowManager: ReleaseFeedbackWindowManager | undefined;
let imagePreviewController: ImagePreviewController | undefined;
let restoreNotesWhenReady = false;
const AUTO_LAUNCH_DEFAULT_MARKER = '.auto-launch-default-applied';
let diagnosticLogger: DiagnosticLogger | undefined;
let disposeUpdateRequestDiagnostics: (() => void) | undefined;

// dev 与正式版共用安装身份,默认会读写同一份 userData(同一 notes.json)。
// 开发模式提前切到独立目录,调试/删除永远碰不到正式数据;必须在
// requestSingleInstanceLock 之前,dev 与正式版才能各持各的锁、同时运行。
if (is.dev) {
  app.setPath('userData', getDevUserDataPath(app.getPath('appData')));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (notesManager) {
    notesManager.restoreClosedNotes();
    return;
  }

  restoreNotesWhenReady = true;
});

type PlatformUpdateController = Pick<UpdateController, 'checkManually' | 'checkSilently'> & {
  dispose?: () => void;
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // sandbox:true 的预览窗里 <img> 加载 protocol.handle 的流式响应需要 stream 特权,
      // 否则资源请求挂起、图片永远不触发 load(预览窗全黑但不报错)。
      stream: true
    }
  }
]);

function createElectronImagePreviewWindow(
  workArea: DisplayWorkArea,
  noteBounds: NoteBounds,
  imageSize: ImagePreviewSize
): ImagePreviewWindowPort {
  const previewWindow = new BrowserWindow(
    createImagePreviewWindowOptions(
      workArea,
      noteBounds,
      imageSize,
      join(__dirname, '../preload/imagePreviewPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(previewWindow, 'image-preview');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      previewWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      previewWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  previewWindow.on('page-title-updated', (event) => event.preventDefault());
  previewWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);

  return {
    webContentsId: previewWindow.webContents.id,
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/image-preview.html`);
      }
      return previewWindow.loadFile(join(__dirname, '../renderer/image-preview.html'));
    },
    onReady: (listener) => {
      previewWindow.webContents.once('did-finish-load', listener);
    },
    onClosed: (listener) => {
      previewWindow.once('closed', listener);
    },
    send: (snapshot) => {
      if (!previewWindow.webContents.isDestroyed()) {
        previewWindow.webContents.send(IMAGE_PREVIEW_CHANNELS.snapshot, snapshot);
      }
    },
    show: () => {
      if (!previewWindow.isDestroyed()) previewWindow.show();
    },
    focus: () => {
      if (!previewWindow.isDestroyed()) {
        if (previewWindow.isMinimized()) previewWindow.restore();
        previewWindow.focus();
      }
    },
    close: () => {
      if (!previewWindow.isDestroyed()) previewWindow.close();
    },
    destroy: () => {
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
    },
    resize: (direction, dx, dy) => {
      if (previewWindow.isDestroyed()) {
        return;
      }
      const bounds = previewWindow.getBounds();
      const currentWorkArea = screen.getDisplayMatching(bounds).workArea;
      previewWindow.setBounds(
        computeResizedBounds(
          bounds,
          direction,
          dx,
          dy,
          getImagePreviewMinimumSize(),
          { width: currentWorkArea.width, height: currentWorkArea.height }
        )
      );
    },
    move: (dx, dy) => {
      if (previewWindow.isDestroyed()) {
        return;
      }
      const bounds = previewWindow.getBounds();
      previewWindow.setBounds({
        x: bounds.x + Math.round(dx),
        y: bounds.y + Math.round(dy),
        width: bounds.width,
        height: bounds.height
      });
    }
  };
}
function createElectronNoteWindow(note: NoteRecord): ManagedNoteWindow {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  // 启动恢复贴边：缝夹取后仍落在某块可见工作区内才按贴边建窗，否则按
  // bounds 展开（notes-manager 会发现窗口不是 docked 并丢弃失效的 dock）。
  const restoredDockBounds = note.dock
    ? restoreDockedBounds({ dock: note.dock, workAreas })
    : undefined;
  const noteWindow = new BrowserWindow(
    createNoteWindowOptions(note.bounds, workAreas, restoredDockBounds ?? undefined)
  );
  observeWindowDiagnostics(noteWindow, 'note');
  const noteWebContentsId = noteWindow.webContents.id;

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      noteWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      noteWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  noteWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);
  noteWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  noteWindow.once('ready-to-show', () => {
    noteWindow.show();
  });

  // 贴边恢复时把 side 同步写进 URL query：preload 读取后 renderer 首帧就渲染
  // 缝，不会先挂完整便签 DOM 再切换（getCurrentNote 回来后再以记录为准）。
  const initialDockSide = restoredDockBounds && note.dock ? note.dock.side : undefined;
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void noteWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}${initialDockSide ? `?dock=${initialDockSide}` : ''}`
    );
  } else {
    void noteWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      initialDockSide ? { query: { dock: initialDockSide } } : undefined
    );
  }

  const listenerBag: {
    boundsChanged?: () => void | Promise<void>;
  } = {};
  const saveBounds = createDebouncedValueAction<void>(() => {
    return listenerBag.boundsChanged?.();
  }, 300);
  const collapseController = createNoteWindowCollapseController({
    window: noteWindow,
    getWorkAreas: () => screen.getAllDisplays().map((display) => display.workArea)
  });
  if (restoredDockBounds && note.dock) {
    collapseController.applyRestoredDock(
      { side: note.dock.side, y: restoredDockBounds.y },
      {
        x: note.bounds.x ?? restoredDockBounds.x,
        y: note.bounds.y ?? restoredDockBounds.y,
        width: Math.max(NOTE_MIN_WIDTH, note.bounds.width),
        height: Math.max(NOTE_MIN_HEIGHT, note.bounds.height)
      }
    );
  }

  // 磁吸贴边：收起横条与贴边书签头都走原生 -webkit-app-region 拖窗（与展开
  // 态同一套，不存在自定义拖窗的跟手损耗）。主进程在每个 move 上看当前矩形：
  // 横条进入左右工作区缘 24px 内立即收成书签头；书签头被拖离边 ≥48px 立即
  // 展开；未过阈值则把 x 钉回边缘（沿边滑动）。不看「松手」——macOS 没有拖
  // 动结束事件，磁吸只关心当前位置过没过阈值，也不等 240ms 过渡。
  let isMagneticTransitionInFlight = false;
  noteWindow.on('move', () => {
    if (isMagneticTransitionInFlight || noteWindow.isDestroyed()) {
      return;
    }

    const presentation = collapseController.getPresentation();

    if (presentation === 'collapsed') {
      const current = noteWindow.getBounds();
      const workArea = screen.getDisplayMatching(current).workArea;
      const side = resolveCollapsedDockSide(current, workArea);

      if (!side) {
        return;
      }

      isMagneticTransitionInFlight = true;
      void getNotesManager()
        .dockNoteForWebContents(noteWebContentsId, { side, y: current.y, workArea })
        .then((didDock) => {
          if (didDock && !noteWindow.isDestroyed()) {
            noteWindow.webContents.send('sticky-notes:dock-applied', { dock: { side } });
          }
        })
        .catch((error) => {
          diagnosticLogger?.record('note_dock_failed', {
            webContentsId: noteWebContentsId,
            error
          });
        })
        .finally(() => {
          isMagneticTransitionInFlight = false;
        });
      return;
    }

    if (presentation !== 'docked') {
      return;
    }

    const side = collapseController.getDockForPersistence()?.side;

    if (!side) {
      return;
    }

    const current = noteWindow.getBounds();
    const workArea = screen.getDisplayMatching(current).workArea;

    if (resolveDockedEdgeRelease({ side, current, workArea }) === 'stay') {
      // 未过展开阈值：钉回边缘、y 跟随，书签头沿边滑动。
      void collapseController.setDocked({ kind: 'slide', y: current.y });
      return;
    }

    const persistedBounds = collapseController.getBoundsForPersistence();
    const bounds = buildExpandBoundsFromDock({
      side,
      sliver: current,
      expandedSize: { width: persistedBounds.width, height: persistedBounds.height },
      workArea
    });

    isMagneticTransitionInFlight = true;
    void getNotesManager()
      .undockNoteForWebContents(noteWebContentsId, bounds)
      .then((didUndock) => {
        if (didUndock && !noteWindow.isDestroyed()) {
          noteWindow.webContents.send('sticky-notes:dock-applied', { dock: null });
        }
      })
      .catch((error) => {
        diagnosticLogger?.record('note_undock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
      })
      .finally(() => {
        isMagneticTransitionInFlight = false;
      });
  });
  const flushPendingChanges = async (): Promise<void> => {
    await Promise.all([saveBounds.flush(), flushRendererPendingContent(noteWindow)]);
  };
  const closeAfterFlush = createClosePersistenceHandler({
    flush: flushPendingChanges,
    close: () => {
      noteWindow.close();
    }
  });

  noteWindow.on('close', closeAfterFlush);
  noteWindow.on('closed', () => {
    imagePreviewController?.handleSourceClosed(noteWebContentsId);
  });

  return {
    webContentsId: noteWindow.webContents.id,
    getBounds: collapseController.getBoundsForPersistence,
    onBoundsChanged: (listener) => {
      listenerBag.boundsChanged = listener;
      noteWindow.on('move', () => saveBounds.schedule(undefined));
      noteWindow.on('resize', () => saveBounds.schedule(undefined));
      noteWindow.on('close', () => {
        void saveBounds.flush();
      });
    },
    onClose: (listener) => {
      noteWindow.on('closed', listener);
    },
    flushPendingChanges,
    show: () => {
      if (noteWindow.isMinimized()) {
        noteWindow.restore();
      }
      noteWindow.show();
    },
    focus: () => {
      if (!noteWindow.isDestroyed()) {
        noteWindow.focus();
      }
    },
    setTitle: (title) => {
      noteWindow.setTitle(title);
    },
    setCollapsed: collapseController.setCollapsed,
    setDocked: collapseController.setDocked,
    getPresentation: collapseController.getPresentation,
    getDockForPersistence: collapseController.getDockForPersistence,
    close: () => {
      noteWindow.close();
    }
  };
}

function createElectronUpdateProgressWindow(): UpdateProgressWindowPort {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const progressWindow = new BrowserWindow(
    createUpdateProgressWindowOptions(
      workArea,
      join(__dirname, '../preload/updateProgressPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(progressWindow, 'update-progress');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      progressWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      progressWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  progressWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return {
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return progressWindow.loadURL(
          `${process.env.ELECTRON_RENDERER_URL}/update-progress.html`
        );
      }
      return progressWindow.loadFile(join(__dirname, '../renderer/update-progress.html'));
    },
    onReady: (listener) => {
      progressWindow.webContents.once('did-finish-load', listener);
    },
    onClosed: (listener) => {
      progressWindow.once('closed', listener);
    },
    send: (snapshot: UpdateProgressSnapshot) => {
      if (!progressWindow.webContents.isDestroyed()) {
        progressWindow.webContents.send(UPDATE_PROGRESS_CHANNEL, snapshot);
      }
    },
    setProgressBar: (progress) => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.setProgressBar(progress);
      }
    },
    show: () => {
      if (progressWindow.isDestroyed()) {
        return;
      }
      if (progressWindow.isMinimized()) {
        progressWindow.restore();
      }
      progressWindow.show();
    },
    focus: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.focus();
      }
    },
    close: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.destroy();
      }
    },
    destroy: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.destroy();
      }
    }
  };
}

function createElectronReleaseFeedbackWindow(): ReleaseFeedbackWindowPort {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const releaseFeedbackWindow = new BrowserWindow(
    createReleaseFeedbackWindowOptions(
      workArea,
      join(__dirname, '../preload/releaseFeedbackPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(releaseFeedbackWindow, 'release-feedback');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      releaseFeedbackWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      releaseFeedbackWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  releaseFeedbackWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  releaseFeedbackWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  return {
    webContentsId: releaseFeedbackWindow.webContents.id,
    workArea,
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return releaseFeedbackWindow.loadURL(
          `${process.env.ELECTRON_RENDERER_URL}/release-feedback.html`
        );
      }
      return releaseFeedbackWindow.loadFile(
        join(__dirname, '../renderer/release-feedback.html')
      );
    },
    onReady: (listener) => {
      releaseFeedbackWindow.webContents.once('did-finish-load', listener);
    },
    onShow: (listener) => {
      releaseFeedbackWindow.once('show', listener);
    },
    onClosed: (listener) => {
      releaseFeedbackWindow.once('closed', listener);
    },
    send: (snapshot: ReleaseFeedbackSnapshot) => {
      if (!releaseFeedbackWindow.webContents.isDestroyed()) {
        releaseFeedbackWindow.webContents.send(
          RELEASE_FEEDBACK_CHANNELS.snapshot,
          snapshot
        );
      }
    },
    getChromeHeight: () => {
      if (releaseFeedbackWindow.isDestroyed()) {
        return 0;
      }
      return Math.max(
        0,
        releaseFeedbackWindow.getBounds().height -
          releaseFeedbackWindow.getContentBounds().height
      );
    },
    setBounds: (bounds) => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.setBounds(bounds, false);
      }
    },
    show: () => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.show();
      }
    },
    focus: () => {
      if (releaseFeedbackWindow.isDestroyed() || !releaseFeedbackWindow.isVisible()) {
        return;
      }
      if (releaseFeedbackWindow.isMinimized()) {
        releaseFeedbackWindow.restore();
      }
      releaseFeedbackWindow.focus();
    },
    destroy: () => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.destroy();
      }
    }
  };
}

function getNotesManager(): NotesManager {
  if (!notesManager) {
    throw new Error('Notes manager is not ready');
  }

  return notesManager;
}

function registerIpcHandlers(): void {
  ipcMain.on(RELEASE_FEEDBACK_CHANNELS.rendered, (event, value: unknown) => {
    if (
      !releaseFeedbackWindowManager ||
      !releaseFeedbackWindowManager.isCurrentSender(event.sender.id) ||
      !isReleaseFeedbackRenderedPayload(value)
    ) {
      return;
    }

    releaseFeedbackWindowManager.reportRendered(event.sender.id, value);
  });

  ipcMain.on(RELEASE_FEEDBACK_CHANNELS.dismiss, (event) => {
    if (!releaseFeedbackWindowManager?.isCurrentSender(event.sender.id)) {
      return;
    }

    releaseFeedbackWindowManager.dismiss(event.sender.id);
  });

  ipcMain.handle('sticky-notes:get-app-copy', () => appCopy);

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.open, (event, imageId: unknown) => {
    if (typeof imageId !== 'string' || imageId.length === 0 || !imagePreviewController) {
      return false;
    }

    const manager = getNotesManager();
    const sourceNote = manager.getNoteForWebContents(event.sender.id);
    if (!sourceNote || !sourceNote.images.some((image) => image.id === imageId)) {
      return false;
    }

    const sourceBounds = manager.getBoundsForWebContents(event.sender.id) ?? sourceNote.bounds;
    const display =
      sourceBounds.x !== undefined && sourceBounds.y !== undefined
        ? screen.getDisplayMatching({
            x: sourceBounds.x,
            y: sourceBounds.y,
            width: sourceBounds.width,
            height: sourceBounds.height
          })
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return imagePreviewController.open(
      event.sender.id,
      sourceNote.id,
      imageId,
      display.workArea,
      sourceBounds
    );
  });

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.getSnapshot, (event) => {
    return imagePreviewController?.getSnapshotForWebContents(event.sender.id);
  });

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.close, (event) => {
    return imagePreviewController?.close(event.sender.id) ?? false;
  });

  ipcMain.handle(
    IMAGE_PREVIEW_CHANNELS.resize,
    (event, direction: unknown, dx: unknown, dy: unknown) => {
      if (
        !isImagePreviewResizeDirection(direction) ||
        typeof dx !== 'number' ||
        typeof dy !== 'number'
      ) {
        return false;
      }
      return imagePreviewController?.resize(event.sender.id, direction, dx, dy) ?? false;
    }
  );

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.move, (event, dx: unknown, dy: unknown) => {
    if (typeof dx !== 'number' || typeof dy !== 'number') {
      return false;
    }
    return imagePreviewController?.move(event.sender.id, dx, dy) ?? false;
  });

  ipcMain.handle('sticky-notes:get-current-note', (event) => {
    return getNotesManager().getNoteForWebContents(event.sender.id);
  });

  ipcMain.handle('sticky-notes:create-note', () => {
    return getNotesManager().createNote();
  });

  ipcMain.handle('sticky-notes:update-content', (event, content: unknown) => {
    if (typeof content !== 'string') {
      return undefined;
    }

    return getNotesManager().updateContentForWebContents(event.sender.id, content);
  });

  ipcMain.handle('sticky-notes:update-name', (event, name: unknown) => {
    if (typeof name !== 'string') {
      return undefined;
    }

    return getNotesManager().updateNameForWebContents(event.sender.id, name);
  });

  ipcMain.handle('sticky-notes:update-checklist', (event, checklist: unknown) => {
    const normalizedChecklist = normalizeChecklistInput(checklist);

    if (!normalizedChecklist) {
      return undefined;
    }

    return getNotesManager().updateChecklistForWebContents(event.sender.id, normalizedChecklist);
  });

  ipcMain.handle('sticky-notes:update-appearance', (event, appearance: unknown) => {
    if (!appearance || typeof appearance !== 'object') {
      return undefined;
    }

    return getNotesManager().updateAppearanceForWebContents(event.sender.id, appearance);
  });

  ipcMain.handle('sticky-notes:get-auto-launch-status', () => {
    return getAutoLaunchStatus(app);
  });

  ipcMain.handle('sticky-notes:set-auto-launch-enabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return getAutoLaunchStatus(app);
    }

    return setAutoLaunchEnabled(app, enabled);
  });

  ipcMain.handle('sticky-notes:set-collapsed', async (event, collapsed: unknown) => {
    if (typeof collapsed !== 'boolean') {
      return false;
    }

    try {
      const didUpdate = await getNotesManager().setCollapsedForWebContents(
        event.sender.id,
        collapsed
      );
      if (!didUpdate) {
        diagnosticLogger?.record('note_collapse_failed', {
          webContentsId: event.sender.id,
          collapsed,
          reason: 'window-not-found'
        });
      }
      return didUpdate;
    } catch (error) {
      diagnosticLogger?.record('note_collapse_failed', {
        webContentsId: event.sender.id,
        collapsed,
        error
      });
      return false;
    }
  });

  ipcMain.handle('sticky-notes:delete-current-note', async (event) => {
    const sourceNote = getNotesManager().getNoteForWebContents(event.sender.id);
    const deleted = await getNotesManager().deleteNoteForWebContents(event.sender.id);
    if (deleted && sourceNote) {
      imagePreviewController?.handleNoteDeleted(sourceNote.id);
    }
    return deleted;
  });

  ipcMain.handle('sticky-notes:paste-clipboard-image', (event) => {
    return pasteClipboardImage({
      clipboard,
      addImage: (input) => getNotesManager().addImageForWebContents(event.sender.id, input)
    });
  });

  ipcMain.handle('sticky-notes:add-image', (event, imageInput: unknown) => {
    const normalizedInput = normalizeSaveImageInput(imageInput);

    if (!normalizedInput) {
      return undefined;
    }

    return getNotesManager().addImageForWebContents(event.sender.id, normalizedInput);
  });

  ipcMain.handle('sticky-notes:delete-image', async (event, imageId: unknown) => {
    if (typeof imageId !== 'string' || imageId.length === 0) {
      return undefined;
    }

    const result = await getNotesManager().deleteImageForWebContents(
      event.sender.id,
      imageId
    );
    if (result.ok) {
      imagePreviewController?.handleImageDeleted(result.note.id, imageId);
    }
    return result;
  });
}

function createDiagnosticLog(userDataPath: string): DiagnosticLogger {
  const homeDirectory = homedir();
  const logger = createDiagnosticLogger({
    filePath: join(userDataPath, 'logs', 'diagnostic.log'),
    homeDirectory
  });
  logger.record('application_session_started', {
    appVersion: app.getVersion(),
    platform: process.platform,
    osRelease: getOsRelease(),
    arch: getOsArch(),
    packaged: app.isPackaged,
    userDataPath
  });
  return logger;
}

function recordDiagnosticError(event: string, error: unknown): void {
  diagnosticLogger?.record(event, { error });
}

function createDiagnosticMessageLogger(
  event: string
): (message: string, error: unknown) => void {
  return (message, error) => {
    diagnosticLogger?.record(event, { message, error });
  };
}

function registerProcessDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    recordDiagnosticError('main_uncaught_exception', error);
  });
  process.on('unhandledRejection', (reason) => {
    diagnosticLogger?.record('main_unhandled_rejection', { reason });
  });
  app.on('render-process-gone', (_event, webContents, details) => {
    diagnosticLogger?.record('renderer_process_gone', {
      webContentsId: webContents.id,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
  app.on('child-process-gone', (_event, details) => {
    diagnosticLogger?.record('child_process_gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName
    });
  });
}

function observeWindowDiagnostics(window: BrowserWindow, kind: string): void {
  const webContentsId = window.webContents.id;
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    diagnosticLogger?.record('window_load_failed', {
      kind,
      webContentsId,
      errorCode,
      errorDescription
    });
  });
  window.on('unresponsive', () => {
    diagnosticLogger?.record('window_unresponsive', { kind, webContentsId });
  });
  window.on('responsive', () => {
    diagnosticLogger?.record('window_responsive', { kind, webContentsId });
  });
}

function createAutoLaunchDefaultState(userDataPath: string): AutoLaunchDefaultState {
  const markerPath = join(userDataPath, AUTO_LAUNCH_DEFAULT_MARKER);

  return {
    hasAppliedDefault: () => existsSync(markerPath),
    markDefaultApplied: () => {
      writeFileSync(markerPath, '1', 'utf8');
    }
  };
}

function createPlatformUpdateController(): PlatformUpdateController | undefined {
  const beforeInstall = (): Promise<void> => getNotesManager().flushPendingSaves();

  if (shouldEnableAutoUpdates(process.platform, app.isPackaged)) {
    const updater = electronUpdater.autoUpdater;
    if (diagnosticLogger) {
      updater.logger = diagnosticLogger;
      disposeUpdateRequestDiagnostics = attachUpdaterRequestDiagnostics(
        updater.netSession.webRequest,
        diagnosticLogger,
        undefined,
        homedir()
      );
    }
    const progress = createUpdateProgressWindowManager({
      createWindow: createElectronUpdateProgressWindow,
      setFallbackProgress: (progressValue) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.setProgressBar(progressValue);
          }
        }
      },
      logError: createDiagnosticMessageLogger('update_progress_error')
    });
    return createUpdateController({
      updater,
      dialog,
      beforeInstall,
      progress,
      diagnostics: diagnosticLogger,
      logError: createDiagnosticMessageLogger('windows_update_error')
    });
  }

  if (shouldEnableMacManualUpdates(process.platform, app.isPackaged)) {
    return createMacUpdateController({
      currentVersion: app.getVersion(),
      dialog,
      service: createMacUpdateService({
        downloadsPath: app.getPath('downloads'),
        fetch: (input, init) => net.fetch(input, init),
        openPath: (filePath) => shell.openPath(filePath)
      }),
      beforeInstall,
      diagnostics: diagnosticLogger,
      logError: createDiagnosticMessageLogger('mac_update_error'),
      quit: () => app.quit(),
      setProgress: (progress) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.setProgressBar(progress);
          }
        }
      }
    });
  }

  return undefined;
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  const userDataPath = app.getPath('userData');
  diagnosticLogger = createDiagnosticLog(userDataPath);
  registerProcessDiagnostics();
  const notesPath = join(userDataPath, 'notes.json');
  const autoLaunchMarkerPath = join(userDataPath, AUTO_LAUNCH_DEFAULT_MARKER);
  const hadExistingInstallation =
    existsSync(notesPath) || existsSync(autoLaunchMarkerPath);
  releaseFeedbackWindowManager = createReleaseFeedbackWindowManager({
    createWindow: createElectronReleaseFeedbackWindow,
    logWarning: createDiagnosticMessageLogger('release_feedback_window_error')
  });
  releaseFeedbackController = createReleaseFeedbackController({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    hadExistingInstallation,
    releaseNotes: BUILT_RELEASE_NOTES,
    stateStore: createReleaseFeedbackStateStore({
      filePath: join(userDataPath, RELEASE_FEEDBACK_STATE_FILENAME),
      logWarning: createDiagnosticMessageLogger('release_feedback_state_error')
    }),
    presenter: releaseFeedbackWindowManager,
    logWarning: createDiagnosticMessageLogger('release_feedback_error')
  });
  await releaseFeedbackController.initialize();

  try {
    const localProfile = await readLocalProfile(userDataPath);
    appCopy = getAppCopy(localProfile?.displayName);
  } catch (error) {
    recordDiagnosticError('local_profile_load_failed', error);
    console.warn('Unable to load local profile', error);
  }
  const imageStorage = new LocalImageStorage(join(userDataPath, 'images'));
  protocol.handle(IMAGE_PROTOCOL, (request) => imageStorage.createImageResponse(request.url));

  notesManager = new NotesManager({
    storage: new JsonNotesStorage(notesPath, (event, error) => {
      diagnosticLogger?.record(event, { error });
    }),
    imageStorage,
    createWindow: createElectronNoteWindow
  });
  imagePreviewController = new ImagePreviewController({
    createWindow: createElectronImagePreviewWindow,
    logWarning: createDiagnosticMessageLogger('image_preview_error'),
    getSnapshot: (noteId, imageId) => {
      const note = getNotesManager().getNoteById(noteId);
      if (!note || !note.images.some((image) => image.id === imageId)) {
        return undefined;
      }
      return {
        noteId,
        images: note.images.map(({ id, src, width, height }) => ({
          id,
          src,
          width,
          height
        })),
        activeImageId: imageId
      };
    },
    focusSource: (webContentsId) => {
      getNotesManager().focusForWebContents(webContentsId);
    }
  });
  registerIpcHandlers();
  app.on(
    'before-quit',
    createQuitPersistenceHandler({
      flush: () => getNotesManager().flushPendingSaves(),
      quit: () => {
        app.exit(0);
      }
    })
  );
  await notesManager.start();
  if (restoreNotesWhenReady) {
    notesManager.restoreClosedNotes();
    restoreNotesWhenReady = false;
  }

  if (shouldApplyAutoLaunchDefault(is.dev)) {
    try {
      ensureAutoLaunchDefaultEnabled(app, createAutoLaunchDefaultState(userDataPath));
    } catch (error) {
      console.warn('Unable to apply default auto-launch setting', error);
    }
  }

  const updateController = createPlatformUpdateController();
  app.once('before-quit', () => {
    releaseFeedbackController?.beginQuit();
    imagePreviewController?.dispose();
    diagnosticLogger?.record('application_before_quit');
    updateController?.dispose?.();
    disposeUpdateRequestDiagnostics?.();
    disposeUpdateRequestDiagnostics = undefined;
  });

  // The tray right-click menu is the single global surface for app-level
  // actions. Startup is default-enabled once on first run; after that, this
  // menu reflects and owns the user's choice.
  createTray({
    getAutoLaunchEnabled: () => getAutoLaunchStatus(app).enabled,
    setAutoLaunchEnabled: (enabled) => {
      setAutoLaunchEnabled(app, enabled);
    },
    createNote: () => {
      void getNotesManager().createNote();
    },
    restoreNotes: () => {
      getNotesManager().restoreClosedNotes();
    },
    ...(updateController
      ? {
          checkForUpdates: () => {
            void updateController.checkManually();
          }
        }
      : {}),
    currentVersion: app.getVersion(),
    showCurrentRelease: () => {
      void releaseFeedbackController?.showCurrentRelease();
    },
    quit: () => {
      app.quit();
    }
  });

  await releaseFeedbackController.showAutomaticallyIfNeeded();

  if (updateController) {
    void updateController.checkSilently();
  }

  app.on('activate', () => {
    if (shouldCreateWindowOnActivate(BrowserWindow.getAllWindows().length)) {
      void getNotesManager().createNote();
    }
  });
});

app.on('window-all-closed', () => {
  if (shouldQuitWhenAllWindowsClosed(process.platform)) {
    app.quit();
  }
});

async function flushRendererPendingContent(noteWindow: BrowserWindow): Promise<void> {
  if (noteWindow.webContents.isDestroyed()) {
    return;
  }

  await noteWindow.webContents
    .executeJavaScript(
      'Promise.resolve(globalThis.__stickyNotesFlushPendingContent?.()).then(() => undefined)',
      true
    )
    .then(() => undefined)
    .catch(() => undefined);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
