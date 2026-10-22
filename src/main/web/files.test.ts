import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isExecutable, listUploadable, resolveUploadable, safeFileName, uniquePath } from './files';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'browsie-files-'));

describe('files', () => {
  it('spots executables whatever the case', () => {
    for (const name of ['setup.exe', 'SETUP.EXE', 'run.ps1', 'x.bat', 'a.lnk', 'b.dmg', 'c.jar']) expect(isExecutable(name), name).toBe(true);
    for (const name of ['report.pdf', 'photo.jpg', 'notes.txt', 'exe']) expect(isExecutable(name), name).toBe(false);
  });

  it('keeps only a plain file name', () => {
    expect(safeFileName('../../Windows/system32/evil.dll')).toBe('evil.dll');
    expect(safeFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(safeFileName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(safeFileName('...hidden')).toBe('hidden');
    expect(safeFileName('')).toBe('download');
  });

  it('never overwrites', () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, 'report.pdf'), '');
    fs.writeFileSync(path.join(dir, 'report (1).pdf'), '');
    expect(path.basename(uniquePath(dir, 'report.pdf'))).toBe('report (2).pdf');
  });

  it('only offers files from the folder, newest first, never executables', () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, 'old.pdf'), '');
    fs.utimesSync(path.join(dir, 'old.pdf'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.writeFileSync(path.join(dir, 'resume.pdf'), '');
    fs.writeFileSync(path.join(dir, 'setup.exe'), '');
    fs.mkdirSync(path.join(dir, 'subfolder'));
    expect(listUploadable(dir)).toEqual(['resume.pdf', 'old.pdf']);
  });

  it('only resolves names that are really in the list', () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, 'resume.pdf'), '');
    expect(resolveUploadable(dir, 'resume.pdf')).toBe(path.join(dir, 'resume.pdf'));
    expect(resolveUploadable(dir, '../secret.txt')).toBeUndefined();
    expect(resolveUploadable(dir, 'C:\\Windows\\win.ini')).toBeUndefined();
  });

  it('copes with a folder that does not exist yet', () => {
    expect(listUploadable(path.join(os.tmpdir(), 'no-such-browsie-folder'))).toEqual([]);
  });
});
