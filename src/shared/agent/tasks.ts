import { z } from 'zod';

// The orchestrator's plan: one to three tasks, run in order, each for one lane.
export const TaskPlan = z.object({
  tasks: z
    .array(z.object({ lane: z.enum(['UI', 'WEB', 'INFO']), goal: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(3),
});

export type TaskPlan = z.infer<typeof TaskPlan>;
export type PlannedTask = TaskPlan['tasks'][number];

// Models sometimes wrap JSON in prose or a code fence. Take the first {...} that parses.
export const extractJson = (text: string): unknown => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
};
