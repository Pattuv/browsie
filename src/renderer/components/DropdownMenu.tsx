import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

type MenuItemProps = {
  /** A Lucide icon, or an image URL for a brand icon (e.g. the Google Workspace ones). */
  icon: LucideIcon | string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
};

export function MenuItem({ icon: Icon, label, disabled = false, danger = false, trailing, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`smooth flex h-9 w-full cursor-pointer items-center gap-2 rounded-[16px] px-3.5 text-left text-[15px] font-[460] tracking-tight transition-colors duration-200 ease-out disabled:cursor-default disabled:text-zinc-400 ${
        danger ? 'enabled:hover:bg-[#E81123] enabled:hover:text-white' : 'enabled:hover:bg-zinc-100'
      }`}
    >
      {typeof Icon === 'string' ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
          <img src={Icon} alt="" className="max-h-4 max-w-4" />
        </span>
      ) : (
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  );
}

export const MenuDivider = () => <div className="mx-2 h-px shrink-0 bg-zinc-200" />;

/** Rows that belong together sit tighter than the panel's gap between sections. */
export const MenuGroup = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-0.5">{children}</div>
);

type DropdownMenuProps = {
  /** The button that opens the menu. Gets the open state (for aria-expanded) and the toggle. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  /** The panel's contents. `close` plays the blur-out, then unmounts it. */
  children: (close: () => void) => ReactNode;
  /** Panel width, e.g. w-80. */
  widthClassName?: string;
  /** Called while the menu is mounted, including the blur-out, so a browser overlay can stay up. */
  onOpenChange?: (open: boolean) => void;
  /** CSS selector for a chrome card. The panel is portaled there, inset evenly from its top-right corner. */
  panelTarget?: string;
};

/** The white, smoothed-corner popover behind the profile and utility menus. */
function DropdownMenu({ trigger, children, widthClassName = 'w-80', onOpenChange, panelTarget }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  // Still mounted while the blur-out plays; unmounted when that animation ends.
  const [closing, setClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => setClosing(true);

  const toggle = () => {
    if (open && !closing) {
      close();
      return;
    }

    setOpen(true);
    setClosing(false);
  };

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // While open, any click outside the trigger + menu, or Escape, closes it.
  useEffect(() => {
    if (!open || closing) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, closing]);

  const mountPanel = (panel: ReactNode) => {
    if (!panelTarget) {
      return panel;
    }

    const host = document.querySelector(panelTarget);

    return host ? createPortal(panel, host) : panel;
  };

  return (
    <div ref={containerRef} className="relative">
      {trigger({ open: open && !closing, toggle })}

      {open &&
        mountPanel(
          <div
            ref={panelRef}
            role="menu"
            onAnimationEnd={(event) => {
              if (closing && event.target === event.currentTarget) {
                setOpen(false);
                setClosing(false);
              }
            }}
            className={`${closing ? 'exit-blur-fast pointer-events-none' : 'enter-blur-fast'} smooth app-region-no-drag absolute z-40 flex ${widthClassName} flex-col gap-1.5 rounded-[34px] border border-zinc-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] ${
              panelTarget ? 'top-3 right-3' : '-right-3 top-full mt-3'
            }`}
          >
            {children(close)}
          </div>,
        )}
    </div>
  );
}

export default DropdownMenu;
