import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  MessagesSquare,
  RotateCw,
  X,
} from "lucide-react";
import IconButton from "./IconButton";
import BookmarkMenu from "./BookmarkMenu";
import SiteInfoMenu from "./SiteInfoMenu";
import SuggestionList from "./SuggestionList";
import { prettyUrl } from "./prettyUrl";
import { useSuggestions } from "./useSuggestions";
import { trackChromeMenu, useLockdownStore } from "../stores/browserStore";
import { useIsBookmarked } from "../stores/libraryStore";

// The suggestion list hangs down over the website, so it needs the page freeze-frame like the menus.
const trackSuggestionList = trackChromeMenu("suggestions");

// Screen readers hear when the page on screen stops being bookmarked (Remove in the star's panel, or
// from the Bookmarks page). Adding needs no announcement: the panel that opens says "Bookmark added".
// Switching tabs changes the star too, but that's not news, so it stays quiet.
function useBookmarkRemovedAnnouncement(url: string, bookmarked: boolean) {
  const [message, setMessage] = useState("");
  const last = useRef({ url, bookmarked });

  useEffect(() => {
    if (last.current.url === url && last.current.bookmarked && !bookmarked) {
      setMessage("Bookmark removed");
    }

    last.current = { url, bookmarked };
  }, [url, bookmarked]);

  return message;
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
  // Focusing the bar fills it with the page's URL; only asking once the user types keeps that
  // URL from being sent to Google and the list from popping open on every click.
  const [typed, setTyped] = useState(false);
  const listId = useId();
  const suggestions = useSuggestions(draft, editing && typed);
  const listOpen = editing && suggestions.length > 0;
  // The rows on screen. They follow `suggestions` while the list is open, but stay put after it closes
  // so the fade-out has something to fade; the list empties this when the fade is done.
  const [shown, setShown] = useState<Suggestion[]>([]);

  if (listOpen && shown !== suggestions) {
    setShown(suggestions);
  }

  const url = tab?.url ?? "";
  // Browsie's own pages show their address too (browsie://history), except the New Tab page.
  const pageAddress = tab?.page && tab.page !== "newtab" ? `browsie://${tab.page}` : "";
  const value = editing ? draft : url ? prettyUrl(url) : pageAddress;
  const bookmarked = useIsBookmarked(url);
  const bookmarkMessage = useBookmarkRemovedAnnouncement(url, bookmarked);

  // The freeze-frame goes up on the first keystroke, not when results land: capturing the page takes
  // about as long as Google does, so doing both at once means the list can show the moment it arrives.
  // It stays up until the fade-out ends, or the website would cover the list mid-fade.
  // Cleanup runs when it's no longer needed and if the bar unmounts, so the overlay can't be left up.
  const overlayNeeded = (editing && typed) || shown.length > 0;

  useEffect(() => {
    if (!overlayNeeded) return undefined;

    trackSuggestionList(true);
    return () => trackSuggestionList(false);
  }, [overlayNeeded]);

  const pick = (suggestion: Suggestion) => {
    void window.browsie?.browser.navigate(suggestion.text);
    inputRef.current?.blur();
  };

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
        {/* On a website: site information, and the bookmark star (Ctrl+D does the same). */}
        <SiteInfoMenu
          visible={Boolean(url) && !editing}
          armed={Boolean(url)}
          onMouseDown={releaseField}
        />
        <BookmarkMenu
          visible={Boolean(url) && !editing}
          armed={Boolean(url)}
          bookmarked={bookmarked}
          onMouseDown={releaseField}
        />
        <span role="status" className="sr-only">
          {bookmarkMessage}
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Search or enter address"
          placeholder="Search for something or type a URL"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setDraft(event.target.value);
            setTyped(true);
          }}
          onFocus={(event) => {
            setDraft(url || pageAddress);
            setEditing(true);
            setTyped(false);
            void window.browsie?.browser.warmSuggestions();
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
              setDraft(url || pageAddress);
              event.currentTarget.blur();
            }
          }}
          className={`relative z-0 h-full w-full select-text bg-transparent px-9 text-center text-[0.8125rem] tracking-tight text-zinc-700 outline-none placeholder:text-zinc-400 focus:text-zinc-900 selection:bg-[#9572FF]/25`}
        />
        {shown.length > 0 && (
          <SuggestionList
            id={listId}
            query={draft}
            suggestions={shown}
            closing={!listOpen}
            onClosed={() => setShown([])}
            onPick={pick}
          />
        )}
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
