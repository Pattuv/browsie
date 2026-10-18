import { useEffect, useRef, useState } from "react";

const MAX_CACHED = 100;

// Query → its suggestions, shared by every tab. Backspacing or retyping shows a list instantly.
const cache = new Map<string, Suggestion[]>();

const remember = (query: string, results: Suggestion[]) => {
  if (cache.size >= MAX_CACHED) {
    cache.delete(cache.keys().next().value!);
  }

  cache.set(query, results);
};

// Suggestions for what's in the address bar, asked for on every keystroke (Google answers in ~50ms).
// `enabled` is false when the user isn't typing, which empties the list. While new results are on
// their way the old list stays, so it doesn't flicker.
export function useSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Every request gets a number. Replies can come back out of order, so a reply is shown only if it's
  // newer than the one on screen. Older replies still show while typing fast, which keeps the list live.
  const lastSent = useRef(0);
  const lastShown = useRef(0);

  useEffect(() => {
    const text = query.trim();
    const request = ++lastSent.current;

    const show = (results: Suggestion[]) => {
      if (request > lastShown.current) {
        lastShown.current = request;
        setSuggestions(results);
      }
    };

    if (!enabled || !text) {
      show([]);
      return;
    }

    const cached = cache.get(text);

    if (cached) {
      show(cached);
      return;
    }

    window.browsie?.browser
      .suggest(text)
      .then((results) => {
        // [] may just mean we were offline for a moment, so it's not worth remembering.
        if (results.length) remember(text, results);
        // Closing the bar counts as a newer request (it shows []), so a late reply can't reopen it.
        show(results);
      })
      .catch(() => undefined);
  }, [query, enabled]);

  return suggestions;
}
