import { evaluateBatch, actionKey, repeatVerdict, type StepRecord } from '../../main/web/policy';
import type { ChatMessage, LlmResponse, Tier, ToolDef } from '../../shared/agent/llm';
import type { ActResponse, Observation, Source, TaskEventBody, TaskResult } from '../../shared/agent/protocol';
import { type Action, type ActionResult, describe, parseBatch } from '../../shared/web/actions';
import { ACT_TOOL, renderObservation, renderStart, SYSTEM_PROMPT } from './prompt';

// WEB LANE - this is the biggest lane of all, this is responsible for interacting with webpages.
// Rhe workflow is:plan → observe → decide → check → act → verify, until the job is done or the user stops it (using spacebar). 
// Runs in the agent process.
// All actions must be approved by the main process before they're taken. 
// This layer catches obvious mistakes quickly, letting the model fix issues immediately instead of waiting for a full review.

export type Answer = { text: string; sourceId?: string; confirmed?: boolean };

export type WebPort = {
  observe(screenshot?: boolean): Promise<Observation>;
  act(actions: Action[]): Promise<ActResponse>;
  finish(summary: string, evidence: string[]): Promise<{ ok: boolean; message?: string }>;
  listFiles(): Promise<string[]>;
  chooseFile(name: string, sourceId: string): Promise<{ ok: boolean; message?: string }>;
};

export type LoopDeps = {
  llm(request: { tier: Tier; messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number }): Promise<LlmResponse>;
  web: WebPort;
  emit(event: TaskEventBody): void;
  // Waits for the user's reply; throws error if the task is stopped.
  waitForAnswer(): Promise<Answer>;
  signal: AbortSignal;
};

export type WebTask = { taskId: string; goal: string; sources: Source[] };

// after this many characters of history, start a new  conversation carrying the plan and progress.
const HISTORY_LIMIT = 60_000;
// how many failed steps in a row before moving up to the stronger model (sonnet), and before asking the user.
const ESCALATE_AFTER = 2;
const ASK_AFTER = 4;
// loop can only ask the user for help once before giving up.
const MAX_STUCK_ASKS = 1;
// // this includes thinking as well, only billed for what's used.
const MAX_REPLY_TOKENS = 8_000;

class Stopped extends Error {}

const NEEDS_SNAP = new Set(['click', 'type', 'press', 'select', 'scroll']);

const withSnap = (raw: unknown, snap: number) => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const action = raw as Record<string, unknown>;
  return NEEDS_SNAP.has(String(action.type)) && action.snap === undefined ? { ...action, snap } : action;
};

const resetSnap = (action: Action, snap: number): Action => ('snap' in action ? { ...action, snap } : action);

const describeResult = (result: ActionResult | undefined) => {
  if (!result) return '';
  if (!result.ok) return `That didn't work (${result.error}): ${result.message}`;
  const effects = result.effects.map((effect) => {
    switch (effect.kind) {
      case 'navigated':
        return `the page changed to ${effect.url}`;
      case 'dom_changed':
        return `the page updated (+${effect.added} ~${effect.changed} -${effect.removed})`;
      case 'download_started':
        return `a download started: ${effect.fileName}`;
      case 'file_chooser_opened':
        return 'the page is asking for a file';
    }
  });
  return `Done: ${effects.join('; ') || 'ok'}.`;
};

const historySize = (messages: ChatMessage[]) =>
  messages.reduce((total, message) => {
    const content = message.content;
    if (typeof content === 'string') return total + content.length;
    if (Array.isArray(content)) return total + content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 1_000), 0);
    return total + 200;
  }, 0);

export const runWebTask = async (task: WebTask, deps: LoopDeps): Promise<TaskResult> => {
  const sources = [...task.sources];
  const sourceMap = () => new Map(sources.map((source) => [source.id, source.text]));
  let plan: string[] = [];
  const progress: string[] = [];
  const history: StepRecord[] = [];
  let failures = 0;
  let stuckAsks = 0;
  let step = 0;

  const result = (ok: boolean, facts: string[], error?: string): TaskResult => ({
    taskId: task.taskId,
    lane: 'WEB',
    ok,
    facts,
    untrusted: true,
    error,
  });

  const checkStopped = () => {
    if (deps.signal.aborted) throw new Stopped();
  };

  const answer = async () => {
    const reply = await deps.waitForAnswer();
    checkStopped();
    if (reply.sourceId) sources.push({ id: reply.sourceId, text: reply.text });
    return reply;
  };

  const ask = async (question: string, options?: string[]) => {
    deps.emit({ type: 'ask_user', question, options });
    return answer();
  };

  const system: ChatMessage = { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] };

  const imageMessage = (observation: Observation): ChatMessage[] =>
    observation.screenshot
      ? [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Screenshot for snap ${observation.snap}.` },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${observation.screenshot}` } },
            ],
          },
        ]
      : [];

  const fresh = (observation: Observation, carry?: { plan: string[]; progress: string[] }): ChatMessage[] => [
    system,
    { role: 'user', content: renderStart(task.goal, sources, { ...observation, text: observation.full }, carry) },
    ...imageMessage(observation),
  ];

  // if too much of the page lacks names then take a screenshot to get more info.
  const observe = async () => {
    const observation = await deps.web.observe(false);
    return observation.needsScreenshot ? deps.web.observe(true) : observation;
  };

  // The page is asking for a file: the user picks one from Browsie's folder, never the model. (WIP feature NOT DONE)
  const handleFileChooser = async (): Promise<string> => {
    const files = await deps.web.listFiles();
    if (files.length === 0) {
      deps.emit({ type: 'request_help', reason: 'The page wants a file, but your Browsie Downloads folder is empty. Put the file there, then tell me.' });
      await answer();
      return 'The user was asked to add the file to the Browsie Downloads folder.';
    }
    const reply = await ask('Which file should I attach?', files.slice(0, 5));
    const name = files.find((file) => reply.text.toLowerCase().includes(file.toLowerCase()));
    if (!name || !reply.sourceId) return `The user answered ${JSON.stringify(reply.text)}, which isn't one of the files, so nothing was attached.`;
    const chosen = await deps.web.chooseFile(name, reply.sourceId);
    return chosen.ok ? `Attached ${name}, as the user chose.` : `Couldn't attach ${name}: ${chosen.message ?? 'refused'}.`;
  };

  try {
    let observation = await observe();
    let messages = fresh(observation);

    for (;;) {
      checkStopped();
      const tier: Tier = failures >= ESCALATE_AFTER ? 'escalate' : 'main';

      if (failures >= ASK_AFTER) {
        if (stuckAsks >= MAX_STUCK_ASKS) {
          const failed = result(false, progress, "I couldn't get this to work.");
          deps.emit({ type: 'failed', result: failed });
          return failed;
        }
        stuckAsks += 1;
        failures = 0;
        const reply = await ask("I'm having trouble with this page. What should I try?");
        observation = await observe();
        messages.push({ role: 'user', content: `The user says (source ${reply.sourceId ?? 'none'}): ${JSON.stringify(reply.text)}\n\n${renderObservation(observation)}` });
        continue;
      }

      const reply = await deps.llm({ tier, messages, tools: [ACT_TOOL], maxTokens: MAX_REPLY_TOKENS });
      checkStopped();
      const call = reply.toolCalls.find((candidate) => candidate.name === 'act');

      if (!call) {
        messages.push({ role: 'assistant', content: reply.content || null });
        messages.push({ role: 'user', content: 'Respond by calling the act tool.' });
        failures += 1;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: reply.content || null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: 'act', arguments: call.arguments } }],
      });
      const respond = (text: string, next?: Observation) => {
        messages.push({ role: 'tool', tool_call_id: call.id, content: next ? `${text}\n\n${renderObservation(next)}` : text });
        if (next) messages.push(...imageMessage(next));
      };

      let input: { plan?: unknown; actions?: unknown };
      try {
        input = JSON.parse(call.arguments || '{}');
      } catch {
        respond("Those arguments weren't valid JSON. Call act again.");
        failures += 1;
        continue;
      }

      if (Array.isArray(input.plan) && input.plan.every((item) => typeof item === 'string')) {
        plan = (input.plan as string[]).slice(0, 7);
      }

      const rawActions = Array.isArray(input.actions) ? input.actions.map((raw) => withSnap(raw, observation.snap)) : [];
      const parsed = parseBatch(rawActions);
      if (!parsed.success) {
        respond(`Those actions aren't valid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
        failures += 1;
        continue;
      }
      const actions = parsed.data;

      const early = evaluateBatch(actions, { sources: sourceMap() });
      if (early.stop) {
        respond(`Not allowed: ${early.stop.message}`);
        failures += 1;
        continue;
      }

      const [first] = actions;

      if (first.type === 'finish') {
        const done = await deps.web.finish(first.summary, first.evidence);
        if (done.ok) {
          const finished = result(true, [first.summary]);
          deps.emit({ type: 'finished', result: finished });
          return finished;
        }
        respond(`Not finished yet: ${done.message ?? 'the evidence is not on the page'}`);
        failures += 1;
        continue;
      }

      if (first.type === 'ask_user') {
        const reply = await ask(first.question, first.options);
        observation = await observe();
        respond(`The user answered (source ${reply.sourceId ?? 'none'}): ${JSON.stringify(reply.text)}`, observation);
        continue;
      }

      if (first.type === 'request_help') {
        deps.emit({ type: 'request_help', reason: first.reason });
        const reply = await answer();
        observation = await observe();
        respond(`The user finished helping and said ${JSON.stringify(reply.text)}. This is the page now.`, observation);
        continue;
      }

      const verdicts = actions.map((action) => repeatVerdict(history, actionKey(action)));
      if (verdicts.includes('ask_user')) {
        failures = ASK_AFTER;
        respond('That has been tried repeatedly with no effect.');
        continue;
      }
      if (verdicts.includes('replan')) {
        respond("You've tried that three times and nothing changed. Make a new plan (send plan) and try something else.");
        failures += 1;
        continue;
      }

      const phrases = actions.map((action) => describe(action, 'ref' in action && action.ref ? observation.names[action.ref] : undefined));
      phrases.forEach((phrase, index) => deps.emit({ type: 'step_started', step: step + index + 1, phrase }));

      let response = await deps.web.act(actions);
      let ranActions = actions.slice(0, response.ran);

      if (response.stop?.error === 'needs_user') {
        // Main has asked the user, reading them the real form. Wait for their yes or no.
        const reply = await answer();
        if (!reply.confirmed) {
          const declined = result(false, [...progress, ...phrases.slice(0, response.ran), 'The user said no, so I stopped before that step.'], 'declined');
          deps.emit({ type: 'finished', result: declined });
          return declined;
        }
        const rest = actions.slice(response.ran).map((action) => resetSnap(action, response.observation.snap));
        const done = response.ran;
        response = await deps.web.act(rest);
        ranActions = [...ranActions, ...rest.slice(0, response.ran)];
        response = { ...response, ran: done + response.ran };
      }

      if (response.limit) {
        const limited = result(false, progress, response.limit);
        deps.emit({ type: 'failed', result: limited });
        return limited;
      }

      const outcome = response.result;
      ranActions.forEach((action, index) => {
        const last = index === ranActions.length - 1;
        history.push({ key: actionKey(action), error: last && outcome && !outcome.ok ? outcome.error : undefined });
      });

      if (outcome && !outcome.ok && outcome.error === 'aborted') throw new Stopped();
      if (outcome && !outcome.ok && outcome.error === 'target_gone') {
        const gone = result(false, progress, 'The tab was closed.');
        deps.emit({ type: 'failed', result: gone });
        return gone;
      }

      const succeeded = Boolean(outcome?.ok) && !response.stop;
      if (outcome?.ok) progress.push(...phrases.slice(0, response.ran));
      failures = succeeded ? 0 : failures + 1;
      for (let index = 0; index < Math.max(response.ran, 1); index += 1) {
        deps.emit({
          type: 'step_done',
          step: step + index + 1,
          ok: succeeded,
          error: outcome && !outcome.ok ? outcome.error : response.stop?.error,
        });
      }
      step += Math.max(response.ran, 1);

      observation = response.observation;
      const notes = [describeResult(outcome), response.stop ? `Stopped: ${response.stop.message}` : ''];
      if (observation.fileChooser) {
        notes.push(await handleFileChooser());
        observation = await observe();
      }
      respond(notes.filter(Boolean).join('\n'), observation);

      if (historySize(messages) > HISTORY_LIMIT) messages = fresh(observation, { plan, progress });
    }
  } catch (error) {
    if (error instanceof Stopped || deps.signal.aborted) {
      const stopped = result(false, progress, 'stopped');
      deps.emit({ type: 'stopped', result: stopped });
      return stopped;
    }
    const failed = result(false, progress, error instanceof Error ? error.message : String(error));
    deps.emit({ type: 'failed', result: failed });
    return failed;
  }
};
