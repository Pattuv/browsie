import { BrowserWindow, ipcMain, shell } from 'electron';
import { cancelSignIn, getSession, signIn, signOut } from './auth/session';
import { readUserMode, saveUserMode, type UserMode } from './userMode';

let dashboardAnimatedThisSession = false;

// Every ipcMain.handle lives here, so there is one place to audit what the renderer can ask for.
export const registerIpc = () => {
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('should-animate-dashboard', () => !dashboardAnimatedThisSession);
  ipcMain.handle('mark-dashboard-played', () => {
    dashboardAnimatedThisSession = true;
  });
  ipcMain.handle('get-user-mode', () => readUserMode());
  ipcMain.handle('save-user-mode', (event, mode: UserMode) => {
    // Independent mode is stubbed in the UI until that experience ships.
    if (mode !== 'caretaker') {
      throw new Error('Only caretaker mode is available right now.');
    }

    saveUserMode(mode);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('auth:get-session', () => getSession());
  ipcMain.handle('auth:sign-in', () => signIn());
  ipcMain.handle('auth:cancel-sign-in', () => cancelSignIn());
  ipcMain.handle('auth:sign-out', () => signOut());
};
