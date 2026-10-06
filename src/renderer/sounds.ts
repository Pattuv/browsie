import clickHeavy from './assets/sounds/clickheavy.wav';
import clickLight from './assets/sounds/clicklight.wav';

const preload = (src: string) => {
  const audio = new Audio(src);
  audio.preload = 'auto';
  return audio;
};

const CLICK_SOUNDS = {
  light: preload(clickLight),
  heavy: preload(clickHeavy),
};

export type ClickSound = keyof typeof CLICK_SOUNDS;

// Clone per play so rapid clicks overlap instead of cutting each other off.
export const playClick = (kind: ClickSound = 'light') => {
  const audio = CLICK_SOUNDS[kind].cloneNode() as HTMLAudioElement;
  audio.volume = 1;
  void audio.play().catch(() => undefined);
};

const CLICKABLE = 'button, a[href], [role="button"], [role="link"]';

// Every button/link clicks: light by default, heavy when marked with data-click-sound="heavy".
export const installClickSounds = () => {
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
