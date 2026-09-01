import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// NOTE: 与 shared/image-preview.ts 的 IMAGE_PREVIEW_CHANNELS.open 保持一致。
// 便签 preload 不能直接 import shared 模块——预览 preload 也引用它时 Rollup 会拆出共享 chunk,
// 而 sandbox:true 的预览窗 preload 不允许 require 相对文件,会导致预览窗桥建立失败、整页黑屏。
const IMAGE_PREVIEW_OPEN_CHANNEL = 'sticky-notes:image-preview:open';

type DockAppliedPayload = {
  dock: { side: 'left' | 'right' } | null;
  transitionId?: number;
  // target 画面已 paint 且主进程已同步提交窗口逻辑态后的最终确认。磁盘保存走
  // 现有串行 bounds 通道，不再延长这笔可交互的视觉事务。
  committed?: boolean;
  // 拖出展开时携带：书签头在新窗口坐标系内的矩形，renderer 用它做 clip-path
  // 揭示动画的起点（从书签头位置展开成完整纸面）；其它切 DOM 路径缺省。
  expandFrom?: { x: number; y: number; width: number; height: number };
  // 吸附逆揭示时携带：union 视口尺寸与 strip / bookmark 两个矩形（union 窗口
  // 坐标系）。renderer 把纸面 overlay 钉在 strip 位置，WAAPI 同拍演 clip 收缩
  // + 平移到 bookmark——吸附是拖出展开的逆运动，可见运动全在 DOM；native
  // 尺寸与原点各自在独立 paint 边界提交。
  shrinkFromStrip?: {
    unionWidth: number;
    unionHeight: number;
    strip: { x: number; y: number; width: number; height: number };
    bookmark: { x: number; y: number; width: number; height: number };
  };
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
  // move 只做吸附预览与展开阈值判定；吸附在物理松手后由主进程发起两次几何
  // 写入的视觉事务，展开只做一次几何写入。两者都用 dock-applied 协调 DOM，
  // 不再有 offer/accept 与自定义拖窗 IPC。
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
  // 吸附逆揭示演完的回执：主进程收到后先移动 union-sized 窗口到 target
  // 原点；renderer paint 后再允许最终裁剪（裁早了会把进行中的动画切掉）。
  dockShrinkFinished: (transitionId: number): void => {
    ipcRenderer.send('sticky-notes:dock-shrink-finished', transitionId);
  },
  // 吸附逆揭示开演前的握手：renderer 已把纸面 overlay 提交进 DOM 并重钉成
  // 显式像素矩形后发送；主进程收到这份回执才一刀 setBounds(union)。没有
  // 这个握手就先扩窗的话，靠 .note-shell 100vw/100vh 铺满旧视口的 stub 会被
  // 新视口拉满整个 union（真机「变长又变短」抽搐的开场竞态根因）。
  dockShrinkReady: (transitionId: number): void => {
    ipcRenderer.send('sticky-notes:dock-shrink-ready', transitionId);
  },
  // The union backing store has resized at the unchanged source origin and the
  // source paper has painted. Main may now move the already-sized window.
  dockShrinkUnionSized: (transitionId: number): void => {
    ipcRenderer.send('sticky-notes:dock-shrink-union-sized', transitionId);
  },
  // 窗口交接的展开 prepare 回执：揭示首帧（clip 钉书签头矩形）已在隐藏态
  // paint，主进程收到才 showInactive 主窗、隐藏书签头窗并发 committed 播动画。
  dockExpandReady: (transitionId: number): void => {
    ipcRenderer.send('sticky-notes:dock-expand-ready', transitionId);
  },
  // 书签头窗（?view=tab）真实数据首帧 paint 完成的回执：窗口交接架构下，
  // 主进程收到它才允许 showInactive 上屏（上屏画面必须与吸附动画末帧同像素）。
  dockTabReady: (): void => {
    ipcRenderer.send('sticky-notes:dock-tab-ready');
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
