import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cancelSignIn, getSession, signIn, signOut } from './auth/session';
import { readUserMode, saveUserMode, type UserMode } from './userMode';
import { isAppUrl } from './windows';

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
  handle('get-user-mode', () => readUserMode());
  handle('save-user-mode', (event, mode: UserMode) => {
    // Independent mode is stubbed in the UI until that experience ships.
    if (mode !== 'caretaker') {
      throw new Error('Only caretaker mode is available right now.');
    }

    saveUserMode(mode);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  handle('auth:get-session', () => getSession());
  handle('auth:sign-in', () => signIn());
  handle('auth:cancel-sign-in', () => cancelSignIn());
  handle('auth:sign-out', () => signOut());
};
