import type { ReactNode } from 'react';

type IconButtonProps = {
  /** Read by screen readers and shown as the hover tooltip. */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** Square icon button for the chrome: soft hover fill, a small press-in, dimmed when disabled. */
function IconButton({ label, onClick, disabled = false, className = '', children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-[background-color,color,transform,opacity] duration-150 ease-out hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 disabled:pointer-events-none disabled:opacity-30 [&_svg]:transition-transform [&_svg]:duration-200 [&_svg]:ease-out ${className}`}
    >
      {children}
    </button>
  );
}

export default IconButton;
