import { createRoot } from 'react-dom/client';
import BrowserChrome from './browser-chrome-layer/BrowserChrome';
import SpeechPill from './browser-chrome-layer/SpeechPill';
import OnboardingLayer from './onboarding-layer/OnboardingLayer';
import { installClickSounds } from './sounds';
import { installTheme } from './theme';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element "#root" not found');
}

installClickSounds();

const windowKind = new URLSearchParams(window.location.search).get('window');
// The browser window's page starts see-through (the launch splash sits on the OS-blurred wallpaper).
document.documentElement.dataset.window = windowKind ?? 'main';
// OS-specific layout (traffic lights vs caption buttons) keys off this through the `mac:` variant.
document.documentElement.dataset.platform = window.browsie?.platform ?? '';

// The browser always follows the appearance setting. The main window does only on the Dashboard
// (OnboardingLayer, useThemeWhile); setup keeps its own look.
if (windowKind === 'browser') {
  installTheme();
}

const layers = {
  browser: BrowserChrome,
  speech: SpeechPill,
};
const Layer = layers[windowKind as keyof typeof layers] ?? OnboardingLayer;

const root = createRoot(container);
root.render(<Layer />);
