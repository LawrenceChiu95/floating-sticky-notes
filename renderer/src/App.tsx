import {
  ArrowLeftToLine,
  ArrowRightToLine,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  MoreHorizontal,
  Palette,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { NoteImageView } from '../../main/notes-manager';
import { groupChecklist } from '../../main/checklist-hierarchy';
import type { NoteChecklistItemRecord } from '../../main/note-state';
import { DEFAULT_APP_COPY } from '../../shared/app-copy';
import { DEFAULT_NOTE_COLOR, DEFAULT_NOTE_OPACITY, hexToRgba, NOTE_COLORS, noteColorToMenuSurface } from '../../shared/note-appearance';
import { NOTE_COLLAPSED_HEIGHT } from '../../shared/note-window';
import { resolveDockShrinkDelta } from '../../shared/note-dock';
import { createDebouncedValueAction, type DebouncedValueAction } from '../../shared/debounced-action';
import { limitNoteNameLength } from '../../shared/note-name';
import {
  applyChecklistAddSubtask,
  applyChecklistBackspace,
  applyChecklistDelete,
  applyChecklistEnter,
  applyChecklistIndent,
  applyChecklistOutdent,
  getChecklistKeyAction,
  getChecklistShortcutHint,
  normalizeChecklistText,
  type ChecklistShortcutHint,
  type ChecklistFocusTarget
} from './checklist-editing';
import {
  getChecklistAddLabel,
  shouldShowChecklistAddEntry
} from './checklist-entry';
import { isImageDropFile } from './image-drop';
import {
  applySavedNoteName,
  beginNoteNameSave,
  cancelNoteNameEditing,
  createNoteNamingState,
  failNoteNameSave,
  getNoteNameKeyAction,
  getNoteNamePresentation,
  startNoteNameEditing,
  updateNoteNameDraft
} from './note-naming';
import { togglePopover, type NotePopover } from './note-popover';
import { getPreloadStatus } from './preload-status';
import { DockedNoteShell, type NoteShellStyle } from './docked-note-shell';
import { TabApp } from './TabApp';
import './styles.css';

const STATUS_MESSAGE_DURATION_MS = 2000;
const NOTE_SHELL_TRANSITION_FALLBACK_MS = 320;
// 吸附逆揭示时长：与收起/展开/拖出揭示同一族缓动（cubic-bezier(0.33, 0.75,
// 0.35, 1)）；主进程 600ms 回执超时是它的兜底，改动要两边一起看。
const NOTE_DOCK_SHRINK_MS = 300;
const NOTE_DOCK_EXPAND_HOLD_MS = 120;
const NOTE_VIEWPORT_RESIZE_FALLBACK_MS = 500;
const PERSISTENT_STATUS_MESSAGES = new Set(['读取失败']);

type DockSide = 'left' | 'right';

type DockShrinkGeometry = {
  unionWidth: number;
  unionHeight: number;
  strip: { x: number; y: number; width: number; height: number };
  bookmark: { x: number; y: number; width: number; height: number };
};

type DockShrinkVisual = DockShrinkGeometry & {
  side: DockSide;
  // settled = 原生裁窗 ACK 之后（committed）：内描边只在这个阶段补回，
  // 不参与 union 平移与 416×40 → 96×32 裁窗的 surface 重算。
  phase: 'animating' | 'stable' | 'settled' | 'aborted';
};

type ActiveDockShrinkTransaction = {
  id: number;
  generation: number;
  side: DockSide;
  geometry: DockShrinkGeometry;
  phase:
    | 'preparing'
    | 'waiting-union'
    | 'animating'
    | 'waiting-target'
    | 'visual-committed'
    | 'aborted';
  animation?: Animation;
};

// 贴边书签头组件在 docked-note-shell.tsx（便签主窗 overlay 与独立书签头窗
// 共用）：壳永久 no-drag 承载视觉并充当悬停传感条（drag 区在应用非激活时收
// 不到 OS 的 enter/leave，no-drag 面双向照收），传感条只留朝桌面侧 5px，
// 与壳齐平的透明 pill 是永久 drag 面；从上下沿进入丢的 enter 由主进程 120ms
// 悬停复核轮询兜底。藏与露纯靠主进程滑行窗口几何，DOM 永远铺满窗口。

function App(): JSX.Element {
  const preloadStatus = getPreloadStatus(window);
  const [content, setContent] = useState('');
  const [checklist, setChecklist] = useState<NoteChecklistItemRecord[]>([]);
  const checklistRef = useRef<NoteChecklistItemRecord[]>([]);
  const [images, setImages] = useState<NoteImageView[]>([]);
  const [color, setColor] = useState<string>(DEFAULT_NOTE_COLOR);
  const [opacity, setOpacity] = useState(DEFAULT_NOTE_OPACITY);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  // Single nullable state keeps the more menu and the note-delete confirmation
  // mutually exclusive on both pointer and keyboard paths.
  const [openPopover, setOpenPopover] = useState<NotePopover | null>(null);
  const isMoreMenuOpen = openPopover === 'more';
  const isNoteDeleteConfirmOpen = openPopover === 'note-delete';
  const setIsMoreMenuOpen = (open: boolean): void => setOpenPopover(open ? 'more' : null);
  const setIsNoteDeleteConfirmOpen = (open: boolean): void =>
    setOpenPopover(open ? 'note-delete' : null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCollapseTransitioning, setIsCollapseTransitioning] = useState(false);
  // 贴边第三态：dock 非空时整个壳体只渲染一枚横着的着色书签头。初始值同步
  // 读自主进程注入 URL query 的 side——恢复贴边的窗口首帧 DOM 就是书签头，
  // 不会先挂完整便签再切换；getCurrentNote 回来后以记录为准 reconcile。
  // move 流只做预览与展开阈值判定；吸附在物理松手后走 renderer/native 事务，
  // 悬停探头只改原生几何。
  const [dock, setDock] = useState<{ side: DockSide } | null>(() => {
    const initialDockSide = window.stickyNotes.getInitialDockSide();
    return initialDockSide ? { side: initialDockSide } : null;
  });
  const dockRef = useRef(dock);
  // 吸附逆揭示：主进程在 paint 边界分段扩展/移动 native 窗口，同一枚纸面
  // overlay 钉在全局 strip 点演「clip 收成书签头 + 平移到贴边点」——拖出展开
  // 的逆运动，可见运动全在 DOM。目标原点与裁剪分别 paint 后仍保留同一节点，
  // committed 只确认它成为正式书签头，不再做末帧 surface 交换。
  const [dockShrink, setDockShrink] = useState<DockShrinkVisual | null>(null);
  const dockShrinkRef = useRef<DockShrinkVisual | null>(null);
  dockShrinkRef.current = dockShrink;
  // The shrink surface is a <main>, not a wrapper <div>.  Keeping this exact
  // node alive through animation and the committed dock state removes the
  // last-frame surface swap that used to flash.
  const dockShrinkStubRef = useRef<HTMLElement | null>(null);
  // 落地替身：动画末帧的静态克隆。cancel 拆掉动画层的那一拍没有任何兜底内容
  // （两次真机录屏实锤空一帧），所以在 cancel 前先把这枚像素一致的静态壳
  // 渲染到 stub 底下并等它上屏；stub 即使空一帧，露出的也是同一枚书签头。
  const [dockShrinkLanding, setDockShrinkLanding] = useState(false);
  const dockShrinkLandingRef = useRef<HTMLElement | null>(null);
  // Native dock notifications are transactions, not independent hints.  A
  // late rollback/ack from an older transaction must never mutate this note's
  // current visual state.
  const dockTransitionIdRef = useRef(0);
  const activeDockShrinkTransactionRef = useRef<ActiveDockShrinkTransaction | null>(null);
  // 落点长成替身：prepare 阶段主壳隐身，这枚 overlay 钉在 expandFrom 冒充书签头；
  // 主窗上屏后纸面 clip 从其底下向外长，替身再留 ~120ms 溶进标题栏。ACK 前不得
  // 卸替身——右贴边落点在窗右上，没有它就会先露出工具栏图标。
  const [dockExpandHold, setDockExpandHold] = useState<{
    side: 'left' | 'right';
    x: number;
    y: number;
    width: number;
    height: number;
    phase: 'prepare' | 'reveal' | 'dissolve';
  } | null>(null);
  // 拖出展开揭示动画的代际令牌：动画途中窗口被重新贴边（dock-applied 翻回
  // 非空）时作废旧动画，不让它把新壳体的 clip 清掉。吸附逆揭示复用同一令牌
  // （两组动画互斥，后到的作废先到的）。
  const dockRevealGenerationRef = useRef(0);
  // 拖动中预览：横条被拖进吸附区时主进程发来 side，横条上显示「松手贴边」
  // 承诺提示（Windows Snap 式：拖动中给承诺、松手才执行）；离开吸附区为 null。
  const [dockPreview, setDockPreview] = useState<{ side: 'left' | 'right' } | null>(null);
  const [transitionStatusLabelWidth, setTransitionStatusLabelWidth] = useState(0);
  const [shouldRenderContent, setShouldRenderContent] = useState(true);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [appCopy, setAppCopy] = useState(DEFAULT_APP_COPY);
  const [noteNaming, setNoteNaming] = useState(() => createNoteNamingState(''));
  const [collapsedNameEditStartWidth, setCollapsedNameEditStartWidth] = useState(0);
  const [pendingImageDelete, setPendingImageDelete] = useState<{
    imageId: string;
    focusTarget: ChecklistFocusTarget;
  }>();
  const saveContentRef = useRef<DebouncedValueAction<string>>();
  const noteShellRef = useRef<HTMLElement | null>(null);
  const statusLabelRef = useRef<HTMLDivElement | null>(null);
  const expandedStatusLabelWidthRef = useRef(0);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const moreMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const noteDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const noteDeleteConfirmRef = useRef<HTMLDivElement | null>(null);
  const cancelNoteDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const isNameEditingRef = useRef(false);
  const isNameSavingRef = useRef(false);
  const isCollapsedRef = useRef(false);
  const isCollapseTransitioningRef = useRef(false);
  isCollapsedRef.current = isCollapsed;
  isCollapseTransitioningRef.current = isCollapseTransitioning;
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteContentRef = useRef<HTMLDivElement | null>(null);
  const collapsedScrollTopRef = useRef<number>();
  const checklistInputRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocusRestoreRef = useRef<ChecklistFocusTarget>();
  const lastEditingTargetRef = useRef<{ type: 'note' } | { type: 'checklist'; itemId: string }>({
    type: 'note'
  });

  if (!saveContentRef.current) {
    saveContentRef.current = createDebouncedValueAction<string>((nextContent) => {
      return window.stickyNotes
        .updateContent(nextContent)
        .then(() => undefined)
        .catch(() => {
          setStatusMessage('保存失败');
        });
    }, 350);
  }

  // 窗口交接（2026-09-01）的展开是两阶段：prepare（隐藏态备首帧 + ACK）与
  // run（主窗上屏后才播 340ms clip 揭示）。pending 记录桥接两阶段。
  const pendingDockExpandRevealRef = useRef<{
    transitionId: number;
    generation: number;
  } | null>(null);

  // 落点长成：prepare 阶段主壳隐身、书签头 overlay 钉在 expandFrom；主窗上屏后
  // 纸面 clip 从其底下向外长，替身再留 ~120ms 后溶进标题栏。clip 坐标系是新窗
  // 口的 expandFrom，直接量视口会拿到旧的 96×32。中途重新贴边由代际令牌作废。
  // 窗口交接拆成 prepare/run；无事务 ID 的兼容路径仍走一段式。
  const startDockExpandReveal = (from: {
    side: 'left' | 'right';
    x: number;
    y: number;
    width: number;
    height: number;
  }): void => {
    const generation = ++dockRevealGenerationRef.current;
    setDockExpandHold({ ...from, phase: 'prepare' });
    void (async () => {
      await waitForExpandedViewport();
      if (generation !== dockRevealGenerationRef.current) {
        return;
      }
      const shell = noteShellRef.current;
      if (!shell) {
        setDockExpandHold(null);
        return;
      }
      const fromClip = pinExpandClipToBookmark(shell, from);
      beginExpandHoldReveal(fromClip, generation);
    })();
  };

  const prepareDockExpandReveal = (
    transitionId: number,
    from: { side: 'left' | 'right'; x: number; y: number; width: number; height: number }
  ): void => {
    const generation = dockRevealGenerationRef.current;
    setDockExpandHold({ ...from, phase: 'prepare' });
    void (async () => {
      await waitForExpandedViewport();
      if (generation !== dockRevealGenerationRef.current) {
        return;
      }
      const shell = noteShellRef.current;
      if (!shell) {
        setDockExpandHold(null);
        return;
      }
      pinExpandClipToBookmark(shell, from);
      await waitForNextPaint();
      if (generation !== dockRevealGenerationRef.current) {
        return;
      }
      pendingDockExpandRevealRef.current = { transitionId, generation };
      window.stickyNotes.dockExpandReady(transitionId);
    })();
  };

  const runPendingDockExpandReveal = (transitionId: number): void => {
    const pending = pendingDockExpandRevealRef.current;
    pendingDockExpandRevealRef.current = null;
    if (
      !pending ||
      pending.transitionId !== transitionId ||
      pending.generation !== dockRevealGenerationRef.current
    ) {
      return;
    }
    const shell = noteShellRef.current;
    if (!shell) {
      setDockExpandHold(null);
      return;
    }
    const fromClip = shell.style.clipPath;
    if (!fromClip) {
      setDockExpandHold(null);
      return;
    }
    beginExpandHoldReveal(fromClip, pending.generation);
  };

  const beginExpandHoldReveal = (fromClip: string, generation: number): void => {
    flushSync(() => {
      setDockExpandHold((previous) =>
        previous ? { ...previous, phase: 'reveal' } : previous
      );
    });
    const shell = noteShellRef.current;
    if (!shell) {
      setDockExpandHold(null);
      return;
    }
    void runExpandClipReveal(shell, fromClip, generation);
    window.setTimeout(() => {
      if (generation !== dockRevealGenerationRef.current) {
        return;
      }
      setDockExpandHold((previous) =>
        previous ? { ...previous, phase: 'dissolve' } : previous
      );
      window.setTimeout(() => {
        if (generation !== dockRevealGenerationRef.current) {
          return;
        }
        setDockExpandHold(null);
      }, NOTE_DOCK_EXPAND_HOLD_MS);
    }, NOTE_DOCK_EXPAND_HOLD_MS);
  };

  // clip 先写进 style；reveal 同一 commit 撤隐身，替身仍盖在落点上。will-change
  // 提示 compositor，圆角 clip 走 paint 线程时少一次中途层升级。
  const pinExpandClipToBookmark = (
    shell: HTMLElement,
    from: { x: number; y: number; width: number; height: number }
  ): string => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const top = Math.max(0, Math.min(from.y, viewportHeight));
    const left = Math.max(0, Math.min(from.x, viewportWidth));
    const right = Math.max(0, viewportWidth - (left + from.width));
    const bottom = Math.max(0, viewportHeight - (top + from.height));
    const fromClip = `inset(${top}px ${right}px ${bottom}px ${left}px round 8px)`;
    shell.style.clipPath = fromClip;
    shell.style.willChange = 'clip-path';
    return fromClip;
  };

  const runExpandClipReveal = async (
    shell: HTMLElement,
    fromClip: string,
    generation: number
  ): Promise<void> => {
    const animation = shell.animate(
      [{ clipPath: fromClip }, { clipPath: 'inset(0px 0px 0px 0px round 8px)' }],
      // 340ms：clip 走主线程 paint，大窗每帧重绘超预算就丢帧——拉长后每帧
      // 位移变小，丢帧观感被稀释；缓动与收起/展开同一族。
      { duration: 340, easing: 'cubic-bezier(0.33, 0.75, 0.35, 1)' }
    );
    try {
      await animation.finished;
    } catch {
      // 动画被取消（壳体卸载/新动画接管）：清不清 clip 由在世的代际决定。
    }
    if (generation === dockRevealGenerationRef.current) {
      shell.style.clipPath = '';
      shell.style.willChange = '';
    }
  };

  const isActiveDockShrinkTransaction = (
    transaction: ActiveDockShrinkTransaction
  ): boolean =>
    activeDockShrinkTransactionRef.current === transaction &&
    transaction.generation === dockRevealGenerationRef.current &&
    transaction.phase !== 'aborted';

  // Pin a visual rectangle to a global screen point, not to a guessed CSS edge.
  // macOS can expose the resized viewport one frame before it exposes the moved
  // native origin; subtracting the live screen origin keeps the paper in the
  // same global place throughout that split update.
  const pinDockShrinkElementToScreenPoint = (
    element: HTMLElement,
    screenPoint: { x: number; y: number },
    size: { width: number; height: number }
  ): void => {
    element.style.left = `${screenPoint.x - window.screenX}px`;
    element.style.right = 'auto';
    element.style.top = `${screenPoint.y - window.screenY}px`;
    element.style.bottom = 'auto';
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
  };

  const pinDockShrinkStubToScreenPoint = (
    screenPoint: { x: number; y: number },
    size: { width: number; height: number }
  ): void => {
    const stub = dockShrinkStubRef.current;
    if (!stub) {
      return;
    }
    pinDockShrinkElementToScreenPoint(stub, screenPoint, size);
  };

  // Keep this name as the source-stage seam: the source rectangle is pinned to
  // the unchanged native window origin before the union resize is requested.
  const pinDockShrinkSourceToViewportEdge = (
    screenPoint: { x: number; y: number },
    payload: DockShrinkGeometry
  ): void => {
    pinDockShrinkStubToScreenPoint(screenPoint, payload.strip);
    // Keep the source dimensions explicit at this boundary; relying on the
    // shell's 100vw/100vh defaults is what allowed the old race to stretch it.
    const stub = dockShrinkStubRef.current;
    if (stub) {
      stub.style.width = `${payload.strip.width}px`;
      stub.style.height = `${payload.strip.height}px`;
    }
  };

  // abort 只处理当前事务。主进程会在没有活拖拽时立即恢复横条；如果用户正在
  // 真实抢拖，它会延迟到松手后恢复。overlay 本身在 aborted 阶段变成原生拖动
  // 面，保持当前纸面可抓，不让 union 大窗露出被拉宽的 collapsed 壳。
  const abortDockShrinkTransaction = (transaction: ActiveDockShrinkTransaction): void => {
    if (activeDockShrinkTransactionRef.current !== transaction) {
      return;
    }
    if (transaction.phase !== 'aborted') {
      transaction.animation?.cancel();
      transaction.animation = undefined;
      transaction.phase = 'aborted';
      dockRevealGenerationRef.current += 1;
      dockRef.current = null;
      flushSync(() => {
        setDock(null);
        setIsCollapsed(true);
        setShouldRenderContent(false);
        setDockExpandHold(null);
        setDockShrinkLanding(false);
        setDockShrink((previous) =>
          previous ? { ...previous, phase: 'aborted' } : previous
        );
      });
    }
    // 无活拖拽时主进程会立即恢复横条；真实抢拖则要等用户松手。后者可能超过
    // 500ms，所以后续普通 dock:null 会再次调用本函数、重新武装同一个 waiter。
    const abortGeneration = dockRevealGenerationRef.current;
    void (async () => {
      const sourceViewportReady = await waitForViewportSize(
        transaction.geometry.strip.width,
        transaction.geometry.strip.height,
        () => {
          if (
            abortGeneration !== dockRevealGenerationRef.current ||
            activeDockShrinkTransactionRef.current !== transaction ||
            transaction.phase !== 'aborted'
          ) {
            return;
          }
          const stub = dockShrinkStubRef.current;
          if (!stub) {
            return;
          }
          stub.style.left = '0px';
          stub.style.top = '0px';
          stub.style.right = 'auto';
          stub.style.bottom = 'auto';
          stub.style.width = `${transaction.geometry.strip.width}px`;
          stub.style.height = `${transaction.geometry.strip.height}px`;
          stub.style.transform = '';
          stub.style.clipPath = '';
        }
      );
      if (
        !sourceViewportReady ||
        abortGeneration !== dockRevealGenerationRef.current ||
        activeDockShrinkTransactionRef.current !== transaction ||
        transaction.phase !== 'aborted'
      ) {
        return;
      }
      flushSync(() => {
        setDockShrink(null);
        setDockShrinkLanding(false);
      });
      activeDockShrinkTransactionRef.current = null;
    })();
  };

  // 吸附逆揭示的唯一 renderer 事务：主进程先等 ready，再把尺寸与原点分开
  // 提交到 union；同一枚 DockedNoteShell 完成 clip + transform 逆揭示后，
  // target 原点与最终裁剪也分别 paint。这里不再有 landed/animating 两枚
  // surface，也不再用 key 强制换皮。
  const startDockShrinkToBookmark = (
    transitionId: number,
    side: DockSide,
    payload: DockShrinkGeometry
  ): void => {
    const activeDockShrink = activeDockShrinkTransactionRef.current;
    if (activeDockShrink?.id === transitionId || (activeDockShrink?.id ?? -1) > transitionId) {
      return;
    }
    const generation = ++dockRevealGenerationRef.current;
    const transaction: ActiveDockShrinkTransaction = {
      id: transitionId,
      generation,
      side,
      geometry: payload,
      phase: 'preparing'
    };
    activeDockShrinkTransactionRef.current = transaction;
    const sourceScreenPoint = { x: window.screenX, y: window.screenY };
    const unionScreenPoint = {
      x: sourceScreenPoint.x - payload.strip.x,
      y: sourceScreenPoint.y - payload.strip.y
    };
    const targetScreenPoint = {
      x: unionScreenPoint.x + payload.bookmark.x,
      y: unionScreenPoint.y + payload.bookmark.y
    };
    flushSync(() => {
      setDockShrink({ side, phase: 'animating', ...payload });
      setDockShrinkLanding(false);
      setDockExpandHold(null);
    });
    pinDockShrinkSourceToViewportEdge(sourceScreenPoint, payload);
    void (async () => {
      // flushSync 只保证 DOM 已 commit；再过一帧才把 ready 交给主进程。此时
      // overlay 已经是显式 strip 尺寸，不能再让 100vw/100vh 参与开场竞态。
      await waitForNextPaint();
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      if (!dockShrinkStubRef.current) {
        return;
      }
      transaction.phase = 'waiting-union';
      window.stickyNotes.dockShrinkReady(transitionId);

      // Native resize and move are separate compositor facts on macOS. First
      // let the backing store grow while the window origin stays at source;
      // the paper therefore remains at local (0,0) with no compensating jump.
      const unionSizeReady = await waitForWindowGeometry(
        payload.unionWidth,
        payload.unionHeight,
        sourceScreenPoint,
        () => {
          if (!isActiveDockShrinkTransaction(transaction)) {
            return;
          }
          pinDockShrinkStubToScreenPoint(sourceScreenPoint, payload.strip);
        }
      );
      if (!unionSizeReady) {
        return;
      }
      await waitForNextPaint();
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      window.stickyNotes.dockShrinkUnionSized(transitionId);

      // Main now moves the already-sized window to the union origin. Keep the
      // same paper pinned to its source global point until both origin and a
      // paint have landed; only then is the animation allowed to start.
      const unionPositionReady = await waitForWindowGeometry(
        payload.unionWidth,
        payload.unionHeight,
        unionScreenPoint,
        () => {
          if (!isActiveDockShrinkTransaction(transaction)) {
            return;
          }
          pinDockShrinkStubToScreenPoint(sourceScreenPoint, payload.strip);
        }
      );
      if (!unionPositionReady) {
        return;
      }
      await waitForNextPaint();
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      const stub = dockShrinkStubRef.current;
      if (!stub) {
        return;
      }
      transaction.phase = 'animating';
      const dx = resolveDockShrinkDelta({
        side,
        strip: payload.strip,
        bookmark: payload.bookmark
      });
      const dy = payload.bookmark.y - payload.strip.y;
      // clip 朝保留角收缩（右贴边留右角、左贴边留左角），transform 平移整个
      // 纸面——stub 是 pointer-events:none 的 overlay 不是 drag 壳，transform
      // 合法（红线只禁整壳 transform）。
      const clipTo =
        side === 'right'
          ? `inset(0px ${payload.strip.width - payload.bookmark.width}px ${
              payload.strip.height - payload.bookmark.height
            }px 0px round 8px)`
          : `inset(0px 0px ${payload.strip.height - payload.bookmark.height}px ${
              payload.strip.width - payload.bookmark.width
            }px round 8px)`;
      const animation = stub.animate(
        [
          { transform: 'translate(0px, 0px)', clipPath: 'inset(0px 0px 0px 0px round 8px)' },
          { transform: `translate(${dx}px, ${dy}px)`, clipPath: clipTo }
        ],
        // 300ms 同族缓动：union 是横条级小窗，clip 每帧 repaint 预算宽裕。
        {
          duration: NOTE_DOCK_SHRINK_MS,
          easing: 'cubic-bezier(0.33, 0.75, 0.35, 1)',
          fill: 'forwards'
        }
      );
      transaction.animation = animation;
      try {
        await animation.finished;
      } catch {
        // 动画被取消（抢拖/卸载）：后续回执由 generation 守卫决定。
      }
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      // 落地重叠交接：先把动画末帧的静态替身（同一份 DockedNoteShell 内容、
      // 同一个 base 钉点、静态 transform/clip 等于末帧 keyframe）渲染到 stub
      // 底下并等它真正上屏，然后才 cancel 动画、切稳定布局。不再依赖
      // commitStyles/cancel 的时序语义——2026-08-31 两次真机录屏实锤：即使
      // commitStyles + 双 rAF 等待，cancel 拆动画层的那一拍仍会露一帧空
      // surface。有替身在底下垫着，stub 空那一帧露出的也是同一枚书签头。
      flushSync(() => {
        setDockShrinkLanding(true);
      });
      const landing = dockShrinkLandingRef.current;
      if (landing) {
        pinDockShrinkElementToScreenPoint(landing, sourceScreenPoint, payload.strip);
        landing.style.transform = `translate(${dx}px, ${dy}px)`;
        landing.style.clipPath = clipTo;
      }
      await waitForNextPaint();
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      animation.cancel();
      transaction.animation = undefined;
      pinDockShrinkStubToScreenPoint(targetScreenPoint, payload.bookmark);
      stub.style.transform = '';
      stub.style.clipPath = '';
      flushSync(() => {
        setDockShrink((previous) => (previous ? { ...previous, phase: 'stable' } : previous));
      });
      transaction.phase = 'waiting-target';
      // 同一枚稳定 overlay 先 paint 在 union 坐标系，再撤落地替身（撤底层元素
      // 不会闪：上层稳定壳已上屏），然后回 finished——窗口交接架构（2026-09-01）
      // 下主进程不再有任何后续原生几何动作（裁窗已废除）：书签头窗预渲染同像素
      // 画面 showInactive 上屏、主窗随后隐藏。本 overlay 冻结保留在隐藏主窗里，
      // 展开时由 dock:null 分支重置。
      await waitForNextPaint();
      if (!isActiveDockShrinkTransaction(transaction)) {
        return;
      }
      flushSync(() => {
        setDockShrinkLanding(false);
      });
      transaction.phase = 'visual-committed';
      window.stickyNotes.dockShrinkFinished(transitionId);
    })();
  };

  // 恢复性聚焦守卫（2026-09-01 蓝框根因，CDP 活窗实锤）：窗口交接里书签头窗
  // 销毁后 macOS 把键盘焦点转给新上屏的主窗，Chromium 随即将焦点「恢复」给隐
  // 藏前最后聚焦的按钮（工具栏 + 号），并按非鼠标来源命中 :focus-visible——
  // 用户没碰键盘，+ 号却挂蓝框。判别：焦点落在按钮上且既不是键盘导航（最近
  // 无 keydown）也不是刚发生的点击（最近无 pointerdown），就是恢复性聚焦，
  // 立刻 blur 摘掉（focusin 早于绘制，蓝框不会上一帧）。真实点击聚焦
  // （pointerdown 伴随）与键盘 Tab/空格（keydown 伴随）不受影响。
  useEffect(() => {
    let lastKeyNavAt = 0;
    let lastPointerDownAt = 0;
    const onKeydown = (): void => {
      lastKeyNavAt = Date.now();
    };
    const onPointerDown = (): void => {
      lastPointerDownAt = Date.now();
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (!(event.target instanceof HTMLButtonElement)) {
        return;
      }
      const now = Date.now();
      if (now - lastKeyNavAt < 500 || now - lastPointerDownAt < 500) {
        return;
      }
      event.target.blur();
    };
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const flushPendingContent = (): Promise<void> =>
      saveContentRef.current?.flush() ?? Promise.resolve();
    window.__stickyNotesFlushPendingContent = flushPendingContent;
    window.addEventListener('beforeunload', flushPendingContent);

    window.stickyNotes
      .getCurrentNote()
      .then((note) => {
        if (!isMounted) {
          return;
        }

        setContent(note?.content ?? '');
        setNoteNaming(createNoteNamingState(note?.name ?? ''));
        const nextChecklist = note?.checklist ?? [];
        checklistRef.current = nextChecklist;
        setChecklist(nextChecklist);
        setImages(note?.images ?? []);
        setColor(note?.color ?? DEFAULT_NOTE_COLOR);
        setOpacity(note?.opacity ?? DEFAULT_NOTE_OPACITY);
        // 以持久化记录为准 reconcile：URL query 只是首帧引导（例如窗口重建后
        // dock 已被丢弃的边界情况，这里会纠正回完整便签）。
        const persistedDock = note?.dock ? { side: note.dock.side } : null;
        dockRef.current = persistedDock;
        setDock(persistedDock);
      })
      .catch(() => {
        if (isMounted) {
          setStatusMessage('读取失败');
        }
      });

    window.stickyNotes
      .getAppCopy()
      .then((copy) => {
        if (isMounted) {
          setAppCopy(copy);
        }
      })
      .catch(() => undefined);

    const unsubscribeDockApplied = window.stickyNotes.onDockApplied((payload) => {
      // 磁吸已直接改好窗口几何，这里只切 DOM。两个例外要演过渡：拖出展开
      // （expandFrom，纸面从书签头矩形 clip 揭示）与吸附逆揭示（shrinkFromStrip，
      // 纸面 clip 收成书签头 + 平移到贴边点，与拖出展开互为逆运动）——原生
      // 窗口透明，可见运动全在 DOM 层，一帧跳变太紧促。
      if (
        payload.transitionId !== undefined &&
        payload.transitionId < dockTransitionIdRef.current
      ) {
        return;
      }
      if (payload.transitionId !== undefined) {
        dockTransitionIdRef.current = payload.transitionId;
      }
      setDockPreview(null);
      setStatusMessage('');
      const activeDockShrink = activeDockShrinkTransactionRef.current;

      // 进入贴边（窗口即将 hide 保活）前模糊按钮焦点：窗口隐藏时文档失焦、
      // activeElement 已回 body，等展开交接再 blur 就晚了——Chromium 会在主窗
      // 重上屏时把焦点还给隐藏前最后聚焦的控件，并按非鼠标来源重判
      // :focus-visible（展开后 + 号挂蓝框的来源）。趁窗口还在前台 blur，重上
      // 屏时无焦点可恢复。文本输入不动（展开后回到编辑现场）。
      if (payload.dock && document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }

      // 主进程在 target 画面已 paint 后同步提交 controller，再发 committed；
      // 磁盘保存独立排队，不再把可交互画面留在未提交事务里。overlay 本身就是
      // 正式 DockedNoteShell，所以这里保留同一 DOM 节点，不能再触发末帧换皮。
      if (payload.committed) {
        // 窗口交接的展开 committed：主窗已 showInactive 上屏（首帧是 clip 钉住
        // 的书签头矩形），这里才播放 340ms 揭示。
        if (payload.dock === null && payload.transitionId !== undefined) {
          runPendingDockExpandReveal(payload.transitionId);
          return;
        }
        if (
          !payload.dock ||
          payload.transitionId === undefined ||
          !activeDockShrink ||
          activeDockShrink.id !== payload.transitionId ||
          activeDockShrink.phase !== 'visual-committed'
        ) {
          return;
        }
        const side = payload.dock.side;
        dockRef.current = { side };
        flushSync(() => {
          setDock({ side });
          // 裁窗已 paint 完成，这里才切 settled 补回内描边——早一阶段
          // （stable，裁窗前）挂 shadow 会让透明窗在 crop 时重算轮廓闪一帧。
          setDockShrink((previous) => (previous ? { ...previous, phase: 'settled' } : previous));
          setIsCollapsed(false);
        });
        activeDockShrinkTransactionRef.current = null;
        return;
      }

      if (payload.dock && payload.shrinkFromStrip) {
        if (payload.transitionId === undefined || dockRef.current) {
          return;
        }
        if (activeDockShrink?.id === payload.transitionId) {
          // 同一 IPC 被重复投递时不重启动画、不重发 ACK。
          return;
        }
        startDockShrinkToBookmark(
          payload.transitionId,
          payload.dock.side,
          payload.shrinkFromStrip
        );
        return;
      }

      if (payload.dock) {
        const stableShrink = dockShrinkRef.current;
        if (
          (stableShrink?.phase === 'stable' || stableShrink?.phase === 'settled') &&
          stableShrink.side === payload.dock.side
        ) {
          // 兼容迟到/重复的普通 dock 通知：稳定 overlay 已经是可交互书签头，
          // 不要为了逻辑通知把它卸掉再挂一枚新壳。
          dockRef.current = payload.dock;
          setDock(payload.dock);
          setIsCollapsed(false);
          return;
        }
        dockRevealGenerationRef.current += 1;
        activeDockShrinkTransactionRef.current = null;
        dockRef.current = payload.dock;
        flushSync(() => {
          setDockExpandHold(null);
          setDockShrink(null);
          setDockShrinkLanding(false);
          setDock(payload.dock);
          setIsCollapsed(false);
        });
        return;
      }

      // 窗口交接的拖出展开（带 transitionId 的 dock:null + expandFrom）：主进程
      // 已在隐藏态把主窗 setBounds 到展开矩形；这里备好揭示首帧（clip 钉书签头
      // 矩形）并回 ACK，揭示动画等 committed（主窗上屏后）才播放。必须排在通用
      // transitionId abort 分支之前，否则会被误判成吸附事务的作废通知。
      if (payload.expandFrom && payload.transitionId !== undefined && payload.dock === null) {
        const previousDock =
          dockRef.current ??
          (activeDockShrink?.phase === 'visual-committed'
            ? { side: activeDockShrink.side }
            : null);
        dockRevealGenerationRef.current += 1;
        activeDockShrinkTransactionRef.current = null;
        dockRef.current = null;
        flushSync(() => {
          setDockShrink(null);
          setDock(null);
          // 贴边 → 拖出展开：贴边前若是收起横条，正文挂载标记停在 false，
          // 不恢复的话窗口已长开、正文却永远不渲染，只剩工具栏的空白便签。
          setShouldRenderContent(true);
          if (previousDock) {
            setIsCollapsed(false);
          }
        });
        if (previousDock) {
          prepareDockExpandReveal(payload.transitionId, {
            side: previousDock.side,
            ...payload.expandFrom
          });
        } else {
          setDockExpandHold(null);
        }
        return;
      }

      if (payload.transitionId !== undefined) {
        if (activeDockShrink?.id === payload.transitionId) {
          abortDockShrinkTransaction(activeDockShrink);
        }
        // 迟到或不属于当前事务的 abort 不能清掉已提交/更新的画面。
        return;
      }

      // 无 transitionId 的 dock:null 是正常拖出展开或主进程完成延迟横条恢复。
      // aborted 事务自己的 viewport waiter 会在 source 尺寸回来后撤 overlay；
      // 真实抢拖可能让第一轮 waiter 超时；松手后的这次通知重新武装 cleanup，
      // 仍然等 source 视口命中才撤，不会在 union 大窗里露出被拉宽的 collapsed 壳。
      if (activeDockShrink?.phase === 'aborted' && !payload.expandFrom) {
        abortDockShrinkTransaction(activeDockShrink);
        return;
      }
      const previousDock =
        dockRef.current ??
        (activeDockShrink?.phase === 'visual-committed'
          ? { side: activeDockShrink.side }
          : null);
      dockRevealGenerationRef.current += 1;
      activeDockShrinkTransactionRef.current = null;
      dockRef.current = null;
      flushSync(() => {
        setDockShrink(null);
        setDock(null);
        // 贴边 → 拖出展开：贴边前若是收起横条，正文挂载标记停在 false，
        // 不恢复的话窗口已长开、正文却永远不渲染，只剩工具栏的空白便签。
        setShouldRenderContent(true);
        if (previousDock && payload.expandFrom) {
          setIsCollapsed(false);
        }
      });
      if (previousDock && payload.expandFrom) {
        startDockExpandReveal({ side: previousDock.side, ...payload.expandFrom });
      } else {
        setDockExpandHold(null);
      }
    });

    const unsubscribeDockPreview = window.stickyNotes.onDockPreview((payload) => {
      setDockPreview(payload.side ? { side: payload.side } : null);
    });

    return () => {
      isMounted = false;
      unsubscribeDockApplied();
      unsubscribeDockPreview();
      window.removeEventListener('beforeunload', flushPendingContent);
      if (window.__stickyNotesFlushPendingContent === flushPendingContent) {
        delete window.__stickyNotesFlushPendingContent;
      }
      void flushPendingContent();
    };
  }, []);

  useEffect(() => {
    const focusTarget = pendingFocusRestoreRef.current;

    if (!focusTarget) {
      return;
    }

    pendingFocusRestoreRef.current = undefined;
    focusEditingTarget(focusTarget);
  });

  useEffect(() => {
    if (!noteNaming.isEditing) {
      return;
    }

    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [noteNaming.isEditing]);

  useEffect(() => {
    if (!statusMessage || PERSISTENT_STATUS_MESSAGES.has(statusMessage)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage('');
    }, STATUS_MESSAGE_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  useEffect(() => {
    if (!isMoreMenuOpen && !isNoteDeleteConfirmOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;

      if (openPopover === 'more') {
        if (
          !target ||
          (!moreMenuRef.current?.contains(target) &&
            !moreMenuButtonRef.current?.contains(target))
        ) {
          setOpenPopover(null);
        }

        return;
      }

      if (openPopover === 'note-delete') {
        if (
          !target ||
          (!noteDeleteConfirmRef.current?.contains(target) &&
            !noteDeleteButtonRef.current?.contains(target))
        ) {
          setOpenPopover(null);
        }
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
    };
  }, [openPopover]);

  useEffect(() => {
    if (!isMoreMenuOpen) {
      return;
    }

    const animationFrameId = requestAnimationFrame(() => {
      moreMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!isNoteDeleteConfirmOpen) {
      return;
    }

    const animationFrameId = requestAnimationFrame(() => {
      cancelNoteDeleteButtonRef.current?.focus();
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, [isNoteDeleteConfirmOpen]);

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextContent = event.target.value;
    setContent(nextContent);
    saveContentRef.current?.schedule(nextContent);
  };

  const handleStartNameEditing = (event: MouseEvent<HTMLSpanElement>): void => {
    if (isNameSavingRef.current) {
      return;
    }

    if (isCollapsed) {
      const currentTarget = event.currentTarget;
      setCollapsedNameEditStartWidth(currentTarget.getBoundingClientRect().width);
    }

    setIsAppearanceOpen(false);
    setIsMoreMenuOpen(false);
    setIsNoteDeleteConfirmOpen(false);
    isNameEditingRef.current = true;
    setNoteNaming(startNoteNameEditing);
  };

  const handleNameSubmit = (): void => {
    if (!isNameEditingRef.current || isNameSavingRef.current) {
      return;
    }

    isNameSavingRef.current = true;
    const draft = noteNaming.draft;
    setNoteNaming(beginNoteNameSave);

    void window.stickyNotes
      .updateName(draft)
      .then((note) => {
        isNameSavingRef.current = false;

        if (note) {
          isNameEditingRef.current = false;
          setNoteNaming((state) => applySavedNoteName(state, note.name));
          return;
        }

        setNoteNaming(failNoteNameSave);
      })
      .catch(() => {
        isNameSavingRef.current = false;
        setNoteNaming(failNoteNameSave);
      });
  };

  const handleCancelNameEditing = (): void => {
    isNameEditingRef.current = false;
    setNoteNaming(cancelNoteNameEditing);
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const action = getNoteNameKeyAction(event.key, event.nativeEvent.isComposing);

    if (!action) {
      return;
    }

    event.preventDefault();

    if (isNameSavingRef.current) {
      return;
    }

    if (action === 'submit') {
      handleNameSubmit();
      return;
    }

    handleCancelNameEditing();
  };

  const rememberChecklistInput = (
    itemId: string,
    element: HTMLTextAreaElement | null
  ): void => {
    if (element) {
      checklistInputRefs.current.set(itemId, element);
      return;
    }

    checklistInputRefs.current.delete(itemId);
  };

  const focusEditingTarget = (target: ChecklistFocusTarget): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const focusTarget =
          target.type === 'checklist'
            ? checklistInputRefs.current.get(target.itemId) ?? noteInputRef.current
            : noteInputRef.current;

        focusTarget?.focus();
      });
    });
  };

  const restoreEditingFocus = (): void => {
    focusEditingTarget(lastEditingTargetRef.current);
  };

  const handlePasteImage = (): void => {
    const flushPendingContent = saveContentRef.current?.flush() ?? Promise.resolve();

    void flushPendingContent
      .then(() => window.stickyNotes.pasteClipboardImage())
      .then((result) => {
        if (result.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          return;
        }

        setStatusMessage(result.reason === 'empty-clipboard' ? '剪贴板没有图片' : '贴图失败');
      })
      .catch(() => {
        setStatusMessage('贴图失败');
      });
  };

  const saveChecklist = (nextChecklist: NoteChecklistItemRecord[]): void => {
    checklistRef.current = nextChecklist;
    setChecklist(nextChecklist);
    window.stickyNotes
      .updateChecklist(nextChecklist)
      .then((note) => {
        if (note) {
          checklistRef.current = note.checklist;
          setChecklist(note.checklist);
          setStatusMessage('');
          return;
        }

        setStatusMessage('保存失败');
      })
      .catch(() => {
        setStatusMessage('保存失败');
      });
  };

  const handleAddChecklistItem = (): void => {
    const now = new Date().toISOString();
    const itemId = createClientId();
    const nextChecklist = [
      ...checklist,
      {
        id: itemId,
        text: '',
        checked: false,
        createdAt: now,
        updatedAt: now
      }
    ];
    const focus = {
      type: 'checklist',
      itemId
    } satisfies ChecklistFocusTarget;

    saveChecklist(nextChecklist);
    lastEditingTargetRef.current = focus;
    focusEditingTarget(focus);
  };

  const handleAddChecklistSubtask = (parentId: string): void => {
    const result = applyChecklistAddSubtask(checklist, parentId, {
      createId: createClientId,
      now: () => new Date().toISOString()
    });
    saveChecklist(result.checklist);
    lastEditingTargetRef.current = result.focus;
    focusEditingTarget(result.focus);
  };

  const handleChecklistTextChange = (itemId: string, text: string): void => {
    const now = new Date().toISOString();
    saveChecklist(
      checklist.map((item) => (item.id === itemId ? { ...item, text, updatedAt: now } : item))
    );
  };

  const handleChecklistCheckedChange = (itemId: string, checked: boolean): void => {
    const now = new Date().toISOString();
    saveChecklist(
      checklist.map((item) => (item.id === itemId ? { ...item, checked, updatedAt: now } : item))
    );
  };

  const handleChecklistBlur = (item: NoteChecklistItemRecord): void => {
    const currentItem = checklistRef.current.find((candidate) => candidate.id === item.id);

    if (currentItem?.parentId && currentItem.text.trim().length === 0) {
      saveChecklist(applyChecklistDelete(checklistRef.current, item.id));
    }
  };

  const handleDeleteChecklistItem = (itemId: string): void => {
    saveChecklist(applyChecklistDelete(checklist, itemId));
  };

  const handleChecklistKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    itemId: string
  ): void => {
    const action = getChecklistKeyAction(
      event.key,
      event.nativeEvent.isComposing,
      event.shiftKey
    );

    if (action === 'indent' || action === 'outdent') {
      event.preventDefault();
      const result = action === 'indent'
        ? applyChecklistIndent(checklist, itemId)
        : applyChecklistOutdent(checklist, itemId);
      saveChecklist(result.checklist);
      lastEditingTargetRef.current = result.focus;
      focusEditingTarget(result.focus);
      return;
    }

    if (action === 'enter') {
      event.preventDefault();
      const result = applyChecklistEnter(checklist, itemId, {
        createId: createClientId,
        now: () => new Date().toISOString()
      });
      saveChecklist(result.checklist);
      lastEditingTargetRef.current = result.focus;
      focusEditingTarget(result.focus);
      return;
    }

    if (
      action === 'backspace' &&
      event.currentTarget.value.length === 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      const result = applyChecklistBackspace(checklist, itemId);
      saveChecklist(result.checklist);
      lastEditingTargetRef.current = result.focus;
      focusEditingTarget(result.focus);
    }
  };

  const saveAppearance = (nextAppearance: { color?: string; opacity?: number }): void => {
    window.stickyNotes
      .updateAppearance(nextAppearance)
      .then((note) => {
        if (note) {
          setColor(note.color);
          setOpacity(note.opacity);
          setStatusMessage('');
          return;
        }

        setStatusMessage('保存失败');
      })
      .catch(() => {
        setStatusMessage('保存失败');
      });
  };

  const handleColorChange = (nextColor: string): void => {
    setColor(nextColor);
    saveAppearance({ color: nextColor });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextOpacity = Number(event.target.value);
    setOpacity(nextOpacity);
    saveAppearance({ opacity: nextOpacity });
  };

  const handleDropImage = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setIsImageDragActive(false);

    const imageFile = getFirstImageFile(event.dataTransfer.files);

    if (!imageFile) {
      setStatusMessage('没有图片');
      return;
    }

    const flushPendingContent = saveContentRef.current?.flush() ?? Promise.resolve();

    void flushPendingContent
      .then(() => readImageFileForNote(imageFile))
      .then((imageInput) => window.stickyNotes.addImage(imageInput))
      .then((result) => {
        if (result?.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          restoreEditingFocus();
          return;
        }

        setStatusMessage('贴图失败');
      })
      .catch(() => {
        setStatusMessage('贴图失败');
      });
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!hasImageDragData(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsImageDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsImageDragActive(false);
  };

  const handleRequestDeleteImage = (imageId: string): void => {
    setPendingImageDelete({
      imageId,
      focusTarget: lastEditingTargetRef.current
    });
  };

  const handleCancelDeleteImage = (): void => {
    const focusTarget = pendingImageDelete?.focusTarget;

    if (focusTarget) {
      pendingFocusRestoreRef.current = focusTarget;
    }

    setPendingImageDelete(undefined);
  };

  const handleConfirmDeleteImage = (): void => {
    const pendingDelete = pendingImageDelete;

    if (!pendingDelete) {
      return;
    }

    window.stickyNotes
      .deleteImage(pendingDelete.imageId)
      .then((result) => {
        pendingFocusRestoreRef.current = pendingDelete.focusTarget;
        setPendingImageDelete(undefined);

        if (result?.ok) {
          setImages(result.note.images);
          setStatusMessage('');
          return;
        }

        setStatusMessage('删除图片失败');
      })
      .catch(() => {
        pendingFocusRestoreRef.current = pendingDelete.focusTarget;
        setPendingImageDelete(undefined);
        setStatusMessage('删除图片失败');
      });
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>): void => {
    const hasImage = Array.from(event.clipboardData.items).some((item) =>
      item.type.startsWith('image/')
    );

    if (!hasImage) {
      return;
    }

    event.preventDefault();
    handlePasteImage();
  };

  const handleCreateNote = (): void => {
    window.stickyNotes
      .createNote()
      .then((result) => {
        setStatusMessage(result.ok ? '' : '最多 20 张');
      })
      .catch(() => {
        setStatusMessage('新建失败');
      });
  };

  const handleRequestDeleteNote = (): void => {
    setOpenPopover((current) => togglePopover(current, 'note-delete'));
  };

  const handleConfirmDeleteNote = (): void => {
    setIsNoteDeleteConfirmOpen(false);
    window.stickyNotes.deleteCurrentNote().catch(() => {
      setStatusMessage('删除失败');
    });
  };

  const handleCancelDeleteNote = (): void => {
    setIsNoteDeleteConfirmOpen(false);
    requestAnimationFrame(() => noteDeleteButtonRef.current?.focus());
  };

  const handleNoteDeleteConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelDeleteNote();
    }
  };

  const handleMoreMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex =
        currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsMoreMenuOpen(false);
      requestAnimationFrame(() => moreMenuButtonRef.current?.focus());
      return;
    } else if (event.key === 'Tab') {
      setIsMoreMenuOpen(false);
      return;
    } else {
      return;
    }

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const handleAppearanceMenuItem = (): void => {
    setIsMoreMenuOpen(false);
    setIsAppearanceOpen((value) => !value);
  };

  const handlePasteImageMenuItem = (): void => {
    setIsMoreMenuOpen(false);
    handlePasteImage();
  };

  const handleCollapsedChange = (collapsed: boolean): void => {
    if (collapsed === isCollapsed || isCollapseTransitioning || dock !== null) {
      return;
    }

    void (async () => {
      if (collapsed) {
        collapsedScrollTopRef.current = noteContentRef.current?.scrollTop ?? 0;
        const expandedStatusLabelWidth = statusLabelRef.current?.getBoundingClientRect().width ?? 0;
        expandedStatusLabelWidthRef.current = expandedStatusLabelWidth;
        setTransitionStatusLabelWidth(expandedStatusLabelWidth);
      } else {
        setTransitionStatusLabelWidth(expandedStatusLabelWidthRef.current);
      }
      setIsCollapseTransitioning(true);

      try {
        if (collapsed) {
          setIsAppearanceOpen(false);
          setIsMoreMenuOpen(false);
          setIsNoteDeleteConfirmOpen(false);
          setPendingImageDelete(undefined);
          // Let the transitioning title and toolbar mount in their hidden
          // state before the class flip starts the staged transitions.
          await waitForNextPaint();
          const visualTransition = waitForHeightTransition(noteShellRef.current);
          setIsCollapsed(true);
          await visualTransition;
        } else {
          setShouldRenderContent(true);
          await waitForAnimationFrame();
        }

        const didUpdate = await window.stickyNotes.setCollapsed(collapsed);

        if (!didUpdate) {
          throw new Error('Window collapse state was not updated');
        }

        if (collapsed) {
          setShouldRenderContent(false);
        } else {
          await waitForExpandedViewport();
          const visualTransition = waitForHeightTransition(noteShellRef.current);
          setIsCollapsed(false);
          await waitForAnimationFrame();
          const scrollTop = collapsedScrollTopRef.current;
          if (scrollTop !== undefined && noteContentRef.current) {
            noteContentRef.current.scrollTop = scrollTop;
            collapsedScrollTopRef.current = undefined;
          }
          await visualTransition;
        }
        setStatusMessage('');
      } catch {
        if (collapsed) {
          const rollbackTransition = waitForHeightTransition(noteShellRef.current);
          setIsCollapsed(false);
          setShouldRenderContent(true);
          await rollbackTransition;
        } else {
          setIsCollapsed(true);
          setShouldRenderContent(false);
        }
        setStatusMessage(collapsed ? '收起失败' : '展开失败');
      } finally {
        setIsCollapseTransitioning(false);
        setTransitionStatusLabelWidth(0);
      }
    })();
  };

  const shellStyle: NoteShellStyle = {
    backgroundColor: hexToRgba(color, opacity),
    '--note-menu-surface': noteColorToMenuSurface(color),
    '--note-collapsed-height': `${NOTE_COLLAPSED_HEIGHT}px`,
    '--note-transition-title-width': `${transitionStatusLabelWidth}px`,
    '--collapsed-name-edit-start-width': `${collapsedNameEditStartWidth}px`
  };
  const checklistAddLabel = getChecklistAddLabel(
    checklist.length,
    appCopy.checklistItemPlaceholder
  );
  const showChecklistAddEntry = shouldShowChecklistAddEntry(checklist.length);
  const checklistGroups = useMemo(() => groupChecklist(checklist), [checklist]);
  const collapsedLabel = statusMessage || noteNaming.name;
  const namePresentation = getNoteNamePresentation(noteNaming, statusMessage);

  // Shared by the expanded status label and the collapsed title bar. Only one
  // of the two areas is interactive at a time, so a single input ever mounts.
  const renderNamePresentationContent = (): ReactNode => (
    <>
      {namePresentation.kind === 'status' ? (
        <span className="status-message">{namePresentation.text}</span>
      ) : null}
      {namePresentation.kind === 'editor' ? (
        <>
          <input
            ref={nameInputRef}
            className={`note-name-input${
              noteNaming.hasSaveError ? ' note-name-input--error' : ''
            }`}
            type="text"
            aria-label="便签名称"
            aria-busy={noteNaming.isSaving}
            aria-invalid={noteNaming.hasSaveError}
            aria-describedby={noteNaming.hasSaveError ? 'name-save-error' : undefined}
            readOnly={noteNaming.isSaving}
            value={noteNaming.draft}
            onChange={(event) =>
              setNoteNaming((state) =>
                updateNoteNameDraft(state, limitNoteNameLength(event.target.value))
              )
            }
            onKeyDown={handleNameKeyDown}
            onBlur={handleNameSubmit}
          />
          {noteNaming.hasSaveError ? (
            <span id="name-save-error" className="visually-hidden">
              保存失败
            </span>
          ) : null}
        </>
      ) : null}
      {namePresentation.kind === 'name' ? (
        <span
          className="note-name-hit-area note-name-hit-area--named"
          onDoubleClick={handleStartNameEditing}
        >
          <span className="note-name">{namePresentation.text}</span>
        </span>
      ) : null}
      {namePresentation.kind === 'empty' ? (
        <span
          className="note-name-hit-area"
          title="双击命名"
          onDoubleClick={handleStartNameEditing}
        >
          <span className="note-name note-name--empty" data-hint={namePresentation.hint} />
        </span>
      ) : null}
    </>
  );

  // 贴边态只渲染一枚横书签头（结构见 DockedNoteShell）：便签色实心底、有名字
  // 横排露一小段，没有按钮和正文。磁吸/探头全由主进程改窗口几何，这里只发扳机。
  // shrink overlay 还在时绝不走这条全窗渲染：DockedNoteShell 是 100% 铺满当前
  // 窗口的，视口还是 union 尺寸就 setDock 会把书签头拉满整个 union（真机
  // 「变长又变短」的抽搓）——overlay 钉在 bookmark 矩形盖到裁窗后第一帧才切。
  if (dock && !dockShrink) {
    return (
      <DockedNoteShell
        dock={dock}
        namePresentation={namePresentation}
        noteShellRef={noteShellRef}
        preloadStatus={preloadStatus}
        shellStyle={shellStyle}
      />
    );
  }

  return (
    <>
      <main
        ref={noteShellRef}
        className={`note-shell${isImageDragActive ? ' note-shell--dragging-image' : ''}${
          isCollapsed ? ' note-shell--collapsed' : ''
        }${isCollapseTransitioning ? ' note-shell--collapse-transitioning' : ''}${
          noteNaming.isEditing ? ' note-shell--naming' : ''
        }${dockShrink ? ' note-shell--shrink-hold' : ''}${
          dockExpandHold?.phase === 'prepare' ? ' note-shell--expand-hold' : ''
        }`}
      data-preload-status={preloadStatus}
      style={shellStyle}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropImage}
    >
      <div className="drag-bar">
        <span className="drag-grip" aria-hidden="true" />
        <div className="drag-bar-title">
          {!isCollapsed || isCollapseTransitioning ? (
            <div
              ref={statusLabelRef}
              className="status-label"
              aria-live="polite"
              aria-hidden={isCollapsed || undefined}
            >
              {renderNamePresentationContent()}
            </div>
          ) : null}
          {isCollapsed || isCollapseTransitioning ? (
            <span
              className="collapsed-title"
              title={collapsedLabel}
              aria-live="polite"
              aria-hidden={!isCollapsed || undefined}
            >
              {isCollapsed && !isCollapseTransitioning ? (
                renderNamePresentationContent()
              ) : (
                <span className="collapsed-title-text">{collapsedLabel}</span>
              )}
            </span>
          ) : null}
        </div>
        {isCollapsed && !isCollapseTransitioning && dockPreview ? (
          // 松手贴边承诺：绝对定位不参与布局（拖动中标题不跳），pointer-events
          // 关闭避免在 drag 区上挖洞。图标指向将要吸附的那一侧。
          <span
            className={`dock-preview-chip${
              dockPreview.side === 'right' ? ' dock-preview-chip--right' : ''
            }`}
            aria-hidden="true"
          >
            {dockPreview.side === 'left' ? <ArrowLeftToLine size={13} strokeWidth={2} /> : null}
            松手贴边
            {dockPreview.side === 'right' ? <ArrowRightToLine size={13} strokeWidth={2} /> : null}
          </span>
        ) : null}
        <div className="drag-bar-actions">
          {!isCollapsed || isCollapseTransitioning ? (
            <div
              className="toolbar-wrap"
              aria-hidden={isCollapsed || noteNaming.isEditing || undefined}
            >
              <div className="toolbar" aria-label="便签工具">
                <button
                  type="button"
                  title="新建便签"
                  aria-label="新建便签"
                  tabIndex={noteNaming.isEditing ? -1 : undefined}
                  onClick={handleCreateNote}
                >
                  <Plus size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  title="添加事项"
                  aria-label="添加事项"
                  tabIndex={noteNaming.isEditing ? -1 : undefined}
                  onClick={handleAddChecklistItem}
                >
                  <CheckSquare size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  ref={noteDeleteButtonRef}
                  className="note-delete-button"
                  title="删除便签"
                  aria-label="删除便签"
                  aria-haspopup="dialog"
                  aria-expanded={isNoteDeleteConfirmOpen}
                  tabIndex={noteNaming.isEditing ? -1 : undefined}
                  onClick={handleRequestDeleteNote}
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  ref={moreMenuButtonRef}
                  title="更多"
                  aria-label="更多"
                  aria-haspopup="menu"
                  aria-expanded={isMoreMenuOpen}
                  aria-controls={isMoreMenuOpen ? 'note-more-menu' : undefined}
                  tabIndex={noteNaming.isEditing ? -1 : undefined}
                  onClick={() => setOpenPopover((current) => togglePopover(current, 'more'))}
                >
                  <MoreHorizontal size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          ) : null}
          {isMoreMenuOpen ? (
            <div
              ref={moreMenuRef}
              id="note-more-menu"
              className="more-menu"
              role="menu"
              aria-label="更多便签操作"
              onKeyDown={handleMoreMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={handleAppearanceMenuItem}
              >
                <span className="more-menu-item-label">
                  <Palette size={14} strokeWidth={2} aria-hidden="true" />
                  外观
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={handlePasteImageMenuItem}
              >
                <span className="more-menu-item-label">
                  <ImagePlus size={14} strokeWidth={2} aria-hidden="true" />
                  从剪贴板贴图
                </span>
                <kbd>{window.stickyNotes.platform === 'darwin' ? '⌘V' : 'Ctrl+V'}</kbd>
              </button>
            </div>
          ) : null}
          {isNoteDeleteConfirmOpen ? (
            <div
              ref={noteDeleteConfirmRef}
              className="note-delete-confirm"
              role="dialog"
              aria-label="确认删除便签"
              onKeyDown={handleNoteDeleteConfirmKeyDown}
            >
              <span>删除这张便签？</span>
              <button
                type="button"
                className="note-delete-confirm--danger"
                onClick={handleConfirmDeleteNote}
              >
                删除
              </button>
              <button type="button" ref={cancelNoteDeleteButtonRef} onClick={handleCancelDeleteNote}>
                取消
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="collapse-toggle"
            title={isCollapsed ? '展开便签' : '收起便签'}
            aria-label={isCollapsed ? '展开便签' : '收起便签'}
            disabled={isCollapseTransitioning}
            onClick={() => handleCollapsedChange(!isCollapsed)}
          >
            <span className="collapse-toggle-icons" aria-hidden="true">
              <span className="collapse-toggle-icon collapse-toggle-icon--up">
                <ChevronUp size={15} strokeWidth={2} />
              </span>
              <span className="collapse-toggle-icon collapse-toggle-icon--down">
                <ChevronDown size={15} strokeWidth={2} />
              </span>
            </span>
          </button>
        </div>
      </div>
      {shouldRenderContent ? (
        <div ref={noteContentRef} className="note-content" aria-hidden={isCollapsed}>
          {isAppearanceOpen ? (
          <div className="appearance-panel" aria-label="便签外观">
            <div className="color-swatches" aria-label="颜色">
              {Object.values(NOTE_COLORS).map((swatchColor) => (
                <button
                  key={swatchColor}
                  type="button"
                  className={`color-swatch${swatchColor === color ? ' color-swatch--active' : ''}`}
                  style={{ backgroundColor: swatchColor }}
                  title="颜色"
                  aria-label="颜色"
                  aria-pressed={swatchColor === color}
                  onClick={() => handleColorChange(swatchColor)}
                />
              ))}
            </div>
            <input
              className="opacity-slider"
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={opacity}
              title="透明度"
              aria-label="透明度"
              onChange={handleOpacityChange}
            />
          </div>
          ) : null}
          {images.length > 0 ? (
          <div className="image-list" aria-label="便签图片">
            {images.map((image) => (
              <figure key={image.id} className="image-item">
                <img
                  className="note-image"
                  src={image.src}
                  width={image.width || undefined}
                  height={image.height || undefined}
                  alt=""
                  draggable={false}
                  tabIndex={0}
                  role="button"
                  aria-label="预览图片"
                  title="点击预览图片"
                  onClick={() => {
                    void window.stickyNotes.openImagePreview(image.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void window.stickyNotes.openImagePreview(image.id);
                    }
                  }}
                />
                <button
                  type="button"
                  className="image-delete"
                  title="删除图片"
                  aria-label="删除图片"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => handleRequestDeleteImage(image.id)}
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
                {pendingImageDelete?.imageId === image.id ? (
                  <div className="image-delete-confirm" role="dialog" aria-label="确认删除图片">
                    <span>删除图片？</span>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleConfirmDeleteImage}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleCancelDeleteImage}
                    >
                      取消
                    </button>
                  </div>
                ) : null}
              </figure>
            ))}
          </div>
          ) : null}
          {checklist.length > 0 ? (
          <ul className="checklist" aria-label="勾选事项">
            {checklistGroups.map(({ parent, children }) => (
              <li key={parent.id} className="checklist-group">
                <div className="checklist-parent">
                  <ChecklistItemRow
                    item={parent}
                    isParent
                    hasChildren={children.length > 0}
                    shortcutHint={getChecklistShortcutHint(checklist, parent.id)}
                    placeholder={appCopy.checklistItemPlaceholder}
                    rememberInput={rememberChecklistInput}
                    onFocus={(itemId) => {
                      lastEditingTargetRef.current = {
                        type: 'checklist',
                        itemId
                      };
                    }}
                    onKeyDown={handleChecklistKeyDown}
                    onTextChange={handleChecklistTextChange}
                    onCheckedChange={handleChecklistCheckedChange}
                    onBlur={handleChecklistBlur}
                    onDelete={handleDeleteChecklistItem}
                    onAddSubtask={handleAddChecklistSubtask}
                  />
                </div>
                {children.length > 0 ? (
                  <ul className="checklist-children" aria-label="子任务">
                    {children.map((child) => (
                      <li key={child.id} className="checklist-child">
                        <ChecklistItemRow
                          item={child}
                          shortcutHint={getChecklistShortcutHint(checklist, child.id)}
                          placeholder={appCopy.checklistItemPlaceholder}
                          rememberInput={rememberChecklistInput}
                          onFocus={(itemId) => {
                            lastEditingTargetRef.current = {
                              type: 'checklist',
                              itemId
                            };
                          }}
                          onKeyDown={handleChecklistKeyDown}
                          onTextChange={handleChecklistTextChange}
                          onCheckedChange={handleChecklistCheckedChange}
                          onBlur={handleChecklistBlur}
                          onDelete={handleDeleteChecklistItem}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          ) : null}
          {showChecklistAddEntry ? (
          <button
            type="button"
            className="checklist-add checklist-add--empty"
            onClick={handleAddChecklistItem}
            aria-label="添加待办事项"
          >
            {checklistAddLabel}
          </button>
          ) : null}
          <textarea
            className="note-input"
            ref={noteInputRef}
            spellCheck={false}
            aria-label="便签内容"
            placeholder={appCopy.noteContentPlaceholder}
            value={content}
            onFocus={() => {
              lastEditingTargetRef.current = {
                type: 'note'
              };
            }}
            onChange={handleContentChange}
            onBlur={() => {
              void saveContentRef.current?.flush();
            }}
          />
        </div>
      ) : null}
    </main>
      {dockShrink && dockShrinkLanding ? (
        // 落地替身：动画末帧的静态克隆，只在收尾交接的两三帧内存在。
        // 几何由收尾代码直接写入（base 钉点 + 静态 transform/clip = 末帧像素），
        // 渲染在 stub 之下；stub cancel/换布局即使空一帧，露出的也是它。
        <DockedNoteShell
          dock={{ side: dockShrink.side }}
          namePresentation={namePresentation}
          noteShellRef={dockShrinkLandingRef}
          preloadStatus={preloadStatus}
          shellStyle={shellStyle}
          className="dock-shrink-stub dock-shrink-stub--landing"
          ariaHidden
        />
      ) : null}
      {dockShrink ? (
        // 同一枚 DockedNoteShell 从 source 纸面、union 逆揭示一直活到稳定书签头。
        // 几何 left/top/width/height 由 pinDockShrinkStubToScreenPoint 直接写入，
        // 不放进 React style props，避免无关 state 重渲染把已钉好的像素位置重置。
        <DockedNoteShell
          dock={{ side: dockShrink.side }}
          namePresentation={namePresentation}
          noteShellRef={dockShrinkStubRef}
          preloadStatus={preloadStatus}
          shellStyle={shellStyle}
          className={
            'dock-shrink-stub' +
            (dockShrink.phase === 'stable' ||
            dockShrink.phase === 'settled' ||
            dockShrink.phase === 'aborted'
              ? ' dock-shrink-stub--interactive'
              : '') +
            (dockShrink.phase === 'stable' ||
            dockShrink.phase === 'settled' ||
            dockShrink.phase === 'aborted'
              ? ' dock-shrink-stub--stroked'
              : '')
          }
        />
      ) : null}
      {dockExpandHold ? (
        // 落点长成：替身钉在 expandFrom，prepare 时顶住上屏首帧；reveal 起纸面
        // 从其底下向外长，再留 ~120ms 溶进标题栏。右贴边落点在窗右上，没有替身
        // 就会先露出工具栏图标。pointer-events:none 不挡拖动。
        <div
          className={
            'dock-expand-bookmark' +
            (dockExpandHold.phase === 'dissolve' ? ' dock-expand-bookmark--dissolve' : '')
          }
          aria-hidden="true"
          style={{
            top: dockExpandHold.y,
            left: dockExpandHold.x,
            width: dockExpandHold.width,
            height: dockExpandHold.height
          }}
        >
          <DockedNoteShell
            dock={{ side: dockExpandHold.side }}
            namePresentation={namePresentation}
            preloadStatus={preloadStatus}
            shellStyle={shellStyle}
          />
        </div>
      ) : null}
    </>
  );
}

function ChecklistItemRow({
  item,
  isParent = false,
  hasChildren = false,
  shortcutHint,
  placeholder,
  rememberInput,
  onFocus,
  onKeyDown,
  onTextChange,
  onCheckedChange,
  onBlur,
  onDelete,
  onAddSubtask
}: {
  item: NoteChecklistItemRecord;
  isParent?: boolean;
  hasChildren?: boolean;
  shortcutHint?: ChecklistShortcutHint;
  placeholder: string;
  rememberInput: (itemId: string, element: HTMLTextAreaElement | null) => void;
  onFocus: (itemId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, itemId: string) => void;
  onTextChange: (itemId: string, text: string) => void;
  onCheckedChange: (itemId: string, checked: boolean) => void;
  onBlur: (item: NoteChecklistItemRecord) => void;
  onDelete: (itemId: string) => void;
  onAddSubtask?: (parentId: string) => void;
}): JSX.Element {
  const inputLabel = item.parentId
    ? `子任务内容${shortcutHint === 'outdent' ? '，按 Shift+Tab 取消子任务层级' : ''}`
    : `事项内容${shortcutHint === 'indent' ? '，按 Tab 创建子任务' : ''}`;
  const rowClassName = [
    'checklist-item',
    item.parentId ? 'checklist-item--child' : '',
    hasChildren ? 'checklist-item--has-children' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClassName}>
      <input
        className="checklist-checkbox"
        type="checkbox"
        checked={item.checked}
        aria-label="完成"
        onChange={(event) => onCheckedChange(item.id, event.target.checked)}
      />
      <div className="checklist-actions">
        {isParent && onAddSubtask ? (
          <button
            type="button"
            className="checklist-add checklist-add--subtask"
            title="添加子任务（Tab）"
            aria-label={`为${item.text.trim() || '此事项'}添加子任务（Tab）`}
            onClick={() => onAddSubtask(item.id)}
          >
            <Plus size={14} strokeWidth={2.2} />
          </button>
        ) : null}
        <button
          type="button"
          className="checklist-delete"
          title="删除事项"
          aria-label="删除事项"
          onClick={() => onDelete(item.id)}
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
      <textarea
        className="checklist-input"
        rows={1}
        spellCheck={false}
        value={item.text}
        placeholder={placeholder}
        aria-label={inputLabel}
        ref={(element) => rememberInput(item.id, element)}
        onFocus={() => onFocus(item.id)}
        onBlur={() => onBlur(item)}
        onKeyDown={(event) => onKeyDown(event, item.id)}
        onChange={(event) => onTextChange(item.id, normalizeChecklistText(event.target.value))}
      />
    </div>
  );
}

const container = document.getElementById('root');

if (!container) {
  throw new Error('Renderer root was not found');
}

// 窗口交接架构：同一 renderer 包服务两种窗口——便签主窗（默认）与独立书签头
// 窗（?view=tab，只渲染静态书签头壳，见 TabApp）。
const isTabView = new URLSearchParams(window.location.search).get('view') === 'tab';
createRoot(container).render(isTabView ? <TabApp /> : <App />);

function getFirstImageFile(files: FileList): File | undefined {
  return Array.from(files).find(isImageDropFile);
}

function createClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function waitForExpandedViewport(): Promise<void> {
  return new Promise((resolve) => {
    let didFinish = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      window.removeEventListener('resize', handleResize);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      requestAnimationFrame(() => resolve());
    };
    const handleResize = (): void => {
      if (window.innerHeight > NOTE_COLLAPSED_HEIGHT) {
        finish();
      }
    };

    window.addEventListener('resize', handleResize);
    fallbackTimer = setTimeout(finish, NOTE_VIEWPORT_RESIZE_FALLBACK_MS);
    handleResize();
  });
}

// 等视口变成目标尺寸（±2px 容差）：命中返回 true，超时返回 false。timeout
// 不是成功——renderer 不再发送后续 ACK，由主进程统一恢复横条，避免 native、
// renderer、controller 三方各自以为自己完成了不同状态。onMatch 与 resize 同步
// 执行，只用于原点变化时重钉 overlay；实际 paint barrier 由调用点显式等待。
function waitForViewportSize(
  width: number,
  height: number,
  onMatch?: () => void
): Promise<boolean> {
  return new Promise((resolve) => {
    let didFinish = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (matched: boolean): void => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      window.removeEventListener('resize', handleResize);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      resolve(matched);
    };
    const handleResize = (): void => {
      if (
        Math.abs(window.innerWidth - width) <= 2 &&
        Math.abs(window.innerHeight - height) <= 2
      ) {
        onMatch?.();
        finish(true);
      }
    };

    window.addEventListener('resize', handleResize);
    fallbackTimer = setTimeout(() => finish(false), NOTE_VIEWPORT_RESIZE_FALLBACK_MS);
    handleResize();
  });
}

// Native BrowserWindow geometry is observed at two layers on macOS: Chromium
// may publish a new viewport before WindowServer publishes the new screen
// origin.  Poll all four values on animation frames and keep the paper pinned
// to its global point on every frame.  A timeout is a failed stage, never an
// implicit success.
function waitForWindowGeometry(
  width: number,
  height: number,
  screenPoint: { x: number; y: number },
  onFrame?: () => void,
  tolerance = 2
): Promise<boolean> {
  return new Promise((resolve) => {
    let didFinish = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let frameId: number | undefined;
    const finish = (matched: boolean): void => {
      if (didFinish) {
        return;
      }
      didFinish = true;
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      resolve(matched);
    };
    const poll = (): void => {
      if (didFinish) {
        return;
      }
      onFrame?.();
      const sizeMatches =
        Math.abs(window.innerWidth - width) <= tolerance &&
        Math.abs(window.innerHeight - height) <= tolerance;
      const originMatches =
        Math.abs(window.screenX - screenPoint.x) <= tolerance &&
        Math.abs(window.screenY - screenPoint.y) <= tolerance;
      if (sizeMatches && originMatches) {
        finish(true);
        return;
      }
      frameId = requestAnimationFrame(poll);
    };
    fallbackTimer = setTimeout(
      () => finish(false),
      NOTE_VIEWPORT_RESIZE_FALLBACK_MS
    );
    poll();
  });
}

function waitForHeightTransition(element: HTMLElement | null): Promise<void> {
  if (!element) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let fallbackTimer: ReturnType<typeof setTimeout>;
    const finish = (): void => {
      element.removeEventListener('transitionend', handleTransitionEnd);
      clearTimeout(fallbackTimer);
      resolve();
    };
    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === 'height') {
        finish();
      }
    };

    element.addEventListener('transitionend', handleTransitionEnd);
    fallbackTimer = setTimeout(finish, NOTE_SHELL_TRANSITION_FALLBACK_MS);
  });
}

function hasImageDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.items).some((item) => {
    if (item.kind !== 'file') {
      return false;
    }

    return item.type === '' || item.type.startsWith('image/');
  });
}

async function readImageFileForNote(file: File): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  const pngImage = await readImageFileAsPng(file);

  return {
    data: pngImage.data,
    width: pngImage.width,
    height: pngImage.height
  };
}

function readImageFileAsPng(file: File): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Image could not be rendered'));
          return;
        }

        context.drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);

          if (!blob) {
            reject(new Error('Image could not be encoded'));
            return;
          }

          blob
            .arrayBuffer()
            .then((buffer) => {
              resolve({
                data: new Uint8Array(buffer),
                width: image.naturalWidth,
                height: image.naturalHeight
              });
            })
            .catch(reject);
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image dimensions could not be read'));
    };
    image.src = objectUrl;
  });
}
