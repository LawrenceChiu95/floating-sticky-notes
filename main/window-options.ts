import type { BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { DEFAULT_NOTE_BOUNDS, type NoteBounds } from './note-state';
import {
  NOTE_COLLAPSED_HEIGHT,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH
} from '../shared/note-window';

export { NOTE_COLLAPSED_HEIGHT, NOTE_MIN_HEIGHT, NOTE_MIN_WIDTH } from '../shared/note-window';

export const NOTE_ALWAYS_ON_TOP_LEVEL = 'floating';
export const NOTE_WINDOW_ICON_PATH = join(__dirname, '../../assets/icons/app-icon.ico');

export type DisplayWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function createNoteWindowOptions(
  bounds: NoteBounds = DEFAULT_NOTE_BOUNDS,
  workAreas: DisplayWorkArea[] = []
): BrowserWindowConstructorOptions {
  const windowBounds = clampNoteBounds(bounds, workAreas);

  return {
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: NOTE_MIN_WIDTH,
    minHeight: NOTE_MIN_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    // Native shadows are not stable on transparent frameless windows: resizing
    // or moving the note makes macOS recompute the opaque outline and exposes a
    // dark halo around the 96×32 dock tab.  Keep one compositor policy for every
    // state; ordinary notes retain their CSS border/inset shading, while the
    // OS-level outer projection is intentionally removed and needs Mac review.
    hasShadow: false,
    // macOS otherwise clips every frameless window to its own four rounded
    // corners before Chromium compositing.  That mask overrides the dock tab's
    // side-specific CSS shape and leaves transparent notches at the screen
    // edge.  Keep the native window rectangular and let the note shell own the
    // visible corner radii in every presentation.
    roundedCorners: false,
    resizable: true,
    skipTaskbar: false,
    show: false,
    icon: NOTE_WINDOW_ICON_PATH,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 窗口交接架构下贴边态主窗整体 hide 保活，而拖出展开的 prepare 需要在
      // 隐藏态跑 rAF（waitForNextPaint）备好揭示首帧并回 ACK。默认 throttling
      // 会在窗口 show 过又 hide 后停掉 rAF：首次展开（主窗从未 show，rAF 活着）
      // 成功、首次吸附 hide 之后的一切展开都 ACK 超时回滚（真机实锤 2026-09-01）。
      // 与书签头窗同一设置。
      backgroundThrottling: false
    }
  };
}

export function clampNoteBoundsToWorkAreas(
  bounds: NoteBounds,
  workAreas: DisplayWorkArea[],
  displayAnchorBounds: NoteBounds = bounds
): NoteBounds {
  return clampNoteBounds(bounds, workAreas, displayAnchorBounds);
}

function clampNoteBounds(
  bounds: NoteBounds,
  workAreas: DisplayWorkArea[],
  displayAnchorBounds: NoteBounds = bounds
): NoteBounds {
  const width = Math.max(NOTE_MIN_WIDTH, bounds.width);
  const height = Math.max(NOTE_MIN_HEIGHT, bounds.height);

  if (bounds.x === undefined || bounds.y === undefined || workAreas.length === 0) {
    return {
      ...bounds,
      width,
      height
    };
  }

  const workArea = findNearestWorkArea(displayAnchorBounds, workAreas);
  const clampedWidth = Math.min(width, workArea.width);
  const clampedHeight = Math.min(height, workArea.height);

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - clampedWidth),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - clampedHeight),
    width: clampedWidth,
    height: clampedHeight
  };
}

function findNearestWorkArea(bounds: NoteBounds, workAreas: DisplayWorkArea[]): DisplayWorkArea {
  const centerX = (bounds.x ?? 0) + bounds.width / 2;
  const centerY = (bounds.y ?? 0) + bounds.height / 2;

  return workAreas.reduce((nearest, workArea) => {
    const nearestDistance = distanceToWorkArea(centerX, centerY, nearest);
    const candidateDistance = distanceToWorkArea(centerX, centerY, workArea);
    return candidateDistance < nearestDistance ? workArea : nearest;
  });
}

function distanceToWorkArea(x: number, y: number, workArea: DisplayWorkArea): number {
  const clampedX = clamp(x, workArea.x, workArea.x + workArea.width);
  const clampedY = clamp(y, workArea.y, workArea.y + workArea.height);
  return Math.hypot(x - clampedX, y - clampedY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
