import {
  AUDIO_TIMEOUT_MS,
  OPENROUTER_SPEECH_URL,
  OPENROUTER_TRANSCRIBE_URL,
  TRANSCRIBE_MODEL,
  TTS_MODEL,
  TTS_VOICE,
} from '../agent/config';

// Speech to text and text to speech through OpenRouter, with the account's Browsie key (like the broker,
// it's handed a getKey, so tests can use a fake fetch). Both run in main: audio never passes through the
// agent process.

export type SpeechErrorCode = 'no-key' | 'invalid-key' | 'out-of-credits' | 'offline' | 'bad-response';

export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Deps = { getKey: () => string | null; fetchImpl?: typeof fetch };

// Spoken lines are short. Longer ones are cut at a sentence end rather than refused.
const MAX_SPEECH_CHARS = 2_000;
// Recent lines, so "repeat" and the fixed lines cost nothing the second time.
const CACHE_LINES = 40;

const failure = async (response: Response) => {
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  const { status } = response;
  if (status === 401 || status === 403) return new SpeechError('invalid-key', `OpenRouter refused the key (${status}): ${detail}`);
  if (status === 402) return new SpeechError('out-of-credits', `Out of credit (402): ${detail}`);
  return new SpeechError(status >= 500 ? 'offline' : 'bad-response', `OpenRouter answered ${status}: ${detail}`);
};

const trimForSpeech = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_SPEECH_CHARS) return clean;
  const cut = clean.slice(0, MAX_SPEECH_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 0 ? cut.slice(0, end + 1) : cut;
};

export const createSpeechApi = ({ getKey, fetchImpl = fetch }: Deps) => {
  const cache = new Map<string, Uint8Array>();

  const post = async (url: string, body: unknown, signal?: AbortSignal) => {
    const key = getKey();
    if (!key) throw new SpeechError('no-key', 'No OpenRouter key is set up for this account.');
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Browsie' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(AUDIO_TIMEOUT_MS)]) : AbortSignal.timeout(AUDIO_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SpeechError('offline', error instanceof Error ? error.message : 'Network error.');
    }
  };

  // WAV in, text out. Empty text means nothing was said.
  const transcribe = async (wav: Uint8Array, signal?: AbortSignal) => {
    const response = await post(
      OPENROUTER_TRANSCRIBE_URL,
      { model: TRANSCRIBE_MODEL, input_audio: { data: Buffer.from(wav).toString('base64'), format: 'wav' } },
      signal,
    );
    if (!response.ok) throw await failure(response);
    const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (!body || typeof body.text !== 'string') throw new SpeechError('bad-response', 'The transcription had no text.');
    // Scribe tags sounds like "(laughs)" or "[music]". They aren't words.
    return body.text.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // Text in, MP3 bytes out.
  const speak = async (text: string, signal?: AbortSignal) => {
    const input = trimForSpeech(text);
    const cached = cache.get(input);
    if (cached) return cached;

    // Eleven v4 Turbo rejects a speed setting: slower and faster are applied when playing instead.
    const response = await post(OPENROUTER_SPEECH_URL, { model: TTS_MODEL, input, voice: TTS_VOICE, response_format: 'mp3' }, signal);
    if (!response.ok) throw await failure(response);
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new SpeechError('bad-response', 'The speech had no audio.');

    cache.set(input, audio);
    if (cache.size > CACHE_LINES) cache.delete(cache.keys().next().value!);
    return audio;
  };

  return { transcribe, speak };
};

export type SpeechApi = ReturnType<typeof createSpeechApi>;
