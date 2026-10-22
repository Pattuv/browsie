import type { Llm } from '../classifier';
import CHAT_PROMPT from '../prompts/chat.md?raw';
import HELP_PROMPT from '../prompts/help.md?raw';
import { renderHistory, type TurnRecord } from '../sessionStore';

// The CHAT and HELP lanes: one tool-free call each, answered aloud. HELP's prompt holds the Help Center
// facts and is cached.

const HISTORY_TURNS = 6;

const ask = async (llm: Llm, prompt: string, tier: 'fast' | 'main', transcript: string, history: readonly TurnRecord[]) => {
  const recent = history.slice(-HISTORY_TURNS);
  const reply = await llm({
    tier,
    // Room for thinking as well as the short spoken answer.
    maxTokens: 3_000,
    messages: [
      { role: 'system', content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }] },
      {
        role: 'user',
        content: [recent.length ? `Earlier in this conversation:\n${renderHistory(recent)}` : '', `They said: ${JSON.stringify(transcript)}`]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });
  return reply.content.trim();
};

export const chat = (llm: Llm, transcript: string, history: readonly TurnRecord[]) => ask(llm, CHAT_PROMPT, 'main', transcript, history);

export const help = (llm: Llm, transcript: string, history: readonly TurnRecord[]) => ask(llm, HELP_PROMPT, 'fast', transcript, history);
