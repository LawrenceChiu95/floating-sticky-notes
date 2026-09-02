import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { NOTE_DOCK_HEIGHT, NOTE_DOCK_WIDTH } from '../shared/note-dock';
import {
  NOTE_ALWAYS_ON_TOP_LEVEL,
  NOTE_COLLAPSED_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_WINDOW_ICON_PATH
} from './window-options';

export type DockTabSide = 'left' | 'right';

// 书签头窗出生尺寸：普通横条大小。教训来自便签主窗（docs/design/edge-dock.md
// 「贴边恢复不能出生即贴边」）：出生就是 96×32 + 不可缩放 + 整页拖窗区的窗口
// 在 macOS 上收不到任何 OS 鼠标事件（enter/click 全丢）；先按普通窗口创建、
// 趁 show:false 改成贴边几何的窗口事件正常。主进程在示出前把窗口 setBounds
// 到最终书签头矩形（隐藏态 resize 不可见，不构成「可见时刻改尺寸」的闪烁）。
export const NOTE_TAB_BIRTH_WIDTH = NOTE_MIN_WIDTH;
export const NOTE_TAB_BIRTH_HEIGHT = NOTE_COLLAPSED_HEIGHT;

// 窗口交接架构（2026-09-01 定案，见 docs/design/edge-dock.md）：落定闪烁的根因
// 是「可见时刻改透明窗尺寸」——Chromium 合成器跨进程异步出帧，WindowServer 几何
// 同步生效，尺寸一变中间帧露空，JS 层不可修。因此书签头是一枚**独立恒尺寸窗口**：
// 示出后从不再 resize（多屏共边的 48 宽变体也在隐藏态定型），全部可见运动都是
// 纯位移（悬停探头滑行）或 DOM 动画（吸附/展开的交接前段）。
export function createNoteTabWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: NOTE_TAB_BIRTH_WIDTH,
    height: NOTE_TAB_BIRTH_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    skipTaskbar: false,
    show: false,
    icon: NOTE_WINDOW_ICON_PATH,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 书签头窗在隐藏态就要完成首帧 paint（ready ACK 之后主进程才
      // showInactive 交接），不能被遮挡/隐藏节流掐掉。
      backgroundThrottling: false
    }
  };
}

// 书签头窗与便签主窗共用同一份 renderer 包，?view=tab 只渲染书签头壳；
// note/dock query 让 preload 与 renderer 首帧就知道渲染哪张便签、贴哪条边。
export function loadNoteTabWindow(
  tabWindow: BrowserWindow,
  query: { noteId: string; side: DockTabSide }
): void {
  const search = `view=tab&note=${encodeURIComponent(query.noteId)}&dock=${query.side}`;
  // ELECTRON_RENDERER_URL 只在 dev 存在（electron-vite 注入），与便签主窗的
  // 加载分支判定一致；不引 @electron-toolkit/utils，保持本模块可被 vitest 直接加载。
  if (process.env.ELECTRON_RENDERER_URL) {
    void tabWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${search}`);
    return;
  }
  void tabWindow.loadFile(join(__dirname, '../renderer/index.html'), {
    query: { view: 'tab', note: query.noteId, dock: query.side }
  });
}

export function applyNoteTabWindowChrome(tabWindow: BrowserWindow): void {
  tabWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);
}

export { NOTE_DOCK_WIDTH, NOTE_DOCK_HEIGHT };
