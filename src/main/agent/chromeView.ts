import { hostOf } from '../../shared/chrome/policy';
import type { ChromeAction } from '../../shared/chrome/actions';

// Trims what a browser command returns down to what the UI lane needs, before it leaves main. Favicons,
// internal fields and long lists stay behind. Also collects the sites the agent was shown, which it may
// then open (see shared/chrome/policy.ts).

const MAX_BOOKMARKS = 50;
const MAX_VISITS = 20;
const MAX_TITLE = 120;

const short = (text: string) => (text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text);

const siteOf = (url: string | null | undefined) => (url ? (hostOf(url) ?? url) : undefined);

export const viewForAgent = (action: ChromeAction, value: unknown): { data?: unknown; hosts: string[] } => {
  const hosts: string[] = [];
  const see = (url: string | null | undefined) => {
    const host = url ? hostOf(url) : undefined;
    if (host) hosts.push(host);
  };

  switch (action.type) {
    case 'tabs.list': {
      const tabs = value as BrowserTab[];
      tabs.forEach((tab) => see(tab.url));
      return {
        hosts,
        data: tabs.map((tab, index) => ({
          id: tab.id,
          index,
          title: short(tab.title),
          site: tab.url ? siteOf(tab.url) : tab.page,
          ...(tab.agent && { agentWorking: true }),
        })),
      };
    }
    case 'state.read': {
      const state = value as BrowserState;
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      see(active?.url);
      return {
        hosts,
        data: {
          activeTab: active && { id: active.id, title: short(active.title), url: active.url ?? `browsie://${active.page}` },
          tabCount: state.tabs.length,
          canGoBack: active?.canGoBack ?? false,
          canGoForward: active?.canGoForward ?? false,
        },
      };
    }
    case 'bookmarks.list': {
      const links = (value as Bookmark[]).filter((bookmark) => bookmark.kind === 'link' && bookmark.url).slice(0, MAX_BOOKMARKS);
      links.forEach((bookmark) => see(bookmark.url));
      return { hosts, data: links.map((bookmark) => ({ id: bookmark.id, title: short(bookmark.title), site: siteOf(bookmark.url) })) };
    }
    case 'history.search': {
      const visits = (value as Visit[]).slice(0, MAX_VISITS);
      visits.forEach((visit) => see(visit.url));
      return { hosts, data: visits.map((visit) => ({ title: short(visit.title), url: visit.url, visitedAt: visit.visitedAt })) };
    }
    case 'bookmarks.add': {
      const result = value as BookmarkResult;
      return { hosts, data: { title: short(result.bookmark.title), alreadySaved: !result.created } };
    }
    default:
      return { hosts };
  }
};
