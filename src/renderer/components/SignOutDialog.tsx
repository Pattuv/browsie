import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import PrimaryButton from "./PrimaryButton";

type SignOutDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * "Are you sure you want to sign out?" Web logins stay on this computer for the account by default,
 * so signing back in brings them back; the checkbox deletes them instead (for shared computers).
 */
function SignOutDialog({ open, onClose }: SignOutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [removeDeviceData, setRemoveDeviceData] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const titleId = useId();
  const explanationId = useId();

  // showModal gives us focus trapping, Escape to cancel and an inert page behind, for free.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      setRemoveDeviceData(false);
      setSigningOut(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);

    try {
      // Main wipes the vault and pushes SIGNED_OUT; the OnboardingLayer gate then swaps Dashboard for Auth.
      await window.browsie?.auth.signOut({ removeDeviceData });
    } finally {
      setSigningOut(false);
      onClose();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();

        if (!signingOut) {
          onClose();
        }
      }}
      className="smooth m-auto w-[22rem] overflow-visible rounded-[34px] border border-zinc-200 bg-white p-5 text-zinc-900 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop:bg-black/25 backdrop:backdrop-blur-[2px]"
    >
      <h2
        id={titleId}
        className="bric text-xl font-medium leading-tight tracking-tight"
      >
        Are you sure you want to sign out?
      </h2>

      <div className="mt-4 flex items-center gap-2.5 rounded-[18px] bg-zinc-100 px-3.5 py-3">
        <input
          id={`${explanationId}-checkbox`}
          type="checkbox"
          checked={removeDeviceData}
          onChange={(event) => setRemoveDeviceData(event.target.checked)}
          aria-describedby={explanationId}
          className="h-4.5 w-4.5 shrink-0 cursor-pointer accent-[#9572FF]"
        />
        <label
          htmlFor={`${explanationId}-checkbox`}
          className="cursor-pointer text-sm tracking-tight text-zinc-800"
        >
          Remove my data from this device
        </label>

        {/* Hover or focus the (i) to read what "my data" means. Screen readers get it from the checkbox itself. */}
        <span
          tabIndex={0}
          aria-label="What data is removed?"
          className="group/tip relative ml-auto flex shrink-0 cursor-default text-zinc-500 outline-none hover:text-zinc-800 focus-visible:text-zinc-800"
        >
          <Info size={16} aria-hidden="true" />
          <span
            id={explanationId}
            role="tooltip"
            className="invisible absolute bottom-full right-0 z-50 pb-2.5 opacity-0 transition-[opacity,visibility] delay-100 duration-150 ease-out group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
          >
            <span className="smooth block w-64 rounded-[20px] bg-black p-3.5 text-left text-xs leading-snug tracking-tight text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
              Deletes the websites you&rsquo;re signed in to in Browsie on this
              computer, like Gmail, Google Drive and school sites, along with
              their cookies and saved site data. You&rsquo;ll need to sign in to
              them again. Your Browsie settings and site permissions are saved
              either way.
            </span>
          </span>
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          disabled={signingOut}
          className="smooth h-10 flex-1 cursor-pointer rounded-[18px] bg-zinc-100 text-base tracking-tight text-zinc-800 transition-[background-color,transform] duration-200 ease-out hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
        >
          No
        </button>
        <PrimaryButton
          onClick={() => void signOut()}
          disabled={signingOut}
          className="smooth h-10! flex-1 rounded-[18px]!"
        >
          {signingOut ? "Signing out…" : "Yes"}
        </PrimaryButton>
      </div>
    </dialog>,
    document.body,
  );
}

export default SignOutDialog;
