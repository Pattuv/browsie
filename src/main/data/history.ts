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

// One visit to one page. Stored per account, like bookmarks and that account's web storage.
export type StoredVisit = SyncedItem & {
  url: string;
  title: string;
  visitedAt: string;
};

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_VISITS = 20_000;
// Reloading, or a site bouncing back to the same address, within this long isn't a new visit.
const REVISIT_MS = 30_000;
// Visits come in bursts (redirects, in-page navigation), so write to disk at most this often.
const SAVE_DELAY_MS = 3_000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_LIST = 500;

let filePath: string | null = null;
let history: Collection<StoredVisit> = emptyCollection();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Main-process listeners (the sync engine, later), told about every local change.
const changeListeners = new Set<() => void>();

const isString = (value: unknown): value is string => typeof value === 'string';

const isStoredVisit = (value: unknown): value is StoredVisit => {
  const item = value as Partial<StoredVisit>;
  return isString(item.url) && isWebUrl(item.url) && isString(item.title) && isString(item.visitedAt);
};

// Keeps the last 90 days, at most 20k visits, newest first. Also used when merging with other devices.
export const trimHistory = (items: StoredVisit[], now = Date.now()) => {
  const cutoff = new Date(now - KEEP_MS).toISOString();
  return items
    .filter((item) => item.visitedAt >= cutoff)
    .sort((a, b) => (a.visitedAt < b.visitedAt ? 1 : a.visitedAt > b.visitedAt ? -1 : 0))
    .slice(0, MAX_VISITS);
};

// What the chrome is told: live visits only, without the sync bookkeeping.
const toVisit = ({ id, url, title, visitedAt }: StoredVisit): Visit => ({ id, url, title, visitedAt });

const live = () => history.items.filter((item) => !item.deleted);

export const onHistoryChange = (listener: () => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

// Write now. Before switching accounts and before quitting, so a pending save isn't lost.
export const flushHistory = () => {
  if (saveTimer === undefined) {
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = undefined;

  if (!filePath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeCollection(filePath, history);
  } catch (error) {
    console.warn('[history] could not save:', error);
  }
};

// Save soon, and tell the windows (the History page reloads what it shows).
const saveSoon = () => {
  if (saveTimer === undefined) {
    saveTimer = setTimeout(flushHistory, SAVE_DELAY_MS);
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('library:history-changed');
  }
};

// A change made on this device: save it, and tell the sync engine it needs uploading.
const changed = () => {
  saveSoon();
  changeListeners.forEach((listener) => listener());
};

// Points the store at this account's history (null = signed out: nothing is recorded or shown).
export const setHistoryAccount = (accountId: string | null) => {
  const next = accountId ? libraryFile(accountId, 'history') : null;

  if (next === filePath) {
    return;
  }

  flushHistory();
  filePath = next;
  history = next ? readCollection(next, isStoredVisit) : emptyCollection();
  history = { ...history, items: trimHistory(history.items) };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('library:history-changed');
  }
};

const stamp = (item: StoredVisit): StoredVisit => ({
  ...item,
  updatedAt: new Date().toISOString(),
  deviceId: getDeviceId(),
});

const cleanTitle = (title: string, url: string) => title.trim().slice(0, MAX_TITLE_LENGTH) || new URL(url).hostname;

// A tab landed on a page. Returns the visit's id, so the page's title can be filled in once it loads.
export const recordVisit = (url: string, title: string) => {
  if (!filePath || !isWebUrl(url) || url.length > MAX_URL_LENGTH) {
    return null;
  }

  const now = new Date();
  const latest = history.items.find((item) => !item.deleted);

  if (latest && latest.url === url && now.getTime() - Date.parse(latest.visitedAt) < REVISIT_MS) {
    return latest.id;
  }

  const visit: StoredVisit = {
    id: randomUUID(),
    updatedAt: now.toISOString(),
    deviceId: getDeviceId(),
    url,
    title: cleanTitle(title, url),
    visitedAt: now.toISOString(),
  };

  // The list is already newest first, so the new visit just goes in front. Visits past 90 days are
  // trimmed when the history is loaded (and when merging, later), not on every page.
  history = { ...history, items: [visit, ...history.items].slice(0, MAX_VISITS) };
  changed();
  return visit.id;
};

// Most pages report their real title a moment after the visit is recorded.
export const updateVisitTitle = (id: string, title: string) => {
  const target = history.items.find((item) => item.id === id && !item.deleted);

  if (!target || !title.trim() || cleanTitle(title, target.url) === target.title) {
    return;
  }

  history = {
    ...history,
    items: history.items.map((item) => (item === target ? stamp({ ...item, title: cleanTitle(title, item.url) }) : item)),
  };
  changed();
};

// Newest first. `before` pages back through older visits (pass the last visitedAt you have).
export const listHistory = (options: unknown): Visit[] => {
  const { before, limit } = (options ?? {}) as { before?: unknown; limit?: unknown };
  const count = typeof limit === 'number' && limit > 0 ? Math.min(limit, MAX_LIST) : 100;

  return live()
    .filter((item) => !isString(before) || item.visitedAt < before)
    .slice(0, count)
    .map(toVisit);
};

// Every word has to appear in the title or the address. Newest first.
export const searchHistory = (query: unknown, limit = 50): Visit[] => {
  if (!isString(query)) {
    return [];
  }

  const words = query.toLowerCase().trim().slice(0, 200).split(/\s+/).filter(Boolean);

  if (!words.length) {
    return [];
  }

  return live()
    .filter((item) => {
      const text = `${item.title} ${item.url}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .slice(0, Math.min(limit, MAX_LIST))
    .map(toVisit);
};

// Deleting leaves a tombstone, so the delete reaches the account's other devices once sync is on.
export const removeVisit = (id: unknown) => {
  const target = history.items.find((item) => item.id === id && !item.deleted);

  if (!target) {
    return;
  }

  history = { ...history, items: history.items.map((item) => (item === target ? stamp({ ...item, deleted: true }) : item)) };
  changed();
};

// "Clear all history": everything before now goes, here and (once sync is on) on every other device.
export const clearHistory = () => {
  if (!filePath) {
    return;
  }

  history = { schemaVersion: 1, items: [], clearedBefore: new Date().toISOString() };
  changed();
};

// ---- Used by the sync engine only ----

export const parseHistory = (raw: unknown) => parseCollection(raw, isStoredVisit);

// The full collection, tombstones included, and the file it belongs to. Null when signed out.
export const getHistoryForSync = () => (filePath ? { filePath, collection: history } : null);

// Drive's copy arrived: fold it into ours, keeping the 90-day / 20k limit. Not a local change, so it
// doesn't ask for another upload. Returns the merged result, or null if the account changed meanwhile.
export const mergeRemoteHistory = (expectedFile: string, remote: Collection<StoredVisit>) => {
  if (filePath !== expectedFile) {
    return null;
  }

  const merged = merge(history, remote, { timeOf: (visit) => visit.visitedAt, trim: trimHistory });

  if (!sameCollection(merged, history)) {
    history = merged;
    saveSoon();
  }

  return history;
};
