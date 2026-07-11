import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');

describe('auto-update main-process wiring', () => {
  it('uses electron-updater only for packaged Windows builds', () => {
    expect(mainSource).toContain("import electronUpdater from 'electron-updater';");
    expect(mainSource).not.toContain("import { autoUpdater } from 'electron-updater';");
    expect(mainSource).toMatch(
      /shouldEnableAutoUpdates\(\s*process\.platform,\s*app\.isPackaged\s*\)/
    );
    expect(mainSource).toContain('createUpdateController({');
    expect(mainSource).toContain('updater: electronUpdater.autoUpdater');
    expect(mainSource).toContain('createUpdateProgressWindowManager({');
    expect(mainSource).toContain('progress');
  });

  it('creates a secure ownerless progress window on the active display', () => {
    expect(mainSource).toContain('screen.getDisplayNearestPoint(screen.getCursorScreenPoint())');
    expect(mainSource).toContain("'../preload/updateProgressPreload.mjs'");
    expect(mainSource).toContain("'../renderer/update-progress.html'");
    expect(mainSource).toContain('UPDATE_PROGRESS_CHANNEL');
    expect(mainSource).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(mainSource).toContain('createUpdateProgressWindowOptions(');
  });

  it('uses the manual DMG flow only for packaged macOS builds', () => {
    expect(mainSource).toContain('shouldEnableMacManualUpdates(');
    expect(mainSource).toContain('createMacUpdateController({');
    expect(mainSource).toContain('createMacUpdateService({');
    expect(mainSource).toContain("downloadsPath: app.getPath('downloads')");
    expect(mainSource).toContain('currentVersion: app.getVersion()');
    expect(mainSource).toContain('fetch: (input, init) => net.fetch(input, init)');
    expect(mainSource).toContain('openPath: (filePath) => shell.openPath(filePath)');
    expect(mainSource).toContain('window.setProgressBar(progress)');
  });

  it('connects manual tray checks and silent startup checks to the controller', () => {
    expect(mainSource).toContain('checkForUpdates: () =>');
    expect(mainSource).toContain('checkManually()');
    expect(mainSource).toContain('checkSilently()');
  });

  it('disposes Windows update UI during app shutdown', () => {
    expect(mainSource).toContain("app.once('before-quit'");
    expect(mainSource).toContain('updateController?.dispose?.()');
  });

  it('flushes all pending note changes before installing', () => {
    expect(mainSource).toContain(
      'const beforeInstall = (): Promise<void> => getNotesManager().flushPendingSaves();'
    );
    expect(mainSource).toMatch(/createUpdateController\(\{[\s\S]*?beforeInstall,[\s\S]*?\}\)/);
    expect(mainSource).toMatch(/createMacUpdateController\(\{[\s\S]*?beforeInstall,/);
  });

  it('loads local copy before windows start and exposes it through IPC', () => {
    expect(mainSource).toContain('readLocalProfile(userDataPath)');
    expect(mainSource).toContain("ipcMain.handle('sticky-notes:get-app-copy'");
    expect(mainSource.indexOf('readLocalProfile(userDataPath)')).toBeLessThan(
      mainSource.indexOf('await notesManager.start()')
    );
  });
});
