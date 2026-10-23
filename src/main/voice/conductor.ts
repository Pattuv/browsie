import { matchControl, parseYesNo } from '../../shared/agent/controlRules';
import { FALLBACKS, type FallbackId } from '../../shared/agent/fallbacks';
import type { TaskEvent, TurnContext, TurnEvent } from '../../shared/agent/protocol';
import type { ConfirmRequest } from '../../shared/web/actions';
import type { SpeechApi, SpeechErrorCode } from './speechApi';

// The voice side of main: what Space does, what happens to what the user said, and what Browsie says.
// Main owns this, so Space stops a task even when the agent process is busy or stuck.
//
//   idle ──(Space held, released, transcribed)──► working ──(turn done, and the reply has finished)──► idle
//                                                   │  ▲
//                         (ask_user / confirm / help)  (answer given)
//                                                   ▼  │
//                                                awaiting
//
// Working lasts through the spoken reply. Space in that stretch only stops the task: no pill, no cue.
// In awaiting, Space is hold-to-talk so the user can answer; "stop" or "cancel" there stops the task and says so.

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
  audio: {
    // epoch marks this stretch of speech. The player reports it back when that audio has finished.
    play(item: AudioItem, epoch: number): void;
    stop(): void;
    setStyle(style: VoiceStyle): void;
  };
  context(): TurnContext;
  status(mode: VoiceMode): void;
  // The speech pill stays up while this is true (a request is running, or a reply is still playing).
  pill?(visible: boolean): void;
  // This recording has been dealt with, so a pill kept up for that press can close.
  audioSettled?(): void;
  // Shipped recordings the speech view has, so their lines aren't synthesized.
  hasClip(id: FallbackId): boolean;
  now?: () => number;
  log?: (message: string) => void;
};

// Presses shorter than this are slips, not speech.
export const MIN_SPEECH_MS = 350;
// At most one step phrase this often, so narration doesn't pile up behind the page.
export const NARRATION_GAP_MS = 4_000;
// The turn is over but the player never said the reply finished (a crash, a lost message). Go idle anyway.
export const REPLY_IDLE_TIMEOUT_MS = 30_000;

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
  // Speech still being made or played. Space while this is going on only stops it.
  // epoch is handed to the player with each clip; a quiet report from an older epoch is ignored.
  let epoch = 1;
  let sent = 0;
  let finished = 0;
  let synthesizing = 0;
  // A recording is being transcribed and has not become a turn yet. Space in that gap still cancels it.
  let transcribing = false;
  let listenGen = 0;
  // The turn itself is over, but the reply is still being said. Stay "working" until it finishes,
  // so Space keeps meaning "stop" instead of opening the mic.
  let deferIdle = false;
  let pending: { taskId: string; kind: 'confirm' | 'ask' | 'help'; prompt: string } | undefined;
  let lastSaid: { text?: string; clip?: FallbackId } | undefined;
  let lastNarrationAt = 0;
  const style: VoiceStyle = { volume: 1, rate: 1 };
  // Assigned once `speaking` exists. setMode runs only after that.
  let syncPill = () => {};

  const setMode = (next: VoiceMode) => {
    if (next !== mode) log(`mode ${mode} → ${next}`);
    mode = next;
    deps.status(next);
    syncPill();
  };

  const speaking = () => synthesizing > 0 || finished < sent;
  syncPill = () => {
    deps.pill?.(mode === 'working' || speaking() || transcribing);
  };

  let deferTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDeferTimer = () => {
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;
  };

  const maybeIdle = () => {
    if (deferIdle && mode === 'working' && !speaking()) {
      deferIdle = false;
      clearDeferTimer();
      setMode('idle');
    }
  };

  // Drops every clip already handed to the player. In-flight synthesis checks epoch and bails out.
  const cutSpeech = () => {
    epoch += 1;
    sent = 0;
    finished = 0;
    synthesizing = 0;
    deferIdle = false;
  };

  const handoff = (item: AudioItem, mine: number) => {
    if (mine !== epoch) return;
    sent += 1;
    deps.audio.play(item, mine);
  };

  const playText = async (text: string, droppable = false) => {
    const gen = playGen;
    const mine = epoch;
    synthesizing += 1;
    syncPill();
    log(`say${droppable ? ' (narration)' : ''}: ${JSON.stringify(text)}`);
    try {
      const data = await deps.speech.speak(text);
      if (gen !== playGen || mine !== epoch) return;
      log(`  speech ok, ${data.byteLength} bytes`);
      handoff({ kind: 'mp3', data, droppable }, mine);
    } catch (error) {
      if (gen !== playGen || mine !== epoch) return;
      log(`  speech FAILED: ${describeError(error)}${droppable ? '' : ' (falling back to the system voice)'}`);
      if (!droppable) handoff({ kind: 'system', text }, mine);
    } finally {
      if (mine === epoch) synthesizing = Math.max(0, synthesizing - 1);
      maybeIdle();
      syncPill();
    }
  };

  const playClip = async (id: FallbackId) => {
    const gen = playGen;
    const mine = epoch;
    synthesizing += 1;
    syncPill();
    lastSaid = { clip: id };
    log(`clip ${id}: ${JSON.stringify(FALLBACKS[id])}${deps.hasClip(id) ? ' (recording)' : ''}`);
    try {
      if (deps.hasClip(id)) {
        if (gen !== playGen || mine !== epoch) return;
        handoff({ kind: 'clip', id }, mine);
        return;
      }
      const data = await deps.speech.speak(FALLBACKS[id]);
      if (gen !== playGen || mine !== epoch) return;
      handoff({ kind: 'clip', id, data }, mine);
    } catch (error) {
      if (gen !== playGen || mine !== epoch) return;
      log(`  speech FAILED: ${describeError(error)} (falling back to the system voice)`);
      handoff({ kind: 'system', text: FALLBACKS[id] }, mine);
    } finally {
      if (mine === epoch) synthesizing = Math.max(0, synthesizing - 1);
      maybeIdle();
      syncPill();
    }
  };

  // Every stop of the player starts a new epoch here too. The player forgets what it was playing when it
  // stops, so counting on from the old epoch would leave Browsie waiting on a reply that never ends.
  const silence = () => {
    playGen += 1;
    cutSpeech();
    deps.audio.stop();
    syncPill();
    maybeIdle();
  };

  const say = (text: string) => {
    lastSaid = { text };
    return playText(text);
  };

  const stop = (quiet = false) => {
    playGen += 1;
    listenGen += 1;
    transcribing = false;
    cutSpeech();
    deps.audio.stop();
    pending = undefined;
    quietStop = quiet;
    if (turnId) {
      stoppingTurnId = turnId;
      deps.host.abortTurn(turnId);
    }
    turnId = undefined;
    setMode('idle');
    deps.audioSettled?.();
    if (!quiet) void playClip('stopped');
  };

  const handleControl = async (command: NonNullable<ReturnType<typeof matchControl>>) => {
    switch (command) {
      case 'stop':
        if (mode === 'idle') silence();
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
        // The reply is usually still being synthesized or played. Stay working until it's over,
        // so a Space press here cancels instead of bringing the pill back.
        if (mode === 'working' && speaking()) {
          deferIdle = true;
          clearDeferTimer();
          deferTimer = setTimeout(() => {
            deferTimer = undefined;
            if (!deferIdle || mode !== 'working') return;
            log('reply never reported finished; going idle');
            deferIdle = false;
            setMode('idle');
          }, REPLY_IDLE_TIMEOUT_MS);
        } else if (mode === 'working') setMode('idle');
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
    // The player finished everything it was given for this epoch.
    noteQuiet(playedEpoch: number, count: number) {
      if (playedEpoch !== epoch) return;
      finished = Math.max(finished, count);
      maybeIdle();
      syncPill();
    },

    onSpacePress() {
      if (mode === 'working' || transcribing || (mode !== 'awaiting' && speaking())) {
        stop(true);
        return true;
      }
      // Talking over Browsie cuts it off. In awaiting, that press is the answer, so the mic opens.
      silence();
      return false;
    },

    // What the speech view recorded while Space was held.
    async onAudio(wav: Uint8Array, durationMs: number) {
      const mine = ++listenGen;
      try {
        log(`recording ${Math.round(durationMs)}ms, ${wav.byteLength} bytes`);
        // A slip of the key, or nothing recorded.
        if (durationMs < MIN_SPEECH_MS || wav.byteLength === 0) return;

        transcribing = true;
        syncPill();
        let text: string;
        try {
          text = await deps.speech.transcribe(wav);
          if (mine !== listenGen) return;
          log(`heard: ${JSON.stringify(text)}`);
        } catch (error) {
          if (mine !== listenGen) return;
          log(`transcription FAILED: ${describeError(error)}`);
          const code = (error as { code?: SpeechErrorCode }).code;
          await playClip(code ? ERROR_CLIPS[code] : 'error');
          return;
        }

        if (mine !== listenGen) return;

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
      } finally {
        if (mine !== listenGen) return;
        transcribing = false;
        syncPill();
        deps.audioSettled?.();
      }
    },
  };
};

export type Conductor = ReturnType<typeof createConductor>;
