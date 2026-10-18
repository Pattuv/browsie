import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  MessagesSquare,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react";
import IconButton from "./IconButton";
import SiteInfoMenu from "./SiteInfoMenu";
import { useLockdownStore } from "../stores/browserStore";

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
// so the bar is all yours. `armed` keeps the hit target up even while faded, so a press never falls
// through to the field.
function BarButton({
  label,
  icon: Icon,
  side,
  visible,
  armed,
  onMouseDown,
}: BarButtonProps & { armed: boolean; onMouseDown: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onMouseDown={(event) => {
        // Pressing the button must not focus the field sitting underneath it.
        event.preventDefault();
        event.stopPropagation();
        onMouseDown();
      }}
      className={`group absolute inset-y-0 z-10 flex w-9 items-center justify-center text-zinc-500 transition-opacity duration-200 ease-out ${
        side === "left" ? "left-0" : "right-0"
      } ${visible ? "opacity-100" : "opacity-0"} ${armed ? "" : "pointer-events-none"}`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-md transition-[background-color,color,transform] duration-200 ease-out group-hover:bg-zinc-200/80 group-hover:text-zinc-900 group-active:scale-90">
        <Icon size={15} aria-hidden="true" />
      </span>
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
  const selectFrame = useRef(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const url = tab?.url ?? "";
  const value = editing ? draft : url ? prettyUrl(url) : "";

  // Button presses blur the field and cancel a select that was just scheduled, so the bar
  // never stays in (or snaps back into) edit mode.
  const releaseField = () => {
    cancelAnimationFrame(selectFrame.current);
    inputRef.current?.blur();
    setEditing(false);
  };

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
      <div className="relative h-8 w-full max-w-[31rem] rounded-lg border border-transparent bg-zinc-100 transition-[max-width,background-color,border-color,box-shadow] duration-300 ease-out hover:bg-zinc-200/60 has-[input:focus]:max-w-[34rem] has-[input:focus]:border-[#9572FF]/40 has-[input:focus]:bg-white has-[input:focus]:shadow-[0_0_0_4px_rgba(149,114,255,0.12)] hover:has-[input:focus]:bg-white">
        {/* On a website: site information and bookmark. The bookmark panel lands later; its button is here so the layout is final. */}
        <SiteInfoMenu
          visible={Boolean(url) && !editing}
          armed={Boolean(url)}
          onMouseDown={releaseField}
        />
        <BarButton
          label="Bookmark this page"
          icon={Bookmark}
          side="right"
          visible={Boolean(url) && !editing}
          armed={Boolean(url)}
          onMouseDown={releaseField}
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
            // Select after React has swapped in the full URL. Drop it if focus already left,
            // so a button press in the same moment can't be overwritten by this select.
            const input = event.currentTarget;
            cancelAnimationFrame(selectFrame.current);
            selectFrame.current = requestAnimationFrame(() => {
              if (document.activeElement === input) input.select();
            });
          }}
          onBlur={() => {
            cancelAnimationFrame(selectFrame.current);
            setEditing(false);
          }}
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
          className={`relative z-0 h-full w-full select-text bg-transparent px-9 text-center text-[0.8125rem] tracking-tight text-zinc-700 outline-none placeholder:text-zinc-400 focus:text-zinc-900 selection:bg-[#9572FF]/25`}
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
  const locked = useLockdownStore((state) => state.enabled);
  const delay = (ms: number): CSSProperties => ({
    animationDelay: `${entranceDelay + ms}ms`,
  });

  return (
    <div
      className={`relative flex h-12 shrink-0 items-center border-b border-zinc-300/80 px-2.5 ${locked ? "pointer-events-none" : ""}`}
    >
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
