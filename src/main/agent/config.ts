import type { Tier } from '../../shared/agent/llm';

// Which model each agent tier uses, and what it costs. One OpenRouter key pays for all of them, so all
// spend shows on the usage card. Change models here and nowhere else.

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter ids. Check them against openrouter.ai/models when a model changes.
export const MODELS: Record<Tier, string> = {
  // Classifier and other quick, tool-free calls.
  fast: 'anthropic/claude-haiku-5.5',
  // Orchestrator and the WEB/UI lanes.
  main: 'anthropic/claude-sonnet-5.5',
  // The WEB loop after it fails twice in a row.
  escalate: 'anthropic/claude-opus-5.5',
};

// US dollars per million tokens. Only used when OpenRouter doesn't report the cost itself.
export const PRICES: Record<Tier, { input: number; output: number }> = {
  fast: { input: 0.1, output: 0.5 },
  main: { input: 2, output: 10 },
  escalate: { input: 4, output: 20 },
};

// Most one WEB task may spend before it's stopped.
export const TASK_SPEND_CAP_USD = 0.75;

// A model call slower than this is given up on. OpenRouter's usual 8s timeout is far too short for an agent step.
export const LLM_TIMEOUT_MS = 90_000;

// Speech, through OpenRouter's audio endpoints with the same key.
export const OPENROUTER_TRANSCRIBE_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
export const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
export const TRANSCRIBE_MODEL = 'elevenlabs/scribe-v2';
export const TTS_MODEL = 'elevenlabs/eleven-v4-turbo';
// ElevenLabs' premade voice "Eric", by voice id (OpenRouter only knows a few premade voices by name).
// Check it against the ElevenLabs voice library if the voice ever sounds wrong.
export const TTS_VOICE = 'cjVigY5qzO86Huf0OWal';
export const AUDIO_TIMEOUT_MS = 30_000;
