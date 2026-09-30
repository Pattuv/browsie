import Auth from './pages/Auth';
import TitleBar from '../components/TitleBar';

function OnboardingLayer() {
  return (
    <div className="relative h-screen min-h-full">
      <TitleBar />

      <div className="h-full min-h-full">
        <Auth />
      </div>
    </div>
  );
}

export default OnboardingLayer;
