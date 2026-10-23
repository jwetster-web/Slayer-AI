import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The only bridge between the sandboxed renderer and the app: one invoke
// channel (validated in the main process) and one event stream.
contextBridge.exposeInMainWorld('glide', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke('glide:invoke', channel, ...args),
  on: (cb: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on('glide:event', listener);
    return () => ipcRenderer.removeListener('glide:event', listener);
  },
  platform: process.platform,
});
