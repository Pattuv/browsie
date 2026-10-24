import { z } from 'zod';
import type { ChatMessage, LlmResponse, Tier, ToolDef } from '../../shared/agent/llm';
import type { GoogleContext, Source, TaskEventBody, TaskResult } from '../../shared/agent/protocol';
import { GOOGLE_TOOL_NAMES, GOOGLE_TOOLS, type GoogleCallResult } from '../../shared/google/tools';
import LANE_PROMPT from './prompt.md?raw';
import SAFETY from '../prompts/safety.md?raw';

const SYSTEM_PROMPT = `${LANE_PROMPT}
${SAFETY}`;

// info lane: basis on which google tools can be called to provide user information.
// Consists of a tool-calling loop where the model calls tools, reads the results, and finishes with what to say.

export type InfoDeps = {
  llm(request: { tier: Tier; messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number }): Promise<LlmResponse>;
  context(): Promise<GoogleContext>;
  call(tool: string, args: unknown): Promise<GoogleCallResult>;
  emit(event: TaskEventBody): void;
  waitForAnswer(): Promise<{ text: string; sourceId?: string; confirmed?: boolean }>;
  signal: AbortSignal;
};

export type InfoTask = { taskId: string; goal: string; sources: Source[] };

const MAX_ROUNDS = 12;
const ESCALATE_AFTER = 2;
// this includes thinking as well, only billed for what's used.
const MAX_REPLY_TOKENS = 8_000;
const MAX_RESULT_CHARS = 12_000;

// error code for if agent doesn't have google access (see FAILURES in verbalEngine.ts)
export const NEEDS_GOOGLE_ACCESS = 'needs_google_access';

const toolDef = (name: string, description: string, input: z.ZodType): ToolDef => {
  const { $schema: _, ...parameters } = z.toJSONSchema(input) as Record<string, unknown>;
  return { type: 'function', function: { name, description, parameters } };
};

const FINISH = z.strictObject({ summary: z.string().min(1).max(800) });
const ASK = z.strictObject({ question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(100)).min(2).max(5).optional() });

export const INFO_TOOLS: ToolDef[] = [
  ...GOOGLE_TOOL_NAMES.map((name) => toolDef(name, GOOGLE_TOOLS[name].description, GOOGLE_TOOLS[name].input)),
  toolDef('ask_user', 'Ask the user a short question, e.g. which of two events they mean. Use only when you really need to.', ASK),
  toolDef('finish', 'End the task with what to say to the user, read aloud. Call this alone, after your other tools.', FINISH),
];

const SERVICE_NAMES = { gmail: 'Gmail', calendar: 'Google Calendar', drive: 'Google Drive' } as const;

class Stopped extends Error {}

const wrap = (data: unknown) => {
  const text = JSON.stringify(data);
  return `<untrusted_google_data>\n${text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (cut short)` : text}\n</untrusted_google_data>`;
};

export const runInfoTask = async (task: InfoTask, deps: InfoDeps): Promise<TaskResult> => {
  const done: string[] = [];
  let failures = 0;
  let step = 0;
  let sawData = false;

  const result = (ok: boolean, facts: string[], error?: string): TaskResult => ({ taskId: task.taskId, lane: 'INFO', ok, facts, untrusted: sawData, error });
  const end = (type: 'finished' | 'failed' | 'stopped', value: TaskResult) => {
    deps.emit({ type, result: value });
    return value;
  };
  const checkStopped = () => {
    if (deps.signal.aborted) throw new Stopped();
  };

  try {
    const context = await deps.context();
    checkStopped();
    const missing = (Object.keys(context.access) as (keyof typeof SERVICE_NAMES)[]).filter((service) => !context.access[service]);
    const messages: ChatMessage[] = [
      { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] },
      {
        role: 'user',
        content: [
          `The user's Google account: ${context.email ?? 'signed in'}.`,
          `Right now it's ${context.now} (${context.timeZone}).`,
          missing.length ? `Browsie doesn't have permission for ${missing.map((service) => SERVICE_NAMES[service]).join(', ')} yet; a tool for it will say so.` : '',
          `They said: ${JSON.stringify(task.goal)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      checkStopped();
      const reply = await deps.llm({ tier: failures >= ESCALATE_AFTER ? 'escalate' : 'main', messages, tools: INFO_TOOLS, maxTokens: MAX_REPLY_TOKENS });
      checkStopped();

      if (reply.toolCalls.length === 0) {
        // A plain answer with no tool call: take it as the finish.
        if (reply.content.trim()) return end('finished', result(true, [reply.content.trim()]));
        messages.push({ role: 'assistant', content: null });
        messages.push({ role: 'user', content: 'Call a tool, or finish.' });
        failures += 1;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: reply.content || null,
        tool_calls: reply.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
      });

      let roundFailed = false;
      for (const call of reply.toolCalls) {
        const respond = (text: string) => messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        let args: unknown;
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          respond("Those arguments weren't valid JSON.");
          roundFailed = true;
          continue;
        }

        if (call.name === 'finish') {
          const parsed = FINISH.safeParse(args);
          if (parsed.success) return end('finished', result(true, [parsed.data.summary]));
          respond('finish needs a summary.');
          roundFailed = true;
          continue;
        }

        if (call.name === 'ask_user') {
          const parsed = ASK.safeParse(args);
          if (!parsed.success) {
            respond('ask_user needs a question.');
            roundFailed = true;
            continue;
          }
          deps.emit({ type: 'ask_user', question: parsed.data.question, options: parsed.data.options });
          const answer = await deps.waitForAnswer();
          checkStopped();
          respond(`The user answered: ${JSON.stringify(answer.text)}`);
          continue;
        }

        step += 1;
        deps.emit({ type: 'step_started', step, phrase: phraseFor(call.name) });
        let outcome = await deps.call(call.name, args);
        checkStopped();

        // Main is reading the user a summary and waiting for yes or no.
        // this is used for confirmation or anything else that requires further looking by the user.
        if (!outcome.ok && outcome.error === 'needs_user') {
          const answer = await deps.waitForAnswer();
          checkStopped();
          if (!answer.confirmed) {
            deps.emit({ type: 'step_done', step, ok: false });
            return end('finished', result(false, done, 'declined'));
          }
          outcome = await deps.call(call.name, args);
          checkStopped();
        }

        if (!outcome.ok && outcome.error === 'needs_access') {
          deps.emit({ type: 'step_done', step, ok: false });
          return end('failed', result(false, done, NEEDS_GOOGLE_ACCESS));
        }
        if (!outcome.ok && outcome.error === 'api_disabled') {
          deps.emit({ type: 'step_done', step, ok: false });
          return end('failed', result(false, done, outcome.message));
        }

        deps.emit({ type: 'step_done', step, ok: outcome.ok });
        if (outcome.ok) {
          sawData = true;
          done.push(phraseFor(call.name));
          respond(wrap(outcome.data));
        } else {
          roundFailed = true;
          respond(`That didn't work (${outcome.error}): ${outcome.message}`);
        }
      }
      failures = roundFailed ? failures + 1 : 0;
    }

    return end('failed', result(false, done, "I couldn't finish that."));
  } catch (error) {
    if (error instanceof Stopped || deps.signal.aborted) return end('stopped', result(false, done, 'stopped'));
    return end('failed', result(false, done, error instanceof Error ? error.message : String(error)));
  }
};

// Narration for calendar reading and editing.
const PHRASES: Record<string, string> = {
  gmail_search: 'Checking your email',
  gmail_read: 'Reading the email',
  gmail_send: 'Sending the email',
  gmail_draft: 'Saving a draft',
  gmail_modify: 'Updating your email',
  gmail_trash: 'Deleting the email',
  calendar_list: 'Checking your calendar',
  calendar_create: 'Adding it to your calendar',
  calendar_update: 'Changing the event',
  calendar_delete: 'Deleting the event',
  drive_search: 'Looking in your Drive',
  drive_read: 'Reading the file',
  drive_create_doc: 'Creating the document',
  drive_append_doc: 'Adding to the document',
  drive_rename: 'Renaming the file',
  drive_trash: 'Deleting the file',
};

export const phraseFor = (tool: string) => PHRASES[tool] ?? 'Working on it';
