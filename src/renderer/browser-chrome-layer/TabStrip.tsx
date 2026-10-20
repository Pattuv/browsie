import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Globe, LockOpen, Plus, VolumeX, X } from "lucide-react";
import IconButton from "./IconButton";
import ProfileMenu from "../components/ProfileMenu";
import UtilityMenu from "./UtilityMenu";
import { trackChromeMenu, useBrowserStore, useLockdownStore } from "../stores/browserStore";
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
      <path d="M8.5 0 A8.5 7.5 0 0 1 0 7.5 L0 8 L9 8 L9 0 Z" className="fill-white" />
      <path
        d="M8.5 0 A8.5 7.5 0 0 1 0 7.5"
        fill="none"
        className="stroke-(--chrome-border)"
        strokeWidth="1"
      />
    </svg>
  );
}

type TabPillProps = {
  tab: BrowserTab;
  active: boolean;
  /** True only the first time this tab appears, so reordering does not replay the entrance. */
  entering: boolean;
  // Horizontal shift while a drag is in progress. Null when nothing is being dragged.
  shift: { x: number; held: boolean; settling: boolean; duration: number } | null;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onClick: () => void;
  onEntered: () => void;
};

const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DRAG_THRESHOLD = 2;
// How much of a slot-width you have to drag to take that slot. Same for every extra tab.
const SWAP_RATIO = 0.3;

type Slot = { id: number; left: number; width: number };

type Gesture = {
  id: number;
  pointerId: number;
  startX: number;
  active: boolean;
  settling: boolean;
  origin: number;
  hover: number;
  step: number;
  offset: number;
  listWidth: number;
  slots: Slot[];
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const reorder = (ids: number[], from: number, to: number) => {
  const next = ids.slice();
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
};

// One slot per tab-width dragged. SWAP_RATIO is the fraction needed to take the next one.
const slotAt = (origin: number, offset: number, step: number, count: number) => {
  if (step <= 0 || count < 2) {
    return origin;
  }

  const moved = Math.trunc(offset / step + Math.sign(offset) * (1 - SWAP_RATIO));
  return clamp(origin + moved, 0, count - 1);
};

const settleMs = (from: number, to: number) => {
  if (REDUCE_MOTION) {
    return 0;
  }

  return clamp(120 + Math.abs(to - from) * 0.35, 140, 220);
};

const slotStep = (slots: Slot[], origin: number) => {
  if (slots.length < 2) {
    return slots[0]?.width ?? 0;
  }

  return origin < slots.length - 1
    ? slots[origin + 1].left - slots[origin].left
    : slots[origin].left - slots[origin - 1].left;
};

function TabPill({
  tab,
  active,
  entering,
  shift,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onClick,
  onEntered,
}: TabPillProps) {
  const browser = window.browsie?.browser;
  const held = shift?.held ?? false;
  const x = shift?.x ?? 0;
  const duration = shift?.duration ?? 180;
  const slide = REDUCE_MOTION ? "none" : `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;

  return (
    <div
      role="tab"
      data-tab-id={tab.id}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tab.title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        void browser?.showTabMenu(tab.id);
      }}
      onAnimationEnd={(event) => {
        if (entering && event.target === event.currentTarget) {
          onEntered();
        }
      }}
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
      style={{
        transform: shift ? `translateX(${x}px)` : undefined,
        // The drag follows the pointer; only the drop (and the tabs making room) eases into place.
        transition: shift ? (held && !shift.settling ? "none" : slide) : undefined,
        zIndex: held ? 30 : undefined,
        cursor: held ? "grabbing" : undefined,
      }}
      className={`${entering ? "tab-in" : ""} group relative flex min-w-0 max-w-56 flex-1 basis-56 cursor-default touch-none items-center gap-2 pl-3 pr-1.5 text-[0.8125rem] tracking-tight select-none transition-[background-color,color] duration-200 ease-out ${
        active
          ? // Grows down into the toolbar: same white, no bottom border, covers the strip's bottom line.
            "z-10 self-stretch rounded-t-[10px] border border-b-0 border-(--chrome-border) bg-white text-zinc-900"
          : // A 28px pill centered on the strip itself (mb-1.5 offsets the header's pt-1.5),
            // with its title centered in it.
            "mb-1.5 h-7 rounded-lg text-zinc-600 hover:bg-(--chrome-hover) hover:text-zinc-900"
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
      {tab.muted && (
        <VolumeX
          size={12}
          strokeWidth={2}
          aria-label="Muted"
          className="shrink-0 text-zinc-500"
        />
      )}
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          browser?.closeTab(tab.id);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-[opacity,background-color,transform] duration-150 hover:bg-(--chrome-hover) hover:text-zinc-900 focus-visible:opacity-100 active:scale-90 group-hover:opacity-100"
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
      className={`mb-1.5 h-4 w-px shrink-0 bg-(--chrome-divider) transition-opacity duration-150 [[role=tab]:hover+&]:opacity-0 [&:has(+[role=tab]:hover)]:opacity-0 ${
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
  const locked = useLockdownStore((state) => state.enabled);
  const listRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const settleTimer = useRef(0);
  // Tabs we've already seen. Entrance plays once; dragging them around must not replay it.
  const seenTabs = useRef(new Set(tabs.map((tab) => tab.id)));
  const [enteringTabs, setEnteringTabs] = useState(() => new Set(tabs.map((tab) => tab.id)));
  // The order to paint until main confirms the move. Null means paint the store's order.
  const [order, setOrder] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<{
    id: number;
    origin: number;
    hover: number;
    offset: number;
    step: number;
    settling: boolean;
    duration: number;
  } | null>(null);
  const dragging = drag !== null;

  const shown = useMemo(() => {
    if (!order) {
      return tabs;
    }

    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const next = order.flatMap((id) => {
      const tab = byId.get(id);
      return tab ? [tab] : [];
    });

    return next.length === tabs.length ? next : tabs;
  }, [tabs, order]);

  useEffect(() => {
    if (!order) {
      return;
    }

    const ids = tabs.map((tab) => tab.id);
    const sameSet = ids.length === order.length && order.every((id) => ids.includes(id));

    if (!sameSet || ids.every((id, index) => id === order[index])) {
      setOrder(null);
    }
  }, [tabs, order]);

  useEffect(() => {
    const fresh: number[] = [];

    for (const tab of tabs) {
      if (!seenTabs.current.has(tab.id)) {
        seenTabs.current.add(tab.id);
        fresh.push(tab.id);
      }
    }

    if (fresh.length === 0) {
      return;
    }

    setEnteringTabs((current) => {
      const next = new Set(current);
      fresh.forEach((id) => next.add(id));
      return next;
    });
  }, [tabs]);

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";

    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging]);

  const paint = (current: Gesture, duration = 180) => {
    setDrag({
      id: current.id,
      origin: current.origin,
      hover: current.hover,
      offset: current.offset,
      step: current.step,
      settling: current.settling,
      duration,
    });
  };

  const commit = (current: Gesture) => {
    const live = useBrowserStore.getState().tabs.map((tab) => tab.id);
    const slotIds = current.slots.map((slot) => slot.id);
    const unchanged = live.length === slotIds.length && slotIds.every((id, index) => id === live[index]);

    gesture.current = null;
    setDrag(null);

    if (!unchanged || current.hover === current.origin) {
      return;
    }

    setOrder(reorder(slotIds, current.origin, current.hover));
    void window.browsie?.browser.moveTab(current.id, current.hover);
  };

  const settleTo = (current: Gesture, hover: number) => {
    current.hover = hover;
    current.settling = true;
    const target = current.slots[hover].left - current.slots[current.origin].left;
    const duration = settleMs(current.offset, target);

    if (duration === 0) {
      commit(current);
      return;
    }

    // Turn the slide on before moving the tab, or the browser paints the jump without easing it.
    paint(current, duration);
    requestAnimationFrame(() => {
      current.offset = target;
      paint(current, duration);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = 0;

        if (gesture.current === current) {
          commit(current);
        }
      }, duration);
    });
  };

  const onPointerDown = (tab: BrowserTab) => (event: PointerEvent<HTMLDivElement>) => {
    if (locked || event.button !== 0 || gesture.current?.settling) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      active: false,
      settling: false,
      origin: 0,
      hover: 0,
      step: 0,
      offset: 0,
      listWidth: 0,
      slots: [],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;

    if (!current || current.pointerId !== event.pointerId || current.settling) {
      return;
    }

    const dx = event.clientX - current.startX;

    if (!current.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD || !listRef.current) {
        return;
      }

      const listBox = listRef.current.getBoundingClientRect();
      const slots = [...listRef.current.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => {
        const rect = el.getBoundingClientRect();
        return { id: Number(el.dataset.tabId), left: rect.left - listBox.left, width: rect.width };
      });
      const origin = slots.findIndex((slot) => slot.id === current.id);

      if (origin === -1 || slots.length < 2) {
        return;
      }

      current.active = true;
      current.origin = origin;
      current.hover = origin;
      current.slots = slots;
      current.step = slotStep(slots, origin);
      current.listWidth = listBox.width;

      if (current.id !== useBrowserStore.getState().activeTabId) {
        void window.browsie?.browser.activateTab(current.id);
      }
    }

    const { slots, origin, step, listWidth } = current;
    const dragged = slots[origin];
    const offset = clamp(dx, -dragged.left, listWidth - (dragged.left + dragged.width));
    current.offset = offset;
    current.hover = slotAt(origin, offset, step, slots.length);
    paint(current);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;

    if (!current || current.pointerId !== event.pointerId || current.settling) {
      return;
    }

    // Block lostpointercapture (from releasing capture below) from running this twice.
    current.settling = true;

    // Releasing capture retargets the click at whatever is under the cursor (often a close button).
    if (current.active) {
      const stopClick = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
        window.removeEventListener("click", stopClick, true);
      };
      window.addEventListener("click", stopClick, true);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!current.active) {
      gesture.current = null;
      setDrag(null);
      return;
    }

    settleTo(current, current.hover);
  };

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
        className="absolute inset-x-0 bottom-0 h-px bg-(--chrome-border)"
        aria-hidden="true"
      />
      <img
        src={mascot}
        alt=""
        className="theme-invert mb-1.5 h-6 w-6 shrink-0 object-contain"
      />

      <div
        ref={listRef}
        role="tablist"
        aria-label="Tabs"
        className={`flex min-w-0 flex-1 items-center gap-1 self-stretch pl-1 ${locked ? "pointer-events-none" : ""}`}
      >
        {shown.map((tab, index) => {
          const active = tab.id === activeTabId;
          // A divider after each tab (the last one separates it from +), except where it would touch the active tab.
          const nextActive = shown[index + 1]?.id === activeTabId;
          const shift = drag
            ? {
                x:
                  tab.id === drag.id
                    ? drag.offset
                    : drag.hover > drag.origin && index > drag.origin && index <= drag.hover
                      ? -drag.step
                      : drag.hover < drag.origin && index >= drag.hover && index < drag.origin
                        ? drag.step
                        : 0,
                held: tab.id === drag.id,
                settling: drag.settling,
                duration: drag.duration,
              }
            : null;

          return (
            <Fragment key={tab.id}>
              <TabPill
                tab={tab}
                active={active}
                entering={enteringTabs.has(tab.id)}
                shift={shift}
                onPointerDown={onPointerDown(tab)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={() => void window.browsie?.browser.activateTab(tab.id)}
                onEntered={() =>
                  setEnteringTabs((current) => {
                    if (!current.has(tab.id)) {
                      return current;
                    }

                    const next = new Set(current);
                    next.delete(tab.id);
                    return next;
                  })
                }
              />
              <TabDivider hidden={drag !== null || active || nextActive} />
            </Fragment>
          );
        })}
        <IconButton
          label="New tab"
          onClick={() => window.browsie?.browser.newTab()}
          className={`mb-1.5 h-7 w-7 hover:bg-(--chrome-hover)! hover:[&_svg]:rotate-90 ${locked ? "pointer-events-none" : ""}`}
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="mb-1.5 mr-2 flex items-center gap-1">
        <span
          aria-label={locked ? "Lockdown on" : "Lockdown off"}
          title={locked ? "Lockdown on" : "Lockdown off"}
          className={`flex h-8 w-8 items-center justify-center ${locked ? "text-[#9572FF]" : "text-zinc-600"}`}
        >
          {locked ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M7 11V7a5 5 0 0 1 10 0v4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <LockOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <UtilityMenu onOpenChange={handleUtilityOpenChange} />
        <ProfileMenu
          triggerClassName="h-6 w-6 hover:bg-(--chrome-hover)"
          panelTarget="#browser-chrome-card"
          onOpenChange={handleProfileOpenChange}
          quit={{ onClick: () => void window.browsie?.browser.exit() }}
        />
      </div>
    </header>
  );
}

export default TabStrip;
