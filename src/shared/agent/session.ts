import type { FallbackId } from './fallbacks';
import type { AgentLane, TurnLabel } from './protocol';

// How many turns the agent keeps for follow-ups ("do that again"). Older ones drop off.
// This is the agent process's memory: a restart clears it, and nothing is written to disk.
export const SESSION_TURN_LIMIT = 20;

export type SessionTask = {
  lane: AgentLane;
  goal: string;
  ok: boolean;
  error?: string;
};

// One turn, as the session sidebar shows it. `pending` is the turn still being worked on.
export type SessionTurn = {
  turnId: string;
  user: string;
  // Null until the request has been routed.
  label: TurnLabel | null;
  reply: string;
  fallback: FallbackId | null;
  tasks: SessionTask[];
  pending: boolean;
  at: number;
};

const clip = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max));

// Bounds what crosses to the window. The sidebar shows the same turns the agent remembers.
export const packSession = (turns: readonly SessionTurn[]): SessionTurn[] =>
  turns.slice(-SESSION_TURN_LIMIT).map((turn) => ({
    turnId: clip(turn.turnId, 64),
    user: clip(turn.user, 2_000),
    label: turn.label,
    reply: clip(turn.reply, 4_000),
    fallback: turn.fallback,
    tasks: turn.tasks.slice(0, 12).map((task) => ({
      lane: task.lane,
      goal: clip(task.goal, 1_000),
      ok: task.ok,
      ...(task.error ? { error: clip(task.error, 500) } : {}),
    })),
    pending: turn.pending,
    at: turn.at,
  }));
