import { MessageChannelMain, type MessagePortMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { RPC, type ActResponse, type AgentMessage, type HostMessage, type Observation, type RpcMethod, type TaskEvent, type TaskResult } from '../../shared/agent/protocol';
import { textForModel, type Snapshot } from '../web/snapshot';
import { checkLimits, evaluate, evaluateBatch, grantFor, type ConfirmGrant, type PolicyContext } from '../web/policy';
import { ElectronCdpExecutor, type Executor, type TabResolver } from '../web/executor';
import { listUploadable, resolveUploadable } from '../web/files';
import { TASK_SPEND_CAP_USD } from './config';
import type { Broker } from './broker';
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
  allowPrivateNetwork?: boolean;
  capUsd?: number;
  onTrace?: (taskId: string, event: TraceEvent) => void;
};

type HostTask = {
  id: string;
  turnId: string;
  goal: string;
  sources: Map<string, string>;
  answers: number;
  controller: AbortController;
  startedAt: number;
  steps: number;
  executor: Executor;
  grant?: ConfirmGrant;
  pendingGrant?: ConfirmGrant;
  done: boolean;
  watchdog?: ReturnType<typeof setTimeout>;
};

// After Space or "stop", the agent has this long to say it stopped before it's killed and started again.
const STOP_WATCHDOG_MS = 2_000;
const MAX_NAMES = 400;

let taskCounter = 0;

export const createAgentHost = (deps: HostDeps) => {
  const tasks = new Map<string, HostTask>();
  const listeners = new Set<(event: TaskEvent) => void>();
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
    task.executor.close();
    deps.releaseTab(task.id);
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
    for (const task of [...tasks.values()]) {
      const result: TaskResult = { taskId: task.id, lane: 'WEB', ok: false, facts: [], untrusted: true, error: reason };
      finishTask(task, { type: 'failed', taskId: task.id, turnId: task.turnId, result });
    }
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
      screenshot: screenshot ? await task.executor.screenshot() : undefined,
      fileChooser: task.executor.fileChooserPending(),
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
    fileChooser: task.executor.fileChooserPending(),
  });

  const takeSnapshot = async (task: HostTask) => {
    const snapshot = await task.executor.snapshot(task.controller.signal);
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
    const before = task.executor.current() ?? (await takeSnapshot(task));
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
    const batch = await task.executor.runBatch(run, task.controller.signal);
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
      const snapshot = task.executor.current() ?? (await takeSnapshot(task));
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
      await task.executor.setFiles([file]);
      return { ok: true };
    },
  };

  const onAgentMessage = async (message: AgentMessage) => {
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
    const old = worker;
    worker = undefined;
    port?.close();
    port = undefined;
    old?.kill();
  };

  return {
    // Starts a WEB task on the leased tab. `sources` are extra things the user has confirmed (f1, f2…); the
    // goal itself is always u1.
    async startWebTask({ goal, facts = [], turnId }: { goal: string; facts?: string[]; turnId?: string }) {
      ensureWorker();
      const id = `t${++taskCounter}-${Date.now().toString(36)}`;
      const tabId = deps.leaseTab(id);
      if (tabId === undefined) throw new Error('There is no web page open to work on.');

      let executor: Executor;
      try {
        executor = await ElectronCdpExecutor.open(tabId, deps.resolveTab);
      } catch (error) {
        deps.releaseTab(id);
        throw error;
      }

      const sources = new Map<string, string>([['u1', goal], ...facts.map((fact, index) => [`f${index + 1}`, fact] as [string, string])]);
      const task: HostTask = {
        id,
        turnId: turnId ?? id,
        goal,
        sources,
        answers: 0,
        controller: new AbortController(),
        startedAt: Date.now(),
        steps: 0,
        executor,
        done: false,
      };
      tasks.set(id, task);
      post({ kind: 'start', taskId: id, turnId: task.turnId, goal, sources: [...sources].map(([sourceId, text]) => ({ id: sourceId, text })) });
      return id;
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
        const result: TaskResult = { taskId, lane: 'WEB', ok: false, facts: [], untrusted: true, error: 'stopped' };
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
        if (contents && deps.resolveTab(task.executor.tabId) === contents) task.executor.noteDownload(fileName);
      }
    },

    activeTasks: () => [...tasks.keys()],

    stop() {
      for (const id of [...tasks.keys()]) this.abortTask(id);
      restartWorker();
    },
  };
};

export type AgentHost = ReturnType<typeof createAgentHost>;
