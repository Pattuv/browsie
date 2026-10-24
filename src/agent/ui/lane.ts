import { z } from 'zod';
import type { ChatMessage, LlmResponse, Tier, ToolDef } from '../../shared/agent/llm';
import type { ChromeResponse, Source, TaskEventBody, TaskResult } from '../../shared/agent/protocol';
import { type ChromeAction, describe, parseChromeAction } from '../../shared/chrome/actions';
import LANE_PROMPT from './prompt.md?raw';
import SAFETY from '../prompts/safety.md?raw';

const SYSTEM_PROMPT = `${LANE_PROMPT}
${SAFETY}`;

// ui lane: this controls the browser chrome through the command table in shared/chrome/actions.ts. It has no page access or real GUI interaction.
// This is usually a one model call ("open a new tab"), sometimes multiple when it has to look  for information first
// ex: ("switch to my email tab" → tabs.list → tabs.switch).

export type UiDeps = {
  llm(request: { tier: Tier; messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number }): Promise<LlmResponse>;
  execute(action: ChromeAction): Promise<ChromeResponse>;
  emit(event: TaskEventBody): void;
  waitForAnswer(): Promise<{ text: string; sourceId?: string }>;
  signal: AbortSignal;
};

export type UiTask = { taskId: string; goal: string; sources: Source[] };

const MAX_ROUNDS = 8;
const ESCALATE_AFTER = 2;
// this includes thinking as well, only billed for what's used.
const MAX_REPLY_TOKENS = 6_000;

const COMMANDS = [
  'tabs.list', 'tabs.open', 'tabs.switch', 'tabs.close', 'tabs.move', 'tabs.mute', 'tabs.duplicate',
  'nav.go', 'nav.back', 'nav.forward', 'nav.reload', 'nav.stop',
  'view.zoom', 'page.open',
  'bookmarks.add', 'bookmarks.remove', 'bookmarks.open', 'bookmarks.list', 'history.search', 'bookmarksBar.set',
  'state.read',
];

export const UI_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'ui',
    description: 'Run browser commands, ask the user a question, or finish. Call this every turn, with exactly one of commands, ask_user or finish.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        commands: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          description: 'Commands to run in order.',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: COMMANDS },
              url: { type: 'string', description: 'tabs.open: optional site or search words.' },
              input: { type: 'string', description: 'nav.go: site or search words.' },
              target: {
                type: 'object',
                description: 'tabs.switch: {"by":"id","id":N}, {"by":"index","index":N} (0 is the first tab) or {"by":"next"}.',
              },
              id: { description: 'Tab id (a number, from tabs.list) or bookmark id (a string, from bookmarks.list).' },
              index: { type: 'integer', description: 'tabs.move: new position, 0 is first.' },
              direction: { type: 'string', enum: ['in', 'out', 'reset'], description: 'view.zoom.' },
              page: { type: 'string', enum: ['history', 'bookmarks'], description: 'page.open.' },
              query: { type: 'string', description: 'history.search.' },
              visible: { type: 'boolean', description: 'bookmarksBar.set.' },
            },
          },
        },
        ask_user: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, description: '2 to 5 short choices.' },
          },
        },
        finish: {
          type: 'object',
          required: ['summary'],
          properties: {
            summary: { type: 'string', description: 'One short sentence, read aloud.' },
            handoff_to_page: {
              type: 'string',
              description: 'What still has to be done on the web page itself (click, open the Images tab, read, fill in), for the page assistant. Leave out when nothing is left.',
            },
          },
        },
      },
    },
  },
};

const Call = z.union([
  z.object({ commands: z.array(z.unknown()).min(1).max(3) }),
  z.object({ ask_user: z.object({ question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(100)).min(2).max(5).optional() }) }),
  z.object({ finish: z.object({ summary: z.string().min(1).max(500), handoff_to_page: z.string().trim().min(1).max(500).optional() }) }),
]);

class Stopped extends Error {}

// Website-written data goes back marked as such, so it reads as information.
const wrapData = (data: unknown) =>
  data === undefined ? '' : `\n<untrusted_browser_data>\n${JSON.stringify(data)}\n</untrusted_browser_data>`;

export const runUiTask = async (task: UiTask, deps: UiDeps): Promise<TaskResult> => {
  const done: string[] = [];
  let sawData = false;
  let failures = 0;
  let step = 0;

  const result = (ok: boolean, facts: string[], error?: string): TaskResult => ({
    taskId: task.taskId,
    lane: 'UI',
    ok,
    facts,
    untrusted: sawData,
    error,
  });

  const end = (type: 'finished' | 'failed' | 'stopped', value: TaskResult) => {
    deps.emit({ type, result: value });
    return value;
  };

  const checkStopped = () => {
    if (deps.signal.aborted) throw new Stopped();
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: `The user said: ${JSON.stringify(task.goal)}` },
  ];

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      checkStopped();
      const tier: Tier = failures >= ESCALATE_AFTER ? 'escalate' : 'main';
      const reply = await deps.llm({ tier, messages, tools: [UI_TOOL], maxTokens: MAX_REPLY_TOKENS });
      checkStopped();

      const call = reply.toolCalls.find((candidate) => candidate.name === 'ui');
      if (!call) {
        messages.push({ role: 'assistant', content: reply.content || null });
        messages.push({ role: 'user', content: 'Respond by calling the ui tool.' });
        failures += 1;
        continue;
      }
      messages.push({
        role: 'assistant',
        content: reply.content || null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: 'ui', arguments: call.arguments } }],
      });
      const respond = (text: string) => messages.push({ role: 'tool', tool_call_id: call.id, content: text });

      let input: unknown;
      try {
        input = JSON.parse(call.arguments || '{}');
      } catch {
        respond("Those arguments weren't valid JSON. Call ui again.");
        failures += 1;
        continue;
      }

      const parsed = Call.safeParse(input);
      if (!parsed.success) {
        respond('Send exactly one of commands, ask_user or finish.');
        failures += 1;
        continue;
      }

      if ('finish' in parsed.data) {
        const { summary, handoff_to_page: pageGoal } = parsed.data.finish;
        const finished = result(true, [summary]);
        // The page part goes to the WEB lane next, in the same turn.
        if (pageGoal) finished.handoff = { lane: 'WEB', goal: pageGoal };
        return end('finished', finished);
      }

      if ('ask_user' in parsed.data) {
        const { question, options } = parsed.data.ask_user;
        deps.emit({ type: 'ask_user', question, options });
        const answer = await deps.waitForAnswer();
        checkStopped();
        respond(`The user answered: ${JSON.stringify(answer.text)}`);
        continue;
      }

      const lines: string[] = [];
      let roundFailed = false;
      for (const raw of parsed.data.commands) {
        const command = parseChromeAction(raw);
        if (!command.success) {
          lines.push(`${JSON.stringify(raw)}: not a valid command (${command.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}).`);
          roundFailed = true;
          break;
        }

        step += 1;
        deps.emit({ type: 'step_started', step, phrase: describe(command.data) });
        const response = await deps.execute(command.data);
        checkStopped();

        if (!response.ok) {
          deps.emit({ type: 'step_done', step, ok: false });
          if (response.limit) return end('failed', result(false, done, response.message));
          lines.push(`${command.data.type}: didn't work (${response.error}): ${response.message}`);
          roundFailed = true;
          break;
        }

        deps.emit({ type: 'step_done', step, ok: true });
        done.push(response.phrase);
        if (response.data !== undefined) sawData = true;
        lines.push(`${command.data.type}: done.${wrapData(response.data)}`);
      }

      failures = roundFailed ? failures + 1 : 0;
      respond(lines.join('\n'));
    }

    return end('failed', result(false, done, "I couldn't finish that."));
  } catch (error) {
    if (error instanceof Stopped || deps.signal.aborted) return end('stopped', result(false, done, 'stopped'));
    return end('failed', result(false, done, error instanceof Error ? error.message : String(error)));
  }
};
