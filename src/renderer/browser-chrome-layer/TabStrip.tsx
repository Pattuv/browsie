import { useState, type CSSProperties } from 'react';
import { Globe, Plus, SlidersHorizontal, X } from 'lucide-react';
import IconButton from './IconButton';
import ProfileMenu from '../components/ProfileMenu';
import { useBrowserStore } from '../stores/browserStore';
import mascot from '../assets/mascot.svg';

// The site's icon, or the globe until one arrives (or if it won't decode).
function TabIcon({ favicon }: { favicon: string | null }) {
  const [broken, setBroken] = useState(false);

  if (!favicon || broken) {
    return <Globe size={13} className="shrink-0 text-zinc-500" aria-hidden="true" />;
  }

  return (
    <img
      src={favicon}
      alt=""
      draggable={false}
      onError={() => setBroken(true)}
      className="h-3.5 w-3.5 shrink-0 object-contain"
    />
  );
}

type TabPillProps = {
  tab: BrowserTab;
  active: boolean;
};

function TabPill({ tab, active }: TabPillProps) {
  const browser = window.browsie?.browser;

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tab.title}
      onClick={() => browser?.activateTab(tab.id)}
      // Middle-click closes, like every other browser.
      onAuxClick={(event) => {
        if (event.button === 1) {
          browser?.closeTab(tab.id);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          browser?.activateTab(tab.id);
        }
      }}
      className={`tab-in group flex h-7 min-w-0 max-w-44 flex-1 basis-44 items-center gap-2 rounded-lg border pl-2.5 pr-1 text-[0.8125rem] tracking-tight transition-[background-color,border-color,box-shadow,color] duration-200 ease-out ${
        active
          ? 'border-[#D6CCF8] bg-white text-zinc-900 shadow-[0_1px_2px_rgba(80,50,160,0.08)]'
          : 'border-transparent text-zinc-600 hover:bg-[#E2D9FF] hover:text-zinc-900'
      }`}
    >
      {tab.loading ? (
        <span className="tab-spinner" aria-hidden="true" />
      ) : (
        <TabIcon key={tab.favicon ?? 'none'} favicon={tab.favicon} />
      )}
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation();
          browser?.closeTab(tab.id);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-[opacity,background-color,transform] duration-150 hover:bg-[#E2D9FF] hover:text-zinc-900 focus-visible:opacity-100 active:scale-90 group-hover:opacity-100"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

type TabStripProps = {
  style?: CSSProperties;
};

/** The purple top strip: logo, tabs, new-tab, settings and account. */
function TabStrip({ style }: TabStripProps) {
  const tabs = useBrowserStore((state) => state.tabs);
  const activeTabId = useBrowserStore((state) => state.activeTabId);

  return (
    <header className="chrome-drop absolute inset-x-0 top-0 flex h-11 items-center gap-2 pl-3 pr-2" style={style}>
      <img src={mascot} alt="" className="h-6 w-6 shrink-0 object-contain" />

      <div role="tablist" aria-label="Tabs" className="flex min-w-0 flex-1 items-center gap-1">
        {tabs.map((tab) => (
          <TabPill key={tab.id} tab={tab} active={tab.id === activeTabId} />
        ))}
        <IconButton
          label="New tab"
          onClick={() => window.browsie?.browser.newTab()}
          className="h-7 w-7 hover:bg-[#E2D9FF]! hover:[&_svg]:rotate-90"
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {/* Settings panel lands later; the button is here so the layout is final. */}
      <IconButton label="Settings" className="hover:bg-[#E2D9FF]!">
        <SlidersHorizontal size={16} aria-hidden="true" />
      </IconButton>
      <ProfileMenu
        triggerClassName="h-7 w-7 hover:bg-[#E2D9FF]"
        panelTarget="#browser-chrome-card"
        onOpenChange={(open) => void window.browsie?.browser.setOverlayOpen(open)}
        quit={{ onClick: () => void window.browsie?.browser.exit() }}
      />
    </header>
  );
}

export default TabStrip;
