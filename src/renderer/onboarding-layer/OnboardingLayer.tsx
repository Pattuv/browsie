import { useEffect, useRef } from 'react';
import TitleBar from '../components/TitleBar';
import { useAuthStore } from '../stores/authStore';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

// Full hello → mascot → soundtrack until this install has completed a sign-in at least once.
// After that, Auth opens straight on the welcome screen (including after logout).
const HAS_SIGNED_IN_KEY = 'browsie-has-signed-in';

const hasCompletedSignIn = () => {
  try {
    return localStorage.getItem(HAS_SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
};

const markSignInCompleted = () => {
  try {
    localStorage.setItem(HAS_SIGNED_IN_KEY, '1');
  } catch {
    // A blocked store just means a future launch might play the intro again.
  }
};

function OnboardingLayer() {
  const status = useAuthStore((state) => state.status);
  // Null until the session is known. Stays true for the whole intro so a re-render can't cut it off.
  const playIntro = useRef<boolean | null>(null);

  if (playIntro.current === null && status !== 'LOADING') {
    playIntro.current = status === 'SIGNED_OUT' && !hasCompletedSignIn();
  }

  if (status === 'SIGNED_IN') {
    playIntro.current = false;
  }

  useEffect(() => {
    if (status === 'SIGNED_IN') {
      markSignInCompleted();
    }
  }, [status]);

  return (
    <div className="relative h-screen min-h-full">
      {/* Spans Dashboard's top-4 h-8 bar (48px); pt-4 keeps icons centered on that bar */}
      <TitleBar controlsClassName="h-12 *:pt-4" />
      <div className="h-full min-h-full">
        {/* LOADING renders nothing (Auth also starts on white), so Auth never flashes for a signed-in user. */}
        {status === 'SIGNED_IN' && <Dashboard />}
        {status === 'SIGNED_OUT' && <Auth playIntro={playIntro.current === true} />}
      </div>
    </div>
  );
}

export default OnboardingLayer;
