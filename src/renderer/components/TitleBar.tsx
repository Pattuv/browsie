import type { ReactNode } from 'react';

type TitleBarProps = {
  /** Optional leading content (e.g. the wordmark), already clear of the traffic lights. */
  children?: ReactNode;
  /** Vertical offset. Defaults to the top edge. */
  offsetClassName?: string;
};

/**
 * Drag region for the hidden title bar.
 * Starts at left-20 so it never covers the macOS traffic lights (see trafficLightPosition in main).
 */
function TitleBar({ children, offsetClassName = 'top-0' }: TitleBarProps) {
  return (
    <header
      className={`app-region-drag absolute right-0 left-20 z-10 flex h-12 items-center ${offsetClassName}`}
    >
      {children}
    </header>
  );
}

export default TitleBar;
