export type ImagePreviewSize = {
  width: number;
  height: number;
};

export type PanOffset = {
  x: number;
  y: number;
};

export function calculateInitialScale(
  viewport: ImagePreviewSize,
  image: ImagePreviewSize
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    return 1;
  }

  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

export function clampScale(scale: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(scale)) return minimum;
  return Math.min(Math.max(scale, minimum), maximum);
}

export function clampPan(
  pan: PanOffset,
  viewport: ImagePreviewSize,
  image: ImagePreviewSize,
  scale: number
): PanOffset {
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const maxX = Math.max(0, (renderedWidth - viewport.width) / 2);
  const maxY = Math.max(0, (renderedHeight - viewport.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, Number.isFinite(pan.x) ? pan.x : 0)),
    y: Math.min(maxY, Math.max(-maxY, Number.isFinite(pan.y) ? pan.y : 0))
  };
}

export function reconcileViewportTransform(options: {
  viewport: ImagePreviewSize;
  image: ImagePreviewSize;
  pan: PanOffset;
  scale: number;
  initialScale: number;
}): {
  pan: PanOffset;
  scale: number;
  initialScale: number;
} {
  if (options.scale === options.initialScale) {
    const nextFit = calculateInitialScale(options.viewport, options.image);
    return {
      pan: { x: 0, y: 0 },
      scale: nextFit,
      initialScale: nextFit
    };
  }
  return {
    pan: clampPan(options.pan, options.viewport, options.image, options.scale),
    scale: options.scale,
    initialScale: options.initialScale
  };
}

export function getZoomedPan(options: {
  pan: PanOffset;
  cursor: PanOffset;
  previousScale: number;
  nextScale: number;
}): PanOffset {
  if (!Number.isFinite(options.previousScale) || options.previousScale <= 0) {
    return options.pan;
  }
  const ratio = options.nextScale / options.previousScale;
  return {
    x: options.cursor.x - (options.cursor.x - options.pan.x) * ratio,
    y: options.cursor.y - (options.cursor.y - options.pan.y) * ratio
  };
}
