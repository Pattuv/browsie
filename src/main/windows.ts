import { app, BrowserWindow, Menu, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachTabs, handleShortcut } from './browser/tabs';
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

// Packaged builds get the icon baked in by forge.config.js. `npm start` runs stock Electron, so set it by hand.
const DEV_ICONS_DIR = 'src/renderer/assets/icons';

const devIconPath = (file: string) => (app.isPackaged ? undefined : path.join(app.getAppPath(), DEV_ICONS_DIR, file));

export const setDevDockIcon = () => {
  const iconPath = devIconPath('macos/1024x1024.png');

  if (isMac && iconPath) {
    app.dock?.setIcon(iconPath);
  }
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
    icon: devIconPath(isWindows ? 'windows/icon.ico' : 'icon.png'),
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

const loadRenderer = (window: BrowserWindow, windowKind?: 'menu-picker' | 'browser') => {
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
let browserWindow: BrowserWindow | null = null;
// Set once the whole app is quitting, so closing the browser doesn't reopen the Dashboard on the way out.
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
});

export const getBrowserWindow = () => browserWindow;

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
    // A small picker, not a workspace. Also stops double-clicking the drag region from maximizing it.
    maximizable: false,
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

// Pull a window back in front of the browser after sign-in.
export const bringToFront = (window: BrowserWindow) => {
  if (window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  // Windows blocks background apps from taking focus (it just flashes the taskbar), but it will
  // raise an always-on-top window, so toggle that around focus().
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.setAlwaysOnTop(false);

  if (isMac) {
    app.focus({ steal: true });
  }
};

// "Change mode" in the profile menu: bring up the picker (or the one already open).
export const openModePicker = () => {
  if (menuPickerWindow) {
    menuPickerWindow.focus();
    return;
  }

  createMenuPickerWindow();
};

// The browser: one frameless, always-fullscreen window. Its own page is the chrome (tabs, address
// bar), which is trusted and gets the preload. Websites are separate views on top (see browser/tabs.ts).
const createBrowserWindow = () => {
  const window = new BrowserWindow({
    // Hidden until the first frame is painted, so it never flashes a half-drawn window.
    show: false,
    frame: false,
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    // The splash fades its gradient in over plain white.
    backgroundColor: '#ffffff',
    icon: devIconPath(isWindows ? 'windows/icon.ico' : isMac ? 'macos/1024x1024.png' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // The startup sound plays without anyone clicking first.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  browserWindow = window;

  disableZoom(window.webContents);
  lockNavigation(window.webContents);
  window.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input, 'chrome')) {
      event.preventDefault();
    }
  });

  // Fullscreen is the whole point, so if anything knocks us out of it (a video leaving its own
  // fullscreen, the OS), step right back in.
  window.on('leave-full-screen', () => {
    if (!window.isDestroyed()) {
      window.setFullScreen(true);
    }
  });

  attachTabs(window);

  window.once('ready-to-show', () => {
    window.setFullScreen(true);
    bringToFront(window);
    // The Dashboard goes only after the browser is up, so there's never a moment with zero
    // windows (Windows/Linux would quit the app right there).
    mainWindow?.close();
  });

  // Leaving the browser lands back on the Dashboard. Opened in 'close' (before the window is gone)
  // for the same zero-windows reason.
  window.on('close', () => {
    if (!quitting && !mainWindow) {
      createMainWindow();
    }
  });
  window.on('closed', () => {
    browserWindow = null;
  });

  loadRenderer(window, 'browser');
};

// "Open browser" on the Dashboard. Takes no URL or options on purpose: the renderer can only say "go".
export const openBrowser = () => {
  if (browserWindow) {
    bringToFront(browserWindow);
    return;
  }

  createBrowserWindow();
};

export const createWindow = () => {
  if (!hasUserMode()) {
    createMenuPickerWindow();
    return;
  }

  createMainWindow();
};
