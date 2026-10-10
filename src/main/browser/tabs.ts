import {
  BrowserWindow,
  Menu,
  WebContentsView,
  clipboard,
  type ContextMenuParams,
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { WEB_PARTITION, isWebUrl } from './webSession';

// One tab. `view` stays null while the tab shows Browsie's own New Tab page, which the chrome
// draws itself. A website only gets a view (its own sandboxed process) once one is opened.
type Tab = {
  id: number;
  view: WebContentsView | null;
  // What we asked the view to load, shown until the page reports its real URL.
  pendingUrl: string | null;
};

const SEARCH_URL = 'https://www.google.com/search?q=';
const MAX_INPUT_LENGTH = 2048;
const MAX_TABS = 50;
const ZOOM_STEP = 0.5;
const MIN_ZOOM = -3;
const MAX_ZOOM = 5;
// "google.com", "news.bbc.co.uk/path", "localhost:3000". Anything else typed becomes a search.
const LOOKS_LIKE_HOST = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i;

// Main owns the tabs; the chrome only ever sees the snapshot from getBrowserState().
let host: BrowserWindow | null = null;
let tabs: Tab[] = [];
let activeTabId = 0;
let nextTabId = 1;
// Where the page area sits inside the window. Null until the chrome has measured it.
let contentBounds: ContentBounds | null = null;
// A chrome popover is open. Views always paint above the chrome, so they step aside for it.
let overlayOpen = false;
// The tab playing a video (or anything else) in HTML fullscreen, if any.
let fullscreenTabId: number | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const activeTab = () => tabs.find((tab) => tab.id === activeTabId);
const activeContents = () => activeTab()?.view?.webContents;

const describeTab = ({ id, view, pendingUrl }: Tab): BrowserTab => {
  if (!view) {
    return { id, title: 'New Tab', url: null, loading: false, canGoBack: false, canGoForward: false };
  }

  const contents = view.webContents;
  const url = contents.getURL() || pendingUrl || 'about:blank';

  return {
    id,
    title: contents.getTitle() || url,
    url,
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };
};

export const getBrowserState = (): BrowserState => ({ tabs: tabs.map(describeTab), activeTabId });

const emit = () => {
  if (host && !host.isDestroyed()) {
    host.webContents.send('browser:state-changed', getBrowserState());
  }
};

// Puts every view where it belongs: only the active tab is visible, inside the page card,
// or covering the whole screen while it's in HTML fullscreen.
const layout = () => {
  if (!host || host.isDestroyed()) {
    return;
  }

  const [width, height] = host.getContentSize();

  for (const tab of tabs) {
    if (!tab.view) {
      continue;
    }

    const isFullscreen = tab.id === fullscreenTabId;
    const visible = tab.id === activeTabId && (isFullscreen || (contentBounds !== null && !overlayOpen));
    tab.view.setVisible(visible);

    if (!visible) {
      continue;
    }

    tab.view.setBounds(isFullscreen || !contentBounds ? { x: 0, y: 0, width, height } : contentBounds);
  }
};

// Typed text → a safe web address. Real http(s) URLs pass through, things that look like a
// domain get https:// added, and everything else (including file:, javascript:) is searched for.
const toUrl = (input: unknown) => {
  if (typeof input !== 'string') {
    throw new Error('Address must be text.');
  }

  const text = input.trim().slice(0, MAX_INPUT_LENGTH);

  if (!text) {
    throw new Error('Address is empty.');
  }

  if (isWebUrl(text)) {
    return new URL(text).href;
  }

  if (!/\s/.test(text) && LOOKS_LIKE_HOST.test(text)) {
    const candidate = `${text.startsWith('localhost') ? 'http' : 'https'}://${text}`;

    if (isWebUrl(candidate)) {
      return new URL(candidate).href;
    }
  }

  return SEARCH_URL + encodeURIComponent(text);
};

const showContextMenu = (contents: WebContents, params: ContextMenuParams) => {
  const items: MenuItemConstructorOptions[] = [];

  if (params.linkURL && isWebUrl(params.linkURL)) {
    items.push(
      { label: 'Open link in new tab', click: () => newTab(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }

  if (params.isEditable) {
    items.push(
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
    );
  } else if (params.selectionText.trim()) {
    items.push({ role: 'copy' }, { type: 'separator' });
  }

  items.push(
    { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
    {
      label: 'Forward',
      enabled: contents.navigationHistory.canGoForward(),
      click: () => contents.navigationHistory.goForward(),
    },
    { label: 'Reload', click: () => contents.reload() },
  );

  Menu.buildFromTemplate(items).popup(host ? { window: host } : undefined);
};

// The rules every website lives by. This is the security boundary, so it's all in one place.
const wireContents = (tab: Tab, contents: WebContents) => {
  // Popups and target=_blank links become tabs, never new OS windows.
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      newTab(url);
    }

    return { action: 'deny' };
  });

  const blockNonWeb = (event: Electron.Event, url: string) => {
    if (!isWebUrl(url)) {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', blockNonWeb);
  contents.on('will-redirect', blockNonWeb);

  contents.on('did-start-loading', emit);
  contents.on('did-stop-loading', emit);
  contents.on('did-navigate', emit);
  contents.on('did-navigate-in-page', emit);
  contents.on('page-title-updated', emit);
  contents.on('render-process-gone', emit);

  contents.on('enter-html-full-screen', () => {
    fullscreenTabId = tab.id;
    layout();
  });
  contents.on('leave-html-full-screen', () => {
    fullscreenTabId = null;
    layout();
  });

  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input, 'tab')) {
      event.preventDefault();
    }
  });
  contents.on('context-menu', (_event, params) => showContextMenu(contents, params));
};

const createView = (tab: Tab) => {
  // No preload: websites never get window.browsie. Sandboxed, isolated, no Node, no <webview>.
  const view = new WebContentsView({
    webPreferences: {
      partition: WEB_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      safeDialogs: true,
    },
  });

  view.setBackgroundColor('#ffffff');
  // Square corners: the page sits flush under the toolbar and in the card's square bottom.
  view.setBorderRadius(0);
  view.setVisible(false);
  host?.contentView.addChildView(view);
  tab.view = view;
  wireContents(tab, view.webContents);

  return view;
};

const destroyView = (tab: Tab) => {
  if (!tab.view) {
    return;
  }

  if (host && !host.isDestroyed()) {
    host.contentView.removeChildView(tab.view);
  }

  tab.view.webContents.close();
  tab.view = null;
};

const load = (tab: Tab, url: string) => {
  const view = tab.view ?? createView(tab);
  tab.pendingUrl = url;
  // Redirects and quick re-navigations reject with ERR_ABORTED; that's normal browsing, not an error.
  view.webContents.loadURL(url).catch(() => undefined);
  view.webContents.focus();
};

export const newTab = (url?: string) => {
  if (!host || tabs.length >= MAX_TABS) {
    return;
  }

  const tab: Tab = { id: nextTabId++, view: null, pendingUrl: null };
  tabs.push(tab);
  activeTabId = tab.id;

  if (url) {
    load(tab, url);
  }

  layout();
  emit();
};

export const closeTab = (id: unknown) => {
  const index = tabs.findIndex((tab) => tab.id === id);

  if (index === -1) {
    return;
  }

  const [tab] = tabs.splice(index, 1);
  destroyView(tab);

  if (fullscreenTabId === tab.id) {
    fullscreenTabId = null;
  }

  // Closing the last tab leaves a fresh New Tab instead of the window: nobody gets dropped out by accident.
  if (tabs.length === 0) {
    newTab();
    return;
  }

  if (activeTabId === tab.id) {
    activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
  }

  layout();
  emit();
};

export const activateTab = (id: unknown) => {
  if (!tabs.some((tab) => tab.id === id)) {
    return;
  }

  activeTabId = id as number;
  layout();
  emit();
};

const cycleTab = (direction: 1 | -1) => {
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  activateTab(tabs[(index + direction + tabs.length) % tabs.length]?.id);
};

export const navigate = (input: unknown) => {
  const tab = activeTab();

  if (!tab) {
    return;
  }

  load(tab, toUrl(input));
  layout();
  emit();
};

export const goBack = () => activeContents()?.navigationHistory.goBack();
export const goForward = () => activeContents()?.navigationHistory.goForward();
export const reload = () => activeContents()?.reload();
export const stop = () => activeContents()?.stop();

// The chrome measures its page area and reports it here. It's still input from a renderer, so check it.
export const setContentBounds = (raw: unknown) => {
  const bounds = raw as Partial<ContentBounds> | null;
  const values = [bounds?.x, bounds?.y, bounds?.width, bounds?.height];

  if (!host || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Invalid content bounds.');
  }

  const [windowWidth, windowHeight] = host.getContentSize();
  const x = clamp(Math.round(bounds!.x!), 0, windowWidth);
  const y = clamp(Math.round(bounds!.y!), 0, windowHeight);

  contentBounds = {
    x,
    y,
    width: clamp(Math.round(bounds!.width!), 0, windowWidth - x),
    height: clamp(Math.round(bounds!.height!), 0, windowHeight - y),
  };
  layout();
};

export const setOverlayOpen = (open: boolean) => {
  overlayOpen = open;
  layout();
};

const focusAddressBar = () => {
  if (!host || host.isDestroyed()) {
    return;
  }

  host.webContents.focus();
  host.webContents.send('browser:focus-address');
};

const zoomActiveTab = (key: string) => {
  const contents = activeContents();

  if (!contents) {
    return;
  }

  const level = key === '0' ? 0 : contents.getZoomLevel() + (key === '-' ? -ZOOM_STEP : ZOOM_STEP);
  contents.setZoomLevel(clamp(level, MIN_ZOOM, MAX_ZOOM));
};

// Browser keyboard shortcuts. Main sees keys before any page does (before-input-event), so they
// work the same whether focus is in the chrome or inside a website. Returns true if handled.
export const handleShortcut = (input: Input, source: 'chrome' | 'tab') => {
  if (input.type !== 'keyDown') {
    return false;
  }

  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  const run = (action: () => void) => {
    action();
    return true;
  };

  if (ctrl && !input.shift && key === 't') {
    return run(() => {
      newTab();
      focusAddressBar();
    });
  }

  if (ctrl && key === 'w') {
    return run(() => closeTab(activeTabId));
  }

  if ((ctrl && key === 'l') || key === 'f6' || (input.alt && key === 'd')) {
    return run(focusAddressBar);
  }

  if (input.alt && key === 'arrowleft') {
    return run(goBack);
  }

  if (input.alt && key === 'arrowright') {
    return run(goForward);
  }

  if (key === 'f5' || (ctrl && key === 'r')) {
    return run(reload);
  }

  if (ctrl && key === 'tab') {
    return run(() => cycleTab(input.shift ? -1 : 1));
  }

  // The window is always fullscreen; F11 has nothing to toggle.
  if (key === 'f11') {
    return true;
  }

  // Page zoom matters a lot for low-vision users. Browsie's own UI keeps its fixed size.
  if (source === 'tab' && ctrl && ['=', '+', '-', '0'].includes(key)) {
    return run(() => zoomActiveTab(key));
  }

  return false;
};

// Hands the tab system a window to live in and opens the first New Tab.
export const attachTabs = (window: BrowserWindow) => {
  host = window;
  tabs = [];
  activeTabId = 0;
  contentBounds = null;
  overlayOpen = false;
  fullscreenTabId = null;
  newTab();

  window.on('resize', layout);
  window.on('closed', () => {
    for (const tab of tabs) {
      tab.view?.webContents.close();
    }

    tabs = [];
    host = null;
  });
};
