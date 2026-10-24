import fs from 'node:fs';
import path from 'node:path';
import { FALLBACKS, type FallbackId } from '../src/shared/agent/fallbacks';
import { createSpeechApi } from '../src/main/voice/speechApi';

// `npm run voice:clips`: records each fixed line (shared/agent/fallbacks.ts) once, in the same ElevenLabs
// voice as live speech, into src/renderer/assets/voice/<id>.mp3. The app then plays these instantly and
// for free. Run it again after changing a line. Needs OPENROUTER_API_KEY; costs a few cents.

const OUT_DIR = path.resolve(process.cwd(), 'src/renderer/assets/voice');

const main = async () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('Set OPENROUTER_API_KEY first.');
    process.exit(1);
  }

  const only = process.argv.slice(2);
  const speech = createSpeechApi({ getKey: () => key });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [id, text] of Object.entries(FALLBACKS) as [FallbackId, string][]) {
    if (only.length && !only.includes(id)) continue;
    const audio = await speech.speak(text);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.mp3`), audio);
    console.log(`${id}.mp3  ${JSON.stringify(text)}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
