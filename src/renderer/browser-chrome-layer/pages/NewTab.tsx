import { useEffect, useRef, useState, type CSSProperties } from "react";
import { History, X } from "lucide-react";
import DashboardTip, { type Tip } from "../../components/DashboardTip";
import { useBrowserStore, useLockdownNotice, useLockdownStore } from "../../stores/browserStore";
import GoogleAppsMenu from "../GoogleAppsMenu";
import Mascot from "../../components/Mascot";

const GUIDE_URL = "https://browsie.org/help-center";
const RECENT_ACTIVITY = 3;

const MOD = "Ctrl";
// How long the launch notice stays before it dismisses itself.
const NOTICE_MS = 8000;

// Same rotating tips as the dashboard, but about getting around the browser itself.
const BROWSER_TIPS: Tip[] = [
  {
    before: "Open a fresh tab anytime with",
    highlight: `${MOD} + T`,
    after: "",
  },
  {
    before: "Jump straight to the address bar with",
    highlight: `${MOD} + L`,
    after: "and start typing",
  },
  {
    before: "Text too small? Zoom any page in with",
    highlight: `${MOD} + +`,
    after: `and back with ${MOD} + 0`,
  },
  {
    before: "Go back a page with",
    highlight: "Alt + ←",
    after: "or the arrow next to the address bar",
  },
  {
    before: "Close the tab you're on with",
    highlight: `${MOD} + W`,
    after: "or by middle-clicking it",
  },
  { before: "Hop between your tabs with", highlight: "Ctrl + Tab", after: "" },
  {
    before: "Drag a tab along the bar to rearrange it, or move it with",
    highlight: `${MOD} + Shift + PgUp / PgDn`,
    after: "",
  },
  {
    before: "Right-click any link and choose",
    highlight: "Open link in new tab",
    after: "to keep your place",
  },
  {
    before: "Head back to the dashboard with",
    highlight: "Quit",
    after: "in the profile menu",
  },
];

type NewTabProps = {
  /** Base delay for the staggered entrance, in ms. Null shows the page instantly (switching back to a tab). */
  entranceDelay: number | null;
  /** True once the splash has finished and the chrome is on screen. */
  launched: boolean;
};

/** Browsie's own New Tab page. Drawn by the chrome itself, so no website process is involved. */
function LockGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" fill="currentColor" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M7 11V7a5 5 0 0 1 10 0v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockdownNotice({
  locked,
  launched,
  onUnlock,
}: {
  locked: boolean;
  launched: boolean;
  onUnlock: () => void;
}) {
  const barRef = useRef<HTMLSpanElement>(null);
  const noticeOpen = useLockdownNotice((state) => state.open);
  const [present, setPresent] = useState(noticeOpen && locked);
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    useLockdownNotice.setState({ open: false });
    setLeaving(true);
  };

  // Shown again (lockdown came back on after Google sign-in): play it from the start.
  useEffect(() => {
    if (noticeOpen) {
      setPresent(true);
      setLeaving(false);
    }
  }, [noticeOpen]);

  // Unlocking, or starting to talk, dismisses it right away.
  const talking = useBrowserStore((state) => state.talking);

  useEffect(() => {
    if (present && !leaving && (!locked || talking)) {
      close();
    }
  }, [locked, talking, present, leaving]);

  useEffect(() => {
    if (!present || leaving || !launched) {
      return undefined;
    }

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const left = Math.max(0, 1 - (now - start) / NOTICE_MS);
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${left})`;
      }
      if (left === 0) {
        close();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [present, leaving, launched]);

  if (!present || !launched) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-10 -translate-x-1/2">
      <div
        className={`smooth relative flex items-center gap-3 rounded-full bg-black py-2 pr-2 pl-3.5 text-white shadow-[0_10px_28px_-12px_rgba(0,0,0,0.45)] ${
          leaving ? "notice-out pointer-events-none" : "notice-in"
        }`}
        onAnimationEnd={(event) => {
          if (leaving && event.target === event.currentTarget) {
            setPresent(false);
          }
        }}
      >
        <span className="text-[#9572FF]">
          <LockGlyph />
        </span>
        <span className="text-sm tracking-tight">Lockdown mode is on</span>
        <button
          type="button"
          onClick={onUnlock}
          className="smooth h-7 cursor-pointer rounded-[10px] bg-white px-3 text-sm font-medium tracking-tight text-black transition-transform duration-150 ease-out active:scale-[0.98]"
        >
          Unlock
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={close}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-white/45 transition-colors duration-150 hover:text-white/80"
        >
          <X size={13} aria-hidden="true" />
        </button>
        <span className="absolute inset-x-4 bottom-1 h-px overflow-hidden">
          <span ref={barRef} className="block h-full origin-left bg-white/80" />
        </span>
      </div>
    </div>
  );
}

// "12m ago", "Yesterday", "Apr 22". Older years keep the year so they don't read as this one.
const whenLabel = (iso: string) => {
  const date = new Date(iso);
  const time = date.getTime();

  if (Number.isNaN(time)) {
    return "";
  }

  const now = new Date();
  const elapsed = now.getTime() - time;
  const minute = 60_000;
  const hour = 60 * minute;

  if (elapsed < minute) {
    return "Just now";
  }

  if (elapsed < hour) {
    return `${Math.floor(elapsed / minute)}m ago`;
  }

  if (date.toDateString() === now.toDateString()) {
    return `${Math.floor(elapsed / hour)}h ago`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
};

function RecentActivity({ style }: { style?: CSSProperties }) {
  const [visits, setVisits] = useState<Visit[] | undefined>(undefined);
  const browser = window.browsie?.browser;
  const library = window.browsie?.library;

  useEffect(() => {
    let live = true;

    const load = () => {
      if (!library) {
        setVisits([]);
        return;
      }

      void library
        .listHistory({ limit: RECENT_ACTIVITY })
        .then((next) => live && setVisits(next))
        .catch(() => live && setVisits([]));
    };

    void load();
    const unsubscribe = library?.onHistoryChanged(() => void load());

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [library]);

  const shown = visits?.slice(0, RECENT_ACTIVITY) ?? [];
  const hasActivity = shown.length > 0;

  return (
    <section
      className={`smooth chrome-item mt-[clamp(1.5rem,3vh,2.5rem)] w-full max-w-3xl rounded-2xl border border-zinc-200 bg-zinc-50/60 text-sm tracking-tight ${
        hasActivity ? "px-6 py-5" : "flex h-40 items-center justify-center text-zinc-400"
      }`}
      style={style}
      aria-labelledby={hasActivity ? "recent-activity-heading" : undefined}
      aria-label={visits !== undefined && !hasActivity ? "No recent activity" : undefined}
      aria-busy={visits === undefined || undefined}
    >
      {visits === undefined ? (
        <div className="h-full w-full" aria-busy="true" />
      ) : hasActivity ? (
        <>
          <h2 id="recent-activity-heading" className="flex items-center gap-2 text-[15px] font-[560] tracking-tight text-zinc-900">
            <History size={16} strokeWidth={2} aria-hidden="true" />
            Recent activity
          </h2>
          <ol className="relative mt-4 ml-1.5 flex flex-col border-l border-zinc-200">
            {shown.map((visit) => (
              <li key={visit.id} className="relative">
                <span
                  className="absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9572FF] shadow-[0_0_0_3px_var(--color-zinc-50)]"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  role="link"
                  title={`${visit.title}\n${visit.url}`}
                  onClick={() => void browser?.navigate(visit.url)}
                  onAuxClick={(event) => event.button === 1 && void browser?.newTab(visit.url)}
                  className="group flex w-full cursor-pointer items-center gap-6 py-2.5 pr-1 pl-5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] tracking-tight text-zinc-700 transition-colors duration-150 group-hover:text-zinc-900">
                    {visit.title}
                  </span>
                  <span className="shrink-0 text-sm tracking-tight text-zinc-400">{whenLabel(visit.visitedAt)}</span>
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => void browser?.openPage("history")}
            className="mt-3 ml-6.5 cursor-pointer text-[15px] font-[560] tracking-tight text-zinc-800 transition-colors duration-150 hover:text-black"
          >
            See more..
          </button>
        </>
      ) : (
        "No recent activity"
      )}
    </section>
  );
}

function NewTab({ entranceDelay: initialDelay, launched }: NewTabProps) {
  // Decided once, on mount: a re-render must never cut off (or restart) an entrance mid-play.
  const [entranceDelay] = useState(initialDelay);
  const locked = useLockdownStore((state) => state.enabled);
  const toggleLock = useLockdownStore((state) => state.toggle);
  const browser = window.browsie?.browser;
  const delay = (ms: number): CSSProperties => ({
    animationDelay: `${(entranceDelay ?? 0) + ms}ms`,
  });

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center overflow-y-auto px-6 ${
        entranceDelay === null ? "no-entrance" : ""
      } ${locked ? "pointer-events-none" : ""}`}
    >
      <button
        type="button"
        role="link"
        onClick={() => browser?.newTab(GUIDE_URL)}
        className="chrome-item absolute left-4 top-4 text-xs text-zinc-500 underline underline-offset-2 transition-colors duration-150 hover:text-zinc-900"
        style={delay(0)}
      >
        Need help?
      </button>

      <div
        className="chrome-item absolute right-4 top-3 flex items-center gap-1"
        style={delay(40)}
      >
        <GoogleAppsMenu />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(0.5rem,1vh,1rem)] pb-16">
        <Mascot
          className="chrome-item mb-3 h-28 transition-transform duration-500 ease-out hover:-rotate-3 hover:scale-105"
          style={delay(80)}
        />
        <h1
          className="chrome-item bric text-center text-[2.6rem] tracking-tighter text-black"
          style={delay(160)}
        >
          Where to today?
        </h1>
        <p
          className="chrome-item text-[1.0625rem] tracking-tight text-zinc-600"
          style={delay(240)}
        >
          {locked
            ? "Hold the spacebar to talk to Browsie"
            : "Lockdown must be on to talk to Browsie"}
        </p>
        <RecentActivity style={delay(320)} />
      </div>

      <div
        className="chrome-item absolute inset-x-0 bottom-6 flex justify-center px-48"
        style={delay(360)}
      >
        <DashboardTip tips={BROWSER_TIPS} muted />
      </div>

      <LockdownNotice locked={locked} launched={launched} onUnlock={toggleLock} />
    </div>
  );
}

export default NewTab;
