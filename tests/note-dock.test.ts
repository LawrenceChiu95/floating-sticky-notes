import { describe, expect, it } from 'vitest';
import {
  NOTE_DOCK_WIDTH,
  NOTE_DOCK_HEIGHT,
  NOTE_DOCK_HIDDEN_PX,
  NOTE_DOCK_VISIBLE_PX,
  NOTE_DOCK_SNAP_OVERLAP_PX,
  NOTE_DOCK_UNFOLD_THRESHOLD_PX,
  NOTE_DOCK_STACK_GAP_PX,
  NOTE_DOCK_MIN_GRAB_PX,
  resolveCollapsedDockSide,
  resolveDockedEdgeRelease,
  buildDockedBounds,
  buildExpandBoundsFromDock,
  offsetDockYToAvoidOverlap,
  restoreDockedBounds,
  resolveDockShrinkDelta
} from '../shared/note-dock';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('note dock geometry', () => {
  it('translates the retained edge correctly for both inverse-reveal directions', () => {
    // Right docks retain the strip's left segment.
    expect(
      resolveDockShrinkDelta({
        side: 'right',
        strip: { x: 12, width: 320 },
        bookmark: { x: 236, width: 96 }
      })
    ).toBe(224);

    // Left docks retain the strip's right segment, not its left segment.
    expect(
      resolveDockShrinkDelta({
        side: 'left',
        strip: { x: 320, width: 320 },
        bookmark: { x: 0, width: 96 }
      })
    ).toBe(-544);
  });

  it('snaps a collapsed bar only once its edge is pushed off the screen', () => {
    // 探出屏外 ≥8px 才吸附：靠近（左缘距边 10px）不吸，探出 8px 吸。
    expect(
      resolveCollapsedDockSide({ x: 10, y: 80, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
    expect(
      resolveCollapsedDockSide({ x: -NOTE_DOCK_SNAP_OVERLAP_PX, y: 80, width: 280, height: 40 }, workArea)
    ).toBe('left');
    expect(
      resolveCollapsedDockSide({ x: -NOTE_DOCK_SNAP_OVERLAP_PX + 1, y: 80, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
    // 右缘对称：bar.right = 1440+8 即 x = 1168。
    expect(
      resolveCollapsedDockSide({ x: 1168, y: 80, width: 280, height: 40 }, workArea)
    ).toBe('right');
    expect(
      resolveCollapsedDockSide({ x: 1167, y: 80, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
    expect(
      resolveCollapsedDockSide({ x: 400, y: 80, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
    expect(
      resolveCollapsedDockSide({ x: 400, y: 20, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
  });

  it('prefers the deeper overlap when the bar overhangs both edges', () => {
    expect(
      resolveCollapsedDockSide(
        { x: -20, y: 80, width: 320, height: 40 },
        { x: 0, y: 0, width: 288, height: 900 }
      )
    ).toBe('left');
  });

  it('does not snap when the overhang lands on a neighbor display', () => {
    // 多屏共边：横条「探出左缘」其实是拖进了左边那块屏，不是推向屏幕边缘。
    const leftNeighbor = { x: -1440, y: 0, width: 1440, height: 900 };
    expect(
      resolveCollapsedDockSide(
        { x: -20, y: 80, width: 280, height: 40 },
        workArea,
        [leftNeighbor]
      )
    ).toBeUndefined();
    // 右缘没有邻屏，照常吸附。
    expect(
      resolveCollapsedDockSide(
        { x: 1168, y: 80, width: 280, height: 40 },
        workArea,
        [leftNeighbor]
      )
    ).toBe('right');
  });

  it('unfolds a docked tab once it is dragged 48px away from its rest pose', () => {
    // 左贴边静止位 x=-48（半藏）：往桌面里拖 48px（x 到 0）即展开。
    expect(
      resolveDockedEdgeRelease({
        side: 'left',
        current: { x: -1, y: 80, width: 96, height: 32 },
        dockedX: -NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('stay');
    expect(
      resolveDockedEdgeRelease({
        side: 'left',
        current: { x: 0, y: 80, width: 96, height: 32 },
        dockedX: -NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('expand');
    // 右贴边静止位 x=1392（1440-96+48）：往左拖 48px（x 到 1344）即展开。
    expect(
      resolveDockedEdgeRelease({
        side: 'right',
        current: { x: 1344, y: 80, width: 96, height: 32 },
        dockedX: 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('expand');
    expect(
      resolveDockedEdgeRelease({
        side: 'right',
        current: { x: 1345, y: 80, width: 96, height: 32 },
        dockedX: 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('stay');
  });

  it('unfolds in either direction, including toward the screen edge', () => {
    // 位移取绝对值（2026-08-27）：右贴边往右（屏缘外侧，多屏时必上邻屏）拖
    // 48px 也展开——旧版带方向判定 offset 恒负永不展开，窗口被带出一两千
    // 像素后松手跨屏钉回（真机「抽搞」主根因）。
    const rightDockedX = 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX; // 1392
    expect(
      resolveDockedEdgeRelease({
        side: 'right',
        current: { x: rightDockedX + NOTE_DOCK_HIDDEN_PX, y: 80, width: 96, height: 32 },
        dockedX: rightDockedX
      })
    ).toBe('expand');
    expect(
      resolveDockedEdgeRelease({
        side: 'right',
        current: { x: rightDockedX + NOTE_DOCK_HIDDEN_PX - 1, y: 80, width: 96, height: 32 },
        dockedX: rightDockedX
      })
    ).toBe('stay');
    // 左贴边往左（更藏进屏外）48px 同样展开。
    expect(
      resolveDockedEdgeRelease({
        side: 'left',
        current: { x: -NOTE_DOCK_HIDDEN_PX * 2, y: 80, width: 96, height: 32 },
        dockedX: -NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('expand');
    expect(
      resolveDockedEdgeRelease({
        side: 'left',
        current: { x: -NOTE_DOCK_HIDDEN_PX * 2 + 1, y: 80, width: 96, height: 32 },
        dockedX: -NOTE_DOCK_HIDDEN_PX
      })
    ).toBe('stay');
  });

  it('grows left docks to the right and right docks to the left', () => {
    expect(
      buildExpandBoundsFromDock({
        side: 'left',
        sliver: { x: 80, y: 120, width: 96, height: 32 },
        expandedSize: { width: 280, height: 220 },
        workArea
      })
    ).toEqual({ x: 80, y: 120, width: 280, height: 220 });

    expect(
      buildExpandBoundsFromDock({
        side: 'right',
        sliver: { x: 1100, y: 120, width: 96, height: 32 },
        expandedSize: { width: 280, height: 220 },
        workArea
      })
    ).toEqual({ x: 916, y: 120, width: 280, height: 220 });
  });

  it('clamps expanded bounds into the work area', () => {
    expect(
      buildExpandBoundsFromDock({
        side: 'left',
        sliver: { x: 1400, y: 800, width: 96, height: 32 },
        expandedSize: { width: 280, height: 220 },
        workArea
      })
    ).toEqual({ x: 1160, y: 680, width: 280, height: 220 });
  });

  it('builds docked bounds half-hidden off the screen edge with y clamped vertically', () => {
    // 半藏：窗口仍 96 宽，静止时 48px 探出屏外，只露 48px 的头。
    expect(buildDockedBounds({ side: 'left', y: 80, workArea })).toEqual({
      x: -NOTE_DOCK_HIDDEN_PX,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(buildDockedBounds({ side: 'right', y: 10, workArea })).toEqual({
      x: 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX,
      y: 25,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(buildDockedBounds({ side: 'left', y: 5000, workArea })).toEqual({
      x: -NOTE_DOCK_HIDDEN_PX,
      y: 25 + 875 - NOTE_DOCK_HEIGHT,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
  });

  it('keeps the tab fully visible when the hidden half would leak onto a neighbor display', () => {
    // 多屏共边：左贴边的隐藏半幅会落进左边那块屏的工作区——窗口收成只有
    // 可见头那么宽、完整贴在屏内，不留透明死区。
    const leftNeighbor = { x: -1440, y: 0, width: 1440, height: 900 };
    expect(
      buildDockedBounds({
        side: 'left',
        y: 80,
        workArea,
        neighborWorkAreas: [leftNeighbor]
      })
    ).toEqual({
      x: 0,
      y: 80,
      width: NOTE_DOCK_VISIBLE_PX,
      height: NOTE_DOCK_HEIGHT
    });
    // 相邻屏在左边不影响右贴边半藏。
    expect(
      buildDockedBounds({
        side: 'right',
        y: 80,
        workArea,
        neighborWorkAreas: [leftNeighbor]
      })
    ).toEqual({
      x: 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    // 垂直方向不重叠也不算漏（隐藏半幅在邻屏上方）。
    expect(
      buildDockedBounds({
        side: 'left',
        y: 80,
        workArea,
        neighborWorkAreas: [{ x: -1440, y: 900, width: 1440, height: 900 }]
      }).x
    ).toBe(-NOTE_DOCK_HIDDEN_PX);
  });

  it('reveals the full tab flush against the screen edge on hover peek', () => {
    // 悬停探头：整条 96px 滑进屏内贴在边缘，没有隐藏半幅，也就不触发
    // 邻屏漏出守卫。
    const leftNeighbor = { x: -1440, y: 0, width: 1440, height: 900 };
    expect(buildDockedBounds({ side: 'left', y: 80, workArea, reveal: true })).toEqual({
      x: 0,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(buildDockedBounds({ side: 'right', y: 80, workArea, reveal: true })).toEqual({
      x: 1440 - NOTE_DOCK_WIDTH,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(
      buildDockedBounds({
        side: 'left',
        y: 80,
        workArea,
        neighborWorkAreas: [leftNeighbor],
        reveal: true
      })
    ).toEqual({
      x: 0,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    // 探头姿态同样夹进工作区垂直范围。
    expect(buildDockedBounds({ side: 'left', y: 5000, workArea, reveal: true }).y).toBe(
      25 + 875 - NOTE_DOCK_HEIGHT
    );
  });

  it('offsets overlapping slivers down, then up', () => {
    expect(
      offsetDockYToAvoidOverlap({
        y: 80,
        side: 'left',
        workArea,
        occupied: [{ side: 'left', y: 80 }]
      })
    ).toBe(80 + NOTE_DOCK_HEIGHT + NOTE_DOCK_STACK_GAP_PX);
  });

  it('ignores slivers docked on the other side when offsetting', () => {
    expect(
      offsetDockYToAvoidOverlap({
        y: 80,
        side: 'left',
        workArea,
        occupied: [{ side: 'right', y: 80 }]
      })
    ).toBe(80);
  });

  it('offsets upward when the downward direction runs out of room', () => {
    const bottomY = workArea.y + workArea.height - NOTE_DOCK_HEIGHT;
    expect(
      offsetDockYToAvoidOverlap({
        y: bottomY,
        side: 'right',
        workArea,
        occupied: [{ side: 'right', y: bottomY }]
      })
    ).toBe(bottomY - NOTE_DOCK_HEIGHT - NOTE_DOCK_STACK_GAP_PX);
  });

  it('keeps at least the minimum grab height when no free slot exists', () => {
    const minY = workArea.y;
    // Slots every 40px at 25/65/105 in a 130px-tall area: a fourth full slot
    // would need y=145, but the clamped maximum is 123, so the tab falls back
    // to a 24px grab strip below the bottommost occupied slot (clamped to 123).
    const tightArea = { ...workArea, height: 130 };
    const occupied = [minY, minY + 40, minY + 80].map((y) => ({ side: 'left' as const, y }));
    expect(
      offsetDockYToAvoidOverlap({ y: minY, side: 'left', workArea: tightArea, occupied })
    ).toBe(tightArea.y + tightArea.height - NOTE_DOCK_HEIGHT);
  });

  it('restores a docked sliver on a visible work area and drops it when none fits', () => {
    expect(
      restoreDockedBounds({ dock: { side: 'left', y: 400 }, workAreas: [workArea] })
    ).toEqual({
      x: -NOTE_DOCK_HIDDEN_PX,
      y: 400,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(
      restoreDockedBounds({ dock: { side: 'right', y: 400 }, workAreas: [] })
    ).toBeUndefined();
  });

  it('clamps a restored sliver onto the remaining display after a monitor is lost', () => {
    expect(
      restoreDockedBounds({ dock: { side: 'right', y: 5000 }, workAreas: [workArea] })
    ).toEqual({
      x: 1440 - NOTE_DOCK_WIDTH + NOTE_DOCK_HIDDEN_PX,
      y: 25 + 875 - NOTE_DOCK_HEIGHT,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
  });

  it('restores onto the display the persisted x belongs to when two edges tie on y', () => {
    // 多屏同名边（每屏都有一条右边缘）y 距离打平：持久化的静止位 x 决定回
    // 哪块屏。主屏右缘与副屏共边 → 回退 48px 全露；副屏右缘无邻居 → 半藏。
    const mainArea = { x: 0, y: 0, width: 1440, height: 900 };
    const sideArea = { x: 1440, y: 0, width: 2560, height: 1440 };
    const workAreas = [mainArea, sideArea];
    expect(
      restoreDockedBounds({ dock: { side: 'right', x: 3952, y: 400 }, workAreas })
    ).toEqual({
      x: 3952,
      y: 400,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(
      restoreDockedBounds({ dock: { side: 'right', x: 1392, y: 400 }, workAreas })
    ).toEqual({
      x: 1392,
      y: 400,
      width: NOTE_DOCK_VISIBLE_PX,
      height: NOTE_DOCK_HEIGHT
    });
    // 旧记录没有 x：候选 y 距离打平，退化为数组序优先（原行为），不会恢复失败。
    expect(restoreDockedBounds({ dock: { side: 'right', y: 400 }, workAreas })).toEqual({
      x: 1392,
      y: 400,
      width: NOTE_DOCK_VISIBLE_PX,
      height: NOTE_DOCK_HEIGHT
    });
  });

  it('exposes the design thresholds', () => {
    expect(NOTE_DOCK_WIDTH).toBe(96);
    expect(NOTE_DOCK_HEIGHT).toBe(32);
    expect(NOTE_DOCK_HIDDEN_PX).toBe(48);
    expect(NOTE_DOCK_VISIBLE_PX).toBe(48);
    expect(NOTE_DOCK_SNAP_OVERLAP_PX).toBe(8);
    expect(NOTE_DOCK_UNFOLD_THRESHOLD_PX).toBe(48);
    expect(NOTE_DOCK_STACK_GAP_PX).toBe(8);
    expect(NOTE_DOCK_MIN_GRAB_PX).toBe(24);
  });
});
