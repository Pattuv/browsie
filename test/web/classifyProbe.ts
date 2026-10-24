import { createBroker } from '../../src/main/agent/broker';
import { classify } from '../../src/agent/classifier';

// Calls the real classifier on a few transcripts and prints the raw reply and the parsed label, to see why
// some come back UNCLEAR. Run through withAppKey (needs OPENROUTER_API_KEY).

const SAMPLES: [string, string | undefined][] = [
  ["what's on my calendar tomorrow?", undefined],
  ['am I free at 3?', 'www.youtube.com'],
  ['create an event called Bro on the twenty-fourth of October', undefined],
  ['any new emails?', undefined],
  ['read out the first three emails', 'mail.google.com'],
  ['reply to Sam and say I will be there', undefined],
  ["what's in my storage?", undefined],
  ['find my resume', undefined],
  ['open Gmail', undefined],
  ['click the second email', 'mail.google.com'],
  ['go to Amazon and add a blue mug to my cart', undefined],
];

const main = async () => {
  const broker = createBroker({ getKey: () => process.env.OPENROUTER_API_KEY ?? null });
  for (const [transcript, site] of SAMPLES) {
    let raw: unknown;
    const result = await classify(
      async (request) => {
        const reply = await broker.complete({ taskId: 'probe', ...request }, new AbortController().signal);
        raw = { content: reply.content, finishReason: reply.finishReason, usage: reply.usage };
        return reply;
      },
      transcript,
      { site, tabCount: 1 },
      [],
    );
    console.log(JSON.stringify({ transcript, site, result, raw }, null, 1));
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
