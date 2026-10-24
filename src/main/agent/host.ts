import { MessageChannelMain, type MessagePortMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { RPC, type ActResponse, type AgentLane, type AgentMessage, type ChromeResponse, type HostMessage, type TurnContext, type TurnEvent, type Observation, type RpcMethod, type TaskEvent, type TaskResult } from '../../shared/agent/protocol';
import { describe as describeChrome, parseChromeAction } from '../../shared/chrome/actions';
import { addressOf, checkNavigation } from '../../shared/chrome/policy';
import { textForModel, type Snapshot } from '../web/snapshot';
import { checkLimits, evaluate, evaluateBatch, grantFor, type ConfirmGrant, type PolicyContext } from '../web/policy';
import { ElectronCdpExecutor, type AgentCursor, type Executor, type TabResolver } from '../web/executor';
import { listUploadable, resolveUploadable } from '../web/files';
import { TASK_SPEND_CAP_USD } from './config';
import type { Broker } from './broker';
import type { ChromeApi } from './chromeApi';
import { viewForAgent } from './chromeView';
import { callKey, GOOGLE_TOOLS, parseGoogleCall, type GoogleCallResult, type GoogleService } from '../../shared/google/tools';
import type { GoogleTools } from '../google/tools';
import { GoogleApiError } from '../google/client';
import { serializeSnapshot, summarizeBatch, type TraceEvent } from './traceEvents';

// Runs the agent utilityProcess and is the only place its requests enter main. The agent has no keys and no
// Electron: it gets a MessagePort to the methods in protocol.ts, each checked here. Main keeps its own copy
// of what the user said (for typed-text provenance), holds the confirmation grants, and runs policy again
// on every action, so a confused or prompt-injected agent still can't get past it.

export type HostDeps = {
  workerPath: string;
  broker: Broker;
  // Turns a tab id into its page. Only knows tab views, never the chrome or popups.
  resolveTab: TabResolver;
  // Picks the tab the task works on and marks it as the agent's. Undefined when there's no web page to use.
  leaseTab: (taskId: string) => number | undefined;
  releaseTab: (taskId: string) => void;
  downloadsFolder: () => string;
  // The browser-chrome commands the UI lane may run. Without it, UI tasks can't start.
  chrome?: ChromeApi;
  // The user's Gmail, Calendar and Drive. Without it, INFO tasks can't start.
  google?: {
    tools: GoogleTools;
    access: () => Record<GoogleService, boolean>;
    email: () => string | undefined;
    // Opens Google's permission page for mail, calendar and Drive. Resolves when the user is done there.
    connect: () => Promise<unknown>;
  };
  // Drawn over the page while a web task clicks and moves. Tests omit it.
  cursor?: AgentCursor;
  allowPrivateNetwork?: boolean;
  capUsd?: number;
  onTrace?: (taskId: string, event: TraceEvent) => void;
};

type HostTask = {
  id: string;
  lane: AgentLane;
  turnId: string;
  goal: string;
  sources: Map<string, string>;
  answers: number;
  controller: AbortController;
  startedAt: number;
  steps: number;
  // WEB tasks only: the leased tab.
  executor?: Executor;
  // UI tasks only: sites the agent was shown in tab, bookmark and history lists, which it may open.
  seenHosts: Set<string>;
  // INFO tasks only: the Google call the user said yes to, and the one they're being asked about.
  googleGrant?: string;
  pendingGoogleGrant?: string;
  // Google's permission page was opened for this task already.
  askedForAccess?: boolean;
  grant?: ConfirmGrant;
  pendingGrant?: ConfirmGrant;
  done: boolean;
  watchdog?: ReturnType<typeof setTimeout>;
};

// One thing the user said, while the agent works out the reply. Its tasks run as ordinary tasks.
type HostTurn = {
  id: string;
  controller: AbortController;
  taskIds: Set<string>;
};

// After Space or "stop", the agent has this long to say it stopped before it's killed and started again.
const STOP_WATCHDOG_MS = 2_000;
const MAX_NAMES = 400;
// A UI request is a few commands ("open a new tab", "switch to my email"). More than this is a loop.
const MAX_UI_STEPS = 12;

let taskCounter = 0;

export const createAgentHost = (deps: HostDeps) => {
  const tasks = new Map<string, HostTask>();
  const listeners = new Set<(event: TaskEvent) => void>();
  const turns = new Map<string, HostTurn>();
  const turnListeners = new Set<(event: TurnEvent) => void>();
  const capUsd = deps.capUsd ?? TASK_SPEND_CAP_USD;
  let worker: UtilityProcess | undefined;
  let port: MessagePortMain | undefined;

  const emit = (event: TaskEvent) => listeners.forEach((listener) => listener(event));
  const trace = (task: HostTask, event: TraceEvent) => deps.onTrace?.(task.id, event);
  const post = (message: HostMessage) => port?.postMessage(message);

  const finishTask = (task: HostTask, event: TaskEvent & { result: TaskResult }) => {
    if (task.done) return;
    task.done = true;
    if (task.watchdog) clearTimeout(task.watchdog);
    task.executor?.close();
    if (task.lane === 'WEB') deps.releaseTab(task.id);
    trace(task, {
      t: 'end',
      ok: event.result.ok,
      steps: task.steps,
      ms: Date.now() - task.startedAt,
      costUsd: deps.broker.spentFor(task.id),
      error: event.result.error,
    });
    tasks.delete(task.id);
    emit(event);
  };

  const failAll = (reason: string) => {
    for (const turn of [...turns.values()]) {
      turns.delete(turn.id);
      turnListeners.forEach((listener) => listener({ turnId: turn.id, type: 'say', clip: 'error' }));
      turnListeners.forEach((listener) => listener({ turnId: turn.id, type: 'done', ok: false }));
    }
    for (const task of [...tasks.values()]) {
      const result: TaskResult = { taskId: task.id, lane: task.lane, ok: false, facts: [], untrusted: true, error: reason };
      finishTask(task, { type: 'failed', taskId: task.id, turnId: task.turnId, result });
    }
  };

  const web = (task: HostTask) => {
    if (!task.executor) throw new Error('That only works in a WEB task.');
    return task.executor;
  };

  // --- Turning snapshots into what the agent sees ---

  const observation = async (task: HostTask, snapshot: Snapshot, screenshot = false): Promise<Observation> => {
    const names: Record<string, string> = {};
    for (const node of snapshot.nodes.slice(0, MAX_NAMES)) if (node.name) names[node.ref] = node.name;
    return {
      snap: snapshot.snap,
      url: snapshot.url,
      title: snapshot.title,
      text: textForModel(snapshot),
      isDelta: snapshot.delta !== undefined,
      full: snapshot.full,
      names,
      needsScreenshot: snapshot.needsScreenshot,
      screenshot: screenshot ? await web(task).screenshot() : undefined,
      fileChooser: web(task).fileChooserPending(),
    };
  };

  // Nothing ran, so the agent's picture of the page still holds.
  const unchanged = (task: HostTask, snapshot: Snapshot): Observation => ({
    snap: snapshot.snap,
    url: snapshot.url,
    title: snapshot.title,
    text: `snap ${snapshot.snap} · unchanged`,
    isDelta: true,
    full: snapshot.full,
    names: {},
    needsScreenshot: false,
    fileChooser: web(task).fileChooserPending(),
  });

  const takeSnapshot = async (task: HostTask) => {
    const snapshot = await web(task).snapshot(task.controller.signal);
    trace(task, { t: 'snapshot', step: task.steps, snapshot: serializeSnapshot(snapshot) });
    return snapshot;
  };

  const policyContext = (task: HostTask, snapshot: Snapshot | undefined): PolicyContext => ({
    snapshot,
    sources: task.sources,
    grant: task.grant,
    allowPrivateNetwork: deps.allowPrivateNetwork,
  });

  const askToConfirm = (task: HostTask, decision: ReturnType<typeof evaluate>, snapshot: Snapshot) => {
    if (decision.ok || decision.error !== 'needs_user' || !decision.confirm) return;
    task.pendingGrant = grantFor(decision, snapshot);
    emit({ type: 'needs_confirm', taskId: task.id, turnId: task.turnId, confirm: decision.confirm });
  };

  // --- The RPC methods ---

  const act = async (task: HostTask, actions: unknown[]): Promise<ActResponse> => {
    const before = web(task).current() ?? (await takeSnapshot(task));
    const limit = checkLimits({
      steps: task.steps,
      startedAt: task.startedAt,
      now: Date.now(),
      spentUsd: deps.broker.spentFor(task.id),
      capUsd,
    });
    if (limit) return { ran: 0, limit, observation: unchanged(task, before) };

    const decision = evaluateBatch(actions, policyContext(task, before));
    trace(task, { t: 'decision', step: task.steps, actions, decisions: summarizeBatch(decision) });

    if (decision.run.length === 0) {
      if (decision.stop) askToConfirm(task, decision.stop, before);
      return {
        ran: 0,
        stop: decision.stop && !decision.stop.ok ? { error: decision.stop.error, message: decision.stop.message } : undefined,
        observation: unchanged(task, before),
      };
    }

    const run = decision.run.map((entry) => entry.action);
    const usedGrant = task.grant;
    const batch = await web(task).runBatch(run, task.controller.signal);
    task.steps += batch.ran;
    // The batch has one outcome. Recorded against each action that ran, or the one that failed.
    for (const action of run.slice(0, Math.max(batch.ran, 1))) trace(task, { t: 'result', step: task.steps, action, result: batch.result });
    trace(task, { t: 'snapshot', step: task.steps, snapshot: serializeSnapshot(batch.snapshot) });
    // A yes covers one action, once.
    if (usedGrant && run.some((action) => 'ref' in action && action.ref === usedGrant.ref)) task.grant = undefined;

    let stop: ActResponse['stop'];
    if (decision.stop && !decision.stop.ok && decision.stop.error !== 'needs_user') {
      stop = { error: decision.stop.error, message: decision.stop.message };
    } else if (decision.stop && batch.result.ok) {
      // The actions before it ran and the page moved on. Check the stopped one again against the new page,
      // so the confirmation reads the form as it is now (with the fields just filled in).
      const raw = actions[run.length] as Record<string, unknown>;
      const again = evaluate({ ...raw, snap: batch.snapshot.snap }, policyContext(task, batch.snapshot));
      if (!again.ok && again.error === 'needs_user') {
        askToConfirm(task, again, batch.snapshot);
        stop = { error: again.error, message: again.message };
      } else {
        stop = { error: 'stale_ref', message: 'The page changed after the earlier steps. Look again before the next one.' };
      }
    }

    return { ran: batch.ran, result: batch.result, stop, observation: await observation(task, batch.snapshot) };
  };

  // One browser-chrome command from the UI lane: parsed again, the address checked, run, and trimmed.
  const chromeCommand = async (task: HostTask, raw: unknown): Promise<ChromeResponse> => {
    if (task.lane !== 'UI' || !deps.chrome) throw new Error('That only works in a UI task.');
    if (task.steps >= MAX_UI_STEPS) return { ok: false, error: 'limit', message: `Stopped after ${MAX_UI_STEPS} commands.`, limit: true };

    const parsed = parseChromeAction(raw);
    if (!parsed.success) return { ok: false, error: 'invalid_action', message: "That isn't an allowed browser command." };
    const action = parsed.data;

    const address = addressOf(action);
    const problem = address === undefined ? undefined : checkNavigation(address, [...task.sources.values()], task.seenHosts);
    if (problem) {
      trace(task, { t: 'chrome', step: task.steps, action, ok: false, error: 'blocked_by_policy' });
      return { ok: false, error: 'blocked_by_policy', message: problem };
    }

    const result = deps.chrome.execute(action);
    task.steps += 1;
    trace(task, { t: 'chrome', step: task.steps, action, ok: result.ok, error: result.ok ? undefined : result.error });
    if (!result.ok) return { ok: false, error: result.error, message: result.message };

    const view = viewForAgent(action, result.value);
    view.hosts.forEach((host) => task.seenHosts.add(host));
    return { ok: true, phrase: describeChrome(action), data: view.data };
  };

  // --- INFO lane: Gmail, Calendar and Drive ---

  const google = (task: HostTask) => {
    if (task.lane !== 'INFO' || !deps.google) throw new Error('That only works in an INFO task.');
    return deps.google;
  };

  const googleContext = (task: HostTask) => {
    const g = google(task);
    const timeZone = g.tools.timeZone();
    const now = new Date();
    return {
      email: g.email(),
      now: new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(now),
      nowIso: now.toISOString(),
      timeZone,
      access: g.access(),
    };
  };

  const MAX_INFO_CALLS = 25;

  const googleCall = async (task: HostTask, tool: string, rawArgs: unknown): Promise<GoogleCallResult> => {
    const g = google(task);
    if (task.steps >= MAX_INFO_CALLS) return { ok: false, error: 'failed', message: `Stopped after ${MAX_INFO_CALLS} steps.` };
    const parsed = parseGoogleCall(tool, rawArgs);
    if (!parsed.ok) return { ok: false, error: 'invalid', message: parsed.message };
    const { name, args } = parsed;
    const service = GOOGLE_TOOLS[name].service;

    // No permission yet: open Google's page once, and tell the lane so it can say so.
    if (!g.access()[service]) {
      if (!task.askedForAccess) {
        task.askedForAccess = true;
        void g.connect().catch(() => undefined);
      }
      return { ok: false, error: 'needs_access', service, message: 'Browsie needs permission for this Google service first. Google\'s permission page is open in the browser.' };
    }

    const key = callKey(name, args);
    try {
      if (g.tools.needsConfirm(name, args)) {
        if (task.googleGrant !== key) {
          const confirm = await g.tools.confirmation(name, args);
          task.pendingGoogleGrant = key;
          emit({ type: 'needs_confirm', taskId: task.id, turnId: task.turnId, confirm });
          return { ok: false, error: 'needs_user', message: 'The user is being asked to confirm. Wait for their answer, then call the same tool again with the same arguments.' };
        }
        // A yes covers one call, once.
        task.googleGrant = undefined;
      }
      task.steps += 1;
      const data = await g.tools.run(name, args);
      trace(task, { t: 'google', step: task.steps, tool: name, ok: true });
      return { ok: true, data };
    } catch (error) {
      trace(task, { t: 'google', step: task.steps, tool: name, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof GoogleApiError) {
        if (error.kind === 'needs_access' && !task.askedForAccess) {
          task.askedForAccess = true;
          void g.connect().catch(() => undefined);
        }
        return { ok: false, error: error.kind, service: error.service, message: error.message };
      }
      return { ok: false, error: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  };

  const handlers: { [M in RpcMethod]: (task: HostTask, params: any) => Promise<unknown> } = {
    'llm.complete': async (task, params) => {
      if (deps.broker.spentFor(task.id) >= capUsd) throw new Error('This task reached its spending limit.');
      const response = await deps.broker.complete(params, task.controller.signal);
      trace(task, { t: 'llm', step: task.steps, model: response.model, request: params, response, usage: response.usage });
      return response;
    },
    'web.observe': async (task, params) => observation(task, await takeSnapshot(task), params.screenshot),
    'web.act': (task, params) => act(task, params.actions),
    'web.finish': async (task, params) => {
      const snapshot = web(task).current() ?? (await takeSnapshot(task));
      const decision = evaluate({ type: 'finish', summary: params.summary, evidence: params.evidence }, policyContext(task, snapshot));
      return decision.ok ? { ok: true } : { ok: false, message: decision.message };
    },
    'files.list': async () => listUploadable(deps.downloadsFolder()),
    'files.choose': async (task, params) => {
      // The name must come from the user's own answer, not from the model or the page.
      const said = task.sources.get(params.sourceId)?.toLowerCase() ?? '';
      if (!said.includes(String(params.name).toLowerCase())) return { ok: false, message: "The user didn't choose that file." };
      const file = resolveUploadable(deps.downloadsFolder(), params.name);
      if (!file) return { ok: false, message: "That file isn't in the Browsie Downloads folder." };
      await web(task).setFiles([file]);
      return { ok: true };
    },
    'chrome.execute': (task, params) => chromeCommand(task, params.action),
    'google.context': async (task) => googleContext(task),
    'google.call': (task, params) => googleCall(task, params.tool, params.args),
    // Only turns call this (handled above).
    'turn.run_task': async () => {
      throw new Error('No such turn.');
    },
  };

  // Runs one task for a turn and waits for it to end, however it ends.
  const runTaskForTurn = async (turn: HostTurn, lane: 'WEB' | 'UI' | 'INFO', goal: string): Promise<TaskResult> => {
    const failed = (error: string): TaskResult => ({ taskId: '', lane, ok: false, facts: [], untrusted: false, error });
    if (turn.controller.signal.aborted) return failed('stopped');

    let taskId: string;
    try {
      taskId =
        lane === 'WEB'
          ? await api.startWebTask({ goal, turnId: turn.id })
          : lane === 'INFO'
            ? api.startInfoTask({ goal, turnId: turn.id })
            : api.startUiTask({ goal, turnId: turn.id });
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    turn.taskIds.add(taskId);
    // Stopped while the task was starting.
    if (turn.controller.signal.aborted) api.abortTask(taskId);

    return new Promise<TaskResult>((resolve) => {
      const off = api.onEvent((event) => {
        if (event.taskId !== taskId) return;
        if (event.type === 'finished' || event.type === 'failed' || event.type === 'stopped') {
          off();
          turn.taskIds.delete(taskId);
          resolve(event.result);
        }
      });
    });
  };

  const turnHandlers = {
    'llm.complete': async (turn: HostTurn, params: any) => {
      if (turn.controller.signal.aborted) throw new Error('Stopped.');
      if (deps.broker.spentFor(turn.id) >= capUsd) throw new Error('This turn reached its spending limit.');
      return deps.broker.complete(params, turn.controller.signal);
    },
    'turn.run_task': (turn: HostTurn, params: any) => runTaskForTurn(turn, params.lane, params.goal),
  } as const;

  const onAgentMessage = async (message: AgentMessage) => {
    if (message.kind === 'turn_event') {
      if (!turns.has(message.event.turnId)) return;
      if (message.event.type === 'done') turns.delete(message.event.turnId);
      turnListeners.forEach((listener) => listener(message.event));
      return;
    }

    if (message.kind === 'event') {
      const task = tasks.get(message.event.taskId);
      if (!task) return;
      const event = { ...message.event, turnId: task.turnId };
      if (event.type === 'finished' || event.type === 'failed' || event.type === 'stopped') finishTask(task, event);
      else emit(event);
      return;
    }

    const reply = (value: { ok: true; value: unknown } | { ok: false; error: string }) =>
      post({ kind: 'rpc-result', id: message.id, ...value } as HostMessage);

    try {
      const schema = RPC[message.method];
      if (!schema) throw new Error(`Unknown method ${String(message.method)}.`);
      const params = schema.parse(message.params) as { taskId: string };
      const turn = turns.get(params.taskId);
      if (turn) {
        if (message.method !== 'llm.complete' && message.method !== 'turn.run_task') throw new Error('Turns can only call models and run tasks.');
        reply({ ok: true, value: await turnHandlers[message.method](turn, params) });
        return;
      }
      if (message.method === 'turn.run_task') throw new Error('No such turn.');
      const task = tasks.get(params.taskId);
      if (!task || task.done) throw new Error('No such task.');
      if (task.controller.signal.aborted) throw new Error('Stopped.');
      reply({ ok: true, value: await handlers[message.method](task, params) });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const ensureWorker = () => {
    if (worker) return;
    const child = utilityProcess.fork(deps.workerPath, [], { serviceName: 'Browsie agent' });
    const { port1, port2 } = new MessageChannelMain();
    port1.on('message', (event) => void onAgentMessage(event.data as AgentMessage));
    port1.start();
    child.postMessage({ kind: 'init' }, [port2]);
    child.once('exit', () => {
      if (worker !== child) return;
      worker = undefined;
      port = undefined;
      failAll('The agent process stopped.');
    });
    worker = child;
    port = port1;
  };

  const restartWorker = () => {
    // Turns die with the process. Main already said "Stopped", so they just end.
    for (const turn of [...turns.values()]) {
      turns.delete(turn.id);
      turnListeners.forEach((listener) => listener({ turnId: turn.id, type: 'done', ok: false }));
    }
    const old = worker;
    worker = undefined;
    port?.close();
    port = undefined;
    old?.kill();
  };

  const newTaskId = () => `t${++taskCounter}-${Date.now().toString(36)}`;

  const register = (id: string, lane: AgentLane, goal: string, facts: string[], turnId: string | undefined, executor?: Executor) => {
    const sources = new Map<string, string>([['u1', goal], ...facts.map((fact, index) => [`f${index + 1}`, fact] as [string, string])]);
    const task: HostTask = {
      id,
      lane,
      turnId: turnId ?? id,
      goal,
      sources,
      answers: 0,
      controller: new AbortController(),
      startedAt: Date.now(),
      steps: 0,
      executor,
      seenHosts: new Set(),
      done: false,
    };
    tasks.set(id, task);
    post({ kind: 'start', lane, taskId: id, turnId: task.turnId, goal, sources: [...sources].map(([sourceId, text]) => ({ id: sourceId, text })) });
    return id;
  };

  const api = {
    // Something the user said, for the agent to classify and act on. Returns the turn's id.
    startTurn(transcript: string, context: TurnContext) {
      ensureWorker();
      const id = `turn${++taskCounter}-${Date.now().toString(36)}`;
      turns.set(id, { id, controller: new AbortController(), taskIds: new Set() });
      post({ kind: 'turn', turnId: id, transcript, context });
      return id;
    },

    // Stops a turn and whatever task it's running. The agent still reports what got done.
    abortTurn(turnId: string) {
      const turn = turns.get(turnId);
      if (!turn) return;
      turn.controller.abort();
      turn.taskIds.forEach((taskId) => api.abortTask(taskId));
      post({ kind: 'abort_turn', turnId });
    },

    onTurnEvent(listener: (event: TurnEvent) => void) {
      turnListeners.add(listener);
      return () => turnListeners.delete(listener);
    },

    // Starts a WEB task on the leased tab. `facts` are extra things the user has confirmed (f1, f2…); the
    // goal itself is always u1.
    async startWebTask({ goal, facts = [], turnId }: { goal: string; facts?: string[]; turnId?: string }) {
      ensureWorker();
      const id = newTaskId();
      const tabId = deps.leaseTab(id);
      if (tabId === undefined) throw new Error('There is no web page open to work on.');

      let executor: Executor;
      try {
        executor = await ElectronCdpExecutor.open(tabId, deps.resolveTab, deps.cursor);
      } catch (error) {
        deps.releaseTab(id);
        throw error;
      }

      return register(id, 'WEB', goal, facts, turnId, executor);
    },

    // Starts a UI task: browser chrome only (tabs, address bar, back, zoom, bookmarks), no page access.
    // Starts an INFO task: the user's Gmail, Calendar and Drive through Google's APIs, no browser page.
    startInfoTask({ goal, facts = [], turnId }: { goal: string; facts?: string[]; turnId?: string }) {
      if (!deps.google) throw new Error('Google services are not available.');
      ensureWorker();
      return register(newTaskId(), 'INFO', goal, facts, turnId);
    },

    startUiTask({ goal, facts = [], turnId }: { goal: string; facts?: string[]; turnId?: string }) {
      if (!deps.chrome) throw new Error('Browser commands are not available.');
      ensureWorker();
      return register(newTaskId(), 'UI', goal, facts, turnId);
    },

    // The user's reply to ask_user or request_help. It becomes a source the agent can cite.
    answer(taskId: string, text: string) {
      const task = tasks.get(taskId);
      if (!task) return;
      const sourceId = `a${++task.answers}`;
      task.sources.set(sourceId, text);
      trace(task, { t: 'source', step: task.steps, id: sourceId, text });
      post({ kind: 'answer', taskId, text, sourceId });
    },

    // The user's yes or no to the confirmation main read them. Only main grants: the agent can't say yes.
    confirm(taskId: string, yes: boolean) {
      const task = tasks.get(taskId);
      if (!task) return;
      if (yes && task.pendingGrant) task.grant = task.pendingGrant;
      if (yes && task.pendingGoogleGrant) task.googleGrant = task.pendingGoogleGrant;
      task.pendingGoogleGrant = undefined;
      if (task.pendingGrant) trace(task, { t: 'confirm', step: task.steps, grant: task.pendingGrant, answer: yes ? 'yes' : 'no' });
      task.pendingGrant = undefined;
      post({ kind: 'answer', taskId, text: yes ? 'yes' : 'no', confirmed: yes });
    },

    // Space or "stop". Main's side stops at once (in-flight CDP commands and model calls are cancelled); the
    // agent gets two seconds to report what it finished before it's killed and restarted.
    abortTask(taskId: string) {
      const task = tasks.get(taskId);
      if (!task || task.controller.signal.aborted) return;
      task.controller.abort();
      post({ kind: 'abort', taskId });
      task.watchdog = setTimeout(() => {
        if (task.done) return;
        restartWorker();
        const result: TaskResult = { taskId, lane: task.lane, ok: false, facts: [], untrusted: true, error: 'stopped' };
        finishTask(task, { type: 'stopped', taskId, turnId: task.turnId, result });
      }, STOP_WATCHDOG_MS);
    },

    onEvent(listener: (event: TaskEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // From files.ts: a download began on some page. Tells the task working on that page, if any.
    noteDownload(contents: WebContents | undefined, fileName: string) {
      for (const task of tasks.values()) {
        if (contents && task.executor && deps.resolveTab(task.executor.tabId) === contents) task.executor.noteDownload(fileName);
      }
    },

    activeTasks: () => [...tasks.keys()],

    stop() {
      for (const id of [...turns.keys()]) api.abortTurn(id);
      for (const id of [...tasks.keys()]) api.abortTask(id);
      restartWorker();
    },
  };

  return api;
};

export type AgentHost = ReturnType<typeof createAgentHost>;
