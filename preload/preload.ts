import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// NOTE: 与 shared/image-preview.ts 的 IMAGE_PREVIEW_CHANNELS.open 保持一致。
// 便签 preload 不能直接 import shared 模块——预览 preload 也引用它时 Rollup 会拆出共享 chunk,
// 而 sandbox:true 的预览窗 preload 不允许 require 相对文件,会导致预览窗桥建立失败、整页黑屏。
const IMAGE_PREVIEW_OPEN_CHANNEL = 'sticky-notes:image-preview:open';

type DockAppliedPayload = {
  dock: { side: 'left' | 'right' } | null;
  // 拖出展开时携带：书签头在新窗口坐标系内的矩形，renderer 用它做 clip-path
  // 揭示动画的起点（从书签头位置展开成完整纸面）；其它切 DOM 路径缺省。
  expandFrom?: { x: number; y: number; width: number; height: number };
  // 吸附滑入时携带：目标书签头尺寸（多屏共边是 48 宽全露而非 96 半藏，不能
  // 写死）。renderer 把书签头 DOM 按此尺寸钉在横条窗口的保留角上演交叉淡变，
  // 窗口纯平移滑行到位后由主进程一次性裁剪（视觉隐形）。
  morphFromStrip?: { width: number; height: number };
};

type DockPreviewPayload = {
  side: 'left' | 'right' | null;
};

contextBridge.exposeInMainWorld('stickyNotes', {
  platform: process.platform,
  // 主进程按持久化 dock 建缝窗时把 side 写进 URL query；同步读取让 renderer
  // 首帧就渲染缝，不等 getCurrentNote。
  getInitialDockSide: (): 'left' | 'right' | null => {
    const side = new URLSearchParams(window.location.search).get('dock');
    return side === 'left' || side === 'right' ? side : null;
  },
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
  // 磁吸贴边/展开由主进程在原生拖动的 move 上直接改窗口几何，完成后用
  // dock-applied 通知 renderer 切 DOM；不再有 offer/accept 与自定义拖窗 IPC。
  onDockApplied: (listener: (payload: DockAppliedPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: DockAppliedPayload): void => {
      listener(payload);
    };
    ipcRenderer.on('sticky-notes:dock-applied', subscription);
    return () => {
      ipcRenderer.removeListener('sticky-notes:dock-applied', subscription);
    };
  },
  // 拖动中预览：横条进入吸附区时主进程只发状态（不写窗），renderer 显示
  // 「松手贴边」承诺提示；离开吸附区 side 为 null。
  onDockPreview: (listener: (payload: DockPreviewPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: DockPreviewPayload): void => {
      listener(payload);
    };
    ipcRenderer.on('sticky-notes:dock-preview', subscription);
    return () => {
      ipcRenderer.removeListener('sticky-notes:dock-preview', subscription);
    };
  },
  // 悬停探头：mouseenter/leave 只是扳机，主进程一次性查光标判定真实悬停
  // 后滑行窗口，renderer 不参与几何。payload 仅表达意图方向。
  dockPeekHover: (hovered: boolean): void => {
    ipcRenderer.send('sticky-notes:dock-peek', hovered);
  },
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
