import { useEffect, useRef } from 'react';
import TitleBar from '../components/TitleBar';
import { useAuthStore } from '../stores/authStore';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import { hasCompletedSignIn, markSignInCompleted } from './setupGate';

function OnboardingLayer() {
  const status = useAuthStore((state) => state.status);
  // Null until the session is known. Once true for an Auth visit, stays true so a re-render can't cut it off.
  const playIntro = useRef<boolean | null>(null);

  if (status === 'SIGNED_IN') {
    playIntro.current = false;
  } else if (status === 'SIGNED_OUT' && playIntro.current !== true) {
    // Re-read on every Auth entry (logout, factory reset) until this visit commits to playing the intro.
    playIntro.current = !hasCompletedSignIn();
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
