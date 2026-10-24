import { evaluateBatch, type ConfirmGrant } from '../../src/main/web/policy';
import type { Snapshot } from '../../src/main/web/snapshot';
import type { ActionResult } from '../../src/shared/web/actions';
import { summarizeBatch } from '../../src/main/agent/traceEvents';
import { type DecisionSummary, deserializeSnapshot, type TraceEvent } from './trace';

// Runs a recorded trace again without a browser or a model, so regressions show up in plain vitest.
//
// - replayPolicy re-runs today's policy on every recorded batch, against the snapshot the model saw then.
//   A different answer means a policy change altered behaviour on a real run.
// - ReplayLlm hands the loop the recorded model answers in order, and notes where the loop now asks
//   something different.
// - ReplayExecutor hands back the recorded results and snapshots, and fails if the loop asks it to do
//   anything other than what was recorded.
// The phase 4 loop plugs into the last two in place of the broker and the real executor.

export { summarizeBatch };

export type PolicyMismatch = { step: number; actions: unknown[]; recorded: DecisionSummary[]; replayed: DecisionSummary[] };

export const replayPolicy = (events: readonly TraceEvent[]): PolicyMismatch[] => {
  const mismatches: PolicyMismatch[] = [];
  const sources = new Map<string, string>();
  let allowPrivateNetwork = false;
  let snapshot: Snapshot | undefined;
  let grant: ConfirmGrant | undefined;

  for (const event of events) {
    switch (event.t) {
      case 'start':
        Object.entries(event.sources).forEach(([id, text]) => sources.set(id, text));
        allowPrivateNetwork = event.allowPrivateNetwork;
        break;
      case 'source':
        sources.set(event.id, event.text);
        break;
      case 'snapshot':
        snapshot = deserializeSnapshot(event.snapshot);
        break;
      case 'confirm':
        grant = event.answer === 'yes' ? event.grant : undefined;
        break;
      case 'decision': {
        const replayed = summarizeBatch(evaluateBatch(event.actions, { snapshot, sources, grant, allowPrivateNetwork }));
        if (JSON.stringify(replayed) !== JSON.stringify(event.decisions)) {
          mismatches.push({ step: event.step, actions: event.actions, recorded: event.decisions, replayed });
        }
        break;
      }
      default:
        break;
    }
  }

  return mismatches;
};

export class ReplayLlm {
  private readonly calls: Extract<TraceEvent, { t: 'llm' }>[];
  private next = 0;
  // Where the loop's request differs from the recorded one: prompt or snapshot formatting changed.
  readonly divergences: { call: number; recorded: unknown; actual: unknown }[] = [];

  constructor(events: readonly TraceEvent[]) {
    this.calls = events.filter((event): event is Extract<TraceEvent, { t: 'llm' }> => event.t === 'llm');
  }

  async complete(request: unknown) {
    const call = this.calls[this.next];
    if (!call) throw new Error(`The trace has only ${this.calls.length} model answers, but the loop asked for more.`);
    if (JSON.stringify(request) !== JSON.stringify(call.request)) {
      this.divergences.push({ call: this.next, recorded: call.request, actual: request });
    }
    this.next += 1;
    return { response: call.response, usage: call.usage };
  }

  get remaining() {
    return this.calls.length - this.next;
  }
}

export class ReplayExecutor {
  private readonly results: Extract<TraceEvent, { t: 'result' }>[];
  private readonly snapshots: Snapshot[];
  private nextResult = 0;
  private nextSnapshot = 0;

  constructor(events: readonly TraceEvent[]) {
    this.results = events.filter((event): event is Extract<TraceEvent, { t: 'result' }> => event.t === 'result');
    this.snapshots = events
      .filter((event): event is Extract<TraceEvent, { t: 'snapshot' }> => event.t === 'snapshot')
      .map((event) => deserializeSnapshot(event.snapshot));
  }

  async snapshot(): Promise<Snapshot> {
    const snapshot = this.snapshots[this.nextSnapshot++];
    if (!snapshot) throw new Error('The loop took more snapshots than the trace recorded.');
    return snapshot;
  }

  async run(action: unknown): Promise<ActionResult> {
    const recorded = this.results[this.nextResult++];
    if (!recorded) throw new Error('The loop ran more actions than the trace recorded.');
    if (JSON.stringify(action) !== JSON.stringify(recorded.action)) {
      throw new Error(
        `Step ${recorded.step}: the loop ran ${JSON.stringify(action)} but the trace ran ${JSON.stringify(recorded.action)}.`,
      );
    }
    return recorded.result;
  }
}
