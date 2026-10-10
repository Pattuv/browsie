import { session } from 'electron';
import { WEB_PARTITION, isWebUrl } from './webSession';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;
const MAX_CACHED = 200;

// Favicon URL → data: URL, or null if it couldn't be used. Shared by every tab, so ten tabs of one
// site download the icon once. Failures are cached too, so a broken icon isn't retried on every page.
const cache = new Map<string, Promise<string | null>>();

const imageTypeFor = (url: string, header: string) => {
  const type = header.split(';')[0].trim().toLowerCase();

  if (type.startsWith('image/')) {
    return type;
  }

  // Plenty of servers send favicon.ico as application/octet-stream.
  return new URL(url).pathname.toLowerCase().endsWith('.ico') ? 'image/x-icon' : null;
};

const download = async (url: string) => {
  try {
    // Through the websites' partition, never Browsie's own session.
    const response = await session
      .fromPartition(WEB_PARTITION)
      .fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
      return null;
    }

    const type = imageTypeFor(url, response.headers.get('content-type') ?? '');
    const bytes = Buffer.from(await response.arrayBuffer());

    if (!type || bytes.length === 0 || bytes.length > MAX_BYTES) {
      return null;
    }

    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
};

const fetchFavicon = (url: string): Promise<string | null> => {
  // Some pages inline their icon as a data: URL already.
  if (url.startsWith('data:image/')) {
    return Promise.resolve(url.length <= MAX_BYTES * 2 ? url : null);
  }

  if (!isWebUrl(url)) {
    return Promise.resolve(null);
  }

  let pending = cache.get(url);

  if (!pending) {
    if (cache.size >= MAX_CACHED) {
      cache.delete(cache.keys().next().value!);
    }

    pending = download(url);
    cache.set(url, pending);
  }

  return pending;
};

// The chrome's CSP only allows data: images, and it should never talk to websites itself,
// so main downloads the icon and hands over a data: URL. Candidates come best-first; first one that works wins.
export const resolveFavicon = async (candidates: string[]) => {
  for (const url of candidates) {
    const dataUrl = await fetchFavicon(url);

    if (dataUrl) {
      return dataUrl;
    }
  }

  return null;
};
