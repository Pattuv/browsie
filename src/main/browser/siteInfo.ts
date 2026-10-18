import { type Cookie, type WebContents } from 'electron';
import { activeContents, getActiveWebUrl, reload } from './tabs';
import { webSession, getCertificate } from './webSession';
import { getSitePermissions, isSitePermissionKind, resetSitePermissions, setSitePermission } from './sitePermissions';

// Our own script world inside the page, so the page's scripts can't tamper with what we read.
const USAGE_WORLD_ID = 1001;
const USAGE_TIMEOUT_MS = 1000;

// The address a cookie belongs to, which cookies.remove needs to find it.
const cookieUrl = (cookie: Cookie) =>
  `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;

// How much the site has stored (databases, caches, local storage), in bytes, or null if it won't say.
// Chromium only reports this from inside the page, so ask there, in our own isolated world.
const getStorageUsage = async (contents: WebContents) => {
  const usage = await Promise.race([
    contents
      .executeJavaScriptInIsolatedWorld(USAGE_WORLD_ID, [
        { code: 'navigator.storage.estimate().then((estimate) => estimate.usage)' },
      ])
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), USAGE_TIMEOUT_MS)),
  ]);

  return typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 ? usage : null;
};

// The site on screen, for the panel's actions. They never take a site from the renderer, so the
// chrome can only ever change settings for the page the user is actually looking at.
const activeOrigin = () => {
  const url = getActiveWebUrl();
  return url ? new URL(url).origin : null;
};

// What the site info panel (the button at the left of the address bar) shows about the open website.
// Null on the New Tab page.
export const getSiteInfo = async (): Promise<SiteInfo | null> => {
  const url = getActiveWebUrl();
  const contents = activeContents();

  if (!url || !contents) {
    return null;
  }

  const { protocol, hostname, origin } = new URL(url);
  const certificate = getCertificate(hostname);
  const [cookies, storageBytes] = await Promise.all([
    webSession().cookies.get({ url }),
    getStorageUsage(contents),
  ]);

  return {
    host: hostname.replace(/^www\./, ''),
    // Chromium refuses pages with a bad certificate, so https that loaded is secure. The 'invalid'
    // check covers the error page it shows in that page's place.
    secure: protocol === 'https:' && certificate !== 'invalid',
    certificate: certificate && certificate !== 'invalid' ? certificate : null,
    cookieCount: cookies.length,
    storageBytes,
    permissions: getSitePermissions(origin),
  };
};

// Deletes the open site's cookies and storage (signing the user out of it), then reloads it.
export const clearSiteData = async () => {
  const url = getActiveWebUrl();

  if (!url) {
    return;
  }

  const web = webSession();
  const cookies = await web.cookies.get({ url });

  await Promise.all(cookies.map((cookie) => web.cookies.remove(cookieUrl(cookie), cookie.name)));
  await web.clearStorageData({ origin: new URL(url).origin });
  reload();
};

export const changeSitePermission = (kind: unknown, setting: unknown) => {
  const origin = activeOrigin();

  if (!origin || !isSitePermissionKind(kind) || (setting !== 'allow' && setting !== 'block')) {
    throw new Error('Invalid site permission change.');
  }

  setSitePermission(origin, kind, setting);
  return getSitePermissions(origin);
};

export const resetActiveSitePermissions = () => {
  const origin = activeOrigin();

  if (!origin) {
    return [];
  }

  resetSitePermissions(origin);
  return getSitePermissions(origin);
};
