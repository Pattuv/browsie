import { describe, expect, it, vi } from 'vitest';
import type { LlmResponse } from '../shared/agent/llm';
import type { TaskResult, TurnEvent } from '../shared/agent/protocol';
import { parseClassification } from './classifier';
import { createSessionStore } from './sessionStore';
import { runTurn, type TurnDeps } from './turn';
import { composeReply, composeStopped } from './verbalEngine';

const text = (content: string): LlmResponse => ({
  model: 'test',
  content,
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});

const result = (extra: Partial<TaskResult>): TaskResult => ({ taskId: 't', lane: 'UI', ok: true, facts: [], untrusted: false, ...extra });

const setup = (replies: string[], results: TaskResult[] = []) => {
  const events: Omit<TurnEvent, 'turnId'>[] = [];
  const controller = new AbortController();
  const session = createSessionStore();
  const deps: TurnDeps = {
    llm: vi.fn(async () => text(replies.shift() ?? '')),
    runTask: vi.fn(async () => results.shift() ?? result({ ok: false, error: 'no result scripted' })),
    emit: (event) => events.push(event),
    session,
    signal: controller.signal,
  };
  const run = (transcript: string, site?: string) => runTurn('turn1', transcript, { site, tabCount: 1 }, deps);
  const said = () => events.filter((e) => e.type === 'say');
  return { deps, events, session, controller, run, said };
};

describe('parseClassification', () => {
  it('reads the label, even wrapped in prose', () => {
    expect(parseClassification('Sure: {"label":"UI","confidence":0.95,"multi":false}')).toEqual({ label: 'UI', confidence: 0.95, multi: false });
  });

  it('turns low confidence and nonsense into UNCLEAR', () => {
    expect(parseClassification('{"label":"WEB","confidence":0.3}').label).toBe('UNCLEAR');
    expect(parseClassification('{"label":"HACK","confidence":1}').label).toBe('UNCLEAR');
    expect(parseClassification('I think it is UI').label).toBe('UNCLEAR');
  });
});

describe('verbal engine', () => {
  it('says each finished task’s summary', () => {
    expect(composeReply([result({ facts: ['I opened amazon.com'] }), result({ lane: 'WEB', facts: ['Added the blue mug to your cart.'] })])).toBe(
      'I opened amazon.com. Added the blue mug to your cart.',
    );
  });

  it('says what got done before a stop, and plain words for failures', () => {
    expect(composeStopped(['Clicking "Add to cart"', 'Going to shop.example.com'])).toBe(
      'I stopped. I\'d clicked "Add to cart" and gone to shop.example.com.',
    );
    expect(composeStopped([])).toBe('I stopped before doing anything.');
    expect(composeReply([result({ ok: false, error: 'There is no web page open to work on.' })])).toBe(
      "There's no web page open for me to work on.",
    );
    expect(composeReply([result({ ok: false, error: 'declined' })])).toBe("OK, I didn't do it.");
  });
});

describe('runTurn', () => {
  it('answers chat directly, and remembers the turn', async () => {
    const t = setup(['{"label":"CHAT","confidence":0.9}', 'Hello! How can I help?']);
    await t.run('hello');
    expect(t.said()).toEqual([{ type: 'say', text: 'Hello! How can I help?' }]);
    expect(t.deps.runTask).not.toHaveBeenCalled();
    expect(t.session.recent(1)[0]).toMatchObject({
      user: 'hello',
      label: 'CHAT',
      reply: 'Hello! How can I help?',
      tasks: [],
      fallback: null,
    });
    expect(t.events.at(-1)).toEqual({ type: 'done', ok: true });
  });

  it('plays a fixed line for restricted and unclear requests, with no second model call', async () => {
    const t = setup(['{"label":"RESTRICTED","confidence":0.95}']);
    await t.run('turn off lockdown');
    expect(t.said()).toEqual([{ type: 'say', clip: 'restricted' }]);
    expect(t.deps.llm).toHaveBeenCalledTimes(1);
  });

  it('sends a single-step request straight to its lane in the user’s words', async () => {
    const t = setup(['{"label":"UI","confidence":0.95,"multi":false}'], [result({ facts: ['I opened a new tab.'] })]);
    await t.run('open a new tab');
    expect(t.deps.runTask).toHaveBeenCalledWith('UI', 'open a new tab');
    expect(t.said()).toEqual([{ type: 'say', text: 'I opened a new tab.' }]);
    expect(t.session.recent(1)[0].tasks).toEqual([{ lane: 'UI', goal: 'open a new tab', ok: true }]);
  });

  it('plans multi-step requests and runs the tasks in order', async () => {
    const t = setup(
      [
        '{"label":"WEB","confidence":0.9,"multi":true}',
        '{"tasks":[{"lane":"UI","goal":"Go to amazon.com"},{"lane":"WEB","goal":"Add one blue mug to the cart"}]}',
      ],
      [result({ facts: ['I opened amazon.com.'] }), result({ lane: 'WEB', facts: ['Added the blue mug to your cart.'], untrusted: true })],
    );
    await t.run('go to amazon and add a blue mug to my cart');
    expect((t.deps.runTask as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['UI', 'Go to amazon.com'],
      ['WEB', 'Add one blue mug to the cart'],
    ]);
    expect(t.events).toContainEqual(expect.objectContaining({ type: 'routed', label: 'WEB' }));
    expect(t.session.recent(1)[0].untrusted).toBe(true);
  });

  it('stops after a failed task instead of running the next', async () => {
    const t = setup(
      ['{"label":"WEB","confidence":0.9,"multi":true}', '{"tasks":[{"lane":"UI","goal":"a"},{"lane":"WEB","goal":"b"}]}'],
      [result({ ok: false, error: 'declined' })],
    );
    await t.run('do two things');
    expect(t.deps.runTask).toHaveBeenCalledTimes(1);
    expect(t.session.recent(1)[0].tasks).toEqual([{ lane: 'UI', goal: 'a', ok: false, error: 'declined' }]);
  });

  it('sends email, calendar and Drive requests to the INFO lane, site open or not', async () => {
    const t = setup(['{"label":"INFO","confidence":0.9}'], [result({ lane: 'INFO', facts: ['You have 3 unread emails, the newest from Sam.'], untrusted: true })]);
    await t.run('any new emails?');
    expect(t.deps.runTask).toHaveBeenCalledWith('INFO', 'any new emails?');
    expect(t.said()).toEqual([{ type: 'say', text: 'You have 3 unread emails, the newest from Sam.' }]);
  });

  it('asks for Google permission in plain words when it is missing', async () => {
    const t = setup(['{"label":"INFO","confidence":0.9}'], [result({ lane: 'INFO', ok: false, error: 'needs_google_access' })]);
    await t.run("what's on my calendar tomorrow?");
    expect(t.said()[0]).toMatchObject({ type: 'say', text: expect.stringContaining("Google's permission page") });
  });

  it('accepts a less certain WEB label when a site is open', async () => {
    const t = setup(['{"label":"WEB","confidence":0.45}'], [result({ lane: 'WEB', facts: ['Done.'] })]);
    await t.run('read out the first three emails', 'mail.google.com');
    expect(t.deps.runTask).toHaveBeenCalledWith('WEB', 'read out the first three emails');
    expect(parseClassification('{"label":"WEB","confidence":0.45}').label).toBe('UNCLEAR');
  });

  it('runs a handed-off page step after the browser step, and says both', async () => {
    const t = setup(
      ['{"label":"UI","confidence":0.9,"multi":false}'],
      [
        result({ facts: ['I opened a new tab and searched for ChatGPT Atlas.'], handoff: { lane: 'WEB', goal: 'Go to the Images tab' } }),
        result({ lane: 'WEB', facts: ['The Images tab is open.'] }),
      ],
    );
    await t.run('open a new tab, search for ChatGPT Atlas and go to images');
    expect((t.deps.runTask as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['UI', 'open a new tab, search for ChatGPT Atlas and go to images'],
      ['WEB', 'Go to the Images tab'],
    ]);
    expect(t.said()).toEqual([{ type: 'say', text: 'I opened a new tab and searched for ChatGPT Atlas. The Images tab is open.' }]);
  });

  it('refuses adult requests before any model call', async () => {
    const t = setup([]);
    await t.run('search for naked girls');
    expect(t.deps.llm).not.toHaveBeenCalled();
    expect(t.deps.runTask).not.toHaveBeenCalled();
    expect(t.said()).toEqual([{ type: 'say', clip: 'not_allowed' }]);
  });

  it('names the Google service that is switched off', async () => {
    const t = setup(['{"label":"INFO","confidence":0.9}'], [result({ lane: 'INFO', ok: false, error: "The Google Calendar API isn't turned on for Browsie's Google Cloud project. Enable it…" })]);
    await t.run('check my calendar');
    expect(t.said()[0]).toMatchObject({ text: expect.stringContaining("Google Calendar isn't switched on") });
  });

  it('names a missing key instead of a vague error', async () => {
    const t = setup([]);
    t.deps.llm = vi.fn(async () => {
      throw new Error('No OpenRouter key is set up for this account.');
    });
    await t.run('hello');
    expect(t.said()).toEqual([{ type: 'say', clip: 'no_key' }]);
    expect(t.session.recent(1)[0].fallback).toBe('no_key');
    expect(t.events.at(-1)).toEqual({ type: 'done', ok: false });
  });
});
