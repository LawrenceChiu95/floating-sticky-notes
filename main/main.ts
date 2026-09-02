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
import {
  applyNoteTabWindowChrome,
  createNoteTabWindowOptions,
  loadNoteTabWindow
} from './note-tab-window';
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
  resolveCollapsedDockSide,
  resolveDockedEdgeOffset,
  restoreDockedBounds,
  type DockSide
} from '../shared/note-dock';
import { DEFAULT_APP_COPY, getAppCopy, type AppCopy } from '../shared/app-copy';
import { DEFAULT_NOTE_OPACITY } from '../shared/note-appearance';
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
// 归位滑行（钉回）的距离下限：|dx|+|dy| ≤ 48px 直接落位——真机日志里大多数
// 归位只挪 0~14px（甚至 0），为零距离也演滑行就是「黏腻」。吸附没有滑行
// 了（逆揭示全程 DOM 动画），这个门槛只剩钉回在用。
const NOTE_DOCK_GLIDE_MIN_PX = 48;
// 钉回滑行的距离上限：合理钉回最多 ~72px（回差带外即展开），超出说明状态
// 已脱臼（显示器变更等）或 y 大幅夹取——长距飞行比瞬移更吓人，直接落位。
const NOTE_DOCK_TUCK_GLIDE_MAX_PX = 160;
// 停歇判定（settle watch）的节奏：move 流停歇 100ms 后启动，每 60ms 查一次。
// helper 活着时松手判定权威（isDown 护栏挡死「按住不收尾」），只需 1 拍
// bounds 静止确认尾部 move 冲刷完；helper 缺席/死亡的启发式路径要连续 3 拍
// （~180ms）「bounds 没变 + 光标位移 <3px + 光标不在抓取点上」才收尾。
// live 信号是光标而不是 bounds：getBounds 在 move 事件被 macOS 合并的间隙里
// 是冻住的（真机日志：快速甩动间隙 >220ms，「两拍 bounds 静止」在活拖拽中
// 也成立）；而活拖拽中光标不可能连续静止。「光标在抓取点上且静止」= 按住
// 不动，绝不写窗——代价是松手后手停在抓取点上会推迟到下次动鼠标才收尾
// （软失败，晚几百 ms），换来拖拽途中零写窗（抽搐/拖不出来清零）。
const NOTE_DOCK_DRAG_QUIET_MS = 100;
const NOTE_DOCK_SETTLE_POLL_MS = 60;
const NOTE_DOCK_SETTLE_TICKS = 3;
// helper 活着时的停稳拍数：松手已由按键监视器权威判定，3 拍启发式保险没有
// 意义——1 拍（60ms）只为确认拖拽尾部 move 已把 getBounds 冲刷到最终位置
// （迟到 move 仍会取消比对、经 quiet 重排）。松手到吸附事务启动的体感延迟因此
// 从 ~180ms 降到 ~60ms。
const NOTE_DOCK_SETTLE_TICKS_AFTER_RELEASE = 1;
const NOTE_DOCK_SETTLE_CURSOR_STILL_PX = 3;
const NOTE_DOCK_SETTLE_GRAB_PX = 24;
// The shrink ACK covers a 500ms geometry wait, a 300ms DOM animation and two
// paint barriers.  It needs its own budget; the 600ms control-stage default
// would abort a valid transition under ordinary renderer scheduling.
const NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS = 1_200;
// 交接双窗 alpha 对消交叉淡换：8 步 × 15ms = 120ms（窗口交接处注释）。
const NOTE_DOCK_HANDOVER_FADE_STEPS = 8;
const NOTE_DOCK_HANDOVER_FADE_STEP_MS = 15;

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
  durationMs: number = NOTE_DOCK_GLIDE_DURATION_MS,
  ease: (progress: number) => number = easeOutCubic
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
      const eased = ease(progress);
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
  // 窗口交接架构（2026-09-01）：贴边态的可见窗口是独立的恒尺寸书签头窗，
  // 便签主窗在贴边态整体隐藏保活。docked 期间的一切几何读写（peek 滑行、
  // 钉回、settle 比对、持久化取位置）都落在书签头窗上。
  let dockTabWindow: BrowserWindow | null = null;
  let dockTabReadyResolve: ((ready: boolean) => void) | null = null;
  // ready ACK 可能快于 waiter 武装（快 renderer 在 waitForDockTabReady 挂上
  // resolver 之前就 paint 完）：事件侧永远先落旗标，waiter 先查旗标再等。
  let dockTabReadyReceived = false;
  const getDockTabWindow = (): BrowserWindow | null =>
    dockTabWindow && !dockTabWindow.isDestroyed() ? dockTabWindow : null;
  const noteWindow = new BrowserWindow(createNoteWindowOptions(note.bounds, workAreas));
  // 贴边恢复时便签主窗保持隐藏（可见的是书签头窗），不再把主窗改成贴边几何——
  // 隐藏态 resize 不可见无所谓，但主窗停留展开矩形让「拖出展开」无需任何窗口
  // 尺寸变化的预热。
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
    // 贴边恢复的主窗不示出：可见表面是书签头窗。
    if (restoredDockBounds) {
      return;
    }
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
  // Native geometry is transient while a dock transaction is being painted.
  // Do not let move/resize events persist union or rollback frames; the
  // transaction commit (or the post-abort settle) is the only durable write.
  let suppressBoundsPersistence = false;
  const saveBounds = createDebouncedValueAction<void>(() => {
    if (suppressBoundsPersistence) {
      return;
    }
    return listenerBag.boundsChanged?.();
  }, 300);
  // 书签头窗：每便签一枚，首次吸附事务或启动恢复时创建。出生为普通横条
  // 尺寸（出生即 96×32 整页拖窗区的窗口在 macOS 收不到 OS 鼠标事件——主窗
  // 实测教训），调用方在 ready ACK（真实数据首帧 paint）后于隐藏态定型到
  // 书签头矩形再示出。示出后永不 resize（窗口交接不变量）。
  const createDockTabWindow = (side: DockSide): BrowserWindow => {
    const tab = new BrowserWindow(createNoteTabWindowOptions());
    const tabWebContentsId = tab.webContents.id;
    dockTabWindow = tab;
    dockTabReadyReceived = false;
    applyNoteTabWindowChrome(tab);
    observeWindowDiagnostics(tab, 'note');
    getNotesManager().attachAuxiliaryWebContents(note.id, tabWebContentsId);
    tab.on('closed', () => {
      getNotesManager().detachAuxiliaryWebContents(tabWebContentsId);
      if (dockTabWindow === tab) {
        dockTabWindow = null;
      }
    });
    tab.on('move', () => {
      handleDockWindowMove();
      saveBounds.schedule(undefined);
    });
    tab.webContents.on('ipc-message', (_event, channel) => {
      if (channel === 'sticky-notes:dock-tab-ready') {
        dockTabReadyReceived = true;
        dockTabReadyResolve?.(true);
        dockTabReadyResolve = null;
      }
      if (channel === 'sticky-notes:dock-peek') {
        requestDockPeekReconcile();
      }
    });
    loadNoteTabWindow(tab, { noteId: note.id, side });
    return tab;
  };

  // 等待书签头窗「真实数据首帧已 paint」的回执。超时/销毁返回 false，
  // 调用方必须 fail-closed（绝不在未 paint 的窗口上交接）。预算含建窗 +
  // loadFile + React 挂载，首次吸附可能撞上冷加载，用 shrink 同档预算。
  const waitForDockTabReady = (tab: BrowserWindow): Promise<boolean> =>
    new Promise((resolve) => {
      if (dockTabReadyReceived) {
        // ACK 快于 waiter 武装（事件侧已落旗标）：立即成功。
        resolve(true);
        return;
      }
      const timeout = setTimeout(() => {
        dockTabReadyResolve = null;
        resolve(false);
      }, NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS);
      dockTabReadyResolve = (ready) => {
        clearTimeout(timeout);
        resolve(ready);
      };
      tab.once('closed', () => {
        clearTimeout(timeout);
        dockTabReadyResolve = null;
        resolve(false);
      });
    });

  const collapseController = createNoteWindowCollapseController({
    window: noteWindow,
    getWorkAreas: () => screen.getAllDisplays().map((display) => display.workArea),
    // docked 态的几何读写落在书签头窗上（不存在时回退主窗，兼容旧路径）。
    getDockedWindow: () => getDockTabWindow() ?? undefined
  });
  if (restoredDockBounds && note.dock) {
    // 启动恢复贴边：书签头窗隐藏态定型到恢复矩形后示出；便签主窗保持隐藏
    // （ready-to-show 处已跳过 show）。「出生即贴边收不到事件」的规避由
    // createDockTabWindow 的出生尺寸承担。
    const tab = createDockTabWindow(note.dock.side);
    tab.setBounds(restoredDockBounds, false);
    void waitForDockTabReady(tab).then((ready) => {
      if (ready && !tab.isDestroyed()) {
        tab.showInactive();
      }
    });
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
  // Monotonic identity for renderer/native visual transactions.  Epochs guard
  // local async work; this ID crosses IPC so a late ack cannot satisfy a newer
  // transition by accident.
  let dockTransitionSequence = 0;
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
  // 悬停复核轮询（enter/leave 双兜底）：OS 投递的 enter/leave 都不是 100%
  // 可靠——leave 实测快速甩出、贴屏边滑走会丢（丢了卡死在露出）；enter 在
  // 应用非激活时只对 no-drag 面送达，书签头的 no-drag 传感条只留在朝桌面那
  // 一侧（上下沿已是可拖面），从上下沿贴屏边滑入会丢 enter。贴边态全程每
  // 120ms 用一次性光标查询比对「光标在窗内 ↔ 窗口已露出」，不一致就走与
  // enter/leave 相同的 reconcile（光标真相裁决，姿势本就一致时它是 no-op）。
  // 只读光标位置、不逐帧驱动窗口，与被否的轮询拖窗无关；离开贴边态、展开、
  // 关窗即停。
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
      const side = collapseController.getDockForPersistence()?.side;
      if (!side) {
        return;
      }
      // docked 态的可见窗口是书签头窗（窗口交接），光标比对以活动窗为准。
      const current = getDockActiveWindow().getBounds();
      const point = screen.getCursorScreenPoint();
      const inside =
        point.x >= current.x &&
        point.x < current.x + current.width &&
        point.y >= current.y &&
        point.y < current.y + current.height;
      // 当前姿势是露出还是半藏：与同一 y 的静止位矩形比对（多屏共边的 48
      // 全露回退在 buildDockedBounds 里，口径与 reconcile 一致）。
      const lingerWorkAreas = screen.getAllDisplays().map((display) => display.workArea);
      const lingerWorkArea =
        findNearestWorkArea(current, lingerWorkAreas) ??
        screen.getDisplayMatching(current).workArea;
      const rest = buildDockedBounds({
        side,
        y: current.y,
        workArea: lingerWorkArea,
        neighborWorkAreas: lingerWorkAreas.filter((area) => area !== lingerWorkArea)
      });
      const revealed = current.x !== rest.x || current.width !== rest.width;
      // 「光标在窗内」与「窗口已露出」不一致 = enter 或 leave 丢了一发，
      // 交给 reconcile 用光标真相裁决。
      if (inside !== revealed) {
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
  // 物理松手瞬间的光标：快速甩边时窗口滞后，settle fire 时光标可能已离开
  // 边缘。吸附意图以松手那一帧为准，不拿 fire 时的活光标冒充。
  let dockReleaseIntentCursor: { x: number; y: number } | null = null;
  // 吸附事务被抢拖熔断后，窗口可能仍是 union 尺寸。记下 source 横条和它在
  // union 中的偏移，等这次拖拽真结束再以当前 native 原点恢复，保证可见纸面
  // 跟着用户拖动而不被裁窗瞬移。恢复必须等拖拽结束——拖拽途中写窗会抽搐。
  type PendingStripRestore = {
    sourceBounds: { x: number; y: number; width: number; height: number };
    stripOffset: { x: number; y: number };
  };
  let pendingStripRestore: PendingStripRestore | null = null;
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
  let expandDockedNote: (
    side: DockSide,
    sliverBounds: { x: number; y: number; width: number; height: number }
  ) => void;
  const armSettleWatch = (
    kind: 'dock' | 'docked',
    options?: { ignoreCursor?: boolean }
  ): void => {
    cancelSettleWatch();
    let lastBounds = getDockActiveWindow().getBounds();
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
      const bounds = getDockActiveWindow().getBounds();
      const boundsMoved =
        bounds.x !== lastBounds.x ||
        bounds.y !== lastBounds.y ||
        bounds.width !== lastBounds.width ||
        bounds.height !== lastBounds.height;
      lastBounds = bounds;
      if (boundsMoved) {
        // 窗口在动。松手路径（按键监视器确认已抬起）绝不能按旧逻辑取消等
        // 「下一次 quiet 重新武装」——原生拖拽会话已结束，之后没有任何 move
        // 事件会再来武装：快速甩边时窗口位置滞后光标，松手后还在追赶滑行，
        // 第一拍看到 boundsMoved 就撤表 = 吸附永不触发（真机实锤 2026-09-01：
        // 连甩三次只有慢的那次吸上）。按住的活拖拽被上面的 isDown 护栏挡住
        // 到不了这里，所以走到这就是「已松手、窗还在追光标」：只重置累积，
        // 表继续 poll，等窗口停稳照常收尾。
        if (mouseButtonMonitor?.isActive() === true) {
          stillTicks = 0;
          return;
        }
        // helper 缺席/死亡的平台无法区分活拖拽与追光标，保持旧的取消语义
        // （move 流 quiet 会重新武装），不变脆。
        cancelSettleWatch();
        return;
      }
      if (!options?.ignoreCursor && mouseButtonMonitor?.isActive() !== true) {
        // 光标判据只在按键监视器缺席/死亡时启用：监视器活着时 isDown 护栏
        // 就是权威的「拖拽会话活着」，松手后光标继续动（跟随动作）不该把
        // 收尾无限推迟——真机「有时候松手要等一会儿才吸」的另一根因：迟到
        // move 把比对重排成启发式路径后，光标判据会一直被跟随动作重置。
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
        if (isCursorOnGrab(bounds, cursor)) {
          // 按住不动：绝不写窗。这道排除只在按键监视器缺席/死亡时启用——
          // 监视器活着时 isDown 护栏是权威，「松手后手停在抓取点上」必须照常
          // 收尾（release-still），不能被这里无界挡住。
          stillTicks = 0;
          return;
        }
      }
      stillTicks += 1;
      // helper 活着 = 松手判定权威：3 拍启发式保险没有意义，1 拍只为等尾部
      // move 冲刷 getBounds（迟到 move 仍取消重排）。helper 缺席/死亡
      // （Windows 回退）保持 3 拍 + 上面的光标判据，不能变脆。每拍重查
      // isActive：helper 中途死亡自动回到保险档。
      const requiredTicks =
        options?.ignoreCursor || mouseButtonMonitor?.isActive() === true
          ? NOTE_DOCK_SETTLE_TICKS_AFTER_RELEASE
          : NOTE_DOCK_SETTLE_TICKS;
      if (stillTicks < requiredTicks) {
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
    // docked 态的抓取发生在书签头窗上（窗口交接），按下归属以活动窗为准。
    const bounds = getDockActiveWindow().getBounds();
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
            // settle watch——bounds 静止比对天然等冲刷到位；快速甩边后窗口还在
            // 追光标的拍数只重置累积不撤表（松手后不会再有 move 来重新武装）；
            // 光标检查跳过（ignoreCursor），松手后继续动鼠标不拖慢收尾。
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
            dockReleaseIntentCursor = null;
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
      const cursor = screen.getCursorScreenPoint();
      if (fromRelease) {
        dockReleaseIntentCursor = cursor;
      }
      const side = resolveCollapsedDockSide(
        current,
        workArea,
        workAreas.filter((area) => area !== workArea),
        cursor
      );
      // 物理松手无条件武装：快速甩边时松手瞬间窗口还没进吸附区，也还没被
      // 光标贴边兜住；表继续 poll 等 bounds 冲刷后再由 finalize 用稳定几何
      // + 光标意图裁决。迟到 move 不得撤表（见 handleDockWindowMove）。
      if (fromRelease || side || pendingStripRestore !== null) {
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
    const current = getDockActiveWindow().getBounds();
    const drifted =
      current.x !== dockedBounds.x ||
      current.y !== dockedBounds.y ||
      current.width !== dockedBounds.width ||
      current.height !== dockedBounds.height;
    // 落点长成：过回差带的物理松手直接展开，不再先等 60ms settle 拍。窗口
    // 还在追光标、瞬时偏移不够 72px 时仍走 settle，冲刷后再由 settleDockedIdle
    // 裁决（钉回或展开）。钉回/展开都不许回到 move 流上。
    if (fromRelease) {
      const side = collapseController.getDockForPersistence()?.side;
      if (side) {
        const releaseOffset = resolveDockedEdgeOffset({
          side,
          current,
          dockedX: dockedBounds.x
        });
        if (releaseOffset >= NOTE_DOCK_UNFOLD_HYSTERESIS_PX) {
          expandDockedNote(side, current);
          return;
        }
      }
    }
    if (drifted || dockPeekReconcilePending) {
      armSettleWatch('docked', { ignoreCursor: fromRelease });
    }
  };
  type DockRendererAck = 'received' | 'timeout' | 'aborted';
  const waitForDockRendererAck = (
    channel:
      | 'sticky-notes:dock-shrink-ready'
      | 'sticky-notes:dock-shrink-union-sized'
      | 'sticky-notes:dock-shrink-finished'
      | 'sticky-notes:dock-expand-ready',
    transitionId: number,
    epoch: number,
    timeoutMs = 600
  ): Promise<DockRendererAck> =>
    new Promise((resolve) => {
      let settled = false;
      let abortPoll: NodeJS.Timeout | undefined;
      let fallback: NodeJS.Timeout | undefined;
      const finish = (result: DockRendererAck): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (abortPoll) {
          clearInterval(abortPoll);
        }
        if (fallback) {
          clearTimeout(fallback);
        }
        noteWindow.webContents.off('ipc-message', onMessage);
        resolve(result);
      };
      const onMessage = (_event: unknown, incomingChannel: string, incomingId: unknown): void => {
        if (incomingChannel === channel && incomingId === transitionId) {
          finish('received');
        }
      };
      noteWindow.webContents.on('ipc-message', onMessage);
      abortPoll = setInterval(() => {
        if (noteWindow.isDestroyed() || epoch !== transitionEpoch) {
          finish('aborted');
        }
      }, 50);
      fallback = setTimeout(() => finish('timeout'), timeoutMs);
    });
  type DockTransitionContext = {
    transitionId: number;
    epoch: number;
    side: DockSide;
    sourceBounds: { x: number; y: number; width: number; height: number };
    stripOffset: { x: number; y: number };
    unionApplied: boolean;
  };
  const recordDockTransitionStage = (
    context: DockTransitionContext,
    stage: string,
    result?: string,
    error?: unknown
  ): void => {
    diagnosticLogger?.record('dock_transition_stage', {
      webContentsId: noteWebContentsId,
      transitionId: context.transitionId,
      side: context.side,
      stage,
      ...(result ? { result } : {}),
      ...(error === undefined ? {} : { error }),
      bounds: noteWindow.isDestroyed() ? undefined : noteWindow.getBounds()
    });
  };
  const abortDockTransition = ({
    context,
    stage,
    result,
    error
  }: {
    context: DockTransitionContext;
    stage: string;
    result: string;
    error?: unknown;
  }): void => {
    if (noteWindow.isDestroyed()) {
      return;
    }
    // 交接前创建的书签头窗若还没上屏就随事务一起销毁；已上屏的（committed
    // 之后没有 abort 路径）不受影响。
    const pendingTab = getDockTabWindow();
    if (pendingTab && !pendingTab.isVisible()) {
      dockTabWindow = null;
      pendingTab.destroy();
    }
    const { sourceBounds } = context;
    // 真实按下或 epoch 已被抢拖作废时，绝不争写原生拖拽窗口；只登记恢复义务，
    // 等松手 settle 后以用户拖到的新 x/y 恢复横条尺寸。普通 timeout/error 没有
    // 活拖拽证据，立即把 controller + native 一起恢复到原 source。
    const restoreAfterDrag =
      context.epoch !== transitionEpoch || mouseButtonMonitor?.isDown() === true;
    if (restoreAfterDrag) {
      if (context.unionApplied) {
        pendingStripRestore ??= {
          sourceBounds,
          stripOffset: context.stripOffset
        };
      }
    } else {
      if (context.unionApplied) {
        collapseController.restoreCollapsed(sourceBounds);
      }
    }
    noteWindow.webContents.send('sticky-notes:dock-applied', {
      dock: null,
      transitionId: context.transitionId
    });
    recordDockTransitionStage(context, stage, result, error);
  };
  // 横条松手吸附：已确认拖拽会话结束（会话死了，写窗安全）。可见运动全在
  // DOM（吸附 = 拖出展开的逆运动）：主进程只在四个阶段边界写 native 几何，
  // 每次只改尺寸或只改原点——macOS 对同一次 resize+move 不保证视觉原子性。
  // renderer 在每个边界把同一枚纸面重钉并 paint 后才允许下一步；中间 300ms
  // 的 clip + 平移全由 DOM 完成，绝不逐帧 setBounds。native shadow 在建窗时
  // 固定关闭，窗口原生圆角也关闭，最终形状只由 CSS 决定。
  // 动画途中抢拖：物理按下熔断（epoch 轮询）后不提交 dock，DOM 回横条，恢复
  // 义务记在 pendingStripRestore，拖拽结束若没停进吸附区恢复横条几何；拖回
  // 吸附区则重新走本流程。
  const finalizeDockOnRelease = (): void => {
    if (noteWindow.isDestroyed() || isMagneticTransitionInFlight) {
      return;
    }
    if (collapseController.getPresentation() !== 'collapsed') {
      return;
    }
    let current = noteWindow.getBounds();
    let restoredPendingStrip = false;
    if (pendingStripRestore !== null) {
      // The aborted overlay stays in the union window while the user can grab
      // it again.  Once the physical release is known, restore the strip at the
      // current native origin plus its saved union offset; this preserves the
      // paper's global position instead of snapping it to a stale source point.
      const pending = pendingStripRestore;
      pendingStripRestore = null;
      const restoredBounds = {
        x: current.x + pending.stripOffset.x,
        y: current.y + pending.stripOffset.y,
        width: pending.sourceBounds.width,
        height: pending.sourceBounds.height
      };
      saveBounds.cancel();
      suppressBoundsPersistence = true;
      collapseController.restoreCollapsed(restoredBounds);
      current = noteWindow.getBounds();
      restoredPendingStrip = true;
    }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const workArea =
      findNearestWorkArea(current, workAreas) ?? screen.getDisplayMatching(current).workArea;
    const releaseCursor = dockReleaseIntentCursor;
    dockReleaseIntentCursor = null;
    const side = resolveCollapsedDockSide(
      current,
      workArea,
      workAreas.filter((area) => area !== workArea),
      releaseCursor ?? undefined
    );
    if (!side) {
      // 比对期间窗口被系统动过（如 macOS 拉回屏内）：不在吸附区就不吸。
      if (restoredPendingStrip) {
        suppressBoundsPersistence = false;
        saveBounds.cancel();
        saveBounds.schedule(undefined);
        noteWindow.webContents.send('sticky-notes:dock-applied', { dock: null });
        diagnosticLogger?.record('dock_abort_strip_restore', {
          webContentsId: noteWebContentsId
        });
      }
      return;
    }
    // 新一轮吸附接管窗口：上一轮的恢复义务已在上面归一化；本事务的 union
    // 与 target 几何都不能写入持久化。
    pendingStripRestore = null;
    saveBounds.cancel();
    suppressBoundsPersistence = true;
    const epoch = ++transitionEpoch;
    isMagneticTransitionInFlight = true;
    dockPreviewSide = null;
    void (async () => {
      let dockTransitionContext: DockTransitionContext | null = null;
      let shouldPersistCommittedDock = false;
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
        const restTarget = buildDockedBounds({
          side,
          y: stackedY,
          workArea,
          neighborWorkAreas: workAreas.filter((area) => area !== workArea)
        });
        const revealTarget = buildDockedBounds({
          side,
          y: stackedY,
          workArea,
          neighborWorkAreas: workAreas.filter((area) => area !== workArea),
          reveal: true
        });
        // 落位姿势按光标真相一次算对：光标还在书签头矩形上（刚松手很常见）就
        // 以露出姿势落位——旧版先落半藏、探头复核再反向探出 48px 的「两段动」
        // 就是真机「吸进去抽一下」的来源（日志里 dock_in_glide 后紧跟
        // dock_peek_glide reveal:true）。光标不在则落半藏：复核轮询以光标真相
        // 维持姿势，不会误探出，旧 suppress 压制状态机因此整体拆除。
        const landingCursor = screen.getCursorScreenPoint();
        const landedHovered =
          landingCursor.x >= revealTarget.x &&
          landingCursor.x < revealTarget.x + revealTarget.width &&
          landingCursor.y >= revealTarget.y &&
          landingCursor.y < revealTarget.y + revealTarget.height;
        const target = landedHovered ? revealTarget : restTarget;
        // 吸附 = 拖出展开的逆运动（2026-08-27 方案 A，真机确认「窗口在爬」不
        // 丝滑的根因是物种差异：可见运动全在 DOM，native 只在 paint 边界提交
        // 几何；macOS 的 resize+move 不是视觉原子操作，source→union 拆成「只改
        // 尺寸、paint、只改原点、paint」）。2026-09-01 窗口交接定案：落定不再
        // 有 union→target 裁窗——可见时刻改透明窗尺寸必闪（Electron 结构性缺陷，
        // 官方 issue 2017→2025 全 not_planned）——动画末帧钉在 target 全局点后，
        // 由预渲染的独立恒尺寸书签头窗同像素上屏交接，主窗随后隐藏。
        const transitionId = ++dockTransitionSequence;
        dockTransitionContext = {
          transitionId,
          epoch,
          side,
          sourceBounds: current,
          stripOffset: { x: 0, y: 0 },
          unionApplied: false
        };
        const union = {
          x: Math.min(current.x, target.x),
          y: Math.min(current.y, target.y),
          width:
            Math.max(current.x + current.width, target.x + target.width) -
            Math.min(current.x, target.x),
          height:
            Math.max(current.y + current.height, target.y + target.height) -
            Math.min(current.y, target.y)
        };
        const unionAtSource = {
          x: current.x,
          y: current.y,
          width: union.width,
          height: union.height
        };
        const shrinkFromStrip = {
          unionWidth: union.width,
          unionHeight: union.height,
          strip: {
            x: current.x - union.x,
            y: current.y - union.y,
            width: current.width,
            height: current.height
          },
          bookmark: {
            x: target.x - union.x,
            y: target.y - union.y,
            width: target.width,
            height: target.height
          }
        };
        // Register the waiter before notifying the renderer.  The transaction
        // ID is part of both the notification and ack, so an old renderer
        // callback cannot satisfy this transition.
        const readyPromise = waitForDockRendererAck(
          'sticky-notes:dock-shrink-ready',
          transitionId,
          epoch
        );
        noteWindow.webContents.send('sticky-notes:dock-applied', {
          dock: { side },
          transitionId,
          shrinkFromStrip
        });
        recordDockTransitionStage(dockTransitionContext, 'prepare-sent');
        // ready 代表 source overlay 已真正 paint，不只是 React commit。timeout 不是
        // 成功：几何尚未改变，直接 abort 回横条，绝不猜 renderer 已经准备好。
        const readyResult = await readyPromise;
        if (noteWindow.isDestroyed()) {
          return;
        }
        recordDockTransitionStage(dockTransitionContext, 'prepare-ack', readyResult);
        if (readyResult !== 'received') {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'prepare-abort',
            result: readyResult
          });
          return;
        }
        if (epoch !== transitionEpoch) {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'prepare-abort',
            result: 'aborted'
          });
          return;
        }
        // Grow the backing store without moving the source paper. A dedicated
        // paint ACK is required before changing the origin; otherwise one
        // combined setBounds reintroduces the WindowServer intermediate frame.
        const unionSizePromise = waitForDockRendererAck(
          'sticky-notes:dock-shrink-union-sized',
          transitionId,
          epoch
        );
        dockTransitionContext.unionApplied = true;
        dockTransitionContext.stripOffset = { x: 0, y: 0 };
        noteWindow.setBounds(unionAtSource, false);
        const unionSizeResult = await unionSizePromise;
        if (noteWindow.isDestroyed()) {
          return;
        }
        recordDockTransitionStage(
          dockTransitionContext,
          'union-size-ack',
          unionSizeResult
        );
        if (unionSizeResult !== 'received') {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'union-size-abort',
            result: unionSizeResult
          });
          return;
        }
        if (epoch !== transitionEpoch) {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'union-size-abort',
            result: 'aborted'
          });
          return;
        }

        // Move the already-sized window to the real union origin. Renderer
        // waits for this origin and paint before starting the visible motion.
        const shrinkPromise = waitForDockRendererAck(
          'sticky-notes:dock-shrink-finished',
          transitionId,
          epoch,
          NOTE_DOCK_SHRINK_ACK_TIMEOUT_MS
        );
        dockTransitionContext.stripOffset = {
          x: shrinkFromStrip.strip.x,
          y: shrinkFromStrip.strip.y
        };
        noteWindow.setBounds(union, false);
        diagnosticLogger?.record('dock_in_glide', {
          webContentsId: noteWebContentsId,
          side,
          from: { x: current.x, y: current.y },
          to: { x: target.x, y: target.y }
        });
        const shrinkResult = await shrinkPromise;
        if (noteWindow.isDestroyed()) {
          return;
        }
        recordDockTransitionStage(dockTransitionContext, 'animation-ack', shrinkResult);
        if (shrinkResult !== 'received') {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'animation-abort',
            result: shrinkResult
          });
          return;
        }
        if (epoch !== transitionEpoch) {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'animation-abort',
            result: 'aborted'
          });
          return;
        }
        // 窗口交接（2026-09-01 定案）：动画末帧的书签头画面已由同一枚 overlay
        // 钉在 target 全局点；书签头窗是独立恒尺寸窗口，预渲染出同像素静态画面后
        // showInactive 上屏，再隐藏便签主窗。顺序永远是「先 show 已 paint 的新窗、
        // 后 hide 旧窗」——任何时刻至少一窗在屏，不存在两窗都空的帧；两窗半透明
        // 同像素重叠会叠印变深，由下面的 alpha 对消交叉淡换压平（见注释）。
        // 全程没有可见时刻的窗口 resize（落定闪烁根因就此拆除）。
        const tab = createDockTabWindow(side);
        const tabReady = await waitForDockTabReady(tab);
        if (noteWindow.isDestroyed()) {
          return;
        }
        recordDockTransitionStage(
          dockTransitionContext,
          'tab-ready-ack',
          tabReady ? 'received' : 'timeout'
        );
        if (!tabReady || tab.isDestroyed() || epoch !== transitionEpoch) {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'tab-handover-abort',
            result: epoch !== transitionEpoch ? 'aborted' : 'timeout'
          });
          return;
        }
        // 隐藏态定型到目标矩形（隐藏 resize 不可见），上屏后永不 resize。
        tab.setBounds(target, false);
        // 撤主窗的 alpha 对消交叉淡换（2026-09-01 真机二轮）：两窗内容同像素但
        // 各自半透明（便签默认 0.94），只要存在「双方都接近满透明度」的重叠帧，
        // 合成值就从稳态 a 跳向 1-(1-a)²≈0.996；单向线性淡出也让中间拍偏离稳
        // 态——人眼看到的就是落定一瞬的浅闪（首版单向淡出只压暗未根除，真机实
        // 锤）。按合成恒等式配平：任意时刻 1-(1-a·o_tab)(1-a·o_main) ≡ a，
        // 解出 o_tab = t/(1-a(1-t))、o_main = 1-t（t: 0→1）。书签头先 0 透明
        // 度上屏（盖住 attach latency，不存在主窗先撤便签消失的帧），再两窗同
        // 步对拉到 t=1，全程桌面合成值钉死在 a，WindowServer 级改透明度不触发
        // 重绘。hide 后同一拍把主窗 alpha 恢复 1（隐藏态改 alpha 不可见）。
        const contentAlpha =
          getNotesManager().getNoteForWebContents(noteWebContentsId)?.opacity ??
          DEFAULT_NOTE_OPACITY;
        tab.setOpacity(0);
        tab.showInactive();
        for (let step = 1; step <= NOTE_DOCK_HANDOVER_FADE_STEPS; step += 1) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, NOTE_DOCK_HANDOVER_FADE_STEP_MS);
          });
          if (noteWindow.isDestroyed() || tab.isDestroyed()) {
            return;
          }
          const t = step / NOTE_DOCK_HANDOVER_FADE_STEPS;
          tab.setOpacity(t / (1 - contentAlpha * (1 - t)));
          noteWindow.setOpacity(1 - t);
        }
        noteWindow.hide();
        noteWindow.setOpacity(1);
        // The target is already painted and interactive.  Commit the controller
        // in this same turn so a re-grab is handled as a docked interaction, not
        // as a stale collapsed transaction waiting on disk I/O.  Persistence is
        // intentionally delegated to the existing serialized bounds channel.
        collapseController.commitDocked({ side, bounds: target, anchor: current });
        recordDockTransitionStage(dockTransitionContext, 'committed', 'received');
        // 这发不是旧版会和几何写窗抢跑的裸 {dock}：书签头窗已上屏、主窗已隐藏、
        // controller 已同步提交。committed 只确认逻辑态，不触发新的几何或
        // surface 交换（主窗隐藏中，overlay 冻结保留，展开时重置）。
        const committedContext = dockTransitionContext;
        dockTransitionContext = null;
        noteWindow.webContents.send('sticky-notes:dock-applied', {
          dock: { side },
          transitionId: committedContext.transitionId,
          committed: true
        });
        shouldPersistCommittedDock = true;
      } catch (error) {
        diagnosticLogger?.record('note_dock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
        if (dockTransitionContext && !noteWindow.isDestroyed()) {
          abortDockTransition({
            context: dockTransitionContext,
            stage: 'exception-abort',
            result: 'error',
            error
          });
        }
      } finally {
        // A successful transaction and a non-drag abort may release the
        // persistence gate here.  If the epoch was superseded by a real re-grab,
        // keep it closed until the pending strip restore has completed.
        if (
          (epoch === transitionEpoch || !isMagneticTransitionInFlight) &&
          pendingStripRestore === null
        ) {
          saveBounds.cancel();
          suppressBoundsPersistence = false;
          if (shouldPersistCommittedDock) {
            saveBounds.schedule(undefined);
          }
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
    const side = collapseController.getDockForPersistence()?.side;
    const dockedBounds = collapseController.getDockedBounds();
    if (!side || !dockedBounds) {
      return;
    }
    const current = getDockActiveWindow().getBounds();
    // 松手才展开：书签头最终停在回差带外（含甩上邻屏）= 明确拉离，在落点
    // 就地展开；带内（竖拖抖出的横向偏移落在这里）走下面的惰性钉回。判定
    // 只在拖拽已结束后做一次，纯位置、不看光标（getBounds 滞后一帧时任何
    // 光标闸门都会误伤快拖）。
    const releaseOffset = resolveDockedEdgeOffset({ side, current, dockedX: dockedBounds.x });
    if (releaseOffset >= NOTE_DOCK_UNFOLD_HYSTERESIS_PX) {
      expandDockedNote(side, current);
      return;
    }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const workArea =
      findNearestWorkArea(current, workAreas) ?? screen.getDisplayMatching(current).workArea;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height - NOTE_DOCK_HEIGHT;
    const clampedY = Math.min(Math.max(current.y, minY), Math.max(minY, maxY));
    // 钉回姿势按光标真相一次算对：光标还在窗上 → 露出位，不在 → 半藏静止位。
    // 旧版钉回「提交姿势」（从 peek 露出态抓走的就是露出），光标已离开时收尾
    // reconcile 还得再补一发 hide 滑行——钉回 + 缩回两段动（真机日志：跨屏
    // tuck 落地后紧跟 dock_peek_glide reveal:false），是「抽搞」的放大器。
    const tuckCursor = screen.getCursorScreenPoint();
    const tuckHovered =
      tuckCursor.x >= current.x &&
      tuckCursor.x < current.x + current.width &&
      tuckCursor.y >= current.y &&
      tuckCursor.y < current.y + current.height;
    const pose = buildDockedBounds({
      side,
      y: clampedY,
      workArea,
      neighborWorkAreas: workAreas.filter((area) => area !== workArea),
      reveal: tuckHovered
    });
    const target = {
      x: pose.x,
      y: clampedY,
      width: pose.width,
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
    isMagneticTransitionInFlight = true;
    diagnosticLogger?.record('dock_tuck_glide', {
      webContentsId: noteWebContentsId,
      from: { x: current.x, y: current.y },
      to: { x: target.x, y: target.y }
    });
    void (async () => {
      try {
        // 短距离直接落位（几 px 也滑 180ms 只剩黏腻）；超上限说明状态已脱臼
        // （显示器变更等）或 y 大幅夹取——长距飞行比瞬移更吓人，也直接落位。
        const tuckDistance =
          Math.abs(target.x - current.x) + Math.abs(target.y - current.y);
        if (tuckDistance > NOTE_DOCK_GLIDE_MIN_PX && tuckDistance <= NOTE_DOCK_TUCK_GLIDE_MAX_PX) {
          peekGlide = {
            fromX: current.x,
            toX: target.x,
            fromY: current.y,
            toY: target.y,
            aborted: false
          };
          const glide = peekGlide;
          await glideNoteWindowTo(getDockActiveWindow(), target, () => glide.aborted);
          if (glide.aborted || getDockActiveWindow().isDestroyed()) {
            // 用户抢拖：基线不动，几何交还 move 流程。
            return;
          }
        } else {
          getDockActiveWindow().setBounds(target, false);
          if (getDockActiveWindow().isDestroyed()) {
            return;
          }
        }
        await collapseController.setDocked({ kind: 'peek', bounds: target });
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
    // 把这次复核推迟一轮）。吸附/钉回的落位姿势已按光标真相选好，这发复核
    // 是确认不是二段动。若用户恰好重新抓住且 move 流在走，守卫照样会推迟。
    if (collapseController.getPresentation() === 'docked') {
      stopDragQuiet();
      dockPeekReconcilePending = false;
      // 贴边态的悬停复核轮询常开：运行中新贴边/钉回/探头收尾都经过这里武装
      // （启动恢复在创建末尾单独补武装）；离开贴边态时轮询自己停。
      ensurePeekLinger();
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
      // 吸附逆揭示尚未完成时 presentation 仍是 collapsed：这次悬停不该丢，
      // 记下触发，视觉事务收尾时补一发 reconcile。
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
    // 上面的护栏全落空）：绝不发起探头滑行。吸附 overlay 落位时 Chromium 可能
    // 补发一记 mouseenter，「刚吸附马上拖出来」的按下正好落进这个空档——
    // 此时起滑行 = 多帧写窗撞原生拖拽会话 = 拖不出来。记下扳机，拖拽收尾
    // （settle watch / release quiet）会用光标真相补复核。
    if (mouseButtonMonitor?.isDown()) {
      dockPeekReconcilePending = true;
      return;
    }

    const bounds = getDockActiveWindow().getBounds();
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
      // 姿势没变：复核轮询保持武装（enter/leave 双兜底覆盖半藏与露出两个
      // 方向，不再随姿势停开）。
      ensurePeekLinger();
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
      await glideNoteWindowTo(getDockActiveWindow(), target, () => glide.aborted);
      if (glide.aborted) {
        // 用户抢拖：基线不动，几何交还 move 流程。
        return;
      }
      if (getDockActiveWindow().isDestroyed()) {
        return;
      }
      await collapseController.setDocked({ kind: 'peek', bounds: target });
      // 复核轮询贴边态全程武装（见 ensurePeekLinger），露出/缩回都不断。
      ensurePeekLinger();
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

  // 窗口交接：docked 态的可见/可交互窗口是书签头窗；几何读写一律走活动窗，
  // 非 docked 态恒为便签主窗。
  const getDockActiveWindow = (): BrowserWindow => {
    const tab = getDockTabWindow();
    if (collapseController.getPresentation() === 'docked' && tab) {
      return tab;
    }
    return noteWindow;
  };

  const handleDockWindowMove = (): void => {
    if (noteWindow.isDestroyed()) {
      return;
    }
    const activeWindow = getDockActiveWindow();
    if (isMagneticTransitionInFlight) {
      // 探头/钉回滑行途中用户抓住窗口抢拖：窗口被拖出滑行走廊的第一帧就熔断
      // 并放行本次 move（交还几何）；吸附逆揭示没有 peekGlide，它由物理按下
      // 直接 bump epoch，旧事务的 ACK 与提交随后全部失效。
      if (peekGlide) {
        const current = activeWindow.getBounds();
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

    // 活拖拽 / helper 缺席：任何 move = 几何还在动，取消停稳比对、重排停歇。
    // 物理松手之后的迟到 move 除外——那是窗口在追光标，不是新拖拽；撤表后
    // 不会再有 release 来武装，快速甩边就会静默失败（真机 2026-09-01）。
    const postReleaseCoasting =
      settleWatchTimer !== null &&
      mouseButtonMonitor?.isActive() === true &&
      mouseButtonMonitor?.isDown() !== true;
    if (!postReleaseCoasting) {
      cancelSettleWatch();
      scheduleDragQuiet();
    }

    const presentation = collapseController.getPresentation();

    if (presentation === 'collapsed') {
      // 松手才吸附：拖动全程不写窗，横条跟手自由拖（拖过屏边也不动它）——
      // 吸附 teleport 在拖动途中触发（用例 1「突然跳过去」）就是在这里被否的。
      // 只记抓取点供松手判定；吸附由停歇后的 release watch 确认松手再触发。
      // collapsed 态的活动窗恒为便签主窗。
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
          workAreas.filter((area) => area !== workArea),
          screen.getCursorScreenPoint()
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

    // docked 态的拖动发生在书签头窗上（原生 app-region drag）。
    const current = activeWindow.getBounds();
    // 松手才展开（与松手才吸对称，2026-09-01 真机定案）：move 流上不做任何
    // 阈值判定、不写窗，书签头全程跟手自由拖——竖拖的横向抖动与明确的向外
    // 拉离一视同仁，全交给松手后的 settle 按最终落点裁决（钉回或展开）。
    // 途中展开是窗口交接架构被真机否决的「已知代价」：展开要销毁书签头窗，
    // 原生拖拽会话随之中断，用户拖到一半被迫停下再抓。只记抓取点供松手判定。
    recordGrabPoint(current);
  };
  // 拖出展开（松手才展开的唯一执行者）：过回差带的物理松手直接调用；窗口
  // 还在追光标、瞬时不够 72px 时由 settleDockedIdle 再判一次。此时原生拖拽
  // 会话已随松手自然结束，提交成功才销毁书签头窗。主窗在隐藏态先 setBounds
  // 到展开矩形，renderer 备好揭示首帧并 ACK 后才 showInactive。
  expandDockedNote = (
    side: DockSide,
    sliverBounds: { x: number; y: number; width: number; height: number }
  ): void => {
    const workArea = screen.getDisplayMatching(sliverBounds).workArea;
    const persistedBounds = collapseController.getBoundsForPersistence();
    const bounds = buildExpandBoundsFromDock({
      side,
      sliver: sliverBounds,
      expandedSize: { width: persistedBounds.width, height: persistedBounds.height },
      workArea
    });

    const epoch = ++transitionEpoch;
    peekGlide = null;
    isMagneticTransitionInFlight = true;
    diagnosticLogger?.record('dock_expand', { webContentsId: noteWebContentsId });
    void (async () => {
      const transitionId = ++dockTransitionSequence;
      const tab = getDockTabWindow();
      try {
        noteWindow.setBounds(bounds, false);
        noteWindow.setMinimumSize(NOTE_MIN_WIDTH, NOTE_MIN_HEIGHT);
        noteWindow.setResizable(true);
        const expandReadyPromise = waitForDockRendererAck(
          'sticky-notes:dock-expand-ready',
          transitionId,
          epoch
        );
        noteWindow.webContents.send('sticky-notes:dock-applied', {
          dock: null,
          transitionId,
          expandFrom: {
            x: sliverBounds.x - bounds.x,
            y: sliverBounds.y - bounds.y,
            width: sliverBounds.width,
            height: sliverBounds.height
          }
        });
        const expandReady = await expandReadyPromise;
        if (noteWindow.isDestroyed()) {
          return;
        }
        if (expandReady !== 'received' || epoch !== transitionEpoch) {
          // 展开 prepare 失败/被抢：主窗仍隐藏，书签头窗仍在屏，DOM 回书签头。
          noteWindow.webContents.send('sticky-notes:dock-applied', { dock: { side } });
          return;
        }
        noteWindow.showInactive();
        const didUndock = await getNotesManager().undockNoteForWebContents(
          noteWebContentsId,
          bounds
        );
        if (noteWindow.isDestroyed() || epoch !== transitionEpoch) {
          return;
        }
        if (!didUndock) {
          // 展开提交失败回滚：主窗撤下藏回，书签头窗仍在屏，DOM 回书签头。
          noteWindow.hide();
          noteWindow.webContents.send('sticky-notes:dock-applied', { dock: { side } });
          return;
        }
        // 提交成功才销毁书签头窗（销毁即结束它的拖拽会话），随后 committed
        // 让 renderer 播放 340ms clip 揭示。
        if (tab && !tab.isDestroyed()) {
          dockTabWindow = null;
          tab.destroy();
        }
        noteWindow.webContents.send('sticky-notes:dock-applied', {
          dock: null,
          transitionId,
          committed: true
        });
      } catch (error) {
        diagnosticLogger?.record('note_undock_failed', {
          webContentsId: noteWebContentsId,
          error
        });
      } finally {
        finishMagneticTransition(epoch);
      }
    })();
  };
  noteWindow.on('move', handleDockWindowMove);
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
    // 便签关闭时书签头窗一并销毁（贴边态下它是唯一的可见表面）。
    const tab = getDockTabWindow();
    if (tab) {
      dockTabWindow = null;
      tab.destroy();
    }
    for (const unsubscribe of unsubscribeMouseButtons) {
      unsubscribe();
    }
    imagePreviewController?.handleSourceClosed(noteWebContentsId);
  });

  // 启动恢复的贴边窗没有任何滑行会话经过 finishMagneticTransition：悬停复核
  // 轮询在这里补武装一次（运行中新贴边由 finishMagneticTransition 的贴边
  // 分支武装）。
  if (restoredDockBounds && note.dock) {
    ensurePeekLinger();
  }

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
      // 贴边态的可见表面是书签头窗；主窗保持隐藏（窗口交接）。
      const tab =
        collapseController.getPresentation() === 'docked' ? getDockTabWindow() : null;
      if (tab) {
        tab.showInactive();
        return;
      }
      if (noteWindow.isMinimized()) {
        noteWindow.restore();
      }
      noteWindow.show();
    },
    focus: () => {
      const tab =
        collapseController.getPresentation() === 'docked' ? getDockTabWindow() : null;
      if (tab) {
        tab.focus();
        return;
      }
      if (!noteWindow.isDestroyed()) {
        noteWindow.focus();
      }
    },
    setTitle: (title) => {
      noteWindow.setTitle(title);
    },
    setCollapsed: collapseController.setCollapsed,
    setDocked: collapseController.setDocked,
    commitDocked: collapseController.commitDocked,
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
