import { useMemo } from 'react';
import { create } from 'zustand';

// Where a bookmark can be saved: the bookmarks bar under the address bar, or null for "Other bookmarks".
export const BOOKMARKS_BAR = 'bar';

// Main owns the bookmarks; this is the chrome's read-only mirror of them (same idea as browserStore).
export const useBookmarksStore = create<{ bookmarks: Bookmark[] }>()(() => ({ bookmarks: [] }));

// Every window bundles this file, but only the browser window may ask main about bookmarks.
const isBrowserWindow = new URLSearchParams(window.location.search).get('window') === 'browser';
const library = isBrowserWindow ? window.browsie?.library : undefined;

library?.onBookmarksChanged((bookmarks) => useBookmarksStore.setState({ bookmarks }));
void library
  ?.listBookmarks()
  .then((bookmarks) => useBookmarksStore.setState({ bookmarks }))
  .catch(() => undefined);

export const useIsBookmarked = (url: string | null | undefined) =>
  useBookmarksStore((state) => Boolean(url) && state.bookmarks.some((bookmark) => bookmark.url === url));

// Everything saved in one place, in order. Main already sorts by position.
export const inPlace = (bookmarks: Bookmark[], parentId: string | null) =>
  bookmarks.filter((bookmark) => bookmark.parentId === parentId && bookmark.kind === 'link');

// What's saved to the bookmarks bar. Memoized, so it's the same array until the bookmarks change.
export const useBarBookmarks = () => {
  const bookmarks = useBookmarksStore((state) => state.bookmarks);
  return useMemo(() => inPlace(bookmarks, BOOKMARKS_BAR), [bookmarks]);
};
