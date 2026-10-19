import fs from 'node:fs';

// Bookmarks and history are lists of items, each with its own id, so two devices can both make
// changes and syncing merges them instead of one copy overwriting the other (which is what the
// settings document does). No Electron in here: it's plain data, so the merge rules can be tested alone.

export type SyncedItem = {
  id: string;
  // When this item last changed, on whichever device changed it. The newer copy wins a merge.
  updatedAt: string;
  // Which device made that change. Breaks ties the same way on every device.
  deviceId: string;
  // A tombstone: the item was deleted, and this copy carries the delete to other devices.
  deleted?: true;
};

export type Collection<T extends SyncedItem> = {
  schemaVersion: 1;
  items: T[];
  // "Clear all" sets this: anything from before it is gone, on every device. Null if never cleared.
  clearedBefore: string | null;
};

export type MergeOptions<T extends SyncedItem> = {
  // The time compared with clearedBefore. History uses when the visit happened.
  timeOf?: (item: T) => string;
  // Last step, to cap the size (history keeps 90 days and at most 20k visits).
  trim?: (items: T[]) => T[];
  now?: number;
};

// Tombstones only need to live long enough to reach every device.
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const emptyCollection = <T extends SyncedItem>(): Collection<T> => ({
  schemaVersion: 1,
  items: [],
  clearedBefore: null,
});

// a is newer than b? Timestamps are ISO strings, so they compare as text. Same moment: higher deviceId wins.
const isNewer = (a: SyncedItem, b: SyncedItem) =>
  a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.deviceId > b.deviceId;

const laterOf = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

// The heart of sync: every id from both sides, the newer copy of each, older-than-clear dropped,
// expired tombstones dropped. Same inputs give the same result on every device, in either order.
export const merge = <T extends SyncedItem>(
  local: Collection<T>,
  remote: Collection<T>,
  { timeOf = (item) => item.updatedAt, trim = (items) => items, now = Date.now() }: MergeOptions<T> = {},
): Collection<T> => {
  const byId = new Map<string, T>();

  for (const item of [...local.items, ...remote.items]) {
    const existing = byId.get(item.id);

    if (!existing || isNewer(item, existing)) {
      byId.set(item.id, item);
    }
  }

  const clearedBefore = laterOf(local.clearedBefore, remote.clearedBefore);
  const tombstoneCutoff = new Date(now - TOMBSTONE_TTL_MS).toISOString();

  const items = [...byId.values()].filter(
    (item) =>
      (!clearedBefore || timeOf(item) >= clearedBefore) && !(item.deleted && item.updatedAt < tombstoneCutoff),
  );

  return { schemaVersion: 1, items: trim(items), clearedBefore };
};

// Whether two copies hold the same thing, so sync can skip an upload that would change nothing.
export const sameCollection = <T extends SyncedItem>(a: Collection<T>, b: Collection<T>) => {
  if (a.clearedBefore !== b.clearedBefore || a.items.length !== b.items.length) {
    return false;
  }

  const versions = new Map(a.items.map((item) => [item.id, `${item.updatedAt}|${item.deviceId}|${item.deleted ?? ''}`]));
  return b.items.every((item) => versions.get(item.id) === `${item.updatedAt}|${item.deviceId}|${item.deleted ?? ''}`);
};

const isString = (value: unknown): value is string => typeof value === 'string';

export const isSyncedItem = (value: unknown): value is SyncedItem => {
  const item = value as Partial<SyncedItem> | null;
  return (
    typeof item === 'object' &&
    item !== null &&
    isString(item.id) &&
    isString(item.updatedAt) &&
    isString(item.deviceId) &&
    (item.deleted === undefined || item.deleted === true)
  );
};

// Collections arrive from disk and from Drive, so check them like any outside input. Bad items are
// dropped one by one, so one corrupt entry can't take the rest down with it. Null if it isn't a collection.
export const parseCollection = <T extends SyncedItem>(
  raw: unknown,
  isItem: (value: unknown) => value is T,
): Collection<T> | null => {
  const doc = raw as Partial<Collection<T>> | null;

  if (doc?.schemaVersion !== 1 || !Array.isArray(doc.items)) {
    return null;
  }

  return {
    schemaVersion: 1,
    items: doc.items.filter((item) => isSyncedItem(item) && isItem(item)),
    clearedBefore: isString(doc.clearedBefore) ? doc.clearedBefore : null,
  };
};

export const readCollection = <T extends SyncedItem>(
  filePath: string,
  isItem: (value: unknown) => value is T,
): Collection<T> => {
  try {
    return parseCollection(JSON.parse(fs.readFileSync(filePath, 'utf8')), isItem) ?? emptyCollection();
  } catch {
    return emptyCollection();
  }
};

// Write-then-rename, like localStore: a crash mid-write leaves the old file intact instead of half a file.
export const writeCollection = <T extends SyncedItem>(filePath: string, collection: Collection<T>) => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(collection));
  fs.renameSync(tempPath, filePath);
};
