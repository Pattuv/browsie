import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('browsie', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateDashboard: () => ipcRenderer.invoke('should-animate-dashboard'),
  markDashboardPlayed: () => ipcRenderer.invoke('mark-dashboard-played'),
});
