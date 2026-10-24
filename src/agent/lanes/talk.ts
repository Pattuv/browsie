import type { Llm } from '../classifier';
import CHAT_TEXT from '../prompts/chat.md?raw';
import HELP_TEXT from '../prompts/help.md?raw';
import SAFETY from '../prompts/safety.md?raw';

const CHAT_PROMPT = `${CHAT_TEXT}
${SAFETY}`;
const HELP_PROMPT = `${HELP_TEXT}
${SAFETY}`;
import { renderHistory, type TurnRecord } from '../sessionStore';

// chat and help lanes: very light and tool-free so it can quickly answer user's questions.

const HISTORY_TURNS = 6;

const ask = async (llm: Llm, prompt: string, tier: 'fast' | 'main', transcript: string, history: readonly TurnRecord[]) => {
  const recent = history.slice(-HISTORY_TURNS);
  const reply = await llm({
    tier,
    // // this includes thinking as well, only billed for what's used. (not much for these)
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
