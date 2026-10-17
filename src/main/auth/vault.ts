import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Everything that survives a restart. Encrypted as one blob, so the picture and name are private too.
export type VaultContents = {
  refreshToken: string;
  sub: string;
  firstName: string;
  email?: string;
  pictureDataUrl?: string;
  scopes: string[];
};

const vaultPath = () => path.join(app.getPath('userData'), 'session.bin');

// safeStorage borrows a key from Windows DPAPI.
export const canPersistSecrets = () => safeStorage.isEncryptionAvailable();

export const readVault = (): VaultContents | null => {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultPath())));
  } catch {
    // Missing file, or the OS refused to decrypt it: either way, not signed in.
    return null;
  }
};

// Returns false when nothing was written (DPAPI unavailable), so the caller knows the session won't survive a restart.
export const writeVault = (contents: VaultContents) => {
  if (!canPersistSecrets()) {
    return false;
  }

  // Write-then-rename: a crash mid-write leaves the old vault intact instead of half a file.
  const tempPath = `${vaultPath()}.tmp`;
  fs.writeFileSync(tempPath, safeStorage.encryptString(JSON.stringify(contents)));
  fs.renameSync(tempPath, vaultPath());
  return true;
};

export const clearVault = () => {
  fs.rmSync(vaultPath(), { force: true });
};
