import { describe as suite, expect, it } from 'vitest';
import { BASE_RISK, ChromeAction, describe, parseChromeAction } from './actions';

const samples: ChromeAction[] = [
  ChromeAction.parse({ type: 'tabs.list' }),
  ChromeAction.parse({ type: 'tabs.open', url: 'example.com' }),
  ChromeAction.parse({ type: 'tabs.switch', target: { by: 'id', id: 4 } }),
  ChromeAction.parse({ type: 'tabs.close', id: 4 }),
  ChromeAction.parse({ type: 'tabs.move', id: 4, index: 0 }),
  ChromeAction.parse({ type: 'tabs.mute', id: 4 }),
  ChromeAction.parse({ type: 'tabs.duplicate', id: 4 }),
  ChromeAction.parse({ type: 'nav.go', input: 'cats near me' }),
  ChromeAction.parse({ type: 'nav.back' }),
  ChromeAction.parse({ type: 'nav.forward' }),
  ChromeAction.parse({ type: 'nav.reload' }),
  ChromeAction.parse({ type: 'nav.stop' }),
  ChromeAction.parse({ type: 'view.zoom', direction: 'in' }),
  ChromeAction.parse({ type: 'page.open', page: 'history' }),
  ChromeAction.parse({ type: 'bookmarks.add' }),
  ChromeAction.parse({ type: 'bookmarks.remove', id: 'bookmark-1' }),
  ChromeAction.parse({ type: 'bookmarks.open', id: 'bookmark-1' }),
  ChromeAction.parse({ type: 'bookmarks.list' }),
  ChromeAction.parse({ type: 'history.search', query: 'Browsie' }),
  ChromeAction.parse({ type: 'bookmarksBar.set', visible: true }),
  ChromeAction.parse({ type: 'state.read' }),
];

suite('ChromeAction', () => {
  it('accepts every allowlisted command', () => {
    expect(samples).toHaveLength(Object.keys(BASE_RISK).length);
  });

  it('rejects non-chrome commands and unknown fields', () => {
    expect(parseChromeAction({ type: 'settings.open' }).success).toBe(false);
    expect(parseChromeAction({ type: 'tabs.close', id: 4, force: true }).success).toBe(false);
  });

  it('requires an explicit, valid tab switch target', () => {
    expect(parseChromeAction({ type: 'tabs.switch', target: { by: 'next' } }).success).toBe(true);
    expect(parseChromeAction({ type: 'tabs.switch', target: { by: 'index', index: -1 } }).success).toBe(false);
    expect(parseChromeAction({ type: 'tabs.switch', target: { by: 'title', title: 'Gmail' } }).success).toBe(false);
  });

  it('keeps read commands distinct from chrome-changing commands', () => {
    expect(BASE_RISK['tabs.list']).toBe('read');
    expect(BASE_RISK['history.search']).toBe('read');
    expect(BASE_RISK['tabs.close']).toBe('interact');
  });

  it('gives every command a short spoken phrase', () => {
    for (const action of samples) {
      expect(describe(action).length).toBeGreaterThan(0);
    }

    expect(describe(ChromeAction.parse({ type: 'nav.back' }))).toBe('Going back');
    expect(describe(ChromeAction.parse({ type: 'nav.go', input: 'x'.repeat(200) })).length).toBeLessThan(70);
  });
});
