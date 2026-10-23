import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskEvent, TurnEvent } from '../../shared/agent/protocol';
import { type AudioItem, confirmationText, createConductor, NARRATION_GAP_MS } from './conductor';
import { SpeechError } from './speechApi';

const wav = new Uint8Array([1, 2, 3]);

const setup = (heard = 'open a new tab') => {
  let turnListener: (event: TurnEvent) => void = () => undefined;
  let taskListener: (event: TaskEvent) => void = () => undefined;
  let clock = 10_000;
  const played: AudioItem[] = [];
  const statuses: string[] = [];

  const host = {
    startTurn: vi.fn(() => 'turn1'),
    abortTurn: vi.fn(),
    answer: vi.fn(),
    confirm: vi.fn(),
    onTurnEvent: (listener: (event: TurnEvent) => void) => {
      turnListener = listener;
      return () => undefined;
    },
    onEvent: (listener: (event: TaskEvent) => void) => {
      taskListener = listener;
      return () => undefined;
    },
  };
  const speech = {
    transcribe: vi.fn(async () => heard),
    speak: vi.fn(async (text: string) => new TextEncoder().encode(text)),
  };
  const audio = {
    play: vi.fn((item: AudioItem, playedEpoch = 1) => {
      played.push(item);
      queueMicrotask(() => conductor.noteQuiet(playedEpoch, played.length));
    }),
    stop: vi.fn(),
    setStyle: vi.fn(),
  };

  const conductor = createConductor({
    host,
    speech,
    audio,
    context: () => ({ site: 'shop.example.com', tabCount: 2 }),
    status: (mode) => statuses.push(mode),
    hasClip: (id) => id === 'stopped',
    now: () => clock,
  });

  const spoken = () =>
    played.map((item) => (item.kind === 'mp3' || (item.kind === 'clip' && item.data) ? new TextDecoder().decode(item.kind === 'mp3' ? item.data : item.data) : item.kind === 'clip' ? `[${item.id}]` : `system:${item.text}`));

  return {
    conductor,
    host,
    speech,
    audio,
    played,
    statuses,
    spoken,
    turn: (event: Record<string, unknown>, turnId = 'turn1') => turnListener({ ...event, turnId } as TurnEvent),
    task: (event: Record<string, unknown>) => taskListener({ taskId: 'task1', turnId: 'turn1', ...event } as TaskEvent),
    tick: (ms: number) => {
      clock += ms;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('conductor', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('starts a turn with what was heard, and speaks the reply', async () => {
    await t.conductor.onAudio(wav, 1_200);
    expect(t.host.startTurn).toHaveBeenCalledWith('open a new tab', { site: 'shop.example.com', tabCount: 2 });
    expect(t.conductor.mode()).toBe('working');

    t.turn({ type: 'say', text: 'I opened a new tab.' });
    t.turn({ type: 'done', ok: true });
    await flush();
    expect(t.spoken()).toEqual(['I opened a new tab.']);
    expect(t.statuses).toEqual(['working', 'idle']);
  });

  it('ignores slips of the key', async () => {
    await t.conductor.onAudio(wav, 120);
    expect(t.speech.transcribe).not.toHaveBeenCalled();
  });

  it('uses Space to stop a working turn, without opening the mic', async () => {
    await t.conductor.onAudio(wav, 1_200);
    expect(t.conductor.onSpacePress()).toBe(true);
    expect(t.audio.stop).toHaveBeenCalled();
    expect(t.host.abortTurn).toHaveBeenCalledWith('turn1');
    await flush();
    // Space only cancels. No "Stopped." cue, and the turn's wrap-up stays unsaid.
    t.turn({ type: 'say', text: "I stopped. I'd clicked \"Add to cart\"." });
    await flush();
    expect(t.spoken()).toEqual([]);
    expect(t.conductor.mode()).toBe('idle');
    // The next press talks.
    expect(t.conductor.onSpacePress()).toBe(false);
  });

  it('keeps Space from opening the mic while a reply is still being said', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.turn({ type: 'say', text: 'I opened Gmail in a new tab.' });
    t.turn({ type: 'done', ok: true });
    // The turn is over, but the reply has not finished. Space only stops it.
    expect(t.conductor.mode()).toBe('working');
    expect(t.conductor.onSpacePress()).toBe(true);
    expect(t.audio.stop).toHaveBeenCalled();
    expect(t.conductor.mode()).toBe('idle');
    await flush();
    expect(t.spoken()).toEqual([]);
    expect(t.conductor.onSpacePress()).toBe(false);
  });

  it('lets Space cut Browsie off when idle', () => {
    expect(t.conductor.onSpacePress()).toBe(false);
    expect(t.audio.stop).toHaveBeenCalled();
  });

  it('narrates steps, but not too often', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.task({ type: 'step_started', step: 1, phrase: 'Clicking "Add to cart"' });
    t.task({ type: 'step_started', step: 2, phrase: 'Going to checkout' });
    t.tick(NARRATION_GAP_MS);
    t.task({ type: 'step_started', step: 3, phrase: 'Typing into "Name"' });
    await flush();
    expect(t.spoken()).toEqual(['Clicking "Add to cart"', 'Typing into "Name"']);
    expect(t.played.every((item) => item.kind === 'mp3' && item.droppable)).toBe(true);
  });

  it('reads a confirmation and passes on a clear yes', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.task({ type: 'needs_confirm', confirm: { origin: 'https://shop.example.com', button: 'Place order', fields: [{ label: 'Full name', value: 'Sam Lee' }] } });
    await flush();
    expect(t.conductor.mode()).toBe('awaiting');
    expect(t.spoken()[0]).toBe('On shop.example.com, I\'m about to press Place order. Full name: Sam Lee. Shall I go ahead? Say yes or no.');

    // Space while awaiting is for answering, not stopping.
    expect(t.conductor.onSpacePress()).toBe(false);
    t.speech.transcribe.mockResolvedValueOnce('hmm what?');
    await t.conductor.onAudio(wav, 900);
    expect(t.host.confirm).not.toHaveBeenCalled();
    t.speech.transcribe.mockResolvedValueOnce('yes please');
    await t.conductor.onAudio(wav, 900);
    expect(t.host.confirm).toHaveBeenCalledWith('task1', true);
    expect(t.conductor.mode()).toBe('working');
  });

  it('passes answers to questions on, and stops on "cancel"', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.task({ type: 'ask_user', question: 'Which tab?', options: ['Gmail', 'Outlook'] });
    await flush();
    expect(t.spoken()[0]).toBe('Which tab? Gmail or Outlook?');
    t.speech.transcribe.mockResolvedValueOnce('the Outlook one');
    await t.conductor.onAudio(wav, 900);
    expect(t.host.answer).toHaveBeenCalledWith('task1', 'the Outlook one');

    t.task({ type: 'ask_user', question: 'Which size?' });
    t.speech.transcribe.mockResolvedValueOnce('cancel');
    await t.conductor.onAudio(wav, 600);
    expect(t.host.abortTurn).toHaveBeenCalled();
  });

  it('handles repeat, louder and slower itself', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.turn({ type: 'say', text: 'It costs $18.' });
    t.turn({ type: 'done', ok: true });
    await flush();

    t.speech.transcribe.mockResolvedValueOnce('say that again');
    await t.conductor.onAudio(wav, 800);
    t.speech.transcribe.mockResolvedValueOnce('louder');
    await t.conductor.onAudio(wav, 800);
    expect(t.spoken().slice(0, 2)).toEqual(['It costs $18.', 'It costs $18.']);
    expect(t.audio.setStyle).toHaveBeenCalledWith({ volume: 1.2, rate: 1 });
    expect(t.host.startTurn).toHaveBeenCalledTimes(1);
  });

  it('says what went wrong with speech, and falls back to the system voice', async () => {
    t.speech.transcribe.mockRejectedValueOnce(new SpeechError('out-of-credits', 'x'));
    t.speech.speak.mockRejectedValue(new Error('down'));
    await t.conductor.onAudio(wav, 900);
    expect(t.played).toEqual([{ kind: 'system', text: "I can't do that right now, because Browsie's AI credit has run out." }]);
  });

  it('ignores what an old turn says once a new one started', async () => {
    await t.conductor.onAudio(wav, 1_200);
    t.turn({ type: 'say', text: 'from somewhere else' }, 'turn0');
    await flush();
    expect(t.played).toEqual([]);
  });
});

describe('confirmationText', () => {
  it('stays short when there are no fields', () => {
    expect(confirmationText({ origin: 'https://www.example.com', button: 'Subscribe', fields: [] })).toBe(
      "On example.com, I'm about to press Subscribe. Shall I go ahead? Say yes or no.",
    );
  });
});
