// Recorded speech → 16 kHz mono 16-bit WAV, the format the transcription endpoint takes. The browser
// records Opus in WebM; decoding and resampling here keeps uploads small and the format certain.

const SAMPLE_RATE = 16_000;

export const encodeWav = (samples: Float32Array, sampleRate = SAMPLE_RATE) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return buffer;
};

export const recordingToWav = async (recording: Blob) => {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    // Rendering through an offline context mixes to mono and resamples in one step.
    const offline = new OfflineAudioContext(1, Math.max(frames, 1), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    void decoder.close();
  }
};
