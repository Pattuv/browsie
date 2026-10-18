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
  // False when Windows DPAPI could not save the sign-in: it ends when the app quits.
  rememberedOnDevice?: boolean;
  // Set when Google ended the session (revoked, expired), not the user. Auth can say "sign in again".
  signedOutReason?: 'expired';
};

interface BrowsieAuthAPI {
  getSession: () => Promise<AuthSession>;
  signIn: () => Promise<AuthSession>;
  cancelSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
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
type BrowserTab = {
  id: number;
  title: string;
  url: string | null;
  // The site's icon as a data: URL (main downloads it; the chrome never loads remote images). Null until known.
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

// Main owns the tabs; this snapshot is everything the chrome is told about them.
type BrowserState = {
  tabs: BrowserTab[];
  activeTabId: number;
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

interface BrowsieBrowserAPI {
  // From the Dashboard: open (or focus) the browser window.
  launch: () => Promise<void>;
  // Everything below only works from the browser window itself.
  exit: () => Promise<void>;
  getState: () => Promise<BrowserState>;
  // Returns an unsubscribe function.
  onStateChanged: (callback: (state: BrowserState) => void) => () => void;
  newTab: () => Promise<void>;
  closeTab: (id: number) => Promise<void>;
  activateTab: (id: number) => Promise<void>;
  // Anything typed in the address bar; main turns it into a safe URL or a search.
  navigate: (input: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  stop: () => Promise<void>;
  setContentBounds: (bounds: ContentBounds) => Promise<void>;
  // True while a chrome popover is open, so the website is inset and does not cover the menu.
  // A still image (data: URL) of the website on screen, or null if there isn't one.
  capturePage: () => Promise<string | null>;
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
}

interface BrowsieAPI {
  auth: BrowsieAuthAPI;
  data: BrowsieDataAPI;
  browser: BrowsieBrowserAPI;
  openModePicker: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  shouldAnimateDashboard: () => Promise<boolean>;
  markDashboardPlayed: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  // Returns an unsubscribe function.
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

interface Window {
  browsie?: BrowsieAPI;
}

declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
