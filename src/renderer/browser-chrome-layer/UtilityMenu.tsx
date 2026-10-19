import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Bookmark,
  ChevronRight,
  EllipsisVertical,
  Globe,
  History,
  Info,
  Lock,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import DropdownMenu, { MenuDivider, MenuGroup, MenuItem } from '../components/DropdownMenu';
import { useLockdownStore } from '../stores/browserStore';
import { inPlace, useBookmarksStore } from '../stores/libraryStore';
import gmailIcon from '../assets/utility-icons/gmail.svg';
import calendarIcon from '../assets/utility-icons/calendar.svg';
import driveIcon from '../assets/utility-icons/drive.svg';

const GUIDE_URL = 'https://browsie.org/help-center';
const RECENT_HISTORY = 10;
const MAX_BOOKMARKS_SHOWN = 15;
// A pointer crossing the gap between a row and its list shouldn't snap the list shut.
const HOVER_CLOSE_MS = 180;

const browser = window.browsie?.browser;
const library = window.browsie?.library;

const chevron = <ChevronRight size={16} strokeWidth={1.75} className="text-zinc-500" aria-hidden="true" />;

const Note = ({ children }: { children: ReactNode }) => (
  <p className="px-3.5 py-1.5 text-[13px] leading-snug tracking-tight text-zinc-500">{children}</p>
);

type HoverRowProps = {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  /** Clicking the row itself: opens the full page. */
  onClick: () => void;
  /** The list beside the row, shown while it's hovered (or opened with →). */
  children: ReactNode;
};

/**
 * A row with a list beside it: hover (or press →) to see the list, click to open the full page.
 * The list opens to the left, since the menu sits at the window's right edge.
 */
function HoverRow({ icon, label, disabled, onClick, children }: HoverRowProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  const row = () => wrapperRef.current?.querySelector<HTMLButtonElement>(':scope > button');
  const listButtons = () => Array.from(wrapperRef.current?.querySelectorAll<HTMLButtonElement>('[data-side-list] button') ?? []);

  // Keyboard: → opens the list and moves into it, ↑/↓ move within it, ← (or Escape) goes back to the row.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const inList = (event.target as HTMLElement).closest('[data-side-list]');

    if (!inList && event.key === 'ArrowRight' && !disabled) {
      event.preventDefault();
      show();
      requestAnimationFrame(() => listButtons()[0]?.focus());
      return;
    }

    if (!inList) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      row()?.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = listButtons();
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={disabled ? undefined : show}
      onMouseLeave={hideSoon}
      onKeyDown={handleKeyDown}
    >
      <MenuItem icon={icon} label={label} disabled={disabled} expanded={open} trailing={chevron} onClick={onClick} />
      {open && !disabled && (
        // The padding on the right is part of the hover area, so moving across to the list keeps it open.
        <div data-side-list className="absolute top-0 right-full pr-3">
          <div
            role="menu"
            aria-label={label}
            className="enter-blur-fast smooth flex w-72 flex-col gap-0.5 rounded-[28px] border border-zinc-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)]"
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

function RecentHistory({ go, openPage }: { go: (url: string) => void; openPage: () => void }) {
  // Undefined while loading.
  const [visits, setVisits] = useState<Visit[] | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const load = () =>
      library
        ?.listHistory({ limit: RECENT_HISTORY })
        .then((next) => live && setVisits(next))
        .catch(() => live && setVisits([]));

    void load();
    const unsubscribe = library?.onHistoryChanged(() => void load());

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <>
      <p className="px-3.5 pt-1 pb-1.5 text-[13px] font-[500] tracking-tight text-zinc-500">Recently visited</p>
      {visits === undefined ? (
        <div className="h-9" aria-busy="true" />
      ) : visits.length === 0 ? (
        <Note>Pages you visit will show up here.</Note>
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
          {visits.map((visit) => (
            <MenuItem key={visit.id} icon={Globe} label={visit.title} onClick={() => go(visit.url)} />
          ))}
        </div>
      )}
      <MenuDivider />
      <MenuItem icon={History} label="All history" onClick={openPage} />
    </>
  );
}

function OtherBookmarks({ go, openPage }: { go: (url: string) => void; openPage: () => void }) {
  const all = useBookmarksStore((state) => state.bookmarks);
  const bookmarks = inPlace(all, null);

  return (
    <>
      <p className="px-3.5 pt-1 pb-1.5 text-[13px] font-[500] tracking-tight text-zinc-500">Other bookmarks</p>
      {bookmarks.length === 0 ? (
        <Note>Bookmarks you save to Other bookmarks will show up here.</Note>
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
          {bookmarks.slice(0, MAX_BOOKMARKS_SHOWN).map((bookmark) => (
            <MenuItem
              key={bookmark.id}
              icon={bookmark.favicon ?? Globe}
              label={bookmark.title}
              onClick={() => bookmark.url && go(bookmark.url)}
            />
          ))}
        </div>
      )}
      <MenuDivider />
      <MenuItem icon={Bookmark} label="All bookmarks" onClick={openPage} />
    </>
  );
}

type UtilityMenuProps = {
  onOpenChange?: (open: boolean) => void;
};

/** The ⋮ menu in the tab strip: browser tools, help and settings, and Google Workspace shortcuts. */
function UtilityMenu({ onOpenChange }: UtilityMenuProps) {
  const locked = useLockdownStore((state) => state.enabled);

  return (
    <DropdownMenu
      widthClassName="w-68"
      panelTarget="#browser-chrome-card"
      onOpenChange={onOpenChange}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label="Menu"
          title="Menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className={`app-region-no-drag flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-[#E2D9FF] hover:text-zinc-900 active:scale-90 ${
            open ? 'bg-[#E2D9FF] text-zinc-900' : ''
          }`}
        >
          <EllipsisVertical size={16} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => {
        const newTab = (url: string) => () => {
          close();
          void browser?.newTab(url);
        };
        // A bookmark or history entry opens in the tab you're on.
        const go = (url: string) => {
          close();
          void browser?.navigate(url);
        };
        const openPage = (page: 'history' | 'bookmarks') => () => {
          close();
          void browser?.openPage(page);
        };

        return (
          <>
            <MenuGroup>
              <HoverRow icon={Bookmark} label="Bookmarks" disabled={locked} onClick={openPage('bookmarks')}>
                <OtherBookmarks go={go} openPage={openPage('bookmarks')} />
              </HoverRow>
              <HoverRow icon={History} label="History" disabled={locked} onClick={openPage('history')}>
                <RecentHistory go={go} openPage={openPage('history')} />
              </HoverRow>
            </MenuGroup>
            <MenuDivider />
            <MenuGroup>
              <MenuItem icon={Info} label="Browsie Help Center" disabled={locked} onClick={newTab(GUIDE_URL)} />
              <MenuItem icon={Settings} label="Settings" disabled={locked} />
            </MenuGroup>
            <MenuDivider />
            <MenuGroup>
              <MenuItem icon={gmailIcon} label="Email" disabled={locked} onClick={newTab('https://mail.google.com')} />
              <MenuItem icon={calendarIcon} label="Calendar" disabled={locked} onClick={newTab('https://calendar.google.com')} />
              <MenuItem icon={driveIcon} label="Drive" disabled={locked} onClick={newTab('https://drive.google.com')} />
            </MenuGroup>
            {locked && (
              <>
                <MenuDivider />
                <p className="smooth flex items-center gap-2 rounded-[16px] bg-zinc-100 px-3.5 py-2.5 text-[13px] tracking-tight text-zinc-600">
                  <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
                  Lockdown Mode is on
                </p>
              </>
            )}
          </>
        );
      }}
    </DropdownMenu>
  );
}

export default UtilityMenu;
