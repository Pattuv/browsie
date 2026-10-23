// Fixed lines Browsie says without asking a model: when it didn't catch something, when something is off
// limits, when it stops. Each one is meant to ship as a prerecorded clip (src/renderer/assets/voice/<id>.mp3,
// made once with the same ElevenLabs voice as live speech by `npm run voice:clips`). Until a clip exists
// the line is spoken live.

export const FALLBACKS = {
  didnt_catch: "Sorry, I didn't catch that. Could you say it again?",
  unclear: "Sorry, I'm not sure what you'd like me to do. Could you say it another way?",
  restricted: "I can't change that. That's in Settings, for someone who can see the screen to do with you.",
  stopped: 'Stopped.',
  not_allowed: "Sorry, I can't help with that. Browsie doesn't search for or open adult content.",
  info_unavailable: "I can't check your email, calendar or files yet.",
  no_key: "I can't do that yet, because Browsie's AI key isn't set up. Someone will need to add it in Settings.",
  offline: "I can't reach the internet right now. Please try again in a moment.",
  out_of_credit: "I can't do that right now, because Browsie's AI credit has run out.",
  no_page: "There's no web page open for me to work on. Try asking me to open a site first.",
  confirm_again: 'Please say yes or no.',
  error: 'Sorry, something went wrong. Please try again.',
} as const;

export type FallbackId = keyof typeof FALLBACKS;

export const FALLBACK_IDS = Object.keys(FALLBACKS) as FallbackId[];
