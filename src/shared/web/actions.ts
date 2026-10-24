import { z } from 'zod';

// Everything the WEB lane's model is allowed to ask for on a page, and what comes back.
// Both processes import this: the agent to build and pre-check actions, main to parse them again before
// anything runs. Nothing here touches Electron or the DOM, so it stays safe to load anywhere.

// Bumped by main every time it takes a snapshot of a tab. An action names the snapshot it was decided
// against, and main refuses it as stale when the page has been snapshotted again since.
const snap = z.number().int().nonnegative();

// A short id like "e12", given out by the snapshot. It only means something inside that one snapshot.
const ref = z.string().regex(/^e\d{1,5}$/);

// Keys the model may press. No modifiers, so no shortcuts like Ctrl+W or Ctrl+L.
export const KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
] as const;

const MAX_TEXT = 2_000;
const MAX_URL = 2_048;
const MAX_WAIT_MS = 10_000;

// Strict objects: an action with a field we don't know (say, a script) is rejected rather than ignored.
const Click = z.strictObject({ type: z.literal('click'), snap, ref });

const Type = z.strictObject({
  type: z.literal('type'),
  snap,
  ref,
  text: z.string().min(1).max(MAX_TEXT),
  // Ids of the user's words or confirmed session facts this text came from. Main checks the text really
  // appears in them, so words lifted from the page can't be typed.
  provenance: z.array(z.string().min(1).max(64)).min(1).max(8),
  // Clear the field first instead of adding to what's there.
  replace: z.boolean().optional(),
});

const Press = z.strictObject({
  type: z.literal('press'),
  snap,
  key: z.enum(KEYS),
  // Focus this element first. Without it the key goes to whatever has focus.
  ref: ref.optional(),
});

const Select = z.strictObject({
  type: z.literal('select'),
  snap,
  ref,
  // The visible label of the option, as the snapshot shows it.
  option: z.string().min(1).max(200),
});

const Scroll = z.strictObject({
  type: z.literal('scroll'),
  snap,
  direction: z.enum(['up', 'down']),
  // Scroll inside this element (a list, a panel) instead of the page.
  ref: ref.optional(),
});

// Policy decides which URLs are allowed. Here it only has to be a sane string.
const Goto = z.strictObject({ type: z.literal('goto'), url: z.string().min(1).max(MAX_URL) });

const Back = z.strictObject({ type: z.literal('back') });

const Wait = z.strictObject({ type: z.literal('wait'), ms: z.number().int().min(100).max(MAX_WAIT_MS) });

// Hand the page to the person, for things the agent must never do itself: passwords, codes, captchas.
const RequestHelp = z.strictObject({ type: z.literal('request_help'), reason: z.string().min(1).max(300) });

const AskUser = z.strictObject({
  type: z.literal('ask_user'),
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(100)).min(2).max(5).optional(),
});

const Finish = z.strictObject({
  type: z.literal('finish'),
  summary: z.string().min(1).max(500),
  // Text that proves the job is done, like "Order #1234" or "Added to cart". Main checks each one is on
  // the final page or in its URL before believing the model.
  evidence: z.array(z.string().min(1).max(200)).min(1).max(5),
});

export const Action = z.discriminatedUnion('type', [
  Click,
  Type,
  Press,
  Select,
  Scroll,
  Goto,
  Back,
  Wait,
  RequestHelp,
  AskUser,
  Finish,
]);

export type Action = z.infer<typeof Action>;
export type ActionType = Action['type'];

// These end the model's turn, so they can't share a batch with page actions.
const TURN_ENDING: ReadonlySet<ActionType> = new Set(['request_help', 'ask_user', 'finish']);

export const isTurnEnding = (action: Action) => TURN_ENDING.has(action.type);

// One decide step may send up to three independent actions, such as filling three fields.
export const MAX_BATCH = 3;

export const ActionBatch = z
  .array(Action)
  .min(1)
  .max(MAX_BATCH)
  .refine((batch) => batch.length === 1 || !batch.some(isTurnEnding), {
    message: 'request_help, ask_user and finish must be sent on their own',
  });

export const parseAction = (raw: unknown) => Action.safeParse(raw);
export const parseBatch = (raw: unknown) => ActionBatch.safeParse(raw);

// read: only looks or waits. interact: changes the page. transact: can't be taken back (pays, sends,
// deletes, posts). No action is transact by its type alone: policy raises a click or a press to transact
// from what the target actually is, so the model can't talk its way out of a confirmation.
export type Risk = 'read' | 'interact' | 'transact';

export const BASE_RISK: Record<ActionType, Risk> = {
  click: 'interact',
  type: 'interact',
  press: 'interact',
  select: 'interact',
  goto: 'interact',
  back: 'interact',
  scroll: 'read',
  wait: 'read',
  request_help: 'read',
  ask_user: 'read',
  finish: 'read',
};

const quote = (text: string, max = 40) => `"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

// The short phrase the verbal engine speaks as a step starts. `name` is the target's accessible name from
// the snapshot, when the action has one.
export const describe = (action: Action, name?: string): string => {
  const target = name?.trim() ? quote(name.trim()) : 'that';

  switch (action.type) {
    case 'click':
      return `Clicking ${target}`;
    case 'type':
      return name?.trim() ? `Typing into ${target}` : 'Typing';
    case 'press':
      return `Pressing ${action.key}`;
    case 'select':
      return `Choosing ${quote(action.option)}`;
    case 'scroll':
      return action.direction === 'down' ? 'Scrolling down' : 'Scrolling up';
    case 'goto':
      return `Going to ${hostOf(action.url)}`;
    case 'back':
      return 'Going back';
    case 'wait':
      return 'Waiting for the page';
    case 'request_help':
      return 'I need your help with this part';
    case 'ask_user':
      return 'I have a question';
    case 'finish':
      return 'Done';
  }
};

// Why an action didn't happen. The loop decides what to do next from these, so they are a closed set.
export const ACTION_ERRORS = [
  // The action names an older snapshot, or a ref that isn't in the current one.
  'stale_ref',
  // The element is hidden, offscreen after scrolling, or covered by something else.
  'not_visible',
  'not_enabled',
  // It ran, but nothing on the page changed.
  'no_effect',
  // It would pay, send, delete or post. The person must say yes first.
  'needs_user',
  'blocked_by_policy',
  'invalid_action',
  'timeout',
  // The person pressed Space or said stop.
  'aborted',
  // The tab closed or the page crashed.
  'target_gone',
] as const;

export type ActionError = (typeof ACTION_ERRORS)[number];

// What changed after an action, worked out by main from the snapshots before and after.
export type Effect =
  | { kind: 'navigated'; url: string }
  | { kind: 'dom_changed'; added: number; removed: number; changed: number }
  | { kind: 'download_started'; fileName: string }
  | { kind: 'file_chooser_opened' };

// Built by main from the real form, never by the model, and read out before asking for a yes.
export type ConfirmRequest = {
  origin: string;
  button: string;
  fields: { label: string; value: string }[];
  // Said instead of "On <site>, I'm about to press <button>" (Gmail, Calendar and Drive actions).
  summary?: string;
};

export type ActionResult =
  | { ok: true; snap: number; effects: Effect[] }
  | {
      ok: false;
      snap: number;
      error: ActionError;
      // A short explanation for the model, e.g. which policy rule refused it.
      message: string;
      // Only with needs_user.
      confirm?: ConfirmRequest;
    };
