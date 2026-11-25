import { useEffect, useState } from "react";
import { Check, Mic } from "../../../icons";

// Microphone step: asks the operating system for the mic up front, so the first time someone holds the
// spacebar it simply works instead of stopping on a system prompt (or failing silently after a "Don't
// Allow"). Browsie only listens while the spacebar is held.

const isMac = window.browsie?.platform === "darwin";
const SETTINGS_NAME = isMac ? "System Settings" : "Windows Settings";

const statusText = (access: MicAccess | undefined) => {
  switch (access) {
    case "denied":
      return isMac
        ? `The microphone is turned off for Browsie. Open ${SETTINGS_NAME}, switch Browsie on under Microphone, then come back.`
        : `The microphone is turned off. Open ${SETTINGS_NAME} and turn on microphone access for desktop apps, then come back.`;
    case "restricted":
      return "This computer doesn’t allow apps to use the microphone. It may be managed by an organization.";
    default:
      return "";
  }
};

type MicSetupProps = {
  onContinue: () => void;
};

function MicSetup({ onContinue }: MicSetupProps) {
  const [access, setAccess] = useState<MicAccess | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const granted = access === "granted";
  const blocked = access === "denied" || access === "restricted";

  // Checked on arrival and again whenever the window comes back, since the switch lives in the OS settings.
  useEffect(() => {
    const check = () => void window.browsie?.mic.status().then(setAccess).catch(() => setAccess("unknown"));
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  const allow = async () => {
    if (asking) return;
    setAsking(true);
    try {
      setAccess((await window.browsie?.mic.request()) ?? "unknown");
    } catch {
      setAccess("unknown");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="enter-blur flex h-full flex-col items-center justify-center px-6">
        <h1 className="bric text-center text-5xl font-medium mac:font-normal tracking-tighter">
          Turn on the microphone.
        </h1>
        <p className="mt-4 max-w-[36rem] text-center text-lg font-medium tracking-tight text-zinc-500">
          Browsie is told what to do by voice. It only listens while the spacebar is held down.
        </p>

        <div className="mt-8 flex w-full max-w-[26rem] items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
          <Mic size={20} strokeWidth={2} className="shrink-0 text-zinc-700" aria-hidden="true" />
          <span className="flex flex-1 flex-col">
            <span className="text-sm font-medium tracking-tight text-black">Microphone</span>
            <span className="text-xs font-medium tracking-tight text-zinc-500">Hold the spacebar to talk to Browsie</span>
          </span>
          {granted && (
            <span className="flex items-center gap-1 text-xs font-medium tracking-tight text-[#6b4fd8]">
              <Check size={14} strokeWidth={2.5} aria-hidden="true" /> Allowed
            </span>
          )}
        </div>

        {granted ? (
          <button
            type="button"
            data-click-sound="heavy"
            onClick={onContinue}
            className="smooth app-region-no-drag mt-8 h-10 w-[7.5rem] cursor-pointer rounded-[14px] bg-black text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
          >
            Continue
          </button>
        ) : (
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              data-click-sound="heavy"
              disabled={asking || access === undefined || access === "restricted"}
              onClick={() => (blocked ? void window.browsie?.mic.openSettings() : void allow())}
              className="smooth app-region-no-drag h-10 cursor-pointer rounded-[14px] bg-black px-5 text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
            >
              {blocked ? `Open ${SETTINGS_NAME}` : asking ? "Waiting…" : "Allow microphone"}
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="smooth app-region-no-drag h-10 cursor-pointer rounded-[14px] px-4 text-sm font-medium tracking-tight text-zinc-500 transition-transform duration-300 ease-out hover:scale-105 hover:text-black active:scale-95"
            >
              Skip for now
            </button>
          </div>
        )}

        {/* Reserved height so the layout doesn't jump when a message appears. */}
        <p role="status" className="mt-4 h-10 max-w-[30rem] text-center text-sm tracking-tight text-zinc-600">
          {statusText(access)}
        </p>
      </div>
    </div>
  );
}

export default MicSetup;
