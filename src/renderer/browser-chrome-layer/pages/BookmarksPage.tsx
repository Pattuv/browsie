import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowRightLeft, ChevronDown, Pencil, Search, Trash2 } from 'lucide-react';
import SiteIcon from '../SiteIcon';
import { prettyUrl } from '../prettyUrl';
import { useLockdownStore } from '../../stores/browserStore';
import { useDataStore } from '../../stores/dataStore';
import { BOOKMARKS_BAR, inPlace, useBookmarksStore } from '../../stores/libraryStore';

const browser = window.browsie?.browser;
const library = window.browsie?.library;

const PLACES = [
  { id: BOOKMARKS_BAR, label: 'Bookmarks bar', other: 'Other bookmarks', empty: 'Save a page here with the bookmark star in the address bar.' },
  { id: null, label: 'Other bookmarks', other: 'Bookmarks bar', empty: 'Nothing saved here yet. Pick “Other bookmarks” in the bookmark star’s panel.' },
] as const;

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-[background-color,color,opacity] duration-150 enabled:hover:bg-zinc-200 enabled:hover:text-zinc-900 disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function BookmarkRow({
  bookmark,
  first,
  last,
  otherPlace,
  reorderable,
}: {
  bookmark: Bookmark;
  first: boolean;
  last: boolean;
  otherPlace: string;
  /** Moving up and down only makes sense in the full list, not in search results. */
  reorderable: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(bookmark.title);
  const linkRef = useRef<HTMLButtonElement>(null);

  const finishRename = (save: boolean) => {
    const next = title.trim();

    if (save && next && next !== bookmark.title) {
      void library?.updateBookmark(bookmark.id, { title: next });
    } else {
      setTitle(bookmark.title);
    }

    setRenaming(false);
    requestAnimationFrame(() => linkRef.current?.focus());
  };

  return (
    <li className="group smooth flex items-center gap-3 rounded-[16px] px-3 py-2 transition-colors duration-150 hover:bg-zinc-100">
      <SiteIcon src={bookmark.favicon} size={16} />

      {renaming ? (
        <input
          aria-label={`New name for ${bookmark.title}`}
          autoFocus
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            if (event.key === 'Escape') finishRename(false);
          }}
          className="smooth h-8 min-w-0 flex-1 rounded-[10px] border border-[#9572FF]/60 bg-white px-2.5 text-[15px] tracking-tight text-zinc-900 outline-none"
        />
      ) : (
        <button
          type="button"
          role="link"
          title={bookmark.url ? `${bookmark.title}\n${bookmark.url}` : bookmark.title}
          ref={linkRef}
          onClick={(event) =>
            bookmark.url && void (event.ctrlKey || event.metaKey ? browser?.newTab(bookmark.url) : browser?.navigate(bookmark.url))
          }
          onAuxClick={(event) => bookmark.url && event.button === 1 && void browser?.newTab(bookmark.url)}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left"
        >
          <span className="min-w-0 truncate text-[15px] font-[460] tracking-tight text-zinc-900 group-hover:underline">
            {bookmark.title}
          </span>
          {bookmark.url && (
            <span className="min-w-0 max-w-[45%] shrink-[3] truncate text-[13px] tracking-tight text-zinc-500">{prettyUrl(bookmark.url)}</span>
          )}
        </button>
      )}

      <div className="flex shrink-0 items-center opacity-60 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
        <ActionButton
          label={`Rename ${bookmark.title}`}
          onClick={() => {
            setTitle(bookmark.title);
            setRenaming(true);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
        </ActionButton>
        {reorderable && (
          <>
            <ActionButton
              label={`Move ${bookmark.title} up`}
              disabled={first}
              onClick={() => void library?.moveBookmark(bookmark.id, -1)}
            >
              <ArrowUp size={15} aria-hidden="true" />
            </ActionButton>
            <ActionButton
              label={`Move ${bookmark.title} down`}
              disabled={last}
              onClick={() => void library?.moveBookmark(bookmark.id, 1)}
            >
              <ArrowDown size={15} aria-hidden="true" />
            </ActionButton>
          </>
        )}
        <ActionButton
          label={`Move ${bookmark.title} to ${otherPlace}`}
          onClick={() =>
            void library?.updateBookmark(bookmark.id, {
              parentId: bookmark.parentId === BOOKMARKS_BAR ? null : BOOKMARKS_BAR,
            })
          }
        >
          <ArrowRightLeft size={15} aria-hidden="true" />
        </ActionButton>
        <ActionButton label={`Remove ${bookmark.title}`} onClick={() => void library?.removeBookmark(bookmark.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </ActionButton>
      </div>
    </li>
  );
}

const BAR_MODES: { value: BookmarksBarMode; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'newtab', label: 'Only on New Tab page' },
  { value: 'never', label: 'Never' },
];

// When the bookmarks bar shows. The same setting as its right-click menu, and the way back after
// "Always hide" (a hidden bar can't be right-clicked).
function BarVisibilityPicker() {
  const setting = useDataStore((state) => state.settings.bookmarksBar);
  const mode: BookmarksBarMode = setting === 'never' || setting === 'newtab' ? setting : 'always';
  const id = useId();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="text-[13px] tracking-tight text-zinc-500">
        Show the bar
      </label>
      <span className="relative">
        <select
          id={id}
          value={mode}
          onChange={(event) =>
            void window.browsie?.data.update({ settings: { bookmarksBar: event.target.value } })
          }
          className="smooth h-8 cursor-pointer appearance-none rounded-[10px] border border-zinc-200 bg-white pr-8 pl-3 text-[13px] text-zinc-800 transition-colors hover:border-zinc-300 focus:border-[#9572FF]/60 focus:outline-none"
        >
          {BAR_MODES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
      </span>
    </div>
  );
}

/** browsie://bookmarks: everything saved, on the bookmarks bar and in Other bookmarks. */
function BookmarksPage() {
  const locked = useLockdownStore((state) => state.enabled);
  const bookmarks = useBookmarksStore((state) => state.bookmarks);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;

  // Screen readers land on the page's title when it opens.
  useEffect(() => headingRef.current?.focus(), []);

  const matches = (bookmark: Bookmark) => {
    const text = `${bookmark.title} ${bookmark.url ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };

  const resultCount = searching ? bookmarks.filter(matches).length : null;

  return (
    <div className={`absolute inset-0 overflow-y-auto ${locked ? 'pointer-events-none' : ''}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pt-10 pb-16">
        <h1 ref={headingRef} tabIndex={-1} className="bric text-[2.4rem] tracking-tighter text-black outline-none">
          Bookmarks
        </h1>

        <label className="smooth flex h-11 items-center gap-2.5 rounded-[16px] border border-zinc-200 bg-white px-3.5 transition-colors focus-within:border-[#9572FF]/60 focus-within:shadow-[0_0_0_4px_rgba(149,114,255,0.12)]">
          <Search size={17} className="shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="sr-only">Search bookmarks</span>
          <input
            type="search"
            value={query}
            spellCheck={false}
            placeholder="Search bookmarks"
            onChange={(event) => setQuery(event.target.value)}
            className="h-full flex-1 bg-transparent text-[15px] tracking-tight text-zinc-900 outline-none placeholder:text-zinc-400"
          />
        </label>

        <p role="status" className="sr-only">
          {resultCount === null ? '' : `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`}
        </p>

        {PLACES.map((place) => {
          const all = inPlace(bookmarks, place.id);
          const shown = searching ? all.filter(matches) : all;

          if (searching && shown.length === 0) {
            return null;
          }

          return (
            <section key={place.label} aria-label={place.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4 px-3">
                <h2 className="flex items-baseline gap-2 text-[15px] font-[560] tracking-tight text-zinc-900">
                  {place.label}
                  <span className="text-[13px] font-normal text-zinc-500">{all.length}</span>
                </h2>
                {place.id === BOOKMARKS_BAR && <BarVisibilityPicker />}
              </div>
              {shown.length === 0 ? (
                <p className="px-3 py-2 text-[14px] tracking-tight text-zinc-500">{place.empty}</p>
              ) : (
                <ul className="flex flex-col">
                  {shown.map((bookmark, index) => (
                    <BookmarkRow
                      key={bookmark.id}
                      bookmark={bookmark}
                      first={index === 0}
                      last={index === shown.length - 1}
                      otherPlace={place.other}
                      reorderable={!searching}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {searching && resultCount === 0 && (
          <p className="py-10 text-center text-[15px] tracking-tight text-zinc-500">No bookmarks match that.</p>
        )}
      </div>
    </div>
  );
}

export default BookmarksPage;
