import { describe, expect, it } from 'vitest';
import { shouldCreateWindowOnActivate, shouldQuitWhenAllWindowsClosed } from '../main/app-lifecycle';

describe('app lifecycle decisions', () => {
  it('keeps tray-supported desktop platforms alive when all windows are closed', () => {
    expect(shouldQuitWhenAllWindowsClosed('darwin')).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed('win32')).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed('linux')).toBe(true);
  });

  it('creates a new note window on activate only when no windows exist', () => {
    expect(shouldCreateWindowOnActivate(0)).toBe(true);
    expect(shouldCreateWindowOnActivate(1)).toBe(false);
  });
});
