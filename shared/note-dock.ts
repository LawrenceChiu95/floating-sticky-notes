// 贴边书签头是一枚横条：96px 伸进桌面、32px 沿边，明显扁于竖胶囊，
// 像便利书签从屏幕边缘探出的头。
export const NOTE_DOCK_WIDTH = 96;
export const NOTE_DOCK_HEIGHT = 32;
// 书签头一半藏进屏外：窗口仍 96 宽，静止时一半探出屏幕边缘，只露 48px 的头，
// 是加速球那种「吸进边缘」的半藏手感。
export const NOTE_DOCK_HIDDEN_PX = 48;
export const NOTE_DOCK_VISIBLE_PX = NOTE_DOCK_WIDTH - NOTE_DOCK_HIDDEN_PX;
export const NOTE_DOCK_UNFOLD_THRESHOLD_PX = 48;
// 沿边上下拖的手抖回差：x 偏移落在 [阈值, 回差上限) 且光标仍贴着抓取点时，
// 视为竖拖带出的横向抖动而非「向外拉离」，不展开（松手后照常滑回钉边）。
export const NOTE_DOCK_UNFOLD_HYSTERESIS_PX = 72;
// 吸附触发：横条边缘探出屏外 ≥8px（光标顶到屏幕边）才算推向边缘，
// 路过、靠近不再误吸。
export const NOTE_DOCK_SNAP_OVERLAP_PX = 8;
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
  workArea: DisplayWorkArea,
  neighborWorkAreas: DisplayWorkArea[] = []
): DockSide | undefined {
  // 探出屏外才算推向边缘：横条左/右缘越过工作区边缘 ≥8px。
  const leftOverlap = workArea.x - bar.x;
  const rightOverlap = bar.x + bar.width - (workArea.x + workArea.width);
  const side =
    leftOverlap >= NOTE_DOCK_SNAP_OVERLAP_PX && leftOverlap >= rightOverlap
      ? 'left'
      : rightOverlap >= NOTE_DOCK_SNAP_OVERLAP_PX
        ? 'right'
        : undefined;
  if (!side) {
    return undefined;
  }
  // 探出部分落在相邻显示器上 = 在跨屏拖动，不是推向真屏幕边缘，不吸附。
  const overhang: Rect =
    side === 'left'
      ? { x: bar.x, y: bar.y, width: leftOverlap, height: bar.height }
      : {
          x: workArea.x + workArea.width,
          y: bar.y,
          width: rightOverlap,
          height: bar.height
        };
  if (neighborWorkAreas.some((area) => rectsIntersect(overhang, area))) {
    return undefined;
  }
  return side;
}

// 磁吸判定：书签头被原生拖动时看它离「静止贴边位」的水平位移——≥48px 立即展开，
// 不足则继续沿边滑动。从静止位起算而不是距屏幕边缘，因为半藏时静止位本身在屏外。
// 只看当前位置，不依赖拖动起点，因为原生 app-region 拖动没有「拖动开始/结束」事件可用。
// 位移取绝对值（2026-08-27）：旧版带方向（右贴边只算往左），往屏缘外侧拖——多屏时
// 必然拖上邻屏——offset 恒负永不展开，窗口被原生拖拽自由带出一两千像素，松手后
// 惰性钉回 180ms 横跨整个屏幕拽回来（真机日志 tuck 3539→1614 / 3814→1422），
// 这就是「吸附抽搞」的主根因。往哪个方向拉离 72px 都是明确的「拖出来」。
export function resolveDockedEdgeOffset(input: {
  side: DockSide;
  current: Rect;
  dockedX: number;
}): number {
  return Math.abs(input.current.x - input.dockedX);
}

export function resolveDockedEdgeRelease(input: {
  side: DockSide;
  current: Rect;
  dockedX: number;
}): 'expand' | 'stay' {
  return resolveDockedEdgeOffset(input) >= NOTE_DOCK_UNFOLD_THRESHOLD_PX ? 'expand' : 'stay';
}

// The strip is clipped from the side that remains visually attached to the
// dock.  Right-side docks retain the strip's left edge; left-side docks retain
// its right edge.  Keeping this calculation in the shared geometry module
// prevents the renderer from silently using a different coordinate origin.
export function resolveDockShrinkDelta(input: {
  side: DockSide;
  strip: Pick<Rect, 'x' | 'width'>;
  bookmark: Pick<Rect, 'x' | 'width'>;
}): number {
  const retainedX =
    input.side === 'right'
      ? input.strip.x
      : input.strip.x + input.strip.width - input.bookmark.width;
  return input.bookmark.x - retainedX;
}

export function buildDockedBounds(input: {
  side: DockSide;
  y: number;
  workArea: DisplayWorkArea;
  neighborWorkAreas?: DisplayWorkArea[];
  reveal?: boolean;
}): Rect {
  const y = clamp(
    input.y,
    input.workArea.y,
    input.workArea.y + input.workArea.height - NOTE_DOCK_HEIGHT
  );
  // 悬停探头：整条 96px 滑进屏内贴在边缘，没有隐藏半幅，天然不漏邻屏。
  if (input.reveal) {
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
  // 藏进屏外的那一半不能漏到相邻显示器上（多屏共边时会显示在旁边的屏里）；
  // 会漏就把窗口收成只有可见头那么宽、完整贴在屏内，不留透明死区。
  const hiddenRect: Rect = {
    x:
      input.side === 'left'
        ? input.workArea.x - NOTE_DOCK_HIDDEN_PX
        : input.workArea.x + input.workArea.width,
    y,
    width: NOTE_DOCK_HIDDEN_PX,
    height: NOTE_DOCK_HEIGHT
  };
  const leaksToNeighbor = (input.neighborWorkAreas ?? []).some((area) =>
    rectsIntersect(hiddenRect, area)
  );
  if (leaksToNeighbor) {
    return {
      x:
        input.side === 'left'
          ? input.workArea.x
          : input.workArea.x + input.workArea.width - NOTE_DOCK_VISIBLE_PX,
      y,
      width: NOTE_DOCK_VISIBLE_PX,
      height: NOTE_DOCK_HEIGHT
    };
  }
  return {
    x:
      input.side === 'left'
        ? input.workArea.x - NOTE_DOCK_HIDDEN_PX
        : input.workArea.x + input.workArea.width - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX,
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
  dock: { side: DockSide; y: number; x?: number };
  workAreas: DisplayWorkArea[];
}): Rect | undefined {
  let best: { bounds: Rect; distance: number; xDistance: number } | undefined;

  for (const workArea of input.workAreas) {
    const bounds = buildDockedBounds({
      side: input.dock.side,
      y: input.dock.y,
      workArea,
      neighborWorkAreas: input.workAreas.filter((area) => area !== workArea)
    });
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

    // 认屏优先于 y 贴合：多屏时同名边（如每屏都有的右边缘）y 距离常常打平，
    // 持久化的静止位 x 才是屏归属的证据；旧记录没有 x 时 xDistance 全为 0，
    // 退化为原来的 y 距离猜屏。屏被拔掉后候选自然消失，x 距离再差也只是
    // 落到次优屏，不会恢复失败。
    const xDistance = input.dock.x === undefined ? 0 : Math.abs(bounds.x - input.dock.x);
    const distance = Math.abs(bounds.y - input.dock.y);
    if (
      !best ||
      xDistance < best.xDistance ||
      (xDistance === best.xDistance && distance < best.distance)
    ) {
      best = { bounds, distance, xDistance };
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

function rectsIntersect(a: Rect, b: DisplayWorkArea): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
