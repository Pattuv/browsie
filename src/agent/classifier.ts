import { z } from 'zod';
import type { ChatMessage, LlmResponse, Tier } from '../shared/agent/llm';
import { TURN_LABELS, type TurnContext, type TurnLabel } from '../shared/agent/protocol';
import { extractJson } from '../shared/agent/tasks';
import SYSTEM_PROMPT from './prompts/classifier.md?raw';
import { renderHistory, type TurnRecord } from './sessionStore';

// Haiku, tool-free: which lane a transcript goes to. Anything it isn't sure of is UNCLEAR, which asks the
// user to say it again rather than guessing.

export type Llm = (request: { tier: Tier; messages: ChatMessage[]; maxTokens?: number }) => Promise<LlmResponse>;

export type Classification = { label: TurnLabel; confidence: number; multi: boolean };

export const MIN_CONFIDENCE = 0.6;
// With a website open, a page task is the likely meaning, so WEB needs less certainty.
export const MIN_WEB_CONFIDENCE_ON_SITE = 0.35;
const HISTORY_TURNS = 3;

const Output = z.object({
  label: z.enum(TURN_LABELS),
  confidence: z.number().min(0).max(1),
  multi: z.boolean().optional(),
});

export const parseClassification = (text: string, siteOpen = false): Classification => {
  const parsed = Output.safeParse(extractJson(text));
  if (!parsed.success) return { label: 'UNCLEAR', confidence: 0, multi: false };
  const { label, confidence, multi = false } = parsed.data;
  const needed = label === 'WEB' && siteOpen ? MIN_WEB_CONFIDENCE_ON_SITE : MIN_CONFIDENCE;
  return confidence < needed ? { label: 'UNCLEAR', confidence, multi: false } : { label, confidence, multi };
};

const describeContext = (context: TurnContext) =>
  context.site ? `The current tab shows a website: ${context.site}.` : 'No website is open in the current tab.';

export const classify = async (llm: Llm, transcript: string, context: TurnContext, history: readonly TurnRecord[]) => {
  const recent = history.slice(-HISTORY_TURNS);
  const reply = await llm({
    tier: 'fast',
    // Haiku thinks before answering, and the thinking counts against this. 100 left nothing for the answer.
    maxTokens: 2_000,
    messages: [
      { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] },
      {
        role: 'user',
        content: [
          describeContext(context),
          recent.length ? `Earlier in this conversation:\n${renderHistory(recent)}` : '',
          `They just said: ${JSON.stringify(transcript)}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });
  return parseClassification(reply.content, Boolean(context.site));
};
