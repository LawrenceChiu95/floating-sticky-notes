import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { UPDATE_PROGRESS_CHANNEL } from '../shared/update-progress';

console.info('[update-progress-debug] preload.loaded');

contextBridge.exposeInMainWorld('updateProgress', {
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    console.info('[update-progress-debug] preload.subscription-installed');
    const wrapped = (_event: IpcRendererEvent, snapshot: unknown): void => {
      console.info('[update-progress-debug] preload.snapshot-received', snapshot);
      listener(snapshot);
    };
    ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL, wrapped);
    };
  }
});
