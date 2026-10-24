import { describe, expect, it, vi } from 'vitest';
import { BrokerError, createBroker, usageOf } from './broker';
import { MODELS } from './config';

const request = { taskId: 't1', tier: 'main' as const, messages: [{ role: 'user' as const, content: 'hi' }] };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ok = {
  model: 'anthropic/claude-sonnet-5.5',
  choices: [
    {
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'act', arguments: '{"actions":[]}' } }] },
    },
  ],
  usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.003 },
};

const signal = () => new AbortController().signal;

describe('broker', () => {
  it('adds the key, picks the model for the tier and never forces a tool', async () => {
    const fetchImpl = vi.fn(async () => reply(ok));
    const broker = createBroker({ getKey: () => 'sk-or-test', fetchImpl });
    await broker.complete({ ...request, tools: [{ type: 'function', function: { name: 'act', description: 'x', parameters: {} } }] }, signal());

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    expect(body.model).toBe(MODELS.main);
    expect(body.tool_choice).toBe('auto');
    expect(body.usage).toEqual({ include: true });
  });

  it('returns tool calls and keeps count of what each task spent', async () => {
    const broker = createBroker({ getKey: () => 'k', fetchImpl: async () => reply(ok) });
    const response = await broker.complete(request, signal());
    await broker.complete(request, signal());

    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'act', arguments: '{"actions":[]}' }]);
    expect(broker.spentFor('t1')).toBeCloseTo(0.006);
    expect(broker.spentFor('other')).toBe(0);
  });

  it('refuses a model the agent names itself', async () => {
    const broker = createBroker({ getKey: () => 'k', fetchImpl: async () => reply(ok) });
    await expect(broker.complete({ ...request, model: 'openai/gpt-x' }, signal())).rejects.toThrow();
    await expect(broker.complete({ ...request, tier: 'premium' }, signal())).rejects.toThrow();
  });

  it('needs a key', async () => {
    const broker = createBroker({ getKey: () => null, fetchImpl: async () => reply(ok) });
    await expect(broker.complete(request, signal())).rejects.toMatchObject({ code: 'no-key' });
  });

  it('names the failure', async () => {
    const codes: [number, string][] = [
      [401, 'invalid-key'],
      [402, 'out-of-credits'],
      [400, 'offline'],
    ];
    for (const [status, code] of codes) {
      const broker = createBroker({ getKey: () => 'k', fetchImpl: async () => reply({}, status), retryDelayMs: 0 });
      await expect(broker.complete(request, signal())).rejects.toMatchObject({ code });
    }
  });

  it('retries a rate limit once', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({}, 429)).mockResolvedValueOnce(reply(ok));
    const broker = createBroker({ getKey: () => 'k', fetchImpl, retryDelayMs: 0 });
    await expect(broker.complete(request, signal())).resolves.toMatchObject({ finishReason: 'tool_calls' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops when the task is stopped', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const broker = createBroker({ getKey: () => 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const pending = broker.complete(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BrokerError);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('estimates cost when OpenRouter does not report it', () => {
    expect(usageOf('main', { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }).costUsd).toBe(2);
    expect(usageOf('fast', { usage: { prompt_tokens: 0, completion_tokens: 1_000_000 } }).costUsd).toBe(0.5);
  });
});
