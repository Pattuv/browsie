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

// Everything the UI is ever told about the signed-in user. Never tokens or Google IDs.
type AuthSession = {
  status: 'SIGNED_OUT' | 'SIGNED_IN';
  firstName?: string;
  // Shown in the profile picker.
  email?: string;
  pictureDataUrl?: string;
  syncEnabled?: boolean;
};

interface BrowsieAuthAPI {
  getSession: () => Promise<AuthSession>;
  signIn: () => Promise<AuthSession>;
  cancelSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
  // Returns an unsubscribe function.
  onSessionChanged: (callback: (session: AuthSession) => void) => () => void;
}

interface BrowsieAPI {
  auth: BrowsieAuthAPI;
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
