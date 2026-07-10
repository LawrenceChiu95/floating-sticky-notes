import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');

describe('auto-update main-process wiring', () => {
  it('uses electron-updater only for packaged Windows builds', () => {
    expect(mainSource).toContain("from 'electron-updater'");
    expect(mainSource).toMatch(
      /shouldEnableAutoUpdates\(\s*process\.platform,\s*app\.isPackaged\s*\)/
    );
    expect(mainSource).toContain('createUpdateController({');
  });

  it('connects manual tray checks and silent startup checks to the controller', () => {
    expect(mainSource).toContain('checkForUpdates: () =>');
    expect(mainSource).toContain('checkManually()');
    expect(mainSource).toContain('checkSilently()');
  });

  it('flushes all pending note changes before installing', () => {
    expect(mainSource).toContain('beforeInstall: () => getNotesManager().flushPendingSaves()');
  });

  it('loads local copy before windows start and exposes it through IPC', () => {
    expect(mainSource).toContain('readLocalProfile(userDataPath)');
    expect(mainSource).toContain("ipcMain.handle('sticky-notes:get-app-copy'");
    expect(mainSource.indexOf('readLocalProfile(userDataPath)')).toBeLessThan(
      mainSource.indexOf('await notesManager.start()')
    );
  });
});
