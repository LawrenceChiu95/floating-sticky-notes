import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const preloadSource = readFileSync(resolve(__dirname, '../preload/update-progress-preload.ts'), 'utf8');
const rendererSource = readFileSync(resolve(__dirname, '../renderer/src/update-progress.ts'), 'utf8');

describe('update progress diagnostic wiring', () => {
  it('writes main-process boundaries and captures renderer diagnostic console events', () => {
    expect(mainSource).toContain("'update-progress-debug.log'");
    expect(mainSource).toContain("webContents.on('console-message'");
    expect(mainSource).toContain("'renderer.console'");
    expect(mainSource).toContain('createElectronUpdateProgressWindow(logDebug)');
  });

  it('reports preload receipt and the renderer final DOM without adding renderer IPC authority', () => {
    expect(preloadSource).toContain('preload.loaded');
    expect(preloadSource).toContain('preload.snapshot-received');
    expect(preloadSource).not.toContain('ipcRenderer.send');
    expect(rendererSource).toContain('renderer.rendered');
  });
});
