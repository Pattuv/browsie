import {
  type Action,
  type ActionError,
  BASE_RISK,
  type ConfirmRequest,
  parseAction,
  type Risk,
} from '../../shared/web/actions';
import { isWebUrl } from '../../shared/web/url';
import type { Snapshot, SnapNode } from './snapshot';

// The gate every WEB action passes before it runs. All pure: no Electron, no CDP, no clock of its own.
//
// Main runs it with everything (the live snapshot, the session's own copy of what the user said, the grant
// from a spoken "yes") and its answer is final. The agent runs the same checks with less, only to replan
// early instead of waiting for main to refuse. A confused or prompt-injected agent gains nothing by
// skipping them.

export type PolicyContext = {
  // The tab's current snapshot. Main always passes it. Without it the snapshot checks are skipped.
  snapshot?: Snapshot;
  // What the user actually said this task, plus facts they confirmed (name, address), by id. Main keeps its
  // own copy. The agent's ids are only looked up in it, never trusted as text.
  sources: ReadonlyMap<string, string>;
  // Set by main after the user says yes to a confirmation. Matches one action on one snapshot.
  grant?: ConfirmGrant;
  // Only the mock-site harness turns this on, since its sites are served on 127.0.0.1.
  allowPrivateNetwork?: boolean;
};

export type ConfirmGrant = { snap: number; ref: string };

export type PolicyDecision =
  | { ok: true; action: Action; risk: Risk }
  | { ok: false; error: ActionError; message: string; action?: Action; confirm?: ConfirmRequest };

const refuse = (error: ActionError, message: string, action?: Action): PolicyDecision => ({
  ok: false,
  error,
  message,
  action,
});

// --- 1. Schema and freshness ---

const refOf = (action: Action) => ('ref' in action ? action.ref : undefined);
const snapOf = (action: Action) => ('snap' in action ? action.snap : undefined);

const checkFresh = (action: Action, snapshot: Snapshot) => {
  const snap = snapOf(action);
  if (snap !== undefined && snap !== snapshot.snap) {
    return refuse('stale_ref', `This is for snap ${snap}, but the page is now at snap ${snapshot.snap}.`, action);
  }

  const ref = refOf(action);
  if (ref !== undefined && !snapshot.targets.has(ref)) {
    return refuse('stale_ref', `${ref} isn't on the page any more.`, action);
  }

  return undefined;
};

// --- 2. URLs ---

// Home routers, printers, other machines on the network. A page shouldn't be able to steer the agent there.
const isPrivateHost = (host: string) => {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();

  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal')) {
    return true;
  }
  // IPv6: loopback, unique-local (fc00::/7) and link-local (fe80::/10).
  if (name.includes(':')) return name === '::1' || /^f[cd]/.test(name) || name.startsWith('fe80:');

  const ipv4 = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export const checkUrl = (rawUrl: string, allowPrivateNetwork = false): string | undefined => {
  // Only http and https. That rules out browsie:, file:, javascript:, data:, chrome: and the rest.
  if (!isWebUrl(rawUrl)) return 'Only http and https addresses can be opened.';

  const url = new URL(rawUrl);
  // https://bank.com@evil.example looks like the bank but isn't.
  if (url.username || url.password) return "Addresses with a username or password in them can't be opened.";
  if (!allowPrivateNetwork && isPrivateHost(url.hostname)) return "Addresses on this computer or local network can't be opened.";

  return undefined;
};

// --- 3. Risk: when an action can't be taken back ---

// Matched as whole words in the target's name, case-insensitive.
const TRANSACT_WORDS =
  /\b(send|pay|buy|order|delete|post|confirm|place|purchase|publish|transfer|donate|subscribe)\b/i;

const isSensitiveField = (node: SnapNode) => {
  const autocomplete = node.dom?.autocomplete ?? '';
  return (
    node.dom?.type === 'password' ||
    /\bcc-/.test(autocomplete) ||
    /one-time-code/.test(autocomplete) ||
    /\b(card number|security code|cvv|cvc|expiry|expiration)\b/i.test(node.name)
  );
};

const isSubmitButton = (node: SnapNode) => {
  const dom = node.dom;
  if (!dom) return false;
  if (dom.tag === 'INPUT') return dom.type === 'submit' || dom.type === 'image';
  // A <button> in a form submits it unless it says otherwise.
  return dom.tag === 'BUTTON' && dom.form !== undefined && (dom.type === undefined || dom.type === 'submit');
};

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

// The other elements in the target's <form>. Element ids are only unique within one frame session, so a
// form in a payment iframe and one in the page can share an id: match the session too.
const formMembers = (snapshot: Snapshot, target: SnapNode | undefined) => {
  const form = target?.dom?.form;
  if (form === undefined) return [];
  return snapshot.nodes.filter((node) => node.dom?.form === form && node.sessionId === target?.sessionId);
};

// Submitting a search box isn't a transaction, or every search would need a "yes".
const isSearchForm = (members: SnapNode[]) => {
  const fields = members.filter((node) => TEXT_ROLES.has(node.role));
  return (
    fields.length > 0 &&
    fields.every((node) => node.role === 'searchbox' || node.dom?.type === 'search' || /search/i.test(node.name))
  );
};

// Enter in a field submits its form, so it's as risky as the form's submit button.
const isTransactForm = (snapshot: Snapshot, target: SnapNode) => {
  const members = formMembers(snapshot, target);
  if (members.some(isSensitiveField)) return true;
  return !isSearchForm(members) && members.some(isSubmitButton);
};

const nodeFor = (snapshot: Snapshot, ref: string | undefined) =>
  ref === undefined ? undefined : snapshot.nodes.find((node) => node.ref === ref);

const focusedNode = (snapshot: Snapshot) => snapshot.nodes.find((node) => node.states.includes('focused'));

// Decided by code from what the target really is, never by the model.
export const riskOf = (action: Action, snapshot?: Snapshot): Risk => {
  const base = BASE_RISK[action.type];
  if (!snapshot) return base;

  if (action.type === 'click') {
    const target = nodeFor(snapshot, action.ref);
    if (!target) return base;

    const named = (target.role === 'button' || target.role === 'link' || target.role === 'menuitem') && TRANSACT_WORDS.test(target.name);
    const members = formMembers(snapshot, target);
    const submits = isSubmitButton(target) && !isSearchForm(members);
    const sensitive = target.dom?.form !== undefined && members.some(isSensitiveField);

    return named || submits || (sensitive && (target.role === 'button' || isSubmitButton(target))) ? 'transact' : base;
  }

  if (action.type === 'press' && action.key === 'Enter') {
    const target = action.ref === undefined ? focusedNode(snapshot) : nodeFor(snapshot, action.ref);
    if (!target) return base;
    if (target.role === 'button' || target.role === 'link') {
      return riskOf({ type: 'click', snap: action.snap, ref: target.ref }, snapshot);
    }
    return TEXT_ROLES.has(target.role) && isTransactForm(snapshot, target) ? 'transact' : base;
  }

  return base;
};

// What gets read out before asking for a yes. Built from the form's real state, so the model can't
// describe a payment as something harmless.
export const buildConfirm = (action: Action, snapshot: Snapshot): ConfirmRequest => {
  const ref = refOf(action) ?? focusedNode(snapshot)?.ref;
  const target = nodeFor(snapshot, ref);
  const members = formMembers(snapshot, target);

  const fields = members.flatMap((node): { label: string; value: string }[] => {
    if (node === target || !node.name) return [];
    const autocomplete = node.dom?.autocomplete ?? '';

    if (node.dom?.type === 'password' || /one-time-code|cc-csc/.test(autocomplete)) return [];
    if (node.role === 'checkbox' || node.role === 'switch') {
      return [{ label: node.name, value: node.states.includes('checked') ? 'yes' : 'no' }];
    }
    if (node.role === 'radio') return node.states.includes('checked') ? [{ label: node.name, value: 'selected' }] : [];
    if (node.value === undefined) return [];
    // Never read a whole card number aloud.
    if (/cc-number/.test(autocomplete) || /card number/i.test(node.name)) {
      return [{ label: node.name, value: `ending in ${node.value.replace(/\D/g, '').slice(-4)}` }];
    }
    return [{ label: node.name, value: node.value }];
  });

  let origin = snapshot.url;
  try {
    origin = new URL(snapshot.url).origin;
  } catch {
    // Keep the raw URL if it doesn't parse.
  }

  const button =
    target && (target.role === 'button' || target.role === 'link')
      ? target.name
      : (members.find(isSubmitButton)?.name ?? (action.type === 'press' ? 'Enter' : ''));

  return { origin, button, fields };
};

// --- 4. Where typed text came from ---

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export const checkProvenance = (text: string, ids: readonly string[], sources: ReadonlyMap<string, string>) => {
  const missing = ids.filter((id) => !sources.has(id));
  if (missing.length) return `Unknown source ${missing.join(', ')}.`;

  const wanted = normalize(text);
  const cited = ids.map((id) => normalize(sources.get(id) ?? ''));
  // The whole text must appear in one thing the user said or confirmed. Text from the page never does.
  if (!cited.some((source) => source.includes(wanted))) {
    return "That text isn't in what the user said or confirmed, so it can't be typed.";
  }

  return undefined;
};

// --- 5. Secrets ---

const isSecretTarget = (node?: SnapNode) =>
  node?.dom?.type === 'password' || /one-time-code/.test(node?.dom?.autocomplete ?? '');

// --- The gate ---

export const evaluate = (raw: unknown, ctx: PolicyContext): PolicyDecision => {
  const parsed = parseAction(raw);
  if (!parsed.success) {
    return refuse('invalid_action', parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const action = parsed.data;
  const { snapshot } = ctx;

  if (snapshot) {
    const stale = checkFresh(action, snapshot);
    if (stale) return stale;
  }

  if (action.type === 'goto') {
    const problem = checkUrl(action.url, ctx.allowPrivateNetwork);
    if (problem) return refuse('blocked_by_policy', problem, action);
  }

  if (action.type === 'type') {
    if (snapshot && isSecretTarget(nodeFor(snapshot, action.ref))) {
      return refuse('blocked_by_policy', 'Passwords and codes are for the user to type. Use request_help.', action);
    }
    const problem = checkProvenance(action.text, action.provenance, ctx.sources);
    if (problem) return refuse('blocked_by_policy', problem, action);
  }

  if (action.type === 'finish' && snapshot) {
    const problem = checkEvidence(action.evidence, snapshot);
    if (problem) return refuse('blocked_by_policy', problem, action);
  }

  const risk = riskOf(action, snapshot);

  if (risk === 'transact' && snapshot) {
    const ref = refOf(action) ?? focusedNode(snapshot)?.ref;
    const granted = ctx.grant && ctx.grant.snap === snapshot.snap && ctx.grant.ref === ref;
    if (!granted) {
      return {
        ok: false,
        error: 'needs_user',
        message: 'This would pay, send, delete or post something. The user has to say yes first.',
        action,
        confirm: buildConfirm(action, snapshot),
      };
    }
  }

  return { ok: true, action, risk };
};

// A batch is checked as a whole against one snapshot. The actions before the first refusal may run, and
// the refusal comes back for the loop. The executor settles and snapshots once, after the last action, so
// the later actions' snap and refs are still current when they run.
export const evaluateBatch = (raws: readonly unknown[], ctx: PolicyContext) => {
  const run: { action: Action; risk: Risk }[] = [];

  for (const raw of raws) {
    const decision = evaluate(raw, ctx);
    if (!decision.ok) return { run, stop: decision };
    run.push({ action: decision.action, risk: decision.risk });
  }

  return { run, stop: undefined };
};

// The key the grant is matched on, for main to remember what the user agreed to.
export const grantFor = (decision: PolicyDecision, snapshot: Snapshot): ConfirmGrant | undefined => {
  if (decision.ok || decision.error !== 'needs_user' || !decision.action) return undefined;
  const ref = refOf(decision.action) ?? focusedNode(snapshot)?.ref;
  return ref === undefined ? undefined : { snap: snapshot.snap, ref };
};

// --- finish: the model's "done" has to be visible ---

export const checkEvidence = (evidence: readonly string[], snapshot: Snapshot) => {
  const page = normalize(
    [snapshot.url, snapshot.title, ...snapshot.nodes.flatMap((node) => [node.name, node.value ?? ''])].join('\n'),
  );
  const missing = evidence.filter((item) => !page.includes(normalize(item)));
  return missing.length ? `Not on the page: ${missing.map((item) => JSON.stringify(item)).join(', ')}.` : undefined;
};

// --- 6. Limits ---

export const LIMITS = {
  steps: 40,
  ms: 5 * 60_000,
  // Same action with no effect this many times: replan. One more after that: ask the user.
  repeatsBeforeReplan: 3,
  repeatsBeforeAsk: 4,
};

export type TaskUsage = {
  steps: number;
  startedAt: number;
  now: number;
  spentUsd: number;
  capUsd: number;
};

export const checkLimits = (usage: TaskUsage): string | undefined => {
  if (usage.steps >= LIMITS.steps) return `Stopped after ${LIMITS.steps} steps.`;
  if (usage.now - usage.startedAt >= LIMITS.ms) return 'Stopped after 5 minutes.';
  if (usage.spentUsd >= usage.capUsd) return 'Stopped: this task reached its spending limit.';
  return undefined;
};

// Same type, same element, same text: the same attempt.
export const actionKey = (action: Action) =>
  JSON.stringify([action.type, refOf(action) ?? null, action.type === 'type' ? action.text : null, action.type === 'press' ? action.key : null]);

export type StepRecord = { key: string; error?: ActionError };

export const repeatVerdict = (history: readonly StepRecord[], key: string): 'ok' | 'replan' | 'ask_user' => {
  const futile = history.filter((step) => step.key === key && step.error === 'no_effect').length;
  if (futile >= LIMITS.repeatsBeforeAsk) return 'ask_user';
  if (futile >= LIMITS.repeatsBeforeReplan) return 'replan';
  return 'ok';
};
