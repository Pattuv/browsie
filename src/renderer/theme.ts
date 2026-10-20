import { useEffect, useSyncExternalStore } from 'react';
import { useDataStore } from './stores/dataStore';

// The appearance picked in setup (or later in Settings), saved in the synced settings as `appearance`.
export type Appearance = 'light' | 'dark' | 'system' | 'high-contrast';

export const APPEARANCE_SETTING = 'appearance';

export const readAppearance = (value: unknown): Appearance =>
  value === 'dark' || value === 'system' || value === 'high-contrast' ? value : 'light';

const systemDarkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

const subscribeToSystem = (onChange: () => void) => {
  const query = systemDarkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

// For the main window: puts the appearance on <html> only while `active` (the Dashboard is showing),
// and takes it off again for setup. <html>, not a wrapper, so portaled dialogs are themed too.
export const useThemeWhile = (active: boolean) => {
  const appearance = readAppearance(useDataStore((state) => state.settings[APPEARANCE_SETTING]));
  const systemDark = useSyncExternalStore(subscribeToSystem, () => systemDarkQuery().matches);
  const theme = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [active, theme]);
};

// Browser window: keeps data-theme on <html> in step with the setting (and with Windows, for System).
// index.css turns data-theme into colors.
export const installTheme = () => {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = () => {
    const appearance = readAppearance(useDataStore.getState().settings[APPEARANCE_SETTING]);
    const theme = appearance === 'system' ? (systemDark.matches ? 'dark' : 'light') : appearance;
    document.documentElement.dataset.theme = theme;
  };

  apply();
  useDataStore.subscribe(apply);
  systemDark.addEventListener('change', apply);
};
