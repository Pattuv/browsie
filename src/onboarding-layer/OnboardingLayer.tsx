import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

function OnboardingLayer() {
  return (
    <div className="relative h-screen min-h-full">
      <header className="app-region-drag absolute inset-x-0 top-0 z-10 h-16" />
      <div className="h-full min-h-full">
        <Auth />
      </div>
    </div>
  );
}

export default OnboardingLayer;
