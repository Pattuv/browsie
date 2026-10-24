import { describe, expect, it, vi } from 'vitest';
import { toEventTime, toInstant } from './calendar';
import { GoogleApiError } from './client';
import { buildDriveQuery } from './drive';
import { bodyText, buildRaw } from './gmail';
import { createGoogleTools, spokenTime } from './tools';
import { parseGoogleCall } from '../../shared/google/tools';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const setup = (respond: (url: string, init: RequestInit) => Response) => {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => respond(String(url), init));
  const tools = createGoogleTools({
    getToken: async () => 'token',
    invalidateToken: vi.fn(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeZone: () => 'America/New_York',
  });
  return { tools, fetchImpl };
};

describe('calendar times', () => {
  it('turns wall-clock times in the user’s zone into instants', () => {
    expect(toInstant('2026-10-24T17:00:00', 'America/New_York')).toBe('2026-10-24T21:00:00.000Z');
    expect(toInstant('2026-12-24T17:00', 'America/New_York')).toBe('2026-12-24T22:00:00.000Z');
    expect(toInstant('2026-10-24', 'America/New_York')).toBe('2026-10-24T04:00:00.000Z');
    expect(toInstant('2026-10-24', 'America/New_York', true)).toBe('2026-10-25T03:59:59.000Z');
  });

  it('sends events as times with a zone, or dates for all-day', () => {
    expect(toEventTime('2026-10-24T17:00', 'America/New_York')).toEqual({ dateTime: '2026-10-24T17:00:00', timeZone: 'America/New_York' });
    expect(toEventTime('2026-10-24', 'America/New_York')).toEqual({ date: '2026-10-24' });
  });

  it('reads times the way people say them', () => {
    expect(spokenTime('2026-10-24T17:00:00', 'America/New_York')).toBe('Saturday, October 24 at 5:00 PM');
    expect(spokenTime('2026-10-24', 'America/New_York')).toBe('Saturday, October 24, all day');
  });
});

describe('gmail helpers', () => {
  it('builds a proper email, replies included', () => {
    const raw = Buffer.from(buildRaw({ to: ['sam@example.com'], subject: 'Café', body: 'See you!', inReplyTo: '<a@b>' }), 'base64url').toString();
    expect(raw).toContain('To: sam@example.com');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('In-Reply-To: <a@b>');
    expect(raw).toContain(Buffer.from('See you!').toString('base64'));
  });

  it('prefers plain text, and turns HTML into text otherwise', () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64url');
    expect(bodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hi Sam') } }, { mimeType: 'text/html', body: { data: b64('<b>x</b>') } }] })).toBe('Hi Sam');
    expect(bodyText({ mimeType: 'text/html', body: { data: b64('<p>Hello&nbsp;<b>there</b></p><script>evil()</script>') } })).toBe('Hello there');
  });
});

describe('drive query', () => {
  it('escapes words and narrows by type', () => {
    expect(buildDriveQuery("Sam's resume", 'doc')).toBe(
      "trashed = false and (name contains 'Sam\\'s resume' or fullText contains 'Sam\\'s resume') and mimeType = 'application/vnd.google-apps.document'",
    );
    expect(buildDriveQuery()).toBe('trashed = false');
  });
});

describe('google tools', () => {
  it('validates calls before they reach Google', () => {
    expect(parseGoogleCall('gmail_send', { to: ['not an email'], body: 'hi' }).ok).toBe(false);
    expect(parseGoogleCall('calendar_create', { title: 'x', start: 'tomorrow', end: 'later' }).ok).toBe(false);
    expect(parseGoogleCall('shell_exec', {}).ok).toBe(false);
    expect(parseGoogleCall('calendar_create', { title: 'Bro', start: '2026-10-24T17:00:00', end: '2026-10-24T18:00:00' }).ok).toBe(true);
  });

  it('asks before sending, deleting or inviting, not before reading or plain changes', () => {
    const { tools } = setup(() => json({}));
    expect(tools.needsConfirm('gmail_send', {})).toBe(true);
    expect(tools.needsConfirm('calendar_delete', {})).toBe(true);
    expect(tools.needsConfirm('drive_trash', {})).toBe(true);
    expect(tools.needsConfirm('calendar_create', { attendees: ['a@b.com'] })).toBe(true);
    expect(tools.needsConfirm('calendar_create', {})).toBe(false);
    expect(tools.needsConfirm('gmail_search', {})).toBe(false);
    expect(tools.needsConfirm('gmail_modify', {})).toBe(false);
  });

  it('creates an event on the primary calendar in the user’s zone', async () => {
    const { tools, fetchImpl } = setup(() => json({ id: 'e1', summary: 'Bro', start: { dateTime: '2026-10-24T17:00:00-04:00' }, end: { dateTime: '2026-10-24T18:00:00-04:00' } }));
    const created = await tools.run('calendar_create', { title: 'Bro', start: '2026-10-24T17:00:00', end: '2026-10-24T18:00:00' });
    const [url, init = {}] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(JSON.parse(String(init.body))).toEqual({
      summary: 'Bro',
      start: { dateTime: '2026-10-24T17:00:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-24T18:00:00', timeZone: 'America/New_York' },
    });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(created).toMatchObject({ created: { id: 'e1', title: 'Bro' } });
  });

  it('reads the real event back for a delete confirmation', async () => {
    const { tools } = setup(() => json({ id: 'e1', summary: 'Test', start: { dateTime: '2026-10-24T17:00:00-04:00' } }));
    const confirm = await tools.confirmation('calendar_delete', { id: 'e1' });
    expect(confirm.summary).toBe('I\'m about to delete "Test" on Saturday, October 24 at 5:00 PM from your calendar.');
  });

  it('summarizes the inbox without whole bodies', async () => {
    const { tools } = setup((url) =>
      url.includes('/messages?')
        ? json({ messages: [{ id: 'm1' }], resultSizeEstimate: 1 })
        : json({ id: 'm1', threadId: 't', labelIds: ['UNREAD', 'INBOX'], snippet: 'Lunch?', payload: { headers: [{ name: 'From', value: 'Sam <sam@x.com>' }, { name: 'Subject', value: 'Lunch' }] } }),
    );
    expect(await tools.run('gmail_search', { query: 'is:unread' })).toEqual({
      emails: [{ id: 'm1', from: 'Sam <sam@x.com>', subject: 'Lunch', date: '', preview: 'Lunch?', unread: true }],
      more: false,
    });
  });

  it('names the problem when Google refuses', async () => {
    const scope = setup(() => json({ error: { message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } }, 403));
    await expect(scope.tools.run('gmail_search', {})).rejects.toMatchObject({ kind: 'needs_access', service: 'gmail' });

    const disabled = setup(() => json({ error: { message: 'Gmail API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }, 403));
    await expect(disabled.tools.run('gmail_search', {})).rejects.toBeInstanceOf(GoogleApiError);
    await expect(disabled.tools.run('gmail_search', {})).rejects.toMatchObject({ kind: 'api_disabled' });
  });

  it('retries once with a fresh token after a 401', async () => {
    let calls = 0;
    const { tools, fetchImpl } = setup(() => (++calls === 1 ? json({}, 401) : json({ files: [] })));
    expect(await tools.run('drive_search', {})).toEqual({ files: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
