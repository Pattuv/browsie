import { createRoot } from 'react-dom/client';
import MenuPickerLayer from './menu-picker-layer/MenuPickerLayer';
import OnboardingLayer from './onboarding-layer/OnboardingLayer';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element "#root" not found');
}

const platform = window.browsie?.platform ?? 'darwin';
document.documentElement.dataset.platform = platform;

const windowKind = new URLSearchParams(window.location.search).get('window');

const root = createRoot(container);
root.render(windowKind === 'menu-picker' ? <MenuPickerLayer /> : <OnboardingLayer />);
