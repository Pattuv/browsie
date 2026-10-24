import { app, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// `npm run eval:web:app-key -- [harness args]`: runs the agent eval with the OpenRouter key Browsie already
// saved for the signed-in account, so there's no key to paste. The key is decrypted in memory and handed to
// the eval process in its environment; it's never printed or written anywhere.
//
// Uses the real Browsie profile folder only to read the key (safeStorage's key lives in its Local State).

const PROFILE = path.join(process.env.APPDATA ?? app.getPath('appData'), 'Browsie');
app.setPath('userData', PROFILE);

const fail = (message: string) => {
  console.error(message);
  app.exit(1);
};

app.whenReady().then(() => {
  const folder = path.join(PROFILE, 'ai-keys');
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => file.endsWith('.bin')) : [];
  if (files.length !== 1) return fail(`Expected one saved Browsie key in ${folder}, found ${files.length}.`);

  let key: string | undefined;
  try {
    key = (JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(folder, files[0])))) as { aiKey?: string }).aiKey;
  } catch {
    return fail("Couldn't decrypt the saved key.");
  }
  if (!key) return fail('The saved key file has no AI key.');

  // --script=<file> runs another bundled script with the key instead of the agent eval.
  const script = process.argv.find((arg) => arg.startsWith('--script='))?.slice('--script='.length);
  const args = script
    ? [path.resolve(script)]
    : [path.resolve('.vite/harness/harness.cjs'), '--agent', ...process.argv.slice(2).filter((arg) => arg.startsWith('--'))];
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, OPENROUTER_API_KEY: key, ...(script && { ELECTRON_RUN_AS_NODE: '1' }) },
  });
  child.on('exit', (code) => app.exit(code ?? 1));
});
