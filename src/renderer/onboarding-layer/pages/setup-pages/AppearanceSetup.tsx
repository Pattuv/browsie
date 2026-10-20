import { useState } from "react";
import AppearancePicker from "../../../components/AppearancePicker";
import { APPEARANCE_SETTING, type Appearance } from "../../../theme";

type AppearanceSetupProps = {
  onContinue: () => void;
};

// Appearance step. The choice is saved to the synced settings; the browser window applies it (theme.ts).
function AppearanceSetup({ onContinue }: AppearanceSetupProps) {
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleFinish = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    setFailed(false);

    try {
      await window.browsie?.data.update({ settings: { [APPEARANCE_SETTING]: appearance } });
      onContinue();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="enter-blur flex h-full flex-col items-center justify-center px-6">
        <h1 className="bric text-center text-5xl font-medium tracking-tighter">
          Pick an appearance.
        </h1>
        <p className="mt-4 text-center text-lg font-medium tracking-tight text-zinc-500">
          This can be changed at any time via Settings.
        </p>

        <AppearancePicker
          value={appearance}
          onChange={setAppearance}
          className="mt-9 w-full max-w-[47rem]"
        />

        <button
          type="button"
          data-click-sound="heavy"
          disabled={saving}
          onClick={() => void handleFinish()}
          className="smooth app-region-no-drag mt-9 h-10 w-[7.5rem] cursor-pointer rounded-[14px] bg-black text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
        >
          Finish
        </button>

        {/* Reserved height so the layout doesn't jump when an error appears. */}
        <p
          role="alert"
          className="mt-4 h-5 text-center text-sm tracking-tight text-zinc-600"
        >
          {failed && "Couldn’t save that. Please try again."}
        </p>
      </div>

      <p className="absolute inset-x-0 bottom-5 px-6 text-center text-xs font-medium tracking-tight text-zinc-500">
        *High Contrast mode is designed to meet WCAG 2.2 AA visual criteria
      </p>
    </div>
  );
}

export default AppearanceSetup;
