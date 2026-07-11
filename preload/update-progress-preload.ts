import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { UPDATE_PROGRESS_CHANNEL } from '../shared/update-progress';

contextBridge.exposeInMainWorld('updateProgress', {
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: unknown): void => {
      listener(snapshot);
    };
    ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL, wrapped);
    };
  }
});
