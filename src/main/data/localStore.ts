import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The whole document on disk. updatedAt and deviceId are bookkeeping for Drive sync (slice 4);
// the renderer only ever sees the AppData part. Not encrypted: preferences, not secrets.
type StoredData = AppData & {
  schemaVersion: 1;
  updatedAt: string;
  deviceId: string;
};

const dataPath = () => path.join(app.getPath('userData'), 'browsie-data.json');
const legacyUserModePath = () => path.join(app.getPath('userData'), 'user-mode.json');

let stored: StoredData;

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
    stored = existing;
    return;
  }

  const legacyMode = (readJson(legacyUserModePath()) as { mode?: unknown } | null)?.mode;
  stored = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    deviceId: randomUUID(),
    userMode: isUserMode(legacyMode) ? legacyMode : null,
    settings: {},
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

// Save a change and push the new data to every window (same "bell" pattern as auth:session-changed).
export const updateData = (patch: unknown) => {
  const changes = validatePatch(patch);
  stored = {
    ...stored,
    ...changes,
    settings: { ...stored.settings, ...changes.settings },
    updatedAt: new Date().toISOString(),
  };
  writeToDisk();

  const data = getData();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('data:changed', data);
  }
  return data;
};
