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
const DOCKED_TAB: Rect = { x: 0, y: 200, width: 96, height: 32 };

describe('note window drag session', () => {
  it('produces no decision while the drag is in progress', () => {
    const session = createSession();

    // 拖动期间（横条可能已停在左缘 10px 处）手势还没结束。
    expect(session.beginDrag()).toBe(true);
    expect(session.isDragging()).toBe(true);

    // 拖动中的停顿不等于松手：不得产生 offer，accept 一律落空。
    expect(session.acceptDockOffer(1)).toBeUndefined();
    expect(session.acceptUndockOffer(1)).toBeUndefined();
  });

  it('refuses to start a drag for expanded windows', () => {
    const session = createSession({ presentation: 'expanded' });

    // 展开态横条走原生 app-region，手动拖动路径不得接管（主进程也不会
    // 为它记录抓取偏移、响应 move）。
    expect(session.beginDrag()).toBe(false);
    expect(session.isDragging()).toBe(false);
    expect(session.endDrag({ x: 0, y: 200, width: 280, height: 40 })).toEqual({ kind: 'none' });
  });

  it('offers a dock only when the drag ends next to a work-area edge', () => {
    const session = createSession();

    session.beginDrag();
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
    session.beginDrag();
    const decision = session.endDrag(bar);

    expect(decision).toEqual({ kind: 'dock-offer', side: 'right', y: 100, epoch: 1 });
  });

  it('decides nothing when the collapsed bar is released away from any edge', () => {
    const session = createSession();

    session.beginDrag();
    const decision = session.endDrag({ x: 512, y: 208, width: 280, height: 40 });

    expect(decision).toEqual({ kind: 'none' });
    expect(session.acceptDockOffer(1)).toBeUndefined();
  });

  it('rejects stale accepts once a new drag invalidates the pending offer', () => {
    const session = createSession();

    session.beginDrag();
    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toMatchObject({
      kind: 'dock-offer',
      epoch: 1
    });

    // renderer 播收缩视觉期间用户又把横条拖走：旧 offer 立即作废。
    session.beginDrag();
    expect(session.acceptDockOffer(1)).toBeUndefined();

    // 新一轮拖动落到右缘：只认新 epoch。
    const next = session.endDrag({ x: 988, y: 225, width: 280, height: 40 });
    expect(next).toEqual({ kind: 'dock-offer', side: 'right', y: 225, epoch: 2 });
    expect(session.acceptDockOffer(1)).toBeUndefined();
    expect(session.acceptDockOffer(2)).toEqual({ side: 'right', y: 225 });
  });

  it('rejects accepts while the pointer is still down', () => {
    const session = createSession();

    session.beginDrag();
    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toMatchObject({
      kind: 'dock-offer'
    });

    // 手再次按下开始拖（即便尚未移动）：offer 作废，accept 不得贴边。
    session.beginDrag();
    expect(session.acceptDockOffer(1)).toBeUndefined();
    session.endDrag({ x: 10, y: 225, width: 280, height: 40 });
  });

  it('snaps the tab back when the release travel is below the unfold threshold', () => {
    const session = createSession({
      presentation: 'docked',
      dockSide: 'left',
      dockedBounds: DOCKED_TAB
    });

    session.beginDrag();
    const decision = session.endDrag({ x: 30, y: 240, width: 96, height: 32 });

    expect(decision).toEqual({ kind: 'snap-back' });
    expect(session.acceptUndockOffer(1)).toBeUndefined();
  });

  it('offers an expand with main-computed bounds past the unfold threshold', () => {
    const session = createSession({
      presentation: 'docked',
      dockSide: 'left',
      dockedBounds: DOCKED_TAB,
      expandedSize: { width: 280, height: 320 }
    });

    session.beginDrag();
    const released: Rect = { x: 96, y: 212, width: 96, height: 32 };
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
    const rightTab: Rect = { x: 1184, y: 300, width: 96, height: 32 };
    const session = createSession({
      presentation: 'docked',
      dockSide: 'right',
      dockedBounds: rightTab,
      expandedSize: { width: 280, height: 320 }
    });

    session.beginDrag();
    const decision = session.endDrag({ x: 1124, y: 300, width: 96, height: 32 });

    expect(decision).toMatchObject({
      kind: 'undock-offer',
      bounds: { x: 1124 + 96 - 280, y: 300, width: 280, height: 320 }
    });
  });

  it('ignores a drag end that never started (duplicate or orphaned ends)', () => {
    const session = createSession();

    expect(session.endDrag({ x: 10, y: 225, width: 280, height: 40 })).toEqual({ kind: 'none' });
  });

  it('decides nothing when a docked window has no dock origin', () => {
    const session = createSession({ presentation: 'docked', dockSide: 'left' });

    session.beginDrag();
    expect(session.endDrag({ x: 100, y: 200, width: 96, height: 32 })).toEqual({ kind: 'none' });
  });
});
