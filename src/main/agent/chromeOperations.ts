import { listBookmarks, removeBookmark } from '../data/bookmarks';
import { searchHistory } from '../data/history';
import {
  activateTab,
  activeContents,
  bookmarkActivePage,
  closeTab,
  cycleTab,
  duplicateTabById,
  emitAgentActivity,
  getBrowserState,
  goBack,
  goForward,
  moveTab,
  navigateToWeb,
  newTab,
  setBookmarksBarMode,
  showBrowsiePage,
  toggleMuteTabById,
  toSafeUrl,
  zoomActiveTab,
} from '../browser/tabs';
import type { ChromeOperations } from './chromeApi';

// The real browser behind chromeApi. These call tabs.ts's agent-facing functions, which skip the lockdown
// checks meant for people. Each returns false when there was nothing to do, so the agent hears about it.

const state = () => getBrowserState();
const hasTab = (id: number) => state().tabs.some((tab) => tab.id === id);
const activeTab = () => state().tabs.find((tab) => tab.id === state().activeTabId);

export const chromeOperations: ChromeOperations = {
  listTabs: () => state().tabs,

  // What the agent says may be a domain or a search, like the address bar. toUrl makes it a safe web
  // address either way, so newTab never gets something it would silently drop.
  openTab: (url) => newTab(url ? toSafeUrl(url) : undefined),

  switchTab: (target) => {
    const { tabs } = state();
    if (target.by === 'next') {
      if (tabs.length < 2) return false;
      cycleTab(1);
      return true;
    }
    const id = target.by === 'id' ? target.id : tabs[target.index]?.id;
    if (id === undefined || !hasTab(id)) return false;
    activateTab(id);
    return true;
  },

  closeTab: (id) => {
    if (!hasTab(id)) return false;
    closeTab(id);
    return true;
  },

  moveTab: (id, index) => {
    if (!hasTab(id)) return false;
    moveTab(id, index);
    return true;
  },

  muteTab: toggleMuteTabById,
  duplicateTab: duplicateTabById,
  navigate: navigateToWeb,

  goBack: () => {
    if (!activeTab()?.canGoBack) return false;
    goBack();
    return true;
  },

  goForward: () => {
    if (!activeTab()?.canGoForward) return false;
    goForward();
    return true;
  },

  reload: () => {
    const contents = activeContents();
    contents?.reload();
    return Boolean(contents);
  },

  stop: () => {
    const contents = activeContents();
    contents?.stop();
    return Boolean(contents);
  },

  zoom: (direction) => zoomActiveTab(direction === 'reset' ? '0' : direction === 'in' ? '+' : '-'),

  openPage: (page) => {
    showBrowsiePage(page);
    return true;
  },

  addBookmark: () => {
    try {
      return bookmarkActivePage();
    } catch {
      // Not signed in: nowhere to save it.
      return null;
    }
  },

  removeBookmark: (id) => {
    if (!listBookmarks().some((bookmark) => bookmark.id === id)) return false;
    removeBookmark(id);
    return true;
  },

  openBookmark: (id) => {
    const url = listBookmarks().find((bookmark) => bookmark.id === id)?.url;
    return url ? navigateToWeb(url) : false;
  },

  listBookmarks,
  searchHistory: (query) => searchHistory(query, 20),

  setBookmarksBarVisible: (visible) => {
    setBookmarksBarMode(visible ? 'always' : 'never');
    return true;
  },

  readState: state,
  emitActivity: emitAgentActivity,
};
