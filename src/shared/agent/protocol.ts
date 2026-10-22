import { z } from 'zod';
import type { ActionError, ActionResult, ConfirmRequest } from '../web/actions';
import { LlmRequest, type LlmResponse } from './llm';

// Everything that crosses the MessagePort between main and the agent utilityProcess.
// The agent asks main for things with RPC calls (checked here with Zod, since the agent handles untrusted
// page text and might be confused or injected). Main tells the agent to start, answer or stop a task, and
// the agent reports progress with events.

// Something the user said or confirmed. Typed text must cite these by id, and main keeps its own copy.
export type Source = { id: string; text: string };

export type TaskResult = {
  taskId: string;
  lane: 'WEB';
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

const taskId = z.string().min(1).max(64);

export const RPC = {
  'llm.complete': LlmRequest,
  'web.observe': z.strictObject({ taskId, screenshot: z.boolean().optional() }),
  'web.act': z.strictObject({ taskId, actions: z.array(z.unknown()).min(1).max(3) }),
  'web.finish': z.strictObject({ taskId, summary: z.string().min(1).max(500), evidence: z.array(z.string().max(200)).min(1).max(5) }),
  'files.list': z.strictObject({ taskId }),
  // The user's answer that named the file, by source id: main checks the name really is in it.
  'files.choose': z.strictObject({ taskId, name: z.string().min(1).max(200), sourceId: z.string().min(1).max(64) }),
} as const;

export type RpcMethod = keyof typeof RPC;

export type RpcResults = {
  'llm.complete': LlmResponse;
  'web.observe': Observation;
  'web.act': ActResponse;
  'web.finish': { ok: boolean; message?: string };
  'files.list': string[];
  'files.choose': { ok: boolean; message?: string };
};

export type RpcParams<M extends RpcMethod> = z.infer<(typeof RPC)[M]>;

// Main → agent.
export type HostMessage =
  | { kind: 'start'; taskId: string; turnId: string; goal: string; sources: Source[] }
  // The user's reply to ask_user or request_help, or their yes/no to a confirmation.
  | { kind: 'answer'; taskId: string; text: string; sourceId?: string; confirmed?: boolean }
  | { kind: 'abort'; taskId: string }
  | { kind: 'rpc-result'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-result'; id: number; ok: false; error: string };

// Agent → main.
export type AgentMessage =
  | { kind: 'rpc'; id: number; method: RpcMethod; params: unknown }
  | { kind: 'event'; event: TaskEvent };
