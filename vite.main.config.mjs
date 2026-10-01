import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // '' prefix = read every key in .env, not just VITE_* ones. Only the two below reach the bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(env.GOOGLE_CLIENT_ID ?? ''),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(env.GOOGLE_CLIENT_SECRET ?? ''),
    },
  };
});
