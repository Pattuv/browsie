import { FALLBACKS, type FallbackId } from '../shared/agent/fallbacks';
import type { AgentLane, TaskResult, TurnContext, TurnEvent, TurnLabel } from '../shared/agent/protocol';
import { packSession, SESSION_TURN_LIMIT, type SessionTask, type SessionTurn } from '../shared/agent/session';
import type { PlannedTask } from '../shared/agent/tasks';
import { isAdultContent } from '../shared/safety/contentPolicy';
import { classify, type Llm } from './classifier';
import { chat, help } from './lanes/talk';
import { planTasks } from './orchestrator';
import { toSessionTurn, type SessionStore } from './sessionStore';
import { composeReply, composeStopped } from './verbalEngine';

// One turn = classifier, orchestrator, lanes, and then verbal engine. Runs in the agent process. 
// WEB and UI tasks are handled one at a time via main. a tab can be held by only one task.

type TurnEventBody = TurnEvent extends infer E ? (E extends { turnId: string } ? Omit<E, 'turnId'> : never) : never;

export type TurnDeps = {
  llm: Llm;
  // Asks main to run one task and resolves with its result (including when it was stopped).
  runTask(lane: Extract<AgentLane, 'WEB' | 'UI' | 'INFO'>, goal: string): Promise<TaskResult>;
  emit(event: TurnEventBody): void;
  session: SessionStore;
  // The turns the sidebar should show, including this one while it is still running.
  publish?(turns: SessionTurn[]): void;
  signal: AbortSignal;
};

// (REVIEW this as more handoffs may be needed for complex tasks)
const MAX_HANDOFFS = 2;

const errorClip = (message: string): FallbackId => {
  if (/no openrouter key|refused the key/i.test(message)) return 'no_key';
  if (/out of credit|over its limit/i.test(message)) return 'out_of_credit';
  if (/network|fetch failed|offline|ENOTFOUND|timed? ?out/i.test(message)) return 'offline';
  return 'error';
};

const LABEL_CLIPS: Partial<Record<TurnLabel, FallbackId>> = {
  RESTRICTED: 'restricted',
  UNCLEAR: 'unclear',
};

export const runTurn = async (turnId: string, transcript: string, context: TurnContext, deps: TurnDeps) => {
  const startedAt = Date.now();
  let label: TurnLabel = 'UNCLEAR';
  let announced = false;
  let reply = '';
  let untrusted = false;
  let fallback: FallbackId | null = null;
  const tasks: SessionTask[] = [];

  const remembered = () => deps.session.recent(6);
  const live = (): SessionTurn => ({
    turnId,
    user: transcript,
    label: announced ? label : null,
    reply,
    fallback,
    tasks: tasks.map((task) => ({ ...task })),
    pending: true,
    at: startedAt,
  });
  const publishPending = () => deps.publish?.(packSession([...deps.session.recent(SESSION_TURN_LIMIT).map(toSessionTurn), live()]));

  const say = (text: string) => {
    fallback = null;
    reply = text;
    deps.emit({ type: 'say', text });
    publishPending();
  };
  const sayClip = (clip: FallbackId) => {
    fallback = clip;
    reply = FALLBACKS[clip];
    deps.emit({ type: 'say', clip });
    publishPending();
  };
  const routed = (confidence: number | undefined, planned: { lane: AgentLane; goal: string }[]) => {
    announced = true;
    deps.emit({ type: 'routed', label, confidence, tasks: planned });
    publishPending();
  };
  const noteTask = (lane: AgentLane, goal: string, result: TaskResult) => {
    tasks.push({ lane, goal, ok: result.ok, ...(result.error ? { error: result.error } : {}) });
    publishPending();
  };

  try {
    publishPending();
    const history = remembered();
    // Refused before any model sees it. Main refuses the searches and pages too, whatever a lane tries.
    if (isAdultContent(transcript)) {
      label = 'RESTRICTED';
      routed(1, []);
      sayClip('not_allowed');
      deps.emit({ type: 'done', ok: true });
      return;
    }
    const classification = await classify(deps.llm, transcript, context, history);
    label = classification.label;

    const clip = LABEL_CLIPS[label];
    if (clip) {
      routed(classification.confidence, []);
      sayClip(clip);
    } else if (label === 'CHAT' || label === 'HELP') {
      routed(classification.confidence, []);
      say((label === 'CHAT' ? await chat(deps.llm, transcript, history) : await help(deps.llm, transcript, history)) || "Sorry, I don't have an answer for that.");
    } else {
      // Every other label was handled above, so this is UI, WEB or INFO.
      const single: PlannedTask[] = [{ lane: label as 'UI' | 'WEB' | 'INFO', goal: transcript }];
      const planned = classification.multi ? ((await planTasks(deps.llm, transcript, context)) ?? single) : single;
      const queue = [...planned];
      routed(classification.confidence, queue as { lane: AgentLane; goal: string }[]);

      const results: TaskResult[] = [];
      let handoffs = 0;
      while (queue.length) {
        const task = queue.shift()!;
        const result = await deps.runTask(task.lane, task.goal);
        noteTask(task.lane, task.goal, result);
        results.push(result);
        untrusted ||= result.untrusted;
        if (!result.ok) break;
        if (result.handoff && handoffs < MAX_HANDOFFS && (result.handoff.lane === 'UI' || result.handoff.lane === 'WEB')) {
          handoffs += 1;
          queue.unshift({ lane: result.handoff.lane, goal: result.handoff.goal });
        }
      }

      say(composeReply(results));
    }
    deps.emit({ type: 'done', ok: true });
  } catch (error) {
    if (deps.signal.aborted) {
      say(composeStopped([]));
    } else {
      sayClip(errorClip(error instanceof Error ? error.message : String(error)));
    }
    deps.emit({ type: 'done', ok: false });
  } finally {
    deps.session.add({
      turnId,
      user: transcript,
      label,
      reply,
      untrusted,
      tasks: tasks.map((task) => ({ ...task })),
      fallback,
      at: startedAt,
    });
    deps.publish?.(packSession(deps.session.recent(SESSION_TURN_LIMIT).map(toSessionTurn)));
  }
};
