import type { GoogleToolArgs } from '../../shared/google/tools';
import { clip, type GoogleClient } from './client';

// The user's primary Google Calendar. Times the model gives are wall-clock times in the user's time zone;
// dates alone mean all-day.

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_EVENTS = 25;

type EventTime = { dateTime?: string; date?: string; timeZone?: string };
type CalendarEvent = {
  id: string;
  summary?: string;
  start?: EventTime;
  end?: EventTime;
  location?: string;
  description?: string;
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
  status?: string;
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const hasOffset = (value: string) => /(Z|[+-]\d{2}:?\d{2})$/.test(value);

export const toEventTime = (value: string, timeZone: string): EventTime =>
  isDate(value) ? { date: value } : hasOffset(value) ? { dateTime: value } : { dateTime: value.length === 16 ? `${value}:00` : value, timeZone };

// The API's timeMin/timeMax need an offset. Turn a wall-clock time in `timeZone` into an RFC 3339 instant.
export const toInstant = (value: string, timeZone: string, endOfDay = false) => {
  if (hasOffset(value)) return value;
  const local = isDate(value) ? `${value}T${endOfDay ? '23:59:59' : '00:00:00'}` : value.length === 16 ? `${value}:00` : value;
  const asUtc = new Date(`${local}Z`);
  // What that UTC instant reads as in the zone; the difference is the zone's offset at that moment.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(asUtc)
      .map((part) => [part.type, part.value]),
  );
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(asUtc.getTime() - (shown - asUtc.getTime())).toISOString();
};

const summary = (event: CalendarEvent) => ({
  id: event.id,
  title: event.summary || '(no title)',
  start: event.start?.dateTime ?? event.start?.date,
  end: event.end?.dateTime ?? event.end?.date,
  allDay: Boolean(event.start?.date),
  location: event.location || undefined,
  description: event.description ? clip(event.description, 300) : undefined,
  attendees: event.attendees?.filter((person) => !person.self).map((person) => person.email).filter(Boolean),
});

export const createCalendar = (client: GoogleClient) => ({
  async list({ start, end, query }: GoogleToolArgs<'calendar_list'>) {
    const zone = client.timeZone();
    const url = new URL(API);
    url.searchParams.set('timeMin', toInstant(start, zone));
    url.searchParams.set('timeMax', toInstant(end, zone, true));
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(MAX_EVENTS));
    url.searchParams.set('timeZone', zone);
    if (query) url.searchParams.set('q', query);
    const result = await client.json<{ items?: CalendarEvent[] }>('calendar', url.toString());
    return { timeZone: zone, events: (result.items ?? []).filter((event) => event.status !== 'cancelled').map(summary) };
  },

  async create(args: GoogleToolArgs<'calendar_create'>) {
    const zone = client.timeZone();
    const url = new URL(API);
    // Google emails the invitations itself.
    if (args.attendees?.length) url.searchParams.set('sendUpdates', 'all');
    const event = (await client.send('calendar', url.toString(), 'POST', {
      summary: args.title,
      start: toEventTime(args.start, zone),
      end: toEventTime(args.end, zone),
      ...(args.location && { location: args.location }),
      ...(args.description && { description: args.description }),
      ...(args.attendees?.length && { attendees: args.attendees.map((email) => ({ email })) }),
    })) as CalendarEvent;
    return { created: summary(event) };
  },

  async update({ id, ...fields }: GoogleToolArgs<'calendar_update'>) {
    const zone = client.timeZone();
    const url = new URL(`${API}/${encodeURIComponent(id)}`);
    url.searchParams.set('sendUpdates', 'all');
    const event = (await client.send('calendar', url.toString(), 'PATCH', {
      ...(fields.title && { summary: fields.title }),
      ...(fields.start && { start: toEventTime(fields.start, zone) }),
      ...(fields.end && { end: toEventTime(fields.end, zone) }),
      ...(fields.location !== undefined && { location: fields.location }),
      ...(fields.description !== undefined && { description: fields.description }),
    })) as CalendarEvent;
    return { updated: summary(event) };
  },

  async remove({ id }: GoogleToolArgs<'calendar_delete'>) {
    await client.request('calendar', `${API}/${encodeURIComponent(id)}?sendUpdates=all`, { method: 'DELETE' });
    return { deleted: true };
  },

  // For confirmations.
  get: async (id: string) => summary(await client.json<CalendarEvent>('calendar', `${API}/${encodeURIComponent(id)}`)),
});

export type Calendar = ReturnType<typeof createCalendar>;
