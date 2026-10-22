import { createBroker } from '../../src/main/agent/broker';
import { classify } from '../../src/agent/classifier';

// Calls the real classifier on a few transcripts and prints the raw reply and the parsed label, to see why
// some come back UNCLEAR. Run through withAppKey (needs OPENROUTER_API_KEY).

const SAMPLES: [string, string | undefined][] = [
  ['What am I looking at right now?', 'mail.google.com'],
  ['Um, read out the first three emails for me', 'mail.google.com'],
  ['open Gmail', undefined],
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
