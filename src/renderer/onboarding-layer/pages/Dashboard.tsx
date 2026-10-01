import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import Boiler from '../../components/Boiler';
import ProfileMenu from '../../components/ProfileMenu';
import mascot from '../../assets/mascot.svg';
import wordmark from '../../assets/wordmark.svg';
import book from '../../assets/paint-icons/book.png';

const TITLE_DELAY_MS = 500;
const BLUR_DURATION_MS = 550;
const POST_TITLE_DELAY_MS = 400;
const TITLE_MOVE_MS = 800;
const TITLE_MOVE_EASING = 'cubic-bezier(0.72, 0, 0.28, 1)';
const REST_STAGGER_MS = 160;
const REST_LAYOUT_MS = TITLE_DELAY_MS + BLUR_DURATION_MS + POST_TITLE_DELAY_MS;
const REST_FADE_START_MS = REST_LAYOUT_MS + TITLE_MOVE_MS + 50;
const NOTCH_DROP_MS = REST_FADE_START_MS + REST_STAGGER_MS * 3 + BLUR_DURATION_MS + 150;
const GUIDE_URL = 'https://browsiedocs.super.site/browsie-help-center';

function revealClass(shouldAnimate: boolean, visible: boolean): string {
  if (!shouldAnimate) {
    return '';
  }

  return visible ? 'enter-blur' : 'pointer-events-none opacity-0';
}

function openGuide() {
  window.browsie?.openExternal(GUIDE_URL);
}

type ActionLinesProps = {
  className?: string;
  mirrored?: boolean;
};

function ActionLines({ className, mirrored = false }: ActionLinesProps) {
  return (
    <svg
      width="28"
      height="44"
      viewBox="0 0 28 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`pointer-events-none shrink-0 ${mirrored ? 'scale-x-[-1]' : ''} ${className ?? ''}`}
      aria-hidden="true"
    >
      <line x1="24" y1="5" x2="3" y2="1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="22" x2="1" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="39" x2="3" y2="43" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const NOTCH_EAR_SIZE = 10;

function notchEarStyle(side: 'left' | 'right') {
  const corner = side === 'left' ? '0 100%' : '100% 100%';

  return {
    width: NOTCH_EAR_SIZE,
    height: NOTCH_EAR_SIZE,
    background: `radial-gradient(circle at ${corner}, transparent ${NOTCH_EAR_SIZE - 0.5}px, black ${NOTCH_EAR_SIZE}px)`,
  };
}

type ModeNotchProps = {
  mode: UserMode;
  animate: boolean;
};

function ModeNotch({ mode, animate }: ModeNotchProps) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 -top-px z-30 mx-auto flex w-fit ${animate ? 'notch-drop' : ''}`}>
      <span className="-mr-px" style={notchEarStyle('left')} aria-hidden="true" />
      <div className="bric flex h-9 items-center gap-1.5 rounded-b-2xl bg-black px-5 text-sm tracking-tight text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
        {mode} mode
      </div>
      <span className="-ml-px" style={notchEarStyle('right')} aria-hidden="true" />
    </div>
  );
}

function Dashboard() {
  const shouldAnimate = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleStartRect = useRef<DOMRect | null>(null);
  const titleFlipPlayed = useRef(false);
  const [showTitle, setShowTitle] = useState(false);
  const [showRestLayout, setShowRestLayout] = useState(false);
  const [showMascot, setShowMascot] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [showNotch, setShowNotch] = useState(false);
  const [mode, setMode] = useState<UserMode | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.browsie?.getUserMode().then((savedMode) => {
      if (!cancelled) {
        setMode(savedMode);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const showAll = () => {
      titleFlipPlayed.current = true;
      setShowTitle(true);
      setShowRestLayout(true);
      setShowMascot(true);
      setShowSubtitle(true);
      setShowButton(true);
      setShowCard(true);
      setShowNotch(true);
    };

    const startAnimation = () => {
      window.browsie?.markDashboardPlayed();

      timers = [
        setTimeout(() => setShowTitle(true), TITLE_DELAY_MS),
        setTimeout(() => {
          if (titleRef.current) {
            titleStartRect.current = titleRef.current.getBoundingClientRect();
          }
          setShowRestLayout(true);
        }, REST_LAYOUT_MS),
        setTimeout(() => setShowMascot(true), REST_FADE_START_MS),
        setTimeout(() => setShowSubtitle(true), REST_FADE_START_MS + REST_STAGGER_MS),
        setTimeout(() => setShowButton(true), REST_FADE_START_MS + REST_STAGGER_MS * 2),
        setTimeout(() => setShowCard(true), REST_FADE_START_MS + REST_STAGGER_MS * 3),
        setTimeout(() => setShowNotch(true), NOTCH_DROP_MS),
      ];
    };

    window.browsie?.shouldAnimateDashboard().then((animate) => {
      if (cancelled) {
        return;
      }

      shouldAnimate.current = animate;

      if (animate) {
        startAnimation();
      } else {
        showAll();
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shouldAnimate.current || !showRestLayout || !titleRef.current || !titleStartRect.current || titleFlipPlayed.current) {
      return undefined;
    }

    const el = titleRef.current;
    const first = titleStartRect.current;
    const last = el.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;

    titleFlipPlayed.current = true;
    titleStartRect.current = null;

    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return undefined;
    }

    el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    el.style.transition = 'none';
    void el.offsetHeight;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = `transform ${TITLE_MOVE_MS}ms ${TITLE_MOVE_EASING}`;
        el.style.transform = 'translate(0, 0)';
      });
    });

    return undefined;
  }, [showRestLayout]);

  return (
    <Boiler>
      <div className="absolute inset-x-0 top-6 z-20 flex h-8 items-center justify-between pl-[4.5rem] pr-10">
        <img src={wordmark} alt="Browsie" className="pointer-events-none h-5 -translate-y-1" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            className="app-region-no-drag flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-black transition-colors duration-200 ease-out hover:bg-zinc-200/70"
          >
            <SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <ProfileMenu />
        </div>
      </div>

      {mode && showNotch && <ModeNotch mode={mode} animate={shouldAnimate.current} />}

      <div className="flex flex-1 flex-col items-center justify-center p-5 gap-2">
        {showRestLayout && (
          <img
            src={mascot}
            alt="Browsie"
            className={`h-30 ${revealClass(shouldAnimate.current, showMascot)}`}
          />
        )}

        {showTitle && (
          <h1
            ref={titleRef}
            className={`shrink-0 text-4xl text-center bric tracking-tighter ${shouldAnimate.current ? 'enter-blur' : ''}`}
          >
            Welcome, Caretaker
          </h1>
        )}

        {showRestLayout && (
          <p className={`text-zinc-500 tracking-tight font-light ${revealClass(shouldAnimate.current, showSubtitle)}`}>
            Your AI navigation assistant is here.
          </p>
        )}

        {showRestLayout && (
          <div
            className={`group relative inline-flex items-center my-15 text-black transition-all duration-300 ease-out hover:scale-110 has-active:scale-100 ${revealClass(shouldAnimate.current, showButton)}`}
          >
            <ActionLines className="absolute right-full mr-10" />
            <button className="cursor-pointer bg-black ring-8 ring-black/70 text-white px-6 py-4 rounded-full tracking-tight transition-all duration-300 ease-out group-hover:py-6 group-hover:ring-0">
              Open browser for Pratyush
            </button>
            <ActionLines className="absolute left-full ml-10" mirrored />
          </div>
        )}

        {showRestLayout && (
          <div
            role="link"
            tabIndex={0}
            onClick={openGuide}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openGuide();
              }
            }}
            className={`relative flex w-full max-w-md min-h-40 items-center overflow-hidden rounded-[2rem] border border-zinc-300 bg-[#F7F7F7] px-8 py-8 mt-4 cursor-pointer ${revealClass(shouldAnimate.current, showCard)}`}
          >
            <div className="relative z-10 max-w-[55%] flex flex-col gap-1.5">
              <h2 className="text-xl tracking-tight">For support:</h2>
              <p className="text-xs text-zinc-500 font-light leading-snug tracking-tight">
                Learn how you can help{' '}
                <span className="font-semibold text-zinc-800">Pratyush</span> use Browsie to the
                best of their ability.
              </p>
              <span className="mt-1 w-fit text-xs font-medium tracking-tight">Go to guide →</span>
            </div>
            <img
              src={book}
              alt="Caretaker Guide"
              className="pointer-events-none absolute right-6 top-1/2 w-40 -translate-y-1/2"
            />
          </div>
        )}
      </div>
      <footer className="shrink-0 text-[0.65rem] text-center text-zinc-400 pb-2">
        v.1.3.4   |   Implementing Google OAuth
      </footer>
    </Boiler>
  );
}

export default Dashboard;
