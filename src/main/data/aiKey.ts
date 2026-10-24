import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { accountKey } from '../auth/accountKey';
import { canPersistSecrets } from '../auth/vault';

// Each account's OpenRouter keys, encrypted with DPAPI like the sign-in vault: userData/ai-keys/<account key>.bin.
// The user gives us a management key. That can't run AI requests, so we use it to make Browsie its own
// key for that, and to read the credit balance and the Browsie key's cap for the usage card.
// The renderer can hand a key in but never reads one back.
const keyFolder = () => path.join(app.getPath('userData'), 'ai-keys');
const keyPath = (accountId: string) => path.join(keyFolder(), `${accountKey(accountId)}.bin`);

const API_BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 8_000;
// The name the user sees for our key in their OpenRouter dashboard.
const BROWSIE_KEY_NAME = 'Browsie';

// Loose on purpose: catches pasting the wrong thing. OpenRouter itself decides whether the key is real.
const KEY_PATTERN = /^sk-or-[A-Za-z0-9_-]{16,256}$/;

type StoredKeys = {
  managementKey: string;
  // The key Browsie makes for itself, and its id for reading or deleting it with the management key.
  aiKey: string;
  aiKeyHash: string;
};

export type SaveAiKeyResult =
  | 'saved'
  | 'invalid'
  | 'invalid-cap'
  | 'rejected'
  | 'not-management'
  | 'offline'
  | 'unavailable';

// no-key: this account has no Browsie key yet, so the cap can't be changed on its own.
export type UpdateAiKeyResult = SaveAiKeyResult | 'no-key';

// Most Browsie's key may spend, in US dollars, per period (or in total when it never resets).
const MAX_CAP = 10_000;

const parseCap = (raw: unknown) => {
  const cap = raw as { limit?: unknown; reset?: unknown } | null;
  const limit = cap?.limit;
  const reset = cap?.reset;

  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 || limit > MAX_CAP) {
    return null;
  }

  if (reset !== null && reset !== 'daily' && reset !== 'weekly' && reset !== 'monthly') {
    return null;
  }

  return { limit: Math.round(limit * 100) / 100, reset };
};

export const openRouterFetch = (route: string, key: string, init: RequestInit = {}) =>
  fetch(`${API_BASE}${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

const readStored = (accountId: string): StoredKeys | null => {
  try {
    const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(keyPath(accountId)))) as Partial<StoredKeys>;
    return stored.managementKey && stored.aiKey && stored.aiKeyHash ? (stored as StoredKeys) : null;
  } catch {
    // Missing, undecryptable, or saved before management keys (a bare key): set up the key again.
    return null;
  }
};

// Best effort: an orphaned Browsie key only clutters their dashboard; it can't be used without the file.
const deleteBrowsieKey = (stored: StoredKeys) => {
  openRouterFetch(`/keys/${stored.aiKeyHash}`, stored.managementKey, { method: 'DELETE' }).catch(() => undefined);
};

// Write-then-rename: a crash mid-write leaves the old keys intact instead of half a file.
const writeStored = (accountId: string, stored: StoredKeys) => {
  fs.mkdirSync(keyFolder(), { recursive: true });
  const tempPath = `${keyPath(accountId)}.tmp`;
  fs.writeFileSync(tempPath, safeStorage.encryptString(JSON.stringify(stored)));
  fs.renameSync(tempPath, keyPath(accountId));
};

export const saveAiKey = async (accountId: string, raw: unknown, rawCap: unknown): Promise<SaveAiKeyResult> => {
  const managementKey = typeof raw === 'string' ? raw.trim() : '';
  const cap = parseCap(rawCap);

  if (!KEY_PATTERN.test(managementKey)) {
    return 'invalid';
  }

  if (!cap) {
    return 'invalid-cap';
  }

  if (!canPersistSecrets()) {
    return 'unavailable';
  }

  try {
    // Only management keys may read the credit balance, so this tells the two kinds apart.
    const check = await openRouterFetch('/credits', managementKey);

    if (check.status === 401) {
      return 'rejected';
    }

    if (check.status === 403) {
      return 'not-management';
    }

    if (!check.ok) {
      return 'offline';
    }

    // The cap the user chose in setup, set explicitly so OpenRouter's default never decides it.
    const created = await openRouterFetch('/keys', managementKey, {
      method: 'POST',
      body: JSON.stringify({ name: BROWSIE_KEY_NAME, limit: cap.limit, limit_reset: cap.reset }),
    });
    const body = (await created.json().catch(() => null)) as { key?: string; data?: { hash?: string } } | null;

    if (!created.ok || !body?.key || !body.data?.hash) {
      return 'offline';
    }

    const previous = readStored(accountId);
    const stored: StoredKeys = { managementKey, aiKey: body.key, aiKeyHash: body.data.hash };
    writeStored(accountId, stored);

    // Replacing the keys: don't leave the old Browsie key live on their account.
    if (previous) {
      deleteBrowsieKey(previous);
    }

    return 'saved';
  } catch {
    return 'offline';
  }
};

export const hasAiKey = (accountId: string) => readStored(accountId) !== null;

// For when this device's data is wiped. Leaves nothing behind for the next person to decrypt as this user,
// and deletes the Browsie key on OpenRouter too. Their management key stays theirs to revoke.
export const removeAiKey = (accountId: string) => {
  const stored = readStored(accountId);

  if (stored) {
    deleteBrowsieKey(stored);
  }

  fs.rmSync(keyPath(accountId), { force: true });
  fs.rmSync(`${keyPath(accountId)}.tmp`, { force: true });
};

// Changes the cap on the Browsie key this account already has. The management key stays put.
export const updateAiCap = async (accountId: string, rawCap: unknown): Promise<UpdateAiKeyResult> => {
  const cap = parseCap(rawCap);
  const stored = readStored(accountId);

  if (!cap) {
    return 'invalid-cap';
  }

  if (!stored) {
    return 'no-key';
  }

  try {
    const response = await openRouterFetch(`/keys/${stored.aiKeyHash}`, stored.managementKey, {
      method: 'PATCH',
      body: JSON.stringify({ limit: cap.limit, limit_reset: cap.reset }),
    });

    if (response.status === 401 || response.status === 403) {
      return 'rejected';
    }

    return response.ok ? 'saved' : 'offline';
  } catch {
    return 'offline';
  }
};

// Swaps the management key used to read credits and change the cap. When the new key can see Browsie's
// existing AI key, that key is kept. When it can't (a different OpenRouter account, or the key was
// deleted), a new Browsie key is made with `rawCap` and the old one is removed.
export const replaceManagementKey = async (accountId: string, raw: unknown, rawCap: unknown): Promise<UpdateAiKeyResult> => {
  const managementKey = typeof raw === 'string' ? raw.trim() : '';
  const stored = readStored(accountId);

  if (!KEY_PATTERN.test(managementKey)) {
    return 'invalid';
  }

  if (!stored) {
    return saveAiKey(accountId, managementKey, rawCap);
  }

  if (!canPersistSecrets()) {
    return 'unavailable';
  }

  try {
    const check = await openRouterFetch('/credits', managementKey);

    if (check.status === 401) {
      return 'rejected';
    }

    if (check.status === 403) {
      return 'not-management';
    }

    if (!check.ok) {
      return 'offline';
    }

    const owns = await openRouterFetch(`/keys/${stored.aiKeyHash}`, managementKey);

    if (owns.ok) {
      writeStored(accountId, { ...stored, managementKey });
      return 'saved';
    }

    if (owns.status === 404 || owns.status === 403) {
      return saveAiKey(accountId, managementKey, rawCap);
    }

    return 'offline';
  } catch {
    return 'offline';
  }
};

// Main only: the key the AI features call OpenRouter with. Null when missing or the OS refuses to decrypt.
export const readAiKey = (accountId: string) => readStored(accountId)?.aiKey ?? null;

// Main only: what the usage card needs to read the balance and the Browsie key's cap.
export const readManagementAccess = (accountId: string) => {
  const stored = readStored(accountId);
  return stored ? { managementKey: stored.managementKey, aiKeyHash: stored.aiKeyHash } : null;
};
