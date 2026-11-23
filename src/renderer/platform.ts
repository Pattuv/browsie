// Which OS the renderer is on, from preload. For styling, prefer the `mac:` Tailwind variant (index.css).
export const isMac = window.browsie?.platform === 'darwin';
