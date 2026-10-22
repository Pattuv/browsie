import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// The preload runs before the page. Mark the window kind now so the first paint uses the
// browser's deep gray instead of the white body.
const windowKind = new URLSearchParams(window.location.search).get("window");
if (windowKind && document.documentElement) {
  document.documentElement.dataset.window = windowKind;
}

const auth: BrowsieAuthAPI = {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  signIn: () => ipcRenderer.invoke("auth:sign-in"),
  cancelSignIn: () => ipcRenderer.invoke("auth:cancel-sign-in"),
  completeSetup: () => ipcRenderer.invoke("auth:complete-setup"),
  saveAiKey: (key, cap) => ipcRenderer.invoke("auth:save-ai-key", key, cap),
  signOut: (options) => ipcRenderer.invoke("auth:sign-out", options),
  onSessionChanged: (callback) => {
    // Pass only the session through; the raw IPC event would hand the page a handle to ipcRenderer.
    const listener = (_event: IpcRendererEvent, session: AuthSession) =>
      callback(session);
    ipcRenderer.on("auth:session-changed", listener);
    return () => ipcRenderer.removeListener("auth:session-changed", listener);
  },
};

const data: BrowsieDataAPI = {
  get: () => ipcRenderer.invoke("data:get"),
  update: (patch) => ipcRenderer.invoke("data:update", patch),
  onChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, appData: AppData) =>
      callback(appData);
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
  getSyncStatus: () => ipcRenderer.invoke("sync:get-status"),
  onSyncStatusChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatus) =>
      callback(status);
    ipcRenderer.on("sync:status-changed", listener);
    return () => ipcRenderer.removeListener("sync:status-changed", listener);
  },
};

// Only the browser window's chrome may use the tab controls; main refuses them from anywhere else.
const browser: BrowsieBrowserAPI = {
  launch: () => ipcRenderer.invoke("browser:launch"),
  exit: () => ipcRenderer.invoke("browser:exit"),
  getState: () => ipcRenderer.invoke("browser:get-state"),
  onStateChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, state: BrowserState) =>
      callback(state);
    ipcRenderer.on("browser:state-changed", listener);
    return () => ipcRenderer.removeListener("browser:state-changed", listener);
  },
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  moveTab: (id, index) => ipcRenderer.invoke("browser:move-tab", id, index),
  navigate: (input) => ipcRenderer.invoke("browser:navigate", input),
  suggest: (query) => ipcRenderer.invoke("browser:suggest", query),
  warmSuggestions: () => ipcRenderer.invoke("browser:warm-suggestions"),
  suggestionImage: (url) => ipcRenderer.invoke("browser:suggestion-image", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  showTabMenu: (id) => ipcRenderer.invoke("browser:show-tab-menu", id),
  setContentBounds: (bounds) =>
    ipcRenderer.invoke("browser:set-content-bounds", bounds),
  capturePage: () => ipcRenderer.invoke("browser:capture-page"),
  chromeReady: () => ipcRenderer.invoke("browser:chrome-ready"),
  setOverlayOpen: (open) =>
    ipcRenderer.invoke("browser:set-overlay-open", open),
  setLockdown: (enabled) => ipcRenderer.invoke("browser:set-lockdown", enabled),
  getSiteInfo: () => ipcRenderer.invoke("browser:get-site-info"),
  clearSiteData: () => ipcRenderer.invoke("browser:clear-site-data"),
  setSitePermission: (kind, setting) =>
    ipcRenderer.invoke("browser:set-site-permission", kind, setting),
  resetSitePermissions: () => ipcRenderer.invoke("browser:reset-site-permissions"),
  onFocusAddress: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("browser:focus-address", listener);
    return () => ipcRenderer.removeListener("browser:focus-address", listener);
  },
  openPage: (page) => ipcRenderer.invoke("browser:open-page", page),
  onAgentActivity: (callback) => {
    const listener = (_event: IpcRendererEvent, activity: AgentUiActivity) => callback(activity);
    ipcRenderer.on("agent:ui-activity", listener);
    return () => ipcRenderer.removeListener("agent:ui-activity", listener);
  },
};

// Bookmarks and history. Like the tab controls, main only answers the browser window.
const library: BrowsieLibraryAPI = {
  listBookmarks: () => ipcRenderer.invoke("library:list-bookmarks"),
  bookmarkPage: () => ipcRenderer.invoke("library:bookmark-page"),
  updateBookmark: (id, change) =>
    ipcRenderer.invoke("library:update-bookmark", id, change),
  moveBookmark: (id, direction) =>
    ipcRenderer.invoke("library:move-bookmark", id, direction),
  removeBookmark: (id) => ipcRenderer.invoke("library:remove-bookmark", id),
  showBookmarkMenu: (id) => ipcRenderer.invoke("library:show-bookmark-menu", id),
  onEditBookmark: (callback) => {
    const listener = (_event: IpcRendererEvent, result: BookmarkResult) =>
      callback(result);
    ipcRenderer.on("library:edit-bookmark", listener);
    return () => ipcRenderer.removeListener("library:edit-bookmark", listener);
  },
  listHistory: (options) => ipcRenderer.invoke("library:list-history", options),
  searchHistory: (query) => ipcRenderer.invoke("library:search-history", query),
  removeVisit: (id) => ipcRenderer.invoke("library:remove-visit", id),
  clearHistory: () => ipcRenderer.invoke("library:clear-history"),
  onHistoryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("library:history-changed", listener);
    return () => ipcRenderer.removeListener("library:history-changed", listener);
  },
  onBookmarksChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, bookmarks: Bookmark[]) =>
      callback(bookmarks);
    ipcRenderer.on("library:bookmarks-changed", listener);
    return () =>
      ipcRenderer.removeListener("library:bookmarks-changed", listener);
  },
};

contextBridge.exposeInMainWorld("browsie", {
  auth,
  data,
  browser,
  library,
  openModePicker: () => ipcRenderer.invoke("open-mode-picker"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getAiUsage: () => ipcRenderer.invoke("ai:get-usage"),
  shouldAnimateDashboard: () => ipcRenderer.invoke("should-animate-dashboard"),
  markDashboardPlayed: () => ipcRenderer.invoke("mark-dashboard-played"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isWindowMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, maximized: boolean) =>
      callback(maximized);
    ipcRenderer.on("window-maximized-changed", listener);
    return () =>
      ipcRenderer.removeListener("window-maximized-changed", listener);
  },
  isSpeechHeld: () => ipcRenderer.invoke("speech:is-held"),
  onSpeechHeld: (callback: (held: boolean, deviceVolumeDb: number) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      held: boolean,
      deviceVolumeDb: number,
    ) =>
      callback(
        held === true,
        typeof deviceVolumeDb === "number" ? deviceVolumeDb : -10,
      );
    ipcRenderer.on("speech:held", listener);
    return () => ipcRenderer.removeListener("speech:held", listener);
  },
  // The speech view only: main refuses these from anywhere else.
  voice: {
    sendAudio: (wav: ArrayBuffer, durationMs: number) => ipcRenderer.invoke("voice:audio", wav, durationMs),
    reportClips: (ids: string[]) => ipcRenderer.invoke("voice:clips", ids),
    log: (message: string) => ipcRenderer.invoke("voice:log", message),
    onPlay: (callback: (item: VoicePlayItem) => void) => {
      const listener = (_event: IpcRendererEvent, item: VoicePlayItem) => callback(item);
      ipcRenderer.on("voice:play", listener);
      return () => ipcRenderer.removeListener("voice:play", listener);
    },
    onStop: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("voice:stop", listener);
      return () => ipcRenderer.removeListener("voice:stop", listener);
    },
    onStyle: (callback: (style: { volume: number; rate: number }) => void) => {
      const listener = (_event: IpcRendererEvent, style: { volume: number; rate: number }) => callback(style);
      ipcRenderer.on("voice:style", listener);
      return () => ipcRenderer.removeListener("voice:style", listener);
    },
    onStatus: (callback: (mode: VoiceMode) => void) => {
      const listener = (_event: IpcRendererEvent, mode: VoiceMode) => callback(mode);
      ipcRenderer.on("voice:status", listener);
      return () => ipcRenderer.removeListener("voice:status", listener);
    },
  },
});
