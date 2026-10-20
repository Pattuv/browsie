import { useEffect, useState } from "react";
import { Globe, Search } from "lucide-react";
import { prettyUrl } from "./prettyUrl";

const MAX_CACHED_IMAGES = 200;

// Image URL → data: URL (or null if it failed). Lets a row that's seen the image before draw it on its
// first frame instead of flashing the plain icon while main is asked again.
const loadedImages = new Map<string, string | null>();

const rememberImage = (url: string, data: string | null) => {
  if (loadedImages.size >= MAX_CACHED_IMAGES) {
    loadedImages.delete(loadedImages.keys().next().value!);
  }

  loadedImages.set(url, data);
};

/** The favicon or thumbnail, once main has it. Until then (or if there isn't one), a plain icon. */
function SuggestionIcon({ suggestion }: { suggestion: Suggestion }) {
  const { image, kind, title } = suggestion;
  const [src, setSrc] = useState(() => (image && loadedImages.get(image)) || null);

  useEffect(() => {
    if (!image) {
      setSrc(null);
      return undefined;
    }

    if (loadedImages.has(image)) {
      setSrc(loadedImages.get(image) ?? null);
      return undefined;
    }

    let live = true;

    window.browsie?.browser
      .suggestionImage(image)
      .then((data) => {
        rememberImage(image, data);
        if (live) setSrc(data);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [image]);

  // Entity thumbnails (a team's logo, a person's photo) are bigger than favicons, like Chrome's.
  const thumbnail = kind === "query" && Boolean(title);

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className={`enter-fade-instant ${thumbnail ? "h-6 w-6 rounded-md object-cover" : "h-4 w-4"}`}
        />
      ) : kind === "url" ? (
        <Globe size={15} strokeWidth={1.75} className="text-zinc-400" />
      ) : (
        <Search size={15} strokeWidth={1.75} className="text-zinc-400" />
      )}
    </span>
  );
}

/** Bolds the part of a suggestion the user hasn't typed yet, like Google does: "denver bro**ncos**". */
function Completion({ text, query }: { text: string; query: string }) {
  const typed = query.trim().toLowerCase();

  if (!typed || !text.toLowerCase().startsWith(typed)) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, typed.length)}
      <span className="font-semibold text-zinc-900">{text.slice(typed.length)}</span>
    </>
  );
}

function SuggestionLabel({ suggestion, query }: { suggestion: Suggestion; query: string }) {
  const { text, kind, title, description } = suggestion;

  if (kind === "url") {
    // "Amazon.com: Online Shopping… – amazon.com". The address matters more, so the title gives way
    // first; a very long address is cut too rather than spilling out of the list.
    return (
      <>
        {title && <span className="min-w-0 shrink-[4] truncate">{title}</span>}
        {title && <span className="shrink-0 text-zinc-400">–</span>}
        <span className="min-w-0 truncate text-(--chrome-link)">{prettyUrl(text)}</span>
      </>
    );
  }

  return (
    <>
      <span className="min-w-0 truncate">
        <Completion text={title ?? text} query={query} />
      </span>
      {description && (
        <>
          <span className="shrink-0 text-zinc-400">–</span>
          <span className="min-w-0 truncate text-zinc-500">{description}</span>
        </>
      )}
    </>
  );
}

type SuggestionListProps = {
  /** The listbox's id, so the address bar can point at it (aria-controls). */
  id: string;
  /** What's typed in the bar, for the bold completion. */
  query: string;
  suggestions: Suggestion[];
  /** Plays the fade-out. The list calls onClosed when it's done, so it can be unmounted. */
  closing: boolean;
  onClosed: () => void;
  onPick: (suggestion: Suggestion) => void;
};

/** The dropdown under the address bar. */
function SuggestionList({ id, query, suggestions, closing, onClosed, onPick }: SuggestionListProps) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Suggestions"
      onAnimationEnd={(event) => {
        // Image fade-ins bubble up here too; only the list's own fade-out counts.
        if (closing && event.target === event.currentTarget) onClosed();
      }}
      className={`${closing ? "exit-fade-instant pointer-events-none" : "enter-fade-instant"} smooth absolute -inset-x-px top-full z-40 mt-2 flex flex-col gap-0.5 rounded-[22px] border border-zinc-200 bg-white p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)]`}
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.kind}:${suggestion.text}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={false}
          // Keep focus in the address bar. Otherwise it blurs on press, the list closes, and the click lands on nothing.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(suggestion)}
          className="smooth flex h-10 cursor-pointer items-center gap-2.5 rounded-[14px] px-2.5 text-[0.8125rem] tracking-tight text-zinc-700 transition-colors duration-150 ease-out hover:bg-zinc-100"
        >
          <SuggestionIcon suggestion={suggestion} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <SuggestionLabel suggestion={suggestion} query={query} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default SuggestionList;
