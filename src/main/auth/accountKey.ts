import { createHash } from 'node:crypto';

// A short, stable stand-in for the account's Google ID, for naming that account's things on disk
// (its web storage, its bookmarks). The same account always gets the same key, and the Google ID
// itself never appears in folder or file names.
export const accountKey = (accountId: string) => createHash('sha256').update(accountId).digest('hex').slice(0, 16);
