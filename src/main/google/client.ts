import type { GoogleService } from '../../shared/google/tools';

// Calls Google's REST APIs with the signed-in account's token. Like driveClient's fetch: a 401 drops the
// cached token and tries once more. Other failures become GoogleApiError, which says which kind of
// trouble it was so the lane can tell the user something useful.

export type GoogleDeps = {
  getToken: () => Promise<string>;
  invalidateToken: () => void;
  fetchImpl?: typeof fetch;
  // The user's time zone for calendar times. Defaults to this computer's.
  timeZone?: () => string;
};

export type GoogleFailure = 'needs_access' | 'api_disabled' | 'not_found' | 'failed';

export class GoogleApiError extends Error {
  constructor(
    readonly kind: GoogleFailure,
    readonly service: GoogleService,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;

const describe = (service: GoogleService) => ({ gmail: 'Gmail', calendar: 'Google Calendar', drive: 'Google Drive' })[service];

export const createGoogleClient = (deps: GoogleDeps) => {
  const fetchImpl = deps.fetchImpl ?? fetch;

  const request = async (service: GoogleService, url: string, init: RequestInit = {}, retried = false): Promise<Response> => {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await deps.getToken()}` },
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new GoogleApiError('failed', service, `Couldn't reach ${describe(service)}: ${error instanceof Error ? error.message : String(error)}`);
    });

    if (response.status === 401 && !retried) {
      deps.invalidateToken();
      return request(service, url, init, true);
    }
    if (response.ok) return response;

    const body = (await response.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? '';
    const detail = body?.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 403 && /insufficient|scope|PERMISSION_DENIED/i.test(`${reason} ${detail}`) && !/has not been used|disabled/i.test(detail)) {
      throw new GoogleApiError('needs_access', service, `Browsie doesn't have permission to use ${describe(service)} yet.`);
    }
    if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(`${reason} ${detail}`)) {
      throw new GoogleApiError('api_disabled', service, `The ${describe(service)} API isn't turned on for Browsie's Google Cloud project. ${detail}`);
    }
    if (response.status === 404 || response.status === 410) {
      throw new GoogleApiError('not_found', service, `That item isn't in ${describe(service)} any more.`);
    }
    throw new GoogleApiError('failed', service, `${describe(service)} said: ${detail}`);
  };

  const json = async <T>(service: GoogleService, url: string, init: RequestInit = {}) =>
    (await (await request(service, url, init)).json()) as T;

  const send = (service: GoogleService, url: string, method: string, body?: unknown) =>
    json<unknown>(service, url, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });

  return {
    request,
    json,
    send,
    timeZone: () => deps.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};

export type GoogleClient = ReturnType<typeof createGoogleClient>;

// Untrusted text from mail and files is cut to a size a model can read in one go.
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
