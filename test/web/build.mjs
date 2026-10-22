// Bundles the eval harness, and the agent worker it forks, into CommonJS files Electron can run directly.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
};

// The agent utilityProcess, which the harness forks like the app does.
await build({ ...common, entryPoints: ['src/agent/worker.ts'], outfile: '.vite/harness/worker.cjs' });

await build({ ...common, entryPoints: ['test/web/harness.ts'], outfile: '.vite/harness/harness.cjs' });
