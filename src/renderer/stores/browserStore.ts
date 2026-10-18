import { create } from 'zustand';

// Main owns the tabs; this is the chrome's read-only mirror of them (same idea as authStore).
export const useBrowserStore = create<BrowserState>()(() => ({
  tabs: [],
  activeTabId: 0,
  lockdown: true,
  lockdownNotice: 0,
}));

// Every window bundles this file, but only the browser window may ask main about tabs.
const isBrowserWindow = new URLSearchParams(window.location.search).get('window') === 'browser';
const browser = isBrowserWindow ? window.browsie?.browser : undefined;

browser?.onStateChanged((state) => useBrowserStore.setState(state, true));

// Resolves once the first snapshot has arrived. The splash waits on it so the chrome never
// appears with an empty tab strip.
export const browserStateLoaded: Promise<void> = browser
  ? browser
      .getState()
      .then((state) => useBrowserStore.setState(state, true))
      .catch(() => undefined)
  : Promise.resolve();

// Lockdown Mode: a person can't drive the browser. Main owns it (on at launch, off while Google
// sign-in is on screen); this mirrors it from the browser state, and toggle asks main to change it.
// The agent later uses main-process navigation and script, which this does not block.
export const useLockdownStore = create<{ enabled: boolean; toggle: () => void }>()((set) => ({
  enabled: true,
  toggle: () =>
    set((state) => {
      const enabled = !state.enabled;
      void window.browsie?.browser.setLockdown(enabled);
      return { enabled };
    }),
}));

// The "Lockdown mode is on" notice on the New Tab page. Once per launch, even if another New Tab page
// mounts later; shown again when lockdown comes back on after Google sign-in.
export const useLockdownNotice = create<{ open: boolean }>()(() => ({ open: true }));

// Main's notice count when this window first heard from it; only later bumps reopen the notice.
let seenLockdownNotice: number | null = null;

const followLockdown = ({ lockdown, lockdownNotice }: BrowserState) => {
  // Nothing in the chrome keeps focus (or a half-typed address) once a person can't use it.
  if (lockdown && !useLockdownStore.getState().enabled && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  useLockdownStore.setState({ enabled: lockdown });

  if (seenLockdownNotice !== null && lockdownNotice > seenLockdownNotice) {
    useLockdownNotice.setState({ open: true });
  }

  seenLockdownNotice = lockdownNotice;
};

if (browser) {
  useBrowserStore.subscribe(followLockdown);
}

export const useActiveTab = () =>
  useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null);

// Websites paint above the chrome, so a popover (like the profile menu) can't float over one.
// Instead: grab a still of the page, show it in the page's place, hide the real page, and put the
// popover over the still. To the user the page just sits there, under the menu.
export const usePageSnapshot = create<{ src: string | null }>()(() => ({ src: null }));

// Bumped on every open/close, so a slow capture can't reopen an overlay that was already closed.
let overlayRequest = 0;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const setChromeOverlay = async (open: boolean) => {
  const request = ++overlayRequest;

  if (!browser) {
    return;
  }

  if (!open) {
    await browser.setOverlayOpen(false);
    // Drop the still a frame after the real page is back, so there's never a gap between them.
    await nextFrame();

    if (request === overlayRequest) {
      usePageSnapshot.setState({ src: null });
    }

    return;
  }

  const src = await browser.capturePage().catch(() => null);

  if (request !== overlayRequest) {
    return;
  }

  if (src) {
    usePageSnapshot.setState({ src });
    // Wait until the still is decoded and painted before hiding the real page underneath it.
    const image = new Image();
    image.src = src;
    await image.decode().catch(() => undefined);
    await nextFrame();
    await nextFrame();
  }

  if (request === overlayRequest) {
    await browser.setOverlayOpen(true);
  }
};

// The page overlay stays up while any chrome menu is mounted. Opening one while another blurs out
// would otherwise let the closing menu drop the overlay from under the new one.
const openMenus = new Set<string>();

export const trackChromeMenu = (id: string) => (open: boolean) => {
  const wasOpen = openMenus.size > 0;

  if (open) {
    openMenus.add(id);
  } else {
    openMenus.delete(id);
  }

  if (wasOpen !== openMenus.size > 0) {
    void setChromeOverlay(openMenus.size > 0);
  }
};
