import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Mascot from "../../../components/Mascot";
import browserIllustration from "../../../assets/paint-icons/browser.png";

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

// Match .exit-blur and .enter-blur in index.css.
const WELCOME_EXIT_MS = 550;
const BROWSER_VIEW_ENTER_MS = 550;

export type Phase = "white" | "hello" | "hello-out" | "mascot" | "lift";
// welcome → (click) welcome-out → browser; back to welcome if the attempt is cancelled or fails.
type SignInView = "welcome" | "welcome-out" | "browser";

type AuthProps = {
  // true: first-time install (white → hello → mascot → welcome, with the soundtrack).
  // false: the last account here finished setup, so go straight to the welcome screen in silence.
  playIntro: boolean;
  phase: Phase;
  onPhase: (phase: Phase) => void;
};

function Auth({ playIntro, phase, onPhase }: AuthProps) {
  const [signInView, setSignInView] = useState<SignInView>("welcome");
  const [hasTriedSignIn, setHasTriedSignIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const stackStartTop = useRef<number | null>(null);
  const welcomeExitTimer = useRef<number | undefined>(undefined);
  // Set from the click until the browser actually opens.
  const launchTimer = useRef<number | undefined>(undefined);

  const startSignIn = async () => {
    launchTimer.current = undefined;

    let signedIn = false;
    try {
      const session = await window.browsie?.auth.signIn();
      // On success main pushes SIGNED_IN to the auth store. This view stays up until the user is back
      // in the app; then the gate swaps it for the setup steps, or the Dashboard if this account is set up.
      signedIn = session?.status === "SIGNED_IN";
    } catch {
      setSignInFailed(true);
    }

    if (!signedIn) {
      setSignInView("welcome");
    }
  };

  const handleSignInClick = () => {
    setSignInFailed(false);
    setHasTriedSignIn(true);
    setSignInView("welcome-out");
    welcomeExitTimer.current = window.setTimeout(
      () => setSignInView("browser"),
      WELCOME_EXIT_MS,
    );
    // Open the user's browser only once "Finish signing in from your browser" is on screen,
    // so they've read why it opened.
    launchTimer.current = window.setTimeout(
      () => void startSignIn(),
      WELCOME_EXIT_MS + BROWSER_VIEW_ENTER_MS,
    );
  };

  const handleCancel = () => {
    if (launchTimer.current !== undefined) {
      // The browser hasn't opened yet, so there's nothing in main to cancel.
      window.clearTimeout(launchTimer.current);
      launchTimer.current = undefined;
      setSignInView("welcome");
      return;
    }

    // Main resolves the pending signIn() as signed-out, and startSignIn fades the welcome view back in.
    void window.browsie?.auth.cancelSignIn();
  };

  useEffect(
    () => () => {
      window.clearTimeout(welcomeExitTimer.current);
      window.clearTimeout(launchTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!playIntro) {
      return undefined;
    }

    const timers = [
      window.setTimeout(() => onPhase("hello"), HELLO_IN_AT),
      window.setTimeout(() => onPhase("hello-out"), HELLO_OUT_AT),
      // Mascot + welcome lift together: "mascot" is only a one-frame measure for the FLIP.
      window.setTimeout(() => onPhase("mascot"), MASCOT_IN_AT),
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  useLayoutEffect(() => {
    if (phase === "mascot") {
      if (stackRef.current) {
        stackStartTop.current = stackRef.current.getBoundingClientRect().top;
      }
      onPhase("lift");
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
  }, [onPhase, phase]);

  const showHello = phase === "hello" || phase === "hello-out";
  const showMascot = phase === "mascot" || phase === "lift";
  const showScene = phase === "lift";

  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="flex h-full flex-col items-center justify-center px-6">
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
            <p className="mt-5 text-center text-lg font-medium tracking-tight text-zinc-600">
              This page will refresh when you’re done.
            </p>
            <button
              type="button"
              onClick={handleCancel}
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
            <Mascot
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
          className={`absolute inset-x-0 bottom-5 z-10 px-6 text-center text-sm font-[500] tracking-tight text-zinc-400 ${playIntro ? "enter-fade-slow" : ""}`}
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
