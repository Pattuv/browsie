import { describe, expect, it } from 'vitest';
import { forceSafeSearch, safeSearchEnabled } from './safeSearch';

describe('safeSearchEnabled', () => {
  it('is on until someone turns it off', () => {
    expect(safeSearchEnabled(undefined)).toBe(true);
    expect(safeSearchEnabled({})).toBe(true);
    expect(safeSearchEnabled({ safeSearch: true })).toBe(true);
    expect(safeSearchEnabled({ safeSearch: false })).toBe(false);
  });
});

describe('forceSafeSearch', () => {
  it('locks Google, Bing and DuckDuckGo searches on their strict setting', () => {
    expect(forceSafeSearch('https://www.google.com/search?q=cats')).toBe('https://www.google.com/search?q=cats&safe=active');
    expect(forceSafeSearch('https://www.google.co.uk/search?q=cats&safe=off')).toBe(
      'https://www.google.co.uk/search?q=cats&safe=active',
    );
    expect(forceSafeSearch('https://google.com.au/search?q=cats')).toBe('https://google.com.au/search?q=cats&safe=active');
    expect(forceSafeSearch('https://www.bing.com/search?q=cats&adlt=off')).toBe('https://www.bing.com/search?q=cats&adlt=strict');
    expect(forceSafeSearch('https://duckduckgo.com/?q=cats&kp=-1')).toBe('https://duckduckgo.com/?q=cats&kp=1');
  });

  it('leaves a search that is already strict, and everything that is not a search', () => {
    expect(forceSafeSearch('https://www.google.com/search?q=cats&safe=active')).toBeNull();
    expect(forceSafeSearch('https://mail.google.com/mail/')).toBeNull();
    expect(forceSafeSearch('https://accounts.google.com/signin')).toBeNull();
    expect(forceSafeSearch('https://www.youtube.com/results?search_query=cats')).toBeNull();
    expect(forceSafeSearch('https://example.com/search?q=cats')).toBeNull();
    expect(forceSafeSearch('not a url')).toBeNull();
  });
});
