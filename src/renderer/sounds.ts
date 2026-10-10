import clickHeavy from './assets/sounds/clickheavy.wav?inline';
import clickLight from './assets/sounds/clicklight.wav?inline';
import startupSound from './assets/sounds/browsiestartupsound.wav?inline';

// One long-lived context with pre-decoded buffers. <audio> elements let the output device go idle,
// so the first click after a pause lagged while it woke back up. A running context keeps it open.
const context = new AudioContext({ latencyHint: 'interactive' });

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

// Full volume (no gain node), so it's always as loud as the system volume allows.
const play = (sound: Promise<AudioBuffer | null>) => {
  wake();
  void sound.then((buffer) => {
    if (!buffer) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  });
};

export const playClick = (kind: ClickSound = 'light') => play(CLICK_SOUNDS[kind]);

export const playStartupSound = () => play(STARTUP_SOUND);

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
