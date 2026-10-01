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

contextBridge.exposeInMainWorld('browsie', {
  auth,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateDashboard: () => ipcRenderer.invoke('should-animate-dashboard'),
  markDashboardPlayed: () => ipcRenderer.invoke('mark-dashboard-played'),
  getUserMode: () => ipcRenderer.invoke('get-user-mode'),
  saveUserMode:(mode: 'caretaker' | 'independent') => ipcRenderer.invoke('save-user-mode', mode),
});
