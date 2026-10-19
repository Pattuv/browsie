import { randomUUID } from 'node:crypto';
import { getAccessToken, invalidateAccessToken } from '../auth/session';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const REQUEST_TIMEOUT_MS = 30_000;

// Browsie's files in the account's hidden app folder: settings, and each synced collection.
export const SETTINGS_FILE = 'browsie-data.json';
export const BOOKMARKS_FILE = 'browsie-bookmarks.json';
export const HISTORY_FILE = 'browsie-history.json';
export type DriveFileName = typeof SETTINGS_FILE | typeof BOOKMARKS_FILE | typeof HISTORY_FILE;

// updatedAt versions the settings file; version ("<time>|<device>") versions the collection files.
export type RemoteFile = { id: string; updatedAt?: string; version?: string };

// Carries the HTTP status so the sync engine can tell "try again later" (429, 5xx) from "file gone" (404).
export class DriveError extends Error {
  constructor(readonly status: number) {
    super(`Drive request failed: ${status}`);
  }
}

// Every call goes through here: attach the token, and if Drive says 401 (token revoked or stale),
// drop the cached token and try exactly once more with a fresh one.
const driveFetch = async (url: string, init: RequestInit = {}, retried = false): Promise<Response> => {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await getAccessToken()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 && !retried) {
    invalidateAccessToken();
    return driveFetch(url, init, true);
  }

  if (!response.ok) {
    throw new DriveError(response.status);
  }

  return response;
};

// Drive's "multipart" upload: one request carrying two parts, the file's metadata (name, folder,
// our version stamp) and the file's contents, separated by a random boundary line.
const multipart = (metadata: object, contents: unknown) => {
  const boundary = `browsie-${randomUUID()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(contents),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
};

// 1. Find one of our files in the hidden app folder. Its version stamp rides along in appProperties,
//    so we can compare versions without downloading the whole file.
export const findFile = async (name: DriveFileName): Promise<RemoteFile | null> => {
  const url = new URL(FILES_URL);
  url.search = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${name}'`,
    fields: 'files(id,appProperties)',
  }).toString();

  const { files } = (await (await driveFetch(url.toString())).json()) as {
    files: { id: string; appProperties?: { updatedAt?: string; version?: string } }[];
  };
  const [file] = files;
  return file ? { id: file.id, updatedAt: file.appProperties?.updatedAt, version: file.appProperties?.version } : null;
};

// 2. Download its contents.
export const downloadFile = async (id: string): Promise<unknown> =>
  (await driveFetch(`${FILES_URL}/${id}?alt=media`)).json();

// 3. Create it the first time (inside appDataFolder, which only Browsie can see).
export const createFile = async (name: DriveFileName, contents: unknown, appProperties: Record<string, string>) => {
  const { body, headers } = multipart({ name, parents: ['appDataFolder'], appProperties }, contents);
  await driveFetch(`${UPLOAD_URL}?uploadType=multipart`, { method: 'POST', body, headers });
};

// 4. Overwrite it after that.
export const updateFile = async (id: string, contents: unknown, appProperties: Record<string, string>) => {
  const { body, headers } = multipart({ appProperties }, contents);
  await driveFetch(`${UPLOAD_URL}/${id}?uploadType=multipart`, { method: 'PATCH', body, headers });
};
