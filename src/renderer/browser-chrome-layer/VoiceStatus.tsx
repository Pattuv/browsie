import { useEffect, useState } from 'react';

// What the voice layer is doing, for a caretaker watching: Browsie working (Space stops it) or waiting for
// an answer. Hidden when idle. Announced to screen readers as it changes.

const LABELS: Record<Exclude<VoiceMode, 'idle'>, string> = {
  working: 'Space bar to stop agent',
  awaiting: 'Hold Space to answer',
};

function VoiceStatus() {
  const [mode, setMode] = useState<VoiceMode>('idle');

  useEffect(() => window.browsie?.voice.onStatus(setMode), []);

  return (
    <span role="status" aria-live="polite" className="flex items-center">
      {mode !== 'idle' && (
        <span className="mr-1 flex h-7 items-center gap-2 rounded-full bg-black/10 px-3 text-xs font-medium tracking-tight text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-[#9572FF]" aria-hidden="true" />
          {LABELS[mode]}
        </span>
      )}
    </span>
  );
}

export default VoiceStatus;
