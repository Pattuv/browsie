import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Minus, Square, X, type LucideIcon } from 'lucide-react';

type CaptionButtonProps = {
  label: string;
  icon: LucideIcon;
  iconSize: number;
  danger?: boolean;
  onClick: () => void;
};

function CaptionButton({ label, icon: Icon, iconSize, danger = false, onClick }: CaptionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`group flex h-full w-12 cursor-pointer items-center justify-center text-zinc-800 transition-colors duration-200 ease-out ${
        danger ? 'hover:text-[#e81123]' : ''
      }`}
    >
      <Icon
        size={iconSize}
        strokeWidth={2}
        aria-hidden="true"
        className="transition-transform duration-200 ease-out group-hover:scale-125 group-active:scale-95"
      />
    </button>
  );
}

function WindowControls({ className = 'h-10', maximizable }: { className?: string; maximizable: boolean }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.browsie?.isWindowMaximized().then((value) => {
      if (!cancelled) {
        setMaximized(value);
      }
    });

    const unsubscribe = window.browsie?.onWindowMaximizedChange(setMaximized);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return (
    <div className={`app-region-no-drag absolute top-0 right-0 z-50 flex ${className}`}>
      <CaptionButton label="Minimize" icon={Minus} iconSize={16} onClick={() => window.browsie?.minimizeWindow()} />
      {maximizable && (
        <CaptionButton
          label={maximized ? 'Restore' : 'Maximize'}
          icon={maximized ? Copy : Square}
          iconSize={13}
          onClick={() => window.browsie?.toggleMaximizeWindow()}
        />
      )}
      <CaptionButton label="Close" icon={X} iconSize={16} danger onClick={() => window.browsie?.closeWindow()} />
    </div>
  );
}

type TitleBarProps = {
  /** Optional leading content (e.g. wordmark). */
  children?: ReactNode;
  /** Sizing for the caption button strip (default `h-10`), so it can match a page's own top bar. */
  controlsClassName?: string;
  /** False hides the maximize button; must match the window's `maximizable` option in main. */
  maximizable?: boolean;
};

/**
 * Drag region for the hidden title bar. On macOS it leaves room for the traffic lights;
 * elsewhere it stops short of the custom caption buttons.
 */
function TitleBar({ children, controlsClassName, maximizable = true }: TitleBarProps) {
  const isMac = window.browsie?.platform === 'darwin';
  // Each caption button is w-12 (3rem).
  const controlsInset = maximizable ? 'right-36' : 'right-24';

  return (
    <>
      {/* Drag region must not overlap the caption buttons, or Windows swallows their clicks. */}
      <header
        className={`app-region-drag absolute top-0 left-0 z-10 flex h-10 items-center ${
          isMac ? 'right-0 pl-16 pr-4' : `${controlsInset} pl-4`
        }`}
      >
        {children}
      </header>
      {isMac ? null : <WindowControls className={controlsClassName} maximizable={maximizable} />}
    </>
  );
}

export default TitleBar;
