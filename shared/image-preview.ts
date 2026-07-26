export const IMAGE_PREVIEW_CHANNELS = {
  open: 'sticky-notes:image-preview:open',
  getSnapshot: 'sticky-notes:image-preview:get-snapshot',
  snapshot: 'sticky-notes:image-preview:snapshot',
  close: 'sticky-notes:image-preview:close',
  resize: 'sticky-notes:image-preview:resize',
  move: 'sticky-notes:image-preview:move'
} as const;

export const IMAGE_PREVIEW_RESIZE_DIRECTIONS = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw'
] as const;

export type ImagePreviewResizeDirection =
  (typeof IMAGE_PREVIEW_RESIZE_DIRECTIONS)[number];

export function isImagePreviewResizeDirection(
  value: unknown
): value is ImagePreviewResizeDirection {
  return (
    typeof value === 'string' &&
    (IMAGE_PREVIEW_RESIZE_DIRECTIONS as readonly string[]).includes(value)
  );
}

export type ImagePreviewImage = {
  id: string;
  src: string;
  width: number;
  height: number;
};

export type ImagePreviewSnapshot = {
  noteId: string;
  images: ImagePreviewImage[];
  activeImageId: string;
  requestedActiveImageId?: string;
};

export function isImagePreviewSnapshot(value: unknown): value is ImagePreviewSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ImagePreviewSnapshot>;
  return (
    typeof candidate.noteId === 'string' &&
    candidate.noteId.length > 0 &&
    typeof candidate.activeImageId === 'string' &&
    candidate.activeImageId.length > 0 &&
    Array.isArray(candidate.images) &&
    candidate.images.length > 0 &&
    candidate.images.every(isImagePreviewImage) &&
    candidate.images.some((image) => image.id === candidate.activeImageId) &&
    (candidate.requestedActiveImageId === undefined ||
      (typeof candidate.requestedActiveImageId === 'string' &&
        candidate.images.some((image) => image.id === candidate.requestedActiveImageId)))
  );
}

export function resolvePreviewActiveImageId(
  currentImageId: string,
  snapshot: ImagePreviewSnapshot
): string {
  if (
    snapshot.requestedActiveImageId &&
    snapshot.images.some((image) => image.id === snapshot.requestedActiveImageId)
  ) {
    return snapshot.requestedActiveImageId;
  }
  return snapshot.images.some((image) => image.id === currentImageId)
    ? currentImageId
    : snapshot.activeImageId;
}

function isImagePreviewImage(value: unknown): value is ImagePreviewImage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ImagePreviewImage>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.src === 'string' &&
    candidate.src.length > 0 &&
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height) &&
    candidate.height > 0
  );
}
