import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cancelSignIn, completeSetup, connectWorkspace, getAccountId, getSession, signIn, signOut } from './auth/session';
import { removeWebData } from './browser/webSession';
import { getData, updateData } from './data/localStore';
import { removeAiKey, replaceManagementKey, saveAiKey, updateAiCap } from './data/aiKey';
import { clearAiUsageCache, getAiUsage } from './data/openRouterUsage';
import { removeLibraryData } from './data/libraryPaths';
import { getSyncStatus, uploadBeforeRemoving } from './data/syncEngine';
import {
  activateTab,
  captureActivePage,
  closeTab,
  getBrowserState,
  isTalking,
  markChromeReady,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  reload,
  setContentBounds,
  setLockdown,
  setOverlayOpen,
  showBookmarkMenu,
  showTabMenu,
  stop,
  bookmarkActivePage,
  openBrowsiePage,
} from './browser/tabs';
import { listBookmarks, moveBookmark, removeBookmark, updateBookmark } from './data/bookmarks';
import { clearHistory, listHistory, removeVisit, searchHistory } from './data/history';
import { changeSitePermission, clearSiteData, getSiteInfo, resetActiveSitePermissions } from './browser/siteInfo';
import { getSuggestionImage, getSuggestions, warmSuggestions } from './browser/suggestions';
import { clearSessionTurns, getSessionTurns } from './agent';
import { bringToFront, getBrowserWindow, isAppUrl, openBrowser, openModePicker } from './windows';

let dashboardAnimatedThisSession = false;

// Refuse any request that didn't come from one of our own pages (e.g. a website that somehow
// ended up with the preload). senderFrame is null if the frame was already gone.
const assertTrustedSender = (event: IpcMainInvokeEvent) => {
  const url = event.senderFrame?.url;

  if (!url || !isAppUrl(url)) {
    throw new Error(`Blocked IPC from untrusted sender: ${url ?? 'unknown'}`);
  }
};

// ipcMain.handle, but every channel gets the sender check first. Use this instead of ipcMain.handle.
const handle = <Args extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return listener(event, ...(args as Args));
  });
};

// Tab controls get a second check: only the browser window's own chrome may drive tabs,
// not the Dashboard or the mode picker (which are trusted pages, just not this one).
const handleFromBrowser = <Args extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
) => {
  handle<Args>(channel, (event, ...args) => {
    if (event.sender !== getBrowserWindow()?.webContents) {
      throw new Error(`Blocked ${channel}: only the browser window can control tabs.`);
    }

    return listener(event, ...args);
  });
};

// Only real web links. Without this, the renderer could ask the OS to open file:// paths or
// other apps' custom URL schemes.
const openWebLink = (rawUrl: string) => {
  const { protocol } = new URL(rawUrl);

  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Refusing to open non-web URL: ${protocol}`);
  }

  return shell.openExternal(rawUrl);
};

// Every IPC channel lives here, so there is one place to audit what the renderer can ask for.
export const registerIpc = () => {
  handle('open-external', (_event, url: string) => openWebLink(url));
  handle('should-animate-dashboard', () => !dashboardAnimatedThisSession);
  handle('mark-dashboard-played', () => {
    dashboardAnimatedThisSession = true;
  });
  handle('open-mode-picker', () => openModePicker());

  handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  handle('window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    if (win?.isMaximized()) {
      win.unmaximize();
    } else if (win?.isMaximizable()) {
      win.maximize();
    }
  });
  handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  handle('window-is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);

  handle('data:get', () => getData());
  handle('data:update', (_event, patch: unknown) => {
    // Independent mode is stubbed in the UI until that experience ships.
    if ((patch as AppDataPatch | null)?.userMode === 'independent') {
      throw new Error('Only caretaker mode is available right now.');
    }

    return updateData(patch);
  });
  handle('sync:get-status', () => getSyncStatus());

  handle('browser:launch', () => openBrowser());
  handleFromBrowser('browser:exit', () => getBrowserWindow()?.close());
  handleFromBrowser('browser:get-state', () => getBrowserState());
  handleFromBrowser('session:get', () => getSessionTurns());
  handleFromBrowser('session:clear', () => clearSessionTurns());
  handleFromBrowser('browser:new-tab', (_event, url?: unknown) =>
    newTab(typeof url === 'string' ? url : undefined),
  );
  handleFromBrowser('browser:close-tab', (_event, id: unknown) => closeTab(id));
  handleFromBrowser('browser:activate-tab', (_event, id: unknown) => activateTab(id));
  handleFromBrowser('browser:move-tab', (_event, id: unknown, index: unknown) => moveTab(id, index));
  handleFromBrowser('browser:navigate', (_event, input: unknown) => navigate(input));
  handleFromBrowser('browser:suggest', (_event, query: unknown) => getSuggestions(query));
  handleFromBrowser('browser:warm-suggestions', () => warmSuggestions());
  handleFromBrowser('browser:suggestion-image', (_event, url: unknown) => getSuggestionImage(url));
  handleFromBrowser('browser:back', () => goBack());
  handleFromBrowser('browser:forward', () => goForward());
  handleFromBrowser('browser:reload', () => reload());
  handleFromBrowser('browser:stop', () => stop());

  handleFromBrowser('library:list-bookmarks', () => listBookmarks());
  handleFromBrowser('library:bookmark-page', () => bookmarkActivePage());
  handleFromBrowser('library:update-bookmark', (_event, id: unknown, patch: unknown) => updateBookmark(id, patch));
  handleFromBrowser('library:move-bookmark', (_event, id: unknown, direction: unknown) => moveBookmark(id, direction));
  handleFromBrowser('browser:open-page', (_event, page: unknown) => openBrowsiePage(page));
  handleFromBrowser('library:remove-bookmark', (_event, id: unknown) => removeBookmark(id));
  handleFromBrowser('library:list-history', (_event, options: unknown) => listHistory(options));
  handleFromBrowser('library:search-history', (_event, query: unknown) => searchHistory(query));
  handleFromBrowser('library:remove-visit', (_event, id: unknown) => removeVisit(id));
  handleFromBrowser('library:clear-history', () => clearHistory());
  handleFromBrowser('browser:show-tab-menu', (_event, id: unknown) => showTabMenu(id));
  handleFromBrowser('library:show-bookmark-menu', (_event, id: unknown) => showBookmarkMenu(id));
  handleFromBrowser('browser:set-content-bounds', (_event, bounds: unknown) => setContentBounds(bounds));
  handleFromBrowser('browser:capture-page', () => captureActivePage());
  handleFromBrowser('browser:set-overlay-open', (_event, open: unknown) => setOverlayOpen(open === true));
  handleFromBrowser('browser:set-lockdown', (_event, enabled: unknown) => setLockdown(enabled === true));
  handleFromBrowser('browser:chrome-ready', () => markChromeReady());
  handleFromBrowser('browser:get-site-info', () => getSiteInfo());
  handleFromBrowser('browser:clear-site-data', () => clearSiteData());
  handleFromBrowser('browser:set-site-permission', (_event, kind: unknown, setting: unknown) =>
    changeSitePermission(kind, setting),
  );
  handleFromBrowser('browser:reset-site-permissions', () => resetActiveSitePermissions());

  handle('speech:is-held', () => isTalking());
  handle('auth:get-session', () => getSession());
  handle('auth:sign-in', (event) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    return signIn(() => requester && bringToFront(requester));
  });
  handle('auth:cancel-sign-in', () => cancelSignIn());
  handle('auth:complete-setup', () => completeSetup());
  handle('auth:connect-google', (event) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    return connectWorkspace(() => requester && bringToFront(requester));
  });
  handle('auth:save-ai-key', async (_event, key: unknown, cap: unknown) => {
    const accountId = getAccountId();
    const result = accountId ? await saveAiKey(accountId, key, cap) : 'unavailable';

    // A replaced key shows its own usage straight away, not the old key's cached figures.
    if (result === 'saved') {
      clearAiUsageCache();
    }

    return result;
  });
  handle('auth:update-ai-cap', async (_event, cap: unknown) => {
    const accountId = getAccountId();
    const result = accountId ? await updateAiCap(accountId, cap) : 'unavailable';

    if (result === 'saved') {
      clearAiUsageCache();
    }

    return result;
  });
  handle('auth:replace-management-key', async (_event, key: unknown, cap: unknown) => {
    const accountId = getAccountId();
    const result = accountId ? await replaceManagementKey(accountId, key, cap) : 'unavailable';

    if (result === 'saved') {
      clearAiUsageCache();
    }

    return result;
  });
  // Any of our windows: the profile menu (and its usage card) is on the Dashboard and in the browser.
  handle('ai:get-usage', () => getAiUsage());
  handle('auth:sign-out', async (_event, options: unknown) => {
    const accountId = getAccountId();
    const removeDeviceData = (options as { removeDeviceData?: unknown } | null)?.removeDeviceData === true;
    const resetSetup = (options as { resetSetup?: unknown } | null)?.resetSetup === true;

    // Bookmarks and history are about to be deleted here; make sure Drive has the latest first.
    if (accountId && removeDeviceData) {
      await uploadBeforeRemoving();
    }

    // signOut switches the tabs, bookmarks and history off this account straight away, then waits on
    // Google to revoke the token. Don't make the device wipe wait for the network.
    const revoked = signOut({ resetSetup });

    if (accountId && removeDeviceData) {
      await removeWebData(accountId);
      removeLibraryData(accountId);
    }

    // The OpenRouter key spends the user's money, so it goes with any wipe, factory reset included.
    if (accountId && (removeDeviceData || resetSetup)) {
      removeAiKey(accountId);
    }

    await revoked;

    // Factory reset leaves the browser. Closing it opens the main window, which is now the sign-in screen.
    if (resetSetup) {
      getBrowserWindow()?.close();
    }
  });
};
