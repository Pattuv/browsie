import { describe, expect, it } from 'vitest';
import { checkNavigation, hostOf } from './policy';

describe('hostOf', () => {
  it('reads an address the way the address bar would', () => {
    expect(hostOf('bbc.co.uk')).toBe('bbc.co.uk');
    expect(hostOf('https://www.YouTube.com/watch?v=1')).toBe('youtube.com');
    expect(hostOf('localhost:3000')).toBe('localhost');
  });

  it('treats anything else as a search', () => {
    expect(hostOf('cats near me')).toBeUndefined();
    expect(hostOf('weather')).toBeUndefined();
    expect(hostOf('browsie://settings')).toBeUndefined();
    expect(hostOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('checkNavigation', () => {
  const none = new Set<string>();

  it('allows sites the user named, however they said them', () => {
    expect(checkNavigation('bbc.co.uk', ['go to the BBC'], none)).toBeUndefined();
    expect(checkNavigation('youtube.com', ['open you tube'], none)).toBeUndefined();
    expect(checkNavigation('https://www.amazon.com', ['find a mug on amazon'], none)).toBeUndefined();
  });

  it('allows the user’s own tabs, bookmarks and recent sites', () => {
    expect(checkNavigation('mail.google.com', ['open my email'], new Set(['mail.google.com']))).toBeUndefined();
  });

  it('always allows searches', () => {
    expect(checkNavigation('best mugs 2026', ['find me a good mug'], none)).toBeUndefined();
  });

  it('refuses a site that came from page text', () => {
    expect(checkNavigation('evil.example', ['switch to my email tab'], none)).toContain('evil.example');
    // "www" and the TLD don't count as the user naming the site.
    expect(checkNavigation('www.something.com', ['open www dot com'], none)).toBeDefined();
  });
});
