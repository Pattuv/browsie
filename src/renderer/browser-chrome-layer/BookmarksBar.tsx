import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronsRight, Globe } from 'lucide-react';
import DropdownMenu, { MenuItem } from '../components/DropdownMenu';
import SiteIcon from './SiteIcon';
import { trackChromeMenu, useActiveTab, useLockdownStore } from '../stores/browserStore';
import { useDataStore } from '../stores/dataStore';
import { useBarBookmarks } from '../stores/libraryStore';

const browser = window.browsie?.browser;

// Module-level so it's the same function every render (see TabStrip).
const handleOverflowOpenChange = trackChromeMenu('bookmarks-overflow');

// Room kept at the right for the » button whenever some bookmarks don't fit.
const OVERFLOW_BUTTON_WIDTH = 36;

// Click opens it here; Ctrl/Cmd-click or middle-click opens it in a new tab, like links on a page.
const open = (url: string, event?: MouseEvent) => {
  if (event && (event.ctrlKey || event.metaKey || event.button === 1)) {
    void browser?.newTab(url);
    return;
  }

  void browser?.navigate(url);
};

// Right-click: on a bookmark (remove it, open it in a new tab), or anywhere on the bar (bookmarks manager,
// when the bar shows). Main draws it as a native menu, so it sits over the website without the freeze-frame.
const showMenu = (event: MouseEvent, id?: string) => {
  event.preventDefault();
  event.stopPropagation();
  void window.browsie?.library.showBookmarkMenu(id);
};

/**
 * The row of bookmarks under the address bar. Gone entirely while nothing is saved to it; otherwise
 * shows always, never, or only on the New Tab page, as picked from its right-click menu
 * (Ctrl+Shift+B shows or hides it).
 */
function BookmarksBar({ style }: { style?: CSSProperties }) {
  const bookmarks = useBarBookmarks();
  const locked = useLockdownStore((state) => state.enabled);
  const setting = useDataStore((state) => state.settings.bookmarksBar);
  const mode: BookmarksBarMode = setting === 'never' || setting === 'newtab' ? setting : 'always';
  const onNewTab = useActiveTab()?.page === 'newtab';
  // Nothing saved to the bar means no bar at all, whatever the setting.
  const visible = bookmarks.length > 0 && (mode === 'always' || (mode === 'newtab' && onNewTab));
  const rowRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(bookmarks.length);

  // How many bookmarks fit in the row; the rest go in the » menu. Measured again whenever the window
  // or the bookmarks change, and when the bar comes back after being hidden.
  useLayoutEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return undefined;
    }

    const measure = () => {
      const items = Array.from(row.querySelectorAll<HTMLElement>('[data-bookmark]'));
      const fitsWithin = (limit: number) =>
        items.filter((item) => item.offsetLeft + item.offsetWidth <= limit).length;
      const all = fitsWithin(row.clientWidth);
      setFits(all === items.length ? all : fitsWithin(row.clientWidth - OVERFLOW_BUTTON_WIDTH));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [bookmarks, visible]);

  if (!visible) {
    return null;
  }

  const hidden = bookmarks.slice(fits);

  return (
    <nav
      aria-label="Bookmarks bar"
      onContextMenu={(event) => showMenu(event)}
      className="chrome-item relative flex h-9 shrink-0 items-center border-b border-zinc-300/80 px-2.5"
      style={style}
    >
      <div ref={rowRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {bookmarks.map((bookmark, index) => {
          const overflowing = index >= fits;

          return (
            <button
              key={bookmark.id}
              type="button"
              data-bookmark
              disabled={locked}
              tabIndex={overflowing ? -1 : undefined}
              aria-hidden={overflowing || undefined}
              title={`${bookmark.title}\n${bookmark.url}`}
              onClick={(event) => bookmark.url && open(bookmark.url, event)}
              onAuxClick={(event) => bookmark.url && event.button === 1 && open(bookmark.url, event)}
              onContextMenu={(event) => showMenu(event, bookmark.id)}
              className={`flex h-7 max-w-[11rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[0.8125rem] tracking-tight text-zinc-700 transition-[background-color,color,transform] duration-150 ease-out enabled:hover:bg-zinc-100 enabled:hover:text-zinc-900 enabled:active:scale-95 disabled:cursor-default ${
                overflowing ? 'invisible' : ''
              }`}
            >
              <SiteIcon src={bookmark.favicon} size={14} />
              <span className="truncate">{bookmark.title}</span>
            </button>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <DropdownMenu
          align="right"
          widthClassName="w-72"
          onOpenChange={handleOverflowOpenChange}
          className="relative ml-1 shrink-0"
          trigger={({ open: menuOpen, toggle }) => (
            <button
              type="button"
              aria-label={`${hidden.length} more ${hidden.length === 1 ? 'bookmark' : 'bookmarks'}`}
              title="More bookmarks"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={locked}
              onClick={toggle}
              className={`flex h-7 w-8 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition-[background-color,color,transform] duration-150 ease-out enabled:hover:bg-zinc-100 enabled:hover:text-zinc-900 enabled:active:scale-90 disabled:cursor-default ${
                menuOpen ? 'bg-zinc-100 text-zinc-900' : ''
              }`}
            >
              <ChevronsRight size={16} aria-hidden="true" />
            </button>
          )}
        >
          {(close) => (
            <div className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
              {hidden.map((bookmark) => (
                // Right-click works here too, same menu as on the bar.
                <div
                  key={bookmark.id}
                  onContextMenu={(event) => {
                    close();
                    showMenu(event, bookmark.id);
                  }}
                >
                  <MenuItem
                    icon={bookmark.favicon ?? Globe}
                    label={bookmark.title}
                    onClick={() => {
                      close();

                      if (bookmark.url) {
                        open(bookmark.url);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </DropdownMenu>
      )}
    </nav>
  );
}

export default BookmarksBar;
