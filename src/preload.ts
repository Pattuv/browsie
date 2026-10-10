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

// Only the browser window's chrome may use the tab controls; main refuses them from anywhere else.
const browser: BrowsieBrowserAPI = {
  launch: () => ipcRenderer.invoke('browser:launch'),
  exit: () => ipcRenderer.invoke('browser:exit'),
  getState: () => ipcRenderer.invoke('browser:get-state'),
  onStateChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, state: BrowserState) => callback(state);
    ipcRenderer.on('browser:state-changed', listener);
    return () => ipcRenderer.removeListener('browser:state-changed', listener);
  },
  newTab: () => ipcRenderer.invoke('browser:new-tab'),
  closeTab: (id) => ipcRenderer.invoke('browser:close-tab', id),
  activateTab: (id) => ipcRenderer.invoke('browser:activate-tab', id),
  navigate: (input) => ipcRenderer.invoke('browser:navigate', input),
  back: () => ipcRenderer.invoke('browser:back'),
  forward: () => ipcRenderer.invoke('browser:forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  stop: () => ipcRenderer.invoke('browser:stop'),
  setContentBounds: (bounds) => ipcRenderer.invoke('browser:set-content-bounds', bounds),
  capturePage: () => ipcRenderer.invoke('browser:capture-page'),
  setOverlayOpen: (open) => ipcRenderer.invoke('browser:set-overlay-open', open),
  onFocusAddress: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('browser:focus-address', listener);
    return () => ipcRenderer.removeListener('browser:focus-address', listener);
  },
};

contextBridge.exposeInMainWorld('browsie', {
  platform: process.platform,
  auth,
  data,
  browser,
  openModePicker: () => ipcRenderer.invoke('open-mode-picker'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  shouldAnimateDashboard: () => ipcRenderer.invoke('should-animate-dashboard'),
  markDashboardPlayed: () => ipcRenderer.invoke('mark-dashboard-played'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window-maximized-changed', listener);
    return () => ipcRenderer.removeListener('window-maximized-changed', listener);
  },
});
