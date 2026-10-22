import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';

// When the agent uses a chrome control (opens a tab, types in the address bar, goes back), that control
// pulses, so a caretaker watching can follow what Browsie is doing. Cosmetic only: renders nothing itself.

const SELECTORS: Partial<Record<AgentUiActivity['target'], string>> = {
  address: 'input[aria-label="Search or enter address"]',
  back: 'button[aria-label="Back"]',
  forward: 'button[aria-label="Forward"]',
  reload: 'button[aria-label="Reload"], button[aria-label="Stop loading"]',
};

const PULSE: Keyframe[] = [
  { boxShadow: '0 0 0 0 rgba(99, 102, 241, 0)', offset: 0 },
  { boxShadow: '0 0 0 4px rgba(99, 102, 241, 0.55)', offset: 0.3 },
  { boxShadow: '0 0 0 10px rgba(99, 102, 241, 0)', offset: 1 },
];
const PULSE_MS = 900;

const targetFor = (activity: AgentUiActivity, activeTabId: number) => {
  if (activity.target === 'tab') {
    // A new tab pulses the + button; anything else pulses the tab that's now active.
    return activity.label === 'tabs.open'
      ? document.querySelector<HTMLElement>('button[aria-label="New tab"]')
      : document.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
  }
  const selector = SELECTORS[activity.target];
  return selector ? document.querySelector<HTMLElement>(selector) : null;
};

function AgentHighlight() {
  useEffect(
    () =>
      window.browsie?.browser.onAgentActivity((activity) => {
        // After the state update that came with it has rendered, so a new or switched tab is in place.
        requestAnimationFrame(() => {
          const element = targetFor(activity, useBrowserStore.getState().activeTabId);
          if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          element.animate(PULSE, { duration: PULSE_MS, easing: 'ease-out', iterations: 2 });
        });
      }),
    [],
  );

  return null;
}

export default AgentHighlight;
