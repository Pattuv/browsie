import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import mascot from "../../assets/mascot.svg";
import cloudGraphic from "../../assets/cloudgraphic.png";
import browserIllustration from "../../assets/paint-icons/browser.png";
import {
  fadeOutSetupSoundtrack,
  getSetupSoundtrack,
  playSetupSoundtrack,
} from "../setupSoundtrack";

const WHITE_HOLD_MS = 1000;
const BLUR_MS = 1000;
const HELLO_HOLD_MS = 2200;
const HELLO_TO_MASCOT_GAP_MS = 1100;
const MASCOT_MOVE_MS = 1400;
const MASCOT_MOVE_EASING = "cubic-bezier(0.72, 0, 0.28, 1)";
const COPY_BLUR_DELAY_MS = 320;
const WELCOME_BLUR_MS = 850;

const HELLO_IN_AT = WHITE_HOLD_MS;
const HELLO_OUT_AT = HELLO_IN_AT + BLUR_MS + HELLO_HOLD_MS;
const MASCOT_IN_AT = HELLO_OUT_AT + BLUR_MS + HELLO_TO_MASCOT_GAP_MS;

const HELLO_TEXT = "hello there";
const HELLO_LETTER_STAGGER_MS = 38;

// Matches .exit-blur in index.css.
const WELCOME_EXIT_MS = 550;

type Phase = "white" | "hello" | "hello-out" | "mascot" | "lift";
// welcome → (click) welcome-out → browser; back to welcome if the attempt is cancelled or fails.
type SignInView = "welcome" | "welcome-out" | "browser";

type AuthProps = {
  // true: first-time install (white → hello → mascot → welcome, with the soundtrack).
  // false: this install has signed in before, so go straight to the welcome screen in silence.
  playIntro: boolean;
};

function Auth({ playIntro }: AuthProps) {
  const [phase, setPhase] = useState<Phase>(playIntro ? "white" : "lift");
  const [signInView, setSignInView] = useState<SignInView>("welcome");
  const [hasTriedSignIn, setHasTriedSignIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const stackStartTop = useRef<number | null>(null);
  const welcomeExitTimer = useRef<number | undefined>(undefined);
  const [soundtrackMuted, setSoundtrackMuted] = useState(false);

  const handleSignInClick = async () => {
    setSignInFailed(false);
    setHasTriedSignIn(true);
    setSignInView("welcome-out");
    welcomeExitTimer.current = window.setTimeout(
      () => setSignInView("browser"),
      WELCOME_EXIT_MS,
    );

    let signedIn = false;
    try {
      const session = await window.browsie?.auth.signIn();
      // On success main pushes SIGNED_IN to the auth store, and the gate swaps this page for Dashboard.
      signedIn = session?.status === "SIGNED_IN";
    } catch {
      setSignInFailed(true);
    }

    if (signedIn) {
      // Start the fade before Auth unmounts so cleanup isn't the only chance to stop it.
      fadeOutSetupSoundtrack();
    } else {
      window.clearTimeout(welcomeExitTimer.current);
      setSignInView("welcome");
    }
  };

  useEffect(() => () => window.clearTimeout(welcomeExitTimer.current), []);

  useEffect(() => {
    if (!playIntro) {
      return undefined;
    }

    playSetupSoundtrack();

    return () => {
      fadeOutSetupSoundtrack();
    };
  }, []);

  useEffect(() => {
    if (!playIntro) {
      return undefined;
    }

    const timers = [
      window.setTimeout(() => setPhase("hello"), HELLO_IN_AT),
      window.setTimeout(() => setPhase("hello-out"), HELLO_OUT_AT),
      // Mascot + welcome lift together: "mascot" is only a one-frame measure for the FLIP.
      window.setTimeout(() => setPhase("mascot"), MASCOT_IN_AT),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  useLayoutEffect(() => {
    if (phase === "mascot") {
      if (stackRef.current) {
        stackStartTop.current = stackRef.current.getBoundingClientRect().top;
      }
      setPhase("lift");
      return;
    }

    const el = stackRef.current;
    const firstTop = stackStartTop.current;

    if (phase !== "lift" || !el || firstTop === null) {
      return;
    }

    const deltaY = firstTop - el.getBoundingClientRect().top;
    stackStartTop.current = null;

    if (Math.abs(deltaY) < 1) {
      return;
    }

    el.style.transition = "none";
    el.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    void el.offsetWidth;

    window.requestAnimationFrame(() => {
      el.style.transition = `transform ${MASCOT_MOVE_MS}ms ${MASCOT_MOVE_EASING}`;
      el.style.transform = "translate3d(0, 0, 0)";
    });
  }, [phase]);

  const toggleSoundtrack = () => {
    const audio = getSetupSoundtrack();

    if (!audio) {
      return;
    }

    audio.muted = !audio.muted;
    setSoundtrackMuted(audio.muted);
  };

  const showHello = phase === "hello" || phase === "hello-out";
  const showMascot = phase === "mascot" || phase === "lift";
  const showScene = phase === "lift";
  const SoundtrackIcon = soundtrackMuted ? VolumeX : Volume2;

  return (
    <div className="relative h-full min-h-full overflow-hidden bg-white">
      {playIntro && (
        <button
          type="button"
          aria-label={soundtrackMuted ? "Unmute soundtrack" : "Mute soundtrack"}
          aria-pressed={soundtrackMuted}
          onClick={toggleSoundtrack}
          className="smooth app-region-no-drag absolute top-4 left-5 z-20 flex size-11 cursor-pointer items-center justify-center rounded-2xl border border-[#cccccc] bg-transparent text-[#243746] transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        >
          <SoundtrackIcon size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {showScene && (
        <>
          <img
            src={cloudGraphic}
            alt=""
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-0 w-full ${playIntro ? "slide-in-up-slow" : ""}`}
          />
          <svg
            className={`pointer-events-none absolute inset-x-0 top-0 z-[1] h-[46%] w-full overflow-visible ${playIntro ? "slide-in-down-slow" : ""}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <filter
                id="auth-triangle-blur"
                x="-35%"
                y="-35%"
                width="170%"
                height="170%"
              >
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
          <p className="bric flex justify-center text-6xl font-medium tracking-tighter">
            {HELLO_TEXT.split("").map((char, index) => (
              <span
                key={`${char}-${index}`}
                className={`inline-block ${phase === "hello-out" ? "exit-blur" : "enter-blur"}`}
                style={{
                  animationDelay: `${index * HELLO_LETTER_STAGGER_MS}ms`,
                }}
              >
                {char === " " ? "\u00a0" : char}
              </span>
            ))}
          </p>
        )}

        {signInView === "browser" && (
          <div className="enter-blur flex flex-col items-center">
            <img src={browserIllustration} alt="" className="h-28 w-auto" />
            <h1 className="bric mt-2 text-center text-5xl font-medium tracking-tighter">
              Finish signing in from your
              <br />
              existing browser.
            </h1>
            <p className="mt-5 font-medium text-center text-lg tracking-tight text-zinc-600">
              This page will refresh when you’re done.
            </p>
            {/* Main resolves the pending signIn() as signed-out, and handleSignInClick fades the welcome view back in. */}
            <button
              type="button"
              onClick={() => window.browsie?.auth.cancelSignIn()}
              className="smooth app-region-no-drag mt-6 h-10 w-28 cursor-pointer rounded-[14px] border-[1.5px] border-black bg-black text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
            >
              Cancel
            </button>
          </div>
        )}

        {showMascot && signInView !== "browser" && (
          <div
            ref={stackRef}
            className={`flex flex-col items-center ${
              signInView === "welcome-out"
                ? "exit-blur pointer-events-none"
                : hasTriedSignIn
                  ? "enter-blur"
                  : ""
            }`}
          >
            <img
              src={mascot}
              alt=""
              className={`h-38.5 mt-[15px] mb-[23px] w-auto ${playIntro && showMascot ? "enter-slide-fade" : ""}`}
            />

            {showScene && (
              <div className="flex flex-col items-center gap-9">
                <h1
                  className={`bric text-center text-6xl font-medium tracking-tighter ${playIntro ? "enter-blur" : ""}`}
                  style={
                    playIntro
                      ? {
                          animationDelay: `${COPY_BLUR_DELAY_MS}ms`,
                          animationDuration: `${WELCOME_BLUR_MS}ms`,
                        }
                      : undefined
                  }
                >
                  Welcome to Browsie
                </h1>
                <div className="relative flex flex-col items-center">
                  <button
                    type="button"
                    data-click-sound="heavy"
                    onClick={handleSignInClick}
                    className={`app-region-no-drag flex h-[4.25rem] w-fit cursor-pointer items-center rounded-full bg-black p-2 text-white transition-transform duration-300 ease-out hover:scale-110 active:scale-95 ${playIntro ? "enter-blur" : ""}`}
                    style={
                      playIntro
                        ? {
                            animationDelay: `${COPY_BLUR_DELAY_MS}ms`,
                            animationDuration: `${WELCOME_BLUR_MS}ms`,
                          }
                        : undefined
                    }
                  >
                    <span className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full bg-white">
                      <i
                        className="bi bi-google text-2xl leading-none text-black"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="px-2.5 text-center text-lg font-medium tracking-tight">
                      Continue with Google
                    </span>
                  </button>
                  {signInFailed && (
                    <p className="absolute top-full mt-4 whitespace-nowrap text-base tracking-tight text-zinc-600">
                      Something went wrong signing in. Please try again.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showScene && (
        <p
          className={`absolute inset-x-0 bottom-5 z-10 px-6 text-center font-[500] text-sm tracking-tight text-zinc-400 ${playIntro ? "enter-fade-slow" : ""}`}
        >
          By continuing, you agree to the{" "}
          <span className="underline underline-offset-2">Terms of Service</span>{" "}
          and{" "}
          <span className="underline underline-offset-2">Privacy Policy</span>.
        </p>
      )}
    </div>
  );
}

export default Auth;
