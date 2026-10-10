import { app, session } from 'electron';

// Websites get their own storage partition: cookies, cache and logins for the web live here,
// completely apart from the default session that Browsie's own pages use.
export const WEB_PARTITION = 'persist:web';

// Everything a page asks for (camera, location, notifications...) is refused unless listed here.
// Fullscreen lets videos fill the screen; clipboard-sanitized-write lets "copy" buttons work.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

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

  // No downloads until there's a download UI that can ask first.
  web.on('will-download', (event) => event.preventDefault());
};
