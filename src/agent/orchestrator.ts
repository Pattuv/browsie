import type { TurnContext } from '../shared/agent/protocol';
import { extractJson, type PlannedTask, TaskPlan } from '../shared/agent/tasks';
import type { Llm } from './classifier';
import SYSTEM_PROMPT from './prompts/orchestrator.md?raw';

// ORCHESTRATOR - this splits a multi-step request into one to three tasks for the UI, WEB and INFO lanes. 
// Single-step requests skip this and the classifier's label and the user's words are the plan.

export const planTasks = async (llm: Llm, transcript: string, context: TurnContext): Promise<PlannedTask[] | undefined> => {
  const reply = await llm({
    tier: 'main',
    maxTokens: 4_000,
    messages: [
      { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] },
      {
        role: 'user',
        content: `${context.site ? `The current tab shows ${context.site}.` : 'No website is open.'}\nThe user said: ${JSON.stringify(transcript)}`,
      },
    ],
  });
  const plan = TaskPlan.safeParse(extractJson(reply.content));
  return plan.success ? plan.data.tasks : undefined;
};
