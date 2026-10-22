// Bundles the eval harness, and the agent worker it forks, into CommonJS files Electron can run directly.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// Vite's `import text from './file.md?raw'`, for the agent's prompt files.
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
  plugins: [raw],
};

// The agent utilityProcess, which the harness forks like the app does.
await build({ ...common, entryPoints: ['src/agent/worker.ts'], outfile: '.vite/harness/worker.cjs' });

await build({ ...common, entryPoints: ['test/web/harness.ts'], outfile: '.vite/harness/harness.cjs' });

// Runs the agent eval with the key Browsie saved for the signed-in account.
await build({ ...common, entryPoints: ['test/web/withAppKey.ts'], outfile: '.vite/harness/withAppKey.cjs' });

// Prints the real classifier's raw replies (run with --script through withAppKey).
await build({ ...common, entryPoints: ['test/web/classifyProbe.ts'], outfile: '.vite/harness/classifyProbe.cjs' });
