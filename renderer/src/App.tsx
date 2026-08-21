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
import type { NoteImageView } from '../../main/notes-manager';
import { groupChecklist } from '../../main/checklist-hierarchy';
import type { NoteChecklistItemRecord } from '../../main/note-state';
import { DEFAULT_APP_COPY } from '../../shared/app-copy';
import { DEFAULT_NOTE_COLOR, DEFAULT_NOTE_OPACITY, NOTE_COLORS } from '../../shared/note-appearance';
import { NOTE_COLLAPSED_HEIGHT } from '../../shared/note-window';
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
import './styles.css';

const STATUS_MESSAGE_DURATION_MS = 2000;
const NOTE_SHELL_TRANSITION_FALLBACK_MS = 320;
// 吸附 morph 与主进程 NOTE_DOCK_IN_GLIDE_DURATION_MS 同拍，改动要两边一起改。
const NOTE_DOCK_MORPH_MS = 320;
const NOTE_VIEWPORT_RESIZE_FALLBACK_MS = 500;
const PERSISTENT_STATUS_MESSAGES = new Set(['读取失败']);

type NoteShellStyle = CSSProperties &
  Record<
    | '--note-menu-surface'
    | '--note-collapsed-height'
    | '--note-transition-title-width'
    | '--collapsed-name-edit-start-width',
    string
  >;

// 贴边书签头：壳永久 no-drag，承载视觉并充当悬停传感环——实测 drag 区在应用
// 非激活时收不到 OS 的 enter/leave，而 no-drag 面双向照收，所以 enter/leave
// 扳机挂壳上；内嵌 5px 的透明 pill 是永久 drag 的拖动面，休息半藏时也能直接
// 抓取拖出展开/沿边滑动。藏与露纯靠主进程滑行窗口几何，DOM 永远铺满窗口。
function DockedNoteShell({
  dock,
  namePresentation,
  noteShellRef,
  preloadStatus,
  shellStyle
}: {
  dock: { side: 'left' | 'right' };
  namePresentation: ReturnType<typeof getNoteNamePresentation>;
  // morph 叠加层复用时不传：同一时刻主壳与叠加层都挂着，ref 只归真正的壳。
  noteShellRef?: RefObject<HTMLElement>;
  preloadStatus: string;
  shellStyle: NoteShellStyle;
}): ReactElement {
  return (
    <main
      ref={noteShellRef}
      className={`note-shell note-shell--docked${
        dock.side === 'right' ? ' note-shell--dock-right' : ''
      }`}
      data-preload-status={preloadStatus}
      style={shellStyle}
      aria-label="已贴边的便签，向右或向左拖动可展开"
      onMouseEnter={() => window.stickyNotes.dockPeekHover(true)}
      onMouseLeave={() => window.stickyNotes.dockPeekHover(false)}
    >
      {namePresentation.kind === 'name' ? (
        <span className="dock-tab-name" aria-hidden="true">
          {namePresentation.text}
        </span>
      ) : null}
      <div className="dock-tab-pill" aria-hidden="true" />
    </main>
  );
}

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
  // 进出贴边是磁吸：主进程在原生拖动的 move 上直接改窗口几何，dock-applied
  // 到达时这里只切 DOM，不演过渡。
  const [dock, setDock] = useState<{ side: 'left' | 'right' } | null>(() => {
    const initialDockSide = window.stickyNotes.getInitialDockSide();
    return initialDockSide ? { side: initialDockSide } : null;
  });
  const dockRef = useRef(dock);
  dockRef.current = dock;
  // 吸附滑入的交叉淡变：窗口纯平移滑行时，横条壳淡出、书签头 DOM 按目标
  // 尺寸钉在窗口保留角（右侧贴边钉右上、左侧钉左上）的叠加层里淡入——
  // 窗口尺寸全程不变，DOM 零重排；到位后主进程一次性裁剪（视觉隐形）。
  const [dockMorph, setDockMorph] = useState<{
    side: 'left' | 'right';
    width: number;
    height: number;
  } | null>(null);
  // 拖出揭示的「占位书签头」：dock 切 null 的同一 commit 起，主壳隐身（opacity 0，
  // 仍可命中、app-region 拖动不受影响），这枚 overlay 钉在 expandFrom 位置冒充
  // 书签头——原生窗口长开的 1~2 帧里用户看到的是连续的书签头，而不是闪一整面
  // 纸。clip 就位后与「壳体恢复可见」同一 commit 卸掉，首帧即是书签头矩形。
  const [dockExpandHold, setDockExpandHold] = useState<{
    side: 'left' | 'right';
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // 拖出展开揭示动画的代际令牌：动画途中窗口被重新贴边（dock-applied 翻回
  // 非空）时作废旧动画，不让它把新壳体的 clip 清掉。吸附 morph 复用同一令牌
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

  // 拖出展开的揭示动画：dock=null 的同一 commit 先把主壳隐身、书签头 overlay 钉
  // 到 expandFrom（dockExpandHold，等待原生窗口长开期间视觉连续）；视口长开后把
  // 壳体 clip 到书签头矩形（expandFrom 是新窗口坐标系，直接量视口会拿到 96×32 的
  // 旧几何），clip 与「恢复可见」同一 commit——首帧就是书签头矩形，不会闪一整窗
  // 再收回来；随后 WAAPI 把 clip 滑到全窗，340ms、缓动与收起/展开同一族。中途
  // 重新贴边由代际令牌作废旧动画。
  const startDockExpandReveal = (from: {
    side: 'left' | 'right';
    x: number;
    y: number;
    width: number;
    height: number;
  }): void => {
    const generation = ++dockRevealGenerationRef.current;
    setDockExpandHold(from);
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
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const top = Math.max(0, Math.min(from.y, viewportHeight));
      const left = Math.max(0, Math.min(from.x, viewportWidth));
      const right = Math.max(0, viewportWidth - (left + from.width));
      const bottom = Math.max(0, viewportHeight - (top + from.height));
      const fromClip = `inset(${top}px ${right}px ${bottom}px ${left}px round 8px)`;
      // clip 先写进 style，再同一 commit 撤隐身 + 卸 overlay：恢复可见的第一帧
      // 已是书签头矩形。will-change 提示 compositor，圆角 clip 走 paint 线程时
      // 少一次中途层升级。
      shell.style.clipPath = fromClip;
      shell.style.willChange = 'clip-path';
      setDockExpandHold(null);
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
    })();
  };

  // 吸附滑入的交叉淡变：横条壳加淡出 class、书签头在叠加层淡入，淡变结束
  // （与窗口滑行同拍）再切纯书签头 DOM。回滚/熔断路径发来的 dock:null 会
  // 清掉 morph 状态，壳体淡出 class 随渲染移除、透明度自然回来。
  const startDockMorphToBookmark = (
    side: 'left' | 'right',
    size: { width: number; height: number }
  ): void => {
    const generation = ++dockRevealGenerationRef.current;
    setDockMorph({ side, ...size });
    window.setTimeout(() => {
      if (generation !== dockRevealGenerationRef.current) {
        return;
      }
      setDock({ side });
      setDockMorph(null);
    }, NOTE_DOCK_MORPH_MS + 40);
  };

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
        setDock(note?.dock ? { side: note.dock.side } : null);
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
      // （expandFrom，纸面从书签头矩形 clip 揭示）与吸附滑入（morphFromStrip，
      // 横条 → 书签头交叉淡变，与窗口四分量滑行同拍）——原生窗口透明，可见
      // 运动全在 DOM 层，一帧跳变太紧促。
      const previousDock = dockRef.current;
      dockRef.current = payload.dock;
      setDockPreview(null);
      setStatusMessage('');
      if (payload.dock) {
        dockRevealGenerationRef.current += 1;
        setDockExpandHold(null);
        setIsCollapsed(false);
        if (!previousDock && payload.morphFromStrip) {
          startDockMorphToBookmark(payload.dock.side, payload.morphFromStrip);
          return;
        }
        setDockMorph(null);
        setDock(payload.dock);
        return;
      }
      setDockMorph(null);
      setDock(null);
      // 贴边 → 拖出展开：贴边前若是收起横条，正文挂载标记停在 false，
      // 不恢复的话窗口已长开、正文却永远不渲染，只剩工具栏的空白便签。
      // 不动 isCollapsed：吸附失败回滚时窗口还是横条，要保持横条 DOM。
      setShouldRenderContent(true);
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
  if (dock) {
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
        }${dockMorph ? ' note-shell--dock-morphing' : ''}${
          dockExpandHold ? ' note-shell--expand-hold' : ''
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
      {dockMorph ? (
        // 吸附 morph 的书签头叠加层：按目标尺寸钉在窗口保留角（右侧贴边钉
        // 右上、左侧钉左上），主壳淡出时它淡入。窗口全程保持横条尺寸纯平移，
        // 滑行到位后主进程一次性裁剪到这里钉的位置——裁剪区已透明，零跳变。
        // 必须是 main 的兄弟节点——放进壳里会跟着壳的淡出一起透明。
        <div
          className="dock-morph-bookmark"
          aria-hidden="true"
          style={{
            top: 0,
            [dockMorph.side === 'right' ? 'right' : 'left']: 0,
            width: dockMorph.width,
            height: dockMorph.height
          }}
        >
          <DockedNoteShell
            dock={{ side: dockMorph.side }}
            namePresentation={namePresentation}
            preloadStatus={preloadStatus}
            shellStyle={shellStyle}
          />
        </div>
      ) : null}
      {dockExpandHold ? (
        // 拖出揭示的占位书签头：钉在 expandFrom（新窗口坐标系），主壳隐身等原生
        // 窗口长开期间冒充书签头。clip 就位、壳体恢复可见的同一 commit 卸掉。
        // 右侧贴边时 expandFrom.x 大于旧窗宽，长开前这 1 帧它在屏外——窗口透明，
        // 用户看到的是「书签头不动」，而非纸面闪现。pointer-events:none 不挡拖动。
        <div
          className="dock-expand-bookmark"
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

createRoot(container).render(<App />);

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

function hexToRgba(hex: string, alpha: number): string {
  const normalizedHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_NOTE_COLOR;
  const red = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const green = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedHex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Popover surfaces ("更多"菜单、删除确认)从便签纸色向白抬升,读作同一张纸
// 上抬起的纸片,而不是贴上去的系统面板。alpha 固定高位,低透明度便签上仍可读。
function noteColorToMenuSurface(hex: string): string {
  const normalizedHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_NOTE_COLOR;
  const lift = (channel: number): number => Math.round(channel + (255 - channel) * 0.55);

  return `rgba(${lift(Number.parseInt(normalizedHex.slice(1, 3), 16))}, ${lift(
    Number.parseInt(normalizedHex.slice(3, 5), 16)
  )}, ${lift(Number.parseInt(normalizedHex.slice(5, 7), 16))}, 0.97)`;
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
