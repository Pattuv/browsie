import { z } from 'zod';

// The UI lane's complete command vocabulary. Both the agent and main import this file: the agent can
// only propose one of these commands, and main parses it again before touching browser chrome.
// Commands intentionally describe browser chrome only; page interaction belongs to shared/web/actions.

const tabId = z.number().int().positive();
const tabIndex = z.number().int().nonnegative();
const text = z.string().trim().min(1).max(2_048);
const bookmarkId = z.string().min(1).max(128);

const TabsList = z.strictObject({ type: z.literal('tabs.list') });
const TabsOpen = z.strictObject({ type: z.literal('tabs.open'), url: text.optional() });
const TabsSwitch = z.strictObject({
  type: z.literal('tabs.switch'),
  target: z.discriminatedUnion('by', [
    z.strictObject({ by: z.literal('id'), id: tabId }),
    z.strictObject({ by: z.literal('index'), index: tabIndex }),
    z.strictObject({ by: z.literal('next') }),
  ]),
});
const TabsClose = z.strictObject({ type: z.literal('tabs.close'), id: tabId });
const TabsMove = z.strictObject({ type: z.literal('tabs.move'), id: tabId, index: tabIndex });
const TabsMute = z.strictObject({ type: z.literal('tabs.mute'), id: tabId });
const TabsDuplicate = z.strictObject({ type: z.literal('tabs.duplicate'), id: tabId });

const NavGo = z.strictObject({ type: z.literal('nav.go'), input: text });
const NavBack = z.strictObject({ type: z.literal('nav.back') });
const NavForward = z.strictObject({ type: z.literal('nav.forward') });
const NavReload = z.strictObject({ type: z.literal('nav.reload') });
const NavStop = z.strictObject({ type: z.literal('nav.stop') });

const ViewZoom = z.strictObject({ type: z.literal('view.zoom'), direction: z.enum(['in', 'out', 'reset']) });
const PageOpen = z.strictObject({ type: z.literal('page.open'), page: z.enum(['history', 'bookmarks']) });

const BookmarksAdd = z.strictObject({ type: z.literal('bookmarks.add') });
const BookmarksRemove = z.strictObject({ type: z.literal('bookmarks.remove'), id: bookmarkId });
const BookmarksOpen = z.strictObject({ type: z.literal('bookmarks.open'), id: bookmarkId });
const BookmarksList = z.strictObject({ type: z.literal('bookmarks.list') });
const HistorySearch = z.strictObject({ type: z.literal('history.search'), query: text });
const BookmarksBarSet = z.strictObject({ type: z.literal('bookmarksBar.set'), visible: z.boolean() });
const StateRead = z.strictObject({ type: z.literal('state.read') });

export const ChromeAction = z.discriminatedUnion('type', [
  TabsList,
  TabsOpen,
  TabsSwitch,
  TabsClose,
  TabsMove,
  TabsMute,
  TabsDuplicate,
  NavGo,
  NavBack,
  NavForward,
  NavReload,
  NavStop,
  ViewZoom,
  PageOpen,
  BookmarksAdd,
  BookmarksRemove,
  BookmarksOpen,
  BookmarksList,
  HistorySearch,
  BookmarksBarSet,
  StateRead,
]);

export type ChromeAction = z.infer<typeof ChromeAction>;
export type ChromeActionType = ChromeAction['type'];

export const parseChromeAction = (raw: unknown) => ChromeAction.safeParse(raw);

export type ChromeRisk = 'read' | 'interact';

export const BASE_RISK: Record<ChromeActionType, ChromeRisk> = {
  'tabs.list': 'read',
  'tabs.open': 'interact',
  'tabs.switch': 'interact',
  'tabs.close': 'interact',
  'tabs.move': 'interact',
  'tabs.mute': 'interact',
  'tabs.duplicate': 'interact',
  'nav.go': 'interact',
  'nav.back': 'interact',
  'nav.forward': 'interact',
  'nav.reload': 'interact',
  'nav.stop': 'interact',
  'view.zoom': 'interact',
  'page.open': 'interact',
  'bookmarks.add': 'interact',
  'bookmarks.remove': 'interact',
  'bookmarks.open': 'interact',
  'bookmarks.list': 'read',
  'history.search': 'read',
  'bookmarksBar.set': 'interact',
  'state.read': 'read',
};

const quote = (value: string, max = 48) => `"${value.length > max ? `${value.slice(0, max - 1)}…` : value}"`;

export const describe = (action: ChromeAction): string => {
  switch (action.type) {
    case 'tabs.list':
      return 'Checking your tabs';
    case 'tabs.open':
      return action.url ? `Opening ${quote(action.url)}` : 'Opening a new tab';
    case 'tabs.switch':
      return 'Switching tabs';
    case 'tabs.close':
      return 'Closing that tab';
    case 'tabs.move':
      return 'Moving that tab';
    case 'tabs.mute':
      return 'Changing that tab’s sound';
    case 'tabs.duplicate':
      return 'Duplicating that tab';
    case 'nav.go':
      return `Going to ${quote(action.input)}`;
    case 'nav.back':
      return 'Going back';
    case 'nav.forward':
      return 'Going forward';
    case 'nav.reload':
      return 'Reloading the page';
    case 'nav.stop':
      return 'Stopping the page';
    case 'view.zoom':
      return action.direction === 'reset' ? 'Resetting zoom' : `Zooming ${action.direction}`;
    case 'page.open':
      return `Opening ${action.page}`;
    case 'bookmarks.add':
      return 'Adding this bookmark';
    case 'bookmarks.remove':
      return 'Removing that bookmark';
    case 'bookmarks.open':
      return 'Opening that bookmark';
    case 'bookmarks.list':
      return 'Checking your bookmarks';
    case 'history.search':
      return `Searching history for ${quote(action.query)}`;
    case 'bookmarksBar.set':
      return action.visible ? 'Showing the bookmarks bar' : 'Hiding the bookmarks bar';
    case 'state.read':
      return 'Checking the browser';
  }
};
