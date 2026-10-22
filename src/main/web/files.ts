import type { DownloadItem, Session, WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Downloads and uploads for websites. Downloads save straight into one folder per account with no dialog,
// and executables are cancelled. Uploads can only come from that same folder, picked by name: a page (or
// the agent) can never name a path of its own.

// Cancelled on sight. Opening any of these runs code.
const EXECUTABLE = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'scr', 'pif', 'cpl', 'hta', 'jar', 'lnk', 'reg', 'dll', 'sys', 'iso', 'img', 'vhd', 'vhdx',
  'dmg', 'pkg', 'app', 'command', 'sh', 'run', 'deb', 'rpm', 'appimage',
]);

const MAX_LISTED = 50;

export const isExecutable = (fileName: string) => EXECUTABLE.has(path.extname(fileName).slice(1).toLowerCase());

// Keeps only a plain file name: no folders, no device names, nothing that walks out of the folder.
export const safeFileName = (raw: string) => {
  const base = path.basename(raw.replace(/\\/g, '/')).replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  const name = base.replace(/^\.+/, '').slice(0, 150);
  return name || 'download';
};

// "report.pdf" taken: "report (1).pdf", "report (2).pdf", …
export const uniquePath = (folder: string, fileName: string) => {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(folder, fileName);
  for (let n = 1; fs.existsSync(candidate); n += 1) candidate = path.join(folder, `${stem} (${n})${ext}`);
  return candidate;
};

export type DownloadListener = (contents: WebContents | undefined, fileName: string) => void;

// Hooks a website session's downloads. `allow` says which pages may download at all.
export const handleDownloads = (
  session: Session,
  folder: () => string,
  allow: (contents: WebContents | undefined) => boolean,
  onStarted?: DownloadListener,
) => {
  session.on('will-download', (event, item: DownloadItem, contents) => {
    const fileName = safeFileName(item.getFilename());

    if (!allow(contents) || isExecutable(fileName)) {
      event.preventDefault();
      return;
    }

    const dir = folder();
    fs.mkdirSync(dir, { recursive: true });
    item.setSavePath(uniquePath(dir, fileName));
    onStarted?.(contents, fileName);
  });
};

// What the user can choose from when a page asks for a file. Newest first.
export const listUploadable = (folder: string) => {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !isExecutable(entry.name) && !entry.name.endsWith('.crdownload'))
      .map((entry) => ({ name: entry.name, at: fs.statSync(path.join(folder, entry.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_LISTED)
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

// The full path for a name the user picked, only if it's really one of the listed files.
export const resolveUploadable = (folder: string, name: string) =>
  listUploadable(folder).includes(name) ? path.join(folder, name) : undefined;
