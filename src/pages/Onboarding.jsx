import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import wordmark from '../assets/wordmark.svg';
import mascot from '../assets/mascot.png';
import guidebook from '../assets/guidebook.png';

const TITLE_DELAY_MS = 500;
const BLUR_DURATION_MS = 550;
const POST_TITLE_DELAY_MS = 400;
const TITLE_MOVE_MS = 800;
const TITLE_MOVE_EASING = 'cubic-bezier(0.72, 0, 0.28, 1)';
const REST_STAGGER_MS = 160;
const REST_LAYOUT_MS = TITLE_DELAY_MS + BLUR_DURATION_MS + POST_TITLE_DELAY_MS;
const REST_FADE_START_MS = REST_LAYOUT_MS + TITLE_MOVE_MS + 50;
const GUIDE_URL = 'https://theodocs.super.site/theo-help-center';
const ONBOARDING_PLAYED_KEY = 'theo-onboarding-played';

function hasPlayedOnboarding() {
  return localStorage.getItem(ONBOARDING_PLAYED_KEY) === 'true';
}

function revealClass(shouldAnimate, visible) {
  if (!shouldAnimate) {
    return '';
  }

  return visible ? 'enter-blur' : 'pointer-events-none opacity-0';
}

function openGuide() {
  window.theo?.openExternal(GUIDE_URL);
}

function ActionLines({ className, mirrored = false }) {
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

function Onboarding() {
  const shouldAnimate = useRef(!hasPlayedOnboarding());
  const titleRef = useRef(null);
  const titleStartRect = useRef(null);
  const titleFlipPlayed = useRef(!shouldAnimate.current);
  const [showTitle, setShowTitle] = useState(!shouldAnimate.current);
  const [showRestLayout, setShowRestLayout] = useState(!shouldAnimate.current);
  const [showMascot, setShowMascot] = useState(!shouldAnimate.current);
  const [showSubtitle, setShowSubtitle] = useState(!shouldAnimate.current);
  const [showButton, setShowButton] = useState(!shouldAnimate.current);
  const [showCard, setShowCard] = useState(!shouldAnimate.current);

  useEffect(() => {
    if (!shouldAnimate.current) {
      return undefined;
    }

    localStorage.setItem(ONBOARDING_PLAYED_KEY, 'true');

    const timers = [
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
    ];

    return () => timers.forEach(clearTimeout);
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
    <div className="h-full flex flex-col p-4">
      <header
        className="h-10 shrink-0 flex items-center pl-14"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <img src={wordmark} alt="Theo" className="h-5" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center p-5 gap-2">
        {showRestLayout && (
          <img
            src={mascot}
            alt="Theo"
            className={`h-25 -mb-4 ${revealClass(shouldAnimate.current, showMascot)}`}
          />
        )}

        {showTitle && (
          <h1
            ref={titleRef}
            className={`shrink-0 text-3xl text-center bric tracking-tighter ${shouldAnimate.current ? 'enter-blur' : ''}`}
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
            className={`group relative inline-flex items-center my-15 text-black transition-all duration-300 ease-out hover:scale-110 has-[:active]:scale-100 ${revealClass(shouldAnimate.current, showButton)}`}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openGuide();
              }
            }}
            className={`relative w-full max-w-md min-h-44 overflow-hidden rounded-3xl border border-black bg-[#F9F0F9] px-6 py-8 mt-3 cursor-pointer ${revealClass(shouldAnimate.current, showCard)}`}
          >
            <div className="relative z-10 max-w-[62%] flex flex-col gap-2">
              <h2 className="text-xl font-light tracking-tight">For support:</h2>
              <p className="text-sm text-zinc-500 font-light leading-snug tracking-tight">
                Learn how you can help{' '}
                <span className="font-semibold text-zinc-800">Pratyush</span> use Theo to the
                best of their ability.
              </p>
              <span className="w-fit text-sm font-medium tracking-tight">Go to guide →</span>
            </div>
            <img
              src={guidebook}
              alt="Caretaker Guide"
              className="pointer-events-none absolute right-5 -bottom-22 w-52 rotate-12"
            />
          </div>
        )}
      </div>
      <footer className="shrink-0 text-xs text-center text-zinc-300 pb-2">
        theo v.0.0.1   |   currently under development
      </footer>
    </div>
  );
}

export default Onboarding;
