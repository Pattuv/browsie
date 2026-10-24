import { z } from 'zod';

// The INFO lane's tools: the user's own Gmail, Google Calendar and Google Drive, through the Google account
// they signed in to Browsie with. Shaped like MCP tools (name, description, input schema), shared so the
// agent shows the model exactly what main will accept. Main parses every call again and runs it with the
// account's token; the agent never sees a token.
//
// risk: read = look only. write = changes something that's easy to undo. confirm = sends, deletes or
// invites people: main reads the user a summary and waits for a spoken yes, like a checkout.

export type GoogleService = 'gmail' | 'calendar' | 'drive';
export type ToolRisk = 'read' | 'write' | 'confirm';

const id = z.string().trim().min(1).max(200);
const email = z.string().trim().email().max(320);
// "2026-10-24T17:00:00" (in the user's time zone) or "2026-10-24" for all-day.
const when = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([.]\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'Use 2026-10-24T17:00:00, or 2026-10-24 for all day.');

export const GOOGLE_TOOLS = {
  // --- Gmail ---
  gmail_search: {
    service: 'gmail',
    risk: 'read',
    description:
      'Find emails in the user\'s Gmail. query uses Gmail search syntax, e.g. "is:unread", "from:sam", "subject:invoice newer_than:7d", "in:inbox". Leave query empty for the latest inbox mail. Returns sender, subject, date, a short preview and whether it is unread.',
    input: z.strictObject({ query: z.string().max(300).optional(), max: z.number().int().min(1).max(20).optional() }),
  },
  gmail_read: {
    service: 'gmail',
    risk: 'read',
    description: 'Read one email in full (sender, recipients, subject, date and body text). id comes from gmail_search.',
    input: z.strictObject({ id }),
  },
  gmail_send: {
    service: 'gmail',
    risk: 'confirm',
    description:
      'Send an email from the user\'s Gmail. To reply to an email, give reply_to_id (from gmail_search) and it threads properly; subject can then be left out. The user is asked to confirm before it sends.',
    input: z.strictObject({
      to: z.array(email).min(1).max(20),
      cc: z.array(email).max(20).optional(),
      subject: z.string().max(300).optional(),
      body: z.string().min(1).max(20_000),
      reply_to_id: id.optional(),
    }),
  },
  gmail_draft: {
    service: 'gmail',
    risk: 'write',
    description: 'Save an email as a draft in Gmail without sending it.',
    input: z.strictObject({
      to: z.array(email).max(20).optional(),
      subject: z.string().max(300).optional(),
      body: z.string().min(1).max(20_000),
      reply_to_id: id.optional(),
    }),
  },
  gmail_modify: {
    service: 'gmail',
    risk: 'write',
    description: 'Change emails: mark read or unread, archive (out of the inbox), star or unstar. ids come from gmail_search.',
    input: z.strictObject({
      ids: z.array(id).min(1).max(50),
      action: z.enum(['mark_read', 'mark_unread', 'archive', 'move_to_inbox', 'star', 'unstar']),
    }),
  },
  gmail_trash: {
    service: 'gmail',
    risk: 'confirm',
    description: 'Move emails to the trash. The user is asked to confirm first.',
    input: z.strictObject({ ids: z.array(id).min(1).max(50) }),
  },

  // --- Google Calendar ---
  calendar_list: {
    service: 'calendar',
    risk: 'read',
    description:
      'List events on the user\'s Google Calendar between start and end (in the user\'s time zone). query filters by words in the event. Use this to answer "what\'s on my calendar", "am I free", and to find an event before changing it.',
    input: z.strictObject({ start: when, end: when, query: z.string().max(200).optional() }),
  },
  calendar_create: {
    service: 'calendar',
    risk: 'write',
    description:
      'Add an event to the user\'s Google Calendar. Times are in the user\'s time zone; give dates only (2026-10-24) for an all-day event. With attendees, Google emails them an invitation, so the user is asked to confirm first. If no end is given, make it one hour.',
    input: z.strictObject({
      title: z.string().trim().min(1).max(300),
      start: when,
      end: when,
      location: z.string().max(300).optional(),
      description: z.string().max(5_000).optional(),
      attendees: z.array(email).max(50).optional(),
    }),
  },
  calendar_update: {
    service: 'calendar',
    risk: 'write',
    description: 'Change an event (id from calendar_list): its title, times, location or description. Only the fields given change.',
    input: z.strictObject({
      id,
      title: z.string().trim().min(1).max(300).optional(),
      start: when.optional(),
      end: when.optional(),
      location: z.string().max(300).optional(),
      description: z.string().max(5_000).optional(),
    }),
  },
  calendar_delete: {
    service: 'calendar',
    risk: 'confirm',
    description: 'Delete an event (id from calendar_list). The user is asked to confirm first.',
    input: z.strictObject({ id }),
  },

  // --- Google Drive ---
  drive_search: {
    service: 'drive',
    risk: 'read',
    description:
      'Find files in the user\'s Google Drive by words in the name or contents. Leave query empty for the most recently changed files. type narrows it to Google Docs, Sheets, Slides, PDFs or folders.',
    input: z.strictObject({
      query: z.string().max(200).optional(),
      type: z.enum(['doc', 'sheet', 'slides', 'pdf', 'folder']).optional(),
      max: z.number().int().min(1).max(20).optional(),
    }),
  },
  drive_read: {
    service: 'drive',
    risk: 'read',
    description: 'Read the text of a file (id from drive_search): Google Docs, Sheets (as rows), Slides, and plain text files.',
    input: z.strictObject({ id }),
  },
  drive_create_doc: {
    service: 'drive',
    risk: 'write',
    description: 'Create a new Google Doc in the user\'s Drive with the given title and text.',
    input: z.strictObject({ title: z.string().trim().min(1).max(300), text: z.string().max(100_000) }),
  },
  drive_append_doc: {
    service: 'drive',
    risk: 'write',
    description: 'Add text to the end of a Google Doc (id from drive_search).',
    input: z.strictObject({ id, text: z.string().min(1).max(50_000) }),
  },
  drive_rename: {
    service: 'drive',
    risk: 'write',
    description: 'Rename a file (id from drive_search).',
    input: z.strictObject({ id, name: z.string().trim().min(1).max(300) }),
  },
  drive_trash: {
    service: 'drive',
    risk: 'confirm',
    description: 'Move a file to the Drive trash. The user is asked to confirm first.',
    input: z.strictObject({ id }),
  },
} as const satisfies Record<string, { service: GoogleService; risk: ToolRisk; description: string; input: z.ZodType }>;

export type GoogleToolName = keyof typeof GOOGLE_TOOLS;
export type GoogleToolArgs<T extends GoogleToolName> = z.infer<(typeof GOOGLE_TOOLS)[T]['input']>;

export const GOOGLE_TOOL_NAMES = Object.keys(GOOGLE_TOOLS) as GoogleToolName[];

export const isGoogleTool = (name: string): name is GoogleToolName => Object.hasOwn(GOOGLE_TOOLS, name);

export const parseGoogleCall = (name: string, args: unknown) => {
  if (!isGoogleTool(name)) return { ok: false as const, message: `There's no tool called ${name}.` };
  const parsed = GOOGLE_TOOLS[name].input.safeParse(args);
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') };
  }
  return { ok: true as const, name, args: parsed.data as Record<string, unknown> };
};

// What a tool call came back with, as the agent sees it.
export type GoogleCallResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      // needs_access: the user hasn't given Browsie permission for this yet (main has opened Google's page).
      // needs_user: main is asking the user to confirm. declined: they said no.
      error: 'invalid' | 'needs_access' | 'needs_user' | 'declined' | 'not_found' | 'api_disabled' | 'failed';
      message: string;
      service?: GoogleService;
    };

// The same call, as a key for remembering what the user said yes to.
export const callKey = (name: string, args: unknown) => `${name}:${JSON.stringify(args)}`;
