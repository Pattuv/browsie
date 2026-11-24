// Plain helpers for webTheme.ts, kept free of Electron so they can be tested.

// Google search results on www.google.com or a country domain (www.google.co.uk, www.google.com.au).
export const isGoogleSearch = (url: string) => {
  try {
    const { hostname, pathname } = new URL(url);
    return /^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(hostname) && pathname === '/search';
  } catch {
    return false;
  }
};

// Whether a computed CSS color like "rgb(34, 36, 42)" is a dark background. Null for anything else,
// including transparent, so an unreadable page is left alone.
export const isDarkBackground = (color: unknown): boolean | null => {
  if (typeof color !== 'string') {
    return null;
  }

  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color.trim());

  if (!match || (match[4] !== undefined && Number(match[4]) === 0)) {
    return null;
  }

  const [red, green, blue] = match.slice(1, 4).map(Number);
  return 0.299 * red + 0.587 * green + 0.114 * blue < 128;
};
