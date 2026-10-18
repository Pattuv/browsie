import {
  app,
  BrowserWindow,
  Menu,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachTabs, handleShortcut } from "./browser/tabs";
import { getData } from "./data/localStore";

const disableZoom = (webContents: Electron.WebContents) => {
  webContents.setVisualZoomLevelLimits(1, 1);
  webContents.setZoomFactor(1);

  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const isZoomKey = ["+", "-", "=", "0", "Plus", "Minus"].includes(input.key);

    if (input.control && isZoomKey) {
      event.preventDefault();
    }
  });
};

// Packaged builds get the icon baked in by forge.config.js. `npm start` runs stock Electron, so set it by hand.
const DEV_ICONS_DIR = "src/renderer/assets/icons";

const devIconPath = (file: string) =>
  app.isPackaged ? undefined : path.join(app.getAppPath(), DEV_ICONS_DIR, file);

/** Shared chrome: hidden title bar, custom caption buttons in the renderer. */
const windowChromeOptions = (): Partial<BrowserWindowConstructorOptions> => ({
  titleBarStyle: "hidden",
  backgroundColor: "#ffffff",
  icon: devIconPath("windows/icon.ico"),
  autoHideMenuBar: true,
  minimizable: true,
  maximizable: true,
  resizable: true,
  fullscreenable: false,
});

export const setAppMenu = () => {
  Menu.setApplicationMenu(null);
};

// __dirname is .vite/build at runtime (Vite bundles main there), so this path
// does not depend on where this source file lives.
const rendererIndexPath = () =>
  path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

// Windows paths are case-insensitive and the drive letter's case varies (C: vs c:), so compare normalized.
const isSamePath = (a: string, b: string) =>
  path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

// "Is this one of Browsie's own pages?" Dev: anything on the Vite dev server.
// Packaged: exactly our index.html on disk (any ?window=... query is fine).
export const isAppUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }

    return (
      url.protocol === "file:" &&
      isSamePath(fileURLToPath(url), rendererIndexPath())
    );
  } catch {
    return false;
  }
};

// Our windows carry the preload (window.browsie), so they must never wander off to another site
// or pop open new windows. Real websites will live in separate tabs that get no preload.
const lockNavigation = (webContents: Electron.WebContents) => {
  webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
};

const loadRenderer = (
  window: BrowserWindow,
  windowKind?: "menu-picker" | "browser",
) => {
  const search = windowKind ? `?window=${windowKind}` : "";

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${search}`);
    return;
  }

  window.loadFile(rendererIndexPath(), {
    search: search.replace(/^\?/, ""),
  });
};

const wireWindowStateEvents = (window: BrowserWindow) => {
  const notify = () => {
    window.webContents.send("window-maximized-changed", window.isMaximized());
  };

  window.on("maximize", notify);
  window.on("unmaximize", notify);
};

// At most one of each. Kept so "Change mode" can reuse them instead of stacking duplicates.
let mainWindow: BrowserWindow | null = null;
let menuPickerWindow: BrowserWindow | null = null;
let browserWindow: BrowserWindow | null = null;
// Set once the whole app is quitting, so closing the browser doesn't reopen the Dashboard on the way out.
let quitting = false;
// True while the Dashboard is gone and the browser window does not exist yet.
let holdingLastWindow = false;

export const shouldQuitOnLastWindow = () => !holdingLastWindow;

app.on("before-quit", () => {
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
      preload: path.join(__dirname, "preload.js"),
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // BrowserWindow has no `maximized` constructor option; this is the equivalent.
  mainWindow.maximize();
  disableZoom(mainWindow.webContents);
  lockNavigation(mainWindow.webContents);
  wireWindowStateEvents(mainWindow);
  loadRenderer(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
};

const createMenuPickerWindow = () => {
  menuPickerWindow = new BrowserWindow({
    width: 640,
    height: 500,
    minWidth: 640,
    minHeight: 570,
    ...windowChromeOptions(),
    // A small picker, not a workspace. Also stops double-clicking the drag region from maximizing it.
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  disableZoom(menuPickerWindow.webContents);
  lockNavigation(menuPickerWindow.webContents);
  wireWindowStateEvents(menuPickerWindow);
  loadRenderer(menuPickerWindow, "menu-picker");

  // Create main before this window finishes closing so window-all-closed
  // does not quit the app during the handoff.
  // Opened from "Change mode", main is already there, so don't make a second one.
  menuPickerWindow.on("close", () => {
    if (hasUserMode() && !mainWindow) {
      createMainWindow();
    }
  });
  menuPickerWindow.on("closed", () => {
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
};

// "Change mode" in the profile menu: bring up the picker (or the one already open).
export const openModePicker = () => {
  if (menuPickerWindow) {
    menuPickerWindow.focus();
    return;
  }

  createMenuPickerWindow();
};

// How long the desktop stays up after the Dashboard has closed, before the browser is created.
const BROWSER_HANDOFF_MS = 400;

// The browser: one frameless window that fills the display and cannot be resized or moved.
// Its own page is the chrome (tabs, address bar), which is trusted and gets the preload.
// Websites are separate views on top (see browser/tabs.ts).
// Created only after the Dashboard has closed and the handoff has elapsed. Nothing is constructed before that.
const createBrowserWindow = (display: Electron.Display) => {
  const window = new BrowserWindow({
    ...display.bounds,
    // Hidden until the splash has painted, so the first thing on screen is the spinner.
    // Not created fullscreen: Windows ignores `show: false` and plays the fullscreen animation immediately.
    show: false,
    frame: false,
    fullscreenable: true,
    // Left resizable until kiosk is entered. `resizable: false` pins min and max size,
    // and that pin blocks the window from growing to cover the display.
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    paintWhenInitiallyHidden: true,
    // Solid. A transparent window on a second monitor is what flickered.
    backgroundColor: "#111111",
    icon: devIconPath("windows/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // The startup sound plays without anyone clicking first.
      autoplayPolicy: "no-user-gesture-required",
      // A video's HTML fullscreen must not resize this window. It is already the whole display.
      disableHtmlFullscreenWindowResize: true,
    },
  });
  browserWindow = window;
  holdingLastWindow = false;

  disableZoom(window.webContents);
  lockNavigation(window.webContents);
  window.webContents.on("before-input-event", (event, input) => {
    if (handleShortcut(input, "chrome")) {
      event.preventDefault();
    }
  });

  // Manual drags only. setBounds / setKiosk do not emit these, so the lock
  // does not fight the transition into kiosk.
  window.on("will-resize", (event) => {
    event.preventDefault();
  });
  window.on("will-move", (event) => {
    event.preventDefault();
  });

  const lockChrome = () => {
    if (window.isDestroyed()) {
      return;
    }

    window.setResizable(false);
    window.setMovable(false);
    window.setMinimizable(false);
    window.setMaximizable(false);
  };

  // Armed once the open transition has finished. Forcing kiosk back during show() makes
  // Windows leave and re-enter it, which flashes the whole display.
  let enforceFullscreen = false;
  let enteringFullscreen = false;

  // Cover the whole display, including the taskbar, then freeze the size.
  // Resizable has to stay on until that cover happens (see the constructor note).
  const enterExclusiveFullscreen = () => {
    if (window.isDestroyed() || enteringFullscreen) {
      return;
    }

    if (window.isKiosk()) {
      lockChrome();
      return;
    }

    enteringFullscreen = true;

    try {
      window.setResizable(true);

      const target = screen.getDisplayMatching(window.getBounds());
      window.setBounds(target.bounds);
      window.setKiosk(true);

      if (window.isKiosk()) {
        lockChrome();
      }
    } finally {
      enteringFullscreen = false;
    }
  };

  window.on("enter-full-screen", lockChrome);
  window.on("leave-full-screen", () => {
    if (enforceFullscreen) {
      enterExclusiveFullscreen();
    }
  });
  window.on("resize", () => {
    if (!enforceFullscreen || enteringFullscreen || window.isDestroyed()) {
      return;
    }

    if (!window.isKiosk()) {
      enterExclusiveFullscreen();
    }
  });

  attachTabs(window);

  window.once("ready-to-show", () => {
    // First frame is the deep gray splash and the spinner.
    if (window.isDestroyed()) {
      return;
    }

    enterExclusiveFullscreen();
    window.show();
    window.focus();

    // A kiosk request made while the window was hidden can be dropped.
    // Enter once more only if it never took, so Windows does not leave and re-enter.
    if (!window.isKiosk()) {
      enterExclusiveFullscreen();
    }

    setTimeout(() => {
      if (window.isDestroyed()) {
        return;
      }

      enforceFullscreen = true;
      enterExclusiveFullscreen();
    }, 700);
  });

  // Leaving the browser lands back on the Dashboard. Opened in 'close' (before the window is gone)
  // for the same zero-windows reason.
  window.on("close", () => {
    if (!quitting && !mainWindow) {
      createMainWindow();
    }
  });
  window.on("closed", () => {
    browserWindow = null;
  });

  loadRenderer(window, "browser");
};

// "Open browser" on the Dashboard. Takes no URL or options on purpose: the renderer can only say "go".
// Closes the Dashboard first. The browser window is created only after that close, plus the handoff.
export const openBrowser = () => {
  if (browserWindow) {
    bringToFront(browserWindow);
    return;
  }

  if (holdingLastWindow) {
    return;
  }

  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();

  const launch = () => {
    setTimeout(() => {
      if (quitting) {
        holdingLastWindow = false;
        return;
      }

      createBrowserWindow(display);
    }, BROWSER_HANDOFF_MS);
  };

  holdingLastWindow = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.once("closed", launch);
    mainWindow.close();
    return;
  }

  launch();
};

export const createWindow = () => {
  if (!hasUserMode()) {
    createMenuPickerWindow();
    return;
  }

  createMainWindow();
};
