import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IMAGE_PREVIEW_CHANNELS,
  isImagePreviewSnapshot,
  type ImagePreviewSnapshot
} from '../shared/image-preview';

contextBridge.exposeInMainWorld('imagePreview', {
  getSnapshot: async () => {
    const snapshot: unknown = await ipcRenderer.invoke(IMAGE_PREVIEW_CHANNELS.getSnapshot);
    return isImagePreviewSnapshot(snapshot) ? snapshot : undefined;
  },
  onSnapshot: (listener: (snapshot: ImagePreviewSnapshot) => void) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: unknown): void => {
      if (isImagePreviewSnapshot(snapshot)) {
        listener(snapshot);
      }
    };
    ipcRenderer.on(IMAGE_PREVIEW_CHANNELS.snapshot, wrapped);
    return () => ipcRenderer.removeListener(IMAGE_PREVIEW_CHANNELS.snapshot, wrapped);
  },
  close: () => ipcRenderer.invoke(IMAGE_PREVIEW_CHANNELS.close),
  resize: (direction: string, dx: number, dy: number) =>
    ipcRenderer.invoke(IMAGE_PREVIEW_CHANNELS.resize, direction, dx, dy),
  move: (dx: number, dy: number) =>
    ipcRenderer.invoke(IMAGE_PREVIEW_CHANNELS.move, dx, dy)
});
