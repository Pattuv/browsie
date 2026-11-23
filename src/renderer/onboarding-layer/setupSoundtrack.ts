import setupSoundtrackUrl from '../assets/setupsoundtrack.mp3';

const FADE_MS = 2000;
const FADE_STEPS = 40;

type Track = {
  audio: HTMLAudioElement;
  fadeTimer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  fading: boolean;
};

// On globalThis so a hot reload still sees the element that's actually playing.
const slot: { track: Track | null } = ((globalThis as typeof globalThis & {
  __browsieSetupSoundtrack?: { track: Track | null };
}).__browsieSetupSoundtrack ??= { track: null });

const clearTimers = (item: Track) => {
  if (item.fadeTimer !== null) {
    clearInterval(item.fadeTimer);
    item.fadeTimer = null;
  }

  if (item.stopTimer !== null) {
    clearTimeout(item.stopTimer);
    item.stopTimer = null;
  }
};

const silence = (item: Track) => {
  clearTimers(item);
  const { audio } = item;
  audio.loop = false;
  audio.volume = 0;

  try {
    audio.pause();
    audio.src = '';
  } catch {
    // Element may already be torn down.
  }

  if (slot.track === item) {
    slot.track = null;
  }
};

export const getSetupSoundtrack = () => slot.track?.audio ?? null;

export const playSetupSoundtrack = () => {
  if (slot.track) {
    silence(slot.track);
  }

  const audio = new Audio(setupSoundtrackUrl);
  audio.loop = true;
  audio.volume = 1;
  const item: Track = { audio, fadeTimer: null, stopTimer: null, fading: false };
  slot.track = item;
  void audio.play();
  return audio;
};

/** Ease volume down, then force-stop so a failed volume assign can't leave it looping. */
export const fadeOutSetupSoundtrack = (durationMs = FADE_MS) => {
  const item = slot.track;

  if (!item || item.fading) {
    return;
  }

  item.fading = true;

  if (item.audio.muted || item.audio.paused) {
    silence(item);
    return;
  }

  const startVolume = item.audio.volume;
  const stepMs = durationMs / FADE_STEPS;
  let step = 0;

  item.fadeTimer = setInterval(() => {
    step += 1;
    const t = Math.min(1, step / FADE_STEPS);
    const eased = 1 - (1 - t) ** 2;

    try {
      item.audio.volume = startVolume * (1 - eased);
    } catch {
      silence(item);
      return;
    }

    if (t >= 1) {
      silence(item);
    }
  }, stepMs);

  // Always stop, even if the interval is throttled or a later call would have cleared it.
  item.stopTimer = setTimeout(() => silence(item), durationMs + 150);
};
