import { app, session, type WebContents } from 'electron';
import { isAllowed } from './sitePermissions';

// Websites get their own storage partition: cookies, cache and logins for the web live here,
// completely apart from the default session that Browsie's own pages use.
export const WEB_PARTITION = 'persist:web';

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

// Only real web addresses. Blocks file://, javascript:, other apps' custom schemes and our own pages.
export const isWebUrl = (rawUrl: string) => {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const configureWebSession = () => {
  const web = session.fromPartition(WEB_PARTITION);

  // Electron's default user agent mentions "Electron/…" and our app name, and some sites
  // (Google sign-in especially) refuse browsers they don't recognize. Look like plain Chrome.
  const extraTokens = new RegExp(`\\s(Electron|${escapeRegExp(app.getName())})/\\S+`, 'g');
  web.setUserAgent(web.getUserAgent().replace(extraTokens, ''));

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

  // No downloads until there's a download UI that can ask first.
  web.on('will-download', (event) => event.preventDefault());
};
