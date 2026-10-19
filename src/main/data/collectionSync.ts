import fs from 'node:fs';
import {
  getBookmarksForSync,
  mergeRemoteBookmarks,
  onBookmarksChange,
  parseBookmarks,
} from './bookmarks';
import { sameCollection, type Collection, type SyncedItem } from './collections';
import {
  BOOKMARKS_FILE,
  HISTORY_FILE,
  createFile,
  downloadFile,
  findFile,
  updateFile,
  type DriveFileName,
} from './driveClient';
import { getHistoryForSync, mergeRemoteHistory, onHistoryChange, parseHistory } from './history';
import { getDeviceId } from './localStore';

// Bookmarks and history sync by merging: download Drive's copy, fold it into ours item by item, upload
// the result. Nothing is ever lost to "whoever uploaded last". See collections.ts for the merge rules.

export type CollectionKind = 'bookmarks' | 'history';

type Store = {
  driveFile: DriveFileName;
  forSync: () => { filePath: string; collection: Collection<SyncedItem> } | null;
  parse: (raw: unknown) => Collection<SyncedItem> | null;
  mergeRemote: (expectedFile: string, remote: Collection<SyncedItem>) => Collection<SyncedItem> | null;
  onChange: (listener: () => void) => void;
};

// The stores' own item types are narrower than SyncedItem; the engine only needs the shared part.
const STORES: Record<CollectionKind, Store> = {
  bookmarks: {
    driveFile: BOOKMARKS_FILE,
    forSync: getBookmarksForSync,
    parse: parseBookmarks,
    mergeRemote: mergeRemoteBookmarks as Store['mergeRemote'],
    onChange: onBookmarksChange,
  },
  history: {
    driveFile: HISTORY_FILE,
    forSync: getHistoryForSync,
    parse: parseHistory,
    mergeRemote: mergeRemoteHistory as Store['mergeRemote'],
    onChange: onHistoryChange,
  },
};

// This device's bookkeeping for one collection, kept next to it on disk and never uploaded:
// whether it has changes Drive hasn't seen, and which Drive version it last merged with.
type SyncState = { dirty: boolean; version: string | null };

const statePath = (filePath: string) => filePath.replace(/\.json$/, '.sync.json');

const readState = (filePath: string): SyncState => {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(filePath), 'utf8')) as Partial<SyncState>;
    return { dirty: raw.dirty === true, version: typeof raw.version === 'string' ? raw.version : null };
  } catch {
    // Never synced on this device: nothing seen from Drive yet. Any local items still need uploading.
    return { dirty: true, version: null };
  }
};

const writeState = (filePath: string, state: SyncState) => {
  try {
    const tempPath = `${statePath(filePath)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state));
    fs.renameSync(tempPath, statePath(filePath));
  } catch (error) {
    console.warn('[sync] could not save sync state:', error);
  }
};

// Bumped on every local change, so a sync that started before the change knows it didn't upload it.
const revisions: Record<CollectionKind, number> = { bookmarks: 0, history: 0 };

// The engine calls this once; `onLocalChange` is how it hears it should upload soon.
export const watchCollections = (onLocalChange: (kind: CollectionKind) => void) => {
  for (const kind of Object.keys(STORES) as CollectionKind[]) {
    STORES[kind].onChange(() => {
      revisions[kind] += 1;
      const snapshot = STORES[kind].forSync();

      if (snapshot) {
        writeState(snapshot.filePath, { ...readState(snapshot.filePath), dirty: true });
      }

      onLocalChange(kind);
    });
  }
};

const newVersion = () => `${new Date().toISOString()}|${getDeviceId()}`;

// One pass for one collection. `stillCurrent` turns false if the user signed out meanwhile, and then
// nothing is applied or uploaded: one account's data can never end up in another's.
export const syncCollection = async (kind: CollectionKind, stillCurrent: () => boolean) => {
  const store = STORES[kind];
  const snapshot = store.forSync();

  if (!snapshot) {
    return;
  }

  const { filePath } = snapshot;
  const state = readState(filePath);
  const startRevision = revisions[kind];
  const remote = await findFile(store.driveFile);

  if (!stillCurrent()) {
    return;
  }

  // Nothing new on either side.
  if (remote && remote.version === state.version && !state.dirty) {
    return;
  }

  let result = snapshot.collection;

  // Drive has a version we haven't merged with yet: fetch it and fold it in.
  if (remote && remote.version !== state.version) {
    const parsed = store.parse(await downloadFile(remote.id));

    if (!stillCurrent()) {
      return;
    }

    // Unreadable copy on Drive: fall through and replace it with ours.
    if (parsed) {
      const merged = store.mergeRemote(filePath, parsed);

      if (!merged) {
        return;
      }

      result = merged;

      // Drive already holds everything we have: just remember we're level with it.
      if (sameCollection(merged, parsed)) {
        writeState(filePath, { dirty: revisions[kind] !== startRevision, version: remote.version ?? null });
        return;
      }
    }
  }

  // A brand-new account with nothing saved yet: no need for an empty file on Drive.
  if (!remote && result.items.length === 0 && !result.clearedBefore) {
    writeState(filePath, { dirty: false, version: null });
    return;
  }

  const version = newVersion();

  if (remote) {
    await updateFile(remote.id, result, { version });
  } else {
    await createFile(store.driveFile, result, { version });
  }

  if (stillCurrent()) {
    // A change that landed during the upload is still waiting: stay dirty so it goes up next time.
    writeState(filePath, { dirty: revisions[kind] !== startRevision, version });
  }
};
