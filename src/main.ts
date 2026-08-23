import { app, BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let dashboardAnimatedThisSession = false;

type UserMode = 'caretaker' | 'independent';

const userModePath = () => path.join(app.getPath('userData'), 'user-mode.json');

const hasUserMode = () => fs.existsSync(userModePath());

const saveUserMode = (mode: UserMode) => {
  fs.writeFileSync(userModePath(), JSON.stringify({ mode }, null, 2));
};

const disableZoom = (webContents: Electron.WebContents) => {
  webContents.setVisualZoomLevelLimits(1, 1);
  webContents.setZoomFactor(1);

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    const hasZoomModifier = input.control || input.meta;
    const isZoomKey = ['+', '-', '=', '0', 'Plus', 'Minus'].includes(input.key);

    if (hasZoomModifier && isZoomKey) {
      event.preventDefault();
    }
  });
};

const setAppMenu = () => {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const loadRenderer = (window: BrowserWindow, windowKind?: 'menu-picker') => {
  const search = windowKind ? `?window=${windowKind}` : '';

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${search}`);
    return;
  }

  window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
    search: search.replace(/^\?/, ''),
  });
};

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1250,
    height: 800,
    minWidth: 680,
    minHeight: 480,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 32, y: 32 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  disableZoom(mainWindow.webContents);
  loadRenderer(mainWindow);

  return mainWindow;
};

const createMenuPickerWindow = () => {
  const menuPickerWindow = new BrowserWindow({
    width: 640,
    height: 600,
    minWidth: 640,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 32, y: 32 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  disableZoom(menuPickerWindow.webContents);
  loadRenderer(menuPickerWindow, 'menu-picker');

  // Create main before this window finishes closing so window-all-closed
  // does not quit the app on Windows/Linux during the handoff.
  menuPickerWindow.on('close', () => {
    if (hasUserMode()) {
      createMainWindow();
    }
  });

  return menuPickerWindow;
};

const createWindow = () => {
  createMenuPickerWindow();
};

// This method will be called when Electron has finished initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('should-animate-dashboard', () => !dashboardAnimatedThisSession);
  ipcMain.handle('mark-dashboard-played', () => {
    dashboardAnimatedThisSession = true;
  });
  ipcMain.handle('save-user-mode', (event, mode: UserMode) => {
    // Independent mode is stubbed in the UI until that experience ships.
    if (mode !== 'caretaker') {
      throw new Error('Only caretaker mode is available right now.');
    }

    saveUserMode(mode);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  setAppMenu();
  createWindow();

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
