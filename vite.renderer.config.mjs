import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Content Security Policy for our own pages: everything must come from the app itself.
// The profile photo arrives as a data: URL from main, so img-src allows data:.
// style-src needs 'unsafe-inline' for Tailwind's dev <style> tags and React style={{...}}.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Dev only: Vite's hot reload injects an inline script and talks over a websocket.
const DEV_CSP = PROD_CSP
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*");

const contentSecurityPolicy = () => ({
  name: 'browsie-csp',
  transformIndexHtml: (_html, ctx) => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? DEV_CSP : PROD_CSP },
      injectTo: 'head-prepend',
    },
  ],
});

// Shown in the browser's New Tab footer.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// https://vitejs.dev/config
export default defineConfig({
    plugins: [contentSecurityPolicy(), react(), tailwindcss()],
    define: {
        __APP_VERSION__: JSON.stringify(version),
    },
});
