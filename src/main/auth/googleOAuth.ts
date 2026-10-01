import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../config';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = ['openid', 'profile', 'email', DRIVE_APPDATA_SCOPE];

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
  id_token?: string;
};

export type IdTokenClaims = {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  picture?: string;
};

// Carries Google's error code (e.g. "invalid_grant") so session.ts can react to specific failures.
export class GoogleOAuthError extends Error {
  constructor(readonly code: string) {
    super(`Google OAuth error: ${code}`);
  }
}

const assertConfigured = () => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing. Copy .env.example to .env and fill them in.');
  }
};

export const buildAuthUrl = (params: { redirectUri: string; codeChallenge: string; state: string }) => {
  assertConfigured();
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent', // ...and make sure Google actually sends one
  }).toString();
  return url.toString();
};

const postToTokenEndpoint = async (body: Record<string, string>): Promise<TokenResponse> => {
  const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams(body) });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new GoogleOAuthError(json.error ?? `http_${response.status}`);
  }

  return json as TokenResponse;
};

export const exchangeCode = (params: { code: string; codeVerifier: string; redirectUri: string }) =>
  postToTokenEndpoint({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
  });

export const refreshAccessToken = (refreshToken: string) =>
  postToTokenEndpoint({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
  });

// Revoking the refresh token also kills every access token minted from it.
export const revokeToken = async (token: string) => {
  await fetch(REVOKE_ENDPOINT, { method: 'POST', body: new URLSearchParams({ token }) });
};

// A JWT is three base64url chunks: header.payload.signature. We only read the payload.
// Skipping signature checks is fine here because the token came straight from Google's
// token endpoint over HTTPS, not from the browser or any third party.
export const decodeIdToken = (idToken: string): IdTokenClaims => {
  const payload = idToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

// Main fetches the picture once and hands the UI a data: URL, so the renderer never talks to Google.
export const fetchPictureDataUrl = async (pictureUrl: string) => {
  const response = await fetch(pictureUrl);

  if (!response.ok) {
    throw new Error(`Picture download failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.startsWith('image/')) {
    throw new Error(`Picture is not an image: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString('base64')}`;
};
