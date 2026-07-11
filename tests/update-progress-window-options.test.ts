import { describe, expect, it } from 'vitest';
import { createUpdateProgressWindowOptions } from '../main/update-progress-window';

describe('update progress window options', () => {
  it('creates a non-modal, minimizable and sandboxed utility window', () => {
    const options = createUpdateProgressWindowOptions(
      { x: 100, y: 50, width: 1200, height: 800 },
      '/app/preload.mjs',
      '/app/icon.ico'
    );

    expect(options).toMatchObject({
      x: 520,
      y: 360,
      width: 360,
      height: 180,
      show: false,
      modal: false,
      closable: false,
      minimizable: true,
      maximizable: false,
      resizable: false,
      skipTaskbar: false,
      icon: '/app/icon.ico',
      webPreferences: {
        preload: '/app/preload.mjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    expect(options).not.toHaveProperty('parent');
    expect(options.alwaysOnTop).not.toBe(true);
  });

  it('keeps the initial window inside a small display work area', () => {
    const options = createUpdateProgressWindowOptions(
      { x: -500, y: 20, width: 300, height: 120 },
      '/app/preload.mjs',
      '/app/icon.ico'
    );

    expect(options).toMatchObject({
      x: -500,
      y: 20,
      width: 300,
      height: 120
    });
  });
});
