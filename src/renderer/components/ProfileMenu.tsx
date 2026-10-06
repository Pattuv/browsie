import { useEffect, useRef, useState } from "react";
import { DollarSign, Users, type LucideIcon } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import PrimaryButton from "./PrimaryButton";

const OPENROUTER_BILLING_URL = "https://openrouter.ai/settings/credits";

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
  // Still mounted while the blur-out plays; unmounted when that animation ends.
  const [closing, setClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = () => setClosing(true);

  const toggle = () => {
    if (open && !closing) {
      close();
      return;
    }

    setOpen(true);
    setClosing(false);
  };

  // While open, any click outside the avatar + menu closes it.
  useEffect(() => {
    if (!open || closing) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, closing]);

  const changeMode = () => {
    close();
    window.browsie?.openModePicker();
  };

  const openBilling = () => {
    close();
    window.browsie?.openExternal(OPENROUTER_BILLING_URL);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Profile"
        onClick={toggle}
        className="app-region-no-drag flex h-7 w-7 cursor-pointer rounded-full transition-transform duration-150 ease-out active:scale-85"
      >
        <Avatar pictureDataUrl={pictureDataUrl} className="h-7 w-7" />
      </button>

      {open && (
        <div
          onAnimationEnd={(event) => {
            if (closing && event.target === event.currentTarget) {
              setOpen(false);
              setClosing(false);
            }
          }}
          className={`${closing ? "exit-blur-fast pointer-events-none" : "enter-blur-fast"} app-region-no-drag absolute -right-3 top-full mt-3 w-80 rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)]`}
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

          <div className="mt-4 flex flex-col ">
            <MenuItem icon={Users} label="Change mode" onClick={changeMode} />
            <MenuItem
              icon={DollarSign}
              label="Check Openrouter billing"
              onClick={openBilling}
            />
          </div>

          {/* Main wipes the vault and pushes SIGNED_OUT; the OnboardingLayer gate then swaps Dashboard for Auth. */}
          <PrimaryButton
            onClick={() => window.browsie?.auth.signOut()}
            className="mt-3 w-full"
          >
            Log out
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

export default ProfileMenu;
