import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Development builds only: every step of a voice turn (what was heard, how it was routed, what was said,
// what failed and why) goes to userData/logs/voice.log and the console. Packaged builds keep no log, since
// it holds what people said.

let file: string | undefined;

export const voiceLog = (message: string) => {
  if (app.isPackaged) return;
  const line = `[${new Date().toISOString().slice(11, 23)}] ${message}`;
  console.log(`[voice] ${message}`);
  try {
    file ??= path.join(app.getPath('userData'), 'logs', 'voice.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // Logging must never break the voice layer.
  }
};

export const voiceLogPath = () => path.join(app.getPath('userData'), 'logs', 'voice.log');
