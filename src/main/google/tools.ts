import { GOOGLE_TOOLS, type GoogleToolArgs, type GoogleToolName } from '../../shared/google/tools';
import type { ConfirmRequest } from '../../shared/web/actions';
import { createCalendar } from './calendar';
import { clip, createGoogleClient, type GoogleDeps } from './client';
import { createDrive } from './drive';
import { createGmail } from './gmail';

// Runs the INFO lane's tools (shared/google/tools.ts) against the user's Google account, and says which
// calls need the user's yes first and what to read them before asking.

const list = (values: string[] | undefined) => (values?.length ? values.join(', ') : '');

// "2026-10-24T17:00:00" → "Saturday, October 24 at 5:00 PM", read the way a person would say it.
export const spokenTime = (value: string | undefined, timeZone: string) => {
  if (!value) return '';
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(allDay ? `${value}T12:00:00` : /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}${value.length === 16 ? ':00' : ''}`);
  if (Number.isNaN(date.getTime())) return value;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(allDay ? {} : { timeZone }) }).format(date);
  if (allDay) return `${day}, all day`;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
  return `${day} at ${time}`;
};

export const createGoogleTools = (deps: GoogleDeps) => {
  const client = createGoogleClient(deps);
  const gmail = createGmail(client);
  const calendar = createCalendar(client);
  const drive = createDrive(client);

  const runners: { [T in GoogleToolName]: (args: GoogleToolArgs<T>) => Promise<unknown> } = {
    gmail_search: gmail.search,
    gmail_read: gmail.read,
    gmail_send: gmail.send,
    gmail_draft: gmail.draft,
    gmail_modify: gmail.modify,
    gmail_trash: gmail.trash,
    calendar_list: calendar.list,
    calendar_create: calendar.create,
    calendar_update: calendar.update,
    calendar_delete: calendar.remove,
    drive_search: drive.search,
    drive_read: drive.read,
    drive_create_doc: drive.createDoc,
    drive_append_doc: drive.appendDoc,
    drive_rename: drive.rename,
    drive_trash: drive.trash,
  };

  // Sends, deletes, and anything that emails other people.
  const needsConfirm = (name: GoogleToolName, args: Record<string, unknown>) =>
    GOOGLE_TOOLS[name].risk === 'confirm' || (name === 'calendar_create' && Array.isArray(args.attendees) && args.attendees.length > 0);

  // What's read aloud before asking. Built from Google's own data (the real event, the real email), not
  // from how the model described it.
  const confirmation = async (name: GoogleToolName, args: Record<string, unknown>): Promise<ConfirmRequest> => {
    const zone = client.timeZone();
    switch (name) {
      case 'gmail_send': {
        const a = args as GoogleToolArgs<'gmail_send'>;
        const reply = a.reply_to_id ? await gmail.replyContext(a.reply_to_id) : undefined;
        return {
          origin: 'https://mail.google.com',
          button: 'Send',
          summary: `I'm about to ${reply ? 'send a reply' : 'send an email'} to ${list(a.to)}${a.cc?.length ? `, copying ${list(a.cc)}` : ''}.`,
          fields: [
            { label: 'Subject', value: a.subject ?? reply?.subject ?? '(no subject)' },
            { label: 'It says', value: clip(a.body, 400) },
          ],
        };
      }
      case 'gmail_trash': {
        const a = args as GoogleToolArgs<'gmail_trash'>;
        const first = await gmail.describe(a.ids[0]);
        return {
          origin: 'https://mail.google.com',
          button: 'Delete',
          summary:
            a.ids.length === 1
              ? `I'm about to move the email from ${first.from} about "${first.subject}" to the trash.`
              : `I'm about to move ${a.ids.length} emails to the trash, starting with the one from ${first.from} about "${first.subject}".`,
          fields: [],
        };
      }
      case 'calendar_create': {
        const a = args as GoogleToolArgs<'calendar_create'>;
        return {
          origin: 'https://calendar.google.com',
          button: 'Invite',
          summary: `I'm about to add "${a.title}" on ${spokenTime(a.start, zone)} to your calendar and email an invitation to ${list(a.attendees)}.`,
          fields: [],
        };
      }
      case 'calendar_delete': {
        const event = await calendar.get((args as GoogleToolArgs<'calendar_delete'>).id);
        return {
          origin: 'https://calendar.google.com',
          button: 'Delete',
          summary: `I'm about to delete "${event.title}" on ${spokenTime(event.start, zone)} from your calendar${event.attendees?.length ? `, and tell the ${event.attendees.length} other people invited` : ''}.`,
          fields: [],
        };
      }
      case 'drive_trash': {
        const file = await drive.get((args as GoogleToolArgs<'drive_trash'>).id);
        return {
          origin: 'https://drive.google.com',
          button: 'Delete',
          summary: `I'm about to move the ${file.kind} "${file.name}" to your Drive trash.`,
          fields: [],
        };
      }
      default:
        return { origin: 'https://google.com', button: name, fields: [] };
    }
  };

  return {
    needsConfirm,
    confirmation,
    run: (name: GoogleToolName, args: Record<string, unknown>) => (runners[name] as (args: unknown) => Promise<unknown>)(args),
    timeZone: client.timeZone,
  };
};

export type GoogleTools = ReturnType<typeof createGoogleTools>;
