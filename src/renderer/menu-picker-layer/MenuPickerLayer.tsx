import { useState } from "react";
import PrimaryButton from "../components/PrimaryButton";
import TitleBar from "../components/TitleBar";
import wordmark from "../assets/wordmark.svg";
import caretakerIcon from "../assets/paint-icons/caretaker.svg";
import independentIcon from "../assets/paint-icons/independent.svg";

function MenuPickerLayer() {
  const [mode, setMode] = useState<UserMode>("caretaker");
  const [saving, setSaving] = useState(false);

  const continueWithMode = async () => {
    if (saving || mode !== "caretaker") {
      return;
    }

    setSaving(true);

    try {
      await window.browsie?.data.update({ userMode: mode });
      // Closing hands off to main, which opens the Dashboard window if it isn't already open.
      window.close();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex h-screen min-h-full flex-col bg-white px-8 pb-7 pt-14">
      <TitleBar maximizable={false} offsetClassName="top-2">
        <img src={wordmark} alt="Browsie" className="h-5" />
      </TitleBar>

      <div className="app-region-no-drag mt-8 flex flex-1 flex-col items-center gap-8">
        <div>
          <h1 className="bric text-center text-3xl font-medium tracking-tighter text-zinc-900">
            Which type of user are you?
          </h1>
          <p className="mt-2 max-w-sm text-center text-sm font-medium leading-snug tracking-tight text-zinc-600">
            Your choice will tailor the experience to your needs, and can be
            changed at any time.
          </p>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 px-10">
          <button
            type="button"
            onClick={() => setMode("caretaker")}
            className={`smooth flex flex-col items-start rounded-[28px] border px-4 py-4 text-left transition-colors ${
              mode === "caretaker"
                ? "border-[#8B80F9] bg-gray-100/50"
                : "border-zinc-200 bg-white hover:border-zinc-300"
            }`}
          >
            <img
              src={caretakerIcon}
              alt=""
              className="h-20 w-20 object-contain"
            />
            <p className="mt-3 font-medium text-xl tracking-tighter text-zinc-900 bric">
              Caretaker
            </p>
            <p className="mt-1 font-medium text-sm leading-snug tracking-tight text-zinc-500">
              You will guide the visually impaired user and handle setup before
              allowing them to use Browsie.
            </p>
          </button>

          <div
            aria-disabled="true"
            className="smooth flex cursor-not-allowed flex-col items-start rounded-[28px] border border-zinc-500 bg-gray-100 px-4 py-4 opacity-45"
          >
            <img
              src={independentIcon}
              alt=""
              className="h-20 w-20 object-contain"
            />
            <div className="mt-3 flex items-center gap-2">
              <p className="text-xl font-medium tracking-tighter text-zinc-900 bric">
                Independent
              </p>
              <span className="smooth rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tracking-widest text-white">
                BETA
              </span>
            </div>
            <p className="mt-1 font-medium text-sm leading-snug tracking-tight text-zinc-500">
              You are visually impaired, but you are capable of using assistive
              tools to navigate the browser and use Browsie.
            </p>
          </div>
        </div>

        <PrimaryButton
          onClick={continueWithMode}
          disabled={saving}
          className="smooth rounded-[18px]! px-15"
        >
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
}

export default MenuPickerLayer;
