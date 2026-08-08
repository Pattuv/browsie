import Auth from './pages/Auth';

function OnboardingLayer() {
  return (
    <div className="relative h-screen min-h-full">
      <header className="app-region-drag absolute inset-x-0 top-4 z-10 h-10" />
      <div className="h-full min-h-full">
        <Auth />
      </div>
    </div>
  );
}

export default OnboardingLayer;
