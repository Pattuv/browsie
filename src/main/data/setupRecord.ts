import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { accountKey } from '../auth/accountKey';

// Which accounts have finished setup on this device. Per account, so a new account signing in
// here goes through setup even if someone else already did. Kept by account key, never the Google ID.
// Device-only: not part of the synced app data.
const recordPath = () => path.join(app.getPath('userData'), 'setup-complete.json');

let completed: Set<string> | null = null;

const load = () => {
  if (completed) {
    return completed;
  }

  try {
    const saved = JSON.parse(fs.readFileSync(recordPath(), 'utf8')) as { accounts?: unknown };
    completed = new Set(Array.isArray(saved.accounts) ? saved.accounts.filter((key) => typeof key === 'string') : []);
  } catch {
    completed = new Set();
  }

  

  return completed;
};

// Write-then-rename, like the local store: a crash mid-write leaves the old file intact.
const save = (accounts: Set<string>) => {
  const tempPath = `${recordPath()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ accounts: [...accounts] }, null, 2));
  fs.renameSync(tempPath, recordPath());
};

export const isSetupComplete = (accountId: string) => load().has(accountKey(accountId));

export const markSetupComplete = (accountId: string) => {
  const accounts = load();
  accounts.add(accountKey(accountId));
  save(accounts);
};

export const clearSetupComplete = (accountId: string) => {
  const accounts = load();

  if (accounts.delete(accountKey(accountId))) {
    save(accounts);
  }
};
