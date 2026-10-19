import setupSoundtrackUrl from '../assets/setupsoundtrack.mp3';

const FADE_MS = 2000;
const FADE_STEPS = 40;

let current: HTMLAudioElement | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let hardStopTimer: ReturnType<typeof setTimeout> | null = null;

const clearFadeTimers = () => {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }

  if (hardStopTimer !== null) {
    clearTimeout(hardStopTimer);
    hardStopTimer = null;
  }
};

const hardStop = (audio: HTMLAudioElement) => {
  clearFadeTimers();

  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch {
    // Element may already be torn down.
  }

  if (current === audio) {
    current = null;
  }
};

export const getSetupSoundtrack = () => current;

export const playSetupSoundtrack = () => {
  // Drop any leftover instance from a previous Auth visit / Strict Mode remount.
  if (current) {
    hardStop(current);
  }

  const audio = new Audio(setupSoundtrackUrl);
  audio.loop = true;
  current = audio;
  void audio.play();
  return audio;
};

/** Ease volume down, then force-stop so a failed volume assign can't leave it looping. */
export const fadeOutSetupSoundtrack = (durationMs = FADE_MS) => {
  const audio = current;

  if (!audio) {
    return;
  }

  // Detach first so Auth remounts / a second fade call don't touch this element.
  current = null;
  clearFadeTimers();

  if (audio.muted || audio.paused) {
    hardStop(audio);
    return;
  }

  const startVolume = audio.volume;
  const stepMs = durationMs / FADE_STEPS;
  let step = 0;

  fadeTimer = setInterval(() => {
    step += 1;
    const t = Math.min(1, step / FADE_STEPS);
    const eased = 1 - (1 - t) ** 2;

    try {
      audio.volume = startVolume * (1 - eased);
    } catch {
      hardStop(audio);
      return;
    }

    if (t >= 1) {
      hardStop(audio);
    }
  }, stepMs);

  // Belt and suspenders: always stop even if the interval is throttled or volume throws.
  hardStopTimer = setTimeout(() => hardStop(audio), durationMs + 150);
};
