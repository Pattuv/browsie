import { describe, expect, it, vi } from 'vitest';
import type { LlmResponse } from '../../shared/agent/llm';
import type { ActResponse, Observation, TaskEventBody } from '../../shared/agent/protocol';
import type { Action } from '../../shared/web/actions';
import { type Answer, type LoopDeps, runWebTask } from './loop';


const page = (snap: number, extra: Partial<Observation> = {}): Observation => ({
  snap,
  url: 'https://shop.example.com/',
  title: 'Shop',
  text: `snap ${snap} · page`,
  isDelta: false,
  full: `snap ${snap} · page`,
  names: { e1: 'Name', e2: 'Place order' },
  needsScreenshot: false,
  fileChooser: false,
  ...extra,
});

const act = (actions: unknown[], plan?: string[]): LlmResponse => ({
  model: 'test',
  content: '',
  toolCalls: [{ id: `c${Math.random()}`, name: 'act', arguments: JSON.stringify({ plan, actions }) }],
  finishReason: 'tool_calls',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});

const text = (content: string): LlmResponse => ({ ...act([]), content, toolCalls: [] });

const finish = act([{ type: 'finish', summary: 'Ordered the mug.', evidence: ['Order #1234'] }]);

type Setup = {
  replies: LlmResponse[];
  acts?: ((actions: Action[]) => ActResponse)[];
  answers?: Answer[];
  observation?: Observation;
  files?: string[];
};

const harness = ({ replies, acts = [], answers = [], observation = page(1), files = [] }: Setup) => {
  const events: TaskEventBody[] = [];
  const controller = new AbortController();
  const llm = vi.fn(async () => {
    const next = replies.shift();
    if (!next) throw new Error('model script ran out');
    return next;
  });
  const web = {
    observe: vi.fn(async () => observation),
    act: vi.fn(async (actions: Action[]) => {
      const next = acts.shift();
      if (!next) throw new Error('act script ran out');
      return next(actions);
    }),
    finish: vi.fn(async () => ({ ok: true })),
    listFiles: vi.fn(async () => files),
    chooseFile: vi.fn(async () => ({ ok: true })),
  };
  const deps: LoopDeps = {
    llm,
    web,
    emit: (event) => events.push(event),
    waitForAnswer: vi.fn(async () => {
      const next = answers.shift();
      if (!next) throw new Error('no answer scripted');
      return next;
    }),
    signal: controller.signal,
  };
  const run = () => runWebTask({ taskId: 't1', goal: 'Buy a mug for Sam Lee', sources: [{ id: 'u1', text: 'Buy a mug for Sam Lee' }] }, deps);
  return { run, events, llm, web, controller, deps };
};

const success = (snap: number): ActResponse => ({
  ran: 1,
  result: { ok: true, snap, effects: [{ kind: 'dom_changed', added: 1, removed: 0, changed: 0 }] },
  observation: page(snap),
});

describe('runWebTask', () => {
  it('types, clicks and finishes, narrating each step', async () => {
    const t = harness({
      replies: [
        act([{ type: 'type', ref: 'e1', text: 'Sam Lee', provenance: ['u1'] }], ['Fill the name', 'Order']),
        act([{ type: 'click', ref: 'e2' }]),
        finish,
      ],
      acts: [() => success(2), () => success(3)],
    });

    const result = await t.run();

    expect(result).toMatchObject({ ok: true, facts: ['Ordered the mug.'], untrusted: true });
    // The missing snap was filled in from the observation the model saw.
    expect(t.web.act.mock.calls[0][0]).toEqual([{ type: 'type', snap: 1, ref: 'e1', text: 'Sam Lee', provenance: ['u1'] }]);
    expect(t.events.filter((e) => e.type === 'step_started').map((e) => 'phrase' in e && e.phrase)).toEqual([
      'Typing into "Name"',
      'Clicking "Place order"',
    ]);
    expect(t.events.at(-1)).toMatchObject({ type: 'finished' });
  });

  it('catches text that is not from the user before it reaches main', async () => {
    const t = harness({
      replies: [act([{ type: 'type', ref: 'e1', text: 'pwned@evil.example', provenance: ['u1'] }]), finish],
    });
    await t.run();
    expect(t.web.act).not.toHaveBeenCalled();
    // The loop keeps appending to one history, so look through all of it.
    const second = t.llm.mock.calls[1] as unknown as [{ messages: { role: string; content: unknown }[] }];
    const refusal = second[0].messages.find((m) => m.role === 'tool');
    expect(String(refusal?.content)).toContain('Not allowed');
  });

  it('waits for a yes, then sends the rest against the new snapshot', async () => {
    const t = harness({
      replies: [act([{ type: 'type', ref: 'e1', text: 'Sam Lee', provenance: ['u1'] }, { type: 'click', ref: 'e2' }]), finish],
      acts: [
        () => ({ ran: 1, result: success(2).result, stop: { error: 'needs_user', message: 'needs a yes' }, observation: page(2) }),
        () => success(3),
      ],
      answers: [{ text: 'yes', confirmed: true }],
    });

    expect(await t.run()).toMatchObject({ ok: true });
    expect(t.web.act.mock.calls[1][0]).toEqual([{ type: 'click', snap: 2, ref: 'e2' }]);
  });

  it('stops politely when the user says no', async () => {
    const t = harness({
      replies: [act([{ type: 'click', ref: 'e2' }])],
      acts: [() => ({ ran: 0, stop: { error: 'needs_user', message: 'needs a yes' }, observation: page(1) })],
      answers: [{ text: 'no', confirmed: false }],
    });

    expect(await t.run()).toMatchObject({ ok: false, error: 'declined' });
    expect(t.web.act).toHaveBeenCalledTimes(1);
  });

  it('asks the user and cites their answer as a source', async () => {
    const t = harness({
      replies: [
        act([{ type: 'ask_user', question: 'Which size?', options: ['Small', 'Large'] }]),
        act([{ type: 'type', ref: 'e1', text: 'Large', provenance: ['a1'] }]),
        finish,
      ],
      acts: [() => success(2)],
      answers: [{ text: 'Large please', sourceId: 'a1' }],
    });

    expect(await t.run()).toMatchObject({ ok: true });
    expect(t.events).toContainEqual({ type: 'ask_user', question: 'Which size?', options: ['Small', 'Large'] });
  });

  it('moves up to the stronger model after two failures', async () => {
    const t = harness({ replies: [text('hmm'), text('hmm'), finish] });
    await t.run();
    const tiers = t.llm.mock.calls.map((call) => (call as unknown as [{ tier: string }])[0].tier);
    expect(tiers).toEqual(['main', 'main', 'escalate']);
  });

  it('asks for help when stuck, then gives up', async () => {
    const t = harness({
      replies: Array.from({ length: 8 }, () => text('hmm')),
      answers: [{ text: 'try the other button', sourceId: 'a1' }],
    });
    const result = await t.run();
    expect(t.events.some((e) => e.type === 'ask_user')).toBe(true);
    expect(result).toMatchObject({ ok: false });
    expect(t.events.at(-1)).toMatchObject({ type: 'failed' });
  });

  it('reports what got done when stopped', async () => {
    const t = harness({
      replies: [act([{ type: 'click', ref: 'e2' }]), act([{ type: 'ask_user', question: 'Continue?' }])],
      acts: [() => success(2)],
    });
    t.deps.waitForAnswer = async () => {
      t.controller.abort();
      throw new Error('stopped');
    };
    const result = await t.run();
    expect(result).toMatchObject({ ok: false, error: 'stopped', facts: ['Clicking "Place order"'] });
    expect(t.events.at(-1)).toMatchObject({ type: 'stopped' });
  });

  it('lets the user pick the file a page asks for', async () => {
    const t = harness({
      replies: [act([{ type: 'click', ref: 'e2' }]), finish],
      acts: [() => ({ ...success(2), observation: page(2, { fileChooser: true }) })],
      answers: [{ text: 'the resume.pdf one', sourceId: 'a1' }],
      files: ['resume.pdf', 'old.pdf'],
    });
    await t.run();
    expect(t.events).toContainEqual({ type: 'ask_user', question: 'Which file should I attach?', options: ['resume.pdf', 'old.pdf'] });
    expect(t.web.chooseFile).toHaveBeenCalledWith('resume.pdf', 'a1');
  });

  it('does not accept a finish main refuses', async () => {
    const t = harness({ replies: [finish, finish] });
    t.web.finish.mockResolvedValueOnce({ ok: false, message: 'Not on the page: "Order #1234".' } as never);
    expect(await t.run()).toMatchObject({ ok: true });
    expect(t.web.finish).toHaveBeenCalledTimes(2);
  });

  it('ends the task at a limit', async () => {
    const t = harness({
      replies: [act([{ type: 'click', ref: 'e2' }])],
      acts: [() => ({ ran: 0, limit: 'Stopped after 40 steps.', observation: page(1) })],
    });
    expect(await t.run()).toMatchObject({ ok: false, error: 'Stopped after 40 steps.' });
  });
});
