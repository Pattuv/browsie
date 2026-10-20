import { app } from 'electron';
import { getAccountId, onSessionChange } from '../auth/session';
import { openRouterFetch, readManagementAccess } from './aiKey';

// What the profile menu's usage card shows, read with the account's management key: the credit balance
// (/credits) and the Browsie key's cap and spend (/keys/<hash>). What can actually be spent is the smaller
// of what's left under the cap and what's left of the credits.
// Opening the menu over and over shouldn't hit OpenRouter every time.
const CACHE_MS = 60_000;

type KeyInfo = {
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
};

let cached: { accountId: string; usage: AiUsage; at: number } | null = null;
let inFlight: { accountId: string; promise: Promise<AiUsage> } | null = null;

// A new key, or a different account (or none): the next read starts fresh.
export const clearAiUsageCache = () => {
  cached = null;
  inFlight = null;
};

onSessionChange(() => {
  if (cached && cached.accountId !== getAccountId()) {
    clearAiUsageCache();
  }
});

const asResets = (value: string | null): AiResets | null =>
  value === 'daily' || value === 'weekly' || value === 'monthly' ? value : null;

// OpenRouter leaves some figures out or null (a fresh key, an account with no credits yet). Count those as 0,
// so the card shows $0.00 instead of NaN.
const money = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const fetchUsage = async (accountId: string): Promise<AiUsage> => {
  const access = readManagementAccess(accountId);

  if (!access) {
    return { state: 'no-key' };
  }

  let creditsResponse: Response;
  let keyResponse: Response;
  try {
    [creditsResponse, keyResponse] = await Promise.all([
      openRouterFetch('/credits', access.managementKey),
      openRouterFetch(`/keys/${access.aiKeyHash}`, access.managementKey),
    ]);
  } catch {
    return { state: 'offline' };
  }

  // Revoked management key, or the Browsie key was deleted on OpenRouter.
  if ([creditsResponse, keyResponse].some((response) => [401, 403, 404].includes(response.status))) {
    return { state: 'invalid-key' };
  }

  if (!creditsResponse.ok || !keyResponse.ok) {
    return { state: 'offline' };
  }

  const creditsBody = (await creditsResponse.json()) as { data?: { total_credits: number; total_usage: number } };
  const keyBody = (await keyResponse.json()) as { data?: KeyInfo };
  // TEMP: diagnosing $0 available. Neither response holds a usable key (the label is masked). Dev builds only.
  if (!app.isPackaged) {
    console.log('[ai-usage] /credits', JSON.stringify(creditsBody));
    console.log('[ai-usage] /keys/<hash>', JSON.stringify(keyBody));
  }
  const credits = creditsBody.data;
  const info = keyBody.data;

  if (!credits || !info) {
    return { state: 'offline' };
  }

  const resets = asResets(info.limit_reset);
  // The spend that counts against the cap: this period's if the cap resets, otherwise all of it.
  const usedThisPeriod = money(
    resets === 'daily'
      ? info.usage_daily
      : resets === 'weekly'
        ? info.usage_weekly
        : resets === 'monthly'
          ? info.usage_monthly
          : info.usage,
  );
  const totalCredits = money(credits.total_credits);
  const balance = Math.max(0, totalCredits - money(credits.total_usage));
  // No number means no cap.
  const limit = typeof info.limit === 'number' && Number.isFinite(info.limit) ? info.limit : null;
  const capRemaining = limit === null ? null : Math.max(0, money(info.limit_remaining));

  return {
    state: 'ok',
    available: capRemaining === null ? balance : Math.min(capRemaining, balance),
    balance,
    totalCredits,
    limit,
    capRemaining,
    usedThisPeriod,
    resets,
  };
};

export const getAiUsage = async (): Promise<AiUsage> => {
  const accountId = getAccountId();

  if (!accountId) {
    return { state: 'no-key' };
  }

  if (cached?.accountId === accountId && Date.now() - cached.at < CACHE_MS) {
    return cached.usage;
  }

  // Both windows can open the menu at once; share one request.
  if (inFlight?.accountId === accountId) {
    return inFlight.promise;
  }

  const promise: Promise<AiUsage> = fetchUsage(accountId)
    .catch((): AiUsage => ({ state: 'offline' }))
    .then((usage) => {
      // Only if nothing cleared the cache meanwhile. Failures aren't kept, so the next open retries.
      if (inFlight?.promise === promise) {
        inFlight = null;

        if (usage.state === 'ok') {
          cached = { accountId, usage, at: Date.now() };
        }
      }

      return usage;
    });
  inFlight = { accountId, promise };

  return promise;
};
