import { session, type Cookie } from 'electron';
import { getActiveWebUrl, reload } from './tabs';
import { WEB_PARTITION, getCertificate, getSitePermissions } from './webSession';

// The address a cookie belongs to, which cookies.remove needs to find it.
const cookieUrl = (cookie: Cookie) =>
  `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;

// What the site info panel (the button at the left of the address bar) shows about the open website.
// Null on the New Tab page.
export const getSiteInfo = async (): Promise<SiteInfo | null> => {
  const url = getActiveWebUrl();

  if (!url) {
    return null;
  }

  const { protocol, hostname } = new URL(url);
  const certificate = getCertificate(hostname);
  const cookies = await session.fromPartition(WEB_PARTITION).cookies.get({ url });

  return {
    host: hostname.replace(/^www\./, ''),
    // Chromium refuses pages with a bad certificate, so https that loaded is secure. The 'invalid'
    // check covers the error page it shows in that page's place.
    secure: protocol === 'https:' && certificate !== 'invalid',
    certificate: certificate && certificate !== 'invalid' ? certificate : null,
    cookieCount: cookies.length,
    permissions: getSitePermissions(),
  };
};

// Deletes the open site's cookies and storage (signing the user out of it), then reloads it.
export const clearSiteData = async () => {
  const url = getActiveWebUrl();

  if (!url) {
    return;
  }

  const web = session.fromPartition(WEB_PARTITION);
  const cookies = await web.cookies.get({ url });

  await Promise.all(cookies.map((cookie) => web.cookies.remove(cookieUrl(cookie), cookie.name)));
  await web.clearStorageData({ origin: new URL(url).origin });
  reload();
};
