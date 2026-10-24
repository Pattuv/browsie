import { useState } from "react";
import { Calendar, Check, HardDrive, Mail } from "lucide-react";
import { useAuthStore } from "../../../stores/authStore";

// Connect step: lets Browsie read and change the account's Gmail, Google Calendar and Google Drive, so it
// can answer "what's on my calendar" or send an email without opening those sites. Google's own
// permission page opens in the browser, like sign-in. Skippable: Browsie still works without it.

const SERVICES = [
  { id: "gmail", label: "Gmail", detail: "Read, send and tidy email", Icon: Mail },
  { id: "calendar", label: "Google Calendar", detail: "Check, add and change events", Icon: Calendar },
  { id: "drive", label: "Google Drive", detail: "Find, read and create files", Icon: HardDrive },
] as const;

type Status = "idle" | "waiting" | "partial" | "failed";

const useConnect = () => {
  const services = useAuthStore((state) => state.googleServices);
  const [status, setStatus] = useState<Status>("idle");
  const allConnected = Boolean(services) && Object.values(services ?? {}).every(Boolean);

  const connect = async () => {
    if (status === "waiting") return;
    setStatus("waiting");
    try {
      const result = await window.browsie?.auth.connectGoogle();
      setStatus(result && Object.values(result).every(Boolean) ? "idle" : "partial");
    } catch {
      setStatus("failed");
    }
  };

  return { services, status, allConnected, connect };
};

const statusText: Record<Status, string> = {
  idle: "",
  waiting: "Finish on Google’s page in your browser, then come back here.",
  partial: "Some boxes weren’t ticked on Google’s page. Connect again and tick all three.",
  failed: "That didn’t work. Please try again.",
};

type GoogleSetupProps = {
  onContinue: () => void;
};

function GoogleSetup({ onContinue }: GoogleSetupProps) {
  const { services, status, allConnected, connect } = useConnect();

  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="enter-blur flex h-full flex-col items-center justify-center px-6">
        <h1 className="bric text-center text-5xl font-medium tracking-tighter">
          Connect Google.
        </h1>
        <p className="mt-4 max-w-[36rem] text-center text-lg font-medium tracking-tight text-zinc-500">
          So Browsie can check email, the calendar and files when asked, without opening the websites.
        </p>

        <ul className="mt-8 flex w-full max-w-[26rem] flex-col gap-2">
          {SERVICES.map(({ id, label, detail, Icon }) => {
            const connected = services?.[id] ?? false;
            return (
              <li key={id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <Icon size={20} strokeWidth={2} className="shrink-0 text-zinc-700" aria-hidden="true" />
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-medium tracking-tight text-black">{label}</span>
                  <span className="text-xs font-medium tracking-tight text-zinc-500">{detail}</span>
                </span>
                {connected && (
                  <span className="flex items-center gap-1 text-xs font-medium tracking-tight text-[#6b4fd8]">
                    <Check size={14} strokeWidth={2.5} aria-hidden="true" /> Connected
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {allConnected ? (
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
              disabled={status === "waiting"}
              onClick={() => void connect()}
              className="smooth app-region-no-drag h-10 cursor-pointer rounded-[14px] bg-black px-5 text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
            >
              {status === "waiting" ? "Waiting for Google…" : "Connect Google"}
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
        <p role="status" className="mt-4 h-5 text-center text-sm tracking-tight text-zinc-600">
          {statusText[status]}
        </p>
      </div>
    </div>
  );
}

// On the Dashboard, for accounts set up before this step existed (or that skipped it).
export function ConnectGoogleButton({ className = "" }: { className?: string }) {
  const { status, connect } = useConnect();
  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <button
        type="button"
        data-click-sound="heavy"
        disabled={status === "waiting"}
        onClick={() => void connect()}
        className="smooth app-region-no-drag mt-3 flex cursor-pointer items-center gap-2 rounded-full bg-[#D7CBFF] px-4 py-2 text-sm font-medium tracking-tight text-black transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
      >
        <Mail size={16} strokeWidth={2} aria-hidden="true" />
        {status === "waiting" ? "Waiting for Google…" : "Connect Gmail, Calendar and Drive"}
      </button>
      <p role="status" className="h-4 text-xs tracking-tight text-zinc-500">
        {statusText[status]}
      </p>
    </div>
  );
}

export default GoogleSetup;
