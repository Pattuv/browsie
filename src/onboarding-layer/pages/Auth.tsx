import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import mascot from '../../assets/mascot.svg';
import cloudGraphic from '../../assets/cloudgraphic.png';
import setupSoundtrack from '../../assets/setupsoundtrack.mp3';

const WHITE_HOLD_MS = 1000;
const BLUR_MS = 1000;
const HELLO_HOLD_MS = 1500;
const HELLO_TO_MASCOT_GAP_MS = 700;
const MASCOT_FADE_MS = 750;
const MASCOT_HOLD_MS = 1000;
const MASCOT_MOVE_MS = 1050;
const MASCOT_MOVE_EASING = 'cubic-bezier(0.72, 0, 0.28, 1)';
const COPY_BLUR_DELAY_MS = 220;

const HELLO_IN_AT = WHITE_HOLD_MS;
const HELLO_OUT_AT = HELLO_IN_AT + BLUR_MS + HELLO_HOLD_MS;
const MASCOT_IN_AT = HELLO_OUT_AT + BLUR_MS + HELLO_TO_MASCOT_GAP_MS;
const LIFT_AT = MASCOT_IN_AT + MASCOT_FADE_MS + MASCOT_HOLD_MS;

const HELLO_TEXT = 'hello there';
const HELLO_LETTER_STAGGER_MS = 38;

type Phase = 'white' | 'hello' | 'hello-out' | 'mascot' | 'lift';

function BirdMark({ className }: { className: string }) {
  return (
    <svg className={`${className} overflow-visible`} viewBox="0 0 48 28" fill="none">
      <g
        filter="url(#bird-grain)"
        stroke="#2a2a2a"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="bird-wing-left">
          <path d="M24 14 Q18 12.5 13 14" />
          <g className="bird-wing-left-outer">
            <path d="M13 14 Q6 16 0 14" />
          </g>
        </g>
        <g className="bird-wing-right">
          <path d="M24 14 Q30 12.5 35 14" />
          <g className="bird-wing-right-outer">
            <path d="M35 14 Q42 16 48 14" />
          </g>
        </g>
      </g>
    </svg>
  );
}

function SkyBirds() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-hidden="true">
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="bird-grain" x="-80" y="-80" width="200" height="200" filterUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" />
          </filter>
        </defs>
      </svg>
      <div className="bird-fly-a absolute top-[26%] left-0">
        <BirdMark className="bird-flap-a h-5 w-12" />
      </div>
      <div className="bird-fly-b absolute top-[35%] left-0">
        <BirdMark className="bird-flap-b h-3 w-8" />
      </div>
    </div>
  );
}

function Auth() {
  const [phase, setPhase] = useState<Phase>('white');
  const stackRef = useRef<HTMLDivElement>(null);
  const stackStartTop = useRef<number | null>(null);

  useEffect(() => {
    const audio = new Audio(setupSoundtrack);
    audio.loop = true;
    void audio.play();

    return () => {
      audio.pause();
    };
  }, []);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase('hello'), HELLO_IN_AT),
      window.setTimeout(() => setPhase('hello-out'), HELLO_OUT_AT),
      window.setTimeout(() => setPhase('mascot'), MASCOT_IN_AT),
      window.setTimeout(() => {
        if (stackRef.current) {
          stackStartTop.current = stackRef.current.getBoundingClientRect().top;
        }
        setPhase('lift');
      }, LIFT_AT),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  useLayoutEffect(() => {
    const el = stackRef.current;
    const firstTop = stackStartTop.current;

    if (phase !== 'lift' || !el || firstTop === null) {
      return;
    }

    const deltaY = firstTop - el.getBoundingClientRect().top;
    stackStartTop.current = null;

    if (Math.abs(deltaY) < 1) {
      return;
    }

    el.style.transition = 'none';
    el.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    void el.offsetWidth;

    window.requestAnimationFrame(() => {
      el.style.transition = `transform ${MASCOT_MOVE_MS}ms ${MASCOT_MOVE_EASING}`;
      el.style.transform = 'translate3d(0, 0, 0)';
    });
  }, [phase]);

  const showHello = phase === 'hello' || phase === 'hello-out';
  const showMascot = phase === 'mascot' || phase === 'lift';
  const showScene = phase === 'lift';

  return (
    <div className="relative h-full min-h-full overflow-hidden bg-white">
      {showScene && (
        <>
          <img
            src={cloudGraphic}
            alt=""
            className="slide-in-up-slow pointer-events-none absolute inset-x-0 bottom-0 z-0 w-full"
          />
          <svg
            className="slide-in-down-slow pointer-events-none absolute inset-x-0 top-0 z-[1] h-[46%] w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <filter id="auth-triangle-blur" x="-35%" y="-35%" width="170%" height="170%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>
            <polygon
              points="10,0 90,0 50,58"
              fill="#D7CBFF"
              opacity="0.55"
              filter="url(#auth-triangle-blur)"
            />
            <polygon
              points="22,0 78,0 50,40"
              fill="#D7CBFF"
              opacity="0.32"
              filter="url(#auth-triangle-blur)"
            />
            <polygon
              points="34,0 66,0 50,24"
              fill="#D7CBFF"
              opacity="0.2"
              filter="url(#auth-triangle-blur)"
            />
          </svg>
          <SkyBirds />
        </>
      )}

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 ">
        {showHello && (
          <p className="bric flex justify-center text-6xl font-normal tracking-tighter">
            {HELLO_TEXT.split('').map((char, index) => (
              <span
                key={`${char}-${index}`}
                className={`inline-block ${phase === 'hello-out' ? 'exit-blur' : 'enter-blur'}`}
                style={{ animationDelay: `${index * HELLO_LETTER_STAGGER_MS}ms` }}
              >
                {char === ' ' ? '\u00a0' : char}
              </span>
            ))}
          </p>
        )}

        {showMascot && (
          <div ref={stackRef} className="flex flex-col items-center">
            <img
              src={mascot}
              alt=""
              className={`h-48 w-auto ${phase === 'mascot' ? 'enter-slide-fade' : ''}`}
            />

            {showScene && (
              <div className="flex flex-col items-center gap-9">
                <h1
                  className="enter-blur bric text-center text-6xl font-normal tracking-tighter"
                  style={{ animationDelay: `${COPY_BLUR_DELAY_MS}ms` }}
                >
                  Welcome to Browsie
                </h1>
                <button
                  type="button"
                  className="enter-blur app-region-no-drag flex h-[4.25rem] w-fit cursor-pointer items-center rounded-full bg-black p-2 text-white transition-transform duration-300 ease-out hover:scale-110 active:scale-95"
                  style={{ animationDelay: `${COPY_BLUR_DELAY_MS}ms` }}
                >
                  <span className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full bg-white">
                    <i className="bi bi-google text-2xl leading-none text-black" aria-hidden="true" />
                  </span>
                  <span className="px-2.5 text-center text-lg font-medium tracking-tight">
                    Continue with Google
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showScene && (
        <p className="enter-fade-slow absolute inset-x-0 bottom-5 z-10 px-6 text-center text-sm tracking-tight text-zinc-400">
          By continuing, you agree to the{' '}
          <span className="underline underline-offset-2">Terms of Service</span> and{' '}
          <span className="underline underline-offset-2">Privacy Policy</span>.
        </p>
      )}
    </div>
  );
}

export default Auth;
