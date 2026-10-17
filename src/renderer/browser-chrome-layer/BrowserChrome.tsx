import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import SplashScreen from './SplashScreen';
import TabStrip from './TabStrip';
import Toolbar from './Toolbar';
import NewTab from './pages/NewTab';
import { playStartupSound, startupSoundLoaded } from '../sounds';
import { browserStateLoaded, useActiveTab, usePageSnapshot } from '../stores/browserStore';
import mascot from '../assets/mascot.svg';

// The splash stays up at least this long, even if everything loads instantly.
const MIN_SPLASH_MS = 5000;
// The chrome's frame scaling and blurring in (matches .chrome-materialize).
const CHROME_IN_MS = 1000;
// The sound starts a beat before the glass begins to clear, so they land together.
const SOUND_LEAD_MS = 120;
// The glass clearing (matches the .splash-leaving animations).
const SPLASH_EXIT_MS = 900;
// Entrance timing (ms after the glass starts clearing).
const STRIP_DELAY = 120;
const TOOLBAR_DELAY = 420;
const LAUNCH_PAGE_DELAY = 520;

// splash (glass over the blurred wallpaper, no chrome) → loaded (the chrome's empty frame scales and
// blurs in behind the glass) → reveal (sound, glass clearing, contents fading in)
// → ready (safe to measure the page area for websites).
type Phase = 'splash' | 'loaded' | 'reveal' | 'ready';

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const loadImage = (src: string) => {
  const image = new Image();
  image.src = src;
  return image.decode();
};

// Everything the chrome's first frame needs, so nothing pops in after the splash lifts.
// allSettled: a font or sound that fails to load must never strand the user on the splash.
const loadChrome = () =>
  Promise.allSettled([
    browserStateLoaded,
    startupSoundLoaded,
    loadImage(mascot),
    document.fonts.load('400 16px Inter'),
    document.fonts.load('400 16px "Bricolage Grotesque"'),
  ]);

function useLaunchSequence() {
  const [phase, setPhase] = useState<Phase>('splash');

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    // The chrome starts coming in late enough that it lands right as the minimum splash ends,
    // so the glass and spinner hold first and the sound follows the chrome without a gap.
    void Promise.all([wait(MIN_SPLASH_MS - CHROME_IN_MS), loadChrome()])
      .then(() => {
        if (!cancelled) {
          setPhase('loaded');
        }

        return wait(CHROME_IN_MS);
      })
      .then(() => {
        if (cancelled) {
          return;
        }

        playStartupSound();
        timers.push(window.setTimeout(() => setPhase('reveal'), SOUND_LEAD_MS));
        timers.push(window.setTimeout(() => setPhase('ready'), SOUND_LEAD_MS + SPLASH_EXIT_MS));
      });

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, []);

  return phase;
}

// Websites aren't part of this page: main lays them over it as separate views. So we measure the
// empty page area and tell main exactly where to put them, again whenever it changes size.
function useReportContentBounds(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    const browser = window.browsie?.browser;

    if (!enabled || !element || !browser) {
      return;
    }

    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect();
      void browser.setContentBounds({ x, y, width, height });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [ref, enabled]);
}

/** The browser window's own page: splash on launch, then the tab strip and page card. */
function BrowserChrome() {
  const phase = useLaunchSequence();
  const activeTab = useActiveTab();
  const pageSnapshot = usePageSnapshot((state) => state.src);
  const viewportRef = useRef<HTMLDivElement>(null);
  const showChrome = phase !== 'splash';

  // Tabs whose New Tab page has already been on screen. A fresh tab fades in; switching back to one doesn't.
  const shownNewTabs = useRef(new Set<number>());

  useReportContentBounds(viewportRef, phase === 'ready');

  // The browser window's page hides the pointer from its first paint (see index.css).
  // Give it back once the splash has finished and the chrome is ready.
  useLayoutEffect(() => {
    if (phase === 'ready') {
      document.documentElement.dataset.chromeReady = 'true';
    }
  }, [phase]);

  useEffect(() => {
    if (showChrome && activeTab?.url === null) {
      shownNewTabs.current.add(activeTab.id);
    }
  }, [showChrome, activeTab?.id, activeTab?.url]);

  const newTabEntranceDelay = (tabId: number) => {
    if (shownNewTabs.current.has(tabId)) {
      return null;
    }

    return phase === 'ready' ? 0 : LAUNCH_PAGE_DELAY;
  };

  return (
    // Solid gray at first. Once loaded, the chrome's frame scales and blurs in behind the splash.
    // chrome-waiting freezes every entrance inside it until the glass starts clearing.
    <div className={`browser-chrome relative h-screen overflow-hidden ${phase === 'loaded' ? 'chrome-waiting' : ''}`}>
      {showChrome && (
        <div className="chrome-materialize absolute inset-0 bg-[#EDE7FF]">
          <TabStrip style={{ animationDelay: `${STRIP_DELAY}ms` }} />
          <main
            id="browser-chrome-card"
            className="absolute inset-x-0 bottom-0 top-12 flex flex-col overflow-hidden bg-white"
          >
            <Toolbar tab={activeTab} entranceDelay={TOOLBAR_DELAY} />
            {/* The page area: the New Tab page lives here, or a website is laid exactly over it. */}
            <div ref={viewportRef} className="relative min-h-0 flex-1">
              {activeTab?.url === null && (
                // Keyed by tab, so each tab gets its own page.
                <NewTab key={activeTab.id} entranceDelay={newTabEntranceDelay(activeTab.id)} />
              )}
              {/* Freeze-frame of the website while a popover has the real page hidden (see setChromeOverlay). */}
              {pageSnapshot && activeTab?.url !== null && (
                <img
                  src={pageSnapshot}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              )}
            </div>
          </main>
        </div>
      )}

      {phase !== 'ready' && <SplashScreen leaving={phase === 'reveal'} />}
    </div>
  );
}

export default BrowserChrome;
