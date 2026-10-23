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

    let sent = false;
    // Always answers main, even with nothing recorded (a quick tap), so the pill is released at once.
    const send = async () => {
      if (sent) return;
      sent = true;
      const durationMs = performance.now() - startedAt;
      stream?.getTracks().forEach((track) => track.stop());
      let wav = new ArrayBuffer(0);
      try {
        if (chunks.length) wav = await recordingToWav(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
      } catch {
        // Undecodable: send nothing, which main treats as silence.
      }
      await window.browsie?.voice.sendAudio(wav, durationMs).catch(() => undefined);
    };

    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
      .then((next) => {
        stream = next;
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          void send();
          return;
        }
        recorder = new MediaRecorder(next, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => void send();
        recorder.start();
      })
      // No mic: still tell main the press is over.
      .catch(() => void send());

    return () => {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else stream?.getTracks().forEach((track) => track.stop());
    };
  }, [live]);
}
