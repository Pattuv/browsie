import { useEffect } from 'react';

// Plays what main says, one item at a time: synthesized speech, the fixed lines (their shipped
// recordings when there are some), or the system voice when synthesis failed. Main stops it when Space
// is pressed. Lives in the speech view, which may play sound without a click and keeps running hidden.

// Shipped recordings of the fixed lines, made by `npm run voice:clips`. Empty until then.
// Builds inline them as data: URLs, which the CSP doesn't allow for media, so they're replayed as blobs.
const CLIPS = import.meta.glob<string>('../assets/voice/*.mp3', { eager: true, query: '?inline', import: 'default' });
const clipBlobs = new Map<string, string>();
const clipUrl = (id: string) => {
  const src = CLIPS[`../assets/voice/${id}.mp3`];
  if (!src?.startsWith('data:')) return src;
  let url = clipBlobs.get(id);
  if (!url) {
    const bytes = Uint8Array.from(atob(src.split(',')[1]), (char) => char.charCodeAt(0));
    url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    clipBlobs.set(id, url);
  }
  return url;
};
const clipIds = Object.keys(CLIPS).map((path) => path.split('/').pop()!.replace(/\.mp3$/, ''));

export function useVoicePlayer() {
  useEffect(() => {
    const voice = window.browsie?.voice;
    if (!voice) return undefined;

    const audio = new Audio();
    // Slower and faster without the voice changing pitch.
    audio.preservesPitch = true;
    // "Louder" goes past the element's own maximum, so volume is a gain node.
    const context = new AudioContext();
    const gain = context.createGain();
    context.createMediaElementSource(audio).connect(gain).connect(context.destination);
    const style = { volume: 1, rate: 1 };
    const log = (message: string) => void voice.log(message);
    const queue: VoicePlayItem[] = [];
    let playing = false;
    let objectUrl: string | null = null;

    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };

    const next = () => {
      release();
      const item = queue.shift();
      if (!item) {
        playing = false;
        return;
      }
      playing = true;

      if (item.kind === 'system') {
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.rate = style.rate;
        utterance.volume = Math.min(1, style.volume);
        utterance.onstart = () => log(`system voice started (${speechSynthesis.getVoices().length} voices)`);
        utterance.onend = next;
        utterance.onerror = (event) => {
          log(`system voice FAILED: ${event.error}`);
          next();
        };
        speechSynthesis.speak(utterance);
        return;
      }

      const shipped = item.kind === 'clip' ? clipUrl(item.id) : undefined;
      if (!shipped && !item.data) {
        log(`nothing to play for ${item.kind}`);
        next();
        return;
      }
      if (shipped) {
        audio.src = shipped;
      } else {
        objectUrl = URL.createObjectURL(new Blob([item.data as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }));
        audio.src = objectUrl;
      }
      audio.playbackRate = style.rate;
      gain.gain.value = style.volume;
      void context.resume();
      audio
        .play()
        .then(() => log(`playing ${item.kind}${shipped ? ' recording' : ` ${item.data?.byteLength ?? 0} bytes`}, audio context ${context.state}`))
        .catch((error) => {
          log(`play FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
          next();
        });
    };

    audio.onended = () => {
      log('finished');
      next();
    };
    audio.onerror = () => {
      log(`audio error ${audio.error?.code ?? '?'}: ${audio.error?.message ?? ''}`);
      next();
    };

    const stopAll = () => {
      queue.length = 0;
      audio.pause();
      audio.removeAttribute('src');
      speechSynthesis.cancel();
      release();
      playing = false;
    };

    const offPlay = voice.onPlay((item) => {
      // A step phrase that would only start after the step is over isn't worth saying.
      if (item.kind === 'mp3' && item.droppable && (playing || queue.length > 0)) {
        log('dropped a narration line (still speaking)');
        return;
      }
      queue.push(item);
      if (!playing) next();
    });
    const offStop = voice.onStop(stopAll);
    const offStyle = voice.onStyle((next) => {
      style.volume = next.volume;
      style.rate = next.rate;
      audio.playbackRate = next.rate;
      gain.gain.value = next.volume;
    });
    void voice.reportClips(clipIds);

    return () => {
      offPlay();
      offStop();
      offStyle();
      stopAll();
      void context.close();
    };
  }, []);
}
