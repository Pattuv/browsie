import { Bookmark, ChevronRight, EllipsisVertical, History, Info, KeyRound, Lock, Settings } from 'lucide-react';
import DropdownMenu, { MenuDivider, MenuGroup, MenuItem } from '../components/DropdownMenu';
import { useLockdownStore } from '../stores/browserStore';
import gmailIcon from '../assets/utility-icons/gmail.svg';
import calendarIcon from '../assets/utility-icons/calendar.svg';
import driveIcon from '../assets/utility-icons/drive.svg';

const GUIDE_URL = 'https://browsie.org/help-center';

const browser = window.browsie?.browser;

const chevron = <ChevronRight size={16} strokeWidth={1.75} className="text-zinc-500" aria-hidden="true" />;

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
        const go = (url: string) => () => {
          close();
          void browser?.newTab(url);
        };

        return (
          <>
            {/* Bookmarks, Passwords and History open their own panels later; the rows are here so the layout is final. */}
            <MenuGroup>
              <MenuItem icon={Bookmark} label="Bookmarks" disabled={locked} trailing={chevron} />
              <MenuItem icon={KeyRound} label="Passwords" disabled={locked} trailing={chevron} />
              <MenuItem icon={History} label="History" disabled={locked} trailing={chevron} />
            </MenuGroup>
            <MenuDivider />
            <MenuGroup>
              <MenuItem icon={Info} label="Browsie Help Center" disabled={locked} onClick={go(GUIDE_URL)} />
              <MenuItem icon={Settings} label="Settings" disabled={locked} />
            </MenuGroup>
            <MenuDivider />
            <MenuGroup>
              <MenuItem icon={gmailIcon} label="Email" disabled={locked} onClick={go('https://mail.google.com')} />
              <MenuItem icon={calendarIcon} label="Calendar" disabled={locked} onClick={go('https://calendar.google.com')} />
              <MenuItem icon={driveIcon} label="Drive" disabled={locked} onClick={go('https://drive.google.com')} />
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
