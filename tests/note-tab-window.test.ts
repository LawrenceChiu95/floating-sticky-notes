import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyNoteTabWindowChrome,
  createNoteTabWindowOptions,
  NOTE_TAB_BIRTH_HEIGHT,
  NOTE_TAB_BIRTH_WIDTH
} from '../main/note-tab-window';
import { NOTE_DOCK_HEIGHT, NOTE_DOCK_WIDTH } from '../shared/note-dock';
import { NotesManager } from '../main/notes-manager';

const preloadSource = readFileSync(resolve(__dirname, '../preload/preload.ts'), 'utf8');
const appSource = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
const tabAppSource = readFileSync(resolve(__dirname, '../renderer/src/TabApp.tsx'), 'utf8');
const globalTypes = readFileSync(resolve(__dirname, '../renderer/src/global.d.ts'), 'utf8');

describe('note tab window (窗口交接架构)', () => {
  it('is born at a normal strip size so macOS delivers mouse events, and never resizes while visible', () => {
    const options = createNoteTabWindowOptions();

    // 出生即 96×32 + 不可缩放 + 整页拖窗区的窗口在 macOS 上收不到 OS 鼠标事件
    // （便签主窗实测教训）；出生用普通横条尺寸，示出前在隐藏态定型到书签头矩形。
    expect(options.width).toBe(NOTE_TAB_BIRTH_WIDTH);
    expect(options.height).toBe(NOTE_TAB_BIRTH_HEIGHT);
    expect(options.resizable).toBe(false);
    // 不变量：可见时尺寸恒定。锁定只交给「隐藏态 setBounds 定型 + resizable:false」，
    // 不靠 min/max（那会与出生尺寸冲突）。
    expect(options.minWidth).toBeUndefined();
    expect(options.maxWidth).toBeUndefined();
  });

  it('matches the note window compositor policy (transparent, no shadow, rectangular)', () => {
    const options = createNoteTabWindowOptions();

    expect(options.transparent).toBe(true);
    expect(options.hasShadow).toBe(false);
    expect(options.roundedCorners).toBe(false);
    expect(options.frame).toBe(false);
    expect(options.alwaysOnTop).toBe(true);
    expect(options.show).toBe(false);
    expect(options.backgroundColor).toBe('#00000000');
  });

  it('keeps painting while hidden so the handover shows an already-painted frame', () => {
    const options = createNoteTabWindowOptions();

    expect(options.webPreferences?.backgroundThrottling).toBe(false);
    expect(options.webPreferences?.preload).toContain('preload.cjs');
  });

  it('renders the tab view from the shared renderer bundle with note and side in the query', () => {
    expect(tabAppSource).toContain('DockedNoteShell');
    expect(appSource).toContain("get('view') === 'tab'");
    expect(appSource).toContain('<TabApp />');
  });

  it('exposes the tab-ready paint ack through preload and renderer types', () => {
    expect(preloadSource).toContain("ipcRenderer.send('sticky-notes:dock-tab-ready')");
    expect(globalTypes).toContain('dockTabReady: () => void;');
    expect(tabAppSource).toContain('window.stickyNotes.dockTabReady()');
  });
});

describe('NotesManager auxiliary webContents (书签头窗只读映射)', () => {
  it('is typed on NotesManager for the tab window get-current-note lookup', () => {
    const managerPrototype = NotesManager.prototype as unknown as Record<string, unknown>;

    expect(typeof managerPrototype.attachAuxiliaryWebContents).toBe('function');
    expect(typeof managerPrototype.detachAuxiliaryWebContents).toBe('function');
  });
});
