import { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import DropdownMenu from '../components/DropdownMenu';
import PrimaryButton from '../components/PrimaryButton';
import { trackChromeMenu } from '../stores/browserStore';
import { BOOKMARKS_BAR, useBookmarksStore } from '../stores/libraryStore';

const library = window.browsie?.library;

// Module-level so it's the same function every render (see TabStrip).
const handleOpenChange = trackChromeMenu('bookmark');

const fieldClassName =
  'smooth h-9 w-full rounded-[12px] border border-zinc-200 bg-white px-3 text-[14px] text-zinc-900 transition-colors hover:border-zinc-300 focus:border-[#9572FF]/60 focus:outline-none';

/** The star's panel: the page is already saved; here you name it and pick where it goes, or remove it. */
function BookmarkEditor({ result, close }: { result: BookmarkResult; close: () => void }) {
  const { bookmark, created } = result;
  const current = useBookmarksStore((state) => state.bookmarks.find((entry) => entry.id === bookmark.id));
  const [title, setTitle] = useState(bookmark.title);
  const titleRef = useRef(title);
  const removed = useRef(false);
  const nameId = useId();
  const placeId = useId();
  titleRef.current = title;

  // The name is saved when the panel closes, however it closes (Done, Enter, Escape, clicking away).
  useEffect(
    () => () => {
      const next = titleRef.current.trim();

      if (!removed.current && next && next !== bookmark.title) {
        void library?.updateBookmark(bookmark.id, { title: next });
      }
    },
    [bookmark.id, bookmark.title],
  );

  const place = (current ?? bookmark).parentId === BOOKMARKS_BAR ? 'bar' : 'other';

  return (
    <form
      className="flex flex-col gap-3 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 className="text-[17px] font-[560] tracking-tight text-zinc-900">
        {created ? 'Bookmark added' : 'Edit bookmark'}
      </h2>

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-[13px] font-[500] tracking-tight text-zinc-500">
          Name
        </label>
        <input
          id={nameId}
          autoFocus
          value={title}
          maxLength={300}
          spellCheck={false}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className={fieldClassName}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={placeId} className="text-[13px] font-[500] tracking-tight text-zinc-500">
          Save in
        </label>
        <span className="relative">
          <select
            id={placeId}
            value={place}
            onChange={(event) =>
              void library?.updateBookmark(bookmark.id, {
                parentId: event.target.value === 'bar' ? BOOKMARKS_BAR : null,
              })
            }
            className={`${fieldClassName} cursor-pointer appearance-none pr-8`}
          >
            <option value="bar">Bookmarks bar</option>
            <option value="other">Other bookmarks</option>
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
        </span>
      </div>

      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => {
            removed.current = true;
            void library?.removeBookmark(bookmark.id);
            close();
          }}
          className="smooth h-10 flex-1 cursor-pointer rounded-[16px] bg-zinc-100 text-[15px] tracking-tight text-zinc-800 transition-[background-color,transform] duration-200 ease-out hover:bg-zinc-200 active:scale-[0.98]"
        >
          Remove
        </button>
        <PrimaryButton type="submit" className="smooth h-10! flex-1 rounded-[16px]! text-[15px]!">
          Done
        </PrimaryButton>
      </div>
    </form>
  );
}

/**
 * The star at the right of the address bar. Pressing it (or Ctrl+D) saves the page to the bookmarks bar
 * and opens a panel to rename it, move it to Other bookmarks, or remove it.
 */
function BookmarkMenu({
  visible,
  armed,
  bookmarked,
  onMouseDown,
}: {
  visible: boolean;
  /** Hit target stays active while the icon is faded, so the field underneath never receives the press. */
  armed: boolean;
  bookmarked: boolean;
  onMouseDown: () => void;
}) {
  const [result, setResult] = useState<BookmarkResult | null>(null);
  // The menu's own open state and toggle, for Ctrl+D (which arrives from main, not from a click).
  const menu = useRef<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => undefined });

  const show = (next: BookmarkResult) => {
    setResult(next);

    if (!menu.current.open) {
      menu.current.toggle();
    }
  };

  useEffect(() => library?.onEditBookmark(show), []);

  return (
    <DropdownMenu
      align="right"
      widthClassName="w-80"
      role="dialog"
      label={result?.created ? 'Bookmark added' : 'Edit bookmark'}
      onOpenChange={handleOpenChange}
      className={`absolute inset-y-0 right-0 z-10 flex w-9 ${armed ? '' : 'pointer-events-none'}`}
      trigger={({ open, toggle }) => {
        menu.current = { open, toggle };

        return (
          <button
            type="button"
            aria-label={bookmarked ? 'Edit bookmark' : 'Bookmark this page'}
            title={bookmarked ? 'Edit bookmark' : 'Bookmark this page (Ctrl+D)'}
            aria-haspopup="dialog"
            aria-expanded={open}
            tabIndex={visible ? 0 : -1}
            aria-hidden={!visible}
            onMouseDown={(event) => {
              // Pressing the button must not focus the field sitting underneath it.
              event.preventDefault();
              event.stopPropagation();
              onMouseDown();
            }}
            onClick={() => {
              if (open) {
                toggle();
                return;
              }

              void library
                ?.bookmarkPage()
                .then((next) => next && show(next))
                .catch((error: unknown) => console.error('Could not bookmark this page:', error));
            }}
            className={`group flex h-full w-full items-center justify-center transition-opacity duration-200 ease-out ${
              bookmarked ? 'text-[#9572FF]' : 'text-zinc-500'
            } ${visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-md transition-[background-color,color,transform] duration-200 ease-out group-hover:bg-zinc-200/80 group-active:scale-90 ${
                bookmarked ? '' : 'group-hover:text-zinc-900'
              } ${open ? 'bg-zinc-200/80' : ''}`}
            >
              <Bookmark size={15} fill={bookmarked ? 'currentColor' : 'none'} aria-hidden="true" />
            </span>
          </button>
        );
      }}
    >
      {(close) => (result ? <BookmarkEditor key={result.bookmark.id} result={result} close={close} /> : null)}
    </DropdownMenu>
  );
}

export default BookmarkMenu;
