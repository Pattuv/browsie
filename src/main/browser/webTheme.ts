import { nativeTheme, type Session, type WebContents } from 'electron';
import { getData, onDataChange } from '../data/localStore';
import { isDarkBackground, isGoogleSearch } from './pageTheme';

// Websites follow Browsie's appearance through prefers-color-scheme, which Electron takes from
// nativeTheme.themeSource for every page in the app. Light and Dark force it, System hands it back to
// the OS, and High Contrast asks sites for dark (most sites have no high-contrast design of their own).
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

// Google search picks light or dark on its server, and Electron doesn't send the hint Chrome uses to tell it
// (sending it ourselves made Google stay light). So the first search after the appearance changes comes back
// in the old theme; Google's own page script then notices and remembers the right one. One reload picks that
// up. At most one reload per website storage and appearance: if the page still doesn't match (the Google
// account is set to always light or always dark), that's the account's choice and is left alone.
const reloadedFor = new WeakMap<Session, boolean>();
// Google's script needs a moment after the load to remember the theme; reloading at once didn't take.
const SETTLE_MS = 500;

export const matchGoogleTheme = (contents: WebContents) => {
  contents.on('did-finish-load', () => {
    const url = contents.getURL();

    if (!isGoogleSearch(url) || reloadedFor.get(contents.session) === nativeTheme.shouldUseDarkColors) {
      return;
    }

    setTimeout(() => {
      if (contents.isDestroyed() || contents.getURL() !== url) {
        return;
      }

      void contents
        .executeJavaScriptInIsolatedWorld(999, [{ code: 'getComputedStyle(document.body).backgroundColor' }])
        .then((color: unknown) => {
          const dark = nativeTheme.shouldUseDarkColors;
          const pageDark = isDarkBackground(color);

          if (pageDark === null || pageDark === dark || reloadedFor.get(contents.session) === dark) {
            return;
          }

          if (!contents.isDestroyed() && contents.getURL() === url) {
            reloadedFor.set(contents.session, dark);
            contents.reload();
          }
        })
        .catch(() => undefined);
    }, SETTLE_MS);
  });
};

// Once at startup, after the local store has loaded.
export const startWebTheme = () => {
  apply(getData().settings);
  onDataChange((data) => apply(data.settings));
};
