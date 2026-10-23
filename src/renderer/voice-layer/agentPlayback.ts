import { useSyncExternalStore } from 'react';

// What the speech pill draws while Browsie is the one talking. The player publishes it; the pill subscribes.
// A null analyser with speaking means the system voice, which has no audio to measure.

export type AgentPlayback = {
  speaking: boolean;
  analyser: AnalyserNode | null;
  // Space cut the voice off. The pill shows the resting bars, not "Working..." and not a spoken line.
  silenced: boolean;
};

let current: AgentPlayback = { speaking: false, analyser: null, silenced: false };
const listeners = new Set<() => void>();

export const clearAgentSilence = () => {
  if (!current.silenced) {
    return;
  }

  current = { ...current, silenced: false };
  listeners.forEach((listener) => listener());
};

export const setAgentPlayback = (speaking: boolean, analyser: AnalyserNode | null, silenced = false) => {
  if (current.speaking === speaking && current.analyser === analyser && current.silenced === silenced) {
    return;
  }

  current = { speaking, analyser, silenced };
  listeners.forEach((listener) => listener());
};

export const useAgentPlayback = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
