const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('theo', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
