import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, screen, shell } from 'electron';
import { release as getOsRelease, arch as getOsArch, homedir } from 'node:os';
import { is } from '@electron-toolkit/utils';
import electronUpdater from 'electron-updater';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDevUserDataPath,
  shouldApplyAutoLaunchDefault,
  shouldCreateWindowOnActivate,
  shouldQuitWhenAllWindowsClosed
} from './app-lifecycle';
import {
  ensureAutoLaunchDefaultEnabled,
  getAutoLaunchStatus,
  setAutoLaunchEnabled,
  type AutoLaunchDefaultState
} from './auto-launch';
import { pasteClipboardImage } from './clipboard-image';
import { normalizeChecklistInput } from './checklist-input';
import { normalizeSaveImageInput } from './image-input';
import {
  computeResizedBounds,
  createImagePreviewWindowOptions,
  getImagePreviewMinimumSize,
  ImagePreviewController,
  type ImagePreviewSize,
  type ImagePreviewWindowPort
} from './image-preview-window';
import { IMAGE_PROTOCOL, LocalImageStorage } from './image-storage';
import { readLocalProfile } from './local-profile';
import { createNoteWindowCollapseController } from './note-window-collapse';
import { createMouseButtonMonitor, type MouseButtonMonitor } from './mouse-button-monitor';
import {
  createMacUpdateController,
  shouldEnableMacManualUpdates
} from './mac-update-controller';
import { createMacUpdateService } from './mac-update-service';
import { type ManagedNoteWindow, NotesManager } from './notes-manager';
import { preventNoteWindowNavigation } from './navigation-guard';
import type { NoteRecord, NoteBounds } from './note-state';
import { createClosePersistenceHandler, createQuitPersistenceHandler } from './persistence-lifecycle';
import {
  createReleaseFeedbackController,
  type ReleaseFeedbackController
} from './release-feedback';
import {
  createReleaseFeedbackWindowManager,
  createReleaseFeedbackWindowOptions,
  type ReleaseFeedbackWindowManager,
  type ReleaseFeedbackWindowPort
} from './release-feedback-window';
import {
  createReleaseFeedbackStateStore,
  RELEASE_FEEDBACK_STATE_FILENAME
} from './release-feedback-state';
import { JsonNotesStorage } from './storage';
import { createTray } from './tray';
import {
  createUpdateController,
  shouldEnableAutoUpdates,
  type UpdateController
} from './update-controller';
import {
  attachUpdaterRequestDiagnostics,
  createDiagnosticLogger,
  type DiagnosticLogger
} from './diagnostics';
import {
  createUpdateProgressWindowManager,
  createUpdateProgressWindowOptions,
  type UpdateProgressWindowPort
} from './update-progress-window';
import {
  NOTE_ALWAYS_ON_TOP_LEVEL,
  NOTE_COLLAPSED_HEIGHT,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_WINDOW_ICON_PATH,
  createNoteWindowOptions,
  type DisplayWorkArea
} from './window-options';
import { createDebouncedValueAction } from '../shared/debounced-action';
import {
  buildDockedBounds,
  buildExpandBoundsFromDock,
  findNearestWorkArea,
  NOTE_DOCK_HEIGHT,
  NOTE_DOCK_UNFOLD_HYSTERESIS_PX,
  NOTE_DOCK_UNFOLD_THRESHOLD_PX,
  resolveCollapsedDockSide,
  resolveDockedEdgeOffset,
  restoreDockedBounds,
  type DockSide
} from '../shared/note-dock';
import { DEFAULT_APP_COPY, getAppCopy, type AppCopy } from '../shared/app-copy';
import {
  isReleaseFeedbackRenderedPayload,
  RELEASE_FEEDBACK_CHANNELS,
  type ReleaseFeedbackSnapshot
} from '../shared/release-feedback-window';
import { UPDATE_PROGRESS_CHANNEL, type UpdateProgressSnapshot } from '../shared/update-progress';
import {
  IMAGE_PREVIEW_CHANNELS,
  isImagePreviewResizeDirection
} from '../shared/image-preview';
import { BUILT_RELEASE_NOTES } from './generated/release-notes';

let notesManager: NotesManager | undefined;
let appCopy: AppCopy = DEFAULT_APP_COPY;
let releaseFeedbackController: ReleaseFeedbackController | undefined;
let releaseFeedbackWindowManager: ReleaseFeedbackWindowManager | undefined;
let imagePreviewController: ImagePreviewController | undefined;
let restoreNotesWhenReady = false;
const AUTO_LAUNCH_DEFAULT_MARKER = '.auto-launch-default-applied';
let diagnosticLogger: DiagnosticLogger | undefined;
// 鼠标左键物理状态监视器（仅 macOS；helper 缺失或其他平台为 null，调用方
// 退回 settle watch 启发式）。原生拖动的确定性松手信号源。
let mouseButtonMonitor: MouseButtonMonitor | null = null;
let disposeUpdateRequestDiagnostics: (() => void) | undefined;

// dev 与正式版共用安装身份,默认会读写同一份 userData(同一 notes.json)。
// 开发模式提前切到独立目录,调试/删除永远碰不到正式数据;必须在
// requestSingleInstanceLock 之前,dev 与正式版才能各持各的锁、同时运行。
if (is.dev) {
  app.setPath('userData', getDevUserDataPath(app.getPath('appData')));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (notesManager) {
    notesManager.restoreClosedNotes();
    return;
  }

  restoreNotesWhenReady = true;
});

type PlatformUpdateController = Pick<UpdateController, 'checkManually' | 'checkSilently'> & {
  dispose?: () => void;
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // sandbox:true 的预览窗里 <img> 加载 protocol.handle 的流式响应需要 stream 特权,
      // 否则资源请求挂起、图片永远不触发 load(预览窗全黑但不报错)。
      stream: true
    }
  }
]);

function createElectronImagePreviewWindow(
  workArea: DisplayWorkArea,
  noteBounds: NoteBounds,
  imageSize: ImagePreviewSize
): ImagePreviewWindowPort {
  const previewWindow = new BrowserWindow(
    createImagePreviewWindowOptions(
      workArea,
      noteBounds,
      imageSize,
      join(__dirname, '../preload/imagePreviewPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(previewWindow, 'image-preview');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      previewWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      previewWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  previewWindow.on('page-title-updated', (event) => event.preventDefault());
  previewWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);

  return {
    webContentsId: previewWindow.webContents.id,
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/image-preview.html`);
      }
      return previewWindow.loadFile(join(__dirname, '../renderer/image-preview.html'));
    },
    onReady: (listener) => {
      previewWindow.webContents.once('did-finish-load', listener);
    },
    onClosed: (listener) => {
      previewWindow.once('closed', listener);
    },
    send: (snapshot) => {
      if (!previewWindow.webContents.isDestroyed()) {
        previewWindow.webContents.send(IMAGE_PREVIEW_CHANNELS.snapshot, snapshot);
      }
    },
    show: () => {
      if (!previewWindow.isDestroyed()) previewWindow.show();
    },
    focus: () => {
      if (!previewWindow.isDestroyed()) {
        if (previewWindow.isMinimized()) previewWindow.restore();
        previewWindow.focus();
      }
    },
    close: () => {
      if (!previewWindow.isDestroyed()) previewWindow.close();
    },
    destroy: () => {
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
    },
    resize: (direction, dx, dy) => {
      if (previewWindow.isDestroyed()) {
        return;
      }
      const bounds = previewWindow.getBounds();
      const currentWorkArea = screen.getDisplayMatching(bounds).workArea;
      previewWindow.setBounds(
        computeResizedBounds(
          bounds,
          direction,
          dx,
          dy,
          getImagePreviewMinimumSize(),
          { width: currentWorkArea.width, height: currentWorkArea.height }
        )
      );
    },
    move: (dx, dy) => {
      if (previewWindow.isDestroyed()) {
        return;
      }
      const bounds = previewWindow.getBounds();
      previewWindow.setBounds({
        x: bounds.x + Math.round(dx),
        y: bounds.y + Math.round(dy),
        width: bounds.width,
        height: bounds.height
      });
    }
  };
}
const NOTE_DOCK_GLIDE_DURATION_MS = 180;
// 吸附滑入比悬停探头慢一档：纯平移滑行与 DOM 交叉淡变同拍进行，320ms 让
// 形变有呼吸感（真机验收 240ms 偏紧）；探头只是几何露出，180ms 足够。
const NOTE_DOCK_IN_GLIDE_DURATION_MS = 320;
// 停歇判定（settle watch）的节奏：move 流停歇 100ms 后启动，每 60ms 查一次，
// 连续 3 拍（~180ms）「bounds 没变 + 光标位移 <3px + 光标不在抓取点上」才
// 收尾。live 信号是光标而不是 bounds：getBounds 在 move 事件被 macOS 合并的
// 间隙里是冻住的（真机日志：快速甩动间隙 >220ms，「两拍 bounds 静止」在活
// 拖拽中也成立）；而活拖拽中光标不可能连续静止。「光标在抓取点上且静止」=
// 按住不动，绝不写窗——代价是松手后手停在抓取点上会推迟到下次动鼠标才收尾
// （软失败，晚几百 ms），换来拖拽途中零写窗（抽搐/拖不出来清零）。
const NOTE_DOCK_DRAG_QUIET_MS = 100;
const NOTE_DOCK_SETTLE_POLL_MS = 60;
const NOTE_DOCK_SETTLE_TICKS = 3;
const NOTE_DOCK_SETTLE_CURSOR_STILL_PX = 3;
const NOTE_DOCK_SETTLE_GRAB_PX = 24;

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

// 180ms ease-out 滑行：只用于「没有拖拽会话争写」的时刻——悬停探头（拖动已停）
// 与松手钉回（release watch 已确认会话结束）。用户可能在滑行途中抓住书签头
// 抢拖，调用方传 shouldAbort 熔断——原生拖拽会话进行中争写 setBounds 会被吞，
// 控制器/几何脱臼（fast-drag 变形同款根因）。
function glideNoteWindowTo(
  noteWindow: BrowserWindow,
  target: { x: number; y: number; width: number; height: number },
  shouldAbort?: () => boolean,
  durationMs: number = NOTE_DOCK_GLIDE_DURATION_MS
): Promise<void> {
  const from = noteWindow.getBounds();
  // setBounds 会被最小尺寸钳住：横条 min 是 200×40，不把 min 先降到目标值，
  // 收缩帧全被钳住、滑行只剩平移，滑完尺寸才弹变。吸附失败时控制器回滚会
  // 恢复横条的 min。
  noteWindow.setMinimumSize(
    Math.min(from.width, target.width),
    Math.min(from.height, target.height)
  );
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (noteWindow.isDestroyed() || shouldAbort?.()) {
        clearInterval(timer);
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      const eased = easeOutCubic(progress);
      noteWindow.setBounds({
        x: Math.round(from.x + (target.x - from.x) * eased),
        y: Math.round(from.y + (target.y - from.y) * eased),
        width: Math.round(from.width + (target.width - from.width) * eased),
        height: Math.round(from.height + (target.height - from.height) * eased)
      });
      if (progress >= 1) {
        clearInterval(timer);
        resolve();
      }
    }, 16);
  });
}

function createElectronNoteWindow(note: NoteRecord): ManagedNoteWindow {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  // 启动恢复贴边：缝夹取后仍落在某块可见工作区内才恢复贴边，否则按
  // bounds 展开（notes-manager 会发现窗口不是 docked 并丢弃失效的 dock）。
  const restoredDockBounds = note.dock
    ? restoreDockedBounds({ dock: note.dock, workAreas })
    : undefined;
  const noteWindow = new BrowserWindow(createNoteWindowOptions(note.bounds, workAreas));
  if (restoredDockBounds) {
    // 贴边恢复不能出生即贴边：出生就是 48×32 + 不可缩放 + 整页拖窗区的窗口在
    // macOS 上收不到任何 OS 鼠标事件（实测 enter/click 全丢），先按普通窗口
    // 创建再改成贴边几何的窗口事件正常（与运行中新贴边的窗口同生命周期）。
    // 趁 show:false 尚未显示时改好矩形与约束，用户看不到中间态。
    noteWindow.setMinimumSize(restoredDockBounds.width, NOTE_DOCK_HEIGHT);
    noteWindow.setBounds(restoredDockBounds, false);
    noteWindow.setResizable(false);
  }
  observeWindowDiagnostics(noteWindow, 'note');
  const noteWebContentsId = noteWindow.webContents.id;

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      noteWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      noteWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  noteWindow.setAlwaysOnTop(true, NOTE_ALWAYS_ON_TOP_LEVEL);
  noteWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  noteWindow.once('ready-to-show', () => {
    noteWindow.show();
  });

  // 贴边恢复时把 side 同步写进 URL query：preload 读取后 renderer 首帧就渲染
  // 缝，不会先挂完整便签 DOM 再切换（getCurrentNote 回来后再以记录为准）。
  const initialDockSide = restoredDockBounds && note.dock ? note.dock.side : undefined;
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void noteWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}${initialDockSide ? `?dock=${initialDockSide}` : ''}`
    );
  } else {
    void noteWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      initialDockSide ? { query: { dock: initialDockSide } } : undefined
    );
  }

  const listenerBag: {
    boundsChanged?: () => void | Promise<void>;
  } = {};
  const saveBounds = createDebouncedValueAction<void>(() => {
    return listenerBag.boundsChanged?.();
  }, 300);
  const collapseController = createNoteWindowCollapseController({
    window: noteWindow,
    getWorkAreas: () => screen.getAllDisplays().map((display) => display.workArea)
  });
  if (restoredDockBounds && note.dock) {
    collapseController.applyRestoredDock(
      { side: note.dock.side, y: restoredDockBounds.y },
      {
        x: note.bounds.x ?? restoredDockBounds.x,
        y: note.bounds.y ?? restoredDockBounds.y,
        width: Math.max(NOTE_MIN_WIDTH, note.bounds.width),
        height: Math.max(NOTE_MIN_HEIGHT, note.bounds.height)
      }
    );
  }

  // 磁吸贴边：收起横条与贴边书签头都走原生 -webkit-app-region 拖窗（与展开
  // 态同一套，不存在自定义拖窗的跟手损耗）。**松手才吸附**：拖动全程主进程
  // 不写窗口（唯一例外是贴边拖离 ≥48px 的一次性展开，已过验），横条/书签头
  // 全程原生跟手——原生拖拽会话进行中任何写窗都两头坏（写中 = 位置被重置、
  // 位移攒不到阈值；吞一半 = 抽搐），「停歇≈松手」的 settle 模型两轮被否的
  // 根因就是按住不动同样停歇。吸附（横条探出缘 ≥8px）与钉回（书签头未过
  // 阈值）都等 release watch 确认真松手后才一次性落位。
  let isMagneticTransitionInFlight = false;
  // 滑行/展开会话的代际令牌：每次启动新会话（吸附/钉回/探头滑行、展开）+1，
  // 熔断（走廊/按键抢先）也 +1。旧会话迟到的 finally 带旧代际，finish 直接
  // 丢弃——否则旧 finally 会把新会话的 peekGlide/inFlight 清掉（共享布尔竞态，
  // 双 reviewer 实锤）。
  let transitionEpoch = 0;
  // 悬停探头的 enter/leave 是一次性事件：触发若撞上吸附/展开/探头滑行
  // （inFlight）会被丢掉，滑行结束光标还停在书签头上就卡在不露的状态。
  // 记下「期间来过触发」，滑行收尾时补一次 reconcile——真实悬停由光标
  // 查询决定，补发不会误露。
  let dockPeekReconcilePending = false;
  // 悬停探头滑行的熔断与走廊：用户在探头滑行途中抓住书签头拖动时，第一帧
  // 偏离滑行走廊的 move 就熔断滑行、把几何交还给拖拽——原生拖拽会话进行中
  // 争写 setBounds 会被吞，控制器/几何/ DOM 三方脱臼（fast-drag 变形同款根因）。
  // 走廊 y 给区间而不是单点：钉回滑行的 y 会变（拖离后的 y 夹回工作区），
  // 只盯单点会把滑行自己的帧误判成抢拖。
  let peekGlide: {
    fromX: number;
    toX: number;
    fromY: number;
    toY: number;
    aborted: boolean;
  } | null = null;
  // leave 丢失的兜底：OS 在应用非激活时投递的 mouseleave 不是 100% 可靠（实测
  // 快速甩出、贴屏边滑走会丢），丢了书签头就永远卡在露出。露出期间每 120ms
  // 做一次一次性光标查询复核「光标还在不在窗内」，不在就走与 leave 相同的
  // 收缩路径（reconcile 内部仍以光标真相为准）。只读光标位置、不逐帧驱动窗口，
  // 与红线「轮询跟光标拖窗」无关；缩回半藏、展开、拖出、关窗即停。
  let peekLingerTimer: NodeJS.Timeout | null = null;
  const stopPeekLinger = (): void => {
    if (peekLingerTimer !== null) {
      clearInterval(peekLingerTimer);
      peekLingerTimer = null;
    }
  };
  const ensurePeekLinger = (): void => {
    if (peekLingerTimer !== null) {
      return;
    }
    peekLingerTimer = setInterval(() => {
      if (noteWindow.isDestroyed() || collapseController.getPresentation() !== 'docked') {
        stopPeekLinger();
        return;
      }
      // 滑行途中不打断：收尾的 reconcile 会用光标真相复核。
      if (isMagneticTransitionInFlight) {
        return;
      }
      // 拖动/停歇比对进行中不开火：此时写窗会撞上活拖拽会话（与 reconcile
      // 入口的守卫同一理由）。
      if (dragQuietTimer !== null || settleWatchTimer !== null) {
        return;
      }
      const current = noteWindow.getBounds();
      const point = screen.getCursorScreenPoint();
      const inside =
        point.x >= current.x &&
        point.x < current.x + current.width &&
        point.y >= current.y &&
        point.y < current.y + current.height;
      if (!inside) {
        void reconcileDockPeekHover();
      }
    }, 120);
  };
  // 停歇判定（settle watch）：macOS 没有拖动结束事件，「move 停歇」也不等于
  // 松手（按住不动同样停歇，此时写窗 = 拖拽会话被破坏 = 抽搐/拖不出来，
  // settle 模型两轮被否的根因）。bounds 静止也不能当松手证据：getBounds 在
  // move 事件被合并的间隙里是冻住的（真机日志：快速甩动间隙 >220ms）。
  // 权威信号是物理按键状态（helper 在时）：按着 = 绝不收尾；松开 = 直接武装
  // watch（跳过光标检查，bounds 静止比对等尾部冲刷）。helper 缺席/死亡时退回
  // 纯光标判据：连续 3 拍「bounds 没变 + 光标停稳 + 光标不在抓取点上」。
  // move 流停 100ms 后若窗口停在待吸附/待钉回姿势，启动 60ms 停稳比对。
  // 「松手后立刻重新抓住拖动」的竞态由新拖拽的 move 先到并取消比对兜住。
  // 只读光标位置、不逐帧写窗，与红线「轮询跟光标拖窗」无关。
  let dragQuietTimer: NodeJS.Timeout | null = null;
  let grabOffset: { x: number; y: number } | null = null;
  let settleWatchTimer: NodeJS.Timeout | null = null;
  // 吸附滑行被抢拖熔断后，窗口已是书签头尺寸+书签头 DOM 但 presentation 仍是
  // collapsed：记下熔断前的横条矩形，等这次拖拽真结束（settle 确认）且没停进
  // 吸附区时恢复成横条。恢复必须等拖拽结束——拖拽途中写窗 = 抽搐/拖不出来。
  let pendingStripRestore: { x: number; y: number; width: number; height: number } | null = null;
  // 拖动中预览（松手贴边的承诺）：横条进入吸附区时只发 IPC 状态给 renderer
  // 显示提示，不写窗；离开吸附区或吸附落定时清除。
  let dockPreviewSide: DockSide | null = null;
  const stopDragQuiet = (): void => {
    if (dragQuietTimer !== null) {
      clearTimeout(dragQuietTimer);
      dragQuietTimer = null;
    }
  };
  const cancelSettleWatch = (): void => {
    if (settleWatchTimer !== null) {
      clearInterval(settleWatchTimer);
      settleWatchTimer = null;
    }
  };
  const scheduleDragQuiet = (): void => {
    stopDragQuiet();
    dragQuietTimer = setTimeout(onDragQuiet, NOTE_DOCK_DRAG_QUIET_MS);
  };
  const recordGrabPoint = (current: { x: number; y: number; width: number; height: number }): void => {
    // 光标不在窗内 = 非拖动 move（系统拉回、程序化写窗），不更新抓取点。
    const cursor = screen.getCursorScreenPoint();
    const inside =
      cursor.x >= current.x &&
      cursor.x < current.x + current.width &&
      cursor.y >= current.y &&
      cursor.y < current.y + current.height;
    if (inside) {
      grabOffset = { x: cursor.x - current.x, y: cursor.y - current.y };
    }
  };
  // 「光标还在抓取点上」= 拖拽会话可能还活着（按住不动）：bounds 正常时光标
  // 被原生拖动钉在抓取点，停顿时尾部 move 会冲刷到位。无抓取记录时（系统
  // 动窗等非拖拽路径）退化为「光标在窗内」——同样无法区分按住/停放，不收尾。
  const isCursorOnGrab = (
    bounds: { x: number; y: number; width: number; height: number },
    cursor: { x: number; y: number }
  ): boolean => {
    if (grabOffset) {
      return (
        Math.abs(cursor.x - (bounds.x + grabOffset.x)) <= NOTE_DOCK_SETTLE_GRAB_PX &&
        Math.abs(cursor.y - (bounds.y + grabOffset.y)) <= NOTE_DOCK_SETTLE_GRAB_PX
      );
    }
    return (
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height
    );
  };
  // 统一收尾入口：kind 'dock' = 横条停进吸附区等吸附；'docked' = 书签头拖完
  // 等惰性钉回/悬停复核。确认逻辑完全相同，只有收尾动作不同。
  // ignoreCursor（仅物理松手路径使用）：按键监视器已给出确定性松手，跳过
  // 光标停稳/抓取点检查——松手后继续动鼠标不该拖慢吸附；bounds 静止比对
  // 仍然保留，用来等尾部 move 把 getBounds 冲刷到最终位置（迟到 move 会
  // 取消并重排，不猜固定延迟）。
  const armSettleWatch = (
    kind: 'dock' | 'docked',
    options?: { ignoreCursor?: boolean }
  ): void => {
    cancelSettleWatch();
    let lastBounds = noteWindow.getBounds();
    let lastCursor = screen.getCursorScreenPoint();
    let stillTicks = 0;
    settleWatchTimer = setInterval(() => {
      if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
        cancelSettleWatch();
        return;
      }
      if (mouseButtonMonitor?.isDown()) {
        // 物理按键还按着 = 拖拽会话确定活着：任何几何/光标观测都可能是
        // 合并间隙的假象（bounds 冻结 + 光标静止的同构误伤在这道护栏下
        // 不可能成立），绝不累积收尾。helper 缺席/死亡的平台无此护栏，退回
        // 纯光标停稳判据（isActive 假阴性防护见 isCursorOnGrab 处）。
        stillTicks = 0;
        return;
      }
      const bounds = noteWindow.getBounds();
      const boundsMoved =
        bounds.x !== lastBounds.x ||
        bounds.y !== lastBounds.y ||
        bounds.width !== lastBounds.width ||
        bounds.height !== lastBounds.height;
      lastBounds = bounds;
      if (boundsMoved) {
        // 窗口在动 = 拖拽会话还活着（或系统在动窗）：整个比对作废（下一次
        // quiet 会重新武装），活拖拽不该有任何收尾待定。
        cancelSettleWatch();
        return;
      }
      if (!options?.ignoreCursor) {
        const cursor = screen.getCursorScreenPoint();
        const cursorMoved =
          Math.abs(cursor.x - lastCursor.x) > NOTE_DOCK_SETTLE_CURSOR_STILL_PX ||
          Math.abs(cursor.y - lastCursor.y) > NOTE_DOCK_SETTLE_CURSOR_STILL_PX;
        lastCursor = cursor;
        if (cursorMoved) {
          // 光标还在飞：活拖拽的合并间隙或松手后的跟随动作，重新累积停稳拍数。
          stillTicks = 0;
          return;
        }
        if (mouseButtonMonitor?.isActive() !== true && isCursorOnGrab(bounds, cursor)) {
          // 按住不动：绝不写窗。这道排除只在按键监视器缺席/死亡时启用——
          // 监视器活着时 isDown 护栏是权威，「松手后手停在抓取点上」必须照常
          // 收尾（release-still），不能被这里无界挡住。
          stillTicks = 0;
          return;
        }
      }
      stillTicks += 1;
      if (stillTicks < NOTE_DOCK_SETTLE_TICKS) {
        return;
      }
      cancelSettleWatch();
      diagnosticLogger?.record('dock_settle_fire', { kind });
      // 收尾已确认，这次抓取记录消费掉，不留给下一次交互。
      grabOffset = null;
      if (kind === 'dock') {
        finalizeDockOnRelease();
      } else {
        settleDockedIdle();
      }
    }, NOTE_DOCK_SETTLE_POLL_MS);
  };
  // 松手归属证据：helper 的 release 是全局的（每个便签都收到每次左键松开），
  // 只有「这次按下时光标在本窗上」的松手才允许触发本窗收尾——否则别处的点击
  // 会撞上本窗 500ms 内的程序性 move（show 回拉等）造成误吸附/误钉回。
  let pressOnWindow = false;
  const isCursorOverWindow = (paddingPx: number): boolean => {
    const bounds = noteWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    return (
      cursor.x >= bounds.x - paddingPx &&
      cursor.x < bounds.x + bounds.width + paddingPx &&
      cursor.y >= bounds.y - paddingPx &&
      cursor.y < bounds.y + bounds.height + paddingPx
    );
  };
  const unsubscribeMouseButtons =
    mouseButtonMonitor === null
      ? []
      : [
          mouseButtonMonitor.onRelease(() => {
            // 物理松手是确定性的：不猜固定延迟等尾部 move，直接按当前姿势武装
            // settle watch——bounds 静止比对天然等冲刷到位，迟到 move 会取消
            // 重排；光标检查跳过（ignoreCursor），松手后继续动鼠标不拖慢收尾。
            // release-still（松手后手停在抓取点上）因此照常吸附/钉回。
            if (!pressOnWindow) {
              return;
            }
            pressOnWindow = false;
            cancelSettleWatch();
            stopDragQuiet();
            grabOffset = null;
            diagnosticLogger?.record('dock_button_release', {
              webContentsId: noteWebContentsId
            });
            if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
              return;
            }
            onDragQuiet(true);
          }),
          mouseButtonMonitor.onPress(() => {
            if (!isCursorOverWindow(4)) {
              return;
            }
            pressOnWindow = true;
            if (!isMagneticTransitionInFlight) {
              return;
            }
            // 过渡途中按住窗口：抢先熔断（不等第一帧 move 越出走廊），拖拽
            // 锚点不被后续 setBounds 改写。不止滑行（peekGlide）要熔断——
            // dock-in 解析 y 的 await 间隙、expand 的 undock await 间隙同样
            // 是 inFlight，bump epoch 让它们的延迟写窗/提交全部落空。
            if (peekGlide && !peekGlide.aborted) {
              peekGlide.aborted = true;
            }
            peekGlide = null;
            isMagneticTransitionInFlight = false;
            transitionEpoch += 1;
          })
        ];
  const onDragQuiet = (fromRelease = false): void => {
    dragQuietTimer = null;
    if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
      return;
    }
    const presentation = collapseController.getPresentation();
    if (presentation === 'collapsed') {
      // 横条停在吸附区（探出缘 ≥8px）：等真松手再吸，拖着不动不吸。
      const current = noteWindow.getBounds();
      const workAreas = screen.getAllDisplays().map((display) => display.workArea);
      const workArea =
        findNearestWorkArea(current, workAreas) ?? screen.getDisplayMatching(current).workArea;
      const side = resolveCollapsedDockSide(
        current,
        workArea,
        workAreas.filter((area) => area !== workArea)
      );
      if (side || pendingStripRestore !== null) {
        armSettleWatch('dock', { ignoreCursor: fromRelease });
      }
      return;
    }
    if (presentation !== 'docked') {
      return;
    }
    const dockedBounds = collapseController.getDockedBounds();
    if (!dockedBounds) {
      return;
    }
    const current = noteWindow.getBounds();
    const drifted =
      current.x !== dockedBounds.x ||
      current.y !== dockedBounds.y ||
      current.width !== dockedBounds.width ||
      current.height !== dockedBounds.height;
    // 书签头被拖离静止位（未过展开阈值）→ 等光标停稳后惰性钉回；位置没偏但
    // 有推迟的悬停扳机（拖动中被 quiet 守卫挡下的 peek 触发）→ 同样等停稳
    // 再复核。钉回不许回到「松手检测 watch」或 move 流上：竖拖途中写 x 会把
    // 水平位移吃掉（拖不出来）并撞活拖拽（抽搐）——真机日志实锤。
    if (drifted || dockPeekReconcilePending) {
      armSettleWatch('docked', { ignoreCursor: fromRelease });
    }
  };
  // 横条松手吸附：已确认拖拽会话结束（会话死了，写窗安全）。窗口保持横条
  // 尺寸纯平移滑到「书签头角与贴边矩形对齐」的位置（240ms，逐帧 resize 会
  // 抽动——每帧重排 + 逐帧阴影重算），DOM 同步交叉淡变（morphFromStrip，
  // 书签头钉在保留角），到位后由 setDocked 一次性裁掉透明区（视觉隐形）。
  // 滑行途中抢拖：走廊/按键熔断后不提交 dock，恢复义务记在 pendingStripRestore，
  // 拖拽结束若没停进吸附区恢复横条 DOM；拖回吸附区则重新走本流程。
  const finalizeDockOnRelease = (): void => {
    if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
      return;
    }
    if (collapseController.getPresentation() !== 'collapsed') {
      return;
    }
    const current = noteWindow.getBounds();
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const workArea =
      findNearestWorkArea(current, workAreas) ?? screen.getDisplayMatching(current).workArea;
    const side = resolveCollapsedDockSide(
      current,
      workArea,
      workAreas.filter((area) => area !== workArea)
    );
    if (!side) {
      // 比对期间窗口被系统动过（如 macOS 拉回屏内）：不在吸附区就不吸。
      if (pendingStripRestore !== null) {
        // 上次吸附被抢拖熔断留下的书签头残骸：拖拽已确认结束且没停进吸附区，
        // 恢复横条几何与 DOM（只写尺寸保留拖后位置）。
        const restore = pendingStripRestore;
        pendingStripRestore = null;
        const now = noteWindow.getBounds();
        noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_COLLAPSED_HEIGHT);
        noteWindow.setBounds(
          { x: now.x, y: now.y, width: restore.width, height: restore.height },
          false
        );
        noteWindow.webContents.send('sticky-notes:dock-applied', { dock: null });
        diagnosticLogger?.record('dock_abort_strip_restore', {
          webContentsId: noteWebContentsId
        });
      }
      return;
    }
    // 新一轮吸附接管窗口：上一轮的恢复义务作废（新滑行从当前书签头几何起步）。
    pendingStripRestore = null;
    const epoch = ++transitionEpoch;
    isMagneticTransitionInFlight = true;
    dockPreviewSide = null;
    void (async () => {
      try {
        const stackedY = await getNotesManager().resolveDockYForWebContents(noteWebContentsId, {
          side,
          y: current.y,
          workArea
        });
        if (noteWindow.isDestroyed()) {
          return;
        }
        if (epoch !== transitionEpoch) {
          // 解析 y 的 await 间隙被按键抢先熔断（用户已重新按住）：几何与 DOM
          // 都还没动，直接退出。
          return;
        }
        if (stackedY === undefined) {
          return;
        }
        const target = buildDockedBounds({
          side,
          y: stackedY,
          workArea,
          neighborWorkAreas: workAreas.filter((area) => area !== workArea)
        });
        // 只滑位置、不逐帧改尺寸：每帧 resize 会逼 renderer 逐帧重排壳体并让
        // macOS 逐帧重算窗口阴影（吸附滑行抽动的根因；纯平移的悬停探头同款
        // 机制就丝滑）。窗口全程保持横条尺寸，书签头 DOM 钉在将要保留的那
        // 一角（右侧贴边钉右上、左侧钉左上），横条壳同步淡出；滑到「书签头
        // 角与贴边矩形精确对齐」后由 setDocked 一次性裁掉透明/空置区——书签头
        // 已占满保留区，这一刀视觉隐形。滑行中被反抓时窗口本来就是横条尺寸，
        // 恢复路径只需切回 DOM。
        const glideTarget = {
          x: side === 'right' ? target.x + target.width - current.width : target.x,
          y: target.y,
          width: current.width,
          height: current.height
        };
        peekGlide = {
          fromX: current.x,
          toX: glideTarget.x,
          fromY: current.y,
          toY: glideTarget.y,
          aborted: false
        };
        const glide = peekGlide;
        noteWindow.webContents.send('sticky-notes:dock-applied', {
          dock: { side },
          morphFromStrip: { width: target.width, height: target.height }
        });
        diagnosticLogger?.record('dock_in_glide', {
          webContentsId: noteWebContentsId,
          side,
          from: { x: current.x, y: current.y },
          to: { x: glideTarget.x, y: glideTarget.y }
        });
        // 滑行期关阴影：横条比 peek 的 96×32 大得多，逐帧平移时 WindowServer
        // 逐帧重算大窗阴影（peek 不爬、吸附爬的差价就在这）；commit / 熔断 /
        // 回滚统一在 finally 恢复默认态。
        noteWindow.setHasShadow(false);
        await glideNoteWindowTo(
          noteWindow,
          glideTarget,
          () => glide.aborted,
          NOTE_DOCK_IN_GLIDE_DURATION_MS
        );
        if (noteWindow.isDestroyed()) {
          return;
        }
        if (glide.aborted || epoch !== transitionEpoch) {
          // 滑行被抢拖熔断：不提交 dock——dockNoteForWebContents 内部的
          // setDocked 会 setBounds，在活拖拽中写窗 = 拖不出来/抽搐同款根因。
          // 窗口仍是横条尺寸（滑行只动位置）、DOM 在过渡态/书签头、
          // presentation 仍 collapsed：记下熔断前的横条矩形（保留最早的，
          // 二次熔断不覆盖），拖拽结束后若没停进吸附区由 finalizeDockOnRelease
          // 恢复横条 DOM（几何幂等重写）。
          pendingStripRestore ??= current;
          return;
        }
        const didDock = await getNotesManager().dockNoteForWebContents(noteWebContentsId, {
          side,
          y: stackedY,
          workArea
        });
        if (noteWindow.isDestroyed()) {
          return;
        }
        if (!didDock) {
          // 吸附失败回滚：窗口已被控制器拨回横条，DOM 切回横条。
          noteWindow.webContents.send('sticky-notes:dock-applied', { dock: null });
          return;
        }
      } catch (error) {
        diagnosticLogger?.record('note_dock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
      } finally {
        // 滑行关掉的阴影统一恢复（commit / 熔断 / 回滚 / 提前退出都是默认态）。
        if (!noteWindow.isDestroyed()) {
          noteWindow.setHasShadow(true);
        }
        finishMagneticTransition(epoch);
      }
    })();
  };
  // 书签头惰性钉回：settle watch 确认拖拽结束（光标停稳且不在抓取点）后，
  // 180ms 滑回贴边静止位（x 钉边、y 夹进工作区）；位置没偏就只兑现推迟的
  // 悬停复核。钉回不挂独立的松手检测、不上 move 流：竖拖途中写 x 会吃掉
  // 水平位移（拖不出来）并撞活拖拽（抽搐）。滑行途中抢拖由 move 走廊熔断、
  // 几何交还拖拽（与悬停探头同一套），基线不动。
  const settleDockedIdle = (): void => {
    if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
      return;
    }
    if (collapseController.getPresentation() !== 'docked') {
      return;
    }
    const dockedBounds = collapseController.getDockedBounds();
    if (!dockedBounds) {
      return;
    }
    const current = noteWindow.getBounds();
    const workArea = findNearestWorkArea(
      current,
      screen.getAllDisplays().map((display) => display.workArea)
    );
    const minY = workArea ? workArea.y : Number.NEGATIVE_INFINITY;
    const maxY = workArea
      ? workArea.y + workArea.height - NOTE_DOCK_HEIGHT
      : Number.POSITIVE_INFINITY;
    const target = {
      x: dockedBounds.x,
      y: Math.min(Math.max(current.y, minY), Math.max(minY, maxY)),
      width: dockedBounds.width,
      height: NOTE_DOCK_HEIGHT
    };
    const drifted =
      current.x !== target.x ||
      current.y !== target.y ||
      current.width !== target.width ||
      current.height !== target.height;
    if (!drifted) {
      // 位置没偏：只兑现推迟的悬停复核（光标真相在 reconcile 里）。
      dockPeekReconcilePending = false;
      void reconcileDockPeekHover();
      return;
    }
    const epoch = ++transitionEpoch;
    peekGlide = {
      fromX: current.x,
      toX: target.x,
      fromY: current.y,
      toY: target.y,
      aborted: false
    };
    const glide = peekGlide;
    isMagneticTransitionInFlight = true;
    diagnosticLogger?.record('dock_tuck_glide', {
      webContentsId: noteWebContentsId,
      from: { x: current.x, y: current.y },
      to: { x: target.x, y: target.y }
    });
    void (async () => {
      try {
        await glideNoteWindowTo(noteWindow, target, () => glide.aborted);
        if (glide.aborted || noteWindow.isDestroyed()) {
          // 用户抢拖：基线不动，几何交还 move 流程。
          return;
        }
        await collapseController.setDocked({ kind: 'slide', y: target.y });
      } catch (error) {
        diagnosticLogger?.record('note_dock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
      } finally {
        finishMagneticTransition(epoch);
      }
    })();
  };
  const finishMagneticTransition = (epoch: number): void => {
    // 旧会话迟到的 finally 不许动新会话的状态：熔断后新滑行/展开可能已启动，
    // 没有这道代际守卫，旧 finally 会把新会话的 peekGlide/inFlight 清掉。
    if (epoch !== transitionEpoch) {
      return;
    }
    isMagneticTransitionInFlight = false;
    peekGlide = null;
    if (noteWindow.isDestroyed()) {
      dockPeekReconcilePending = false;
      stopPeekLinger();
      return;
    }
    // 贴边态的滑行收尾补一发悬停复核（enter/leave 是一次性事件，「缩回途中
    // 光标折返」等断拍靠它自愈）。能走到这说明写窗路径已完结：吸附/钉回的
    // settle 已确认拖拽结束，探头滑行由悬停触发本就不在拖拽中——直调安全。
    // 先停掉 glide 自己的 move 帧排下的 quiet（否则 reconcile 入口的守卫会
    // 把这次复核推迟一轮，吸附落到光标下的露出反馈慢 ~300ms）。若用户恰好
    // 重新抓住且 move 流在走，守卫照样会推迟。
    if (collapseController.getPresentation() === 'docked') {
      stopDragQuiet();
      dockPeekReconcilePending = false;
      void reconcileDockPeekHover();
    } else {
      dockPeekReconcilePending = false;
    }
  };
  const requestDockPeekReconcile = (): void => {
    if (isMagneticTransitionInFlight) {
      dockPeekReconcilePending = true;
      return;
    }
    void reconcileDockPeekHover();
  };

  // 悬停探头：书签头静止时半藏在屏外，光标悬上去整条 96px 滑出贴边、移开
  // 滑回半藏。renderer 的 mouseenter/leave 只是扳机；真实悬停判定用一次性
  // 光标查询（红线是轮询跟光标，单次查询合法），所以迟到的 leave、滑行中
  // 光标折返都自愈。藏与露只是窗口几何，不搬 DOM。
  const reconcileDockPeekHover = async (): Promise<void> => {
    if (isMagneticTransitionInFlight || noteWindow.isDestroyed()) {
      return;
    }
    const presentationNow = collapseController.getPresentation();
    if (presentationNow !== 'docked') {
      // 吸附滑行/持久化进行中 presentation 仍是 collapsed：这次悬停不该丢，
      // 记下触发，吸附收尾时补一发 reconcile。
      if (presentationNow === 'collapsed') {
        dockPeekReconcilePending = true;
      }
      return;
    }
    const side = collapseController.getDockForPersistence()?.side;
    const dockedBounds = collapseController.getDockedBounds();
    if (!side || !dockedBounds) {
      return;
    }

    // 拖动/停歇比对进行中（move 流在刷新 quiet 计时，或 settle watch 在等
    // 光标停稳）不演探头滑行：多帧写入会撞上原生拖拽会话，与钉边同款三方
    // 脱臼。记下扳机，停稳收尾用光标真相统一复核。
    if (dragQuietTimer !== null || settleWatchTimer !== null) {
      dockPeekReconcilePending = true;
      return;
    }
    // 物理按键已按住 = 用户正要拖，move 可能还没流第一帧（quiet 计时未武装、
    // 上面的护栏全落空）：绝不发起探头滑行。吸附落位后 ~280ms morph 切 DOM
    // 会补发一记 mouseenter，「刚吸附马上拖出来」的按下正好落进这个空档——
    // 此时起滑行 = 多帧写窗撞原生拖拽会话 = 拖不出来。记下扳机，拖拽收尾
    // （settle watch / release quiet）会用光标真相补复核。
    if (mouseButtonMonitor?.isDown()) {
      dockPeekReconcilePending = true;
      return;
    }

    const bounds = noteWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const hovered =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height;
    const peekWorkAreas = screen.getAllDisplays().map((display) => display.workArea);
    const peekWorkArea =
      findNearestWorkArea(bounds, peekWorkAreas) ?? screen.getDisplayMatching(bounds).workArea;
    const target = buildDockedBounds({
      side,
      y: bounds.y,
      workArea: peekWorkArea,
      neighborWorkAreas: peekWorkAreas.filter((area) => area !== peekWorkArea),
      reveal: hovered
    });

    if (target.x === dockedBounds.x && target.width === dockedBounds.width) {
      // 姿势没变：露出且光标在窗内 → 保持兜底轮询；半藏 → 确保已停。
      if (hovered) {
        ensurePeekLinger();
      } else {
        stopPeekLinger();
      }
      return;
    }

    const epoch = ++transitionEpoch;
    peekGlide = {
      fromX: dockedBounds.x,
      toX: target.x,
      fromY: dockedBounds.y,
      toY: target.y,
      aborted: false
    };
    const glide = peekGlide;
    isMagneticTransitionInFlight = true;
    diagnosticLogger?.record('dock_peek_glide', {
      webContentsId: noteWebContentsId,
      reveal: hovered
    });
    try {
      await glideNoteWindowTo(noteWindow, target, () => glide.aborted);
      if (glide.aborted) {
        // 用户抢拖：基线不动，几何交还 move 流程。
        return;
      }
      if (noteWindow.isDestroyed()) {
        return;
      }
      await collapseController.setDocked({ kind: 'peek', bounds: target });
      // 露出落地后才开始兜底轮询（leave 丢失只在露出时会卡死）；缩回半藏即停。
      if (hovered) {
        ensurePeekLinger();
      } else {
        stopPeekLinger();
      }
    } catch (error) {
      diagnosticLogger?.record('note_dock_peek_failed', {
        webContentsId: noteWebContentsId,
        error
      });
    } finally {
      finishMagneticTransition(epoch);
    }
  };
  noteWindow.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'sticky-notes:dock-peek') {
      requestDockPeekReconcile();
    }
  });

  noteWindow.on('move', () => {
    if (noteWindow.isDestroyed()) {
      return;
    }
    if (isMagneticTransitionInFlight) {
      // 探头/钉回/吸附滑行途中用户抓住窗口抢拖：窗口被拖出滑行走廊的第一帧就
      // 熔断滑行并放行本次 move（交还几何）；走廊内的 move 都是滑行自己的帧。
      // 吸附滑行时 presentation 仍是 collapsed（落位才翻转），所以走廊判定
      // 不限 presentation。
      if (peekGlide) {
        const current = noteWindow.getBounds();
        const corridorMinX = Math.min(peekGlide.fromX, peekGlide.toX) - 2;
        const corridorMaxX = Math.max(peekGlide.fromX, peekGlide.toX) + 2;
        const corridorMinY = Math.min(peekGlide.fromY, peekGlide.toY) - 2;
        const corridorMaxY = Math.max(peekGlide.fromY, peekGlide.toY) + 2;
        if (
          current.y < corridorMinY ||
          current.y > corridorMaxY ||
          current.x < corridorMinX ||
          current.x > corridorMaxX
        ) {
          peekGlide.aborted = true;
          isMagneticTransitionInFlight = false;
          peekGlide = null;
          transitionEpoch += 1;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    // 任何 move = 几何还在动（拖拽或系统写窗）：取消停稳比对、重排停歇计时。
    cancelSettleWatch();
    scheduleDragQuiet();

    const presentation = collapseController.getPresentation();

    if (presentation === 'collapsed') {
      // 松手才吸附：拖动全程不写窗，横条跟手自由拖（拖过屏边也不动它）——
      // 吸附 teleport 在拖动途中触发（用例 1「突然跳过去」）就是在这里被否的。
      // 只记抓取点供松手判定；吸附由停歇后的 release watch 确认松手再触发。
      const current = noteWindow.getBounds();
      recordGrabPoint(current);
      // 拖动中预览（学 Windows Snap 的承诺）：横条进入吸附区就告诉 renderer
      // 显示「松手贴边」提示、离开就清除——只发 IPC 状态，不写窗，安全。
      const workAreas = screen.getAllDisplays().map((display) => display.workArea);
      const workArea =
        findNearestWorkArea(current, workAreas) ?? screen.getDisplayMatching(current).workArea;
      const previewSide =
        resolveCollapsedDockSide(
          current,
          workArea,
          workAreas.filter((area) => area !== workArea)
        ) ?? null;
      if (previewSide !== dockPreviewSide) {
        dockPreviewSide = previewSide;
        noteWindow.webContents.send('sticky-notes:dock-preview', { side: previewSide });
      }
      return;
    }

    if (presentation !== 'docked') {
      return;
    }

    const side = collapseController.getDockForPersistence()?.side;
    const dockedBounds = collapseController.getDockedBounds();

    if (!side || !dockedBounds) {
      return;
    }

    const current = noteWindow.getBounds();

    const offset = resolveDockedEdgeOffset({ side, current, dockedX: dockedBounds.x });
    if (offset < NOTE_DOCK_UNFOLD_THRESHOLD_PX) {
      // 未过展开阈值：不写窗、不钉回——move 流上写窗会与原生拖拽会话争用
      // （写中 = x 每帧被重置、位移永远攒不到 48px 阈值 = 拖不出来；吞一半 =
      // 抽搐）。窗口跟手自由拖，钉回是惰性的：停歇后由 settle watch 确认光标
      // 停稳再滑回。
      recordGrabPoint(current);
      return;
    }

    // 沿边上下拖的手抖回差：x 偏移 48~72px 一律视为竖拖带出的横向抖动——
    // 不写窗（跟手拖着），松手后照常滑回钉边；明确向外拉超过 72px 才展开。
    // 纯位置判定，不看光标：getBounds 滞后一帧时任何光标闸门都会误伤快拖。
    if (offset < NOTE_DOCK_UNFOLD_HYSTERESIS_PX) {
      recordGrabPoint(current);
      return;
    }

    // 过回差带 = 明确的「向外拉离」，无条件展开。move 流上不再设「系统动窗
    // 钉回」闸门：它依赖拖动早期 stay 帧记到抓取点，而 recordGrabPoint 会被
    // getBounds 滞后坑掉；一旦误钉一次，窗口被写回贴边、用户还按着光标已在
    // 几百像素外，此后每帧 offset 直接过阈值、永远记不到抓取点 = 每帧钉回
    // 的死锁（真机日志实锤：拖出 200~400px 仍被反复钉回 = 完全拖不出来）。
    // 唯一已知的系统动窗是 show 时 macOS 把半藏窗拉回屏内，恰好 48px，落在
    // 回差带内不写窗，之后由 quiet → settle watch（无抓取记录时退化为「光标
    // 在窗外才累积」）自愈滑回。
    grabOffset = null;

    const workArea = screen.getDisplayMatching(current).workArea;
    const persistedBounds = collapseController.getBoundsForPersistence();
    const bounds = buildExpandBoundsFromDock({
      side,
      sliver: current,
      expandedSize: { width: persistedBounds.width, height: persistedBounds.height },
      workArea
    });

    const epoch = ++transitionEpoch;
    peekGlide = null;
    isMagneticTransitionInFlight = true;
    diagnosticLogger?.record('dock_expand', { webContentsId: noteWebContentsId });
    // 展开同样先切 DOM：完整便签 DOM 先就位、窗口再长开，避免大窗口里只剩
    // 一枚书签头的透明空白节拍；持久化在后台完成。expandFrom 把书签头在新
    // 窗口坐标系内的矩形交给 renderer：纸面从书签头位置 clip 揭示展开
    // （原生 setBounds 一帧到位改不了——活拖拽中多帧写窗是红线——但窗口
    // 透明，可见的运动轨迹由 DOM 层演）。
    // 长开期间先关阴影：96×32 → 完整纸面的一帧里 WindowServer 要为大透明窗
    // 一次分配 backing store 并重算阴影，这帧卡顿正是「掉帧感」来源；揭示
    // 动画（340ms）结束后恢复。恢复必须绑 epoch：380ms 内用户已重新贴边时，
    // 吸附滑行会再次关阴影，迟到的旧定时器若在滑行中途把阴影打开，正好打回
    // 「横条滑行逐帧重算阴影」（Grok review 指出的串台）；新会话的 finally
    // 会负责恢复，旧定时器跳过不丢恢复。
    noteWindow.setHasShadow(false);
    const shadowRestoreEpoch = epoch;
    setTimeout(() => {
      if (!noteWindow.isDestroyed() && shadowRestoreEpoch === transitionEpoch) {
        noteWindow.setHasShadow(true);
      }
    }, 380);
    noteWindow.webContents.send('sticky-notes:dock-applied', {
      dock: null,
      expandFrom: {
        x: current.x - bounds.x,
        y: current.y - bounds.y,
        width: current.width,
        height: current.height
      }
    });
    void getNotesManager()
      .undockNoteForWebContents(noteWebContentsId, bounds)
      .then((didUndock) => {
        if (noteWindow.isDestroyed() || epoch !== transitionEpoch) {
          // 窗口销毁，或 undock await 间隙被按键熔断/新会话接管：校验补写会
          // 撞上用户正在进行的拖拽，跳过（回滚同理不许写）。
          return;
        }
        if (!didUndock) {
          // 展开失败回滚：窗口仍是贴边书签头，DOM 切回书签头。
          noteWindow.webContents.send('sticky-notes:dock-applied', { dock: { side } });
          return;
        }
        // 原生拖动进行中尺寸写入偶尔被拖拽会话吞掉（窗口没长大、DOM 已展开
        // = 变形）。校验实际矩形，不符就补写一次。
        const actual = noteWindow.getBounds();
        if (actual.width !== bounds.width || actual.height !== bounds.height) {
          noteWindow.setBounds(bounds, false);
        }
      })
      .catch((error) => {
        diagnosticLogger?.record('note_undock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
      })
      .finally(() => {
        finishMagneticTransition(epoch);
      });
  });
  const flushPendingChanges = async (): Promise<void> => {
    await Promise.all([saveBounds.flush(), flushRendererPendingContent(noteWindow)]);
  };
  const closeAfterFlush = createClosePersistenceHandler({
    flush: flushPendingChanges,
    close: () => {
      noteWindow.close();
    }
  });

  noteWindow.on('close', closeAfterFlush);
  noteWindow.on('closed', () => {
    stopPeekLinger();
    stopDragQuiet();
    cancelSettleWatch();
    for (const unsubscribe of unsubscribeMouseButtons) {
      unsubscribe();
    }
    imagePreviewController?.handleSourceClosed(noteWebContentsId);
  });

  return {
    webContentsId: noteWindow.webContents.id,
    getBounds: collapseController.getBoundsForPersistence,
    onBoundsChanged: (listener) => {
      listenerBag.boundsChanged = listener;
      noteWindow.on('move', () => saveBounds.schedule(undefined));
      noteWindow.on('resize', () => saveBounds.schedule(undefined));
      noteWindow.on('close', () => {
        void saveBounds.flush();
      });
    },
    onClose: (listener) => {
      noteWindow.on('closed', listener);
    },
    flushPendingChanges,
    show: () => {
      if (noteWindow.isMinimized()) {
        noteWindow.restore();
      }
      noteWindow.show();
    },
    focus: () => {
      if (!noteWindow.isDestroyed()) {
        noteWindow.focus();
      }
    },
    setTitle: (title) => {
      noteWindow.setTitle(title);
    },
    setCollapsed: collapseController.setCollapsed,
    setDocked: collapseController.setDocked,
    getPresentation: collapseController.getPresentation,
    getDockForPersistence: collapseController.getDockForPersistence,
    close: () => {
      noteWindow.close();
    }
  };
}

function createElectronUpdateProgressWindow(): UpdateProgressWindowPort {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const progressWindow = new BrowserWindow(
    createUpdateProgressWindowOptions(
      workArea,
      join(__dirname, '../preload/updateProgressPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(progressWindow, 'update-progress');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      progressWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      progressWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  progressWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return {
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return progressWindow.loadURL(
          `${process.env.ELECTRON_RENDERER_URL}/update-progress.html`
        );
      }
      return progressWindow.loadFile(join(__dirname, '../renderer/update-progress.html'));
    },
    onReady: (listener) => {
      progressWindow.webContents.once('did-finish-load', listener);
    },
    onClosed: (listener) => {
      progressWindow.once('closed', listener);
    },
    send: (snapshot: UpdateProgressSnapshot) => {
      if (!progressWindow.webContents.isDestroyed()) {
        progressWindow.webContents.send(UPDATE_PROGRESS_CHANNEL, snapshot);
      }
    },
    setProgressBar: (progress) => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.setProgressBar(progress);
      }
    },
    show: () => {
      if (progressWindow.isDestroyed()) {
        return;
      }
      if (progressWindow.isMinimized()) {
        progressWindow.restore();
      }
      progressWindow.show();
    },
    focus: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.focus();
      }
    },
    close: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.destroy();
      }
    },
    destroy: () => {
      if (!progressWindow.isDestroyed()) {
        progressWindow.destroy();
      }
    }
  };
}

function createElectronReleaseFeedbackWindow(): ReleaseFeedbackWindowPort {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const releaseFeedbackWindow = new BrowserWindow(
    createReleaseFeedbackWindowOptions(
      workArea,
      join(__dirname, '../preload/releaseFeedbackPreload.cjs'),
      NOTE_WINDOW_ICON_PATH
    )
  );
  observeWindowDiagnostics(releaseFeedbackWindow, 'release-feedback');

  preventNoteWindowNavigation({
    onWillNavigate: (listener) => {
      releaseFeedbackWindow.webContents.on('will-navigate', listener);
    },
    onWillFrameNavigate: (listener) => {
      releaseFeedbackWindow.webContents.on('will-frame-navigate', listener);
    }
  });
  releaseFeedbackWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  releaseFeedbackWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  return {
    webContentsId: releaseFeedbackWindow.webContents.id,
    workArea,
    load: () => {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        return releaseFeedbackWindow.loadURL(
          `${process.env.ELECTRON_RENDERER_URL}/release-feedback.html`
        );
      }
      return releaseFeedbackWindow.loadFile(
        join(__dirname, '../renderer/release-feedback.html')
      );
    },
    onReady: (listener) => {
      releaseFeedbackWindow.webContents.once('did-finish-load', listener);
    },
    onShow: (listener) => {
      releaseFeedbackWindow.once('show', listener);
    },
    onClosed: (listener) => {
      releaseFeedbackWindow.once('closed', listener);
    },
    send: (snapshot: ReleaseFeedbackSnapshot) => {
      if (!releaseFeedbackWindow.webContents.isDestroyed()) {
        releaseFeedbackWindow.webContents.send(
          RELEASE_FEEDBACK_CHANNELS.snapshot,
          snapshot
        );
      }
    },
    getChromeHeight: () => {
      if (releaseFeedbackWindow.isDestroyed()) {
        return 0;
      }
      return Math.max(
        0,
        releaseFeedbackWindow.getBounds().height -
          releaseFeedbackWindow.getContentBounds().height
      );
    },
    setBounds: (bounds) => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.setBounds(bounds, false);
      }
    },
    show: () => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.show();
      }
    },
    focus: () => {
      if (releaseFeedbackWindow.isDestroyed() || !releaseFeedbackWindow.isVisible()) {
        return;
      }
      if (releaseFeedbackWindow.isMinimized()) {
        releaseFeedbackWindow.restore();
      }
      releaseFeedbackWindow.focus();
    },
    destroy: () => {
      if (!releaseFeedbackWindow.isDestroyed()) {
        releaseFeedbackWindow.destroy();
      }
    }
  };
}

function getNotesManager(): NotesManager {
  if (!notesManager) {
    throw new Error('Notes manager is not ready');
  }

  return notesManager;
}

function registerIpcHandlers(): void {
  ipcMain.on(RELEASE_FEEDBACK_CHANNELS.rendered, (event, value: unknown) => {
    if (
      !releaseFeedbackWindowManager ||
      !releaseFeedbackWindowManager.isCurrentSender(event.sender.id) ||
      !isReleaseFeedbackRenderedPayload(value)
    ) {
      return;
    }

    releaseFeedbackWindowManager.reportRendered(event.sender.id, value);
  });

  ipcMain.on(RELEASE_FEEDBACK_CHANNELS.dismiss, (event) => {
    if (!releaseFeedbackWindowManager?.isCurrentSender(event.sender.id)) {
      return;
    }

    releaseFeedbackWindowManager.dismiss(event.sender.id);
  });

  ipcMain.handle('sticky-notes:get-app-copy', () => appCopy);

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.open, (event, imageId: unknown) => {
    if (typeof imageId !== 'string' || imageId.length === 0 || !imagePreviewController) {
      return false;
    }

    const manager = getNotesManager();
    const sourceNote = manager.getNoteForWebContents(event.sender.id);
    if (!sourceNote || !sourceNote.images.some((image) => image.id === imageId)) {
      return false;
    }

    const sourceBounds = manager.getBoundsForWebContents(event.sender.id) ?? sourceNote.bounds;
    const display =
      sourceBounds.x !== undefined && sourceBounds.y !== undefined
        ? screen.getDisplayMatching({
            x: sourceBounds.x,
            y: sourceBounds.y,
            width: sourceBounds.width,
            height: sourceBounds.height
          })
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return imagePreviewController.open(
      event.sender.id,
      sourceNote.id,
      imageId,
      display.workArea,
      sourceBounds
    );
  });

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.getSnapshot, (event) => {
    return imagePreviewController?.getSnapshotForWebContents(event.sender.id);
  });

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.close, (event) => {
    return imagePreviewController?.close(event.sender.id) ?? false;
  });

  ipcMain.handle(
    IMAGE_PREVIEW_CHANNELS.resize,
    (event, direction: unknown, dx: unknown, dy: unknown) => {
      if (
        !isImagePreviewResizeDirection(direction) ||
        typeof dx !== 'number' ||
        typeof dy !== 'number'
      ) {
        return false;
      }
      return imagePreviewController?.resize(event.sender.id, direction, dx, dy) ?? false;
    }
  );

  ipcMain.handle(IMAGE_PREVIEW_CHANNELS.move, (event, dx: unknown, dy: unknown) => {
    if (typeof dx !== 'number' || typeof dy !== 'number') {
      return false;
    }
    return imagePreviewController?.move(event.sender.id, dx, dy) ?? false;
  });

  ipcMain.handle('sticky-notes:get-current-note', (event) => {
    return getNotesManager().getNoteForWebContents(event.sender.id);
  });

  ipcMain.handle('sticky-notes:create-note', () => {
    return getNotesManager().createNote();
  });

  ipcMain.handle('sticky-notes:update-content', (event, content: unknown) => {
    if (typeof content !== 'string') {
      return undefined;
    }

    return getNotesManager().updateContentForWebContents(event.sender.id, content);
  });

  ipcMain.handle('sticky-notes:update-name', (event, name: unknown) => {
    if (typeof name !== 'string') {
      return undefined;
    }

    return getNotesManager().updateNameForWebContents(event.sender.id, name);
  });

  ipcMain.handle('sticky-notes:update-checklist', (event, checklist: unknown) => {
    const normalizedChecklist = normalizeChecklistInput(checklist);

    if (!normalizedChecklist) {
      return undefined;
    }

    return getNotesManager().updateChecklistForWebContents(event.sender.id, normalizedChecklist);
  });

  ipcMain.handle('sticky-notes:update-appearance', (event, appearance: unknown) => {
    if (!appearance || typeof appearance !== 'object') {
      return undefined;
    }

    return getNotesManager().updateAppearanceForWebContents(event.sender.id, appearance);
  });

  ipcMain.handle('sticky-notes:get-auto-launch-status', () => {
    return getAutoLaunchStatus(app);
  });

  ipcMain.handle('sticky-notes:set-auto-launch-enabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return getAutoLaunchStatus(app);
    }

    return setAutoLaunchEnabled(app, enabled);
  });

  ipcMain.handle('sticky-notes:set-collapsed', async (event, collapsed: unknown) => {
    if (typeof collapsed !== 'boolean') {
      return false;
    }

    try {
      const didUpdate = await getNotesManager().setCollapsedForWebContents(
        event.sender.id,
        collapsed
      );
      if (!didUpdate) {
        diagnosticLogger?.record('note_collapse_failed', {
          webContentsId: event.sender.id,
          collapsed,
          reason: 'window-not-found'
        });
      }
      return didUpdate;
    } catch (error) {
      diagnosticLogger?.record('note_collapse_failed', {
        webContentsId: event.sender.id,
        collapsed,
        error
      });
      return false;
    }
  });

  ipcMain.handle('sticky-notes:delete-current-note', async (event) => {
    const sourceNote = getNotesManager().getNoteForWebContents(event.sender.id);
    const deleted = await getNotesManager().deleteNoteForWebContents(event.sender.id);
    if (deleted && sourceNote) {
      imagePreviewController?.handleNoteDeleted(sourceNote.id);
    }
    return deleted;
  });

  ipcMain.handle('sticky-notes:paste-clipboard-image', (event) => {
    return pasteClipboardImage({
      clipboard,
      addImage: (input) => getNotesManager().addImageForWebContents(event.sender.id, input)
    });
  });

  ipcMain.handle('sticky-notes:add-image', (event, imageInput: unknown) => {
    const normalizedInput = normalizeSaveImageInput(imageInput);

    if (!normalizedInput) {
      return undefined;
    }

    return getNotesManager().addImageForWebContents(event.sender.id, normalizedInput);
  });

  ipcMain.handle('sticky-notes:delete-image', async (event, imageId: unknown) => {
    if (typeof imageId !== 'string' || imageId.length === 0) {
      return undefined;
    }

    const result = await getNotesManager().deleteImageForWebContents(
      event.sender.id,
      imageId
    );
    if (result.ok) {
      imagePreviewController?.handleImageDeleted(result.note.id, imageId);
    }
    return result;
  });
}

function createDiagnosticLog(userDataPath: string): DiagnosticLogger {
  const homeDirectory = homedir();
  const logger = createDiagnosticLogger({
    filePath: join(userDataPath, 'logs', 'diagnostic.log'),
    homeDirectory
  });
  logger.record('application_session_started', {
    appVersion: app.getVersion(),
    platform: process.platform,
    osRelease: getOsRelease(),
    arch: getOsArch(),
    packaged: app.isPackaged,
    userDataPath
  });
  return logger;
}

function recordDiagnosticError(event: string, error: unknown): void {
  diagnosticLogger?.record(event, { error });
}

function createDiagnosticMessageLogger(
  event: string
): (message: string, error: unknown) => void {
  return (message, error) => {
    diagnosticLogger?.record(event, { message, error });
  };
}

function registerProcessDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    recordDiagnosticError('main_uncaught_exception', error);
  });
  process.on('unhandledRejection', (reason) => {
    diagnosticLogger?.record('main_unhandled_rejection', { reason });
  });
  app.on('render-process-gone', (_event, webContents, details) => {
    diagnosticLogger?.record('renderer_process_gone', {
      webContentsId: webContents.id,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
  app.on('child-process-gone', (_event, details) => {
    diagnosticLogger?.record('child_process_gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName
    });
  });
}

function observeWindowDiagnostics(window: BrowserWindow, kind: string): void {
  const webContentsId = window.webContents.id;
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    diagnosticLogger?.record('window_load_failed', {
      kind,
      webContentsId,
      errorCode,
      errorDescription
    });
  });
  window.on('unresponsive', () => {
    diagnosticLogger?.record('window_unresponsive', { kind, webContentsId });
  });
  window.on('responsive', () => {
    diagnosticLogger?.record('window_responsive', { kind, webContentsId });
  });
}

function createAutoLaunchDefaultState(userDataPath: string): AutoLaunchDefaultState {
  const markerPath = join(userDataPath, AUTO_LAUNCH_DEFAULT_MARKER);

  return {
    hasAppliedDefault: () => existsSync(markerPath),
    markDefaultApplied: () => {
      writeFileSync(markerPath, '1', 'utf8');
    }
  };
}

function createPlatformUpdateController(): PlatformUpdateController | undefined {
  const beforeInstall = (): Promise<void> => getNotesManager().flushPendingSaves();

  if (shouldEnableAutoUpdates(process.platform, app.isPackaged)) {
    const updater = electronUpdater.autoUpdater;
    if (diagnosticLogger) {
      updater.logger = diagnosticLogger;
      disposeUpdateRequestDiagnostics = attachUpdaterRequestDiagnostics(
        updater.netSession.webRequest,
        diagnosticLogger,
        undefined,
        homedir()
      );
    }
    const progress = createUpdateProgressWindowManager({
      createWindow: createElectronUpdateProgressWindow,
      setFallbackProgress: (progressValue) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.setProgressBar(progressValue);
          }
        }
      },
      logError: createDiagnosticMessageLogger('update_progress_error')
    });
    return createUpdateController({
      updater,
      dialog,
      beforeInstall,
      progress,
      diagnostics: diagnosticLogger,
      logError: createDiagnosticMessageLogger('windows_update_error')
    });
  }

  if (shouldEnableMacManualUpdates(process.platform, app.isPackaged)) {
    return createMacUpdateController({
      currentVersion: app.getVersion(),
      dialog,
      service: createMacUpdateService({
        downloadsPath: app.getPath('downloads'),
        fetch: (input, init) => net.fetch(input, init),
        openPath: (filePath) => shell.openPath(filePath)
      }),
      beforeInstall,
      diagnostics: diagnosticLogger,
      logError: createDiagnosticMessageLogger('mac_update_error'),
      quit: () => app.quit(),
      setProgress: (progress) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.setProgressBar(progress);
          }
        }
      }
    });
  }

  return undefined;
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  const userDataPath = app.getPath('userData');
  diagnosticLogger = createDiagnosticLog(userDataPath);
  mouseButtonMonitor = createMouseButtonMonitor({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    devRoot: app.getAppPath(),
    log: (event, details) => diagnosticLogger?.record(event, details)
  });
  registerProcessDiagnostics();
  const notesPath = join(userDataPath, 'notes.json');
  const autoLaunchMarkerPath = join(userDataPath, AUTO_LAUNCH_DEFAULT_MARKER);
  const hadExistingInstallation =
    existsSync(notesPath) || existsSync(autoLaunchMarkerPath);
  releaseFeedbackWindowManager = createReleaseFeedbackWindowManager({
    createWindow: createElectronReleaseFeedbackWindow,
    logWarning: createDiagnosticMessageLogger('release_feedback_window_error')
  });
  releaseFeedbackController = createReleaseFeedbackController({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    hadExistingInstallation,
    releaseNotes: BUILT_RELEASE_NOTES,
    stateStore: createReleaseFeedbackStateStore({
      filePath: join(userDataPath, RELEASE_FEEDBACK_STATE_FILENAME),
      logWarning: createDiagnosticMessageLogger('release_feedback_state_error')
    }),
    presenter: releaseFeedbackWindowManager,
    logWarning: createDiagnosticMessageLogger('release_feedback_error')
  });
  await releaseFeedbackController.initialize();

  try {
    const localProfile = await readLocalProfile(userDataPath);
    appCopy = getAppCopy(localProfile?.displayName);
  } catch (error) {
    recordDiagnosticError('local_profile_load_failed', error);
    console.warn('Unable to load local profile', error);
  }
  const imageStorage = new LocalImageStorage(join(userDataPath, 'images'));
  protocol.handle(IMAGE_PROTOCOL, (request) => imageStorage.createImageResponse(request.url));

  notesManager = new NotesManager({
    storage: new JsonNotesStorage(notesPath, (event, error) => {
      diagnosticLogger?.record(event, { error });
    }),
    imageStorage,
    createWindow: createElectronNoteWindow
  });
  imagePreviewController = new ImagePreviewController({
    createWindow: createElectronImagePreviewWindow,
    logWarning: createDiagnosticMessageLogger('image_preview_error'),
    getSnapshot: (noteId, imageId) => {
      const note = getNotesManager().getNoteById(noteId);
      if (!note || !note.images.some((image) => image.id === imageId)) {
        return undefined;
      }
      return {
        noteId,
        images: note.images.map(({ id, src, width, height }) => ({
          id,
          src,
          width,
          height
        })),
        activeImageId: imageId
      };
    },
    focusSource: (webContentsId) => {
      getNotesManager().focusForWebContents(webContentsId);
    }
  });
  registerIpcHandlers();
  app.on(
    'before-quit',
    createQuitPersistenceHandler({
      flush: () => getNotesManager().flushPendingSaves(),
      quit: () => {
        app.exit(0);
      }
    })
  );
  await notesManager.start();
  if (restoreNotesWhenReady) {
    notesManager.restoreClosedNotes();
    restoreNotesWhenReady = false;
  }

  if (shouldApplyAutoLaunchDefault(is.dev)) {
    try {
      ensureAutoLaunchDefaultEnabled(app, createAutoLaunchDefaultState(userDataPath));
    } catch (error) {
      console.warn('Unable to apply default auto-launch setting', error);
    }
  }

  const updateController = createPlatformUpdateController();
  app.once('before-quit', () => {
    releaseFeedbackController?.beginQuit();
    imagePreviewController?.dispose();
    diagnosticLogger?.record('application_before_quit');
    // 按键监视器 helper 是独立子进程：app.exit 不会替我们杀它（stdout 不再
    // 翻转时它连 SIGPIPE 都收不到，会作为孤儿继续 8ms 轮询），退出前显式收尸。
    mouseButtonMonitor?.dispose();
    updateController?.dispose?.();
    disposeUpdateRequestDiagnostics?.();
    disposeUpdateRequestDiagnostics = undefined;
  });

  // The tray right-click menu is the single global surface for app-level
  // actions. Startup is default-enabled once on first run; after that, this
  // menu reflects and owns the user's choice.
  createTray({
    getAutoLaunchEnabled: () => getAutoLaunchStatus(app).enabled,
    setAutoLaunchEnabled: (enabled) => {
      setAutoLaunchEnabled(app, enabled);
    },
    createNote: () => {
      void getNotesManager().createNote();
    },
    restoreNotes: () => {
      getNotesManager().restoreClosedNotes();
    },
    ...(updateController
      ? {
          checkForUpdates: () => {
            void updateController.checkManually();
          }
        }
      : {}),
    currentVersion: app.getVersion(),
    showCurrentRelease: () => {
      void releaseFeedbackController?.showCurrentRelease();
    },
    quit: () => {
      app.quit();
    }
  });

  await releaseFeedbackController.showAutomaticallyIfNeeded();

  if (updateController) {
    void updateController.checkSilently();
  }

  app.on('activate', () => {
    if (shouldCreateWindowOnActivate(BrowserWindow.getAllWindows().length)) {
      void getNotesManager().createNote();
    }
  });
});

app.on('window-all-closed', () => {
  if (shouldQuitWhenAllWindowsClosed(process.platform)) {
    app.quit();
  }
});

async function flushRendererPendingContent(noteWindow: BrowserWindow): Promise<void> {
  if (noteWindow.webContents.isDestroyed()) {
    return;
  }

  await noteWindow.webContents
    .executeJavaScript(
      'Promise.resolve(globalThis.__stickyNotesFlushPendingContent?.()).then(() => undefined)',
      true
    )
    .then(() => undefined)
    .catch(() => undefined);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
