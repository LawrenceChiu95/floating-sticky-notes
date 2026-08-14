import { describe, expect, it } from 'vitest';
import {
  createNoteWindowDragSession,
  type NoteWindowDragSession
} from '../main/note-window-drag';
import type { NoteWindowPresentation } from '../main/note-window-collapse';
import type { DisplayWorkArea, DockSide, Rect } from '../shared/note-dock';

const WORK_AREA: DisplayWorkArea = { x: 0, y: 0, width: 1280, height: 800 };

type SessionOverrides = {
  presentation?: NoteWindowPresentation;
  workAreas?: DisplayWorkArea[];
  dockSide?: DockSide;
  dockedBounds?: Rect;
  expandedSize?: { width: number; height: number };
};

function createSession(overrides: SessionOverrides = {}): NoteWindowDragSession {
  return createNoteWindowDragSession({
    getPresentation: () => overrides.presentation ?? 'collapsed',
    getWorkAreas: () => overrides.workAreas ?? [WORK_AREA],
    getDockSide: () => overrides.dockSide,
    getDockedBounds: () =>
      overrides.dockedBounds ? { ...overrides.dockedBounds } : undefined,
    getExpandedSize: () => overrides.expandedSize ?? { width: 280, height: 320 }
  });
}

const COLLAPSED_BAR: Rect = { x: 500, y: 200, width: 280, height: 40 };
const DOCKED_SLIVER: Rect = { x: 0, y: 200, width: 8, height: 56 };

describe('note window drag session', () => {
  it('moves the window by rounded deltas without producing any decision mid-drag', () => {
    const session = createSession();

    // 把横条一路拖到左缘 10px 处（已进入贴边阈值），但手势还没结束。
    const moved = session.applyDragDelta(COLLAPSED_BAR, -490.2, 24.6);
    expect(moved).toEqual({ x: 10, y: 225, width: 280, height: 40 });
    expect(session.isDragging()).toBe(true);

    // 拖动中的停顿不等于松手：不得产生 offer，accept 一律落空。
    expect(session.acceptDockOffer(1)).toBeUndefined();
    expect(session.acceptUndockOffer(1)).toBeUndefined();
  });

  it('offers a dock only when the drag ends next to a work-area edge', () => {
    const session = createSession();

    session.applyDragDelta(COLLAPSED_BAR, -490, 25);
    const decision = session.endDrag({ x: 10, y: 225, width: 280, height: 40 });

    expect(decision).toEqual({ kind: 'dock-offer', side: 'left', y: 225, epoch: 1 });
    expect(session.isDragging()).toBe(false);
    expect(session.acceptDockOffer(1)).toEqual({ side: 'left', y: 225 });
    // offer 被消费后即失效。
    expect(session.acceptDockOffer(1)).toBeUndefined();
  });

  it('offers a right-side dock when the right edge is nearer', () => {
    const session = createSession();

    const bar: Rect = { x: 1280 - 280 - 12, y: 100, width: 280, height: 40 };
    session.applyDragDelta(bar, 0, 0);
    const decision = session.endDrag(bar);

    expect(decision).toEqual({ kind: 'dock-offer', side: 'right', y: 100, epoch: 1 });
  });

  it('decides nothing when the collapsed bar is released away from any edge', () => {
    const session = createSession();

    session.applyDragDelta(COLLAPSED_BAR, 12, 8);
    const decision = session.endDrag({ x: 512, y: 208, width: 280, height: 40 });

    expect(decision).toEqual({ kind: 'none' });
    expect(session.acceptDockOffer(1)).toBeUndefined();
  });

  it('decides nothing for expanded windows', () => {
    const session = createSession({ presentation: 'expanded' });

    session.applyDragDelta(COLLAPSED_BAR, -500, 0);
    expect(session.endDrag({ x: 0, y: 200, width: 280, height: 40 })).toEqual({ kind: 'none' });
  });

  it('rejects stale accepts once a new drag invalidates the pending offer', () => {
    const session = createSession();

    session.applyDragDelta(COLLAPSED_BAR, -490, 25);
    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toMatchObject({
      kind: 'dock-offer',
      epoch: 1
    });

    // renderer 播收缩视觉期间用户又把横条拖走：旧 offer 立即作废。
    session.applyDragDelta({ x: 10, y: 225, width: 280, height: 40 }, 300, 0);
    expect(session.acceptDockOffer(1)).toBeUndefined();

    // 新一轮拖动落到右缘：只认新 epoch。
    const next = session.endDrag({ x: 988, y: 225, width: 280, height: 40 });
    expect(next).toEqual({ kind: 'dock-offer', side: 'right', y: 225, epoch: 2 });
    expect(session.acceptDockOffer(1)).toBeUndefined();
    expect(session.acceptDockOffer(2)).toEqual({ side: 'right', y: 225 });
  });

  it('rejects accepts while the pointer is still down', () => {
    const session = createSession();

    session.applyDragDelta(COLLAPSED_BAR, -490, 25);
    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toMatchObject({
      kind: 'dock-offer'
    });

    // 手再次按下开始拖（即便尚未移动）：offer 作废，accept 不得贴边。
    session.applyDragDelta({ x: 10, y: 225, width: 280, height: 40 }, 0, 0);
    expect(session.acceptDockOffer(1)).toBeUndefined();
    session.endDrag({ x: 10, y: 225, width: 280, height: 40 });
  });

  it('snaps the sliver back when the release travel is below the unfold threshold', () => {
    const session = createSession({
      presentation: 'docked',
      dockSide: 'left',
      dockedBounds: DOCKED_SLIVER
    });

    session.applyDragDelta(DOCKED_SLIVER, 30, 40);
    const decision = session.endDrag({ x: 30, y: 240, width: 8, height: 56 });

    expect(decision).toEqual({ kind: 'snap-back' });
    expect(session.acceptUndockOffer(1)).toBeUndefined();
  });

  it('offers an expand with main-computed bounds past the unfold threshold', () => {
    const session = createSession({
      presentation: 'docked',
      dockSide: 'left',
      dockedBounds: DOCKED_SLIVER,
      expandedSize: { width: 280, height: 320 }
    });

    session.applyDragDelta(DOCKED_SLIVER, 96, 12);
    const released: Rect = { x: 96, y: 212, width: 8, height: 56 };
    const decision = session.endDrag(released);

    expect(decision).toEqual({
      kind: 'undock-offer',
      bounds: { x: 96, y: 212, width: 280, height: 320 },
      epoch: 1
    });
    expect(session.acceptUndockOffer(1)).toEqual({
      bounds: { x: 96, y: 212, width: 280, height: 320 }
    });
    expect(session.acceptUndockOffer(1)).toBeUndefined();
  });

  it('grows a right-side dock toward the left when expanding', () => {
    const rightSliver: Rect = { x: 1272, y: 300, width: 8, height: 56 };
    const session = createSession({
      presentation: 'docked',
      dockSide: 'right',
      dockedBounds: rightSliver,
      expandedSize: { width: 280, height: 320 }
    });

    session.applyDragDelta(rightSliver, -120, 0);
    const decision = session.endDrag({ x: 1152, y: 300, width: 8, height: 56 });

    expect(decision).toMatchObject({
      kind: 'undock-offer',
      bounds: { x: 1152 + 8 - 280, y: 300, width: 280, height: 320 }
    });
  });

  it('ignores a drag end that never started (duplicate or orphaned ends)', () => {
    const session = createSession();

    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toEqual({ kind: 'none' });
  });

  it('decides nothing when a docked window has no dock origin', () => {
    const session = createSession({ presentation: 'docked', dockSide: 'left' });

    session.applyDragDelta(DOCKED_SLIVER, 100, 0);
    expect(session.endDrag({ x: 100, y: 200, width: 8, height: 56 })).toEqual({ kind: 'none' });
  });
});
