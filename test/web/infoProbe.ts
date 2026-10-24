import { createBroker } from '../../src/main/agent/broker';
import { runInfoTask } from '../../src/agent/info/lane';
import type { GoogleCallResult } from '../../src/shared/google/tools';

// Runs the real INFO lane and model with a fake Google behind it, to check OpenRouter accepts every tool
// schema and the model picks sensible tools. Run through withAppKey --script (needs OPENROUTER_API_KEY).

const FAKE: Record<string, unknown> = {
  calendar_list: { timeZone: 'America/New_York', events: [{ id: 'e1', title: 'Dentist', start: '2026-10-24T10:00:00-04:00', end: '2026-10-24T11:00:00-04:00' }] },
  gmail_search: { emails: [{ id: 'm1', from: 'Sam Lee <sam@example.com>', subject: 'Lunch Friday?', date: 'Fri, 23 Oct 2026', preview: 'Are we still on?', unread: true }], more: false },
  drive_search: { files: [{ id: 'f1', name: 'Resume 2026', kind: 'Google Doc', modified: '2026-10-20T12:00:00Z' }] },
};

const main = async () => {
  const broker = createBroker({ getKey: () => process.env.OPENROUTER_API_KEY ?? null });
  for (const goal of ["what's on my calendar tomorrow?", 'any new emails?', 'find my resume']) {
    const called: string[] = [];
    const result = await runInfoTask(
      { taskId: 'probe', goal, sources: [{ id: 'u1', text: goal }] },
      {
        signal: new AbortController().signal,
        emit: () => undefined,
        waitForAnswer: async () => ({ text: 'yes', confirmed: true }),
        llm: (request) => broker.complete({ taskId: 'probe', ...request }, new AbortController().signal),
        context: async () => ({
          email: 'sam@example.com',
          now: 'Friday, October 23, 2026 at 9:00 PM',
          nowIso: '2026-10-24T01:00:00.000Z',
          timeZone: 'America/New_York',
          access: { gmail: true, calendar: true, drive: true },
        }),
        call: async (tool, args): Promise<GoogleCallResult> => {
          called.push(`${tool} ${JSON.stringify(args)}`);
          return tool in FAKE ? { ok: true, data: FAKE[tool] } : { ok: false, error: 'failed', message: 'not in probe' };
        },
      },
    );
    console.log(JSON.stringify({ goal, called, ok: result.ok, said: result.facts, error: result.error }, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
