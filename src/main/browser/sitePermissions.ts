import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getData, updateData } from '../data/localStore';

// What a website can be allowed to use, set per site from the site info panel. Everything starts
// blocked: there's no permission prompt yet, so "ask" would just mean "block" anyway.
export const SITE_PERMISSION_KINDS: SitePermissionKind[] = ['geolocation', 'camera', 'microphone', 'notifications'];

type StoredPermissions = Record<string, Partial<Record<SitePermissionKind, 'allow'>>>;

// Kept in the app settings, so they're backed up to Drive with everything else, follow the account to
// other computers, and are cleared on sign-out like the rest of that account's settings.
const SETTINGS_KEY = 'sitePermissions';

// Before permissions moved into the settings, they lived in their own file on this device.
const legacyFilePath = () => path.join(app.getPath('userData'), 'site-permissions.json');

export const isSitePermissionKind = (value: unknown): value is SitePermissionKind =>
  SITE_PERMISSION_KINDS.includes(value as SitePermissionKind);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Settings can arrive from Drive, so keep only well-formed entries: origin → { kind: 'allow' }.
const clean = (raw: unknown): StoredPermissions => {
  const permissions: StoredPermissions = {};

  if (!isRecord(raw)) {
    return permissions;
  }

  for (const [origin, site] of Object.entries(raw)) {
    if (!isRecord(site)) {
      continue;
    }

    const allowed = Object.keys(site).filter((kind) => isSitePermissionKind(kind) && site[kind] === 'allow');

    if (allowed.length) {
      permissions[origin] = Object.fromEntries(allowed.map((kind) => [kind, 'allow']));
    }
  }

  return permissions;
};

// Origin ("https://www.google.com") → what it's been allowed. Only allows are stored; anything else is blocked.
const load = () => clean(getData().settings[SETTINGS_KEY]);

const save = (permissions: StoredPermissions) => {
  updateData({ settings: { [SETTINGS_KEY]: permissions } });
};

// Startup, once: carry the old file's permissions into the settings, then delete the file.
export const migrateSitePermissions = () => {
  let legacy: unknown;

  try {
    legacy = JSON.parse(fs.readFileSync(legacyFilePath(), 'utf8'));
  } catch {
    return;
  }

  if (getData().settings[SETTINGS_KEY] === undefined) {
    save(clean(legacy));
  }

  fs.rmSync(legacyFilePath(), { force: true });
};

export const isAllowed = (origin: string, kind: SitePermissionKind) => load()[origin]?.[kind] === 'allow';

export const getSitePermissions = (origin: string): SitePermission[] =>
  SITE_PERMISSION_KINDS.map((kind) => ({ kind, setting: isAllowed(origin, kind) ? 'allow' : 'block' }));

export const setSitePermission = (origin: string, kind: SitePermissionKind, setting: 'allow' | 'block') => {
  const permissions = load();
  const site = { ...permissions[origin] };

  if (setting === 'allow') {
    site[kind] = 'allow';
  } else {
    delete site[kind];
  }

  if (Object.keys(site).length) {
    permissions[origin] = site;
  } else {
    delete permissions[origin];
  }

  save(permissions);
};

export const resetSitePermissions = (origin: string) => {
  const permissions = load();
  delete permissions[origin];
  save(permissions);
};
