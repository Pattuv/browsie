import { app, BrowserWindow, Menu, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from './data/localStore';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

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

/** Shared chrome: mac keeps traffic lights; Windows/Linux render custom caption buttons in the renderer. */
const windowChromeOptions = (): Partial<BrowserWindowConstructorOptions> => {
  if (isMac) {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 32, y: 32 },
      minimizable: false,
      maximizable: false,
      resizable: true,
      fullscreenable: false,
    };
  }

  return {
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    fullscreenable: false,
  };
};

export const setAppMenu = () => {
  if (isWindows) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
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

// __dirname is .vite/build at runtime (Vite bundles main there), so this path
// does not depend on where this source file lives.
const rendererIndexPath = () => path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

// Windows paths are case-insensitive and the drive letter's case varies (C: vs c:), so compare normalized.
const isSamePath = (a: string, b: string) =>
  isWindows ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : a === b;

// "Is this one of Browsie's own pages?" Dev: anything on the Vite dev server.
// Packaged: exactly our index.html on disk (any ?window=... query is fine).
export const isAppUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }

    return url.protocol === 'file:' && isSamePath(fileURLToPath(url), rendererIndexPath());
  } catch {
    return false;
  }
};

// Our windows carry the preload (window.browsie), so they must never wander off to another site
// or pop open new windows. Real websites will live in separate tabs that get no preload.
const lockNavigation = (webContents: Electron.WebContents) => {
  webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
};

const loadRenderer = (window: BrowserWindow, windowKind?: 'menu-picker') => {
  const search = windowKind ? `?window=${windowKind}` : '';

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${search}`);
    return;
  }

  window.loadFile(rendererIndexPath(), {
    search: search.replace(/^\?/, ''),
  });
};

const wireWindowStateEvents = (window: BrowserWindow) => {
  const notify = () => {
    window.webContents.send('window-maximized-changed', window.isMaximized());
  };

  window.on('maximize', notify);
  window.on('unmaximize', notify);
};

// At most one of each. Kept so "Change mode" can reuse them instead of stacking duplicates.
let mainWindow: BrowserWindow | null = null;
let menuPickerWindow: BrowserWindow | null = null;

const hasUserMode = () => getData().userMode !== null;

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 800,
    minWidth: 680,
    minHeight: 480,
    ...windowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // BrowserWindow has no `maximized` constructor option; this is the equivalent.
  mainWindow.maximize();
  disableZoom(mainWindow.webContents);
  lockNavigation(mainWindow.webContents);
  wireWindowStateEvents(mainWindow);
  loadRenderer(mainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
};

const createMenuPickerWindow = () => {
  menuPickerWindow = new BrowserWindow({
    width: 640,
    height: 600,
    minWidth: 640,
    minHeight: 600,
    ...windowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  disableZoom(menuPickerWindow.webContents);
  lockNavigation(menuPickerWindow.webContents);
  wireWindowStateEvents(menuPickerWindow);
  loadRenderer(menuPickerWindow, 'menu-picker');

  // Create main before this window finishes closing so window-all-closed
  // does not quit the app on Windows/Linux during the handoff.
  // Opened from "Change mode", main is already there, so don't make a second one.
  menuPickerWindow.on('close', () => {
    if (hasUserMode() && !mainWindow) {
      createMainWindow();
    }
  });
  menuPickerWindow.on('closed', () => {
    menuPickerWindow = null;
  });

  return menuPickerWindow;
};

// "Change mode" in the profile menu: bring up the picker (or the one already open).
export const openModePicker = () => {
  if (menuPickerWindow) {
    menuPickerWindow.focus();
    return;
  }

  createMenuPickerWindow();
};

export const createWindow = () => {
  if (!hasUserMode()) {
    createMenuPickerWindow();
    return;
  }

  createMainWindow();
};
