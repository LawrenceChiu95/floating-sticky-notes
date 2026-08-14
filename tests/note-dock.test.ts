import { describe, expect, it } from 'vitest';
import {
  NOTE_DOCK_WIDTH,
  NOTE_DOCK_HEIGHT,
  NOTE_DOCK_EDGE_THRESHOLD_PX,
  NOTE_DOCK_UNFOLD_THRESHOLD_PX,
  NOTE_DOCK_STACK_GAP_PX,
  NOTE_DOCK_MIN_GRAB_PX,
  resolveCollapsedDockSide,
  resolveDockedRelease,
  buildDockedBounds,
  buildExpandBoundsFromDock,
  offsetDockYToAvoidOverlap,
  restoreDockedBounds
} from '../shared/note-dock';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('note dock geometry', () => {
  it('snaps a collapsed bar to the left or right work-area edge only', () => {
    expect(
      resolveCollapsedDockSide({ x: 10, y: 80, width: 280, height: 40 }, workArea)
    ).toBe('left');
    expect(
      resolveCollapsedDockSide({ x: 1140, y: 80, width: 280, height: 40 }, workArea)
    ).toBe('right');
    expect(
      resolveCollapsedDockSide({ x: 400, y: 80, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
    expect(
      resolveCollapsedDockSide({ x: 400, y: 20, width: 280, height: 40 }, workArea)
    ).toBeUndefined();
  });

  it('prefers the nearer edge when the bar is within both thresholds', () => {
    expect(
      resolveCollapsedDockSide(
        { x: 4, y: 80, width: 280, height: 40 },
        { x: 0, y: 0, width: 288, height: 900 }
      )
    ).toBe('left');
  });

  it('unfolds a docked sliver only after 48px inward travel', () => {
    expect(
      resolveDockedRelease({
        side: 'left',
        origin: { x: 0, y: 80, width: 96, height: 32 },
        current: { x: 47, y: 90, width: 96, height: 32 }
      })
    ).toBe('snap-back');
    expect(
      resolveDockedRelease({
        side: 'left',
        origin: { x: 0, y: 80, width: 96, height: 32 },
        current: { x: 48, y: 90, width: 96, height: 32 }
      })
    ).toBe('expand');
    expect(
      resolveDockedRelease({
        side: 'right',
        origin: { x: 1344, y: 80, width: 96, height: 32 },
        current: { x: 1296, y: 80, width: 96, height: 32 }
      })
    ).toBe('expand');
    expect(
      resolveDockedRelease({
        side: 'right',
        origin: { x: 1344, y: 80, width: 96, height: 32 },
        current: { x: 1302, y: 80, width: 96, height: 32 }
      })
    ).toBe('snap-back');
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

  it('builds docked bounds pinned to the requested side with y clamped vertically', () => {
    expect(buildDockedBounds({ side: 'left', y: 80, workArea })).toEqual({
      x: 0,
      y: 80,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(buildDockedBounds({ side: 'right', y: 10, workArea })).toEqual({
      x: 1440 - NOTE_DOCK_WIDTH,
      y: 25,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
    expect(buildDockedBounds({ side: 'left', y: 5000, workArea })).toEqual({
      x: 0,
      y: 25 + 875 - NOTE_DOCK_HEIGHT,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
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
      x: 0,
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
      x: 1440 - NOTE_DOCK_WIDTH,
      y: 25 + 875 - NOTE_DOCK_HEIGHT,
      width: NOTE_DOCK_WIDTH,
      height: NOTE_DOCK_HEIGHT
    });
  });

  it('exposes the design thresholds', () => {
    expect(NOTE_DOCK_WIDTH).toBe(96);
    expect(NOTE_DOCK_HEIGHT).toBe(32);
    expect(NOTE_DOCK_EDGE_THRESHOLD_PX).toBe(24);
    expect(NOTE_DOCK_UNFOLD_THRESHOLD_PX).toBe(48);
    expect(NOTE_DOCK_STACK_GAP_PX).toBe(8);
    expect(NOTE_DOCK_MIN_GRAB_PX).toBe(24);
  });
});
