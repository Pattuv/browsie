import type { MessagePortMain } from 'electron';
import type { AgentMessage, HostMessage, RpcMethod, RpcParams, RpcResults, TaskEventBody } from '../shared/agent/protocol';
import { type Answer, runWebTask } from './web/loop';

// The agent utilityProcess. It runs every model-facing step and holds no keys and no Electron APIs: all it
// has is the MessagePort main hands it, and every request on it is checked again in main.

type RunningTask = {
  controller: AbortController;
  answers: Answer[];
  waiter?: { resolve: (answer: Answer) => void; reject: (error: Error) => void };
};

let port: MessagePortMain | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const tasks = new Map<string, RunningTask>();

const post = (message: AgentMessage) => port?.postMessage(message);

const call = <M extends RpcMethod>(method: M, params: RpcParams<M>) =>
  new Promise<RpcResults[M]>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ kind: 'rpc', id, method, params });
  });

const start = (taskId: string, turnId: string, goal: string, sources: { id: string; text: string }[]) => {
  const running: RunningTask = { controller: new AbortController(), answers: [] };
  tasks.set(taskId, running);
  const { signal } = running.controller;

  const emit = (body: TaskEventBody) => post({ kind: 'event', event: { ...body, taskId, turnId } as never });

  void runWebTask(
    { taskId, goal, sources },
    {
      signal,
      emit,
      llm: (request) => call('llm.complete', { taskId, ...request }),
      web: {
        observe: (screenshot) => call('web.observe', { taskId, screenshot }),
        act: (actions) => call('web.act', { taskId, actions }),
        finish: (summary, evidence) => call('web.finish', { taskId, summary, evidence }),
        listFiles: () => call('files.list', { taskId }),
        chooseFile: (name, sourceId) => call('files.choose', { taskId, name, sourceId }),
      },
      waitForAnswer: () => {
        const queued = running.answers.shift();
        if (queued) return Promise.resolve(queued);
        if (signal.aborted) return Promise.reject(new Error('stopped'));
        return new Promise<Answer>((resolve, reject) => {
          running.waiter = { resolve, reject };
        });
      },
    },
  ).finally(() => tasks.delete(taskId));
};

const onHostMessage = (message: HostMessage) => {
  switch (message.kind) {
    case 'rpc-result': {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) waiting?.resolve(message.value);
      else waiting?.reject(new Error(message.error));
      return;
    }
    case 'start':
      start(message.taskId, message.turnId, message.goal, message.sources);
      return;
    case 'answer': {
      const task = tasks.get(message.taskId);
      if (!task) return;
      const answer: Answer = { text: message.text, sourceId: message.sourceId, confirmed: message.confirmed };
      const waiter = task.waiter;
      task.waiter = undefined;
      if (waiter) waiter.resolve(answer);
      else task.answers.push(answer);
      return;
    }
    case 'abort': {
      const task = tasks.get(message.taskId);
      if (!task) return;
      task.controller.abort();
      task.waiter?.reject(new Error('stopped'));
      task.waiter = undefined;
      return;
    }
  }
};

process.parentPort.once('message', (event) => {
  port = event.ports[0];
  port.on('message', (message) => onHostMessage(message.data as HostMessage));
  port.start();
});
