// Spoken commands handled before any model call: stop, repeat, louder, quieter, slower, faster. Main runs
// these the moment a transcript arrives, so "stop" works even when the agent process is busy or stuck.
//
// Only short utterances that are just the command count. "Stop the video" is a request for the browser
// (nav.stop or a page click), not a control word.

export type ControlCommand = 'stop' | 'repeat' | 'louder' | 'quieter' | 'slower' | 'faster';

const PHRASES: Record<ControlCommand, string[]> = {
  stop: ['stop', 'cancel', 'never mind', 'nevermind', 'forget it', 'stop it', 'stop that', 'quit', 'halt', 'abort'],
  repeat: ['repeat', 'repeat that', 'say that again', 'say again', 'what did you say', 'pardon', 'come again', 'again'],
  louder: ['louder', 'speak up', 'volume up', 'turn it up', 'speak louder'],
  quieter: ['quieter', 'softer', 'volume down', 'turn it down', 'speak quieter', 'speak softer'],
  slower: ['slower', 'slow down', 'speak slower', 'talk slower'],
  faster: ['faster', 'speed up', 'speak faster', 'talk faster'],
};

// Polite padding that doesn't change the command.
const FILLER = /\b(please|browsie|ok|okay|hey|um|uh|now|just|a bit|a little)\b/g;
const MAX_WORDS = 5;

export const normalizeUtterance = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const matchControl = (transcript: string): ControlCommand | undefined => {
  if (transcript.trim().split(/\s+/).length > MAX_WORDS) return undefined;
  const said = normalizeUtterance(transcript);
  if (!said) return undefined;
  for (const [command, phrases] of Object.entries(PHRASES) as [ControlCommand, string[]][]) {
    if (phrases.includes(said)) return command;
  }
  return undefined;
};

// The user's answer to "Shall I place the order?". Unclear answers are asked again, never taken as yes.
const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go ahead', 'do it', 'please do', 'confirm', 'correct', 'that is right', "that's right", 'yes please', 'absolutely', 'of course'];
const NO = ['no', 'nope', 'nah', "don't", 'do not', 'no thanks', 'no thank you', 'cancel', 'stop', 'never mind', 'not now', 'wait'];

export const parseYesNo = (transcript: string): 'yes' | 'no' | undefined => {
  const said = transcript.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!said) return undefined;
  const has = (phrases: string[]) => phrases.some((phrase) => said === phrase || said.startsWith(`${phrase} `));
  // "No, don't" and "yes… actually no" both mean no: a no anywhere wins.
  if (has(NO) || /\b(no|don't|not)\b/.test(said)) return 'no';
  if (has(YES)) return 'yes';
  return undefined;
};
