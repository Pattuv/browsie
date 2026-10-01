import { app, BrowserWindow, shell } from 'electron';
import {
  buildAuthUrl,
  decodeIdToken,
  DRIVE_APPDATA_SCOPE,
  exchangeCode,
  fetchPictureDataUrl,
  GoogleOAuthError,
  refreshAccessToken,
  revokeToken,
  type TokenResponse,
} from './googleOAuth';
import { SignInAborted, startLoopback } from './loopback';
import { createPkcePair, createState } from './pkce';
import { clearVault, readVault, writeVault, type VaultContents } from './vault';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
// Refresh a little early so a token can't expire mid-request.
const ACCESS_TOKEN_MARGIN_MS = 60_000;

// The one real session. `vault` is what's on disk; the access token only ever lives here, in memory.
type LiveSession = {
  vault: VaultContents;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

let current: LiveSession | null = null;
let inFlightSignIn: Promise<AuthSession> | null = null;
let cancelPendingSignIn: (() => void) | null = null;
let inFlightRefresh: Promise<string> | null = null;

// The only shape that ever crosses into the renderer: no tokens, no sub, no raw ID token.
const toAuthSession = (live: LiveSession | null): AuthSession =>
  live
    ? {
        status: 'SIGNED_IN',
        firstName: live.vault.firstName,
        email: live.vault.email,
        pictureDataUrl: live.vault.pictureDataUrl,
        syncEnabled: live.vault.scopes.includes(DRIVE_APPDATA_SCOPE),
      }
    : { status: 'SIGNED_OUT' };

// Main is the single source of truth: every change is pushed to every window.
const setSession = (next: LiveSession | null) => {
  current = next;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:session-changed', toAuthSession(current));
  }
};

const rememberAccessToken = (live: LiveSession, tokens: TokenResponse) => {
  live.accessToken = tokens.access_token;
  live.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
};

// Cold start: decrypt the vault and report SIGNED_IN with no network call, so the app boots offline.
export const loadSession = () => {
  const vault = readVault();
  current = vault ? { vault } : null;
};

export const getSession = () => toAuthSession(current);

// After the browser tab says "You're signed in", pull Browsie back in front of it.
const bringAppToFront = () => {
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }

  const [window] = BrowserWindow.getAllWindows();
  window?.show();
  window?.focus();
};

const runSignIn = async (): Promise<AuthSession> => {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const loopback = await startLoopback(state, SIGN_IN_TIMEOUT_MS);
  cancelPendingSignIn = loopback.cancel;

  try {
    // 1. Send the user to Google in their own browser (saved passwords and 2FA work there).
    await shell.openExternal(buildAuthUrl({ redirectUri: loopback.redirectUri, codeChallenge: challenge, state }));

    // 2. Wait for Google to redirect the browser back to our loopback server with a one-time code.
    const code = await loopback.code;

    // 3. Trade the code (plus the secret verifier) for tokens. This happens server-to-server, not in the browser.
    const tokens = await exchangeCode({ code, codeVerifier: verifier, redirectUri: loopback.redirectUri });

    if (!tokens.refresh_token || !tokens.id_token) {
      throw new Error('Google did not return a refresh token and ID token.');
    }

    // 4. Read who this is from the ID token, and grab their picture while we're online.
    const profile = decodeIdToken(tokens.id_token);
    const pictureDataUrl = profile.picture
      ? await fetchPictureDataUrl(profile.picture).catch(() => undefined)
      : undefined;

    const live: LiveSession = {
      vault: {
        refreshToken: tokens.refresh_token,
        sub: profile.sub,
        firstName: profile.given_name ?? profile.name ?? '',
        email: profile.email,
        pictureDataUrl,
        // The user may have unticked Drive on the consent screen; this is what they actually granted.
        scopes: tokens.scope.split(' '),
      },
    };
    rememberAccessToken(live, tokens);

    // 5. Lock the refresh token in the vault. If there's no real keyring (Linux basic_text) we skip
    //    writing, so the session lasts for this run only. Telling the user about that is slice 5.
    writeVault(live.vault);

    setSession(live);
    bringAppToFront();
    return getSession();
  } catch (error) {
    if (error instanceof SignInAborted) {
      return getSession();
    }
    throw error;
  } finally {
    loopback.cancel();
  }
};

// A second click while the browser is open shares the first attempt instead of starting another.
export const signIn = () => {
  if (current) {
    return Promise.resolve(getSession());
  }

  inFlightSignIn ??= runSignIn().finally(() => {
    inFlightSignIn = null;
    cancelPendingSignIn = null;
  });

  return inFlightSignIn;
};

export const cancelSignIn = () => {
  cancelPendingSignIn?.();
};

const refresh = async (live: LiveSession) => {
  try {
    const tokens = await refreshAccessToken(live.vault.refreshToken);
    rememberAccessToken(live, tokens);
    return tokens.access_token;
  } catch (error) {
    // The refresh token is dead (revoked, password changed, 6 months unused, or 7-day Testing expiry).
    // Only drop the session if it's still the one we were refreshing.
    if (error instanceof GoogleOAuthError && error.code === 'invalid_grant' && current === live) {
      clearVault();
      setSession(null);
    }
    throw error;
  }
};

// The one function the Drive client calls. Concurrent callers share one in-flight refresh.
export const getAccessToken = async () => {
  const live = current;

  if (!live) {
    throw new Error('Not signed in.');
  }

  if (live.accessToken && (live.accessTokenExpiresAt ?? 0) - Date.now() > ACCESS_TOKEN_MARGIN_MS) {
    return live.accessToken;
  }

  inFlightRefresh ??= refresh(live).finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
};

// Local wipe first, so signing out works offline and the next person on a shared device sees nothing.
// Then best-effort revoke, so the token is also dead on Google's side.
export const signOut = async () => {
  const live = current;
  clearVault();
  setSession(null);

  if (live) {
    await revokeToken(live.vault.refreshToken).catch(() => undefined);
  }
};
