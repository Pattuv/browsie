import { ipcMain } from 'electron';
import { getAccountId } from '../auth/session';
import { getBrowserState, isSpeechViewContents, sendToChrome, sendToSpeechView, setSpaceGate } from '../browser/tabs';
import { readAiKey } from '../data/aiKey';
import { getAgentHost } from '../agent';
import { FALLBACK_IDS, type FallbackId } from '../../shared/agent/fallbacks';
import { hostOf } from '../../shared/chrome/policy';
import { type Conductor, createConductor } from './conductor';
import { voiceLog, voiceLogPath } from './log';
import { createSpeechApi } from './speechApi';

// Connects the conductor to Electron: Space presses from tabs.ts, recordings from the speech view, audio
// back to it, and the voice status to the chrome. The conductor (and the agent process behind it) start on
// the first recording, not at launch.

// About a minute of 16 kHz mono 16-bit WAV.
const MAX_AUDIO_BYTES = 2_500_000;

let conductor: Conductor | undefined;
const clips = new Set<FallbackId>();

const getConductor = () => {
  if (conductor) return conductor;

  const speech = createSpeechApi({
    getKey: () => {
      const accountId = getAccountId();
      return accountId ? readAiKey(accountId) : null;
    },
  });

  conductor = createConductor({
    host: getAgentHost(),
    speech,
    audio: {
      play: (item) => sendToSpeechView('voice:play', item),
      stop: () => sendToSpeechView('voice:stop'),
      setStyle: (style) => sendToSpeechView('voice:style', style),
    },
    context: () => {
      const state = getBrowserState();
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      return { site: active?.url ? hostOf(active.url) : undefined, tabCount: state.tabs.length };
    },
    status: (mode) => sendToChrome('voice:status', mode),
    hasClip: (id) => clips.has(id),
    log: voiceLog,
  });
  voiceLog(`voice started, logging to ${voiceLogPath()}`);
  return conductor;
};

export const startVoice = () => {
  // Before the agent has run anything there's nothing to stop, so a press just talks.
  setSpaceGate(() => conductor?.onSpacePress() ?? false);

  ipcMain.handle('voice:audio', async (event, wav: unknown, durationMs: unknown) => {
    if (!isSpeechViewContents(event.sender)) throw new Error('Blocked voice:audio from outside the speech view.');
    if (!(wav instanceof ArrayBuffer) || wav.byteLength > MAX_AUDIO_BYTES || typeof durationMs !== 'number') {
      throw new Error('Invalid recording.');
    }
    await getConductor().onAudio(new Uint8Array(wav), durationMs);
  });

  // The speech view reports what happened to each thing it was asked to play.
  ipcMain.handle('voice:log', (event, message: unknown) => {
    if (!isSpeechViewContents(event.sender) || typeof message !== 'string') return;
    voiceLog(`  player: ${message.slice(0, 300)}`);
  });

  ipcMain.handle('voice:clips', (event, ids: unknown) => {
    if (!isSpeechViewContents(event.sender)) throw new Error('Blocked voice:clips from outside the speech view.');
    if (!Array.isArray(ids)) return;
    for (const id of ids) if (FALLBACK_IDS.includes(id)) clips.add(id);
  });
};
