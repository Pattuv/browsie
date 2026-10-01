import { useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

function OnboardingLayer() {
  const status = useAuthStore((state) => state.status);
  // Once this window has shown a signed-in user, any later Auth screen is a logout (or an expired
  // session), not onboarding: skip the hello/mascot intro and the soundtrack.
  const hasBeenSignedIn = useRef(false);
  if (status === 'SIGNED_IN') {
    hasBeenSignedIn.current = true;
  }

  return (
    <div className="relative h-screen min-h-full">
      <header className="app-region-drag absolute inset-x-0 top-0 z-10 h-16" />
      <div className="h-full min-h-full">
        {/* LOADING renders nothing (Auth also starts on white), so Auth never flashes for a signed-in user. */}
        {status === 'SIGNED_IN' && <Dashboard />}
        {status === 'SIGNED_OUT' && <Auth playIntro={!hasBeenSignedIn.current} />}
      </div>
    </div>
  );
}

export default OnboardingLayer;
