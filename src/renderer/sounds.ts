import clickHeavy from './assets/sounds/clickheavy.wav?inline';
import clickLight from './assets/sounds/clicklight.wav?inline';
import startupSound from './assets/sounds/browsiestartupsound.wav?inline';
import dictationStart from './assets/sounds/dictationstart.mp3?inline';
import dictationEnd from './assets/sounds/dictationend.mp3?inline';
import thinkingSound from './assets/sounds/browsiethinking.mp3?inline';

// One long-lived context with pre-decoded buffers. <audio> elements let the output device go idle,
// so the first click after a pause lagged while it woke back up. A running context keeps it open.
const context = new AudioContext({ latencyHint: 'interactive' });

// Shared with the speech pill's mic meter, so the page only ever has one output stream.
export const soundContext = context;

// Builds inline them as data: URLs (fetch can't load file://, and the CSP blocks fetching data:).
// The dev server ignores ?inline and hands back a normal same-origin URL, so fetch that.
const loadBytes = async (src: string) => {
  if (src.startsWith('data:')) {
    return Uint8Array.from(atob(src.split(',')[1]), (char) => char.charCodeAt(0)).buffer;
  }

  return (await fetch(src)).arrayBuffer();
};

// A sound that fails to load just stays silent; it must never take the page down with it.
const decode = (src: string) =>
  loadBytes(src)
    .then((bytes) => context.decodeAudioData(bytes))
    .catch(() => null);

const CLICK_SOUNDS = {
  light: decode(clickLight),
  heavy: decode(clickHeavy),
};

export type ClickSound = keyof typeof CLICK_SOUNDS;

// Played as the browser's splash lifts.
const STARTUP_SOUND = decode(startupSound);

// Resolves once the startup sound is decoded (or known to be missing), so the splash can wait for it.
export const startupSoundLoaded = STARTUP_SOUND.then(() => undefined);

// The context starts suspended in windows without autoplay permission; any user gesture can resume it.
const wake = () => {
  if (context.state !== 'running') {
    void context.resume();
  }
};

// Chromium parks the real audio output after a stretch of pure silence (and some devices, like
// Bluetooth headphones, sleep on their own), so the next click lagged while it woke back up.
// A constant -80 dB signal is inaudible but never counts as silence. Only while focused, so
// Browsie doesn't hold the audio device awake in the background.
const KEEP_ALIVE_LEVEL = 1e-4;
let keepAlive: ConstantSourceNode | null = null;

const startKeepAlive = () => {
  if (keepAlive) {
    return;
  }

  keepAlive = context.createConstantSource();
  keepAlive.offset.value = KEEP_ALIVE_LEVEL;
  keepAlive.connect(context.destination);
  keepAlive.start();
};

const stopKeepAlive = () => {
  keepAlive?.stop();
  keepAlive?.disconnect();
  keepAlive = null;
};

// Full volume unless a gain is given, so it's as loud as the system volume allows.
// Starts only once the context is running: a sound started while it's still waking up came out
// garbled.
const play = (sound: Promise<AudioBuffer | null>, gain = 1) => {
  wake();
  void Promise.all([sound, context.resume().catch(() => undefined)]).then(([buffer]) => {
    if (!buffer) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    if (gain >= 1) {
      source.connect(context.destination);
    } else {
      const level = context.createGain();
      level.gain.value = gain;
      source.connect(level).connect(context.destination);
    }

    source.start();
  });
};

export const playClick = (kind: ClickSound = 'light') => play(CLICK_SOUNDS[kind]);

export const playStartupSound = () => play(STARTUP_SOUND);

// Push-to-talk cues: start when space goes down, end when it's let go.
const DICTATION_SOUNDS = {
  start: decode(dictationStart),
  end: decode(dictationEnd),
};

// How loud the cues come out, in dB below the file's own level, with the device at full volume.
const DICTATION_DB_AT_FULL = -26;

// Constant loudness: the cue is turned up by exactly as many dB as the device's volume turns it
// down, so it sounds the same at any device volume. It can't go above the file's own level without
// clipping, so once the device is turned down more than 26 dB (around 15-20% on the Windows slider,
// depending on the device) it stops keeping up.
export const dictationGain = (deviceVolumeDb: number) =>
  Math.min(1, Math.pow(10, (DICTATION_DB_AT_FULL - Math.min(0, deviceVolumeDb)) / 20));

export const playDictationSound = (kind: keyof typeof DICTATION_SOUNDS, deviceVolumeDb: number) =>
  play(DICTATION_SOUNDS[kind], dictationGain(deviceVolumeDb));

const THINKING_SOUND = decode(thinkingSound);
// This source is quieter than the dictation clips, so normalize it before applying the same
// device-volume compensation. Never exceed the file's normal full level.
const THINKING_LEVEL = 20;
const THINKING_GAP_MS = 500;
let thinkingGen = 0;
let thinking: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let thinkingTimer: ReturnType<typeof setTimeout> | null = null;

export const startThinkingLoop = (deviceVolumeDb: number, onPlay?: () => void) => {
  if (thinking) {
    return;
  }

  const gen = ++thinkingGen;
  wake();
  void Promise.all([THINKING_SOUND, context.resume().catch(() => undefined)]).then(([buffer]) => {
    if (gen !== thinkingGen || !buffer || thinking) {
      return;
    }

    const level = context.createGain();
    level.gain.value = Math.min(1, THINKING_LEVEL * dictationGain(deviceVolumeDb));
    level.connect(context.destination);

    const playNext = () => {
      if (gen !== thinkingGen || !thinking) {
        return;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(level);
      source.onended = () => {
        source.disconnect();
        if (gen === thinkingGen && thinking) {
          thinkingTimer = setTimeout(() => {
            thinkingTimer = null;
            playNext();
          }, THINKING_GAP_MS);
        }
      };
      thinking = { source, gain: level };
      source.start();
      onPlay?.();
    };

    thinking = { source: context.createBufferSource(), gain: level };
    playNext();
  });
};

export const stopThinkingLoop = () => {
  thinkingGen += 1;
  if (thinkingTimer) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
  thinking?.source.stop();
  thinking?.source.disconnect();
  thinking?.gain.disconnect();
  thinking = null;
};

// Keeps the output awake while the speech pill is up, and long enough after release for the end cue
// to finish, so the cues never land on an output that's waking from sleep.
const AWAKE_AFTER_RELEASE_MS = 3000;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export const holdAudioAwake = (awake: boolean) => {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  if (awake) {
    startKeepAlive();
    return;
  }

  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    stopKeepAlive();
  }, AWAKE_AFTER_RELEASE_MS);
};

const CLICKABLE = 'button, a[href], [role="button"], [role="link"]';

// Every button/link clicks: light by default, heavy when marked with data-click-sound="heavy".
export const installClickSounds = () => {
  // Resume on press, a beat before the click lands.
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);

  window.addEventListener('focus', startKeepAlive);
  window.addEventListener('blur', stopKeepAlive);
  if (document.hasFocus()) {
    startKeepAlive();
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(CLICKABLE);

      if (!target || target.matches(':disabled, [aria-disabled="true"]')) {
        return;
      }

      playClick(target.dataset.clickSound === 'heavy' ? 'heavy' : 'light');
    },
    true,
  );
};
