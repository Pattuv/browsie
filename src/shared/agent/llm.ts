import { z } from 'zod';

// The shape of a model call, shared by the agent process (which builds it) and main's broker (which checks
// it, adds the key and sends it). OpenRouter's chat format, since one OpenRouter key pays for everything.

// The agent names a tier, never a model: main decides what each tier costs.
export const TIERS = ['fast', 'main', 'escalate'] as const;
export type Tier = (typeof TIERS)[number];

const MAX_TEXT = 200_000;

const CacheControl = z.strictObject({ type: z.literal('ephemeral') });

const TextPart = z.strictObject({
  type: z.literal('text'),
  text: z.string().max(MAX_TEXT),
  cache_control: CacheControl.optional(),
});

// Only screenshots main took itself, as data: URLs.
const ImagePart = z.strictObject({
  type: z.literal('image_url'),
  image_url: z.strictObject({ url: z.string().startsWith('data:image/jpeg;base64,').max(4_000_000) }),
});

const Content = z.union([z.string().max(MAX_TEXT), z.array(z.union([TextPart, ImagePart])).max(20)]);

const ToolCall = z.strictObject({
  id: z.string().max(200),
  type: z.literal('function'),
  function: z.strictObject({ name: z.string().max(64), arguments: z.string().max(MAX_TEXT) }),
});

export const ChatMessage = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('system'), content: Content }),
  z.strictObject({ role: z.literal('user'), content: Content }),
  z.strictObject({ role: z.literal('assistant'), content: z.string().max(MAX_TEXT).nullable(), tool_calls: z.array(ToolCall).max(8).optional() }),
  z.strictObject({ role: z.literal('tool'), tool_call_id: z.string().max(200), content: z.string().max(MAX_TEXT) }),
]);
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ToolDef = z.strictObject({
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().regex(/^[a-z_]{1,64}$/),
    description: z.string().max(4_000),
    parameters: z.record(z.string(), z.unknown()),
  }),
});
export type ToolDef = z.infer<typeof ToolDef>;

export const LlmRequest = z.strictObject({
  taskId: z.string().min(1).max(64),
  tier: z.enum(TIERS),
  messages: z.array(ChatMessage).min(1).max(400),
  // The INFO lane offers every Gmail, Calendar and Drive tool at once.
  tools: z.array(ToolDef).max(32).optional(),
  maxTokens: z.number().int().min(16).max(16_000).optional(),
});
export type LlmRequest = z.infer<typeof LlmRequest>;

export type LlmUsage = { inputTokens: number; outputTokens: number; costUsd: number };

export type LlmResponse = {
  model: string;
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  finishReason: string;
  usage: LlmUsage;
};
