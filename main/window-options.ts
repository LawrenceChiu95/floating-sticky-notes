import type { BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { DEFAULT_NOTE_BOUNDS, type NoteBounds } from './note-state';

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
    minWidth: 200,
    minHeight: 140,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
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

function clampNoteBounds(bounds: NoteBounds, workAreas: DisplayWorkArea[]): NoteBounds {
  const width = Math.max(200, bounds.width);
  const height = Math.max(140, bounds.height);

  if (bounds.x === undefined || bounds.y === undefined || workAreas.length === 0) {
    return {
      ...bounds,
      width,
      height
    };
  }

  const workArea = findNearestWorkArea(bounds, workAreas);
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
