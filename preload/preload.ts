import { contextBridge, ipcRenderer } from 'electron';

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
  getAutoLaunchStatus: () => ipcRenderer.invoke('sticky-notes:get-auto-launch-status'),
  setAutoLaunchEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('sticky-notes:set-auto-launch-enabled', enabled),
  pasteClipboardImage: () => ipcRenderer.invoke('sticky-notes:paste-clipboard-image'),
  addImage: (imageInput: unknown) => ipcRenderer.invoke('sticky-notes:add-image', imageInput),
  deleteImage: (imageId: string) => ipcRenderer.invoke('sticky-notes:delete-image', imageId),
  deleteCurrentNote: () => ipcRenderer.invoke('sticky-notes:delete-current-note')
});
