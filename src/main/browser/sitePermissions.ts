import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// What a website can be allowed to use, set per site from the site info panel. Everything starts
// blocked: there's no permission prompt yet, so "ask" would just mean "block" anyway.
export const SITE_PERMISSION_KINDS: SitePermissionKind[] = ['geolocation', 'camera', 'microphone', 'notifications'];

type StoredPermissions = Record<string, Partial<Record<SitePermissionKind, 'allow'>>>;

const filePath = () => path.join(app.getPath('userData'), 'site-permissions.json');

// Origin ("https://www.google.com") → what it's been allowed. Only allows are stored; anything else is blocked.
let allowed: StoredPermissions | null = null;

const load = (): StoredPermissions => {
  if (allowed) {
    return allowed;
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    allowed = parsed && typeof parsed === 'object' ? (parsed as StoredPermissions) : {};
  } catch {
    allowed = {};
  }

  return allowed;
};

// Write-then-rename, like localStore: a crash mid-write leaves the old file intact.
const save = () => {
  const tempPath = `${filePath()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(load(), null, 2));
  fs.renameSync(tempPath, filePath());
};

export const isSitePermissionKind = (value: unknown): value is SitePermissionKind =>
  SITE_PERMISSION_KINDS.includes(value as SitePermissionKind);

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

  save();
};

export const resetSitePermissions = (origin: string) => {
  delete load()[origin];
  save();
};
