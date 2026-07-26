import type { BrowserWindowConstructorOptions } from 'electron';
import type { DisplayWorkArea } from './window-options';
import type { NoteBounds } from './note-state';
import type {
  ImagePreviewResizeDirection,
  ImagePreviewSnapshot
} from '../shared/image-preview';

const IMAGE_PREVIEW_MAX_RATIO = 0.8;
const IMAGE_PREVIEW_MIN_WIDTH = 320;
const IMAGE_PREVIEW_MIN_HEIGHT = 240;

export type ImagePreviewSize = {
  width: number;
  height: number;
};

export type ImagePreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImagePreviewWindowPort = {
  webContentsId: number;
  load: () => Promise<void>;
  onReady: (listener: () => void) => void;
  onClosed: (listener: () => void) => void;
  send: (snapshot: ImagePreviewSnapshot) => void;
  show: () => void;
  focus: () => void;
  close: () => void;
  destroy: () => void;
  resize: (direction: ImagePreviewResizeDirection, dx: number, dy: number) => void;
  move: (dx: number, dy: number) => void;
};

export type ImagePreviewWindowFactory = (
  workArea: DisplayWorkArea,
  noteBounds: NoteBounds,
  imageSize: ImagePreviewSize
) => ImagePreviewWindowPort;

type ImagePreviewControllerOptions = {
  createWindow: ImagePreviewWindowFactory;
  getSnapshot: (noteId: string, imageId: string) => ImagePreviewSnapshot | undefined;
  focusSource: (webContentsId: number) => void;
  logWarning?: (message: string, error: unknown) => void;
};

type ActivePreview = {
  window: ImagePreviewWindowPort;
  sourceWebContentsId: number;
  snapshot: ImagePreviewSnapshot;
  ready: boolean;
};

export class ImagePreviewController {
  private active?: ActivePreview;
  private disposed = false;
  private readonly logWarning: (message: string, error: unknown) => void;

  constructor(private readonly options: ImagePreviewControllerOptions) {
    this.logWarning = options.logWarning ?? ((message, error) => console.warn(message, error));
  }

  open(
    sourceWebContentsId: number,
    noteId: string,
    imageId: string,
    workArea: DisplayWorkArea,
    noteBounds: NoteBounds
  ): boolean {
    if (this.disposed) {
      return false;
    }

    const snapshot = this.options.getSnapshot(noteId, imageId);
    if (!snapshot) {
      return false;
    }

    if (this.active) {
      this.active.sourceWebContentsId = sourceWebContentsId;
      this.active.snapshot = snapshot;
      this.sendSnapshot(this.active, imageId);
      this.focusWindow(this.active.window);
      return true;
    }

    let window: ImagePreviewWindowPort;
    try {
      window = this.options.createWindow(
        workArea,
        noteBounds,
        getActiveImageSize(snapshot)
      );
    } catch (error) {
      this.logWarning('Unable to create image preview window', error);
      return false;
    }

    const active: ActivePreview = {
      window,
      sourceWebContentsId,
      snapshot,
      ready: false
    };
    this.active = active;

    try {
      window.onReady(() => {
        if (this.active !== active || this.disposed) {
          return;
        }
        active.ready = true;
        this.sendSnapshot(active);
        this.focusWindow(window);
      });
      window.onClosed(() => {
        if (this.active === active) {
          this.active = undefined;
        }
      });
      void window.load().catch((error) => {
        this.logWarning('Unable to load image preview window', error);
        if (this.active === active) {
          this.active = undefined;
        }
        try {
          window.destroy();
        } catch (destroyError) {
          this.logWarning('Unable to destroy image preview window', destroyError);
        }
      });
    } catch (error) {
      this.logWarning('Unable to initialize image preview window', error);
      this.active = undefined;
      try {
        window.destroy();
      } catch (destroyError) {
        this.logWarning('Unable to destroy image preview window', destroyError);
      }
      return false;
    }

    return true;
  }

  getSnapshotForWebContents(webContentsId: number): ImagePreviewSnapshot | undefined {
    return this.active?.window.webContentsId === webContentsId
      ? this.active.snapshot
      : undefined;
  }

  close(fromWebContentsId?: number): boolean {
    const active = this.active;
    if (
      !active ||
      (fromWebContentsId !== undefined && active.window.webContentsId !== fromWebContentsId)
    ) {
      return false;
    }

    active.window.close();
    this.options.focusSource(active.sourceWebContentsId);
    return true;
  }

  resize(
    fromWebContentsId: number,
    direction: ImagePreviewResizeDirection,
    dx: number,
    dy: number
  ): boolean {
    const active = this.active;
    if (!active || active.window.webContentsId !== fromWebContentsId) {
      return false;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return false;
    }
    try {
      active.window.resize(direction, dx, dy);
    } catch (error) {
      this.logWarning('Unable to resize image preview window', error);
      return false;
    }
    return true;
  }

  move(fromWebContentsId: number, dx: number, dy: number): boolean {
    const active = this.active;
    if (!active || active.window.webContentsId !== fromWebContentsId) {
      return false;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return false;
    }
    try {
      active.window.move(dx, dy);
    } catch (error) {
      this.logWarning('Unable to move image preview window', error);
      return false;
    }
    return true;
  }

  handleSourceClosed(sourceWebContentsId: number): void {
    if (this.active?.sourceWebContentsId === sourceWebContentsId) {
      this.closeWithoutRestoringFocus();
    }
  }

  handleNoteDeleted(noteId: string): void {
    if (this.active?.snapshot.noteId === noteId) {
      this.closeWithoutRestoringFocus();
    }
  }

  handleImageDeleted(noteId: string, imageId: string): void {
    const active = this.active;
    if (!active || active.snapshot.noteId !== noteId) {
      return;
    }

    const currentIndex = active.snapshot.images.findIndex(
      (image) => image.id === imageId
    );
    const nextImage =
      currentIndex >= 0
        ? active.snapshot.images[currentIndex + 1] ??
          active.snapshot.images[currentIndex - 1]
        : active.snapshot.images[0];
    if (!nextImage) {
      this.closeWithoutRestoringFocus();
      return;
    }

    const replacement = this.options.getSnapshot(noteId, nextImage.id);
    if (!replacement) {
      this.closeWithoutRestoringFocus();
      return;
    }

    active.snapshot = replacement;
    this.sendSnapshot(active);
  }

  dispose(): void {
    this.disposed = true;
    if (!this.active) {
      return;
    }
    try {
      this.active.window.destroy();
    } catch (error) {
      this.logWarning('Unable to destroy image preview window', error);
    }
    this.active = undefined;
  }

  private closeWithoutRestoringFocus(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    active.window.close();
  }

  private sendSnapshot(active: ActivePreview, requestedActiveImageId?: string): void {
    if (!active.ready) {
      return;
    }
    try {
      active.window.send(
        requestedActiveImageId
          ? {
              ...active.snapshot,
              requestedActiveImageId
            }
          : active.snapshot
      );
    } catch (error) {
      this.logWarning('Unable to send image preview snapshot', error);
    }
  }

  private focusWindow(window: ImagePreviewWindowPort): void {
    try {
      window.show();
      window.focus();
    } catch (error) {
      this.logWarning('Unable to focus image preview window', error);
    }
  }
}

export function createImagePreviewWindowOptions(
  workArea: DisplayWorkArea,
  noteBounds: NoteBounds,
  imageSize: ImagePreviewSize,
  preloadPath: string,
  iconPath: string
): BrowserWindowConstructorOptions {
  const { width, height } = computeImagePreviewSize(imageSize, workArea);
  const noteX =
    noteBounds.x ?? workArea.x + Math.floor((workArea.width - noteBounds.width) / 2);
  const noteY =
    noteBounds.y ?? workArea.y + Math.floor((workArea.height - noteBounds.height) / 2);
  const rightX = noteX + noteBounds.width + 16;
  const leftX = noteX - width - 16;
  const candidateX =
    rightX + width <= workArea.x + workArea.width
      ? rightX
      : leftX >= workArea.x
        ? leftX
        : workArea.x + Math.floor((workArea.width - width) / 2);
  const x = clamp(candidateX, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(noteY, workArea.y, workArea.y + workArea.height - height);

  return {
    x,
    y,
    width,
    height,
    title: '图片预览',
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#151515',
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

// 预览窗初始尺寸贴合图片 natural 尺寸:不放大(小图不被硬拉到满窗),
// 上限工作区的 80%(大图不再铺满屏幕),下限保证工具按钮可用。
export function computeImagePreviewSize(
  imageSize: ImagePreviewSize,
  workArea: ImagePreviewSize
): ImagePreviewSize {
  const imageWidth = Math.max(1, imageSize.width);
  const imageHeight = Math.max(1, imageSize.height);
  const scale = Math.min(
    1,
    (workArea.width * IMAGE_PREVIEW_MAX_RATIO) / imageWidth,
    (workArea.height * IMAGE_PREVIEW_MAX_RATIO) / imageHeight
  );
  return {
    width: clampDimension(
      Math.round(imageWidth * scale),
      IMAGE_PREVIEW_MIN_WIDTH,
      workArea.width
    ),
    height: clampDimension(
      Math.round(imageHeight * scale),
      IMAGE_PREVIEW_MIN_HEIGHT,
      workArea.height
    )
  };
}

// 无边框窗没有系统缩放边框,renderer 边缘手柄把指针增量通过 IPC 传到这里,
// 按方向换算成新 bounds;西/北边拖动时保持右/下边缘锚定,避免窗口"跟手漂移"。
export function computeResizedBounds(
  bounds: ImagePreviewBounds,
  direction: ImagePreviewResizeDirection,
  dx: number,
  dy: number,
  minimum: ImagePreviewSize,
  maximum: ImagePreviewSize
): ImagePreviewBounds {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  let { x, y, width, height } = bounds;

  if (direction.includes('e')) {
    width += dx;
  }
  if (direction.includes('s')) {
    height += dy;
  }
  if (direction.includes('w')) {
    width -= dx;
  }
  if (direction.includes('n')) {
    height -= dy;
  }

  width = clampDimension(Math.round(width), minimum.width, maximum.width);
  height = clampDimension(Math.round(height), minimum.height, maximum.height);
  if (direction.includes('w')) {
    x = right - width;
  }
  if (direction.includes('n')) {
    y = bottom - height;
  }

  return { x: Math.round(x), y: Math.round(y), width, height };
}

export function getImagePreviewMinimumSize(): ImagePreviewSize {
  return { width: IMAGE_PREVIEW_MIN_WIDTH, height: IMAGE_PREVIEW_MIN_HEIGHT };
}

function getActiveImageSize(snapshot: ImagePreviewSnapshot): ImagePreviewSize {
  const active =
    snapshot.images.find((image) => image.id === snapshot.activeImageId) ??
    snapshot.images[0];
  return { width: active.width, height: active.height };
}

function clampDimension(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(Math.min(minimum, maximum), value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
