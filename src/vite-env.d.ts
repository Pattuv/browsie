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

declare module '*.mp3' {
  const src: string;
  export default src;
}

type UserMode = 'caretaker' | 'independent';

interface BrowsieAPI {
  openExternal: (url: string) => Promise<void>;
  shouldAnimateDashboard: () => Promise<boolean>;
  markDashboardPlayed: () => Promise<void>;
  getUserMode: () => Promise<UserMode | null>;
  saveUserMode: (mode: UserMode) => Promise<void>;
}

interface Window {
  browsie?: BrowsieAPI;
}

declare namespace React {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
