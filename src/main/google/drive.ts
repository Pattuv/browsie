import { randomUUID } from 'node:crypto';
import type { GoogleToolArgs } from '../../shared/google/tools';
import { clip, type GoogleClient } from './client';

// The user's Google Drive (not Browsie's hidden app folder, which driveClient.ts handles).

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DOCS = 'https://docs.googleapis.com/v1/documents';
const MAX_TEXT = 8_000;
const MAX_DOWNLOAD = 2_000_000;
const DEFAULT_MAX = 10;
const FIELDS = 'id,name,mimeType,modifiedTime,size,owners(displayName),webViewLink';

const MIME = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  pdf: 'application/pdf',
} as const;

const KIND: Record<string, string> = {
  [MIME.doc]: 'Google Doc',
  [MIME.sheet]: 'Google Sheet',
  [MIME.slides]: 'Google Slides',
  [MIME.folder]: 'folder',
  [MIME.pdf]: 'PDF',
};

// Google exports these as text.
const EXPORTS: Record<string, string> = { [MIME.doc]: 'text/plain', [MIME.sheet]: 'text/csv', [MIME.slides]: 'text/plain' };
const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml))/;

type File = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; owners?: { displayName?: string }[] };

// Words go inside single quotes in Drive's query language.
const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const buildDriveQuery = (query?: string, type?: keyof typeof MIME) => {
  const parts = ['trashed = false'];
  if (query?.trim()) parts.push(`(name contains ${quote(query.trim())} or fullText contains ${quote(query.trim())})`);
  if (type) parts.push(`mimeType = ${quote(MIME[type])}`);
  return parts.join(' and ');
};

const summary = (file: File) => ({
  id: file.id,
  name: file.name,
  kind: KIND[file.mimeType] ?? file.mimeType,
  modified: file.modifiedTime,
  owner: file.owners?.[0]?.displayName,
});

export const createDrive = (client: GoogleClient) => {
  const get = (id: string) => client.json<File>('drive', `${FILES}/${encodeURIComponent(id)}?fields=${FIELDS}`);

  return {
    async search({ query, type, max }: GoogleToolArgs<'drive_search'>) {
      const url = new URL(FILES);
      url.searchParams.set('q', buildDriveQuery(query, type));
      url.searchParams.set('pageSize', String(max ?? DEFAULT_MAX));
      url.searchParams.set('fields', `files(${FIELDS})`);
      // Drive can't sort a full-text search, so only plain listings come newest first.
      if (!query?.trim()) url.searchParams.set('orderBy', 'modifiedTime desc');
      const result = await client.json<{ files?: File[] }>('drive', url.toString());
      return { files: (result.files ?? []).map(summary) };
    },

    async read({ id }: GoogleToolArgs<'drive_read'>) {
      const file = await get(id);
      const exportType = EXPORTS[file.mimeType];
      let text: string;
      if (exportType) {
        const response = await client.request('drive', `${FILES}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportType)}`);
        text = await response.text();
      } else if (TEXT_TYPES.test(file.mimeType) && Number(file.size ?? 0) <= MAX_DOWNLOAD) {
        text = await (await client.request('drive', `${FILES}/${encodeURIComponent(id)}?alt=media`)).text();
      } else {
        return { ...summary(file), text: null, note: `Browsie can't read the text of a ${KIND[file.mimeType] ?? file.mimeType} file yet.` };
      }
      return { ...summary(file), text: clip(text.trim(), MAX_TEXT), truncated: text.length > MAX_TEXT };
    },

    async createDoc({ title, text }: GoogleToolArgs<'drive_create_doc'>) {
      // Upload plain text and let Drive turn it into a Google Doc.
      const boundary = `browsie-${randomUUID()}`;
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify({ name: title, mimeType: MIME.doc }),
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        text,
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const file = await client.json<File>('drive', `${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      });
      return { created: summary(file) };
    },

    async appendDoc({ id, text }: GoogleToolArgs<'drive_append_doc'>) {
      const doc = await client.json<{ body?: { content?: { endIndex?: number }[] } }>('drive', `${DOCS}/${encodeURIComponent(id)}?fields=body.content.endIndex`);
      const end = Math.max(1, (doc.body?.content?.at(-1)?.endIndex ?? 2) - 1);
      await client.send('drive', `${DOCS}/${encodeURIComponent(id)}:batchUpdate`, 'POST', {
        requests: [{ insertText: { location: { index: end }, text: `\n${text}` } }],
      });
      return { appended: true };
    },

    async rename({ id, name }: GoogleToolArgs<'drive_rename'>) {
      const file = (await client.send('drive', `${FILES}/${encodeURIComponent(id)}?fields=${FIELDS}`, 'PATCH', { name })) as File;
      return { renamed: summary(file) };
    },

    async trash({ id }: GoogleToolArgs<'drive_trash'>) {
      await client.send('drive', `${FILES}/${encodeURIComponent(id)}`, 'PATCH', { trashed: true });
      return { trashed: true };
    },

    get: async (id: string) => summary(await get(id)),
  };
};

export type Drive = ReturnType<typeof createDrive>;
