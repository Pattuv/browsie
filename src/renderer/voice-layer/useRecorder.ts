import { useEffect } from 'react';
import { recordingToWav } from './wav';

// Records while Space is held and sends the recording to main on release. Lives in the speech view,
// which already has the mic (the pill's bars use it too).

export function useRecorder(live: boolean) {
  useEffect(() => {
    if (!live) return undefined;

    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    const chunks: Blob[] = [];
    const startedAt = performance.now();

    const send = async () => {
      const durationMs = performance.now() - startedAt;
      stream?.getTracks().forEach((track) => track.stop());
      if (chunks.length === 0) return;
      try {
        const wav = await recordingToWav(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
        await window.browsie?.voice.sendAudio(wav, durationMs);
      } catch {
        // Undecodable or refused: nothing to send. Main says nothing for silence anyway.
      }
    };

    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
      .then((next) => {
        stream = next;
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        recorder = new MediaRecorder(next, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => void send();
        recorder.start();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else stream?.getTracks().forEach((track) => track.stop());
    };
  }, [live]);
}
