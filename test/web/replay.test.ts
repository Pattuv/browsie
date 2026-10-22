import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateBatch } from '../../src/main/web/policy';
import type { Snapshot, SnapNode } from '../../src/main/web/snapshot';
import { ReplayExecutor, ReplayLlm, replayPolicy, summarizeBatch } from './replay';
import { parseTrace, readTrace, serializeSnapshot, type TraceEvent, TraceWriter } from './trace';

// A short recorded run on the checkout's review page: the model tries Place order, policy asks the user,
// the user says yes, the order goes through.
const reviewPage = (snap: number): Snapshot => {
  const nodes: SnapNode[] = [
    { ref: 'e1', role: 'heading', name: 'Step 3 of 3: Review your order' },
    { ref: 'e2', role: 'checkbox', name: 'Gift wrap', dom: { tag: 'INPUT', type: 'checkbox', form: 9, doc: 0 } },
    { ref: 'e3', role: 'button', name: 'Place order', dom: { tag: 'BUTTON', form: 9, doc: 0 } },
  ].map((node, i) => ({
    backendNodeId: 10 + i,
    states: [],
    depth: 0,
    priority: 0,
    offscreen: false,
    body: '',
    ...node,
  }));
  return {
    snap,
    url: 'http://127.0.0.1:5000/checkout/review.html',
    title: 'Review',
    nodes,
    targets: new Map(nodes.map((n) => [n.ref, { backendNodeId: n.backendNodeId! }])),
    dropped: 0,
    full: '',
    needsScreenshot: false,
  };
};

const placeOrder = { type: 'click', snap: 1, ref: 'e3' };
const sources = { u1: 'Buy one blue mug' };

const recordedRun = (): TraceEvent[] => {
  const page = reviewPage(1);
  const decide = (grant?: { snap: number; ref: string }) =>
    summarizeBatch(evaluateBatch([placeOrder], { snapshot: page, sources: new Map(Object.entries(sources)), grant }));

  return [
    { t: 'start', run: 'r1', scenario: 'checkout', goal: sources.u1, sources, allowPrivateNetwork: true, model: 'test', at: 0 },
    { t: 'snapshot', step: 0, snapshot: serializeSnapshot(page) },
    { t: 'llm', step: 0, model: 'test', request: { page: 1 }, response: { actions: [placeOrder] }, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } },
    { t: 'decision', step: 0, actions: [placeOrder], decisions: decide() },
    { t: 'confirm', step: 0, grant: { snap: 1, ref: 'e3' }, answer: 'yes' },
    { t: 'decision', step: 1, actions: [placeOrder], decisions: decide({ snap: 1, ref: 'e3' }) },
    { t: 'result', step: 1, action: placeOrder, result: { ok: true, snap: 2, effects: [{ kind: 'navigated', url: '/done' }] } },
    { t: 'end', ok: true, steps: 2, ms: 1200, costUsd: 0.001 },
  ];
};

describe('trace files', () => {
  it('round-trips through JSONL, Maps included', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
    const writer = new TraceWriter(dir, 'r1');
    recordedRun().forEach((event) => writer.write(event));

    const back = readTrace(writer.file);
    expect(back).toEqual(JSON.parse(JSON.stringify(recordedRun())));
    const snapshot = back.find((event) => event.t === 'snapshot');
    expect(snapshot?.t === 'snapshot' && snapshot.snapshot.targets[2]).toEqual(['e3', { backendNodeId: 12 }]);
  });

  it('says which line is broken', () => {
    expect(() => parseTrace('{"t":"end"}\nnot json')).toThrow('line 2');
  });
});

describe('replayPolicy', () => {
  it('agrees with a run recorded under the same policy', () => {
    const events = recordedRun();
    expect(events.find((e) => e.t === 'decision')).toMatchObject({ decisions: [{ ok: false, error: 'needs_user' }] });
    expect(replayPolicy(events)).toEqual([]);
  });

  it('flags a step where policy now decides differently', () => {
    // As if the run had been recorded under a policy that let Place order through without asking.
    const events = recordedRun().map((event) =>
      event.t === 'decision' && event.step === 0 ? { ...event, decisions: [{ ok: true as const, risk: 'interact' }] } : event,
    );
    expect(replayPolicy(events)).toMatchObject([{ step: 0, replayed: [{ ok: false, error: 'needs_user' }] }]);
  });

  it('counts a "no" as no grant', () => {
    const events = recordedRun().map((event) => (event.t === 'confirm' ? { ...event, answer: 'no' as const } : event));
    expect(replayPolicy(events)).toMatchObject([{ step: 1 }]);
  });
});

describe('ReplayLlm', () => {
  it('returns recorded answers in order and notes changed prompts', async () => {
    const llm = new ReplayLlm(recordedRun());
    expect(await llm.complete({ page: 2 })).toMatchObject({ response: { actions: [placeOrder] } });
    expect(llm.divergences).toHaveLength(1);
    expect(llm.remaining).toBe(0);
    await expect(llm.complete({})).rejects.toThrow('only 1 model answers');
  });
});

describe('ReplayExecutor', () => {
  it('hands back recorded results and refuses anything else', async () => {
    const executor = new ReplayExecutor(recordedRun());
    expect((await executor.snapshot()).snap).toBe(1);
    expect(await executor.run(placeOrder)).toMatchObject({ ok: true, snap: 2 });

    const other = new ReplayExecutor(recordedRun());
    await expect(other.run({ type: 'click', snap: 1, ref: 'e2' })).rejects.toThrow('the trace ran');
  });
});

// Real runs copied into traces/fixtures/ by hand, replayed against today's policy.
describe('recorded fixtures', () => {
  const dir = path.join(__dirname, 'traces', 'fixtures');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')) : [];

  it.skipIf(files.length === 0)('policy still decides every recorded step the same way', () => {
    for (const file of files) {
      expect(replayPolicy(readTrace(path.join(dir, file))), file).toEqual([]);
    }
  });
});
