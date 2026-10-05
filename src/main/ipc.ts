import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cancelSignIn, getSession, signIn, signOut } from './auth/session';
import { getData, updateData } from './data/localStore';
import { getSyncStatus } from './data/syncEngine';
import { bringToFront, isAppUrl, openModePicker } from './windows';

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
  handle('open-mode-picker', () => openModePicker());

  handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  handle('window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
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

  handle('auth:get-session', () => getSession());
  handle('auth:sign-in', (event) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    return signIn(() => requester && bringToFront(requester));
  });
  handle('auth:cancel-sign-in', () => cancelSignIn());
  handle('auth:sign-out', () => signOut());
};
