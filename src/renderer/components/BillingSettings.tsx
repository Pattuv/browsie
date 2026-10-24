import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "../stores/authStore";

const ERRORS = {
  invalid: "That doesn’t look like an OpenRouter key. It should start with sk-or-.",
  "invalid-cap": "Set a spending cap between $1 and $10,000.",
  rejected: "OpenRouter didn’t accept that key. Check it and try again.",
  "not-management": "That’s a regular key. Browsie needs a management key.",
  offline: "Couldn’t reach OpenRouter. Check your connection and try again.",
  unavailable: "This computer couldn’t store the key securely. Please try again.",
  "no-key": "Add a management key first.",
  failed: "Something went wrong. Please try again.",
};

type KeyResult = keyof typeof ERRORS | "saved";

const RESET_OPTIONS: { value: AiResets | null; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
  { value: null, label: "Never" },
];

const capOf = (value: string) => {
  const amount = Number(value);
  return value.trim() !== "" && Number.isFinite(amount) && amount >= 1 && amount <= 10_000 ? amount : null;
};

function BillingSettings() {
  const signedIn = useAuthStore((state) => state.status === "SIGNED_IN");
  const [cap, setCap] = useState("10");
  const [reset, setReset] = useState<AiResets | null>("monthly");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [capError, setCapError] = useState<keyof typeof ERRORS | null>(null);
  const [keyError, setKeyError] = useState<keyof typeof ERRORS | null>(null);
  const [capSaved, setCapSaved] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [savingCap, setSavingCap] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const VisibilityIcon = showKey ? EyeOff : Eye;
  const limit = capOf(cap);

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let current = true;

    void window.browsie?.getAiUsage().then((usage) => {
      if (!current || usage.state !== "ok" || usage.limit === null) {
        return;
      }

      setCap(String(usage.limit));
      setReset(usage.resets);
    });

    return () => {
      current = false;
    };
  }, [signedIn]);

  const report = (result: KeyResult | undefined, setError: (error: keyof typeof ERRORS | null) => void, setSaved: (saved: boolean) => void) => {
    if (result === "saved") {
      setError(null);
      setSaved(true);
      return;
    }

    setSaved(false);
    setError(result && result in ERRORS ? result : "failed");
  };

  const saveCap = async (event: FormEvent) => {
    event.preventDefault();

    if (limit === null) {
      setCapError("invalid-cap");
      setCapSaved(false);
      return;
    }

    setSavingCap(true);

    try {
      const result = await window.browsie?.auth.updateAiCap({ limit, reset });
      report(result, setCapError, setCapSaved);
    } catch {
      report("failed", setCapError, setCapSaved);
    } finally {
      setSavingCap(false);
    }
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();

    if (!key.trim()) {
      return;
    }

    if (limit === null) {
      setKeyError("invalid-cap");
      setKeySaved(false);
      return;
    }

    setSavingKey(true);

    try {
      const result = await window.browsie?.auth.replaceManagementKey(key, { limit, reset });
      report(result, setKeyError, setKeySaved);

      if (result === "saved") {
        setKey("");
        setShowKey(false);
      }
    } catch {
      report("failed", setKeyError, setKeySaved);
    } finally {
      setSavingKey(false);
    }
  };

  if (!signedIn) {
    return <p className="text-sm tracking-tight text-zinc-500">Sign in to manage Browsie’s AI key and spending cap.</p>;
  }

  return (
    <div className="flex flex-col gap-9">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="bric text-xl font-medium tracking-tight text-black">Spending cap</h2>
          <p className="mt-0.5 text-sm tracking-tight text-zinc-500">
            The most Browsie’s own AI key can spend. This doesn’t change your OpenRouter credit balance.
          </p>
        </div>
        <form onSubmit={saveCap} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-32">
              <span className="sr-only">Spending cap in dollars</span>
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-zinc-500">
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
                  setCapError(null);
                  setCapSaved(false);
                }}
                aria-invalid={capError === "invalid-cap"}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-white pr-3 pl-7 text-sm tracking-tight text-black outline-none [appearance:textfield] focus:border-[#9572FF]/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
            <div role="radiogroup" aria-label="Cap resets" className="flex h-10 gap-1 rounded-xl border border-zinc-300 bg-zinc-50 p-1">
              {RESET_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={reset === option.value}
                  onClick={() => {
                    setReset(option.value);
                    setCapSaved(false);
                  }}
                  className={`cursor-pointer rounded-lg px-3 text-sm font-medium tracking-tight transition-colors duration-150 ${
                    reset === option.value ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={limit === null || savingCap}
              className="smooth h-10 cursor-pointer rounded-xl bg-black px-4 text-sm font-medium tracking-tight text-white transition-transform duration-150 ease-out enabled:active:scale-[0.98] disabled:cursor-default disabled:opacity-50"
            >
              Save cap
            </button>
          </div>
          <p role="alert" className="h-5 text-sm tracking-tight text-zinc-600">
            {capSaved ? "Spending cap saved." : capError && ERRORS[capError]}
          </p>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="bric text-xl font-medium tracking-tight text-black">Management key</h2>
          <p className="mt-0.5 max-w-xl text-sm tracking-tight text-zinc-500">
            Paste a new OpenRouter management key. Browsie keeps its AI key when this key can manage it. Otherwise it
            makes a new one using the cap above.
          </p>
        </div>
        <form onSubmit={saveKey} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-md">
              <input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setKeyError(null);
                  setKeySaved(false);
                }}
                aria-label="OpenRouter management key"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-white pr-10 pl-3 text-sm tracking-tight text-black outline-none focus:border-[#9572FF]/60"
              />
              <button
                type="button"
                onClick={() => setShowKey((shown) => !shown)}
                aria-label={showKey ? "Hide key" : "Show key"}
                aria-pressed={showKey}
                className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:text-black"
              >
                <VisibilityIcon size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <button
              type="submit"
              disabled={!key.trim() || limit === null || savingKey}
              className="smooth h-10 cursor-pointer rounded-xl bg-black px-4 text-sm font-medium tracking-tight text-white transition-transform duration-150 ease-out enabled:active:scale-[0.98] disabled:cursor-default disabled:opacity-50"
            >
              Save key
            </button>
          </div>
          <p role="alert" className="h-5 text-sm tracking-tight text-zinc-600">
            {keySaved ? "Management key saved." : keyError && ERRORS[keyError]}
          </p>
        </form>
      </section>
    </div>
  );
}

export default BillingSettings;
