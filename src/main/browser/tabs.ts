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
  webContents as allContents,
} from 'electron';
import { getSession } from '../auth/session';
import { bookmarkPage, listBookmarks, removeBookmark } from '../data/bookmarks';
import { getData, updateData } from '../data/localStore';
import { getSystemVolumeDb } from '../systemVolume';
import { recordVisit, updateVisitTitle } from '../data/history';
import { clearFaviconCache, resolveFavicon } from './favicons';
import { getGoogleLogin, googleSignInUrl, isGoogleAccountsUrl, onGoogleLoginChange } from './googleWebLogin';
import { clearGoogleRejectionCookies, getWebPartition, isGoogleSignInRejection, isWebUrl } from './webSession';

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
  // Opened on Google's sign-in page because this account's web storage had no Google login. Turns into
  // the New Tab page once sign-in finishes.
  googleSignIn: boolean;
  // The history entry for the page on screen, so its title can be filled in when the page reports it.
  visitId: string | null;
  // Which of Browsie's own pages shows while showingNewTab is true: New Tab, History or Bookmarks.
  page: BrowsiePage;
  // Where Back goes from Browsie's own pages, newest last: an earlier Browsie page (New Tab → History),
  // or the website this page was opened over (that site's view is still loaded behind it).
  pageBack: PageBackEntry[];
  // The agent task working on this tab's website, if any. Only one tab is leased at a time.
  agentTaskId: string | null;
};

type PageBackEntry =
  | { kind: 'page'; page: BrowsiePage }
  // `origin` is the Browsie page that site was opened from, so Back from its first entry still works.
  | { kind: 'site'; origin: BrowsiePage };

const isOverSite = (tab: Tab) => tab.pageBack.some((entry) => entry.kind === 'site');

const PAGE_TITLES: Record<BrowsiePage, string> = {
  newtab: 'New Tab',
  history: 'History',
  bookmarks: 'Bookmarks',
  settings: 'Settings',
};

// browsie://history, browsie://bookmarks, browsie://settings, browsie://newtab (any case, optional trailing slash).
const browsiePageFrom = (input: unknown): BrowsiePage | null => {
  const match = typeof input === 'string' ? /^browsie:\/\/(newtab|history|bookmarks|settings)\/?$/i.exec(input.trim()) : null;
  return match ? (match[1].toLowerCase() as BrowsiePage) : null;
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
// Main owns it (the chrome mirrors it from getBrowserState): on for every new browser window.
let lockdown = true;
// Lockdown was switched off for Google sign-in, and goes back on once it finishes. Closing the sign-in
// tab (or going somewhere else in it) leaves lockdown off: the user chose to use the browser themselves.
let relockAfterGoogleSignIn = false;
// Bumped each time lockdown comes back on after Google sign-in, so the chrome shows its notice again.
let lockdownNotice = 0;
// Space held while lockdown is on. A view of its own draws the speech pill from this, above every page.
let talking = false;
// The first tab of a window or account, while we're still waiting to hear whether Google is logged in.
let startTabId: number | null = null;
// Lockdown's mouse block: a transparent view stacked over the page that takes every click, scroll and
// hover. Input the agent sends through the debugger goes straight to the page underneath, so the agent
// keeps working while a person can't. Sits above the page views and below the speech pill.
let glassView: WebContentsView | null = null;

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
    return {
      id,
      title: PAGE_TITLES[tab.page],
      url: null,
      page: tab.page,
      favicon: null,
      loading: false,
      muted: false,
      // Back: an earlier Browsie page, or the site this page was opened over. Forward: a site left with
      // Back from its first page, still loaded behind (not when that site is what Back leads to).
      canGoBack: tab.pageBack.length > 0,
      canGoForward: view !== null && !isOverSite(tab),
      agent: tab.agentTaskId !== null,
    };
  }

  const contents = view.webContents;
  const url = contents.getURL() || pendingUrl || 'about:blank';

  return {
    id,
    title: contents.getTitle() || url,
    url,
    page: null,
    favicon,
    loading: contents.isLoading(),
    muted: contents.isAudioMuted(),
    canGoBack: canGoBackFrom(tab, contents),
    canGoForward: contents.navigationHistory.canGoForward(),
    agent: tab.agentTaskId !== null,
  };
};

export const getBrowserState = (): BrowserState => ({
  tabs: tabs.map(describeTab),
  activeTabId,
  lockdown,
  lockdownNotice,
  talking,
});

const setTalking = (held: boolean) => {
  if (talking === held) {
    return;
  }

  talking = held;

  if (!held) {
    talkCooldownUntil = Date.now() + TALK_COOLDOWN_MS;
  }

  if (held) {
    showSpeechPill();
  } else {
    hideSpeechPill();
  }

  emit();
};

export const isTalking = () => talking;

// The pill's own view. Web pages are views painted above the chrome, so a pill drawn in the chrome
// either sits under them or has to shrink the page to stay visible. This view is kept above every
// page view and only covers its own rectangle, so the page underneath does not move.
// The view is a transparent slot that runs from the pill's resting spot down to the window's bottom
// edge. The pill slides up and down inside it with CSS, so the view itself never moves while shown.
const PILL_WIDTH = 104;
const PILL_HEIGHT = 48;
// Margin around the pill inside its view.
const PILL_PAD = 8;
// Gap under the pill. Clears the rotating tips at the bottom of the New Tab page.
const PILL_BOTTOM = 64;
// How long the pill takes to slide back down before the view is hidden. Matches SpeechPill's CSS.
const PILL_SLIDE_OUT_MS = 200;
// Chromium drops the keyUp that follows a keyDown main blocked, so the release would never be seen
// where the press was. While talking, focus moves to the pill's view (which lets space through), so
// the keyUp lands there. Focus goes back when the pill hides.
let speechView: WebContentsView | null = null;
let speechGeneration = 0;
let focusBeforeTalk: WebContents | null = null;
// Backstop if a keyUp is still missed: space held sends repeat keyDowns, so a quiet gap means let go.
const TALK_REPEAT_TIMEOUT_MS = 1200;
let talkWatchdog: ReturnType<typeof setTimeout> | null = null;
// After letting go, space does nothing for this long, so the pill can't be spammed. Presses during
// it don't extend it.
const TALK_COOLDOWN_MS = 1000;
let talkCooldownUntil = 0;
// Space does nothing until the chrome's launch animation has finished, and for this long after.
const TALK_AFTER_LAUNCH_MS = 500;
let talkReadyAt = Infinity;

// The chrome finished its launch animation.
export const markChromeReady = () => {
  talkReadyAt = Math.min(talkReadyAt, Date.now() + TALK_AFTER_LAUNCH_MS);
};

const placeSpeechPill = () => {
  if (!host || host.isDestroyed() || !speechView) {
    return;
  }

  const [width, height] = host.getContentSize();
  const slotHeight = PILL_PAD + PILL_HEIGHT + PILL_BOTTOM;
  speechView.setBounds({
    x: Math.round((width - PILL_WIDTH) / 2) - PILL_PAD,
    y: height - slotHeight,
    width: PILL_WIDTH + PILL_PAD * 2,
    height: slotHeight,
  });
};

// Adding a view that is already a child moves it to the top. Page views are created after this one.
const raiseSpeechPill = () => {
  if (!host || host.isDestroyed() || !speechView) {
    return;
  }

  host.contentView.addChildView(speechView);
};

const notifySpeechHeld = (held: boolean) => {
  const contents = speechView?.webContents;

  if (!contents || contents.isDestroyed()) {
    return;
  }

  // The device volume (in dB) rides along, so the pill can make up for it in its start and end sounds.
  contents.send('speech:held', held, getSystemVolumeDb());
};

// The view shows first, then the pill slides up inside it.
const showSpeechPill = () => {
  if (!host || host.isDestroyed() || !speechView) {
    return;
  }

  speechGeneration += 1;
  raiseSpeechPill();
  placeSpeechPill();
  speechView.setVisible(true);
  notifySpeechHeld(true);

  const focused = allContents.getFocusedWebContents();
  focusBeforeTalk = focused && focused !== speechView.webContents ? focused : null;
  speechView.webContents.focus();
};

// The pill slides down first, then the view hides. Pressing again mid-slide keeps it shown.
const hideSpeechPill = () => {
  const generation = ++speechGeneration;
  notifySpeechHeld(false);

  if (talkWatchdog) {
    clearTimeout(talkWatchdog);
    talkWatchdog = null;
  }

  if (focusBeforeTalk && !focusBeforeTalk.isDestroyed()) {
    focusBeforeTalk.focus();
  }

  focusBeforeTalk = null;

  setTimeout(() => {
    if (generation !== speechGeneration || talking) {
      return;
    }

    speechView?.setVisible(false);
  }, PILL_SLIDE_OUT_MS + 40);
};

// Created with the browser window. Hidden until space is held.
export const attachSpeechOverlay = (view: WebContentsView) => {
  speechView = view;
  // Transparent (ARGB), so only the pill itself shows over the page.
  view.setBackgroundColor('#00000000');
  view.setVisible(false);

  if (!host || host.isDestroyed()) {
    return;
  }

  host.contentView.addChildView(view);
  placeSpeechPill();
};

const createGlass = () => {
  const view = new WebContentsView({
    webPreferences: { partition: 'browsie-glass', sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  view.webContents.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>').catch(() => undefined);
  // Clicking the glass focuses it, so keys land here: only space (push-to-talk) does anything.
  view.webContents.on('before-input-event', (event, input) => {
    handleTalkKey(input);
    event.preventDefault();
  });
  view.webContents.on('context-menu', (event) => event.preventDefault());
  view.webContents.on('will-navigate', (event) => event.preventDefault());
  return view;
};

// Page views are added after the glass, so it's raised again over each one, with the pill above it.
const raiseGlass = () => {
  if (host && !host.isDestroyed() && glassView) {
    host.contentView.addChildView(glassView);
  }

  raiseSpeechPill();
};

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

  // The glass covers exactly the page on screen, and only while lockdown is on.
  const shown = activeTab();
  const pageVisible = Boolean(shown?.view?.getVisible());
  glassView?.setVisible(lockdown && pageVisible);

  if (lockdown && pageVisible && shown?.view) {
    glassView?.setBounds(shown.view.getBounds());
  }

  placeSpeechPill();
};

// Typed text → a safe web address. Real http(s) URLs pass through, things that look like a
// domain get https:// added, and everything else (including file:, javascript:) is searched for.
export const toUrl = (input: unknown) => {
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

const blockNonWeb = (event: Electron.Event, url: string) => {
  if (!isWebUrl(url)) {
    event.preventDefault();
  }
};

// Sign-in popups that are open right now ("Sign in with Google" on Figma, say). Closed when the account changes.
const popups = new Set<BrowserWindow>();

const POPUP_OPTIONS: Electron.BrowserWindowConstructorOptions = {
  width: 500,
  height: 680,
  backgroundColor: '#ffffff',
  // Same rules as a tab: no preload, sandboxed, isolated, no Node, no <webview>. A popup shares the
  // opener's session, so it has the same account's logins and user agent.
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, safeDialogs: true },
};

// A popup lives by the same rules as a tab, and goes away with the page that opened it.
const wirePopup = (popup: BrowserWindow, opener: WebContents) => {
  const { webContents: contents } = popup;
  popups.add(popup);
  popup.removeMenu();

  // Anything the popup opens in turn becomes a tab.
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      newTab(url);
    }

    return { action: 'deny' };
  });
  contents.on('will-navigate', blockNonWeb);
  contents.on('will-redirect', blockNonWeb);
  contents.on('will-attach-webview', (event) => event.preventDefault());

  const closeWithOpener = () => {
    if (!popup.isDestroyed()) {
      popup.close();
    }
  };
  opener.once('destroyed', closeWithOpener);
  popup.once('closed', () => {
    popups.delete(popup);
    opener.removeListener('destroyed', closeWithOpener);
  });
};

// Adds the page to history. The Google sign-in tab is skipped: sign-in steps aren't places you visited.
const noteVisit = (tab: Tab, contents: WebContents, url: string) => {
  tab.visitId = tab.googleSignIn ? null : recordVisit(url, contents.getTitle());
};

// The rules every website lives by. This is the security boundary, so it's all in one place.
const wireContents = (tab: Tab, contents: WebContents) => {
  // Links (target=_blank) become tabs. Real popups, opened with a size (the way "Sign in with Google"
  // and other sign-in buttons open), get a small window instead: the sign-in page has to report back to
  // the page that opened it through window.opener, which a separate tab doesn't have.
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isWebUrl(url)) {
      return { action: 'deny' };
    }

    if (disposition === 'new-window' && host && !host.isDestroyed()) {
      return { action: 'allow', overrideBrowserWindowOptions: { ...POPUP_OPTIONS, parent: host } };
    }

    newTab(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (popup) => wirePopup(popup, contents));

  contents.on('will-navigate', blockNonWeb);
  contents.on('will-redirect', blockNonWeb);

  contents.on('did-start-loading', emit);
  contents.on('did-stop-loading', () => {
    faviconFallback(tab, contents);
    emit();
  });
  contents.on('did-navigate', (_event, url) => {
    // So the next sign-in attempt gets a fresh chance instead of the remembered rejection.
    if (isGoogleSignInRejection(url)) {
      void clearGoogleRejectionCookies().catch(() => undefined);
    }

    onNavigatedForFavicon(tab, url);
    noteVisit(tab, contents, url);
    emit();

    // After the event, not inside it: finishing closes this very page.
    if (tab.googleSignIn) {
      setImmediate(() => finishGoogleSignIn(tab));
    }
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    void updateFavicon(tab, contents, favicons);
  });
  // Single-page sites (YouTube, Gmail) change pages without a full load. Only the page itself counts,
  // not an embedded frame.
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      noteVisit(tab, contents, url);
    }

    emit();
  });
  contents.on('page-title-updated', (_event, title) => {
    if (tab.visitId) {
      updateVisitTitle(tab.visitId, title);
    }

    emit();
  });
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
      handleTalkKey(input);
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
};

const applyLockdown = (enabled: boolean) => {
  lockdown = enabled;

  if (!enabled) {
    setTalking(false);
  }

  layout();
};

// The user's own choice, from the chrome. It replaces any pending re-lock after sign-in.
export const setLockdown = (enabled: boolean) => {
  relockAfterGoogleSignIn = false;
  applyLockdown(enabled);
  emit();
};

// Google sign-in needs a person at the keyboard. Called before the sign-in page loads.
const startGoogleSignIn = (tab: Tab) => {
  tab.googleSignIn = true;

  if (lockdown) {
    relockAfterGoogleSignIn = true;
    applyLockdown(false);
  }
};

// The tab is done with sign-in: finished (lockdown goes back on, with its notice) or abandoned (stays off).
// Callers emit afterwards.
const endGoogleSignIn = (tab: Tab, finished: boolean) => {
  if (!tab.googleSignIn) {
    return;
  }

  tab.googleSignIn = false;

  if (tabs.some((entry) => entry.googleSignIn)) {
    return;
  }

  if (finished && relockAfterGoogleSignIn) {
    applyLockdown(true);
    lockdownNotice++;
  }

  relockAfterGoogleSignIn = false;
};

const createView = (tab: Tab) => {
  // No preload: websites never get window.browsie. Sandboxed, isolated, no Node, no <webview>.
  const view = new WebContentsView({
    webPreferences: {
      partition: getWebPartition(),
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
  raiseGlass();
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
  // Leaving History or Bookmarks works the same way, and Back returns to that page.
  if (tab.showingNewTab) {
    destroyView(tab);
    tab.showingNewTab = false;
    // The site behind is gone, so Back can't lead to it any more. Earlier Browsie pages stay reachable.
    tab.pageBack = tab.pageBack.filter((entry) => entry.kind === 'page');
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
  googleSignIn: false,
  visitId: null,
  page: 'newtab',
  pageBack: [],
  agentTaskId: null,
  ...overrides,
});

export const newTab = (url?: string) => {
  if (!host || tabs.length >= MAX_TABS) {
    return;
  }

  // From the chrome: only real http(s) addresses. Internal callers already pass safe URLs.
  const target = typeof url === 'string' && isWebUrl(url) ? new URL(url).href : undefined;
  const tab = blankTab({ showingNewTab: !target });
  tabs.push(tab);
  activeTabId = tab.id;

  if (target) {
    load(tab, target);
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
  endGoogleSignIn(tab, false);

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

// Drops a tab at a new index. `toIndex` is where it should sit after the move.
export const moveTab = (id: unknown, toIndex: unknown) => {
  if (typeof id !== 'number' || typeof toIndex !== 'number' || !Number.isInteger(toIndex)) {
    return;
  }

  const from = tabs.findIndex((tab) => tab.id === id);

  if (from === -1) {
    return;
  }

  const index = clamp(toIndex, 0, tabs.length - 1);

  if (from === index) {
    return;
  }

  const [tab] = tabs.splice(from, 1);
  tabs.splice(index, 0, tab);
  emit();
};

export const cycleTab = (direction: 1 | -1) => {
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  activateTab(tabs[(index + direction + tabs.length) % tabs.length]?.id);
};

export const navigate = (input: unknown) => {
  const tab = activeTab();

  if (!tab) {
    return;
  }

  // The user chose somewhere else to go; this tab is theirs now, not the sign-in page's.
  endGoogleSignIn(tab, false);
  const page = browsiePageFrom(input);

  if (page) {
    showPage(tab, page);
    return;
  }

  load(tab, toUrl(input));
  layout();
  emit();
};

// For the agent: like navigate, but only ever to a website or a search. browsie:// addresses become a
// search too, so the agent can't open Settings by typing its address.
export const navigateToWeb = (input: string) => {
  const tab = activeTab();

  if (!tab) {
    return false;
  }

  endGoogleSignIn(tab, false);
  load(tab, toUrl(input));
  layout();
  emit();
  return true;
};

// Shows one of Browsie's own pages in this tab, remembering where Back should go: the Browsie page
// that was showing (New Tab → History), or the website it was opened over (kept loaded behind it).
const showPage = (tab: Tab, page: BrowsiePage) => {
  if (tab.showingNewTab) {
    if (tab.page === page) {
      return;
    }

    tab.pageBack.push({ kind: 'page', page: tab.page });
  } else if (tab.view) {
    tab.pageBack.push({ kind: 'site', origin: tab.page });
    tab.showingNewTab = true;
  }

  tab.page = page;

  if (fullscreenTabId === tab.id) {
    fullscreenTabId = null;
  }

  if (tab.id === activeTabId) {
    host?.webContents.focus();
  }

  layout();
  emit();
};

// From the ⋮ menu, Ctrl+H and Ctrl+Shift+O: switch to a tab already showing that page, use this tab if
// it's an empty New Tab, or open it in a new tab.
export const openBrowsiePage = (page: unknown) => {
  if (lockdown || (page !== 'history' && page !== 'bookmarks' && page !== 'settings')) {
    return;
  }

  showBrowsiePage(page);
};

// openBrowsiePage without the lockdown check, which is there to stop people, not the agent.
// The agent's command table only offers history and bookmarks, never settings.
export const showBrowsiePage = (page: 'history' | 'bookmarks' | 'settings') => {
  const open = tabs.find((tab) => tab.showingNewTab && tab.page === page);

  if (open) {
    activateTab(open.id);
    return;
  }

  const current = activeTab();

  if (current?.showingNewTab && current.page === 'newtab' && !current.view && !current.googleSignIn) {
    showPage(current, page);
    return;
  }

  if (!host || tabs.length >= MAX_TABS) {
    return;
  }

  const tab = blankTab({ showingNewTab: true, page });
  tabs.push(tab);
  activeTabId = tab.id;
  host.webContents.focus();
  layout();
  emit();
};

// Back from a site's first page (when it was opened from New Tab, History or Bookmarks) returns to
// that page; the site stays loaded behind it for Forward. Back from one of Browsie's pages goes to the
// page before it, or to the website it was opened over.
const goBackIn = (tab: Tab) => {
  const contents = tab.view?.webContents;

  if (tab.showingNewTab) {
    const previous = tab.pageBack.pop();

    if (!previous) {
      return;
    }

    if (previous.kind === 'page') {
      tab.page = previous.page;
      host?.webContents.focus();
    } else if (contents) {
      tab.page = previous.origin;
      tab.showingNewTab = false;
      contents.focus();
    }

    layout();
    emit();
    return;
  }

  if (!contents) {
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

  if (tab?.showingNewTab && tab.view && !isOverSite(tab)) {
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

// The star in the address bar and Ctrl+D. Main reads the page itself, so the chrome can only ever
// bookmark what's actually on screen. Null when there's no website to bookmark.
export const bookmarkActivePage = () => {
  const url = getActiveWebUrl();

  if (!url) {
    return null;
  }

  return bookmarkPage(url, activeContents()?.getTitle() ?? '', activeTab()?.favicon ?? null);
};

// Ctrl+D: bookmark the page, then have the chrome open the star's panel so the user can pick where it goes.
const bookmarkFromShortcut = () => {
  try {
    const result = bookmarkActivePage();

    if (result && host && !host.isDestroyed()) {
      host.webContents.focus();
      host.webContents.send('library:edit-bookmark', result);
    }
  } catch {
    // Not signed in: nowhere to save it.
  }
};

export const reload = () => activeContents()?.reload();
export const stop = () => activeContents()?.stop();

const tabContents = (tab: Tab) => (tab.showingNewTab ? undefined : tab.view?.webContents);

const reloadTab = (tab: Tab) => {
  tabContents(tab)?.reload();
};

const duplicateTab = (tab: Tab) => {
  const contents = tabContents(tab);
  const url = contents && (contents.getURL() || tab.pendingUrl);

  if (url && isWebUrl(url)) {
    newTab(url);
    return;
  }

  newTab();
};

const toggleMuteTab = (tab: Tab) => {
  const contents = tabContents(tab);

  if (!contents) {
    return;
  }

  contents.setAudioMuted(!contents.isAudioMuted());
  emit();
};

// The tab menu's actions by tab id, for the agent. False when the tab is gone (or has no page to mute).
export const duplicateTabById = (id: number) => {
  const tab = tabs.find((entry) => entry.id === id);

  if (tab) {
    duplicateTab(tab);
  }

  return Boolean(tab);
};

export const toggleMuteTabById = (id: number) => {
  const tab = tabs.find((entry) => entry.id === id);

  if (!tab || !tabContents(tab)) {
    return false;
  }

  toggleMuteTab(tab);
  return true;
};

// Right-click on a tab in the chrome. Same native menu as the page context menu.
export const showTabMenu = (id: unknown) => {
  if (typeof id !== 'number' || lockdown) {
    return;
  }

  const tab = tabs.find((entry) => entry.id === id);

  if (!tab) {
    return;
  }

  const contents = tabContents(tab);
  const muted = contents?.isAudioMuted() ?? false;

  Menu.buildFromTemplate([
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      enabled: Boolean(contents),
      click: () => reloadTab(tab),
    },
    { label: 'Duplicate', click: () => duplicateTab(tab) },
    {
      label: muted ? 'Unmute site' : 'Mute site',
      enabled: Boolean(contents),
      click: () => toggleMuteTab(tab),
    },
  ]).popup(host ? { window: host } : undefined);
};

// When the bookmarks bar shows: always, never, or only on the New Tab page. Saved with the settings
// (so it follows the account to other computers). Always, until the user picks otherwise.
const BOOKMARKS_BAR_SETTING = 'bookmarksBar';

const bookmarksBarMode = (): BookmarksBarMode => {
  const value = getData().settings[BOOKMARKS_BAR_SETTING];
  return value === 'never' || value === 'newtab' ? value : 'always';
};

export const setBookmarksBarMode = (mode: BookmarksBarMode) => {
  updateData({ settings: { [BOOKMARKS_BAR_SETTING]: mode } });
};

// Right-click on the bookmarks bar. On a bookmark: open it, open it in a new tab, or remove it. Anywhere
// on the bar (bookmark or not): open the bookmarks manager, or choose when the bar shows.
export const showBookmarkMenu = (id: unknown) => {
  if (lockdown) {
    return;
  }

  const bookmark = typeof id === 'string' ? listBookmarks().find((entry) => entry.id === id) : undefined;
  const url = bookmark?.url;
  const mode = bookmarksBarMode();
  const items: MenuItemConstructorOptions[] = [];

  if (bookmark && url) {
    items.push(
      { label: 'Open', click: () => navigate(url) },
      { label: 'Open in new tab', click: () => newTab(url) },
      { type: 'separator' },
      { label: 'Remove', click: () => removeBookmark(bookmark.id) },
      { type: 'separator' },
    );
  }

  items.push(
    { label: 'Open bookmarks manager', accelerator: 'CmdOrCtrl+Shift+O', click: () => openBrowsiePage('bookmarks') },
    {
      label: 'Bookmarks bar',
      submenu: [
        { label: 'Always hide', type: 'radio', checked: mode === 'never', click: () => setBookmarksBarMode('never') },
        { label: 'Always show', type: 'radio', checked: mode === 'always', click: () => setBookmarksBarMode('always') },
        {
          label: 'Only show on New Tab page',
          type: 'radio',
          checked: mode === 'newtab',
          click: () => setBookmarksBarMode('newtab'),
        },
      ],
    },
  );

  Menu.buildFromTemplate(items).popup(host ? { window: host } : undefined);
};

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

export const zoomActiveTab = (key: string) => {
  const contents = activeContents();

  if (!contents) {
    return false;
  }

  const level = key === '0' ? 0 : contents.getZoomLevel() + (key === '-' ? -ZOOM_STEP : ZOOM_STEP);
  contents.setZoomLevel(clamp(level, MIN_ZOOM, MAX_ZOOM));
  return true;
};

// Space while lockdown is on is push-to-talk. Main sees the key whether focus is in the chrome
// or a website (the website view swallows keys during lockdown). Repeats stay held. Letting go
// slides the pill away. Lockdown turning off drops it too. Returns true when the key
// should not reach the page.
export const handleTalkKey = (input: Input) => {
  if (input.code !== 'Space' || !lockdown || input.control || input.alt || input.meta || input.shift) {
    return false;
  }

  if (input.type === 'keyDown') {
    // Only a fresh press starts talking. A key held through the cooldown (or the launch wait) only
    // sends repeats, so it stays ignored until it's let go and pressed again.
    if (!talking && (input.isAutoRepeat || Date.now() < Math.max(talkCooldownUntil, talkReadyAt))) {
      return true;
    }

    // Repeats while talking keep the watchdog from firing.
    setTalking(true);

    if (talkWatchdog) {
      clearTimeout(talkWatchdog);
    }

    talkWatchdog = setTimeout(() => {
      talkWatchdog = null;
      setTalking(false);
    }, TALK_REPEAT_TIMEOUT_MS);

    return true;
  }

  if (input.type === 'keyUp') {
    setTalking(false);
    return true;
  }

  return true;
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

  // Bookmark the page on screen, like the star.
  if (ctrl && !input.shift && !input.alt && key === 'd') {
    return once(bookmarkFromShortcut);
  }

  // History and Bookmarks pages, with Chrome's keys.
  if (ctrl && !input.shift && !input.alt && key === 'h') {
    return once(() => openBrowsiePage('history'));
  }

  if (ctrl && input.shift && !input.alt && key === 'o') {
    return once(() => openBrowsiePage('bookmarks'));
  }

  // Show or hide the bookmarks bar. The way back after choosing "Always hide", since a hidden bar
  // can't be right-clicked.
  if (ctrl && input.shift && !input.alt && key === 'b') {
    return once(() => setBookmarksBarMode(bookmarksBarMode() === 'never' ? 'always' : 'never'));
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

  // The keyboard version of dragging a tab along the strip. Page Up/Down, so it doesn't steal
  // Ctrl+Shift+arrows from text (those select a word in the address bar and on websites).
  if (ctrl && input.shift && !input.alt && (key === 'pageup' || key === 'pagedown')) {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    return run(() => moveTab(activeTabId, index + (key === 'pageup' ? -1 : 1)));
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

// Google's sign-in page, when the Browsie account is signed in but its web storage has no Google login.
const googleSignInStartUrl = () => {
  const { email } = getSession();
  return email && getGoogleLogin() === false ? googleSignInUrl(email) : null;
};

// The first tab of a window or account: Google's sign-in page if this account's web storage isn't
// logged in to Google, New Tab otherwise. If we don't know yet, New Tab now and maybe switch when we do.
const openStartTab = () => {
  const url = googleSignInStartUrl();
  const tab = blankTab({ showingNewTab: true });
  tabs.push(tab);
  activeTabId = tab.id;

  if (url) {
    startGoogleSignIn(tab);
    load(tab, url);
  }

  layout();
  emit();
  startTabId = tab && getGoogleLogin() === null ? tab.id : null;
};

// Sign-in is done once Google's login cookie exists and the tab has left the sign-in pages. The tab
// becomes the New Tab page with a fresh history, so Back can't lead into the sign-in pages again.
const finishGoogleSignIn = (tab: Tab) => {
  const url = tab.view?.webContents.getURL();

  if (
    !tabs.includes(tab) ||
    !tab.googleSignIn ||
    tab.showingNewTab ||
    !url ||
    !isWebUrl(url) ||
    isGoogleAccountsUrl(url) ||
    getGoogleLogin() !== true
  ) {
    return;
  }

  endGoogleSignIn(tab, true);
  destroyView(tab);
  tab.showingNewTab = true;
  tab.page = 'newtab';
  tab.pageBack = [];
  tab.startedFromNewTab = false;
  tab.pendingUrl = null;
  tab.favicon = null;
  tab.faviconRequest++;
  tab.faviconOrigin = null;

  if (fullscreenTabId === tab.id) {
    fullscreenTabId = null;
  }

  if (tab.id === activeTabId) {
    host?.webContents.focus();
  }

  layout();
  emit();
};

onGoogleLoginChange((signedIn) => {
  // The cookie can land after the tab reached google.com, so check the sign-in tabs here too.
  if (signedIn) {
    startTabId = null;
    tabs.filter((tab) => tab.googleSignIn).forEach(finishGoogleSignIn);
    return;
  }

  // The first answer arrived after the start tab opened: switch it, but only if it's still untouched.
  const tab = tabs.find((entry) => entry.id === startTabId);
  startTabId = null;
  const url = googleSignInStartUrl();

  if (!tab || !url || !tab.showingNewTab || tab.view) {
    return;
  }

  startGoogleSignIn(tab);
  load(tab, url);
  layout();
  emit();
});

// Hands the tab system a window to live in and opens the first tab.
export const attachTabs = (window: BrowserWindow) => {
  host = window;
  tabs = [];
  activeTabId = 0;
  contentBounds = null;
  overlayOpen = false;
  fullscreenTabId = null;
  lockdown = true;
  relockAfterGoogleSignIn = false;
  talkReadyAt = Infinity;
  glassView = createGlass();
  window.contentView.addChildView(glassView);
  openStartTab();

  window.on('resize', layout);
  // Letting go of space can be missed if the window loses focus while it's held.
  window.on('blur', () => setTalking(false));
  window.on('closed', () => {
    for (const tab of tabs) {
      tab.view?.webContents.close();
    }

    tabs = [];
    speechGeneration += 1;
    speechView = null;
    glassView?.webContents.close();
    glassView = null;
    host = null;
  });
};

// Tells the chrome which control the agent just used, so it can pulse it for anyone watching.
export const emitAgentActivity = (activity: AgentUiActivity) => {
  if (host && !host.isDestroyed()) {
    host.webContents.send('agent:ui-activity', activity);
  }
};

// The agent works on the website in the active tab. One task at a time, and never on Browsie's own pages.
export const leaseAgentTab = (taskId: string) => {
  const tab = activeTab();

  if (!tab?.view || tab.showingNewTab || tabs.some((entry) => entry.agentTaskId !== null)) {
    return undefined;
  }

  tab.agentTaskId = taskId;
  emit();
  return tab.id;
};

export const releaseAgentTab = (taskId: string) => {
  for (const tab of tabs) {
    if (tab.agentTaskId === taskId) {
      tab.agentTaskId = null;
    }
  }

  emit();
};

// The only way the executor reaches a page: a leased tab's own website view. Never the chrome, a popup or
// one of Browsie's pages.
export const agentTabContents = (tabId: number) => {
  const tab = tabs.find((entry) => entry.id === tabId);

  if (!tab?.view || tab.agentTaskId === null || tab.showingNewTab || tab.view.webContents.isDestroyed()) {
    return undefined;
  }

  return tab.view.webContents;
};

// Whether this page is the website of a tab the agent is working on (for downloads).
export const isAgentContents = (contents: WebContents | undefined) =>
  contents !== undefined && tabs.some((tab) => tab.agentTaskId !== null && tab.view?.webContents === contents);

// A different account (or nobody) is signed in now. Every open page belongs to the previous account's
// web storage, so close them all and start over with one tab in the new account's storage.
export const resetTabsForAccount = () => {
  clearFaviconCache();

  for (const popup of popups) {
    popup.close();
  }

  if (!host || host.isDestroyed()) {
    return;
  }

  for (const tab of tabs) {
    destroyView(tab);
  }

  // A sign-in left unfinished by the previous account doesn't get to leave lockdown off.
  if (relockAfterGoogleSignIn) {
    relockAfterGoogleSignIn = false;
    applyLockdown(true);
  }

  tabs = [];
  fullscreenTabId = null;
  openStartTab();
};
