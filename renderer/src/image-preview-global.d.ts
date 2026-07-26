import type {
  ImagePreviewResizeDirection,
  ImagePreviewSnapshot
} from '../../shared/image-preview';

export {};

declare global {
  interface Window {
    imagePreview: {
      getSnapshot: () => Promise<ImagePreviewSnapshot | undefined>;
      onSnapshot: (listener: (snapshot: ImagePreviewSnapshot) => void) => () => void;
      close: () => Promise<boolean>;
      resize: (
        direction: ImagePreviewResizeDirection,
        dx: number,
        dy: number
      ) => Promise<boolean>;
      move: (dx: number, dy: number) => Promise<boolean>;
    };
  }
}
