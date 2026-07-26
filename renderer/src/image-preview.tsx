import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  calculateInitialScale,
  clampPan,
  clampScale,
  getZoomedPan,
  reconcileViewportTransform,
  type ImagePreviewSize,
  type PanOffset
} from './image-preview-zoom';
import {
  resolvePreviewActiveImageId,
  type ImagePreviewResizeDirection,
  type ImagePreviewSnapshot
} from '../../shared/image-preview';
import './image-preview.css';

const MIN_VIEWPORT_SIZE = 1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_FACTOR = 1.12;
const PAN_THRESHOLD = 4;
const RESIZE_DIRECTIONS: ImagePreviewResizeDirection[] = [
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw'
];

// 无边框窗没有系统缩放边框;边缘手柄把指针屏幕坐标增量经 IPC 交给主进程
// 做 setBounds。增量按 rAF 合帧发送,避免 mousemove 频率打爆 IPC 桥。
function ResizeHandles(): JSX.Element {
  const dragRef = useRef<{
    pointerId: number;
    direction: ImagePreviewResizeDirection;
    lastX: number;
    lastY: number;
    pendingDx: number;
    pendingDy: number;
    frame?: number;
  }>();

  const flush = (): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.frame = undefined;
    const dx = drag.pendingDx;
    const dy = drag.pendingDy;
    if (dx === 0 && dy === 0) {
      return;
    }
    drag.pendingDx = 0;
    drag.pendingDy = 0;
    void window.imagePreview.resize(drag.direction, dx, dy);
  };

  useEffect(() => {
    return () => {
      const frame = dragRef.current?.frame;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const handlePointerDown = (
    direction: ImagePreviewResizeDirection,
    event: PointerEvent<HTMLDivElement>
  ): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      direction,
      lastX: event.screenX,
      lastY: event.screenY,
      pendingDx: 0,
      pendingDy: 0
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.pendingDx += event.screenX - drag.lastX;
    drag.pendingDy += event.screenY - drag.lastY;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    if (drag.frame === undefined) {
      drag.frame = requestAnimationFrame(flush);
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.frame !== undefined) {
      cancelAnimationFrame(drag.frame);
      drag.frame = undefined;
    }
    flush();
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <>
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={`image-preview-resize image-preview-resize--${direction}`}
          aria-hidden="true"
          onPointerDown={(event) => handlePointerDown(direction, event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
      ))}
    </>
  );
}

function ImagePreviewApp(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ImagePreviewSnapshot>();
  const [activeImageId, setActiveImageId] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const snapshotRef = useRef<ImagePreviewSnapshot>();
  const activeImageIdRef = useRef('');
  const viewportSizeRef = useRef<ImagePreviewSize>({ width: 1, height: 1 });
  const viewportRectRef = useRef<DOMRect>();
  const imageSizeRef = useRef<ImagePreviewSize>();
  const panRef = useRef<PanOffset>({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const initialScaleRef = useRef(1);
  const animationFrameRef = useRef<number>();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pan: PanOffset;
    moved: boolean;
  }>();
  // 整窗拖动:背景或适配态图片上的左键拖拽都移动窗口(普通图片查看器的直觉操作)。
  // 窗口跟手移动时 clientX 相对窗口不变,必须像 resize 手柄一样用 screenX 增量,
  // rAF 合帧后经 IPC 交给主进程 setBounds。closesOnClick 保留背景单击关闭。
  const windowDragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    pendingDx: number;
    pendingDy: number;
    moved: boolean;
    closesOnClick: boolean;
    frame?: number;
  }>();

  const setActiveImage = (imageId: string): void => {
    activeImageIdRef.current = imageId;
    setActiveImageId(imageId);
  };

  useEffect(() => {
    let mounted = true;
    const applySnapshot = (next: ImagePreviewSnapshot): void => {
      if (!mounted) {
        return;
      }
      const currentImageId = activeImageIdRef.current;
      snapshotRef.current = next;
      setSnapshot(next);
      setActiveImage(resolvePreviewActiveImageId(currentImageId, next));
    };
    void window.imagePreview.getSnapshot().then((next) => {
      if (next) {
        applySnapshot(next);
      }
    });
    const unsubscribe = window.imagePreview.onSnapshot(applySnapshot);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const update = (): void => {
      const rect = viewport.getBoundingClientRect();
      viewportRectRef.current = rect;
      viewportSizeRef.current = {
        width: Math.max(MIN_VIEWPORT_SIZE, rect.width),
        height: Math.max(MIN_VIEWPORT_SIZE, rect.height)
      };
      const imageSize = imageSizeRef.current;
      if (imageSize) {
        // 窗口 show 前布局可能为 0,未缩放时要按真实视口重新 fit;用户已缩放时
        // 保留 scale,但必须重新夹取 pan,否则把窗口拉大后会露出多余空白。
        const nextTransform = reconcileViewportTransform({
          viewport: viewportSizeRef.current,
          image: imageSize,
          pan: panRef.current,
          scale: scaleRef.current,
          initialScale: initialScaleRef.current
        });
        if (
          nextTransform.scale !== scaleRef.current ||
          nextTransform.initialScale !== initialScaleRef.current ||
          nextTransform.pan.x !== panRef.current.x ||
          nextTransform.pan.y !== panRef.current.y
        ) {
          initialScaleRef.current = nextTransform.initialScale;
          scaleRef.current = nextTransform.scale;
          panRef.current = nextTransform.pan;
          scheduleTransform();
        }
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
    // snapshot 到达前组件渲染的是 loading UI,viewport 不在 DOM 里;
    // 依赖 snapshot 才能在 viewport 出现后真正装上观察器(否则 viewportSizeRef 永远停在 {1,1},
    // fit 出的 scale = 1/图片宽度,图缩成一个像素点——预览窗"全黑"的真凶)。
  }, [snapshot]);

  useEffect(() => {
    imageSizeRef.current = undefined;
    scaleRef.current = 1;
    initialScaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setLoadFailed(false);
    imageRef.current?.style.removeProperty('transform');
    imageRef.current?.classList.remove('image-preview-image--ready');
    viewportRef.current?.classList.remove('image-preview-viewport--pan');
  }, [activeImageId]);

  const applyTransform = (): void => {
    animationFrameRef.current = undefined;
    const image = imageRef.current;
    if (image) {
      image.style.transform = `translate(-50%, -50%) translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${scaleRef.current})`;
      image.classList.add('image-preview-image--ready');
    }
  };

  const scheduleTransform = (): void => {
    if (animationFrameRef.current === undefined) {
      animationFrameRef.current = requestAnimationFrame(applyTransform);
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      const windowDragFrame = windowDragRef.current?.frame;
      if (windowDragFrame !== undefined) {
        cancelAnimationFrame(windowDragFrame);
      }
    };
  }, []);

  const fitImage = (naturalWidth: number, naturalHeight: number): void => {
    const imageSize = { width: naturalWidth, height: naturalHeight };
    const fitScale = calculateInitialScale(viewportSizeRef.current, imageSize);
    imageSizeRef.current = imageSize;
    initialScaleRef.current = fitScale;
    scaleRef.current = fitScale;
    panRef.current = { x: 0, y: 0 };
    setLoadFailed(false);
    imageRef.current?.style.removeProperty('transform');
    imageRef.current?.classList.remove('image-preview-image--ready');
    viewportRef.current?.classList.remove('image-preview-viewport--pan');
    scheduleTransform();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const imageSize = imageSizeRef.current;
    const rect = viewportRectRef.current;
    if (!imageSize || !rect) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    const nextScale = clampScale(
      scaleRef.current * direction,
      initialScaleRef.current,
      MAX_SCALE
    );
    if (nextScale === scaleRef.current) {
      return;
    }
    const cursor = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2
    };
    const nextPan = getZoomedPan({
      pan: panRef.current,
      cursor,
      previousScale: scaleRef.current,
      nextScale
    });
    scaleRef.current = nextScale;
    panRef.current = clampPan(
      nextPan,
      viewportSizeRef.current,
      imageSize,
      nextScale
    );
    viewportRef.current?.classList.toggle(
      'image-preview-viewport--pan',
      nextScale > initialScaleRef.current
    );
    scheduleTransform();
  };

  const flushWindowDrag = (): void => {
    const drag = windowDragRef.current;
    if (!drag) {
      return;
    }
    drag.frame = undefined;
    const dx = drag.pendingDx;
    const dy = drag.pendingDy;
    if (dx === 0 && dy === 0) {
      return;
    }
    drag.pendingDx = 0;
    drag.pendingDy = 0;
    void window.imagePreview.move(dx, dy);
  };

  const scheduleWindowDrag = (drag: NonNullable<typeof windowDragRef.current>): void => {
    if (!drag.moved && Math.hypot(drag.pendingDx, drag.pendingDy) >= PAN_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved && drag.frame === undefined) {
      drag.frame = requestAnimationFrame(flushWindowDrag);
    }
  };

  const startWindowDrag = (
    event: PointerEvent<HTMLDivElement>,
    closesOnClick: boolean
  ): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    windowDragRef.current = {
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      pendingDx: 0,
      pendingDy: 0,
      moved: false,
      closesOnClick
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    if (event.target === event.currentTarget) {
      startWindowDrag(event, true);
      return;
    }
    if (event.target !== imageRef.current || !imageSizeRef.current) {
      return;
    }
    if (scaleRef.current > initialScaleRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pan: panRef.current,
        moved: false
      };
      return;
    }
    startWindowDrag(event, false);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const windowDrag = windowDragRef.current;
    if (windowDrag && windowDrag.pointerId === event.pointerId) {
      windowDrag.pendingDx += event.screenX - windowDrag.lastX;
      windowDrag.pendingDy += event.screenY - windowDrag.lastY;
      windowDrag.lastX = event.screenX;
      windowDrag.lastY = event.screenY;
      scheduleWindowDrag(windowDrag);
      return;
    }
    const drag = dragRef.current;
    const imageSize = imageSizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !imageSize) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) {
      return;
    }
    drag.moved = true;
    panRef.current = clampPan(
      { x: drag.pan.x + dx, y: drag.pan.y + dy },
      viewportSizeRef.current,
      imageSize,
      scaleRef.current
    );
    scheduleTransform();
  };

  const clearDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const windowDrag = windowDragRef.current;
    if (windowDrag?.pointerId === event.pointerId) {
      const isClick =
        !windowDrag.moved &&
        Math.hypot(windowDrag.pendingDx, windowDrag.pendingDy) < PAN_THRESHOLD;
      if (windowDrag.frame !== undefined) {
        cancelAnimationFrame(windowDrag.frame);
        windowDrag.frame = undefined;
      }
      if (windowDrag.moved) {
        flushWindowDrag();
      }
      windowDragRef.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (event.type === 'pointerup' && isClick && windowDrag.closesOnClick) {
        void window.imagePreview.close();
      }
      return;
    }
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const navigate = (direction: -1 | 1): void => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot || currentSnapshot.images.length < 2) {
      return;
    }
    const index = currentSnapshot.images.findIndex(
      (image) => image.id === activeImageIdRef.current
    );
    const nextIndex = Math.max(
      0,
      Math.min(currentSnapshot.images.length - 1, index + direction)
    );
    setActiveImage(
      currentSnapshot.images[nextIndex]?.id ?? activeImageIdRef.current
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void window.imagePreview.close();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeImage = snapshot?.images.find(
    (image) => image.id === activeImageId
  );
  const showError = Boolean(snapshot && (!activeImage || loadFailed));

  // 顶部整条是移动区(标题栏心智),与背景/适配态图片拖动共用同一台 windowDrag 机器。
  const dragStrip = (
    <div
      className="image-preview-drag-strip"
      aria-hidden="true"
      onPointerDown={(event) => startWindowDrag(event, false)}
      onPointerMove={handlePointerMove}
      onPointerUp={clearDrag}
      onPointerCancel={clearDrag}
    />
  );

  if (!snapshot) {
    return (
      <main className="image-preview image-preview--loading">
        {dragStrip}
        <button
          className="image-preview-close"
          type="button"
          aria-label="关闭图片预览"
          onClick={() => void window.imagePreview.close()}
        >
          <X size={20} />
        </button>
        <p>正在加载图片</p>
        <ResizeHandles />
      </main>
    );
  }

  if (showError || !activeImage) {
    return (
      <main
        className="image-preview image-preview--loading"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            void window.imagePreview.close();
          }
        }}
      >
        {dragStrip}
        <button
          className="image-preview-close"
          type="button"
          aria-label="关闭图片预览"
          onClick={() => void window.imagePreview.close()}
        >
          <X size={20} />
        </button>
        <p>无法加载图片</p>
        <ResizeHandles />
      </main>
    );
  }

  const currentIndex = snapshot.images.findIndex(
    (image) => image.id === activeImageId
  );
  const canPrevious = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < snapshot.images.length - 1;

  return (
    <main className="image-preview">
      {dragStrip}
      <div
        ref={viewportRef}
        className="image-preview-viewport"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearDrag}
        onPointerCancel={clearDrag}
      >
        <img
          ref={imageRef}
          key={activeImage.id}
          className="image-preview-image"
          src={activeImage.src}
          alt="图片预览"
          draggable={false}
          onLoad={(event) =>
            fitImage(
              event.currentTarget.naturalWidth,
              event.currentTarget.naturalHeight
            )
          }
          onError={() => setLoadFailed(true)}
        />
      </div>
      <button
        className="image-preview-close"
        type="button"
        aria-label="关闭图片预览"
        onClick={() => void window.imagePreview.close()}
      >
        <X size={20} />
      </button>
      {snapshot.images.length > 1 ? (
        <>
          <button
            className="image-preview-nav image-preview-nav--left"
            type="button"
            aria-label="上一张"
            disabled={!canPrevious}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={26} />
          </button>
          <button
            className="image-preview-nav image-preview-nav--right"
            type="button"
            aria-label="下一张"
            disabled={!canNext}
            onClick={() => navigate(1)}
          >
            <ChevronRight size={26} />
          </button>
        </>
      ) : null}
      <ResizeHandles />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ImagePreviewApp />);

export { ImagePreviewApp };
