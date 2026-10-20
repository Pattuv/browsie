import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

const ERRORS = {
  invalid: "That doesn’t look like an OpenRouter key. It should start with sk-or-.",
  "invalid-cap": "Set a spending cap between $1 and $10,000.",
  rejected: "OpenRouter didn’t accept that key. Check it and try again.",
  "not-management": "That’s a regular key. Browsie needs a management key.",
  offline: "Couldn’t reach OpenRouter. Check your connection and try again.",
  unavailable: "This computer couldn’t store the key securely. Please try again.",
  failed: "Something went wrong saving the key. Please try again.",
};

// Account-key step. Setup keeps the clouds, gradient, and mute control mounted while this page is shown.
// The user pastes an OpenRouter management key. Main checks it with OpenRouter, makes Browsie its own AI key
// with it, and stores both encrypted. The key is hidden on screen unless the user asks.
// The spending cap goes on Browsie's key: the most its AI may spend, per period or in total.
const DEFAULT_CAP = "10";

const RESET_OPTIONS: { value: AiResets | null; label: string; caption: string }[] = [
  { value: "monthly", label: "Monthly", caption: "each month" },
  { value: "weekly", label: "Weekly", caption: "each week" },
  { value: null, label: "Never", caption: "in total" },
];

function KeySetup() {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<keyof typeof ERRORS | null>(null);
  const [cap, setCap] = useState(DEFAULT_CAP);
  const [reset, setReset] = useState<AiResets | null>("monthly");
  const capAmount = Number(cap);
  const capValid = cap.trim() !== "" && Number.isFinite(capAmount) && capAmount >= 1 && capAmount <= 10_000;
  const resetCaption = RESET_OPTIONS.find((option) => option.value === reset)?.caption;
  const VisibilityIcon = showKey ? EyeOff : Eye;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!key.trim() || saving) {
      return;
    }

    if (!capValid) {
      setError("invalid-cap");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await window.browsie?.auth.saveAiKey(key, { limit: capAmount, reset });

      if (result !== "saved") {
        setError(result ?? "unavailable");
        return;
      }

      // TEMP: the key is the last setup step so far, so saving it finishes setup. Main checks the keys are
      // stored, records the account, and pushes the session; the gate swaps setup for the Dashboard.
      // Move this to the last step once it exists.
      await window.browsie?.auth.completeSetup();
    } catch {
      setError("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative z-10 h-full min-h-full">
      <form
        onSubmit={handleSubmit}
        className="enter-blur flex h-full flex-col items-center justify-center px-6"
      >
        <h1 className="bric text-center text-5xl font-medium tracking-tighter">
          AI Usage Key
        </h1>
        <p className="mt-5 max-w-[28rem] text-center text-lg font-medium leading-snug tracking-tight text-zinc-500">
          After making an OpenRouter account and adding credits, create a
          management key and paste it below.
        </p>

        <div className="relative mt-7 w-[22.5rem]">
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setError(null);
            }}
            aria-label="OpenRouter management key"
            aria-invalid={error === "invalid"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            className="app-region-no-drag h-14 w-full rounded-2xl border border-zinc-300 bg-[#F0F0F0] pr-12 pl-4 text-sm tracking-tight text-black outline-none focus:border-zinc-400"
          />
          <button
            type="button"
            onClick={() => setShowKey((shown) => !shown)}
            aria-label={showKey ? "Hide key" : "Show key"}
            aria-pressed={showKey}
            className="app-region-no-drag absolute top-1/2 right-3 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors duration-150 hover:text-black"
          >
            <VisibilityIcon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[0.6875rem] font-medium tracking-tight text-zinc-500">
          Never share this key with anyone.
        </p>
        <p className="mt-0.5 text-[0.6875rem] font-medium tracking-tight text-zinc-500">
          Browsie uses it to make its own key and check your credits.
        </p>

        <fieldset className="mt-6 flex w-[22.5rem] flex-col items-center">
          <legend className="sr-only">Spending cap</legend>
          <div className="flex w-full gap-2">
            <label className="relative w-32 shrink-0">
              <span className="sr-only">Spending cap in dollars</span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-zinc-500"
              >
                $
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={10000}
                step={1}
                value={cap}
                onChange={(event) => {
                  setCap(event.target.value);
                  setError(null);
                }}
                aria-invalid={error === "invalid-cap"}
                className="app-region-no-drag h-12 w-full rounded-2xl border border-zinc-300 bg-[#F0F0F0] pr-3 pl-8 text-sm tracking-tight text-black outline-none [appearance:textfield] focus:border-zinc-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
            <div
              role="radiogroup"
              aria-label="Cap resets"
              className="flex h-12 flex-1 gap-1 rounded-2xl border border-zinc-300 bg-[#F0F0F0] p-1"
            >
              {RESET_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={reset === option.value}
                  onClick={() => setReset(option.value)}
                  className={`app-region-no-drag flex-1 cursor-pointer rounded-xl text-sm font-medium tracking-tight transition-colors duration-150 ${
                    reset === option.value ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[0.6875rem] font-medium tracking-tight text-center text-zinc-500">
            Spending cap: the most Browsie’s AI can spend {resetCaption}. You can change it later.
          </p>
        </fieldset>

        <button
          type="submit"
          data-click-sound="heavy"
          disabled={!key.trim() || !capValid || saving}
          className="smooth app-region-no-drag mt-7 h-10 w-[7.5rem] cursor-pointer rounded-[14px] bg-black text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
        >
          Continue
        </button>

        {/* Reserved height so the layout doesn't jump when an error appears. */}
        <p
          role="alert"
          className="mt-4 h-5 text-center text-sm tracking-tight text-zinc-600"
        >
          {error && ERRORS[error]}
        </p>
      </form>
    </div>
  );
}

export default KeySetup;
