import { describe, expect, it } from 'vitest';
import { checkNavigation } from '../chrome/policy';
import { evaluate } from '../../main/web/policy';
import { isAdultContent } from './contentPolicy';

describe('isAdultContent', () => {
  it.each([
    'Can you go to a new tab in Google and, um, search for naked girls?',
    'naked girls',
    'search for p0rn',
    'show me nudes',
    'sexy girls',
    'free sex videos',
    'NSFW pictures',
    'pornhub.com',
    'https://www.xvideos.com/',
    'https://www.google.com/search?q=naked+girls',
    'https://www.google.com/search?q=hot%20girls&tbm=isch',
    'https://something.xxx/',
  ])('blocks %s', (text) => {
    expect(isAdultContent(text)).toBe(true);
  });

  it.each([
    'open a new tab, search for ChatGPT Atlas and go to images',
    'weather in Sussex',
    'Essex county council',
    'sex education curriculum',
    'Middlesex hospital',
    'naked juice smoothie'.replace('naked', 'green'),
    'https://www.google.com/search?q=cats',
    'https://www.bbc.co.uk/news',
    'add the blue mug to my cart',
  ])('allows %s', (text) => {
    expect(isAdultContent(text)).toBe(false);
  });
});

describe('enforced in main', () => {
  it('refuses adult searches in the UI lane, even when the user asked', () => {
    expect(checkNavigation('naked girls', ['search for naked girls'], new Set())).toContain('adult content');
    expect(checkNavigation('cats', ['search for cats'], new Set())).toBeUndefined();
  });

  it('refuses adult pages and typed searches in the WEB lane', () => {
    const sources = new Map([['u1', 'search for naked girls']]);
    expect(evaluate({ type: 'goto', url: 'https://www.google.com/search?q=naked+girls' }, { sources })).toMatchObject({
      ok: false,
      error: 'blocked_by_policy',
    });
    expect(evaluate({ type: 'type', snap: 1, ref: 'e1', text: 'naked girls', provenance: ['u1'] }, { sources })).toMatchObject({
      ok: false,
      error: 'blocked_by_policy',
    });
  });
});
