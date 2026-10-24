import fs from 'node:fs';
import path from 'node:path';
import type { TraceEvent } from '../../src/main/agent/traceEvents';

// One JSON object per line, in the order things happened. The event types live with the host, which
// records them. This file reads and writes trace files.

export {
  type DecisionSummary,
  deserializeSnapshot,
  type SerializedSnapshot,
  serializeSnapshot,
  type TraceEvent,
} from '../../src/main/agent/traceEvents';

export const parseTrace = (text: string): TraceEvent[] =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as TraceEvent;
      } catch {
        throw new Error(`Trace line ${index + 1} isn't valid JSON.`);
      }
    });

export const readTrace = (file: string) => parseTrace(fs.readFileSync(file, 'utf8'));

// Appends as it goes, so a crashed run still leaves everything up to the crash.
export class TraceWriter {
  readonly file: string;

  constructor(dir: string, run: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${run}.jsonl`);
    fs.writeFileSync(this.file, '');
  }

  write(event: TraceEvent) {
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`);
  }
}
