import fs from 'node:fs';
import path from 'node:path';

// Bits the harness's three modes share.

export const TRACE_DIR = path.resolve(process.cwd(), 'test/web/traces');
export const VIEW = { width: 1280, height: 800 };

const DEBUG = process.env.HARNESS_DEBUG === '1';
// Electron's stdout doesn't always reach a piped terminal on Windows, so debug lines also go to a file.
const LOG_FILE = path.join(TRACE_DIR, 'harness.log');

export const log = (message: string) => {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString().slice(11, 23)}] ${message}`;
  console.log(line);
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `${line}\n`);
};

export const withTimeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms)),
  ]);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export type Check = { name: string; failures: string[]; notes: string[] };

export const printChecks = (title: string, checks: Check[]) => {
  console.log(`\n${title}`);
  for (const check of checks) {
    console.log(`${check.failures.length ? 'FAIL' : 'ok  '} ${check.name}`);
    check.notes.forEach((note) => console.log(`       note: ${note}`));
    check.failures.forEach((failure) => console.log(`       ${failure.replace(/\n/g, '\n       ')}`));
  }
  const passed = checks.filter((check) => check.failures.length === 0).length;
  console.log(`${passed}/${checks.length} passed`);
  return passed === checks.length;
};
