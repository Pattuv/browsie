import { app } from 'electron';
import started from 'electron-squirrel-startup';
import { getAccountId, loadSession, onSessionChange } from './auth/session';
import { migrateSitePermissions } from './browser/sitePermissions';
import { resetTabsForAccount } from './browser/tabs';
import { configureWebSession, setWebAccount } from './browser/webSession';
import { setBookmarksAccount } from './data/bookmarks';
import { flushHistory, setHistoryAccount } from './data/history';
import { loadLocalStore } from './data/localStore';
import { startWebTheme } from './browser/webTheme';
import { startSync } from './data/syncEngine';
import { registerIpc } from './ipc';
import { startSystemVolume, stopSystemVolume } from './systemVolume';
import { createWindow, setAppMenu, shouldQuitOnLastWindow } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Safety net for every page Electron ever creates, ours or a website's: no <webview> tags and no
// new windows. Places that need popups (browser tabs) set their own window-open handler after this.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// This method will be called when Electron has finished initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  loadLocalStore();
  startWebTheme();
  migrateSitePermissions();
  loadSession();
  configureWebSession(getAccountId());
  setBookmarksAccount(getAccountId());
  setHistoryAccount(getAccountId());
  // Signed out, or a different account signed in: switch the tabs to that account's own web storage,
  // and the bookmarks and history to that account's own.
  onSessionChange(() => {
    setBookmarksAccount(getAccountId());
    setHistoryAccount(getAccountId());

    if (setWebAccount(getAccountId())) {
      resetTabsForAccount();
    }
  });
  registerIpc();
  setAppMenu();
  createWindow();
  startSync();
  startSystemVolume();
});

// History saves a few seconds after each visit; don't lose the last few when quitting.
app.on('will-quit', flushHistory);
app.on('will-quit', stopSystemVolume);

app.on('window-all-closed', () => {
  // Held false for the beat between the Dashboard closing and the browser opening.
  if (shouldQuitOnLastWindow()) {
    app.quit();
  }
});
