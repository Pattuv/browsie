import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const auth: BrowsieAuthAPI = {
  getSession: () => ipcRenderer.invoke('auth:get-session'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel-sign-in'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  onSessionChanged: (callback) => {
    // Pass only the session through; the raw IPC event would hand the page a handle to ipcRenderer.
    const listener = (_event: IpcRendererEvent, session: AuthSession) => callback(session);
    ipcRenderer.on('auth:session-changed', listener);
    return () => ipcRenderer.removeListener('auth:session-changed', listener);
  },
};

const data: BrowsieDataAPI = {
  get: () => ipcRenderer.invoke('data:get'),
  update: (patch) => ipcRenderer.invoke('data:update', patch),
  onChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, appData: AppData) => callback(appData);
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  },
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  onSyncStatusChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatus) => callback(status);
    ipcRenderer.on('sync:status-changed', listener);
    return () => ipcRenderer.removeListener('sync:status-changed', listener);
  },
};

contextBridge.exposeInMainWorld('browsie', {
  auth,
  data,
  openModePicker: () => ipcRenderer.invoke('open-mode-picker'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateDashboard: () => ipcRenderer.invoke('should-animate-dashboard'),
  markDashboardPlayed: () => ipcRenderer.invoke('mark-dashboard-played'),
});
