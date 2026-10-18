import { session, type Cookie, type Session } from 'electron';

// Whether this account's web storage is logged in to Google, so a fresh account's first tab can open
// Google's sign-in page instead of the New Tab page. Google sets these cookies only after a successful
// sign-in, and removes them on sign-out.
const LOGIN_COOKIES = new Set(['SID', '__Secure-1PSID']);

const isLoginCookie = (cookie: Cookie) =>
  LOGIN_COOKIES.has(cookie.name) &&
  cookie.domain === '.google.com' &&
  (cookie.expirationDate === undefined || cookie.expirationDate * 1000 > Date.now());

export const hasGoogleLogin = async (web: Session) =>
  (await web.cookies.get({ domain: 'google.com' })).some(isLoginCookie);

// The last answer for each partition, kept up to date by its cookie watcher. Missing = not checked yet.
const known = new Map<string, boolean>();
// Bumped per check, so a slow check can't overwrite a newer answer.
const checks = new Map<string, number>();
let currentPartition: string | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

const check = async (partition: string) => {
  const generation = (checks.get(partition) ?? 0) + 1;
  checks.set(partition, generation);

  let signedIn: boolean;

  try {
    signedIn = await hasGoogleLogin(session.fromPartition(partition));
  } catch {
    return;
  }

  if (checks.get(partition) !== generation) {
    return;
  }

  const changed = known.get(partition) !== signedIn;
  known.set(partition, signedIn);

  if (changed && partition === currentPartition) {
    listeners.forEach((listener) => listener(signedIn));
  }
};

// Runs once per partition (from configurePartition): any change to a login cookie means a fresh check.
export const watchGoogleLogin = (partition: string, web: Session) => {
  web.cookies.on('changed', (_event, cookie) => {
    if (LOGIN_COOKIES.has(cookie.name) && cookie.domain?.endsWith('google.com')) {
      void check(partition);
    }
  });
};

// Websites now use this partition. Answers from the last check right away, and checks again.
export const setGoogleLoginPartition = (partition: string) => {
  currentPartition = partition;
  void check(partition);
};

// Its storage was wiped ("Remove my data"): don't trust the last answer, check again when it's next used.
export const forgetGoogleLogin = (partition: string) => {
  known.delete(partition);
  checks.set(partition, (checks.get(partition) ?? 0) + 1);
};

// For the current partition: true, false, or null while the first check hasn't finished.
export const getGoogleLogin = () => (currentPartition === null ? null : (known.get(currentPartition) ?? null));

// Hears when the current partition's answer arrives or changes.
export const onGoogleLoginChange = (listener: (signedIn: boolean) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Google's sign-in page with the Browsie account's email already filled in, so it's one password or
// passkey step. `continue` only matters to Google: the tab turns into New Tab once it gets there.
export const googleSignInUrl = (email: string) =>
  `https://accounts.google.com/ServiceLogin?${new URLSearchParams({
    hl: 'en',
    Email: email,
    continue: 'https://www.google.com/',
  })}`;

// Pages that are still part of signing in. After the password, Google also passes through
// accounts.youtube.com to log YouTube in; the tab has to wait until that's done too.
export const isGoogleAccountsUrl = (url: string) => {
  try {
    const { hostname } = new URL(url);
    return hostname === 'accounts.google.com' || hostname === 'accounts.youtube.com';
  } catch {
    return false;
  }
};
