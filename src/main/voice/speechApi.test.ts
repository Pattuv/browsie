import { describe, expect, it, vi } from 'vitest';
import { OPENROUTER_SPEECH_URL, OPENROUTER_TRANSCRIBE_URL, TRANSCRIBE_MODEL, TTS_MODEL, TTS_VOICE } from '../agent/config';
import { createSpeechApi } from './speechApi';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('speechApi', () => {
  it('transcribes WAV with Scribe and drops sound tags', async () => {
    const fetchImpl = vi.fn(async () => json({ text: '(clears throat) Open a new tab. [music]' }));
    const api = createSpeechApi({ getKey: () => 'k', fetchImpl });
    expect(await api.transcribe(new Uint8Array([82, 73, 70, 70]))).toBe('Open a new tab.');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_TRANSCRIBE_URL);
    expect(JSON.parse(String(init.body))).toEqual({ model: TRANSCRIBE_MODEL, input_audio: { data: 'UklGRg==', format: 'wav' } });
  });

  it('speaks with Eleven v4 Turbo in Eric’s voice, and caches lines', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 1])));
    const api = createSpeechApi({ getKey: () => 'k', fetchImpl });
    await api.speak('Stopped.');
    await api.speak('Stopped.');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_SPEECH_URL);
    expect(JSON.parse(String(init.body))).toEqual({ model: TTS_MODEL, input: 'Stopped.', voice: TTS_VOICE, response_format: 'mp3' });
  });

  it('names failures', async () => {
    await expect(createSpeechApi({ getKey: () => null }).speak('hi')).rejects.toMatchObject({ code: 'no-key' });
    const refused = createSpeechApi({ getKey: () => 'k', fetchImpl: async () => json({}, 402) });
    await expect(refused.transcribe(new Uint8Array(1))).rejects.toMatchObject({ code: 'out-of-credits' });
    const down = createSpeechApi({
      getKey: () => 'k',
      fetchImpl: async () => {
        throw new Error('fetch failed');
      },
    });
    await expect(down.speak('hi')).rejects.toMatchObject({ code: 'offline' });
  });
});
