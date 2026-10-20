import { nativeTheme } from 'electron';
import { getData, onDataChange } from '../data/localStore';

// Websites follow Browsie's appearance through prefers-color-scheme, which Electron takes from
// nativeTheme.themeSource for every page in the app. Light and Dark force it, System hands it back to
// Windows, and High Contrast asks sites for dark (most sites have no high-contrast design of their own).
// Browsie's own pages don't read prefers-color-scheme except for System, so forcing it doesn't affect them.
const themeSourceFor = (appearance: unknown): typeof nativeTheme.themeSource => {
  if (appearance === 'dark' || appearance === 'high-contrast') {
    return 'dark';
  }

  return appearance === 'system' ? 'system' : 'light';
};

const apply = (settings: AppData['settings']) => {
  const next = themeSourceFor(settings.appearance);

  if (nativeTheme.themeSource !== next) {
    nativeTheme.themeSource = next;
  }
};

// Once at startup, after the local store has loaded.
export const startWebTheme = () => {
  apply(getData().settings);
  onDataChange((data) => apply(data.settings));
};
