import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  MessagesSquare,
  RotateCw,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import IconButton from "./IconButton";

// "https://www.example.com/" → "example.com". The full URL comes back when the bar is focused.
const prettyUrl = (url: string) =>
  url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");

type BarButtonProps = {
  label: string;
  icon: LucideIcon;
  side: "left" | "right";
  visible: boolean;
};

// Small icon buttons tucked inside the ends of the address bar. They fade out while you're typing,
// so the bar is all yours.
function BarButton({ label, icon: Icon, side, visible }: BarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={`absolute top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-[opacity,background-color,color,transform] duration-200 ease-out hover:bg-zinc-200/80 hover:text-zinc-900 active:scale-90 ${
        side === "left" ? "left-1.5" : "right-1.5"
      } ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

function AddressBar({
  tab,
  style,
}: {
  tab: BrowserTab | null;
  style?: CSSProperties;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const url = tab?.url ?? "";
  const value = editing ? draft : url ? prettyUrl(url) : "";

  // Ctrl+L / F6 / Alt+D arrive from main, wherever focus was.
  useEffect(
    () =>
      window.browsie?.browser.onFocusAddress(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );

  return (
    <div
      className="chrome-item flex min-w-0 flex-1 justify-center px-6"
      style={style}
    >
      <div className="relative h-8 w-full max-w-[31rem] rounded-lg border border-transparent bg-zinc-100 transition-[max-width,background-color,border-color,box-shadow] duration-300 ease-out hover:bg-zinc-200/60 focus-within:max-w-[34rem] focus-within:border-[#9572FF]/40 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(149,114,255,0.12)] hover:focus-within:bg-white">
        {/* On a website: site settings and bookmark. Both panels land later; the buttons are here so the layout is final. */}
        <BarButton
          label="Site settings"
          icon={Settings2}
          side="left"
          visible={Boolean(url) && !editing}
        />
        <BarButton
          label="Bookmark this page"
          icon={Bookmark}
          side="right"
          visible={Boolean(url) && !editing}
        />
        <input
          ref={inputRef}
          type="text"
          aria-label="Search or enter address"
          placeholder="Search for something or type a URL"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setDraft(url);
            setEditing(true);
            // Select after React has swapped in the full URL.
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              void window.browsie?.browser.navigate(draft);
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              setDraft(url);
              event.currentTarget.blur();
            }
          }}
          className={`relative h-full w-full select-text bg-transparent px-9 text-center text-[0.8125rem] tracking-tight text-zinc-700 outline-none placeholder:text-zinc-400 focus:text-zinc-900 selection:bg-[#9572FF]/25`}
        />
      </div>
    </div>
  );
}

function ReloadButton() {
  // Bumped on each click to replay the one-turn spin.
  const [spins, setSpins] = useState(0);

  return (
    <IconButton
      label="Reload"
      onClick={() => {
        setSpins((count) => count + 1);
        void window.browsie?.browser.reload();
      }}
    >
      <RotateCw
        key={spins}
        size={16}
        aria-hidden="true"
        className={spins ? "spin-once" : ""}
      />
    </IconButton>
  );
}

type ToolbarProps = {
  tab: BrowserTab | null;
  /** Base delay for the launch entrance, in ms. */
  entranceDelay: number;
};

/** The bar at the top of the page card: navigation, address bar, Sessions. */
function Toolbar({ tab, entranceDelay }: ToolbarProps) {
  const browser = window.browsie?.browser;
  const delay = (ms: number): CSSProperties => ({
    animationDelay: `${entranceDelay + ms}ms`,
  });

  return (
    <div className="relative flex h-12 shrink-0 items-center border-b border-zinc-300/80 px-2.5">
      <div className="chrome-item flex items-center gap-0.5" style={delay(0)}>
        <IconButton
          label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => browser?.back()}
          className="hover:[&_svg]:-translate-x-0.5"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => browser?.forward()}
          className="hover:[&_svg]:translate-x-0.5"
        >
          <ArrowRight size={17} aria-hidden="true" />
        </IconButton>
        {tab?.loading ? (
          <IconButton label="Stop loading" onClick={() => browser?.stop()}>
            <X size={17} aria-hidden="true" />
          </IconButton>
        ) : (
          <ReloadButton />
        )}
      </div>

      <AddressBar tab={tab} style={delay(60)} />

      {/* The Sessions panel arrives with the agent; the button is here so the layout is final. */}
      <button
        type="button"
        className="chrome-item flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] tracking-tight text-zinc-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-zinc-100 hover:text-zinc-800 active:scale-95"
        style={delay(120)}
      >
        <MessagesSquare size={15} aria-hidden="true" />
        Sessions
      </button>

      {tab?.loading && (
        <div
          className="loading-bar absolute inset-x-0 -bottom-px h-0.5"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default Toolbar;
