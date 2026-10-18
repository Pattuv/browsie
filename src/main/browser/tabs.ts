import {
  app,
  BrowserWindow,
  Menu,
  WebContentsView,
  clipboard,
  type ContextMenuParams,
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { resolveFavicon } from './favicons';
import { WEB_PARTITION, isWebUrl } from './webSession';

// One tab. The chrome draws Browsie's own New Tab page itself; a website only gets a view
// (its own sandboxed process) once one is opened.
type Tab = {
  id: number;
  view: WebContentsView | null;
  // Showing the New Tab page. The view can still exist behind it (Back from a site's first page),
  // so Forward can bring that site straight back.
  showingNewTab: boolean;
  // The view's history began on the New Tab page, so Back from its first entry returns there.
  startedFromNewTab: boolean;
  // What we asked the view to load, shown until the page reports its real URL.
  pendingUrl: string | null;
  // The current page's icon as a data: URL, null until one has downloaded.
  favicon: string | null;
  // Bumped per lookup, so a slow download for a site we've since left can't overwrite a newer icon.
  faviconRequest: number;
  // The site (origin) the current icon or lookup belongs to.
  faviconOrigin: string | null;
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
// A chrome popover is open. Views always paint above the chrome, so the page hides while it's up;
// the chrome shows a freeze-frame of it (captureActivePage) in its place, under the popover.
let overlayOpen = false;
// The tab playing a video (or anything else) in HTML fullscreen, if any.
let fullscreenTabId: number | null = null;
// A person can't click, type, or use shortcuts. Main-process loads and scripts still work for the agent.
let lockdown = false;
const lockdownCssKey = new Map<number, string>();
const LOCKDOWN_CSS = 'html { pointer-events: none !important; }';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const activeTab = () => tabs.find((tab) => tab.id === activeTabId);
// The website the user is looking at, if any. A view hidden behind the New Tab page doesn't count.
export const activeContents = () => {
  const tab = activeTab();
  return tab?.showingNewTab ? undefined : tab?.view?.webContents;
};

const canGoBackFrom = (tab: Tab, contents: WebContents) =>
  contents.navigationHistory.canGoBack() || tab.startedFromNewTab;

const describeTab = (tab: Tab): BrowserTab => {
  const { id, view, pendingUrl, favicon } = tab;

  if (!view || tab.showingNewTab) {
    return { id, title: 'New Tab', url: null, favicon: null, loading: false, canGoBack: false, canGoForward: view !== null };
  }

  const contents = view.webContents;
  const url = contents.getURL() || pendingUrl || 'about:blank';

  return {
    id,
    title: contents.getTitle() || url,
    url,
    favicon,
    loading: contents.isLoading(),
    canGoBack: canGoBackFrom(tab, contents),
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
    const visible =
      tab.id === activeTabId && !tab.showingNewTab && (isFullscreen || (contentBounds !== null && !overlayOpen));
    tab.view.setVisible(visible);

    if (!visible) {
      continue;
    }

    if (isFullscreen || !contentBounds) {
      tab.view.setBounds({ x: 0, y: 0, width, height });
      continue;
    }

    tab.view.setBounds(contentBounds);
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

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const updateFavicon = async (tab: Tab, contents: WebContents, candidates: string[]) => {
  const request = ++tab.faviconRequest;
  tab.faviconOrigin = originOf(contents.getURL());
  const favicon = await resolveFavicon(candidates);

  if (request !== tab.faviconRequest || !tabs.includes(tab)) {
    return;
  }

  tab.favicon = favicon;
  emit();
};

// Only a different site drops the icon. Sites often navigate again right after reporting their
// icons (YouTube adds ?themeRefresh=1) without reporting them a second time.
const onNavigatedForFavicon = (tab: Tab, url: string) => {
  if (originOf(url) === tab.faviconOrigin) {
    return;
  }

  tab.favicon = null;
  tab.faviconRequest++;
  tab.faviconOrigin = null;
};

// Pages that never declare an icon usually still serve one at /favicon.ico.
const faviconFallback = (tab: Tab, contents: WebContents) => {
  const url = contents.getURL();

  if (!isWebUrl(url) || originOf(url) === tab.faviconOrigin) {
    return;
  }

  void updateFavicon(tab, contents, [new URL('/favicon.ico', url).href]);
};

const showContextMenu = (tab: Tab, contents: WebContents, params: ContextMenuParams) => {
  const items: MenuItemConstructorOptions[] = [];

  if (params.linkURL && isWebUrl(params.linkURL)) {
    items.push(
      { label: 'Open link in new tab', click: () => newTab(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }

  if (params.mediaType === 'image' && isWebUrl(params.srcURL)) {
    items.push(
      { label: 'Open image in new tab', click: () => newTab(params.srcURL) },
      { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
      { type: 'separator' },
    );
  }

  const selection = params.selectionText.trim();

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
  } else if (selection) {
    const preview = selection.length > 30 ? `${selection.slice(0, 30)}…` : selection;
    items.push(
      { role: 'copy' },
      { label: `Search Google for “${preview}”`, click: () => newTab(toUrl(selection)) },
      { type: 'separator' },
    );
  }

  items.push(
    { label: 'Back', enabled: canGoBackFrom(tab, contents), click: () => goBackIn(tab) },
    {
      label: 'Forward',
      enabled: contents.navigationHistory.canGoForward(),
      click: () => contents.navigationHistory.goForward(),
    },
    { label: 'Reload', click: () => contents.reload() },
  );

  // Developer tools are for building Browsie, not for the people using it, so packaged builds leave them out.
  if (!app.isPackaged) {
    items.push({ type: 'separator' }, { label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) });
  }

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
  contents.on('did-stop-loading', () => {
    faviconFallback(tab, contents);
    emit();
  });
  contents.on('did-navigate', (_event, url) => {
    onNavigatedForFavicon(tab, url);
    emit();
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    void updateFavicon(tab, contents, favicons);
  });
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
    if (lockdown) {
      event.preventDefault();
      return;
    }

    if (handleShortcut(input, 'tab')) {
      event.preventDefault();
    }
  });
  contents.on('context-menu', (event, params) => {
    if (lockdown) {
      event.preventDefault();
      return;
    }

    showContextMenu(tab, contents, params);
  });
  contents.on('did-finish-load', () => {
    if (lockdown) {
      void applyLockdownCss(contents);
    }
  });
};

const applyLockdownCss = async (contents: WebContents) => {
  if (!lockdown || contents.isDestroyed()) {
    return;
  }

  const key = await contents.insertCSS(LOCKDOWN_CSS);

  if (!lockdown || contents.isDestroyed()) {
    await contents.removeInsertedCSS(key).catch(() => undefined);
    return;
  }

  const previous = lockdownCssKey.get(contents.id);
  lockdownCssKey.set(contents.id, key);

  if (previous) {
    await contents.removeInsertedCSS(previous).catch(() => undefined);
  }
};

const clearLockdownCss = async (contents: WebContents) => {
  const key = lockdownCssKey.get(contents.id);
  lockdownCssKey.delete(contents.id);

  if (key && !contents.isDestroyed()) {
    await contents.removeInsertedCSS(key).catch(() => undefined);
  }
};

export const setLockdown = (enabled: boolean) => {
  lockdown = enabled;

  for (const tab of tabs) {
    const contents = tab.view?.webContents;

    if (!contents) {
      continue;
    }

    if (enabled) {
      void applyLockdownCss(contents);
    } else {
      void clearLockdownCss(contents);
    }
  }
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
  // Leaving the New Tab page starts a fresh history (like Chrome, this drops anything Forward
  // could have returned to), whose Back leads to the New Tab page.
  if (tab.showingNewTab) {
    destroyView(tab);
    tab.showingNewTab = false;
    tab.startedFromNewTab = true;
    tab.favicon = null;
    tab.faviconRequest++;
    tab.faviconOrigin = null;
  }

  const view = tab.view ?? createView(tab);
  tab.pendingUrl = url;
  // Redirects and quick re-navigations reject with ERR_ABORTED; that's normal browsing, not an error.
  view.webContents.loadURL(url).catch(() => undefined);
  view.webContents.focus();
};

const blankTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: nextTabId++,
  view: null,
  showingNewTab: false,
  startedFromNewTab: false,
  pendingUrl: null,
  favicon: null,
  faviconRequest: 0,
  faviconOrigin: null,
  ...overrides,
});

export const newTab = (url?: string) => {
  if (!host || tabs.length >= MAX_TABS) {
    return;
  }

  const tab = blankTab({ showingNewTab: !url });
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

// Back from a site's first page (when it was opened from New Tab) returns to the New Tab page;
// the site stays loaded behind it for Forward.
const goBackIn = (tab: Tab) => {
  const contents = tab.view?.webContents;

  if (tab.showingNewTab || !contents) {
    return;
  }

  if (contents.navigationHistory.canGoBack()) {
    contents.navigationHistory.goBack();
    return;
  }

  if (tab.startedFromNewTab) {
    tab.showingNewTab = true;
    host?.webContents.focus();
    layout();
    emit();
  }
};

export const goBack = () => {
  const tab = activeTab();

  if (tab) {
    goBackIn(tab);
  }
};

export const goForward = () => {
  const tab = activeTab();

  if (tab?.showingNewTab && tab.view) {
    tab.showingNewTab = false;
    tab.view.webContents.focus();
    layout();
    emit();
    return;
  }

  activeContents()?.navigationHistory.goForward();
};
// The address of the website on screen, or null on the New Tab page (or a non-web error page).
export const getActiveWebUrl = () => {
  // getURL() is empty until the first page commits, so fall back to what we asked it to load.
  const contents = activeContents();
  const url = contents && (contents.getURL() || activeTab()?.pendingUrl);
  return url && isWebUrl(url) ? url : null;
};

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

// A still image of the page the user is looking at, for the chrome to show while a popover hides the
// real page. Null when there's no website on screen (New Tab, or nothing measured yet).
export const captureActivePage = async () => {
  const tab = activeTab();

  if (!tab?.view || tab.showingNewTab || !contentBounds || overlayOpen) {
    return null;
  }

  const image = await tab.view.webContents.capturePage();
  return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(90).toString('base64')}`;
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
  if (lockdown || input.type !== 'keyDown') {
    return false;
  }

  const ctrl = input.control;
  const key = input.key.toLowerCase();
  const run = (action: () => void) => {
    action();
    return true;
  };

  // Opening and closing tabs fire once per press. Holding the keys would otherwise repeat them
  // (the OS sends repeated keyDowns), spawning or closing a whole row of tabs. Repeats are still
  // swallowed, so they don't leak through to the page either.
  const once = (action: () => void) => (input.isAutoRepeat ? true : run(action));

  if (ctrl && !input.shift && key === 't') {
    return once(() => {
      newTab();
      focusAddressBar();
    });
  }

  // Ctrl+1 to Ctrl+8 jump to that tab; Ctrl+9 always jumps to the last one.
  if (ctrl && !input.shift && !input.alt && /^[1-9]$/.test(key)) {
    return run(() => activateTab((key === '9' ? tabs.at(-1) : tabs[Number(key) - 1])?.id));
  }

  if (ctrl && key === 'w') {
    return once(() => closeTab(activeTabId));
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

  // Developer tools for the website on screen, in development builds only (same as Inspect in the context menu).
  if (source === 'tab' && !app.isPackaged && (key === 'f12' || (ctrl && input.shift && key === 'i'))) {
    return run(() => activeContents()?.toggleDevTools());
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
