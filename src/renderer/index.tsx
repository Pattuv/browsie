import { createRoot } from 'react-dom/client';
import BrowserChrome from './browser-chrome-layer/BrowserChrome';
import MenuPickerLayer from './menu-picker-layer/MenuPickerLayer';
import OnboardingLayer from './onboarding-layer/OnboardingLayer';
import { installClickSounds } from './sounds';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element "#root" not found');
}

const platform = window.browsie?.platform ?? 'darwin';
document.documentElement.dataset.platform = platform;
installClickSounds();

const windowKind = new URLSearchParams(window.location.search).get('window');

const layers = {
  'menu-picker': MenuPickerLayer,
  browser: BrowserChrome,
};
const Layer = layers[windowKind as keyof typeof layers] ?? OnboardingLayer;

const root = createRoot(container);
root.render(<Layer />);
