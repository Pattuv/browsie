import { app, session, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { accountKey } from '../auth/accountKey';
import { getData } from '../data/localStore';
import { forceSafeSearch, safeSearchEnabled } from '../../shared/web/safeSearch';
import { forgetGoogleLogin, setGoogleLoginPartition, watchGoogleLogin } from './googleWebLogin';
import { isAllowed } from './sitePermissions';
import { handleDownloads } from '../web/files';

// Websites get their own storage partition: cookies, cache and logins for the web live there,
// completely apart from the default session that Browsie's own pages use. Each Browsie account has its
// own, like Chrome profiles: signing out locks your web logins away on this device, someone else signing
// in starts with their own, and signing back in brings yours back.
// While nobody is signed in, websites get an in-memory partition (no "persist:") that's never saved.
const GUEST_PARTITION = 'web-guest';
// Before web storage was split per account, every account shared this one.
const LEGACY_PARTITION_FOLDER = 'web';

let webPartition = GUEST_PARTITION;
const configured = new Set<string>();

// The same account always gets the same folder, and its Google ID never appears in folder names on disk.
const partitionFor = (accountId: string) => `persist:web-${accountKey(accountId)}`;

export const getWebPartition = () => webPartition;
export const webSession = () => session.fromPartition(webPartition);

// Read on each request, so turning the setting off takes effect without restarting.
export const isSafeSearchOn = () => {
  try {
    return safeSearchEnabled(getData().settings);
  } catch {
    return true;
  }
};

// Every website may use these. Fullscreen lets videos fill the screen; clipboard-sanitized-write
// lets "copy" buttons work.
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write']);

const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

// Location, camera, microphone and notifications follow the user's choice in Site settings, and only
// for the page itself: an ad or other embedded frame never inherits what its host page was allowed.
// Everything else a page asks for is refused.
const decide = (
  contents: WebContents | null,
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  mediaTypes: string[],
) => {
  if (ALWAYS_ALLOWED.has(permission)) {
    return true;
  }

  const origin = originOf(requestingUrl);

  if (!origin || !isMainFrame || origin !== originOf(contents?.getURL())) {
    return false;
  }

  if (permission === 'geolocation' || permission === 'notifications') {
    return isAllowed(origin, permission);
  }

  if (permission === 'media') {
    return (
      mediaTypes.length > 0 &&
      mediaTypes.every((type) =>
        type === 'video' ? isAllowed(origin, 'camera') : type === 'audio' && isAllowed(origin, 'microphone'),
      )
    );
  }

  return false;
};

// The last certificate Chromium checked for each host, for the site info panel. Chromium makes the
// call; we only take notes. Entries are dropped oldest-first past the cap.
const MAX_CERTIFICATES = 500;
const certificates = new Map<string, SiteCertificate | 'invalid'>();

const rememberCertificate = (hostname: string, entry: SiteCertificate | 'invalid') => {
  certificates.delete(hostname);
  certificates.set(hostname, entry);

  if (certificates.size > MAX_CERTIFICATES) {
    certificates.delete(certificates.keys().next().value!);
  }
};

// Undefined when the host was never checked this run (e.g. its connection was shared with another host).
export const getCertificate = (hostname: string) => certificates.get(hostname);

export { isWebUrl } from '../../shared/web/url';

// Electron puts our app name between "(KHTML, like Gecko)" and "Chrome/". Drop only that.
// Keep "Electron/…": Google sends an honest Electron browser to its simpler sign-in page, while one
// posing as plain Chrome gets the full page, which then rejects it ("This browser or app may not be secure").
const webUserAgent = (userAgent: string) =>
  userAgent.replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/');

// One failed Google sign-in leaves these cookies behind, and from then on Google goes straight to
// the error page. Clearing them leaves real logins (SID, __Secure-…) alone.
const GOOGLE_REJECTION_COOKIES = new Set(['__Host-GAPS', 'OTZ']);
const GOOGLE_DOMAINS = ['google.com', 'accounts.google.com', 'mail.google.com'];

export const clearGoogleRejectionCookies = async (web = webSession()) => {
  const { cookies } = web;

  for (const domain of GOOGLE_DOMAINS) {
    for (const cookie of await cookies.get({ domain })) {
      if (!GOOGLE_REJECTION_COOKIES.has(cookie.name)) {
        continue;
      }

      const host = (cookie.domain ?? domain).replace(/^\./, '');
      await cookies.remove(`${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`, cookie.name);
    }
  }
};

// Google's sign-in error page, after it has rejected the browser.
export const isGoogleSignInRejection = (url: string) =>
  url.includes('accounts.google.com') && (url.includes('signin/rejected') || url.includes('rrk=46'));

// Every account's partition lives by the same rules. Runs once per partition, the first time it's used.
const configurePartition = (partition: string) => {
  if (configured.has(partition)) {
    return;
  }

  configured.add(partition);
  const web = session.fromPartition(partition);

  // Set on the session, not per tab, so the page and its fetch/XHR requests all send the same string.
  web.setUserAgent(webUserAgent(web.getUserAgent()));
  void clearGoogleRejectionCookies(web).catch(() => undefined);
  watchGoogleLogin(partition, web);

  web.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    callback(decide(contents, permission, details.requestingUrl, details.isMainFrame, mediaTypes));
  });
  web.setPermissionCheckHandler((contents, permission, _origin, { requestingUrl, isMainFrame, mediaType }) => {
    // A media check without a type (listing devices) passes if either the camera or mic is allowed.
    if (permission === 'media' && mediaType !== 'video' && mediaType !== 'audio') {
      return ['video', 'audio'].some((type) => decide(contents, permission, requestingUrl, isMainFrame, [type]));
    }

    return decide(contents, permission, requestingUrl, isMainFrame, mediaType ? [mediaType] : []);
  });

  // -3 means "use Chromium's own verdict", so bad certificates are still refused exactly as before.
  // Never call back with 0 here: that would accept every certificate.
  web.setCertificateVerifyProc(({ hostname, certificate, errorCode }, callback) => {
    rememberCertificate(
      hostname,
      errorCode === 0
        ? {
            issuedTo: certificate.subject.commonName || hostname,
            issuedBy: certificate.issuer.organizations[0] || certificate.issuer.commonName || certificate.issuerName,
            validFrom: new Date(certificate.validStart * 1000).toISOString(),
            validUntil: new Date(certificate.validExpiry * 1000).toISOString(),
          }
        : 'invalid',
    );
    callback(-3);
  });

  // People can't download until there's a download UI that can ask first. The agent can, on the tab it's
  // working on: files go to this account's Browsie Downloads folder, and executables are refused.
  handleDownloads(web, () => downloadsFolderFor(partition), (contents) => downloadPolicy.allow(contents), (contents, fileName) =>
    downloadPolicy.onStarted(contents, fileName),
  );

  // SafeSearch is forced on the request itself, so a link, a redirect, or the agent can't drop it.
  // Direct addresses are left alone: this only rewrites search engines' own result URLs.
  web.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!isSafeSearchOn() || details.method !== 'GET') {
      callback({});
      return;
    }

    const redirectURL = forceSafeSearch(details.url);
    callback(redirectURL ? { redirectURL } : {});
  });
  // YouTube's own lock. It applies to search and playback, which have no safe= parameter to rewrite.
  web.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };

    if (isSafeSearchOn()) {
      requestHeaders['YouTube-Restrict'] = 'Strict';
    }

    callback({ requestHeaders });
  });
};

type DownloadPolicy = {
  allow: (contents: WebContents | undefined) => boolean;
  onStarted: (contents: WebContents | undefined, fileName: string) => void;
};

// Nothing may download until the agent sets this up.
let downloadPolicy: DownloadPolicy = { allow: () => false, onStarted: () => undefined };

export const setDownloadPolicy = (policy: DownloadPolicy) => {
  downloadPolicy = policy;
};

// userData/Browsie Downloads/<account key>, or …/guest while nobody is signed in.
const downloadsFolderFor = (partition: string) =>
  path.join(app.getPath('userData'), 'Browsie Downloads', partition.startsWith('persist:web-') ? partition.slice('persist:web-'.length) : 'guest');

export const getDownloadsFolder = () => downloadsFolderFor(webPartition);

// Points websites at this account's storage (null = signed out). Returns true if that changed, so the
// caller can close tabs still attached to the previous account's storage.
export const setWebAccount = (accountId: string | null) => {
  const next = accountId ? partitionFor(accountId) : GUEST_PARTITION;
  configurePartition(next);
  setGoogleLoginPartition(next);

  if (next === webPartition) {
    return false;
  }

  webPartition = next;
  return true;
};

// "Remove my data from this device" at sign-out: that account's cookies, logins, site storage and cache.
export const removeWebData = async (accountId: string) => {
  const partition = partitionFor(accountId);
  const web = session.fromPartition(partition);
  await web.clearStorageData();
  await web.clearCache();
  forgetGoogleLogin(partition);
};

// Startup, before any partition is opened: the old shared storage holds logins from whoever used it
// before accounts were separated, so it can't be handed to anyone. Delete it; nothing opens it any more.
const removeLegacyWebData = () => {
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'Partitions', LEGACY_PARTITION_FOLDER), {
      recursive: true,
      force: true,
    });
  } catch {
    // Locked or already gone: harmless, it's never read.
  }
};

export const configureWebSession = (accountId: string | null) => {
  removeLegacyWebData();
  configurePartition(GUEST_PARTITION);
  setWebAccount(accountId);
};
