import type { AgentLane, TaskResult, TurnContext, TurnEvent, TurnLabel } from '../shared/agent/protocol';
import { FALLBACKS, type FallbackId } from '../shared/agent/fallbacks';
import type { PlannedTask } from '../shared/agent/tasks';
import { classify, type Llm } from './classifier';
import { chat, help } from './lanes/talk';
import { planTasks } from './orchestrator';
import type { SessionStore } from './sessionStore';
import { composeReply, composeStopped } from './verbalEngine';

// One turn: classifier → (orchestrator) → lanes → verbal engine. Runs in the agent process. WEB and UI
// tasks run through main, one at a time, so only one interactive task ever holds a tab.

type TurnEventBody = TurnEvent extends infer E ? (E extends { turnId: string } ? Omit<E, 'turnId'> : never) : never;

export type TurnDeps = {
  llm: Llm;
  // Asks main to run one task and resolves with its result (including when it was stopped).
  runTask(lane: Extract<AgentLane, 'WEB' | 'UI'>, goal: string): Promise<TaskResult>;
  emit(event: TurnEventBody): void;
  session: SessionStore;
  signal: AbortSignal;
};

// Tasks may hand off to another lane at most this many times in one turn.
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
  let label: TurnLabel = 'UNCLEAR';
  let reply = '';
  let untrusted = false;

  const say = (text: string) => {
    reply = text;
    deps.emit({ type: 'say', text });
  };
  const sayClip = (clip: FallbackId) => {
    reply = `[${clip}]`;
    deps.emit({ type: 'say', clip });
  };

  try {
    const history = deps.session.recent(6);
    const classification = await classify(deps.llm, transcript, context, history);
    // There's no INFO lane yet, so email, calendar and Drive questions are done on the site itself:
    // open it if needed, then read it like any other page.
    if (classification.label === 'INFO') Object.assign(classification, { label: 'WEB', multi: !context.site || classification.multi });
    label = classification.label;

    const clip = LABEL_CLIPS[label];
    if (clip) {
      deps.emit({ type: 'routed', label, confidence: classification.confidence, tasks: [] });
      sayClip(clip);
    } else if (label === 'CHAT' || label === 'HELP') {
      deps.emit({ type: 'routed', label, confidence: classification.confidence, tasks: [] });
      say((label === 'CHAT' ? await chat(deps.llm, transcript, history) : await help(deps.llm, transcript, history)) || "Sorry, I don't have an answer for that.");
    } else {
      // Every other label was handled above, so this is UI or WEB.
      const single: PlannedTask[] = [{ lane: label as 'UI' | 'WEB', goal: transcript }];
      const planned = classification.multi ? ((await planTasks(deps.llm, transcript, context)) ?? single) : single;
      const queue = [...planned];
      deps.emit({ type: 'routed', label, confidence: classification.confidence, tasks: queue.filter((task) => task.lane !== 'INFO') as { lane: AgentLane; goal: string }[] });

      const results: TaskResult[] = [];
      let handoffs = 0;
      let needsInfo = false;
      while (queue.length) {
        const task = queue.shift()!;
        if (task.lane === 'INFO') {
          needsInfo = true;
          break;
        }
        const result = await deps.runTask(task.lane, task.goal);
        results.push(result);
        untrusted ||= result.untrusted;
        if (!result.ok) break;
        if (result.handoff && handoffs < MAX_HANDOFFS && (result.handoff.lane === 'UI' || result.handoff.lane === 'WEB')) {
          handoffs += 1;
          queue.unshift({ lane: result.handoff.lane, goal: result.handoff.goal });
        }
      }

      if (needsInfo && results.length === 0) sayClip('info_unavailable');
      else say(needsInfo ? `${composeReply(results)} ${FALLBACKS.info_unavailable}` : composeReply(results));
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
    deps.session.add({ turnId, user: transcript, label, reply, untrusted, at: Date.now() });
  }
};
