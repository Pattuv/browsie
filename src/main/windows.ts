import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { hasUserMode } from './userMode';

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

export const setAppMenu = () => {
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

  // __dirname is .vite/build at runtime (Vite bundles main there), so this path
  // does not depend on where this source file lives.
  window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
    search: search.replace(/^\?/, ''),
  });
};

export const createMainWindow = () => {
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

export const createWindow = () => {
  if (!hasUserMode()) {
    createMenuPickerWindow();
    return;
  }

  createMainWindow();
};
