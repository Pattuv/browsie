import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Temporary home: this becomes the migration source inside data/localStore.ts (slice 3).
export type UserMode = 'caretaker' | 'independent';

const userModePath = () => path.join(app.getPath('userData'), 'user-mode.json');

export const hasUserMode = () => fs.existsSync(userModePath());

export const saveUserMode = (mode: UserMode) => {
  fs.writeFileSync(userModePath(), JSON.stringify({ mode }, null, 2));
};

export const readUserMode = (): UserMode | null => {
  try {
    const { mode } = JSON.parse(fs.readFileSync(userModePath(), 'utf8'));
    return mode === 'caretaker' || mode === 'independent' ? mode : null;
  } catch {
    return null;
  }
};
