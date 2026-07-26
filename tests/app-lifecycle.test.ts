import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  DEV_USER_DATA_DIR_NAME,
  getDevUserDataPath,
  shouldApplyAutoLaunchDefault,
  shouldCreateWindowOnActivate,
  shouldQuitWhenAllWindowsClosed
} from '../main/app-lifecycle';

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

  it('never applies the global auto-launch default from a development process', () => {
    expect(shouldApplyAutoLaunchDefault(true)).toBe(false);
    expect(shouldApplyAutoLaunchDefault(false)).toBe(true);
  });

  it('isolates dev userData under a dedicated directory that cannot collide with production', () => {
    expect(DEV_USER_DATA_DIR_NAME).toBe('floating-sticky-notes-dev');
    expect(getDevUserDataPath('/x/appData')).toBe(join('/x/appData', 'floating-sticky-notes-dev'));
    expect(getDevUserDataPath('/x/appData')).not.toBe(
      join('/x/appData', 'floating-sticky-notes')
    );
  });
});
