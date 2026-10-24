import { ChromeAction, type ChromeAction as ChromeActionValue, parseChromeAction } from '../../shared/chrome/actions';

// Main's narrow, authoritative API for browser-chrome commands. The agent never receives these
// operations directly: host will call execute() after validating its RPC request. The adapter from
// tabs.ts deliberately stays injected so its human-facing exports can keep their lockdown guards.

// Same shape the chrome receives (AgentUiActivity in vite-env.d.ts).
export type ChromeActivity = AgentUiActivity;

export type ChromeCommandResult =
  | { ok: true; action: ChromeActionValue; activity: ChromeActivity; value?: unknown }
  | { ok: false; error: 'invalid_action' | 'not_found' | 'unavailable'; message: string };

export type ChromeOperations = {
  listTabs: () => BrowserTab[];
  openTab: (url?: string) => void;
  switchTab: (target: Extract<ChromeActionValue, { type: 'tabs.switch' }>['target']) => boolean;
  closeTab: (id: number) => boolean;
  moveTab: (id: number, index: number) => boolean;
  muteTab: (id: number) => boolean;
  duplicateTab: (id: number) => boolean;
  navigate: (input: string) => boolean;
  goBack: () => boolean;
  goForward: () => boolean;
  reload: () => boolean;
  stop: () => boolean;
  zoom: (direction: 'in' | 'out' | 'reset') => boolean;
  openPage: (page: 'history' | 'bookmarks') => boolean;
  addBookmark: () => BookmarkResult | null;
  removeBookmark: (id: string) => boolean;
  openBookmark: (id: string) => boolean;
  listBookmarks: () => Bookmark[];
  searchHistory: (query: string) => Visit[];
  setBookmarksBarVisible: (visible: boolean) => boolean;
  readState: () => BrowserState;
  emitActivity: (activity: ChromeActivity) => void;
};

const unavailable = (message: string): ChromeCommandResult => ({ ok: false, error: 'unavailable', message });
const notFound = (message: string): ChromeCommandResult => ({ ok: false, error: 'not_found', message });

const activityFor = (action: ChromeActionValue): ChromeActivity => {
  switch (action.type) {
    case 'tabs.list':
    case 'tabs.open':
    case 'tabs.switch':
    case 'tabs.close':
    case 'tabs.move':
    case 'tabs.mute':
    case 'tabs.duplicate':
      return { target: 'tab', label: action.type };
    case 'nav.go':
      return { target: 'address', label: action.type };
    case 'nav.back':
      return { target: 'back', label: action.type };
    case 'nav.forward':
      return { target: 'forward', label: action.type };
    case 'nav.reload':
    case 'nav.stop':
      return { target: 'reload', label: action.type };
    case 'view.zoom':
      return { target: 'zoom', label: action.type };
    case 'page.open':
    case 'bookmarks.add':
    case 'bookmarks.remove':
    case 'bookmarks.open':
    case 'bookmarks.list':
    case 'bookmarksBar.set':
      return { target: 'bookmarks', label: action.type };
    case 'history.search':
      return { target: 'history', label: action.type };
    case 'state.read':
      return { target: 'tab', label: action.type };
  }
};

export const createChromeApi = (operations: ChromeOperations) => {
  const execute = (raw: unknown): ChromeCommandResult => {
    const parsed = parseChromeAction(raw);

    if (!parsed.success) {
      return { ok: false, error: 'invalid_action', message: 'That is not an allowed browser command.' };
    }

    const action = parsed.data;
    const activity = activityFor(action);
    const done = (value?: unknown): ChromeCommandResult => {
      operations.emitActivity(activity);
      return { ok: true, action, activity, ...(value !== undefined && { value }) };
    };

    switch (action.type) {
      case 'tabs.list':
        return done(operations.listTabs());
      case 'tabs.open':
        operations.openTab(action.url);
        return done();
      case 'tabs.switch':
        return operations.switchTab(action.target) ? done() : notFound('That tab is no longer open.');
      case 'tabs.close':
        return operations.closeTab(action.id) ? done() : notFound('That tab is no longer open.');
      case 'tabs.move':
        return operations.moveTab(action.id, action.index) ? done() : notFound('That tab is no longer open.');
      case 'tabs.mute':
        return operations.muteTab(action.id) ? done() : notFound('That tab is no longer open.');
      case 'tabs.duplicate':
        return operations.duplicateTab(action.id) ? done() : notFound('That tab is no longer open.');
      case 'nav.go':
        return operations.navigate(action.input) ? done() : unavailable('There is no active tab to navigate.');
      case 'nav.back':
        return operations.goBack() ? done() : unavailable('There is nowhere to go back to.');
      case 'nav.forward':
        return operations.goForward() ? done() : unavailable('There is nowhere to go forward to.');
      case 'nav.reload':
        return operations.reload() ? done() : unavailable('There is no page to reload.');
      case 'nav.stop':
        return operations.stop() ? done() : unavailable('There is no page to stop.');
      case 'view.zoom':
        return operations.zoom(action.direction) ? done() : unavailable('There is no page to zoom.');
      case 'page.open':
        return operations.openPage(action.page) ? done() : unavailable(`Unable to open ${action.page}.`);
      case 'bookmarks.add': {
        const result = operations.addBookmark();
        return result ? done(result) : unavailable('This page cannot be bookmarked.');
      }
      case 'bookmarks.remove':
        return operations.removeBookmark(action.id) ? done() : notFound('That bookmark no longer exists.');
      case 'bookmarks.open':
        return operations.openBookmark(action.id) ? done() : notFound('That bookmark no longer exists.');
      case 'bookmarks.list':
        return done(operations.listBookmarks());
      case 'history.search':
        return done(operations.searchHistory(action.query));
      case 'bookmarksBar.set':
        return operations.setBookmarksBarVisible(action.visible) ? done() : unavailable('Unable to change the bookmarks bar.');
      case 'state.read':
        return done(operations.readState());
    }
  };

  return { execute };
};

export type ChromeApi = ReturnType<typeof createChromeApi>;
