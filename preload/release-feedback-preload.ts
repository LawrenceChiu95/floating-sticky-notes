import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { RELEASE_FEEDBACK_CHANNELS } from '../shared/release-feedback-window';

contextBridge.exposeInMainWorld('releaseFeedback', {
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: unknown): void => {
      listener(snapshot);
    };
    ipcRenderer.on(RELEASE_FEEDBACK_CHANNELS.snapshot, wrapped);
    return () => {
      ipcRenderer.removeListener(RELEASE_FEEDBACK_CHANNELS.snapshot, wrapped);
    };
  },
  reportRendered: (payload: unknown) => {
    ipcRenderer.send(RELEASE_FEEDBACK_CHANNELS.rendered, payload);
  },
  dismiss: () => {
    ipcRenderer.send(RELEASE_FEEDBACK_CHANNELS.dismiss);
  }
});
