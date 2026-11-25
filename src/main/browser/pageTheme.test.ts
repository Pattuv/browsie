import { describe, expect, it } from 'vitest';
import { isDarkBackground, isGoogleSearch } from './pageTheme';

describe('isGoogleSearch', () => {
  it('matches Google search results, including country domains', () => {
    expect(isGoogleSearch('https://www.google.com/search?q=dogs')).toBe(true);
    expect(isGoogleSearch('https://www.google.co.uk/search?q=dogs')).toBe(true);
    expect(isGoogleSearch('https://www.google.com.au/search?q=dogs')).toBe(true);
  });

  it('leaves other Google pages and look-alike hosts alone', () => {
    expect(isGoogleSearch('https://www.google.com/')).toBe(false);
    expect(isGoogleSearch('https://accounts.google.com/search')).toBe(false);
    expect(isGoogleSearch('https://www.google.com.evil.example/search?q=x')).toBe(false);
    expect(isGoogleSearch('not a url')).toBe(false);
  });
});

describe('isDarkBackground', () => {
  it("reads Google's dark and light backgrounds", () => {
    expect(isDarkBackground('rgb(34, 36, 42)')).toBe(true);
    expect(isDarkBackground('rgb(255, 255, 255)')).toBe(false);
  });

  it('gives no answer for transparent or unreadable colors', () => {
    expect(isDarkBackground('rgba(0, 0, 0, 0)')).toBeNull();
    expect(isDarkBackground('transparent')).toBeNull();
    expect(isDarkBackground(undefined)).toBeNull();
  });
});
