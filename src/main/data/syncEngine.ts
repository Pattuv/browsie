import { app, BrowserWindow, powerMonitor } from 'electron';
import { canSync, getSession, onSessionChange } from '../auth/session';
import { syncCollection, watchCollections, type CollectionKind } from './collectionSync';
import { SETTINGS_FILE, createFile, downloadFile, findFile, updateFile } from './driveClient';
import { applyRemote, getSyncSnapshot, markSynced, onLocalChange, resetForSignOut } from './localStore';

// Local disk is the source of truth; Drive is the backup. Nothing here ever blocks the UI.
// How long after a change the upload waits, so a burst of changes goes up once.
const PUSH_DELAY_MS = { settings: 2_000, bookmarks: 2_000, history: 60_000 };
// Another device's changes show up without restarting: check Drive this often, and when the window
// comes back to the front (at most once a minute).
const POLL_MS = 5 * 60_000;
const FOCUS_SYNC_MIN_GAP_MS = 60_000;
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

let status: SyncStatus = { state: 'disabled', lastSyncedAt: null };
let inFlight: Promise<void> | null = null;
let runAgainAfter = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
// When the pending push will run, so a quick change (a bookmark) can pull a slow one (history) forward.
let pushAt = Infinity;
let lastSyncStarted = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_FIRST_MS;
// Bumped on sign-out. A sync that started under an older generation throws its result away,
// so a slow upload can never write one account's data after someone else signs in.
let generation = 0;

const setStatus = (state: SyncStatus['state']) => {
  status = { state, lastSyncedAt: getSyncSnapshot().lastSyncedAt };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('sync:status-changed', status);
  }
};

export const getSyncStatus = () => status;

// One pass: look at Drive, then download, upload, or do nothing.
const syncSettings = async (gen: number) => {
  const remote = await findFile(SETTINGS_FILE);
  const { doc, dirty, lastSyncedAt } = getSyncSnapshot();

  if (gen !== generation) {
    return;
  }

  if (remote) {
    // Drive wins if this device has never synced with this account (a new laptop shouldn't
    // overwrite your real cloud data with its fresh defaults), or if Drive's copy is newer.
    const remoteWins = !lastSyncedAt || (remote.updatedAt ?? '') > doc.updatedAt;

    if (remoteWins) {
      const remoteDoc = await downloadFile(remote.id);
      if (gen !== generation || applyRemote(remoteDoc)) {
        return;
      }
      // Drive's copy was unreadable: fall through and replace it with ours.
    } else if (!dirty && remote.updatedAt === doc.updatedAt) {
      markSynced(doc.updatedAt); // Already identical.
      return;
    }

    await updateFile(remote.id, doc, { updatedAt: doc.updatedAt });
  } else {
    // First backup ever, or the user deleted Browsie's hidden data in Drive settings.
    await createFile(SETTINGS_FILE, doc, { updatedAt: doc.updatedAt });
  }

  if (gen === generation) {
    markSynced(doc.updatedAt);
  }
};

// One pass over everything: settings (newest copy wins), then bookmarks and history (merged).
const syncOnce = async (gen: number) => {
  const stillCurrent = () => gen === generation;

  await syncSettings(gen);
  await syncCollection('bookmarks', stillCurrent);
  await syncCollection('history', stillCurrent);
};

// fetch throws TypeError when there's no network; AbortSignal.timeout throws TimeoutError.
const looksOffline = (error: unknown) =>
  error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');

const scheduleRetry = () => {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(runSync, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS); // 5s, 10s, 20s ... up to 5 min
};

// Only one sync at a time. A request that arrives mid-sync runs once more right after.
const runSync = () => {
  if (!canSync()) {
    return;
  }
  if (inFlight) {
    runAgainAfter = true;
    return;
  }

  const gen = generation;
  lastSyncStarted = Date.now();
  clearTimeout(retryTimer);
  setStatus('syncing');

  inFlight = syncOnce(gen)
    .then(
      () => {
        retryDelay = RETRY_FIRST_MS;
        if (gen === generation) {
          setStatus('idle');
        }
      },
      (error: unknown) => {
        // Signed out mid-sync (including Google revoking access): nothing to retry.
        if (gen !== generation || !canSync()) {
          return;
        }
        console.warn(`[sync] failed, retrying in ${retryDelay / 1000}s:`, error);
        setStatus(looksOffline(error) ? 'offline' : 'error');
        scheduleRetry();
      },
    )
    .finally(() => {
      inFlight = null;
      if (runAgainAfter) {
        runAgainAfter = false;
        runSync();
      }
    });
};

// Upload a little after a change, so a burst of changes goes up once. The timer only ever moves
// earlier: steady browsing can't keep pushing history's upload back forever.
const schedulePush = (kind: CollectionKind | 'settings') => {
  const at = Date.now() + PUSH_DELAY_MS[kind];

  if (at >= pushAt) {
    return;
  }

  clearTimeout(pushTimer);
  pushAt = at;
  pushTimer = setTimeout(() => {
    pushAt = Infinity;
    runSync();
  }, at - Date.now());
};

const handleSessionChange = () => {
  if (canSync()) {
    runSync(); // Just signed in (or granted Drive on a retry): pull first.
    return;
  }

  generation += 1;
  clearTimeout(pushTimer);
  pushAt = Infinity;
  clearTimeout(retryTimer);
  setStatus('disabled');

  if (getSession().status === 'SIGNED_OUT') {
    resetForSignOut();
  }
};

// Before "Remove my data from this device": give changes Drive hasn't seen yet one quick chance to go
// up, so a bookmark made a minute ago isn't lost with the local copy. Never waits longer than the timeout.
export const uploadBeforeRemoving = async (timeoutMs = 8_000) => {
  if (!canSync()) {
    return;
  }

  clearTimeout(pushTimer);
  pushAt = Infinity;

  const attempt = (async () => {
    await inFlight;
    runSync();
    await inFlight;
  })();

  await Promise.race([attempt, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
};

// Called once at startup, after the local store and session are loaded.
export const startSync = () => {
  onSessionChange(handleSessionChange);
  onLocalChange(() => schedulePush('settings'));
  watchCollections(schedulePush);
  // Laptop woke up: the network may be back, so don't wait out a long retry delay.
  powerMonitor.on('resume', () => {
    retryDelay = RETRY_FIRST_MS;
    runSync();
  });
  // Pick up what other devices changed while this one sat open.
  setInterval(runSync, POLL_MS);
  app.on('browser-window-focus', () => {
    if (Date.now() - lastSyncStarted >= FOCUS_SYNC_MIN_GAP_MS) {
      runSync();
    }
  });

  // Boot never waits on this: the app already showed local data. Offline just means 'offline' + retry.
  runSync();
};
