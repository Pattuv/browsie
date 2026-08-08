import wordmark from '../assets/wordmark.svg';
import Auth from './pages/Auth';

function OnboardingLayer() {
  return (
    <div className="relative h-screen min-h-full">
      <header className="app-region-drag absolute inset-x-0 top-4 z-10 flex h-10 items-center pl-16">
        <img src={wordmark} alt="Browsie" className="h-5" />
      </header>
      <div className="h-full min-h-full">
        <Auth />
      </div>
    </div>
  );
}

export default OnboardingLayer;
