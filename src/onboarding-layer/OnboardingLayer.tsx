import Auth from "./pages/Auth";
import TitleBar from "../components/TitleBar";
import Dashboard from "./pages/Dashboard";

function OnboardingLayer() {
  return (
    <div className="relative h-screen min-h-full">
      {/* Spans Dashboard's top-4 h-8 bar (48px); pt-4 keeps icons centered on that bar */}
      <TitleBar controlsClassName="h-12 *:pt-4" />

      <div className="h-full min-h-full">
        <Auth />
      </div>
    </div>
  );
}

export default OnboardingLayer;
