// Full hello → mascot → soundtrack until this install has completed a sign-in at least once.
// After that, setup opens straight on the welcome screen (including after logout).
const HAS_SIGNED_IN_KEY = 'browsie-has-signed-in';

export const hasCompletedSignIn = () => {
  try {
    return localStorage.getItem(HAS_SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
};

export const markSignInCompleted = () => {
  try {
    localStorage.setItem(HAS_SIGNED_IN_KEY, '1');
  } catch {
    // A blocked store just means a future launch might play the intro again.
  }
};

/** Clears the "has signed in" flag so the next setup visit plays the full intro. */
export const clearSignInCompleted = () => {
  try {
    localStorage.removeItem(HAS_SIGNED_IN_KEY);
  } catch {
    // Ignore; a blocked store just means the intro may stay skipped.
  }
};
