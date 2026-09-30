import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('browsie', {
  platform: process.platform,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateDashboard: () => ipcRenderer.invoke('should-animate-dashboard'),
  markDashboardPlayed: () => ipcRenderer.invoke('mark-dashboard-played'),
  getUserMode: () => ipcRenderer.invoke('get-user-mode'),
  saveUserMode: (mode: 'caretaker' | 'independent') => ipcRenderer.invoke('save-user-mode', mode),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize') as Promise<boolean>,
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized') as Promise<boolean>,
  onWindowMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window-maximized-changed', listener);
    return () => {
      ipcRenderer.removeListener('window-maximized-changed', listener);
    };
  },
});
