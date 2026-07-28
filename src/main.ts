import { app, BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let onboardingAnimatedThisSession = false;

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

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1150,
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
    },
  });

  disableZoom(mainWindow.webContents);

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('should-animate-onboarding', () => !onboardingAnimatedThisSession);
  ipcMain.handle('mark-onboarding-played', () => {
    onboardingAnimatedThisSession = true;
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
