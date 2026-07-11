import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const preloadSource = readFileSync(
  resolve(__dirname, '../preload/update-progress-preload.ts'),
  'utf8'
);

describe('update progress preload boundary', () => {
  it('exposes only a removable read-only progress subscription', () => {
    expect(preloadSource).toContain('UPDATE_PROGRESS_CHANNEL');
    expect(preloadSource).toContain("exposeInMainWorld('updateProgress'");
    expect(preloadSource).toContain('ipcRenderer.on(UPDATE_PROGRESS_CHANNEL');
    expect(preloadSource).toContain('ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL');
    expect(preloadSource).not.toContain('sticky-notes:');
    expect(preloadSource).not.toContain('ipcRenderer.invoke');
    expect(preloadSource).not.toContain('ipcRenderer.send');
  });
});
