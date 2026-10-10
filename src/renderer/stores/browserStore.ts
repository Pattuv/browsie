import { create } from 'zustand';

// Main owns the tabs; this is the chrome's read-only mirror of them (same idea as authStore).
export const useBrowserStore = create<BrowserState>()(() => ({ tabs: [], activeTabId: 0 }));

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

export const useActiveTab = () =>
  useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null);
