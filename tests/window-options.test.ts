import { describe, expect, it } from 'vitest';
import { NOTE_ALWAYS_ON_TOP_LEVEL, createNoteWindowOptions } from '../main/window-options';

describe('createNoteWindowOptions', () => {
  it('creates a frameless always-on-top sticky note window', () => {
    const options = createNoteWindowOptions();

    expect(options.alwaysOnTop).toBe(true);
    expect(options.frame).toBe(false);
    expect(options.transparent).toBe(true);
    expect(options.resizable).toBe(true);
    expect(options.width).toBe(280);
    expect(options.height).toBe(220);
    expect(options.minWidth).toBe(200);
    expect(options.minHeight).toBe(140);
    expect(options.icon).toMatch(/assets\/icons\/app-icon\.ico$/);
    expect(options.webPreferences?.preload).toMatch(/preload\.mjs$/);
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
  });

  it('uses a floating topmost level so system screenshot overlays can stay above notes', () => {
    expect(NOTE_ALWAYS_ON_TOP_LEVEL).toBe('floating');
  });

  it('restores saved window bounds without disabling resize', () => {
    const options = createNoteWindowOptions({
      x: 120,
      y: 80,
      width: 320,
      height: 260
    });

    expect(options.x).toBe(120);
    expect(options.y).toBe(80);
    expect(options.width).toBe(320);
    expect(options.height).toBe(260);
    expect(options.resizable).toBe(true);
  });

  it('clamps restored bounds into the available display work area', () => {
    const options = createNoteWindowOptions(
      {
        x: 3000,
        y: 2000,
        width: 320,
        height: 260
      },
      [
        {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080
        }
      ]
    );

    expect(options.x).toBe(1600);
    expect(options.y).toBe(820);
    expect(options.width).toBe(320);
    expect(options.height).toBe(260);
  });
});
