import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { loadSession } from './auth/session';
import { configureWebSession } from './browser/webSession';
import { loadLocalStore } from './data/localStore';
import { startSync } from './data/syncEngine';
import { registerIpc } from './ipc';
import { createWindow, setAppMenu, setDevDockIcon } from './windows';

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
  loadSession();
  configureWebSession();
  registerIpc();
  setAppMenu();
  setDevDockIcon();
  createWindow();
  startSync();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
