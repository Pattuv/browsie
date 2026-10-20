import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import SettingsContent from "./SettingsContent";

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

// The Dashboard's Settings popup. Same contents as browsie://settings in the browser.
function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // showModal gives us focus trapping, Escape to close and an inert page behind, for free.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the dialog itself; inside the panel it lands on its children.
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="smooth m-auto max-h-[calc(100vh-4rem)] w-[min(48rem,calc(100vw-4rem))] overflow-y-auto rounded-[34px] border border-zinc-200 bg-white p-0 text-zinc-900 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop:bg-black/25 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-7">
        <div className="mb-7 flex items-center justify-between">
          <h1 id={titleId} className="bric text-3xl font-medium tracking-tighter text-black">
            Settings
          </h1>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 hover:text-black"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <SettingsContent />
      </div>
    </dialog>,
    document.body,
  );
}

export default SettingsDialog;
