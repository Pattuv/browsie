import type { TaskResult } from '../shared/agent/protocol';

// What Browsie says when tasks end. No model call: each lane already finishes with a one-sentence summary
// written to be read aloud, so this joins them and turns failures and stops into plain words.
// (Step-by-step narration comes from main, which hears each step_started as it happens.)

const FAILURES: [RegExp, string][] = [
  [/no web page|no website/i, "There's no web page open for me to work on."],
  [/declined/i, "OK, I didn't do it."],
  [/spending limit|over its limit|out of credit/i, 'I stopped because this task reached its spending limit.'],
  [/40 steps|5 minutes|commands/i, 'That was taking too long, so I stopped.'],
  [/tab was closed/i, 'The tab was closed, so I stopped.'],
  [/key/i, "Browsie's AI key isn't working, so I couldn't do that."],
];

const failureText = (error: string | undefined) =>
  FAILURES.find(([pattern]) => error && pattern.test(error))?.[1] ?? "Sorry, I couldn't finish that.";

const sentence = (text: string) => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

// "Clicking "Add to cart"" → "clicked "Add to cart"", for "I'd clicked … before I stopped".
const pastTense = (phrase: string) =>
  phrase
    .replace(/^Clicking/, 'clicked')
    .replace(/^Typing into/, 'typed into')
    .replace(/^Typing/, 'typed')
    .replace(/^Going to/, 'gone to')
    .replace(/^Opening/, 'opened')
    .replace(/^Choosing/, 'chosen')
    .replace(/^Pressing/, 'pressed')
    .replace(/^Switching/, 'switched')
    .replace(/^Scrolling/, 'scrolled')
    .replace(/^Closing/, 'closed');

export const composeStopped = (steps: readonly string[]) => {
  if (steps.length === 0) return "I stopped before doing anything.";
  const recent = steps.slice(-2).map(pastTense);
  return `I stopped. I'd ${recent.join(' and ')}.`;
};

export const composeReply = (results: readonly TaskResult[]) => {
  const parts: string[] = [];
  for (const result of results) {
    if (result.error === 'stopped') {
      parts.push(composeStopped(result.facts));
      break;
    }
    if (result.ok) {
      parts.push(...result.facts.slice(-1).map(sentence));
      continue;
    }
    parts.push(failureText(result.error));
    break;
  }
  return parts.join(' ') || 'Done.';
};
