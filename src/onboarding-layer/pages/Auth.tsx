import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import mascot from '../../assets/mascot.svg';
import cloudGraphic from '../../assets/cloudgraphic.png';

const WHITE_HOLD_MS = 1000;
const BLUR_MS = 1000;
const HELLO_HOLD_MS = 1500;
const HELLO_TO_MASCOT_GAP_MS = 700;
const MASCOT_FADE_MS = 750;
const MASCOT_HOLD_MS = 1000;
const MASCOT_MOVE_MS = 1050;
const MASCOT_MOVE_EASING = 'cubic-bezier(0.72, 0, 0.28, 1)';

const HELLO_IN_AT = WHITE_HOLD_MS;
const HELLO_OUT_AT = HELLO_IN_AT + BLUR_MS + HELLO_HOLD_MS;
const MASCOT_IN_AT = HELLO_OUT_AT + BLUR_MS + HELLO_TO_MASCOT_GAP_MS;
const FINAL_AT = MASCOT_IN_AT + MASCOT_FADE_MS + MASCOT_HOLD_MS;

const HELLO_TEXT = 'hello there';
const HELLO_LETTER_STAGGER_MS = 38;

type Phase = 'white' | 'hello' | 'hello-out' | 'mascot' | 'final';

function Auth() {
  const [phase, setPhase] = useState<Phase>('white');
  const mascotMotionRef = useRef<HTMLDivElement>(null);
  const mascotStartTop = useRef<number | null>(null);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase('hello'), HELLO_IN_AT),
      window.setTimeout(() => setPhase('hello-out'), HELLO_OUT_AT),
      window.setTimeout(() => setPhase('mascot'), MASCOT_IN_AT),
      window.setTimeout(() => {
        if (mascotMotionRef.current) {
          mascotStartTop.current = mascotMotionRef.current.getBoundingClientRect().top;
        }
        setPhase('final');
      }, FINAL_AT),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  useLayoutEffect(() => {
    const el = mascotMotionRef.current;
    const firstTop = mascotStartTop.current;

    if (phase !== 'final' || !el || firstTop === null) {
      return;
    }

    const deltaY = firstTop - el.getBoundingClientRect().top;
    mascotStartTop.current = null;

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
  const showMascot = phase === 'mascot' || phase === 'final';
  const showFinal = phase === 'final';

  return (
    <div className="relative h-full min-h-full overflow-hidden bg-white">
      {showFinal && (
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
          <div className="flex flex-col items-center">
            <div ref={mascotMotionRef}>
              <img
                src={mascot}
                alt=""
                className={`h-48 w-auto ${phase === 'mascot' ? 'enter-slide-fade' : ''}`}
              />
            </div>

            {showFinal && (
              <div className="flex flex-col items-center gap-9">
                <h1 className="enter-blur-slow bric text-center text-6xl font-normal tracking-tighter">
                  Welcome to Browsie
                </h1>
                <button
                  type="button"
                  className="enter-blur-slow app-region-no-drag flex h-[4.25rem] w-fit cursor-pointer items-center rounded-full bg-black p-2 text-white transition-transform duration-300 ease-out hover:scale-110 active:scale-95"
                >
                  <span className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full bg-white">
                    <i className="bi bi-google text-2xl leading-none text-black" aria-hidden="true" />
                  </span>
                  <span className="px-5 text-center text-lg font-medium tracking-tight">
                    Continue with Google
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showFinal && (
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
