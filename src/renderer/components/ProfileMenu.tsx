import { useEffect, useRef, useState } from 'react';
import { DollarSign, Users, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

const OPENROUTER_BILLING_URL = 'https://openrouter.ai/settings/credits';

// The Google profile photo main downloaded at sign-in (a data: URL), or a grey placeholder.
function Avatar({ pictureDataUrl, className }: { pictureDataUrl?: string; className: string }) {
  if (pictureDataUrl) {
    return <img src={pictureDataUrl} alt="" className={`${className} rounded-full object-cover`} />;
  }

  return (
    <span className={`${className} flex items-end justify-center overflow-hidden rounded-full bg-zinc-300`}>
      <i className="bi bi-person-fill -mb-1.5 text-2xl leading-none text-white" aria-hidden="true" />
    </span>
  );
}

type MenuItemProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
};

function MenuItem({ icon: Icon, label, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 text-left text-base tracking-tight transition-colors duration-200 ease-out hover:bg-zinc-100"
    >
      <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  );
}

function ProfileMenu() {
  const firstName = useAuthStore((state) => state.firstName);
  const email = useAuthStore((state) => state.email);
  const pictureDataUrl = useAuthStore((state) => state.pictureDataUrl);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // While open, any click outside the avatar + menu closes it.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const openBilling = () => {
    setOpen(false);
    window.browsie?.openExternal(OPENROUTER_BILLING_URL);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Profile"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="app-region-no-drag flex h-7 w-7 cursor-pointer rounded-full"
      >
        <Avatar pictureDataUrl={pictureDataUrl} className="h-7 w-7" />
      </button>

      {open && (
        <div className="app-region-no-drag absolute -right-3 top-full mt-3 w-80 rounded-[1.75rem] border border-zinc-500 bg-white p-4">
          <div className="flex items-center gap-3 px-1">
            <Avatar pictureDataUrl={pictureDataUrl} className="h-11 w-11 shrink-0" />
            <div className="min-w-0">
              <p className="bric truncate text-xl leading-tight tracking-tight">{firstName}</p>
              <p className="truncate text-sm tracking-tight text-zinc-500">{email}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col">
            {/* Not wired yet: the mode picker flow is a separate piece of work. */}
            <MenuItem icon={Users} label="Change mode" />
            <MenuItem icon={DollarSign} label="Check Openrouter billing" onClick={openBilling} />
          </div>

          {/* Main wipes the vault and pushes SIGNED_OUT; the OnboardingLayer gate then swaps Dashboard for Auth. */}
          <button
            type="button"
            onClick={() => window.browsie?.auth.signOut()}
            className="mt-3 h-12 w-full cursor-pointer rounded-xl bg-black text-base tracking-tight text-white transition-transform duration-200 ease-out active:scale-[0.98]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default ProfileMenu;
