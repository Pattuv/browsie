import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign, LogOut, Users, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import PrimaryButton from './PrimaryButton';

const OPENROUTER_BILLING_URL = 'https://openrouter.ai/settings/credits';

// The Google profile photo main downloaded at sign-in (a data: URL), or a grey placeholder.
function Avatar({
  pictureDataUrl,
  className,
}: {
  pictureDataUrl?: string;
  className: string;
}) {
  if (pictureDataUrl) {
    return (
      <img
        src={pictureDataUrl}
        alt=""
        className={`${className} rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`${className} flex items-end justify-center overflow-hidden rounded-full bg-zinc-300`}
    >
      <i
        className="bi bi-person-fill -mb-1.5 text-2xl leading-none text-white"
        aria-hidden="true"
      />
    </span>
  );
}

type MenuItemProps = {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick?: () => void;
};

function MenuItem({ icon: Icon, label, danger = false, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 text-left text-base tracking-tight transition-colors duration-200 ease-out ${
        danger ? 'hover:bg-[#E81123] hover:text-white' : 'hover:bg-zinc-100'
      }`}
    >
      <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  );
}

type ProfileMenuProps = {
  /** Sizing/hover for the avatar button in the chrome (dashboard keeps the default). */
  triggerClassName?: string;
  /** Called while the menu is mounted, including the blur-out, so a browser overlay can stay up. */
  onOpenChange?: (open: boolean) => void;
  /** Replaces Log out: e.g. Quit in the browser chrome, which leaves the browser for the dashboard. */
  quit?: { label?: string; onClick: () => void };
  /** CSS selector for a chrome card. The panel is portaled there, inset evenly from its top-right corner. */
  panelTarget?: string;
};

function ProfileMenu({ triggerClassName = 'h-7 w-7', onOpenChange, quit, panelTarget }: ProfileMenuProps) {
  const firstName = useAuthStore((state) => state.firstName);
  const email = useAuthStore((state) => state.email);
  const pictureDataUrl = useAuthStore((state) => state.pictureDataUrl);
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

  // While open, any click outside the avatar + menu, or Escape, closes it.
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

  const changeMode = () => {
    close();
    window.browsie?.openModePicker();
  };

  const openBilling = () => {
    close();
    window.browsie?.openExternal(OPENROUTER_BILLING_URL);
  };

  const quitApp = () => {
    close();
    quit?.onClick();
  };

  const mountPanel = (panel: ReactNode) => {
    if (!panelTarget) {
      return panel;
    }

    const host = document.querySelector(panelTarget);

    return host ? createPortal(panel, host) : panel;
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Profile"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        onClick={toggle}
        className={`app-region-no-drag flex cursor-pointer items-center justify-center rounded-full transition-[background-color,transform] duration-150 ease-out active:scale-85 ${triggerClassName}`}
      >
        <Avatar pictureDataUrl={pictureDataUrl} className="h-full w-full" />
      </button>

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
            className={`${closing ? 'exit-blur-fast pointer-events-none' : 'enter-blur-fast'} app-region-no-drag absolute z-40 w-80 rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] ${
              panelTarget ? 'top-3 right-3' : '-right-3 top-full mt-3'
            }`}
          >
          <div className="flex items-center gap-3 px-1">
            <Avatar
              pictureDataUrl={pictureDataUrl}
              className="h-11 w-11 shrink-0"
            />
            <div className="min-w-0">
              <p className="bric truncate text-xl leading-tight tracking-tight">
                {firstName}
              </p>
              <p className="truncate text-sm tracking-tight text-zinc-500">
                {email}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col">
            <MenuItem icon={Users} label="Change mode" onClick={changeMode} />
            <MenuItem
              icon={DollarSign}
              label="Check Openrouter billing"
              onClick={openBilling}
            />
          </div>

          {quit ? (
            <>
              <div className="mx-1 my-2 h-px bg-zinc-200" />
              <MenuItem icon={LogOut} label={quit.label ?? 'Quit'} danger onClick={quitApp} />
            </>
          ) : (
            // Main wipes the vault and pushes SIGNED_OUT; the OnboardingLayer gate then swaps Dashboard for Auth.
            <PrimaryButton
              onClick={() => window.browsie?.auth.signOut()}
              className="mt-3 w-full"
            >
              Log out
            </PrimaryButton>
          )}
          </div>,
        )}
    </div>
  );
}

export default ProfileMenu;
