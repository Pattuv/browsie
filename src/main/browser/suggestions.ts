import { session } from 'electron';
import { isSafeSearchOn, isWebUrl, webSession } from './webSession';

// The same request Chrome's own address bar makes, so we get site titles and entity details too.
const ENDPOINT = 'https://suggestqueries.google.com/complete/search?client=chrome-omni&gs_ri=chrome-ext-ansg&q=';
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 6;
const TIMEOUT_MS = 3000;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_CACHED_IMAGES = 200;

// No "persist:" prefix, so this partition lives in memory only and starts empty every run. It never
// sees the websites' cookies, so Google can't tie what's typed in the bar to the user's account.
const SUGGEST_PARTITION = 'suggestions';

let userAgentSet = false;

// Google only sends entity details (descriptions, thumbnails) to what looks like Chrome. Borrow the
// websites' user agent, which configureWebSession already cleaned of "Electron". Just the string: no cookies.
const suggestSession = () => {
  const suggest = session.fromPartition(SUGGEST_PARTITION);

  if (!userAgentSet) {
    userAgentSet = true;
    suggest.setUserAgent(webSession().getUserAgent());
  }

  return suggest;
};

// ---------- Images ----------

// Only images Google serves. Asking the suggested site itself for its favicon would tell it what the
// user was typing, and the renderer must not be able to use this as a way to fetch any URL it likes.
const isGoogleImage = (rawUrl: string) => {
  try {
    const { protocol, hostname, pathname } = new URL(rawUrl);
    return (
      protocol === 'https:' &&
      (hostname.endsWith('.gstatic.com') || (hostname === 'www.google.com' && pathname === '/s2/favicons'))
    );
  } catch {
    return false;
  }
};

const faviconFor = (url: string) =>
  `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(new URL(url).hostname)}`;

// Image URL → data: URL (the chrome's CSP only allows data: images), or null. Failures are kept too.
const images = new Map<string, Promise<string | null>>();

const download = async (url: string) => {
  try {
    const response = await suggestSession().fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

    if (!response.ok || !type.startsWith('image/')) {
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
};

export const getSuggestionImage = (url: unknown): Promise<string | null> => {
  if (typeof url !== 'string' || !isGoogleImage(url)) {
    return Promise.resolve(null);
  }

  let pending = images.get(url);

  if (!pending) {
    if (images.size >= MAX_CACHED_IMAGES) {
      images.delete(images.keys().next().value!);
    }

    pending = download(url);
    images.set(url, pending);
  }

  return pending;
};

// ---------- Entity details ----------

// Entity details ("Denver Broncos", "Football team", a thumbnail) arrive as base64 protobuf: a run of
// fields, each a numbered tag followed by its value. We only want three text fields and skip the rest.
const ENTITY_DESCRIPTION = 2;
const ENTITY_IMAGE = 6;
const ENTITY_NAME = 7;

const readVarint = (bytes: Buffer, start: number): [value: number, next: number] => {
  let value = 0;
  let scale = 1;
  let pos = start;

  while (pos < bytes.length) {
    const byte = bytes[pos++];
    value += (byte & 0x7f) * scale;
    scale *= 128;

    if (byte < 0x80) {
      return [value, pos];
    }
  }

  return [value, Infinity];
};

const readTextFields = (base64: string) => {
  const bytes = Buffer.from(base64, 'base64');
  const fields = new Map<number, string>();
  let pos = 0;

  while (pos < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, pos);
    const field = Math.floor(tag / 8);
    const wireType = tag % 8;

    if (wireType === 0) {
      pos = readVarint(bytes, afterTag)[1];
    } else if (wireType === 2) {
      const [length, start] = readVarint(bytes, afterTag);
      pos = start + length;

      if (pos > bytes.length) break;

      fields.set(field, bytes.toString('utf8', start, pos));
    } else if (wireType === 1 || wireType === 5) {
      pos = afterTag + (wireType === 1 ? 8 : 4);
    } else {
      break;
    }
  }

  return fields;
};

// ---------- Suggestions ----------

type Extras = {
  'google:suggesttype'?: unknown;
  'google:suggestdetail'?: unknown;
};

const at = (list: unknown, i: number) => (Array.isArray(list) ? list[i] : undefined);
const nonEmpty = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

// Google's reply: [query, texts, descriptions, unused, { "google:suggesttype", "google:suggestdetail", ... }].
// It's an unofficial endpoint, so every part of it is checked rather than trusted.
const parse = (body: unknown): Suggestion[] => {
  if (!Array.isArray(body) || !Array.isArray(body[1])) {
    return [];
  }

  const texts: unknown[] = body[1];
  const extras = (body[4] ?? {}) as Extras;
  const suggestions: Suggestion[] = [];

  texts.forEach((text, i) => {
    if (typeof text !== 'string' || !text.trim()) {
      return;
    }

    const type = at(extras['google:suggesttype'], i);

    if (type === 'NAVIGATION') {
      // A site to open directly. Only real web addresses get through.
      if (isWebUrl(text)) {
        suggestions.push({ text, kind: 'url', title: nonEmpty(at(body[2], i)), image: faviconFor(text) });
      }

      return;
    }

    const entityInfo = (at(extras['google:suggestdetail'], i) as { 'google:entityinfo'?: unknown } | undefined)?.[
      'google:entityinfo'
    ];
    const fields = typeof entityInfo === 'string' ? readTextFields(entityInfo) : null;
    const image = fields?.get(ENTITY_IMAGE);
    const suggestion: Suggestion = {
      text,
      kind: 'query',
      title: fields ? nonEmpty(fields.get(ENTITY_NAME)) : undefined,
      description: fields ? nonEmpty(fields.get(ENTITY_DESCRIPTION)) : undefined,
      image: image && isGoogleImage(image) ? image : undefined,
    };

    // Google often lists "denver broncos" twice: once plain, once with entity details. Keep one row,
    // in the first one's place, with the details.
    const twin = suggestions.findIndex((other) => other.kind === 'query' && other.text === text);

    if (twin === -1) {
      suggestions.push(suggestion);
    } else if (fields) {
      suggestions[twin] = suggestion;
    }
  });

  const shown = suggestions.slice(0, MAX_RESULTS);

  // Start downloading the images now, while the reply travels to the chrome. By the time the list
  // asks for them, most are already here.
  shown.forEach(({ image }) => image && void getSuggestionImage(image));

  return shown;
};

// Called when the address bar is focused: opens the connection to Google before the first keystroke,
// so that request skips DNS and the TLS handshake (about half its time on a cold start).
export const warmSuggestions = () => {
  suggestSession().preconnect({ url: ENDPOINT, numSockets: 1 });
};

// What the user has typed so far → search suggestions. Always resolves: [] on bad input, timeouts,
// no internet or a reply we don't understand, so the address bar never shows an error for this.
export const getSuggestions = async (input: unknown): Promise<Suggestion[]> => {
  if (typeof input !== 'string') {
    return [];
  }

  const query = input.trim().slice(0, MAX_QUERY_LENGTH);

  if (!query) {
    return [];
  }

  try {
    const safe = isSafeSearchOn() ? '&safe=active' : '';
    const response = await suggestSession().fetch(ENDPOINT + encodeURIComponent(query) + safe, {
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    return response.ok ? parse(await response.json()) : [];
  } catch {
    return [];
  }
};
