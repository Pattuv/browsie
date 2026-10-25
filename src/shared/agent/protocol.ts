import { z } from 'zod';
import type { ActionError, ActionResult, ConfirmRequest } from '../web/actions';
import type { FallbackId } from './fallbacks';
import type { SessionTurn } from './session';
import type { GoogleCallResult, GoogleService } from '../google/tools';
import { LlmRequest, type LlmResponse } from './llm';

// Everything that crosses the MessagePort between main and the agent utilityProcess.
// The agent asks main for things with RPC calls (checked here with Zod, since the agent handles untrusted
// page text and might be confused or injected). Main tells the agent to start, answer or stop a task, and
// the agent reports progress with events.

// Something the user said or confirmed. Typed text must cite these by id, and main keeps its own copy.
export type Source = { id: string; text: string };

// The lanes that run in the agent process. (CHAT, HELP and INFO arrive with the voice phase.)
export type AgentLane = 'WEB' | 'UI' | 'INFO';

export type TaskResult = {
  taskId: string;
  lane: AgentLane;
  ok: boolean;
  // What the verbal engine can say: the finish summary, or what got done before it stopped.
  facts: string[];
  // Derived from page text, so it's never treated as instructions downstream.
  untrusted: boolean;
  error?: string;
  handoff?: { lane: string; goal: string };
};

type EventBase = { taskId: string; turnId: string };

export type TaskEvent = EventBase &
  (
    | { type: 'step_started'; step: number; phrase: string }
    | { type: 'step_done'; step: number; ok: boolean; error?: ActionError }
    // From main, which built the summary from the real form.
    | { type: 'needs_confirm'; confirm: ConfirmRequest }
    | { type: 'ask_user'; question: string; options?: string[] }
    | { type: 'request_help'; reason: string }
    | { type: 'finished'; result: TaskResult }
    | { type: 'failed'; result: TaskResult }
    | { type: 'stopped'; result: TaskResult }
  );

export type TaskEventBody = TaskEvent extends infer E ? (E extends EventBase ? Omit<E, keyof EventBase> : never) : never;

// What the agent sees of the page. Element details policy needs stay in main.
export type Observation = {
  snap: number;
  url: string;
  title: string;
  // The whole page, or just what changed since the last observation when that's shorter.
  text: string;
  isDelta: boolean;
  // Always the whole page, for starting a fresh conversation.
  full: string;
  // Accessible names by ref, so steps can be narrated ("Clicking 'Add to cart'").
  names: Record<string, string>;
  // Too much of the page has no names to work from text alone.
  needsScreenshot: boolean;
  screenshot?: string;
  // The page asked for a file and is waiting.
  fileChooser: boolean;
};

export type ActResponse = {
  // How many of the actions ran.
  ran: number;
  // What happened to the ones that ran. Absent when nothing ran.
  result?: ActionResult;
  // Why the rest didn't run: a policy refusal, or a confirmation main is now asking the user for.
  stop?: { error: ActionError; message: string };
  // The task is over: a step, time or spending limit was reached.
  limit?: string;
  observation: Observation;
};

//Turns: one thing the user said, from transcript to spoken reply

// What the classifier can decide. CONTROL words never get this far: main handles them first.
export const TURN_LABELS = ['CHAT', 'HELP', 'INFO', 'UI', 'WEB', 'RESTRICTED', 'UNCLEAR'] as const;
export type TurnLabel = (typeof TURN_LABELS)[number];

// What a turn wants said. clip lines are prerecorded and text is spoken live.
export type TurnEvent =
  | { turnId: string; type: 'say'; text?: string; clip?: FallbackId }
  | { turnId: string; type: 'routed'; label: TurnLabel; confidence?: number; tasks: { lane: AgentLane; goal: string }[] }
  | { turnId: string; type: 'done'; ok: boolean };

// What the UI lane gets back from a browser command. data holds tab titles, bookmark names and history
// entries, which websites wrote, the lane treats it as information, never instructions.
export type ChromeResponse =
  | { ok: true; phrase: string; data?: unknown }
  | { ok: false; error: string; message: string; limit?: boolean };

const taskId = z.string().min(1).max(64);

export const RPC = {
  'llm.complete': LlmRequest,
  'web.observe': z.strictObject({ taskId, screenshot: z.boolean().optional() }),
  'web.act': z.strictObject({ taskId, actions: z.array(z.unknown()).min(1).max(3) }),
  'web.finish': z.strictObject({ taskId, summary: z.string().min(1).max(500), evidence: z.array(z.string().max(200)).min(1).max(5) }),
  'files.list': z.strictObject({ taskId }),
  // The user's answer that named the file, by source id: main checks the name really is in it.
  'files.choose': z.strictObject({ taskId, name: z.string().min(1).max(200), sourceId: z.string().min(1).max(64) }),
  // One command from shared/chrome/actions.ts. Main parses it again.
  'chrome.execute': z.strictObject({ taskId, action: z.unknown() }),
  // A turn asks main to run one WEB or UI task and waits for its result. (taskId is the turn's id here.)
  'turn.run_task': z.strictObject({ taskId, lane: z.enum(['WEB', 'UI', 'INFO']), goal: z.string().min(1).max(1_000) }),
  // INFO lane: who the account is, today's date and time zone, and which Google services Browsie may use.
  'google.context': z.strictObject({ taskId }),
  // INFO lane: one Gmail, Calendar or Drive tool (shared/google/tools.ts). Main parses it again.
  'google.call': z.strictObject({ taskId, tool: z.string().min(1).max(64), args: z.unknown() }),
} as const;

export type RpcMethod = keyof typeof RPC;

export type RpcResults = {
  'llm.complete': LlmResponse;
  'web.observe': Observation;
  'web.act': ActResponse;
  'web.finish': { ok: boolean; message?: string };
  'files.list': string[];
  'files.choose': { ok: boolean; message?: string };
  'chrome.execute': ChromeResponse;
  'turn.run_task': TaskResult;
  'google.context': GoogleContext;
  'google.call': GoogleCallResult;
};

export type GoogleContext = {
  email?: string;
  // Now, as the user's wall clock reads it, e.g. "Friday, October 23, 2026, 9:12 PM".
  now: string;
  nowIso: string;
  timeZone: string;
  access: Record<GoogleService, boolean>;
};

export type RpcParams<M extends RpcMethod> = z.infer<(typeof RPC)[M]>;

// Main → agent.
export type HostMessage =
  | { kind: 'start'; lane: AgentLane; taskId: string; turnId: string; goal: string; sources: Source[] }
  // The user's reply to ask_user or request_help, or their yes/no to a confirmation.
  | { kind: 'answer'; taskId: string; text: string; sourceId?: string; confirmed?: boolean }
  | { kind: 'abort'; taskId: string }
  // Something the user said that isn't an answer to a pending question. `context` is what main knows that
  // helps route it (is a website open?), never page text.
  | { kind: 'turn'; turnId: string; transcript: string; context: TurnContext }
  | { kind: 'abort_turn'; turnId: string }
  // Drop what this session remembers. The agent replies with an empty session snapshot.
  | { kind: 'clear_session' }
  | { kind: 'rpc-result'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-result'; id: number; ok: false; error: string };

// Agent → main.
export type AgentMessage =
  | { kind: 'rpc'; id: number; method: RpcMethod; params: unknown }
  | { kind: 'event'; event: TaskEvent }
  | { kind: 'turn_event'; event: TurnEvent }
  // The conversation the session sidebar shows. Replaces the previous snapshot.
  | { kind: 'session'; turns: SessionTurn[] };

export type TurnContext = {
  // The active tab shows a website (WEB tasks need one), and which site, for the classifier.
  site?: string;
  tabCount: number;
};
