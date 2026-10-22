import { LlmRequest, type LlmResponse, type LlmUsage, type Tier } from '../../shared/agent/llm';
import { LLM_TIMEOUT_MS, MODELS, OPENROUTER_CHAT_URL, PRICES } from './config';

// The only way the agent reaches a model. The agent process has no key: it sends the request here, main
// checks it, picks the model for the tier, adds the account's OpenRouter key, and keeps count of what each
// task has spent.
//
// No Electron imports: the key comes in through `getKey`, so tests can drive this with a fake fetch.

export type BrokerErrorCode = 'no-key' | 'invalid-key' | 'out-of-credits' | 'rate-limited' | 'offline' | 'bad-response' | 'aborted';

export class BrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type BrokerDeps = {
  getKey: () => string | null;
  // Only the eval harness changes this, to a fake model on the mock server.
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
};

type OpenRouterResponse = {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const usageOf = (tier: Tier, body: OpenRouterResponse): LlmUsage => {
  const inputTokens = number(body.usage?.prompt_tokens);
  const outputTokens = number(body.usage?.completion_tokens);
  const reported = body.usage?.cost;
  const costUsd =
    typeof reported === 'number' && Number.isFinite(reported)
      ? reported
      : (inputTokens * PRICES[tier].input + outputTokens * PRICES[tier].output) / 1_000_000;
  return { inputTokens, outputTokens, costUsd };
};

export const createBroker = ({ getKey, url = OPENROUTER_CHAT_URL, fetchImpl = fetch, timeoutMs = LLM_TIMEOUT_MS, retryDelayMs = 2_000 }: BrokerDeps) => {
  const spent = new Map<string, number>();

  const send = async (key: string, body: unknown, signal: AbortSignal) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Browsie',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    return response;
  };

  const complete = async (raw: unknown, signal: AbortSignal): Promise<LlmResponse> => {
    const request = LlmRequest.parse(raw);
    const key = getKey();
    if (!key) throw new BrokerError('no-key', 'No OpenRouter key is set up for this account.');

    const body = {
      model: MODELS[request.tier],
      messages: request.messages,
      tools: request.tools,
      // Forced tool use is rejected by the newest Claude models: the prompt asks for the tool instead.
      tool_choice: request.tools ? 'auto' : undefined,
      max_tokens: request.maxTokens ?? 4_000,
      // Ask OpenRouter to report the real cost of the call.
      usage: { include: true },
    };

    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await send(key, body, signal);
      } catch (error) {
        if (signal.aborted) throw new BrokerError('aborted', 'Stopped.');
        if (attempt === 1) throw new BrokerError('offline', error instanceof Error ? error.message : 'Network error.');
        continue;
      }
      // Rate limits and server hiccups get one more try.
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        if (signal.aborted) throw new BrokerError('aborted', 'Stopped.');
        continue;
      }
      break;
    }

    if (!response) throw new BrokerError('offline', 'No response.');
    if (response.status === 401 || response.status === 403) throw new BrokerError('invalid-key', 'OpenRouter refused the key.');
    if (response.status === 402) throw new BrokerError('out-of-credits', 'The OpenRouter key is out of credit or over its limit.');
    if (response.status === 429) throw new BrokerError('rate-limited', 'OpenRouter is rate limiting this key.');
    if (!response.ok) throw new BrokerError('offline', `OpenRouter answered ${response.status}.`);

    const json = (await response.json().catch(() => null)) as OpenRouterResponse | null;
    const choice = json?.choices?.[0];
    if (!json || !choice?.message) throw new BrokerError('bad-response', 'OpenRouter sent an answer with no message.');

    const usage = usageOf(request.tier, json);
    spent.set(request.taskId, (spent.get(request.taskId) ?? 0) + usage.costUsd);

    return {
      model: json.model ?? MODELS[request.tier],
      content: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function?.name ?? '',
        arguments: call.function?.arguments ?? '',
      })),
      finishReason: choice.finish_reason ?? '',
      usage,
    };
  };

  return {
    complete,
    spentFor: (taskId: string) => spent.get(taskId) ?? 0,
    forget: (taskId: string) => spent.delete(taskId),
  };
};

export type Broker = ReturnType<typeof createBroker>;
