import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { accountKey } from '../auth/accountKey';

// Each account's bookmarks and history live in their own folder on this device:
// userData/library/<account key>/<name>.json (plus each one's sync bookkeeping beside it).
const libraryFolder = (accountId: string) => path.join(app.getPath('userData'), 'library', accountKey(accountId));

export const libraryFile = (accountId: string, name: 'bookmarks' | 'history') =>
  path.join(libraryFolder(accountId), `${name}.json`);

// "Remove my data from this device" at sign-out. Only after the stores have let go of this account;
// the copy in the account's Drive comes back the next time it signs in.
export const removeLibraryData = (accountId: string) => {
  fs.rmSync(libraryFolder(accountId), { recursive: true, force: true });
};
