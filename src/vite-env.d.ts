/// <reference types="vite/client" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

interface TheoAPI {
  openExternal: (url: string) => Promise<void>;
  shouldAnimateOnboarding: () => Promise<boolean>;
  markOnboardingPlayed: () => Promise<void>;
}

interface Window {
  theo?: TheoAPI;
}

declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
