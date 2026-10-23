import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { SAFE_SEARCH_SETTING } from "../../shared/web/safeSearch";
import { clearSetupCompleted } from "../onboarding-layer/setupGate";
import { useDataStore } from "../stores/dataStore";
import { APPEARANCE_SETTING, readAppearance, type Appearance } from "../theme";
import AppearancePicker from "./AppearancePicker";
import BillingSettings from "./BillingSettings";

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="bric text-xl font-medium tracking-tight text-black">{title}</h2>
        <p className="mt-0.5 text-sm tracking-tight text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "billing", label: "Billing" },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-zinc-200 px-4 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium tracking-tight text-black">{label}</span>
        <span className="mt-0.5 block text-sm tracking-tight text-zinc-500">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out ${checked ? "bg-[#9572FF]" : "bg-zinc-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}

function GeneralSettings() {
  const appearance = readAppearance(useDataStore((state) => state.settings[APPEARANCE_SETTING]));
  const safeSearch = useDataStore((state) => state.settings[SAFE_SEARCH_SETTING] !== false);
  const [saveFailed, setSaveFailed] = useState(false);

  const saveSetting = (patch: Record<string, unknown>) => {
    setSaveFailed(false);
    window.browsie?.data.update({ settings: patch }).catch(() => setSaveFailed(true));
  };

  const changeAppearance = (next: Appearance) => {
    saveSetting({ [APPEARANCE_SETTING]: next });
  };

  // TEMP: clears the device flag and this account's setup record, then signs out, so the full intro and
  // setup play again. Main also deletes the stored OpenRouter keys.
  const factoryReset = () => {
    clearSetupCompleted();
    void window.browsie?.auth.signOut({ resetSetup: true });
  };

  return (
    <div className="flex flex-col gap-9">
      <Section title="Appearance" description="How Browsie and your Dashboard look.">
        <AppearancePicker value={appearance} onChange={changeAppearance} />
        <p className="text-xs tracking-tight text-zinc-500">
          High Contrast is designed to meet WCAG 2.2 AA visual criteria.
        </p>
      </Section>

      <Section
        title="SafeSearch"
        description="Filters explicit results on Google, Bing, and DuckDuckGo, and turns on YouTube Restricted Mode."
      >
        <Toggle
          checked={safeSearch}
          label="SafeSearch"
          description="A link or address that goes straight to a page still opens."
          onChange={(next) => saveSetting({ [SAFE_SEARCH_SETTING]: next })}
        />
      </Section>

      {/* Reserved height so the layout doesn't jump when an error appears. */}
      <p role="alert" className="-mt-6 h-5 text-sm tracking-tight text-zinc-600">
        {saveFailed && "Couldn’t save that. Please try again."}
      </p>

      <Section
        title="Factory reset (temp)"
        description="Signs out and forgets this account’s setup, so the intro and setup play again."
      >
        <button
          type="button"
          onClick={factoryReset}
          className="smooth flex h-10 w-fit cursor-pointer items-center gap-2 rounded-[16px] border border-dashed border-zinc-300 px-4 text-sm font-medium tracking-tight text-zinc-600 transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-100 active:scale-[0.98]"
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
          Factory reset
        </button>
      </Section>
    </div>
  );
}

// What Settings shows, in the browser (browsie://settings) and in the Dashboard's popup alike.
// Changes save as soon as they're made; the appearance applies everywhere through the synced settings.
function SettingsContent() {
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Settings" className="flex w-fit gap-1 rounded-full bg-zinc-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`h-8 cursor-pointer rounded-full px-4 text-sm font-medium tracking-tight transition-colors duration-150 ${
              tab === item.id ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "general" ? <GeneralSettings /> : <BillingSettings />}
    </div>
  );
}

export default SettingsContent;
