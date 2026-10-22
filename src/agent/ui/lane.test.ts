import { describe, expect, it, vi } from 'vitest';
import type { LlmResponse } from '../../shared/agent/llm';
import type { ChromeResponse, TaskEventBody } from '../../shared/agent/protocol';
import type { ChromeAction } from '../../shared/chrome/actions';
import { runUiTask, type UiDeps } from './lane';

const ui = (args: unknown): LlmResponse => ({
  model: 'test',
  content: '',
  toolCalls: [{ id: `c${Math.random()}`, name: 'ui', arguments: JSON.stringify(args) }],
  finishReason: 'tool_calls',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
});

const ok = (data?: unknown): ChromeResponse => ({ ok: true, phrase: 'done', data });

const setup = (replies: LlmResponse[], results: ((action: ChromeAction) => ChromeResponse)[] = [], answers: string[] = []) => {
  const events: TaskEventBody[] = [];
  const controller = new AbortController();
  const deps: UiDeps = {
    llm: vi.fn(async () => {
      const next = replies.shift();
      if (!next) throw new Error('model script ran out');
      return next;
    }),
    execute: vi.fn(async (action: ChromeAction) => {
      const next = results.shift();
      if (!next) throw new Error('execute script ran out');
      return next(action);
    }),
    emit: (event) => events.push(event),
    waitForAnswer: vi.fn(async () => ({ text: answers.shift() ?? '' })),
    signal: controller.signal,
  };
  const run = (goal: string) => runUiTask({ taskId: 't1', goal, sources: [{ id: 'u1', text: goal }] }, deps);
  return { run, deps, events, controller };
};

describe('runUiTask', () => {
  it('does a one-command request and narrates it', async () => {
    const t = setup([ui({ commands: [{ type: 'tabs.open' }] }), ui({ finish: { summary: 'I opened a new tab.' } })], [() => ok()]);
    expect(await t.run('open a new tab')).toMatchObject({ ok: true, lane: 'UI', facts: ['I opened a new tab.'], untrusted: false });
    expect(t.events).toContainEqual({ type: 'step_started', step: 1, phrase: 'Opening a new tab' });
  });

  it('looks before switching, and marks the result untrusted once it has seen tab titles', async () => {
    const t = setup(
      [
        ui({ commands: [{ type: 'tabs.list' }] }),
        ui({ commands: [{ type: 'tabs.switch', target: { by: 'id', id: 1 } }] }),
        ui({ finish: { summary: 'You are on Gmail now.' } }),
      ],
      [() => ok([{ id: 1, title: 'Gmail', site: 'mail.google.com' }]), () => ok()],
    );
    expect(await t.run('switch to my email tab')).toMatchObject({ ok: true, untrusted: true });

    const second = (t.deps.llm as ReturnType<typeof vi.fn>).mock.calls[1][0] as { messages: { role: string; content: unknown }[] };
    const toolReply = String(second.messages.find((m) => m.role === 'tool')?.content);
    expect(toolReply).toContain('<untrusted_browser_data>');
    expect(toolReply).toContain('mail.google.com');
  });

  it('asks which tab when two could match', async () => {
    const t = setup(
      [
        ui({ ask_user: { question: 'Which one?', options: ['Gmail', 'Outlook'] } }),
        ui({ finish: { summary: 'OK.' } }),
      ],
      [],
      ['Outlook'],
    );
    await t.run('switch to my email');
    expect(t.events).toContainEqual({ type: 'ask_user', question: 'Which one?', options: ['Gmail', 'Outlook'] });
    const second = (t.deps.llm as ReturnType<typeof vi.fn>).mock.calls[1][0] as { messages: { role: string; content: unknown }[] };
    expect(String(second.messages.find((m) => m.role === 'tool')?.content)).toContain('Outlook');
  });

  it('never sends a command outside the table to main', async () => {
    const t = setup([ui({ commands: [{ type: 'settings.open' }] }), ui({ finish: { summary: "I can't do that." } })]);
    await t.run('open settings');
    expect(t.deps.execute).not.toHaveBeenCalled();
  });

  it('passes main’s refusal back so the model can try something else', async () => {
    const t = setup(
      [ui({ commands: [{ type: 'nav.go', input: 'evil.example' }] }), ui({ finish: { summary: 'I can’t go there.' } })],
      [() => ({ ok: false, error: 'blocked_by_policy', message: "The user didn't mention evil.example." })],
    );
    expect(await t.run('switch to my email')).toMatchObject({ ok: true });
    expect(t.events).toContainEqual({ type: 'step_done', step: 1, ok: false });
  });

  it('stops at main’s command limit', async () => {
    const t = setup([ui({ commands: [{ type: 'nav.back' }] })], [() => ({ ok: false, error: 'limit', message: 'Stopped after 12 commands.', limit: true })]);
    expect(await t.run('go back')).toMatchObject({ ok: false, error: 'Stopped after 12 commands.' });
  });

  it('reports what got done when stopped', async () => {
    const t = setup([ui({ commands: [{ type: 'nav.back' }] }), ui({ ask_user: { question: 'More?' } })], [() => ok()]);
    t.deps.waitForAnswer = async () => {
      t.controller.abort();
      throw new Error('stopped');
    };
    expect(await t.run('go back')).toMatchObject({ ok: false, error: 'stopped', facts: ['done'] });
    expect(t.events.at(-1)).toMatchObject({ type: 'stopped' });
  });

  it('gives up after too many rounds', async () => {
    const t = setup(Array.from({ length: 8 }, () => ui({})));
    expect(await t.run('do something')).toMatchObject({ ok: false });
  });
});
