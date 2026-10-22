import { describe, expect, it, vi } from 'vitest';
import { type ChromeOperations, createChromeApi } from './chromeApi';
import { viewForAgent } from './chromeView';

const tab = (id: number, title: string, url: string | null, extra: Partial<BrowserTab> = {}): BrowserTab => ({
  id,
  title,
  url,
  page: url ? null : 'newtab',
  favicon: 'data:image/png;base64,AAAA',
  loading: false,
  muted: false,
  canGoBack: true,
  canGoForward: false,
  agent: false,
  ...extra,
});

const tabs = [tab(1, 'Inbox (3) - sam@example.com - Gmail', 'https://mail.google.com/mail/u/0/'), tab(2, 'New Tab', null)];

const fakeOperations = (overrides: Partial<ChromeOperations> = {}): ChromeOperations => ({
  listTabs: () => tabs,
  openTab: vi.fn(),
  switchTab: vi.fn(() => true),
  closeTab: vi.fn(() => true),
  moveTab: vi.fn(() => true),
  muteTab: vi.fn(() => true),
  duplicateTab: vi.fn(() => true),
  navigate: vi.fn(() => true),
  goBack: vi.fn(() => true),
  goForward: vi.fn(() => false),
  reload: vi.fn(() => true),
  stop: vi.fn(() => true),
  zoom: vi.fn(() => true),
  openPage: vi.fn(() => true),
  addBookmark: vi.fn(() => null),
  removeBookmark: vi.fn(() => false),
  openBookmark: vi.fn(() => true),
  listBookmarks: () => [],
  searchHistory: () => [],
  setBookmarksBarVisible: vi.fn(() => true),
  readState: () => ({ tabs, activeTabId: 1, lockdown: true, lockdownNotice: 0, talking: false }),
  emitActivity: vi.fn(),
  ...overrides,
});

describe('chromeApi', () => {
  it('runs an allowed command and tells the chrome which control to pulse', () => {
    const operations = fakeOperations();
    const result = createChromeApi(operations).execute({ type: 'nav.go', input: 'bbc.co.uk' });
    expect(result).toMatchObject({ ok: true, activity: { target: 'address' } });
    expect(operations.navigate).toHaveBeenCalledWith('bbc.co.uk');
    expect(operations.emitActivity).toHaveBeenCalledWith({ target: 'address', label: 'nav.go' });
  });

  it('refuses commands that are not in the table, without touching anything', () => {
    const operations = fakeOperations();
    for (const raw of [{ type: 'settings.open' }, { type: 'lockdown.set', enabled: false }, { type: 'page.open', page: 'settings' }]) {
      expect(createChromeApi(operations).execute(raw)).toMatchObject({ ok: false, error: 'invalid_action' });
    }
    expect(operations.emitActivity).not.toHaveBeenCalled();
  });

  it('says when there was nothing to do', () => {
    const operations = fakeOperations();
    expect(createChromeApi(operations).execute({ type: 'nav.forward' })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(createChromeApi(operations).execute({ type: 'bookmarks.remove', id: 'gone' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(operations.emitActivity).not.toHaveBeenCalled();
  });
});

describe('viewForAgent', () => {
  it('sends tabs without icons or full URLs, and notes their sites', () => {
    const view = viewForAgent({ type: 'tabs.list' }, tabs);
    expect(view.data).toEqual([
      { id: 1, index: 0, title: 'Inbox (3) - sam@example.com - Gmail', site: 'mail.google.com' },
      { id: 2, index: 1, title: 'New Tab', site: 'newtab' },
    ]);
    expect(view.hosts).toEqual(['mail.google.com']);
    expect(JSON.stringify(view.data)).not.toContain('base64');
  });

  it('keeps only bookmark links, trimmed', () => {
    const bookmarks: Bookmark[] = [
      { id: 'f', kind: 'folder', title: 'Work', parentId: null, position: 0 } as Bookmark,
      { id: 'b', kind: 'link', url: 'https://www.bbc.co.uk/news', title: 'x'.repeat(300), parentId: 'bar', position: 1 } as Bookmark,
    ];
    const view = viewForAgent({ type: 'bookmarks.list' }, bookmarks);
    expect(view.data).toEqual([{ id: 'b', title: `${'x'.repeat(119)}…`, site: 'bbc.co.uk' }]);
    expect(view.hosts).toEqual(['bbc.co.uk']);
  });

  it('answers "where am I" with just the active tab', () => {
    const state = { tabs, activeTabId: 1, lockdown: true, lockdownNotice: 0, talking: false };
    expect(viewForAgent({ type: 'state.read' }, state).data).toEqual({
      activeTab: { id: 1, title: 'Inbox (3) - sam@example.com - Gmail', url: 'https://mail.google.com/mail/u/0/' },
      tabCount: 2,
      canGoBack: true,
      canGoForward: false,
    });
  });
});
