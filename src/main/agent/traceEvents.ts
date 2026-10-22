import type { ActionResult } from '../../shared/web/actions';
import type { ConfirmGrant, evaluateBatch } from '../web/policy';
import type { Snapshot } from '../web/snapshot';

// What a WEB task leaves behind for the eval: every snapshot the model saw (with the structure policy needs,
// not just the text), each model call and its answer, each batch the model asked for, what policy decided,
// each confirmation, and what happened when it ran. Enough to replay a run without a browser or a model.
// The host emits these when given an onTrace hook. The app doesn't, the eval harness does.

export type DecisionSummary = { ok: true; risk: string } | { ok: false; error: string };

// Snapshot holds a Map, which JSON drops.
export type SerializedSnapshot = Omit<Snapshot, 'targets'> & {
  targets: [string, { sessionId?: string; backendNodeId: number }][];
};

export type TraceEvent =
  | {
      t: 'start';
      run: string;
      scenario: string;
      goal: string;
      // What the user said and confirmed, by id: the provenance sources policy checks typed text against.
      sources: Record<string, string>;
      allowPrivateNetwork: boolean;
      model: string;
      at: number;
    }
  // Something the user said mid-task, e.g. answering a question. Becomes a new source.
  | { t: 'source'; step: number; id: string; text: string }
  | { t: 'snapshot'; step: number; snapshot: SerializedSnapshot }
  | {
      t: 'llm';
      step: number;
      model: string;
      request: unknown;
      response: unknown;
      usage: { inputTokens: number; outputTokens: number; costUsd: number };
    }
  | { t: 'decision'; step: number; actions: unknown[]; decisions: DecisionSummary[] }
  | { t: 'confirm'; step: number; grant: ConfirmGrant; answer: 'yes' | 'no' }
  | { t: 'result'; step: number; action: unknown; result: ActionResult }
  | { t: 'end'; ok: boolean; steps: number; ms: number; costUsd: number; error?: string };

export const serializeSnapshot = (snapshot: Snapshot): SerializedSnapshot => ({
  ...snapshot,
  targets: [...snapshot.targets],
});

export const deserializeSnapshot = (snapshot: SerializedSnapshot): Snapshot => ({
  ...snapshot,
  targets: new Map(snapshot.targets),
});

export const summarizeBatch = (result: ReturnType<typeof evaluateBatch>): DecisionSummary[] => [
  ...result.run.map(({ risk }) => ({ ok: true as const, risk })),
  ...(result.stop ? [{ ok: false as const, error: result.stop.error }] : []),
];
