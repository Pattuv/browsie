import { Fragment, useState, type CSSProperties } from "react";
import { Globe, Plus, X } from "lucide-react";
import IconButton from "./IconButton";
import ProfileMenu from "../components/ProfileMenu";
import UtilityMenu from "./UtilityMenu";
import { trackChromeMenu, useBrowserStore } from "../stores/browserStore";
import mascot from "../assets/mascot.svg";

// The site's icon, or the globe until one arrives (or if it won't decode).
function TabIcon({ favicon }: { favicon: string | null }) {
  const [broken, setBroken] = useState(false);

  if (!favicon || broken) {
    return (
      <Globe size={13} className="shrink-0 text-zinc-500" aria-hidden="true" />
    );
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

// The little outward curves at the bottom of the active tab, where it flows into the strip's
// bottom line (the same trick Chrome uses). White fill hides the line; the stroke continues the border.
function TabEar({ side }: { side: "left" | "right" }) {
  return (
    <svg
      width="9"
      height="8"
      viewBox="0 0 9 8"
      aria-hidden="true"
      // -9px, not -8px: offsets are measured from inside the tab's 1px border, and the curve has to
      // start exactly on that border line or the two meet with a kink.
      className={`pointer-events-none absolute bottom-0 ${side === "left" ? "-left-[9px]" : "-right-[9px] scale-x-[-1]"}`}
    >
      <path d="M8.5 0 A8.5 7.5 0 0 1 0 7.5 L0 8 L9 8 L9 0 Z" fill="#ffffff" />
      <path
        d="M8.5 0 A8.5 7.5 0 0 1 0 7.5"
        fill="none"
        stroke="#D6CCF8"
        strokeWidth="1"
      />
    </svg>
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          browser?.activateTab(tab.id);
        }
      }}
      className={`tab-in group relative flex min-w-0 max-w-56 flex-1 basis-56 items-center gap-2 pl-3 pr-1.5 text-[0.8125rem] tracking-tight transition-[background-color,color] duration-200 ease-out ${
        active
          ? // Grows down into the toolbar: same white, no bottom border, covers the strip's bottom line.
            "z-10 self-stretch rounded-t-[10px] border border-b-0 border-[#D6CCF8] bg-white text-zinc-900"
          : // A 28px pill centered on the strip itself (mb-1.5 offsets the header's pt-1.5),
            // with its title centered in it.
            "mb-1.5 h-7 rounded-lg text-zinc-600 hover:bg-[#E2D9FF] hover:text-zinc-900"
      }`}
    >
      {active && (
        <>
          <TabEar side="left" />
          <TabEar side="right" />
        </>
      )}
      {tab.loading ? (
        <span className="tab-spinner" aria-hidden="true" />
      ) : (
        <TabIcon key={tab.favicon ?? "none"} favicon={tab.favicon} />
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

const handleProfileOpenChange = trackChromeMenu("profile");
const handleUtilityOpenChange = trackChromeMenu("utility");

// The thin line between two tabs. Hidden next to the active tab, and fades out while the tab on
// either side is hovered so it never cuts through a hover highlight.
function TabDivider({ hidden }: { hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mb-1.5 h-4 w-px shrink-0 bg-[#C9BCF5] transition-opacity duration-150 [[role=tab]:hover+&]:opacity-0 [&:has(+[role=tab]:hover)]:opacity-0 ${
        hidden ? "opacity-0" : "opacity-100"
      }`}
    />
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
    // The active tab runs from pt-1.5 down to the strip's bottom edge, its title centered in its own body.
    // Everything else (inactive tabs, dividers, logo, buttons) centers on the strip itself: mb-1.5 on
    // each cancels the header's pt-1.5.
    <header
      className="chrome-drop absolute inset-x-0 top-0 flex h-12 items-center gap-2 pl-3 pr-2 pt-1.5"
      style={style}
    >
      {/* The strip's bottom edge. The active tab sits over it, so the tab reads as part of the page. */}
      <div
        className="absolute inset-x-0 bottom-0 h-px bg-[#D6CCF8]"
        aria-hidden="true"
      />
      <img
        src={mascot}
        alt=""
        className="mb-1.5 h-6 w-6 shrink-0 object-contain"
      />

      <div
        role="tablist"
        aria-label="Tabs"
        className="flex min-w-0 flex-1 items-center gap-1 self-stretch pl-1"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          // A divider after each tab (the last one separates it from +), except where it would touch the active tab.
          const nextActive = tabs[index + 1]?.id === activeTabId;

          return (
            <Fragment key={tab.id}>
              <TabPill tab={tab} active={active} />
              <TabDivider hidden={active || nextActive} />
            </Fragment>
          );
        })}
        <IconButton
          label="New tab"
          onClick={() => window.browsie?.browser.newTab()}
          className="mb-1.5 h-7 w-7 hover:bg-[#E2D9FF]! hover:[&_svg]:rotate-90"
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="mb-1.5 mr-2 flex items-center gap-1">
        <UtilityMenu onOpenChange={handleUtilityOpenChange} />
        <ProfileMenu
          triggerClassName="h-6 w-6 hover:bg-[#E2D9FF]"
          panelTarget="#browser-chrome-card"
          onOpenChange={handleProfileOpenChange}
          quit={{ onClick: () => void window.browsie?.browser.exit() }}
        />
      </div>
    </header>
  );
}

export default TabStrip;
