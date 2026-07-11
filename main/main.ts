import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, screen, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import electronUpdater from 'electron-updater';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldCreateWindowOnActivate, shouldQuitWhenAllWindowsClosed } from './app-lifecycle';
import {
  ensureAutoLaunchDefaultEnabled,
  getAutoLaunchStatus,
  setAutoLaunchEnabled,
  type AutoLaunchDefaultState
} from './auto-launch';
import { pasteClipboardImage } from './clipboard-image';
import { normalizeChecklistInput } from './checklist-input';
import { normalizeSaveImageInput } from './image-input';
import { IMAGE_PROTOCOL, LocalImageStorage } from './image-storage';
import { readLocalProfile } from './local-profile';
import {
  createMacUpdateController,
  shouldEnableMacManualUpdates
} from './mac-update-controller';
import { createMacUpdateService } from './mac-update-service';
import { type ManagedNoteWindow, NotesManager } from './notes-manager';
import { preventNoteWindowNavigation } from './navigation-guard';
import type { NoteRecord } from './note-state';
import { createClosePersistenceHandler, createQuitPersistenceHandler } from './persistence-lifecycle';
import { JsonNotesStorage } from './storage';
import { createTray } from './tray';
import {
  createUpdateController,
  shouldEnableAutoUpdates,
  type UpdateController
} from './update-controller';
import {
  createUpdateProgressWindowManager,
  createUpdateProgressWindowOptions,
  type UpdateProgressWindowPort
} from './update-progress-window';
import {
  NOTE_ALWAYS_ON_TOP_LEVEL,
  NOTE_WINDOW_ICON_PATH,
  createNoteWindowOptions
} from './window-options';
import { createDebouncedValueAction } from '../shared/debounced-action';
import { DEFAULT_APP_COPY, getAppCopy, type AppCopy } from '../shared/app-copy';
import { UPDATE_PROGRESS_CHANNEL, type UpdateProgressSnapshot } from '../shared/update-progress';

let notesManager: NotesManager | undefined;
let appCopy: AppCopy = DEFAULT_APP_COPY;
let restoreNotesWhenReady = false;
const AUTO_LAUNCH_DEFAULT_MARKER = '.auto-launch-default-applied';
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
      supportFetchAPI: true
    }
  }
]);

function createElectronNoteWindow(note: NoteRecord): ManagedNoteWindow {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const noteWindow = new BrowserWindow(createNoteWindowOptions(note.bounds, workAreas));

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      noteWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      noteWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  noteWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);

  noteWindow.once('ready-to-show', () => {
    noteWindow.show();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void noteWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void noteWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  const listenerBag: {
    boundsChanged?: () => void | Promise<void>;
  } = {};
  const saveBounds = createDebouncedValueAction<void>(() => {
    return listenerBag.boundsChanged?.();
  }, 300);
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

  return {
    webContentsId: noteWindow.webContents.id,
    getBounds: () => noteWindow.getBounds(),
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

function getNotesManager(): NotesManager {
  if (!notesManager) {
    throw new Error('Notes manager is not ready');
  }

  return notesManager;
}

function registerIpcHandlers(): void {
  ipcMain.handle('sticky-notes:get-app-copy', () => appCopy);

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

  ipcMain.handle('sticky-notes:delete-current-note', (event) => {
    return getNotesManager().deleteNoteForWebContents(event.sender.id);
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

  ipcMain.handle('sticky-notes:delete-image', (event, imageId: unknown) => {
    if (typeof imageId !== 'string' || imageId.length === 0) {
      return undefined;
    }

    return getNotesManager().deleteImageForWebContents(event.sender.id, imageId);
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
    const progress = createUpdateProgressWindowManager({
      createWindow: createElectronUpdateProgressWindow,
      setFallbackProgress: (progressValue) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.setProgressBar(progressValue);
          }
        }
      }
    });
    return createUpdateController({
      updater: electronUpdater.autoUpdater,
      dialog,
      beforeInstall,
      progress
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
  try {
    const localProfile = await readLocalProfile(userDataPath);
    appCopy = getAppCopy(localProfile?.displayName);
  } catch (error) {
    console.warn('Unable to load local profile', error);
  }
  const imageStorage = new LocalImageStorage(join(userDataPath, 'images'));
  protocol.handle(IMAGE_PROTOCOL, (request) => imageStorage.createImageResponse(request.url));

  notesManager = new NotesManager({
    storage: new JsonNotesStorage(join(userDataPath, 'notes.json')),
    imageStorage,
    createWindow: createElectronNoteWindow
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

  try {
    ensureAutoLaunchDefaultEnabled(app, createAutoLaunchDefaultState(userDataPath));
  } catch (error) {
    console.warn('Unable to apply default auto-launch setting', error);
  }

  const updateController = createPlatformUpdateController();
  app.once('before-quit', () => {
    updateController?.dispose?.();
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
    quit: () => {
      app.quit();
    }
  });

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
