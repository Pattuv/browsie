import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { FALLBACKS, type FallbackId } from '../../shared/agent/fallbacks';
import { SESSION_TURN_LIMIT, type SessionTurn } from '../../shared/agent/session';
import spinner from '../assets/spinner.svg';
import wordmark from '../assets/wordmark.svg';

// Shown under the reply: which tasks ran, and whether a fixed line or an error was used.
const LANE_NAME: Record<SessionTurn['tasks'][number]['lane'], string> = {
  UI: 'Browser',
  WEB: 'Page',
  INFO: 'Google',
};

const LABEL_NAME: Record<NonNullable<SessionTurn['label']>, string> = {
  CHAT: 'Chat',
  HELP: 'Help',
  INFO: 'Google',
  UI: 'Browser',
  WEB: 'Page',
  RESTRICTED: 'Restricted',
  UNCLEAR: 'Unclear',
};

const FALLBACK_NOTE: Record<FallbackId, string> = {
  didnt_catch: "Fallback: didn't catch that",
  unclear: 'Fallback: not sure what you meant',
  restricted: 'Fallback: that stays in Settings',
  stopped: 'Fallback: stopped',
  info_unavailable: 'Fallback: email, calendar and files unavailable',
  no_key: 'Fallback: AI key is not set up',
  offline: 'Fallback: offline',
  out_of_credit: 'Fallback: AI credit has run out',
  no_page: 'Fallback: no web page open',
  confirm_again: 'Fallback: need a yes or no',
  error: 'Fallback: something went wrong',
};

const isFallback = (id: string | null): id is FallbackId => id !== null && id in FALLBACKS;

const notesFor = (turn: SessionTurn) => {
  const lines: string[] = [];

  if (turn.tasks.length === 0) {
    lines.push(
      turn.pending && !turn.reply ? 'No tasks yet' : `${turn.label ? LABEL_NAME[turn.label] : 'Reply'} · no tasks ran`,
    );
  } else {
    for (const task of turn.tasks) {
      const name = `${LANE_NAME[task.lane]} · ${task.goal}`;
      lines.push(task.ok ? name : `${name} — error: ${task.error ?? 'failed'}`);
    }
    if (turn.pending && !turn.reply) lines.push('Still working');
  }

  if (isFallback(turn.fallback)) lines.push(FALLBACK_NOTE[turn.fallback]);
  return lines;
};

const spoken = (turn: SessionTurn) => {
  if (turn.reply) return turn.reply;
  if (isFallback(turn.fallback)) return FALLBACKS[turn.fallback];
  return turn.pending ? 'Working…' : '';
};

function useSessionTurns() {
  const [turns, setTurns] = useState<SessionTurn[]>([]);

  useEffect(() => {
    const session = window.browsie?.session;
    if (!session) return;

    let current = true;
    void session.get().then((next) => {
      if (current) setTurns(next);
    });
    const unsubscribe = session.onChanged((next) => setTurns(next));

    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  return turns;
}

type SessionSidebarProps = {
  open: boolean;
  onClose: () => void;
};

/** Chat transcript of this session. The page beside it shrinks to make room. */
function SessionSidebar({ open, onClose }: SessionSidebarProps) {
  const turns = useSessionTurns();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (!open || !element) return;
    element.scrollTop = element.scrollHeight;
  }, [open, turns]);

  return (
    <aside
      aria-label="Session"
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      className={`flex h-full shrink-0 flex-col overflow-hidden bg-white transition-[width] duration-300 ease-out motion-reduce:transition-none ${
        open ? 'w-[22rem] border-l border-zinc-200' : 'w-0'
      }`}
    >
      <div className="flex h-full w-[22rem] flex-col">
        <header className="relative z-20 flex h-14 shrink-0 items-center justify-between px-5">
          <img src={wordmark} alt="Browsie" className="theme-invert pointer-events-none h-5" />
          <div className="flex items-center gap-1">
            <span className="group/tip relative flex">
              <button
                type="button"
                aria-label="Reset memory"
                onClick={() => void window.browsie?.session.clear()}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-zinc-100 hover:text-zinc-800 active:scale-90"
              >
                <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <span
                role="tooltip"
                className="invisible absolute top-full right-0 z-50 pt-2 opacity-0 transition-[opacity,visibility] delay-100 duration-150 ease-out group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
              >
                <span className="smooth block whitespace-nowrap rounded-[20px] bg-black px-3.5 py-2.5 text-xs font-normal leading-snug tracking-tight text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
                  Reset memory
                </span>
              </span>
            </span>
            <button
              type="button"
              aria-label="Close session"
              title="Close session"
              onClick={onClose}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-[background-color,color,transform] duration-150 ease-out hover:bg-zinc-100 hover:text-zinc-700 active:scale-90"
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </header>

        {turns.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8">
            <img src={spinner} alt="" className="session-mark h-16 w-16" />
            <p className="text-[15px] tracking-tight text-zinc-500">No conversation yet</p>
          </div>
        ) : (
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ol className="flex flex-col gap-5">
              {turns.map((turn) => {
                const reply = spoken(turn);
                const notes = notesFor(turn);

                return (
                  <li key={turn.turnId} className="flex flex-col gap-2">
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-(--chrome-tint) px-3 py-2 text-[14px] leading-snug tracking-tight break-words text-zinc-900">
                        {turn.user}
                      </p>
                    </div>
                    <div className="max-w-[92%]">
                      {reply && (
                        <p className="text-[14px] leading-snug tracking-tight break-words text-zinc-900">{reply}</p>
                      )}
                      {notes.length > 0 && (
                        <div className={reply ? 'mt-1' : ''}>
                          {notes.map((line, index) => (
                            <p key={`${turn.turnId}-${index}`} className="text-[11px] leading-snug tracking-tight text-zinc-500">
                              {line}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <p className="shrink-0 px-8 pb-6 text-center text-[12px] leading-relaxed tracking-tight text-zinc-400">
          The last {SESSION_TURN_LIMIT} messages of this session show up here. Older messages get removed from memory.
        </p>
      </div>
    </aside>
  );
}

export default SessionSidebar;
