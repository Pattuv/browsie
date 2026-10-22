/// <reference types="vite/client" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.mp3' {
  const src: string;
  export default src;
}

declare module '*.wav' {
  const src: string;
  export default src;
}

type UserMode = 'caretaker' | 'independent';

// Everything the UI is ever told about the signed-in user. Never tokens or Google IDs.
type AuthSession = {
  status: 'SIGNED_OUT' | 'SIGNED_IN';
  firstName?: string;
  // Shown in the profile picker.
  email?: string;
  pictureDataUrl?: string;
  // False when the user didn't grant Drive access on the consent screen.
  syncEnabled?: boolean;
  // False when the sign-in isn't saved, so it ends when the app quits: setup isn't finished yet,
  // or Windows DPAPI could not save it.
  rememberedOnDevice?: boolean;
  // Whether this account has finished setup on this device. False sends it through the setup steps, not the Dashboard.
  setupComplete?: boolean;
  // Set when Google ended the session (revoked, expired), not the user. Auth can say "sign in again".
  signedOutReason?: 'expired';
};

interface BrowsieAuthAPI {
  getSession: () => Promise<AuthSession>;
  signIn: () => Promise<AuthSession>;
  cancelSignIn: () => Promise<void>;
  // Marks the signed-in account as set up; the session push that follows swaps setup for the Dashboard.
  completeSetup: () => Promise<void>;
  // Hands the signed-in account's OpenRouter management key to main. Main checks it with OpenRouter, makes
  // Browsie its own AI key with it (capped at `cap`), and stores both encrypted. Never read back.
  // invalid: not shaped like a key. invalid-cap: cap not between $0 and $10,000. rejected: OpenRouter doesn't
  // know the key. not-management: a regular key. unavailable: couldn't be stored (not signed in, or Windows
  // can't encrypt it).
  saveAiKey: (
    key: string,
    cap: { limit: number; reset: AiResets | null },
  ) => Promise<'saved' | 'invalid' | 'invalid-cap' | 'rejected' | 'not-management' | 'offline' | 'unavailable'>;
  // removeDeviceData also deletes this account's web logins, cookies and site data from this computer.
  // resetSetup also forgets that this account finished setup, so its next sign-in goes through setup again.
  signOut: (options?: { removeDeviceData?: boolean; resetSetup?: boolean }) => Promise<void>;
  // Returns an unsubscribe function.
  onSessionChanged: (callback: (session: AuthSession) => void) => () => void;
}

// Browsie's saved app data (browsie-data.json, later backed up to Drive). Preferences only, never secrets.
type AppData = {
  userMode: UserMode | null;
  settings: Record<string, unknown>;
};

// Only the fields you pass change; `settings` is merged key by key.
type AppDataPatch = Partial<AppData>;

// Drive backup state. idle = backed up; disabled = signed out or Drive access not granted.
type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';
  lastSyncedAt: string | null;
};

interface BrowsieDataAPI {
  get: () => Promise<AppData>;
  update: (patch: AppDataPatch) => Promise<AppData>;
  // Returns an unsubscribe function.
  onChanged: (callback: (data: AppData) => void) => () => void;
  getSyncStatus: () => Promise<SyncStatus>;
  // Returns an unsubscribe function.
  onSyncStatusChanged: (callback: (status: SyncStatus) => void) => () => void;
}

// One tab as the chrome sees it. url is null while the tab shows Browsie's own New Tab page.
// Browsie's own pages, shown in a tab instead of a website (browsie://history, browsie://bookmarks).
type BrowsiePage = 'newtab' | 'history' | 'bookmarks' | 'settings';

type BrowserTab = {
  id: number;
  title: string;
  url: string | null;
  // Which Browsie page the tab shows while url is null; null on a website.
  page: BrowsiePage | null;
  // The site's icon as a data: URL (main downloads it; the chrome never loads remote images). Null until known.
  favicon: string | null;
  loading: boolean;
  // True when this tab's audio is muted from the tab menu.
  muted: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

// Main owns the tabs; this snapshot is everything the chrome is told about them.
type BrowserState = {
  tabs: BrowserTab[];
  activeTabId: number;
  // Lockdown Mode. Main owns it: on at launch, off while Google sign-in is on screen.
  lockdown: boolean;
  // Goes up each time lockdown comes back on after Google sign-in, to show the lockdown notice again.
  lockdownNotice: number;
  // Space is held while lockdown is on. Main shows the speech pill over the page.
  talking: boolean;
};

// Where the page area sits in the window, in CSS pixels (the chrome measures it, main places the website there).
type ContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// The certificate Chromium accepted for a site. Dates are ISO strings.
type SiteCertificate = {
  issuedTo: string;
  issuedBy: string;
  validFrom: string;
  validUntil: string;
};

// What a website can be allowed to use, per site. Everything else is always blocked.
type SitePermissionKind = 'geolocation' | 'camera' | 'microphone' | 'notifications';

type SitePermission = {
  kind: SitePermissionKind;
  // Block is the default.
  setting: 'allow' | 'block';
};

// What the site info panel shows about the website on screen.
type SiteInfo = {
  host: string;
  // https with a certificate Chromium accepted.
  secure: boolean;
  // Null when the site isn't https, or its certificate wasn't checked this run.
  certificate: SiteCertificate | null;
  cookieCount: number;
  // What the site has stored (databases, caches...), or null if it couldn't be measured.
  storageBytes: number | null;
  permissions: SitePermission[];
};

// One row under the address bar. A query searches for the text; a url opens that site directly.
type Suggestion = {
  text: string;
  kind: 'query' | 'url';
  // url: the page's title. query: the name of a person, place or thing it's about ("Denver Broncos").
  title?: string;
  // What that thing is ("Football team").
  description?: string;
  // A favicon or thumbnail on Google's servers. Load it with suggestionImage(); the CSP blocks it directly.
  image?: string;
};

interface BrowsieBrowserAPI {
  // From the Dashboard: open (or focus) the browser window.
  launch: () => Promise<void>;
  // Everything below only works from the browser window itself.
  exit: () => Promise<void>;
  getState: () => Promise<BrowserState>;
  // Returns an unsubscribe function.
  onStateChanged: (callback: (state: BrowserState) => void) => () => void;
  // Optional url opens that site in the new tab; omit for a blank New Tab page.
  newTab: (url?: string) => Promise<void>;
  closeTab: (id: number) => Promise<void>;
  activateTab: (id: number) => Promise<void>;
  // Puts that tab at index, shifting the others along. Index is clamped to the strip.
  moveTab: (id: number, index: number) => Promise<void>;
  // Anything typed in the address bar; main turns it into a safe URL or a search.
  navigate: (input: string) => Promise<void>;
  // Search suggestions for what's typed so far, from Google without the user's cookies. [] on any failure.
  suggest: (query: string) => Promise<Suggestion[]>;
  // Opens the connection to the suggestion server early, so the first suggest() is fast.
  warmSuggestions: () => Promise<void>;
  // A suggestion's image as a data: URL, or null. Only Google-hosted images are fetched.
  suggestionImage: (url: string) => Promise<string | null>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  stop: () => Promise<void>;
  // Right-click menu for a tab: Reload, Duplicate, Mute site.
  showTabMenu: (id: number) => Promise<void>;
  setContentBounds: (bounds: ContentBounds) => Promise<void>;
  // True while a chrome popover is open, so the website is inset and does not cover the menu.
  // A still image (data: URL) of the website on screen, or null if there isn't one.
  capturePage: () => Promise<string | null>;
  // The launch animation finished. Push-to-talk starts working shortly after.
  chromeReady: () => Promise<void>;
  setOverlayOpen: (open: boolean) => Promise<void>;
  // Human input on websites is ignored while this is on. Main-process loads still run.
  setLockdown: (enabled: boolean) => Promise<void>;
  // Null on the New Tab page.
  getSiteInfo: () => Promise<SiteInfo | null>;
  // Deletes the open site's cookies and storage, then reloads it.
  clearSiteData: () => Promise<void>;
  // For the site on screen. Both return its permissions after the change.
  setSitePermission: (kind: SitePermissionKind, setting: 'allow' | 'block') => Promise<SitePermission[]>;
  resetSitePermissions: () => Promise<SitePermission[]>;
  // Ctrl+L / F6 / Alt+D. Returns an unsubscribe function.
  onFocusAddress: (callback: () => void) => () => void;
  // Opens browsie://history or browsie://bookmarks: an existing tab showing it, the empty New Tab, or a new tab.
  openPage: (page: 'history' | 'bookmarks' | 'settings') => Promise<void>;
}

// A saved page (or, later, a folder of them), for the signed-in account.
type Bookmark = {
  id: string;
  kind: 'link' | 'folder';
  url?: string;
  title: string;
  // The site's icon when it was bookmarked, as a data: URL. Missing if it was too big or unknown.
  favicon?: string;
  // Where it's saved: 'bar' (the bookmarks bar) or null ("Other bookmarks").
  parentId: string | null;
  // Order within its place, lowest first.
  position: number;
  createdAt: string;
  updatedAt: string;
};

// When the bookmarks bar shows (settings.bookmarksBar). Missing means 'always'.
type BookmarksBarMode = 'always' | 'never' | 'newtab';

// The star and Ctrl+D: the page's bookmark, and whether it was just made (false: it was already saved).
type BookmarkResult = { bookmark: Bookmark; created: boolean };

// One visit to one page, for the signed-in account.
type Visit = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
};

// Bookmarks and history. Browser window only, like the tab controls.
interface BrowsieLibraryAPI {
  // Newest first. Pass the oldest visitedAt you have as `before` to load further back.
  listHistory: (options?: { before?: string; limit?: number }) => Promise<Visit[]>;
  // Every word must appear in the title or address. Newest first.
  searchHistory: (query: string) => Promise<Visit[]>;
  removeVisit: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  // History changed (a visit, a removal, another account signed in): reload what you show.
  // Returns an unsubscribe function.
  onHistoryChanged: (callback: () => void) => () => void;
  listBookmarks: () => Promise<Bookmark[]>;
  // Bookmarks the page on screen (to the bookmarks bar), or returns its bookmark if it's already saved.
  // Null when there's no website on screen.
  bookmarkPage: () => Promise<BookmarkResult | null>;
  // Rename it, or move it between the bookmarks bar ('bar') and Other bookmarks (null).
  updateBookmark: (id: string, change: { title?: string; parentId?: string | null }) => Promise<void>;
  // One step earlier (-1) or later (1) within where it's saved.
  moveBookmark: (id: string, direction: -1 | 1) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  // Right-click on the bookmarks bar: on a bookmark (its id) or on the bar itself (no id).
  showBookmarkMenu: (id?: string) => Promise<void>;
  // Returns an unsubscribe function.
  onBookmarksChanged: (callback: (bookmarks: Bookmark[]) => void) => () => void;
  // Ctrl+D was pressed: open the star's panel for this bookmark. Returns an unsubscribe function.
  onEditBookmark: (callback: (result: BookmarkResult) => void) => () => void;
}

type AiResets = 'daily' | 'weekly' | 'monthly';

// What the profile menu's usage card shows, in US dollars. Never a key.
type AiUsage =
  | {
      state: 'ok';
      // What can actually be spent now: the smaller of what's left under the cap and the credit balance.
      available: number;
      // Credits bought minus credits used, across the whole OpenRouter account.
      balance: number;
      totalCredits: number;
      // The Browsie key's spending cap; null when it has none.
      limit: number | null;
      // What's left under the cap; null when there's no cap.
      capRemaining: number | null;
      // Spend counted against the cap: this period's when the cap resets, all-time otherwise.
      usedThisPeriod: number;
      resets: AiResets | null;
    }
  | { state: 'no-key' | 'invalid-key' | 'offline' };

interface BrowsieAPI {
  auth: BrowsieAuthAPI;
  data: BrowsieDataAPI;
  browser: BrowsieBrowserAPI;
  library: BrowsieLibraryAPI;
  openModePicker: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  // Asks OpenRouter at most once a minute; the menu can call it every time it opens.
  getAiUsage: () => Promise<AiUsage>;
  shouldAnimateDashboard: () => Promise<boolean>;
  markDashboardPlayed: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  // Returns an unsubscribe function.
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  // Space is held. The speech pill asks once when it mounts, then listens.
  isSpeechHeld: () => Promise<boolean>;
  // deviceVolumeDb is how far the system volume turns sound down, in dB (0 at full), when space
  // was pressed or let go.
  onSpeechHeld: (callback: (held: boolean, deviceVolumeDb: number) => void) => () => void;
}

interface Window {
  browsie?: BrowsieAPI;
}

declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
