import { useEffect, useState } from 'react';

// What the voice layer is doing, for a caretaker watching: Browsie working (Space stops it) or waiting for
// an answer. Hidden when idle. Announced to screen readers as it changes.

const LABELS: Record<Exclude<VoiceMode, 'idle'>, string> = {
  working: 'Working… press Space to stop',
  awaiting: 'Waiting for your answer: hold Space to talk',
};

function VoiceStatus() {
  const [mode, setMode] = useState<VoiceMode>('idle');

  useEffect(() => window.browsie?.voice.onStatus(setMode), []);

  return (
    <span role="status" aria-live="polite" className="flex items-center">
      {mode !== 'idle' && (
        <span className="mr-1 flex h-7 items-center gap-2 rounded-full bg-[#9572FF]/10 px-3 text-xs font-medium text-[#6b4fd8]">
          <span className={`h-1.5 w-1.5 rounded-full bg-[#9572FF] ${mode === 'working' ? 'animate-pulse' : ''}`} aria-hidden="true" />
          {LABELS[mode]}
        </span>
      )}
    </span>
  );
}

export default VoiceStatus;
