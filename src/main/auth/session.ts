import { BrowserWindow, shell } from 'electron';
import {
  buildAuthUrl,
  decodeIdToken,
  DRIVE_APPDATA_SCOPE,
  exchangeCode,
  WORKSPACE_SCOPES,
  type WorkspaceService,
  fetchPictureDataUrl,
  GoogleOAuthError,
  refreshAccessToken,
  revokeToken,
  type TokenResponse,
} from './googleOAuth';
import { SignInAborted, startLoopback } from './loopback';
import { createPkcePair, createState } from './pkce';
import { clearVault, readVault, writeVault, type VaultContents } from './vault';
import { clearSetupComplete, isSetupComplete, markSetupComplete } from '../data/setupRecord';
import { hasAiKey } from '../data/aiKey';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
// Refresh a little early so a token can't expire mid-request.
const ACCESS_TOKEN_MARGIN_MS = 60_000;

// The one real session. `vault` is what's on disk; the access token only ever lives here, in memory.
type LiveSession = {
  vault: VaultContents;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  // False when this sign-in won't survive a restart: setup isn't finished yet, or Windows DPAPI
  // could not save the vault.
  persisted: boolean;
};

let current: LiveSession | null = null;
let inFlightSignIn: Promise<AuthSession> | null = null;
let cancelPendingSignIn: (() => void) | null = null;
let inFlightRefresh: Promise<string> | null = null;
// Why the last session ended, when it wasn't the user's choice. Lets Auth say "please sign in again".
let signedOutReason: AuthSession['signedOutReason'];
// Main-process listeners (the sync engine). Windows hear about changes over IPC instead.
const sessionListeners = new Set<() => void>();

const hasDriveAccess = (live: LiveSession) => live.vault.scopes.includes(DRIVE_APPDATA_SCOPE);

// The only shape that ever crosses into the renderer: no tokens, no sub, no raw ID token.
const toAuthSession = (live: LiveSession | null): AuthSession =>
  live
    ? {
        status: 'SIGNED_IN',
        firstName: live.vault.firstName,
        email: live.vault.email,
        pictureDataUrl: live.vault.pictureDataUrl,
        syncEnabled: hasDriveAccess(live),
        googleServices: {
          gmail: live.vault.scopes.includes(WORKSPACE_SCOPES.gmail),
          calendar: live.vault.scopes.includes(WORKSPACE_SCOPES.calendar),
          drive: live.vault.scopes.includes(WORKSPACE_SCOPES.drive),
        },
        rememberedOnDevice: live.persisted,
        // Looked up here so the account ID stays in main; the renderer only learns the answer.
        setupComplete: isSetupComplete(live.vault.sub),
      }
    : { status: 'SIGNED_OUT', ...(signedOutReason && { signedOutReason }) };

// Main is the single source of truth: every change is pushed to every window.
const setSession = (next: LiveSession | null) => {
  current = next;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:session-changed', toAuthSession(current));
  }
  sessionListeners.forEach((listener) => listener());
};

export const onSessionChange = (listener: () => void) => {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
};

// Main-side check for the sync engine: signed in AND allowed to touch Drive.
export const canSync = () => current !== null && hasDriveAccess(current);

const rememberAccessToken = (live: LiveSession, tokens: TokenResponse) => {
  live.accessToken = tokens.access_token;
  live.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
};

// Cold start: decrypt the vault and report SIGNED_IN with no network call, so the app boots offline.
export const loadSession = () => {
  const vault = readVault();
  current = vault ? { vault, persisted: true } : null;
};

export const getSession = () => toAuthSession(current);

const runSignIn = async (onBrowserReturned?: () => void): Promise<AuthSession> => {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const loopback = await startLoopback(state, SIGN_IN_TIMEOUT_MS, onBrowserReturned);
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
      persisted: false,
    };
    rememberAccessToken(live, tokens);

    // 5. Lock the refresh token in the vault. If DPAPI cannot encrypt it we skip writing,
    //    so the session lasts for this run only.
    //    An account that hasn't finished setup here isn't saved until it does (completeSetup), so an
    //    abandoned setup doesn't leave someone signed in on this device. Clear any older vault too,
    //    so a restart can't bring back a different account.
    if (isSetupComplete(live.vault.sub)) {
      live.persisted = writeVault(live.vault);
    } else {
      clearVault();
    }

    signedOutReason = undefined;
    setSession(live);
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
// Signed in but without Drive (unticked on the consent screen)? Signing in again is the retry:
// Google re-asks for the missing permission and the new session replaces the old one.
// `onBrowserReturned` runs once the user finishes on Google's page, so the app can come back to the front.
export const signIn = (onBrowserReturned?: () => void) => {
  if (current && hasDriveAccess(current)) {
    return Promise.resolve(getSession());
  }

  inFlightSignIn ??= runSignIn(onBrowserReturned).finally(() => {
    inFlightSignIn = null;
    cancelPendingSignIn = null;
  });

  return inFlightSignIn;
};

// --- Gmail, Calendar and Drive for the INFO lane ---

export const hasWorkspaceAccess = (service: WorkspaceService) =>
  current !== null && current.vault.scopes.includes(WORKSPACE_SCOPES[service]);

export const workspaceAccess = () =>
  Object.fromEntries((Object.keys(WORKSPACE_SCOPES) as WorkspaceService[]).map((service) => [service, hasWorkspaceAccess(service)])) as Record<
    WorkspaceService,
    boolean
  >;

let inFlightConnect: Promise<Record<WorkspaceService, boolean>> | null = null;

// Opens Google's permission page (in the user's browser, like sign-in) asking for mail, calendar and
// Drive access for the signed-in account. The new refresh token covers everything granted so far, so it
// replaces the old one. A different account choosing to sign in on that page is refused.
const runConnectWorkspace = async (onBrowserReturned?: () => void) => {
  const live = current;
  if (!live) throw new Error('Not signed in.');

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const loopback = await startLoopback(state, SIGN_IN_TIMEOUT_MS, onBrowserReturned);

  try {
    await shell.openExternal(
      buildAuthUrl({
        redirectUri: loopback.redirectUri,
        codeChallenge: challenge,
        state,
        extraScopes: Object.values(WORKSPACE_SCOPES),
        loginHint: live.vault.email,
      }),
    );
    const code = await loopback.code;
    const tokens = await exchangeCode({ code, codeVerifier: verifier, redirectUri: loopback.redirectUri });

    if (tokens.id_token && decodeIdToken(tokens.id_token).sub !== live.vault.sub) {
      // Someone picked another Google account. Don't mix it into this one.
      await revokeToken(tokens.refresh_token ?? tokens.access_token).catch(() => undefined);
      throw new Error('That was a different Google account.');
    }
    if (current !== live) throw new Error('The account changed while asking for permission.');

    live.vault = {
      ...live.vault,
      refreshToken: tokens.refresh_token ?? live.vault.refreshToken,
      scopes: tokens.scope.split(' '),
    };
    rememberAccessToken(live, tokens);
    if (live.persisted) live.persisted = writeVault(live.vault);
    setSession(live);
    return workspaceAccess();
  } catch (error) {
    if (error instanceof SignInAborted) return workspaceAccess();
    throw error;
  } finally {
    loopback.cancel();
  }
};

export const connectWorkspace = (onBrowserReturned?: () => void) => {
  inFlightConnect ??= runConnectWorkspace(onBrowserReturned).finally(() => {
    inFlightConnect = null;
  });
  return inFlightConnect;
};

export const isConnectingWorkspace = () => inFlightConnect !== null;

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
      signedOutReason = 'expired';
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

// Drive said 401 (e.g. access was revoked): forget the cached token so the next call refreshes,
// which either gets a fresh one or hits invalid_grant and signs out.
export const invalidateAccessToken = () => {
  if (current) {
    current.accessToken = undefined;
  }
};

// The last setup step calls this. Only now is the sign-in saved to the vault (see runSignIn).
// Pushing the session again is what moves every window on to the Dashboard.
// Main checks the steps' results itself; a click alone doesn't count as finishing.
export const completeSetup = () => {
  if (!current || !hasAiKey(current.vault.sub)) {
    return;
  }

  markSetupComplete(current.vault.sub);
  current.persisted = writeVault(current.vault);
  setSession(current);
};

// Main only: which account's web storage the tabs should use. Never sent to the renderer.
export const getAccountId = () => current?.vault.sub ?? null;

// Local wipe first, so signing out works offline and the next person on a shared device sees nothing.
// Then best-effort revoke, so the token is also dead on Google's side.
// The account's setup record is kept, so signing back in skips setup; `resetSetup` (factory reset) clears it.
export const signOut = async ({ resetSetup = false } = {}) => {
  const live = current;

  if (live && resetSetup) {
    clearSetupComplete(live.vault.sub);
  }

  clearVault();
  signedOutReason = undefined;
  setSession(null);

  if (live) {
    await revokeToken(live.vault.refreshToken).catch(() => undefined);
  }
};
