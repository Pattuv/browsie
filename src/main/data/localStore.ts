import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The copy that goes to Drive: the app data plus who changed it last, and when.
export type SyncedDoc = AppData & {
  schemaVersion: 1;
  updatedAt: string;
  deviceId: string;
};

// The whole document on disk: the synced copy plus this device's own sync bookkeeping, which
// never leaves the machine. The renderer only ever sees the AppData part. Not encrypted:
// preferences, not secrets.
type StoredData = SyncedDoc & {
  // Changed since the last successful upload. On disk, so a pending upload survives a restart.
  dirty: boolean;
  // Null until this device has synced with the signed-in account at least once.
  lastSyncedAt: string | null;
};

const dataPath = () => path.join(app.getPath('userData'), 'browsie-data.json');
const legacyUserModePath = () => path.join(app.getPath('userData'), 'user-mode.json');

let stored: StoredData;
// Main-process listeners (the sync engine), told about every local edit.
const localChangeListeners = new Set<() => void>();

const isUserMode = (value: unknown): value is UserMode => value === 'caretaker' || value === 'independent';

const readJson = (filePath: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

// Write-then-rename: a crash mid-write leaves the old file intact instead of half a file.
const writeToDisk = () => {
  const tempPath = `${dataPath()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(stored, null, 2));
  fs.renameSync(tempPath, dataPath());
};

// Startup: read browsie-data.json, or create it, carrying over the mode from the old user-mode.json once.
export const loadLocalStore = () => {
  const existing = readJson(dataPath()) as StoredData | null;

  if (existing?.schemaVersion === 1) {
    // Files written before sync existed have no bookkeeping yet.
    stored = { ...existing, dirty: existing.dirty ?? false, lastSyncedAt: existing.lastSyncedAt ?? null };
    return;
  }

  const legacyMode = (readJson(legacyUserModePath()) as { mode?: unknown } | null)?.mode;
  stored = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    deviceId: randomUUID(),
    userMode: isUserMode(legacyMode) ? legacyMode : null,
    settings: {},
    dirty: false,
    lastSyncedAt: null,
  };
  writeToDisk();
  fs.rmSync(legacyUserModePath(), { force: true });
};

// What the renderer sees: just the app data, no bookkeeping.
export const getData = (): AppData => ({ userMode: stored.userMode, settings: stored.settings });

// Patches arrive from the renderer, so check their shape like any outside input.
const validatePatch = (patch: unknown): AppDataPatch => {
  if (typeof patch !== 'object' || patch === null) {
    throw new Error('Data patch must be an object.');
  }

  const { userMode, settings, ...unknownFields } = patch as Record<string, unknown>;

  if (Object.keys(unknownFields).length > 0) {
    throw new Error(`Unknown data fields: ${Object.keys(unknownFields).join(', ')}`);
  }
  if (userMode !== undefined && !isUserMode(userMode)) {
    throw new Error('Invalid userMode.');
  }
  if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) {
    throw new Error('settings must be an object.');
  }

  return {
    ...(userMode !== undefined && { userMode }),
    ...(settings !== undefined && { settings: settings as AppData['settings'] }),
  };
};

// Push the current data to every window (same "bell" pattern as auth:session-changed).
const broadcast = () => {
  const data = getData();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('data:changed', data);
  }
  return data;
};

export const onLocalChange = (listener: () => void) => {
  localChangeListeners.add(listener);
  return () => localChangeListeners.delete(listener);
};

// A change made on this device: save it, mark it for upload, tell the windows and the sync engine.
export const updateData = (patch: unknown) => {
  const changes = validatePatch(patch);
  stored = {
    ...stored,
    ...changes,
    settings: { ...stored.settings, ...changes.settings },
    updatedAt: new Date().toISOString(),
    dirty: true,
  };
  writeToDisk();
  localChangeListeners.forEach((listener) => listener());
  return broadcast();
};

// ---- Used by the sync engine only ----

export const getSyncSnapshot = () => {
  const { dirty, lastSyncedAt, ...doc } = stored;
  return { doc: doc as SyncedDoc, dirty, lastSyncedAt };
};

// Drive had a newer copy: take its app data and timestamp (keep our own deviceId).
// Returns false if the downloaded file isn't something we can trust, so the caller can overwrite it.
export const applyRemote = (remote: unknown) => {
  const doc = remote as Partial<SyncedDoc> | null;

  if (doc?.schemaVersion !== 1 || typeof doc.updatedAt !== 'string') {
    return false;
  }

  let changes: AppDataPatch;
  try {
    changes = validatePatch({ userMode: doc.userMode ?? null, settings: doc.settings ?? {} });
  } catch {
    return false;
  }

  stored = {
    ...stored,
    userMode: changes.userMode ?? null,
    settings: changes.settings ?? {},
    updatedAt: doc.updatedAt,
    dirty: false,
    lastSyncedAt: new Date().toISOString(),
  };
  writeToDisk();
  broadcast();
  return true;
};

// An upload of the version stamped `uploadedUpdatedAt` succeeded. If the user changed something
// while it was uploading, stay dirty so that newer change goes up next.
export const markSynced = (uploadedUpdatedAt: string) => {
  stored = {
    ...stored,
    dirty: stored.updatedAt === uploadedUpdatedAt ? false : stored.dirty,
    lastSyncedAt: new Date().toISOString(),
  };
  writeToDisk();
};

// Sign-out: forget everything tied to that account so the next person's account never receives
// it. The mode is a choice about this device, so it stays.
export const resetForSignOut = () => {
  stored = { ...stored, settings: {}, dirty: false, lastSyncedAt: null };
  writeToDisk();
  broadcast();
};
