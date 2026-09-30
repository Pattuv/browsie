import { useEffect, useState, type ReactNode } from 'react';

type WindowControlsProps = {
  maximizable?: boolean;
};

/** Windows caption buttons: minimize (−), maximize (□ / ❐), close (×). */
function WindowControls({ maximizable = true }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!maximizable) {
      return undefined;
    }

    let cancelled = false;

    void window.browsie?.windowIsMaximized().then((value) => {
      if (!cancelled) {
        setMaximized(value);
      }
    });

    const unsubscribe = window.browsie?.onWindowMaximizedChanged((value) => {
      setMaximized(value);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [maximizable]);

  return (
    <div className="app-region-no-drag absolute top-0 right-0 z-50 flex h-10">
      <button
        type="button"
        aria-label="Minimize"
        className="flex h-10 w-11 items-center justify-center text-zinc-700 transition-colors hover:bg-zinc-100"
        onClick={() => void window.browsie?.windowMinimize()}
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        disabled={!maximizable}
        aria-disabled={!maximizable}
        className={`flex h-10 w-11 items-center justify-center transition-colors ${
          maximizable
            ? 'text-zinc-700 hover:bg-zinc-100'
            : 'cursor-default text-zinc-300'
        }`}
        onClick={() => {
          if (!maximizable) {
            return;
          }
          void window.browsie?.windowMaximize();
        }}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2.5 2.5H8.5V8.5" stroke="currentColor" strokeWidth="1" />
            <rect x="1" y="3.5" width="5.5" height="5.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        className="flex h-10 w-12 items-center justify-center text-zinc-700 transition-colors hover:bg-[#e81123] hover:text-white"
        onClick={() => void window.browsie?.windowClose()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

type TitleBarProps = {
  /** Optional leading content (e.g. wordmark). Mac keeps left padding for traffic lights. */
  children?: ReactNode;
  maximizable?: boolean;
};

function TitleBar({ children, maximizable = true }: TitleBarProps) {
  const isMac = window.browsie?.platform === 'darwin';
  const showWindowControls = !isMac;

  return (
    <>
      <header
        className={`app-region-drag absolute inset-x-0 top-0 z-10 flex h-10 items-center ${
          isMac ? 'pl-16' : 'pl-4'
        } ${showWindowControls ? 'pr-36' : 'pr-4'}`}
      >
        {children}
      </header>
      {showWindowControls ? <WindowControls maximizable={maximizable} /> : null}
    </>
  );
}

export default TitleBar;
