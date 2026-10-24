import { describe, expect, it, vi } from 'vitest';
import type { LlmResponse } from '../../shared/agent/llm';
import type { GoogleContext, TaskEventBody } from '../../shared/agent/protocol';
import type { GoogleCallResult } from '../../shared/google/tools';
import { LlmRequest } from '../../shared/agent/llm';
import { INFO_TOOLS, type InfoDeps, runInfoTask } from './lane';

const calls = (...list: [string, unknown][]): LlmResponse => ({
  model: 'test',
  content: '',
  toolCalls: list.map(([name, args], i) => ({ id: `c${Math.random()}${i}`, name, arguments: JSON.stringify(args) })),
  finishReason: 'tool_calls',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});

const context: GoogleContext = {
  email: 'sam@example.com',
  now: 'Friday, October 23, 2026 at 9:00 PM',
  nowIso: '2026-10-24T01:00:00.000Z',
  timeZone: 'America/New_York',
  access: { gmail: true, calendar: true, drive: true },
};

const setup = (replies: LlmResponse[], results: GoogleCallResult[], answers: { text: string; confirmed?: boolean }[] = []) => {
  const events: TaskEventBody[] = [];
  const deps: InfoDeps = {
    llm: vi.fn(async () => replies.shift() ?? calls()),
    context: vi.fn(async () => context),
    call: vi.fn(async (): Promise<GoogleCallResult> => results.shift() ?? { ok: false, error: 'failed', message: 'none scripted' }),
    emit: (event) => events.push(event),
    waitForAnswer: vi.fn(async () => answers.shift() ?? { text: '' }),
    signal: new AbortController().signal,
  };
  const run = (goal: string) => runInfoTask({ taskId: 't1', goal, sources: [{ id: 'u1', text: goal }] }, deps);
  return { deps, events, run };
};

describe('INFO lane', () => {
  it('offers every Google tool plus ask and finish, with JSON schemas', () => {
    const names = INFO_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining(['gmail_search', 'calendar_create', 'drive_read', 'ask_user', 'finish']));
    const create = INFO_TOOLS.find((tool) => tool.function.name === 'calendar_create')!;
    expect(create.function.parameters).toMatchObject({ type: 'object', required: expect.arrayContaining(['title', 'start', 'end']) });
  });

  it('sends a request main accepts (every tool fits the request limits)', async () => {
    const t = setup([calls(['finish', { summary: 'Done.' }])], []);
    await t.run('any new emails?');
    const request = (t.deps.llm as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const checked = LlmRequest.safeParse({ taskId: 't1', ...request });
    expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true);
  });

  it('tells the model who and when the user is', async () => {
    const t = setup([calls(['finish', { summary: 'Nothing today.' }])], []);
    await t.run("what's on my calendar today?");
    const first = (t.deps.llm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { messages: { content: unknown }[] };
    const intro = String(first.messages[1].content);
    expect(intro).toContain('sam@example.com');
    expect(intro).toContain('October 23, 2026');
    expect(intro).toContain('America/New_York');
  });

  it('looks things up, then says the answer', async () => {
    const t = setup(
      [calls(['calendar_list', { start: '2026-10-24', end: '2026-10-24' }]), calls(['finish', { summary: 'Tomorrow you have Bro at 5 PM.' }])],
      [{ ok: true, data: { events: [{ id: 'e1', title: 'Bro', start: '2026-10-24T17:00:00-04:00' }] } }],
    );
    expect(await t.run("what's on my calendar tomorrow?")).toMatchObject({ ok: true, lane: 'INFO', facts: ['Tomorrow you have Bro at 5 PM.'], untrusted: true });
    expect(t.events).toContainEqual({ type: 'step_started', step: 1, phrase: 'Checking your calendar' });
    const second = (t.deps.llm as ReturnType<typeof vi.fn>).mock.calls[1][0] as { messages: { role: string; content: unknown }[] };
    expect(String(second.messages.find((m) => m.role === 'tool')?.content)).toContain('<untrusted_google_data>');
  });

  it('waits for a yes, then makes the same call again', async () => {
    const send = { to: ['mom@example.com'], subject: 'Dinner', body: 'See you at 7.' };
    const t = setup(
      [calls(['gmail_send', send]), calls(['finish', { summary: 'I sent your email to Mom.' }])],
      [{ ok: false, error: 'needs_user', message: 'asking' }, { ok: true, data: { sent: true } }],
      [{ text: 'yes', confirmed: true }],
    );
    expect(await t.run('email mom that I will see her at 7')).toMatchObject({ ok: true });
    expect((t.deps.call as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['gmail_send', send],
      ['gmail_send', send],
    ]);
  });

  it('stops without sending when the user says no', async () => {
    const t = setup(
      [calls(['gmail_send', { to: ['mom@example.com'], body: 'hi' }])],
      [{ ok: false, error: 'needs_user', message: 'asking' }],
      [{ text: 'no', confirmed: false }],
    );
    expect(await t.run('email mom hi')).toMatchObject({ ok: false, error: 'declined' });
    expect(t.deps.call).toHaveBeenCalledTimes(1);
  });

  it('ends with a permission request when Google access is missing', async () => {
    const t = setup([calls(['gmail_search', { query: 'is:unread' }])], [{ ok: false, error: 'needs_access', service: 'gmail', message: 'no access' }]);
    expect(await t.run('any new emails?')).toMatchObject({ ok: false, error: 'needs_google_access' });
  });

  it('runs independent calls from one reply', async () => {
    const t = setup(
      [calls(['gmail_search', {}], ['calendar_list', { start: '2026-10-24', end: '2026-10-24' }]), calls(['finish', { summary: 'Done.' }])],
      [{ ok: true, data: { emails: [] } }, { ok: true, data: { events: [] } }],
    );
    await t.run('anything new in my email, and what do I have tomorrow?');
    expect(t.deps.call).toHaveBeenCalledTimes(2);
  });
});
