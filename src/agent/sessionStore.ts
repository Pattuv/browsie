import type { TurnLabel } from '../shared/agent/protocol';

// What Browsie remembers of this conversation: what was said each turn, how it was routed, and what Browsie
// answered. Gives the classifier and CHAT lane context ("do that again", "and the red one?").
// Never raw page text: replies drawn from pages are model summaries, and they're marked untrusted so they
// go back to models as information only.

export type TurnRecord = {
  turnId: string;
  user: string;
  label: TurnLabel;
  reply: string;
  // The reply was drawn from website content.
  untrusted: boolean;
  at: number;
};

const MAX_TURNS = 20;

export const createSessionStore = () => {
  const turns: TurnRecord[] = [];

  return {
    add(record: TurnRecord) {
      turns.push(record);
      if (turns.length > MAX_TURNS) turns.shift();
    },
    recent: (count: number) => turns.slice(-count),
    clear: () => {
      turns.length = 0;
    },
  };
};

export type SessionStore = ReturnType<typeof createSessionStore>;

// The recent turns as plain text for a prompt. Untrusted replies are fenced off.
export const renderHistory = (records: readonly TurnRecord[]) =>
  records
    .map((record) => {
      const reply = record.untrusted ? `<untrusted_page_summary>${record.reply}</untrusted_page_summary>` : record.reply;
      return `User: ${JSON.stringify(record.user)}\nBrowsie (${record.label}): ${reply}`;
    })
    .join('\n');
