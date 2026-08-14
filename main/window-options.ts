import type { BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { DEFAULT_NOTE_BOUNDS, type NoteBounds } from './note-state';
import {
  NOTE_COLLAPSED_HEIGHT,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH
} from '../shared/note-window';
import { NOTE_DOCK_HEIGHT, NOTE_DOCK_WIDTH } from '../shared/note-dock';

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
  workAreas: DisplayWorkArea[] = [],
  dockedBounds?: Required<NoteBounds>
): BrowserWindowConstructorOptions {
  // 贴边恢复时窗口直接建成 36×96 的书签头：最小尺寸不能用 NOTE_MIN_WIDTH，
  // 否则 Math.max 会把书签头撑成 200px 宽。
  const isDocked = dockedBounds !== undefined;
  const windowBounds = dockedBounds ?? clampNoteBounds(bounds, workAreas);

  return {
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: isDocked ? NOTE_DOCK_WIDTH : NOTE_MIN_WIDTH,
    minHeight: isDocked ? NOTE_DOCK_HEIGHT : NOTE_MIN_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: !isDocked,
    skipTaskbar: false,
    show: false,
    icon: NOTE_WINDOW_ICON_PATH,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
