import { useEffect, useState } from "react";
import spinner from "../assets/spinner.svg";

type SplashScreenProps = {
  /** True once the chrome is ready: the tint and the spinner fade away. */
  leaving: boolean;
};

// Flavor copy for the launch glass. The splash holds for several seconds, so these
// step through like a real boot instead of sitting on one line.
const STATUSES = [
  "Starting your session",
  "Loading your profile",
  "Restoring tabs",
  "Checking bookmarks",
  "Preparing the address bar",
  "Opening the window",
];

const STATUS_HOLD_MS = 900;
const STATUS_FADE_MS = 180;

/**
 * The launch screen: a deep gray field (the opaque window), then a frost over the
 * chrome as it materializes. Spinner and status sit on top. The frost clears once
 * the chrome is in.
 */
function SplashScreen({ leaving }: SplashScreenProps) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (leaving) {
      return;
    }

    let fadeTimer = 0;
    const cycle = window.setInterval(() => {
      setShown(false);
      fadeTimer = window.setTimeout(() => {
        setIndex((current) => (current + 1) % STATUSES.length);
        setShown(true);
      }, STATUS_FADE_MS);
    }, STATUS_HOLD_MS + STATUS_FADE_MS);

    return () => {
      window.clearInterval(cycle);
      window.clearTimeout(fadeTimer);
    };
  }, [leaving]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${
        leaving ? "splash-leaving pointer-events-none" : ""
      }`}
    >
      <div className="splash-tint absolute inset-0" aria-hidden="true" />
      <div className="splash-spinner-wrap relative">
        <img src={spinner} alt="" className="splash-spinner h-14 w-14" />
      </div>
      <p
        aria-hidden="true"
        className={`splash-status inter absolute bottom-8 left-0 right-0 text-center text-[13px] font-normal ${
          shown ? "is-shown" : ""
        }`}
      >
        {STATUSES[index]}…
      </p>
      {/* The spinner and the status line are decoration; screen readers hear this instead. */}
      <span className="sr-only">
        {leaving ? "Browsie is ready." : "Browsie is starting."}
      </span>
    </div>
  );
}

export default SplashScreen;
