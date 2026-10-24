import type { FallbackId } from '../shared/agent/fallbacks';
import type { TurnLabel } from '../shared/agent/protocol';
import { SESSION_TURN_LIMIT, type SessionTask, type SessionTurn } from '../shared/agent/session';

// browsie's current memory at any given time.
// Gives  classifier and chat context (for amigious requests like "do that again")
// Never raw page text and instead its summaries

export type TurnRecord = {
  turnId: string;
  user: string;
  label: TurnLabel;
  reply: string;
  // The reply was drawn from website content.
  untrusted: boolean;
  tasks: SessionTask[];
  fallback: FallbackId | null;
  at: number;
};

export const toSessionTurn = (record: TurnRecord): SessionTurn => ({
  turnId: record.turnId,
  user: record.user,
  label: record.label,
  reply: record.reply,
  fallback: record.fallback,
  tasks: record.tasks.map((task) => ({ ...task })),
  pending: false,
  at: record.at,
});

export const createSessionStore = () => {
  const turns: TurnRecord[] = [];

  return {
    add(record: TurnRecord) {
      turns.push(record);
      if (turns.length > SESSION_TURN_LIMIT) turns.shift();
    },
    recent: (count: number) => turns.slice(-count),
    clear: () => {
      turns.length = 0;
    },
  };
};

export type SessionStore = ReturnType<typeof createSessionStore>;

export const renderHistory = (records: readonly TurnRecord[]) =>
  records
    .map((record) => {
      const reply = record.untrusted ? `<untrusted_page_summary>${record.reply}</untrusted_page_summary>` : record.reply;
      return `User: ${JSON.stringify(record.user)}\nBrowsie (${record.label}): ${reply}`;
    })
    .join('\n');
