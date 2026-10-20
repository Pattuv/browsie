// Full hello → mascot → soundtrack unless the last account signed in on this device finished setup.
// Signed out we can't know which account is coming, so this device-level answer picks the intro:
// logging out after setup opens straight on the welcome screen; quitting mid-setup plays it all again.
const SETUP_DONE_KEY = 'browsie-setup-done';

export const hasCompletedSetup = () => {
  try {
    return localStorage.getItem(SETUP_DONE_KEY) === '1';
  } catch {
    return false;
  }
};

export const markSetupCompleted = () => {
  try {
    localStorage.setItem(SETUP_DONE_KEY, '1');
  } catch {
    // A blocked store just means a future launch might play the intro again.
  }
};

/** Clears the flag so the next setup visit plays the full intro. */
export const clearSetupCompleted = () => {
  try {
    localStorage.removeItem(SETUP_DONE_KEY);
  } catch {
    // Ignore; a blocked store just means the intro may stay skipped.
  }
};
