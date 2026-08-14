import {
  buildExpandBoundsFromDock,
  findNearestWorkArea,
  resolveCollapsedDockSide,
  resolveDockedRelease,
  type DisplayWorkArea,
  type DockSide,
  type Rect
} from '../shared/note-dock';
import type { NoteWindowPresentation } from './note-window-collapse';

export type NoteWindowDragDecision =
  | { kind: 'none' }
  | { kind: 'dock-offer'; side: DockSide; y: number; epoch: number }
  | { kind: 'undock-offer'; bounds: Rect; epoch: number }
  | { kind: 'snap-back' };

export type NoteWindowDragSession = {
  applyDragDelta: (current: Rect, dx: number, dy: number) => Rect;
  endDrag: (current: Rect) => NoteWindowDragDecision;
  acceptDockOffer: (epoch: number) => { side: DockSide; y: number } | undefined;
  acceptUndockOffer: (epoch: number) => { bounds: Rect } | undefined;
  isDragging: () => boolean;
};

type NoteWindowDragSessionDeps = {
  getPresentation: () => NoteWindowPresentation;
  getWorkAreas: () => DisplayWorkArea[];
  getDockSide: () => DockSide | undefined;
  getDockedBounds: () => Rect | undefined;
  getExpandedSize: () => { width: number; height: number };
};

type PendingDockOffer =
  | { kind: 'dock'; side: DockSide; y: number; epoch: number }
  | { kind: 'undock'; bounds: Rect; epoch: number };

// 收起/贴边态的窗口移动由 renderer 指针事件驱动（图片预览窗同款模式），
// 松手 = pointerup/pointercancel 发来的 finish IPC。这个会话只回答两件事：
// 拖动结束时按当前矩形判定贴边/拖出/弹回，以及 accept 是否是最后一次
// offer。macOS 的 moved 是 move 的别名、没有任何「拖动结束」窗口事件，
// 所以任何基于 moved 静默期的近似都不允许回到这里。
export function createNoteWindowDragSession(
  deps: NoteWindowDragSessionDeps
): NoteWindowDragSession {
  let dragging = false;
  let offerEpoch = 0;
  let pendingOffer: PendingDockOffer | undefined;

  const beginDrag = (): void => {
    dragging = true;
    // 新一轮拖动即刻作废旧 offer：renderer 播过渡视觉期间用户再次按住横条，
    // 之后到达的 accept 因 epoch 对不上而被拒绝。
    pendingOffer = undefined;
  };

  return {
    applyDragDelta: (current, dx, dy) => {
      if (!dragging) {
        beginDrag();
      }

      return {
        x: Math.round(current.x + dx),
        y: Math.round(current.y + dy),
        width: current.width,
        height: current.height
      };
    },
    endDrag: (current) => {
      if (!dragging) {
        return { kind: 'none' };
      }

      dragging = false;
      const presentation = deps.getPresentation();

      if (presentation === 'collapsed') {
        const workArea = findNearestWorkArea(current, deps.getWorkAreas());
        const side = workArea ? resolveCollapsedDockSide(current, workArea) : undefined;

        if (!side) {
          return { kind: 'none' };
        }

        offerEpoch += 1;
        pendingOffer = { kind: 'dock', side, y: current.y, epoch: offerEpoch };
        return { kind: 'dock-offer', side, y: current.y, epoch: offerEpoch };
      }

      if (presentation !== 'docked') {
        return { kind: 'none' };
      }

      const side = deps.getDockSide();
      const origin = deps.getDockedBounds();

      if (!side || !origin) {
        return { kind: 'none' };
      }

      if (resolveDockedRelease({ side, origin, current }) === 'snap-back') {
        return { kind: 'snap-back' };
      }

      const workArea = findNearestWorkArea(current, deps.getWorkAreas());

      if (!workArea) {
        return { kind: 'none' };
      }

      const bounds = buildExpandBoundsFromDock({
        side,
        sliver: current,
        expandedSize: deps.getExpandedSize(),
        workArea
      });
      offerEpoch += 1;
      pendingOffer = { kind: 'undock', bounds, epoch: offerEpoch };
      return { kind: 'undock-offer', bounds, epoch: offerEpoch };
    },
    acceptDockOffer: (epoch) => {
      if (pendingOffer?.kind !== 'dock' || pendingOffer.epoch !== epoch) {
        return undefined;
      }

      const offer = { side: pendingOffer.side, y: pendingOffer.y };
      pendingOffer = undefined;
      return offer;
    },
    acceptUndockOffer: (epoch) => {
      if (pendingOffer?.kind !== 'undock' || pendingOffer.epoch !== epoch) {
        return undefined;
      }

      const offer = { bounds: { ...pendingOffer.bounds } };
      pendingOffer = undefined;
      return offer;
    },
    isDragging: () => dragging
  };
}
