import { useEffect, useState } from "react";
import { ArrowLeft, Volume2, VolumeX } from "lucide-react";
import cloudGraphic from "../../assets/cloudgraphic.png";
import {
  fadeOutSetupSoundtrack,
  getSetupSoundtrack,
  playSetupSoundtrack,
} from "../setupSoundtrack";
import Auth, { type Phase } from "./setup-pages/Auth";
import AppearanceSetup from "./setup-pages/AppearanceSetup";
import FinalConfirmation from "./setup-pages/FinalConfirmation";
import KeySetup from "./setup-pages/KeySetup";
import GoogleSetup from "./setup-pages/GoogleSetup";
import SetupGuide from "./setup-pages/SetupGuide";

// What the gate wants: signed out is always Auth; signed in but not set up runs the setup steps.
export type SetupStep = "auth" | "setup";
// The steps after Auth, in order. Setup walks these itself; the gate only knows "not set up yet".
type SetupPage = "guide" | "key" | "google" | "appearance" | "done";

const SETUP_PAGES: SetupPage[] = ["guide", "key", "google", "appearance", "done"];

type SetupProps = {
  // true: first-time install (white → hello → mascot → welcome, with the soundtrack).
  // false: the last account here finished setup, so go straight to the welcome screen in silence.
  playIntro: boolean;
  step: SetupStep;
};

function Setup({ playIntro, step }: SetupProps) {
  const [phase, setPhase] = useState<Phase>(playIntro ? "white" : "lift");
  const [page, setPage] = useState<SetupPage>("guide");
  const [soundtrackMuted, setSoundtrackMuted] = useState(false);

  // Signed out partway through: the next sign-in starts the steps from the top.
  if (step === "auth" && page !== "guide") {
    setPage("guide");
  }
  const showScene = phase === "lift";
  const SoundtrackIcon = soundtrackMuted ? VolumeX : Volume2;

  useEffect(() => {
    if (!playIntro) {
      return undefined;
    }

    playSetupSoundtrack();

    return () => {
      fadeOutSetupSoundtrack();
    };
  }, []);

  const goBack = () => {
    if (page === "guide") {
      void window.browsie?.auth.signOut();
      return;
    }

    const index = SETUP_PAGES.indexOf(page);
    setPage(SETUP_PAGES[index - 1]);
  };

  const toggleSoundtrack = () => {
    const audio = getSetupSoundtrack();

    if (!audio) {
      return;
    }

    audio.muted = !audio.muted;
    setSoundtrackMuted(audio.muted);
  };

  return (
    <div className="relative h-full min-h-full overflow-hidden bg-white">
      {step === "setup" && (
        <button
          type="button"
          aria-label="Back"
          onClick={goBack}
          className={`smooth app-region-no-drag absolute top-4 z-20 flex size-11 cursor-pointer items-center justify-center rounded-2xl border border-[#cccccc] bg-white text-[#243746] transition-transform duration-300 ease-out hover:scale-105 active:scale-95 ${playIntro ? "left-[4.75rem]" : "left-5"}`}
        >
          <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

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
                id="setup-triangle-blur"
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
              filter="url(#setup-triangle-blur)"
            />
            <polygon
              points="22,0 78,0 50,40"
              fill="#D7CBFF"
              opacity="0.32"
              filter="url(#setup-triangle-blur)"
            />
            <polygon
              points="34,0 66,0 50,24"
              fill="#D7CBFF"
              opacity="0.2"
              filter="url(#setup-triangle-blur)"
            />
          </svg>
        </>
      )}

      {step === "auth" && (
        <Auth playIntro={playIntro} phase={phase} onPhase={setPhase} />
      )}
      {step === "setup" && page === "guide" && (
        <SetupGuide onContinue={() => setPage("key")} />
      )}
      {step === "setup" && page === "key" && (
        <KeySetup onContinue={() => setPage("google")} />
      )}
      {step === "setup" && page === "google" && (
        <GoogleSetup onContinue={() => setPage("appearance")} />
      )}
      {step === "setup" && page === "appearance" && (
        <AppearanceSetup onContinue={() => setPage("done")} />
      )}
      {step === "setup" && page === "done" && <FinalConfirmation />}
    </div>
  );
}

export default Setup;
