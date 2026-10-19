import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isWebUrl } from '../browser/webSession';
import {
  emptyCollection,
  merge,
  parseCollection,
  readCollection,
  sameCollection,
  writeCollection,
  type Collection,
  type SyncedItem,
} from './collections';
import { libraryFile } from './libraryPaths';
import { getDeviceId } from './localStore';

// One saved page. Stored per account, like that account's web storage: signing out puts yours away,
// and signing back in brings them back.
export type StoredBookmark = SyncedItem & {
  kind: 'link' | 'folder';
  url?: string;
  title: string;
  // The site's icon when it was bookmarked (a small data: URL), so the bar and lists can show it.
  favicon?: string;
  // Where it's saved: the bookmarks bar, or null for "Other bookmarks". Room for real folders later.
  parentId: string | null;
  // Order within its place, lowest first.
  position: number;
  createdAt: string;
};

// The bookmarks bar under the address bar. null is "Other bookmarks".
export const BOOKMARKS_BAR = 'bar';
// Where a new bookmark goes from the star, like Chrome: the bar, where you can see it.
const DEFAULT_PARENT = BOOKMARKS_BAR;

const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
// Bookmarks sync to Drive, so only small icons ride along. Bigger ones fall back to the globe.
const MAX_FAVICON_LENGTH = 16 * 1024;

let filePath: string | null = null;
let bookmarks: Collection<StoredBookmark> = emptyCollection();
// Main-process listeners (the sync engine, later), told about every local change.
const changeListeners = new Set<() => void>();

const isString = (value: unknown): value is string => typeof value === 'string';
const isPlace = (value: unknown): value is string | null => value === null || value === BOOKMARKS_BAR;

const isStoredBookmark = (value: unknown): value is StoredBookmark => {
  const item = value as Partial<StoredBookmark>;
  return (
    (item.kind === 'link' || item.kind === 'folder') &&
    (item.kind === 'folder' || (isString(item.url) && isWebUrl(item.url))) &&
    isString(item.title) &&
    (item.favicon === undefined || (isString(item.favicon) && item.favicon.startsWith('data:image/'))) &&
    isPlace(item.parentId) &&
    typeof item.position === 'number' &&
    Number.isFinite(item.position) &&
    isString(item.createdAt)
  );
};

// What the chrome is told: live bookmarks only, without the sync bookkeeping.
const toBookmark = ({ id, kind, url, title, favicon, parentId, position, createdAt, updatedAt }: StoredBookmark): Bookmark => ({
  id,
  kind,
  ...(url !== undefined && { url }),
  title,
  ...(favicon !== undefined && { favicon }),
  parentId,
  position,
  createdAt,
  updatedAt,
});

const live = () => bookmarks.items.filter((item) => !item.deleted);

const inPlace = (parentId: string | null) =>
  live()
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.position - b.position);

export const listBookmarks = (): Bookmark[] =>
  live()
    .sort((a, b) => a.position - b.position)
    .map(toBookmark);

const broadcast = () => {
  const list = listBookmarks();

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('library:bookmarks-changed', list);
  }
};

export const onBookmarksChange = (listener: () => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

const writeToDisk = (file: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeCollection(file, bookmarks);
  broadcast();
};

// A change made on this device: save it, tell the windows, and tell the sync engine it needs uploading.
const save = (items: StoredBookmark[]) => {
  if (!filePath) {
    throw new Error('Sign in to save bookmarks.');
  }

  bookmarks = { ...bookmarks, items };
  writeToDisk(filePath);
  changeListeners.forEach((listener) => listener());
};

// Points the store at this account's bookmarks (null = signed out, nothing to show or save).
export const setBookmarksAccount = (accountId: string | null) => {
  const next = accountId ? libraryFile(accountId, 'bookmarks') : null;

  if (next === filePath) {
    return;
  }

  filePath = next;
  bookmarks = next ? readCollection(next, isStoredBookmark) : emptyCollection();
  broadcast();
};

// Every change records when and on which device, so merges know which copy is newer.
const stamp = (item: StoredBookmark): StoredBookmark => ({
  ...item,
  updatedAt: new Date().toISOString(),
  deviceId: getDeviceId(),
});

// Replaces the changed items (matched by id), stamping each one.
const replace = (changed: StoredBookmark[]) => {
  const byId = new Map(changed.map((item) => [item.id, stamp(item)]));
  save(bookmarks.items.map((item) => byId.get(item.id) ?? item));
};

const endOf = (parentId: string | null) =>
  inPlace(parentId).reduce((max, item) => Math.max(max, item.position), -1) + 1;

const cleanTitle = (title: string, url: string) => title.trim().slice(0, MAX_TITLE_LENGTH) || new URL(url).hostname;

const find = (id: unknown) => live().find((item) => item.id === id);

// The star in the address bar and Ctrl+D. Saves the page to the bookmarks bar, or, if it's already
// saved, hands back that bookmark so the chrome can show where it is (and move, rename or remove it).
export const bookmarkPage = (url: string, title: string, favicon: string | null) => {
  if (!isWebUrl(url) || url.length > MAX_URL_LENGTH) {
    throw new Error('Only web pages can be bookmarked.');
  }

  const existing = live().find((item) => item.kind === 'link' && item.url === url);

  if (existing) {
    return { bookmark: toBookmark(existing), created: false };
  }

  const now = new Date().toISOString();
  const bookmark: StoredBookmark = {
    id: randomUUID(),
    updatedAt: now,
    deviceId: getDeviceId(),
    kind: 'link',
    url,
    title: cleanTitle(title, url),
    ...(favicon && favicon.startsWith('data:image/') && favicon.length <= MAX_FAVICON_LENGTH && { favicon }),
    parentId: DEFAULT_PARENT,
    position: endOf(DEFAULT_PARENT),
    createdAt: now,
  };

  save([...bookmarks.items, bookmark]);
  return { bookmark: toBookmark(bookmark), created: true };
};

// Rename it, or move it between the bookmarks bar and Other bookmarks (it goes to the end there).
export const updateBookmark = (id: unknown, patch: unknown) => {
  const target = find(id);
  const { title, parentId } = (patch ?? {}) as { title?: unknown; parentId?: unknown };

  if (!target) {
    return;
  }

  if ((title !== undefined && !isString(title)) || (parentId !== undefined && !isPlace(parentId))) {
    throw new Error('Invalid bookmark change.');
  }

  const next = { ...target };

  if (title !== undefined && target.url) {
    next.title = cleanTitle(title, target.url);
  }

  if (parentId !== undefined && parentId !== target.parentId) {
    next.parentId = parentId;
    next.position = endOf(parentId);
  }

  if (next.title !== target.title || next.parentId !== target.parentId) {
    replace([next]);
  }
};

// One step earlier (-1) or later (+1) in its place: the keyboard-friendly way to reorder.
export const moveBookmark = (id: unknown, direction: unknown) => {
  const target = find(id);

  if (!target || (direction !== -1 && direction !== 1)) {
    return;
  }

  const siblings = inPlace(target.parentId);
  const index = siblings.indexOf(target);
  const neighbour = siblings[index + direction];

  if (!neighbour) {
    return;
  }

  replace([
    { ...target, position: neighbour.position },
    { ...neighbour, position: target.position },
  ]);
};

// Deleting leaves a tombstone, so the delete reaches the account's other devices once sync is on.
export const removeBookmark = (id: unknown) => {
  const target = find(id);

  if (target) {
    replace([{ ...target, deleted: true }]);
  }
};

// ---- Used by the sync engine only ----

export const parseBookmarks = (raw: unknown) => parseCollection(raw, isStoredBookmark);

// The full collection, tombstones included, and the file it belongs to. Null when signed out.
export const getBookmarksForSync = () => (filePath ? { filePath, collection: bookmarks } : null);

// Drive's copy arrived: fold it into ours. Not a local change, so it doesn't ask for another upload.
// Returns the merged result, or null if the account changed while it was downloading.
export const mergeRemoteBookmarks = (expectedFile: string, remote: Collection<StoredBookmark>) => {
  if (filePath !== expectedFile) {
    return null;
  }

  const merged = merge(bookmarks, remote);

  if (!sameCollection(merged, bookmarks)) {
    bookmarks = merged;
    writeToDisk(filePath);
  }

  return bookmarks;
};
