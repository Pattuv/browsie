import { app, session } from 'electron';

// Websites get their own storage partition: cookies, cache and logins for the web live here,
// completely apart from the default session that Browsie's own pages use.
export const WEB_PARTITION = 'persist:web';

// Everything a page asks for (camera, location, notifications...) is refused unless listed here.
// Fullscreen lets videos fill the screen; clipboard-sanitized-write lets "copy" buttons work.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

// What the site info panel lists under Site settings, in plain words.
const SITE_PERMISSIONS = [
  { label: 'Location', permission: 'geolocation' },
  { label: 'Camera and microphone', permission: 'media' },
  { label: 'Notifications', permission: 'notifications' },
  { label: 'Full screen', permission: 'fullscreen' },
];

export const getSitePermissions = (): SitePermission[] => [
  ...SITE_PERMISSIONS.map(({ label, permission }) => ({ label, allowed: ALLOWED_PERMISSIONS.has(permission) })),
  { label: 'Downloads', allowed: false },
];

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

  web.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  web.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

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
