import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

// The hello → mascot → soundtrack plays once: the first time this install opens onto onboarding.
// Logout, an expired session, and every later launch go straight to the sign-in screen in silence.
const INTRO_PLAYED_KEY = 'browsie-onboarding-intro-played';

const hasPlayedIntro = () => {
  try {
    return localStorage.getItem(INTRO_PLAYED_KEY) === '1';
  } catch {
    return false;
  }
};

const markIntroPlayed = () => {
  try {
    localStorage.setItem(INTRO_PLAYED_KEY, '1');
  } catch {
    // A blocked store just means a future launch might play the intro again.
  }
};

function OnboardingLayer() {
  const status = useAuthStore((state) => state.status);
  // Null until the session is known. Stays true for the whole intro so a re-render can't cut it off.
  const playIntro = useRef<boolean | null>(null);

  if (playIntro.current === null && status !== 'LOADING') {
    playIntro.current = status === 'SIGNED_OUT' && !hasPlayedIntro();
  }

  if (status === 'SIGNED_IN') {
    playIntro.current = false;
  }

  useEffect(() => {
    // Signing in, or actually playing the intro, means this install is past first-open onboarding.
    if (status === 'SIGNED_IN' || playIntro.current === true) {
      markIntroPlayed();
    }
  }, [status]);

  return (
    <div className="relative h-screen min-h-full">
      <header className="app-region-drag absolute inset-x-0 top-0 z-10 h-16" />
      <div className="h-full min-h-full">
        {/* LOADING renders nothing (Auth also starts on white), so Auth never flashes for a signed-in user. */}
        {status === 'SIGNED_IN' && <Dashboard />}
        {status === 'SIGNED_OUT' && <Auth playIntro={playIntro.current === true} />}
      </div>
    </div>
  );
}

export default OnboardingLayer;
