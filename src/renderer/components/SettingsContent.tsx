import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { clearSetupCompleted } from "../onboarding-layer/setupGate";
import { useDataStore } from "../stores/dataStore";
import { APPEARANCE_SETTING, readAppearance, type Appearance } from "../theme";
import AppearancePicker from "./AppearancePicker";

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

// What Settings shows, in the browser (browsie://settings) and in the Dashboard's popup alike.
// Changes save as soon as they're made; the appearance applies everywhere through the synced settings.
function SettingsContent() {
  const appearance = readAppearance(useDataStore((state) => state.settings[APPEARANCE_SETTING]));
  const [saveFailed, setSaveFailed] = useState(false);

  const changeAppearance = (next: Appearance) => {
    setSaveFailed(false);
    window.browsie?.data
      .update({ settings: { [APPEARANCE_SETTING]: next } })
      .catch(() => setSaveFailed(true));
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
        {/* Reserved height so the layout doesn't jump when an error appears. */}
        <p role="alert" className="h-5 text-sm tracking-tight text-zinc-600">
          {saveFailed && "Couldn’t save that. Please try again."}
        </p>
      </Section>

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

export default SettingsContent;
