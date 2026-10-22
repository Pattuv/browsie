import { matchControl, parseYesNo } from '../../shared/agent/controlRules';
import { FALLBACKS, type FallbackId } from '../../shared/agent/fallbacks';
import type { TaskEvent, TurnContext, TurnEvent } from '../../shared/agent/protocol';
import type { ConfirmRequest } from '../../shared/web/actions';
import type { SpeechApi, SpeechErrorCode } from './speechApi';

// The voice side of main: what Space does, what happens to what the user said, and what Browsie says.
// Main owns this, so Space stops a task even when the agent process is busy or stuck.
//
//   idle ──(Space held, released, transcribed)──► working ──(turn done)──► idle
//                                                   │  ▲
//                         (ask_user / confirm / help)  (answer given)
//                                                   ▼  │
//                                                awaiting
//
// In working, pressing Space stops the task at once and says nothing (no pill, no cue). In awaiting,
// Space is hold-to-talk so the user can answer; "stop" or "cancel" there stops the task and says so.

export type VoiceMode = 'idle' | 'working' | 'awaiting';

// What the speech view plays. A clip plays the shipped recording if there is one, else the given audio.
export type AudioItem =
  | { kind: 'mp3'; data: Uint8Array; droppable?: boolean }
  | { kind: 'clip'; id: FallbackId; data?: Uint8Array }
  // When speech synthesis failed: the view speaks it with the system voice.
  | { kind: 'system'; text: string };

export type VoiceStyle = { volume: number; rate: number };

export type ConductorDeps = {
  host: {
    startTurn(transcript: string, context: TurnContext): string;
    abortTurn(turnId: string): void;
    answer(taskId: string, text: string): void;
    confirm(taskId: string, yes: boolean): void;
    onTurnEvent(listener: (event: TurnEvent) => void): () => void;
    onEvent(listener: (event: TaskEvent) => void): () => void;
  };
  speech: Pick<SpeechApi, 'transcribe' | 'speak'>;
  audio: { play(item: AudioItem): void; stop(): void; setStyle(style: VoiceStyle): void };
  context(): TurnContext;
  status(mode: VoiceMode): void;
  // Shipped recordings the speech view has, so their lines aren't synthesized.
  hasClip(id: FallbackId): boolean;
  now?: () => number;
  log?: (message: string) => void;
};

// Presses shorter than this are slips, not speech.
export const MIN_SPEECH_MS = 350;
// At most one step phrase this often, so narration doesn't pile up behind the page.
export const NARRATION_GAP_MS = 4_000;

const VOLUME = { min: 0.4, max: 1.6, step: 0.2 };
const RATE = { min: 0.8, max: 1.25, step: 0.1 };

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;

const ERROR_CLIPS: Record<SpeechErrorCode, FallbackId> = {
  'no-key': 'no_key',
  'invalid-key': 'no_key',
  'out-of-credits': 'out_of_credit',
  offline: 'offline',
  'bad-response': 'error',
};

const siteName = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin;
  }
};

// Read aloud before anything that can't be undone. Built by main from the real form (policy.ts).
export const confirmationText = (confirm: ConfirmRequest) => {
  const fields = confirm.fields.slice(0, 6).map((field) => `${field.label}: ${field.value}`);
  return [
    `On ${siteName(confirm.origin)}, I'm about to press ${confirm.button || 'the button'}.`,
    fields.length ? `${fields.join('. ')}.` : '',
    'Shall I go ahead? Say yes or no.',
  ]
    .filter(Boolean)
    .join(' ');
};

const questionText = (question: string, options?: string[]) =>
  options?.length ? `${question} ${options.slice(0, -1).join(', ')}${options.length > 1 ? ' or ' : ''}${options.at(-1)}?` : question;

export const createConductor = (deps: ConductorDeps) => {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));
  let mode: VoiceMode = 'idle';
  let turnId: string | undefined;
  // A stopped turn may still say what it got done, unless the stop was Space (that stays silent).
  let stoppingTurnId: string | undefined;
  let quietStop = false;
  // Bumped on stop so speech that was already being made doesn't play afterwards.
  let playGen = 0;
  let pending: { taskId: string; kind: 'confirm' | 'ask' | 'help'; prompt: string } | undefined;
  let lastSaid: { text?: string; clip?: FallbackId } | undefined;
  let lastNarrationAt = 0;
  const style: VoiceStyle = { volume: 1, rate: 1 };

  const setMode = (next: VoiceMode) => {
    if (next !== mode) log(`mode ${mode} → ${next}`);
    mode = next;
    deps.status(next);
  };

  const playText = async (text: string, droppable = false) => {
    const gen = playGen;
    log(`say${droppable ? ' (narration)' : ''}: ${JSON.stringify(text)}`);
    try {
      const data = await deps.speech.speak(text);
      if (gen !== playGen) return;
      log(`  speech ok, ${data.byteLength} bytes`);
      deps.audio.play({ kind: 'mp3', data, droppable });
    } catch (error) {
      if (gen !== playGen) return;
      log(`  speech FAILED: ${describeError(error)}${droppable ? '' : ' (falling back to the system voice)'}`);
      if (!droppable) deps.audio.play({ kind: 'system', text });
    }
  };

  const playClip = async (id: FallbackId) => {
    const gen = playGen;
    lastSaid = { clip: id };
    log(`clip ${id}: ${JSON.stringify(FALLBACKS[id])}${deps.hasClip(id) ? ' (recording)' : ''}`);
    if (deps.hasClip(id)) {
      deps.audio.play({ kind: 'clip', id });
      return;
    }
    try {
      const data = await deps.speech.speak(FALLBACKS[id]);
      if (gen !== playGen) return;
      deps.audio.play({ kind: 'clip', id, data });
    } catch (error) {
      if (gen !== playGen) return;
      log(`  speech FAILED: ${describeError(error)} (falling back to the system voice)`);
      deps.audio.play({ kind: 'system', text: FALLBACKS[id] });
    }
  };

  const say = (text: string) => {
    lastSaid = { text };
    return playText(text);
  };

  const stop = (quiet = false) => {
    playGen += 1;
    deps.audio.stop();
    pending = undefined;
    quietStop = quiet;
    if (turnId) {
      stoppingTurnId = turnId;
      deps.host.abortTurn(turnId);
    }
    turnId = undefined;
    setMode('idle');
    if (!quiet) void playClip('stopped');
  };

  const handleControl = async (command: NonNullable<ReturnType<typeof matchControl>>) => {
    switch (command) {
      case 'stop':
        if (mode === 'idle') deps.audio.stop();
        else stop();
        return;
      case 'repeat':
        if (lastSaid?.clip) await playClip(lastSaid.clip);
        else if (lastSaid?.text) await playText(lastSaid.text);
        return;
      case 'louder':
      case 'quieter':
        style.volume = clamp(style.volume + (command === 'louder' ? VOLUME.step : -VOLUME.step), VOLUME.min, VOLUME.max);
        deps.audio.setStyle({ ...style });
        await playText(command === 'louder' ? 'Louder.' : 'Quieter.');
        return;
      case 'slower':
      case 'faster':
        style.rate = clamp(style.rate + (command === 'faster' ? RATE.step : -RATE.step), RATE.min, RATE.max);
        deps.audio.setStyle({ ...style });
        await playText(command === 'faster' ? 'Faster.' : 'Slower.');
        return;
    }
  };

  const handleAnswer = async (text: string) => {
    const question = pending!;
    if (question.kind === 'confirm') {
      const answer = parseYesNo(text);
      if (!answer) {
        await playClip('confirm_again');
        return;
      }
      pending = undefined;
      setMode('working');
      deps.host.confirm(question.taskId, answer === 'yes');
      return;
    }
    pending = undefined;
    setMode('working');
    deps.host.answer(question.taskId, text);
  };

  const ask = (taskId: string, kind: 'confirm' | 'ask' | 'help', prompt: string) => {
    pending = { taskId, kind, prompt };
    setMode('awaiting');
    void say(prompt);
  };

  deps.host.onTurnEvent((event) => {
    const mine = event.turnId === turnId;
    const stopping = event.turnId === stoppingTurnId;
    if (!mine && !stopping) {
      log(`ignored ${event.type} from old turn ${event.turnId}`);
      return;
    }
    if (event.type === 'routed') log(`routed ${event.label} (confidence ${event.confidence ?? '?'})${event.tasks.length ? `: ${event.tasks.map((task) => `${task.lane} ${JSON.stringify(task.goal)}`).join(', ')}` : ''}`);
    if (event.type === 'done') log(`turn done (${event.ok ? 'ok' : 'failed'})`);

    if (event.type === 'say') {
      // Space already cancelled it. The turn's wrap-up ("I stopped…") stays unsaid.
      if (stopping && quietStop) return;
      if (event.clip) void playClip(event.clip);
      else if (event.text) void say(event.text);
    }
    if (event.type === 'done') {
      if (stopping) {
        stoppingTurnId = undefined;
        quietStop = false;
      }
      if (mine) {
        turnId = undefined;
        pending = undefined;
        setMode('idle');
      }
    }
  });

  deps.host.onEvent((event) => {
    if (event.turnId !== turnId) return;
    if (event.type === 'step_done' || event.type === 'finished' || event.type === 'failed' || event.type === 'stopped') {
      log(`task ${event.type}${'result' in event ? `: ${JSON.stringify(event.result.facts)}${event.result.error ? ` error=${event.result.error}` : ''}` : ` ok=${event.ok}${event.error ? ` ${event.error}` : ''}`}`);
    }
    switch (event.type) {
      case 'step_started':
        if (now() - lastNarrationAt >= NARRATION_GAP_MS) {
          lastNarrationAt = now();
          void playText(event.phrase, true);
        }
        return;
      case 'ask_user':
        ask(event.taskId, 'ask', questionText(event.question, event.options));
        return;
      case 'request_help':
        ask(event.taskId, 'help', `${event.reason} Tell me when you're done.`);
        return;
      case 'needs_confirm':
        ask(event.taskId, 'confirm', confirmationText(event.confirm));
        return;
      default:
        return;
    }
  });

  return {
    mode: () => mode,

    // Space pressed (a fresh press, not a repeat). True means it was used to stop, so don't open the mic.
    onSpacePress() {
      if (mode === 'working') {
        stop(true);
        return true;
      }
      // Talking over Browsie cuts it off.
      deps.audio.stop();
      return false;
    },

    // What the speech view recorded while Space was held.
    async onAudio(wav: Uint8Array, durationMs: number) {
      log(`recording ${Math.round(durationMs)}ms, ${wav.byteLength} bytes`);
      if (durationMs < MIN_SPEECH_MS) return;

      let text: string;
      try {
        text = await deps.speech.transcribe(wav);
        log(`heard: ${JSON.stringify(text)}`);
      } catch (error) {
        log(`transcription FAILED: ${describeError(error)}`);
        const code = (error as { code?: SpeechErrorCode }).code;
        await playClip(code ? ERROR_CLIPS[code] : 'error');
        return;
      }

      if (!text) {
        await playClip('didnt_catch');
        return;
      }

      const control = matchControl(text);
      if (control) {
        await handleControl(control);
        return;
      }

      if (mode === 'awaiting' && pending) {
        await handleAnswer(text);
        return;
      }

      // Space stops a working turn, so speech can't normally arrive mid-turn. If it does, it waits its turn.
      if (mode === 'working') return;

      setMode('working');
      turnId = deps.host.startTurn(text, deps.context());
    },
  };
};

export type Conductor = ReturnType<typeof createConductor>;
