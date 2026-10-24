// SafeSearch as a preference. Missing means on: a new install filters search until someone turns it off.
export const SAFE_SEARCH_SETTING = 'safeSearch';

export const safeSearchEnabled = (settings: Record<string, unknown> | undefined) =>
  settings?.[SAFE_SEARCH_SETTING] !== false;

// A search URL rewritten so the engine's own strict filter is on, or null when the URL is already
// strict or isn't a search. Only the query changes, so Google sign-in and other hosts are left alone.
export const forceSafeSearch = (raw: string): string | null => {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (isGoogleSearch(host, path)) {
    return withParam(url, 'safe', 'active');
  }

  if (isBingSearch(host, path)) {
    return withParam(url, 'adlt', 'strict');
  }

  if (isDuckDuckGo(host, path)) {
    return withParam(url, 'kp', '1');
  }

  return null;
};

// www.google.com, google.co.uk, google.com.au, google.de. Not mail.google.com or accounts.google.com.
const GOOGLE_SEARCH_HOST = /^(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/;

const isGoogleSearch = (host: string, path: string) => GOOGLE_SEARCH_HOST.test(host) && path === '/search';

const isBingSearch = (host: string, path: string) =>
  (host === 'bing.com' || host === 'www.bing.com') &&
  (path === '/search' || path === '/images/search' || path === '/videos/search' || path === '/news/search');

const isDuckDuckGo = (host: string, path: string) =>
  (host === 'duckduckgo.com' || host === 'www.duckduckgo.com' || host === 'html.duckduckgo.com' || host === 'safe.duckduckgo.com') &&
  (path === '/' || path === '/html' || path === '/lite');

// Null when the parameter is already the strict value, so a redirect doesn't loop.
const withParam = (url: URL, key: string, value: string) => {
  if (url.searchParams.get(key) === value) {
    return null;
  }

  url.searchParams.set(key, value);
  return url.href;
};
