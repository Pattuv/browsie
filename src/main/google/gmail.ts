import type { GoogleToolArgs } from '../../shared/google/tools';
import { clip, type GoogleClient } from './client';

// Gmail for the INFO lane. Results are trimmed to what's worth reading aloud; bodies are plain text.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_BODY = 6_000;
const DEFAULT_MAX = 8;

type Header = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; parts?: Part[]; headers?: Header[] };
type Message = { id: string; threadId: string; labelIds?: string[]; snippet?: string; payload?: Part };

const header = (message: Message, name: string) =>
  message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? '';

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

// Plain text if the email has it, else its HTML turned into text.
export const bodyText = (part: Part | undefined): string => {
  if (!part) return '';
  const find = (type: string, node: Part): string | undefined => {
    if (node.mimeType === type && node.body?.data) return decode(node.body.data);
    for (const child of node.parts ?? []) {
      const found = find(type, child);
      if (found) return found;
    }
    return undefined;
  };
  const plain = find('text/plain', part);
  if (plain) return plain.replace(/\r\n/g, '\n').trim();
  const html = find('text/html', part);
  return html ? htmlToText(html) : '';
};

const attachments = (part: Part | undefined): string[] =>
  part ? [...(part.filename ? [part.filename] : []), ...(part.parts ?? []).flatMap(attachments)] : [];

const summary = (message: Message) => ({
  id: message.id,
  from: header(message, 'From'),
  subject: header(message, 'Subject') || '(no subject)',
  date: header(message, 'Date'),
  preview: clip(message.snippet ?? '', 200),
  unread: message.labelIds?.includes('UNREAD') ?? false,
});

// RFC 2822, base64url, as Gmail's send and draft calls want it. Non-ASCII subjects are encoded.
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

export const buildRaw = (mail: { to?: string[]; cc?: string[]; subject?: string; body: string; inReplyTo?: string; references?: string }) => {
  const lines = [
    ...(mail.to?.length ? [`To: ${mail.to.join(', ')}`] : []),
    ...(mail.cc?.length ? [`Cc: ${mail.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(mail.subject ?? '')}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`, `References: ${mail.references || mail.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.body).toString('base64'),
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
};

export const createGmail = (client: GoogleClient) => {
  const get = (id: string, format: 'metadata' | 'full') =>
    client.json<Message>(
      'gmail',
      `${API}/messages/${encodeURIComponent(id)}?format=${format}${format === 'metadata' ? '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To' : ''}`,
    );

  // The headers a reply needs, so it lands in the same conversation.
  const replyContext = async (id: string) => {
    const original = await client.json<Message>(
      'gmail',
      `${API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From&metadataHeaders=Reply-To`,
    );
    const subject = header(original, 'Subject');
    return {
      threadId: original.threadId,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      inReplyTo: header(original, 'Message-ID'),
      references: [header(original, 'References'), header(original, 'Message-ID')].filter(Boolean).join(' '),
      replyTo: header(original, 'Reply-To') || header(original, 'From'),
    };
  };

  const compose = async (args: { to?: string[]; cc?: string[]; subject?: string; body: string; reply_to_id?: string }) => {
    const reply = args.reply_to_id ? await replyContext(args.reply_to_id) : undefined;
    return {
      ...(reply && { threadId: reply.threadId }),
      raw: buildRaw({
        to: args.to,
        cc: args.cc,
        subject: args.subject ?? reply?.subject,
        body: args.body,
        inReplyTo: reply?.inReplyTo,
        references: reply?.references,
      }),
    };
  };

  return {
    async search({ query, max }: GoogleToolArgs<'gmail_search'>) {
      const url = new URL(`${API}/messages`);
      url.searchParams.set('maxResults', String(max ?? DEFAULT_MAX));
      url.searchParams.set('q', query?.trim() || 'in:inbox');
      const list = await client.json<{ messages?: { id: string }[]; resultSizeEstimate?: number }>('gmail', url.toString());
      const messages = await Promise.all((list.messages ?? []).map((entry) => get(entry.id, 'metadata')));
      return { emails: messages.map(summary), more: (list.resultSizeEstimate ?? 0) > messages.length };
    },

    async read({ id }: GoogleToolArgs<'gmail_read'>) {
      const message = await get(id, 'full');
      return {
        ...summary(message),
        to: header(message, 'To'),
        cc: header(message, 'Cc') || undefined,
        body: clip(bodyText(message.payload), MAX_BODY),
        attachments: attachments(message.payload),
      };
    },

    async send(args: GoogleToolArgs<'gmail_send'>) {
      const sent = await client.send('gmail', `${API}/messages/send`, 'POST', await compose(args));
      // Reading it marks the thread as handled for the user.
      return { sent: true, id: (sent as { id?: string }).id };
    },

    async draft(args: GoogleToolArgs<'gmail_draft'>) {
      const saved = await client.send('gmail', `${API}/drafts`, 'POST', { message: await compose(args) });
      return { saved: true, id: (saved as { id?: string }).id };
    },

    async modify({ ids, action }: GoogleToolArgs<'gmail_modify'>) {
      const labels: Record<typeof action, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
        mark_read: { removeLabelIds: ['UNREAD'] },
        mark_unread: { addLabelIds: ['UNREAD'] },
        archive: { removeLabelIds: ['INBOX'] },
        move_to_inbox: { addLabelIds: ['INBOX'] },
        star: { addLabelIds: ['STARRED'] },
        unstar: { removeLabelIds: ['STARRED'] },
      };
      await client.send('gmail', `${API}/messages/batchModify`, 'POST', { ids, ...labels[action] });
      return { changed: ids.length, action };
    },

    async trash({ ids }: GoogleToolArgs<'gmail_trash'>) {
      await Promise.all(ids.map((id) => client.send('gmail', `${API}/messages/${encodeURIComponent(id)}/trash`, 'POST')));
      return { trashed: ids.length };
    },

    // For confirmations: who an email being trashed or replied to is from, and what it's about.
    describe: async (id: string) => {
      const message = await get(id, 'metadata');
      return { from: header(message, 'From'), subject: header(message, 'Subject') || '(no subject)' };
    },
    replyContext,
  };
};

export type Gmail = ReturnType<typeof createGmail>;
