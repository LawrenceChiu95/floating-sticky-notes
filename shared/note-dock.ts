export const NOTE_DOCK_WIDTH = 36;
export const NOTE_DOCK_HEIGHT = 96;
export const NOTE_DOCK_EDGE_THRESHOLD_PX = 24;
export const NOTE_DOCK_UNFOLD_THRESHOLD_PX = 48;
export const NOTE_DOCK_STACK_GAP_PX = 8;
export const NOTE_DOCK_MIN_GRAB_PX = 24;

export type DockSide = 'left' | 'right';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveCollapsedDockSide(
  bar: Rect,
  workArea: DisplayWorkArea
): DockSide | undefined {
  const leftDistance = bar.x - workArea.x;
  const rightDistance = workArea.x + workArea.width - (bar.x + bar.width);
  if (leftDistance <= NOTE_DOCK_EDGE_THRESHOLD_PX && leftDistance <= rightDistance) {
    return 'left';
  }
  if (rightDistance <= NOTE_DOCK_EDGE_THRESHOLD_PX) {
    return 'right';
  }
  return undefined;
}

export function resolveDockedRelease(input: {
  side: DockSide;
  origin: Rect;
  current: Rect;
}): 'expand' | 'snap-back' {
  const delta =
    input.side === 'left' ? input.current.x - input.origin.x : input.origin.x - input.current.x;
  return delta >= NOTE_DOCK_UNFOLD_THRESHOLD_PX ? 'expand' : 'snap-back';
}

export function buildDockedBounds(input: {
  side: DockSide;
  y: number;
  workArea: DisplayWorkArea;
}): Rect {
  const y = clamp(
    input.y,
    input.workArea.y,
    input.workArea.y + input.workArea.height - NOTE_DOCK_HEIGHT
  );
  return {
    x:
      input.side === 'left'
        ? input.workArea.x
        : input.workArea.x + input.workArea.width - NOTE_DOCK_WIDTH,
    y,
    width: NOTE_DOCK_WIDTH,
    height: NOTE_DOCK_HEIGHT
  };
}

export function buildExpandBoundsFromDock(input: {
  side: DockSide;
  sliver: Rect;
  expandedSize: { width: number; height: number };
  workArea: DisplayWorkArea;
}): Rect {
  const width = Math.min(input.expandedSize.width, input.workArea.width);
  const height = Math.min(input.expandedSize.height, input.workArea.height);
  const x =
    input.side === 'left' ? input.sliver.x : input.sliver.x + input.sliver.width - width;
  const y = input.sliver.y;
  return {
    x: clamp(x, input.workArea.x, input.workArea.x + input.workArea.width - width),
    y: clamp(y, input.workArea.y, input.workArea.y + input.workArea.height - height),
    width,
    height
  };
}

export function offsetDockYToAvoidOverlap(input: {
  y: number;
  side: DockSide;
  workArea: DisplayWorkArea;
  occupied: Array<{ side: DockSide; y: number }>;
}): number {
  const taken = input.occupied
    .filter((item) => item.side === input.side)
    .map((item) => item.y)
    .sort((a, b) => a - b);
  const minY = input.workArea.y;
  const maxY = input.workArea.y + input.workArea.height - NOTE_DOCK_HEIGHT;
  let y = clamp(input.y, minY, maxY);
  const overlaps = (candidate: number): boolean =>
    taken.some((existing) => Math.abs(existing - candidate) < NOTE_DOCK_HEIGHT);
  while (overlaps(y) && y + NOTE_DOCK_HEIGHT + NOTE_DOCK_STACK_GAP_PX <= maxY) {
    y += NOTE_DOCK_HEIGHT + NOTE_DOCK_STACK_GAP_PX;
  }
  while (overlaps(y) && y - NOTE_DOCK_HEIGHT - NOTE_DOCK_STACK_GAP_PX >= minY) {
    y -= NOTE_DOCK_HEIGHT + NOTE_DOCK_STACK_GAP_PX;
  }
  if (overlaps(y)) {
    const first = taken[0] ?? y;
    const last = taken[taken.length - 1] ?? y;
    const below = last + NOTE_DOCK_MIN_GRAB_PX;
    if (below <= maxY) {
      y = below;
    } else if (first - NOTE_DOCK_MIN_GRAB_PX >= minY) {
      y = first - NOTE_DOCK_MIN_GRAB_PX;
    } else {
      y = clamp(below, minY, maxY);
    }
  }
  return y;
}

export function restoreDockedBounds(input: {
  dock: { side: DockSide; y: number };
  workAreas: DisplayWorkArea[];
}): Rect | undefined {
  let best: { bounds: Rect; distance: number } | undefined;

  for (const workArea of input.workAreas) {
    const bounds = buildDockedBounds({ side: input.dock.side, y: input.dock.y, workArea });
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const isVisible =
      centerX >= workArea.x &&
      centerX <= workArea.x + workArea.width &&
      centerY >= workArea.y &&
      centerY <= workArea.y + workArea.height;

    if (!isVisible) {
      continue;
    }

    const distance = Math.abs(bounds.y - input.dock.y);
    if (!best || distance < best.distance) {
      best = { bounds, distance };
    }
  }

  return best?.bounds;
}

export function findNearestWorkArea(
  bounds: { x?: number; y?: number; width: number; height: number },
  workAreas: DisplayWorkArea[]
): DisplayWorkArea | undefined {
  const centerX = (bounds.x ?? 0) + bounds.width / 2;
  const centerY = (bounds.y ?? 0) + bounds.height / 2;

  return workAreas.reduce<DisplayWorkArea | undefined>((nearest, workArea) => {
    if (!nearest) {
      return workArea;
    }
    const nearestDistance = distanceToWorkArea(centerX, centerY, nearest);
    const candidateDistance = distanceToWorkArea(centerX, centerY, workArea);
    return candidateDistance < nearestDistance ? workArea : nearest;
  }, undefined);
}

function distanceToWorkArea(x: number, y: number, workArea: DisplayWorkArea): number {
  const clampedX = clamp(x, workArea.x, workArea.x + workArea.width);
  const clampedY = clamp(y, workArea.y, workArea.y + workArea.height);
  return Math.hypot(x - clampedX, y - clampedY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
