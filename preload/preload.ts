import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// NOTE: 与 shared/image-preview.ts 的 IMAGE_PREVIEW_CHANNELS.open 保持一致。
// 便签 preload 不能直接 import shared 模块——预览 preload 也引用它时 Rollup 会拆出共享 chunk,
// 而 sandbox:true 的预览窗 preload 不允许 require 相对文件,会导致预览窗桥建立失败、整页黑屏。
const IMAGE_PREVIEW_OPEN_CHANNEL = 'sticky-notes:image-preview:open';

type DockOfferPayload = {
  side: 'left' | 'right';
  y: number;
  epoch: number;
};

type UndockOfferPayload = {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  epoch: number;
};

contextBridge.exposeInMainWorld('stickyNotes', {
  platform: process.platform,
  getAppCopy: () => ipcRenderer.invoke('sticky-notes:get-app-copy'),
  getCurrentNote: () => ipcRenderer.invoke('sticky-notes:get-current-note'),
  createNote: () => ipcRenderer.invoke('sticky-notes:create-note'),
  updateName: (name: string) => ipcRenderer.invoke('sticky-notes:update-name', name),
  updateContent: (content: string) => ipcRenderer.invoke('sticky-notes:update-content', content),
  updateChecklist: (checklist: unknown) => ipcRenderer.invoke('sticky-notes:update-checklist', checklist),
  updateAppearance: (appearance: unknown) =>
    ipcRenderer.invoke('sticky-notes:update-appearance', appearance),
  setCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke('sticky-notes:set-collapsed', collapsed),
  onDockOffer: (listener: (payload: DockOfferPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: DockOfferPayload): void => {
      listener(payload);
    };
    ipcRenderer.on('sticky-notes:dock-offer', subscription);
    return () => {
      ipcRenderer.removeListener('sticky-notes:dock-offer', subscription);
    };
  },
  onUndockOffer: (listener: (payload: UndockOfferPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: UndockOfferPayload): void => {
      listener(payload);
    };
    ipcRenderer.on('sticky-notes:undock-offer', subscription);
    return () => {
      ipcRenderer.removeListener('sticky-notes:undock-offer', subscription);
    };
  },
  // 收起横条/贴边缝的窗口拖动：renderer 指针事件 + 增量 IPC，松手才判定。
  dragNoteWindow: (dx: number, dy: number) =>
    ipcRenderer.invoke('sticky-notes:drag-note-window', dx, dy),
  finishNoteWindowDrag: (dx: number, dy: number) =>
    ipcRenderer.invoke('sticky-notes:finish-note-window-drag', dx, dy),
  acceptDock: (epoch: number) => ipcRenderer.invoke('sticky-notes:accept-dock', epoch),
  acceptUndock: (epoch: number) => ipcRenderer.invoke('sticky-notes:accept-undock', epoch),
  getAutoLaunchStatus: () => ipcRenderer.invoke('sticky-notes:get-auto-launch-status'),
  setAutoLaunchEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('sticky-notes:set-auto-launch-enabled', enabled),
  pasteClipboardImage: () => ipcRenderer.invoke('sticky-notes:paste-clipboard-image'),
  addImage: (imageInput: unknown) => ipcRenderer.invoke('sticky-notes:add-image', imageInput),
  deleteImage: (imageId: string) => ipcRenderer.invoke('sticky-notes:delete-image', imageId),
  openImagePreview: (imageId: string) =>
    ipcRenderer.invoke(IMAGE_PREVIEW_OPEN_CHANNEL, imageId),
  deleteCurrentNote: () => ipcRenderer.invoke('sticky-notes:delete-current-note')
});
