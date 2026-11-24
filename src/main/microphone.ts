import { shell, systemPreferences } from 'electron';

// The operating system's microphone permission for Browsie, for the Microphone step in setup.
// This is the OS-level switch (macOS Privacy & Security, Windows Settings > Privacy > Microphone), not
// Chromium's per-page permission, which windows.ts already grants to the chrome and the speech pill.

export type MicAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

const isMac = process.platform === 'darwin';

export const getMicAccess = (): MicAccess => {
  if (!isMac && process.platform !== 'win32') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('microphone');
  } catch {
    return 'unknown';
  }
};

// macOS shows its own "Browsie would like to access the microphone" prompt the first time. After a
// "Don't Allow" it never asks again, so the step sends people to System Settings instead.
// Windows has no prompt for desktop apps: access is whatever the Settings switches say.
export const requestMicAccess = async (): Promise<MicAccess> => {
  if (isMac && getMicAccess() === 'not-determined') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  }
  return getMicAccess();
};

const SETTINGS_URL = isMac
  ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  : 'ms-settings:privacy-microphone';

export const openMicSettings = () => shell.openExternal(SETTINGS_URL);
