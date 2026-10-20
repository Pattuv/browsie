import { ArrowUpRight } from "lucide-react";

const SETUP_GUIDE_URL = "https://browsie.org/setup-guide";

type SetupGuideProps = {
  onContinue: () => void;
};

function SetupGuide({ onContinue }: SetupGuideProps) {
  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="enter-blur flex h-full flex-col items-center justify-center px-6">
        <h1 className="bric text-center text-5xl font-medium tracking-tighter">
          Let’s get you set up.
        </h1>
        <p className="mt-6 max-w-[38rem] text-center text-2xl font-medium tracking-tight text-zinc-500">
          Read the Setup Guide first to understand how to set up and maintain
          Browsie.&nbsp;↓
        </p>

        <button
          type="button"
          onClick={() => window.browsie?.openExternal(SETUP_GUIDE_URL)}
          className="smooth app-region-no-drag mt-8 flex w-[20.5rem] cursor-pointer items-center justify-between rounded-2xl bg-[#D7CBFF] px-4 py-3 text-left transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        >
          <span className="flex flex-col">
            <span className="text-lg font-medium tracking-tight text-black">
              Setup Guide
            </span>
            <span className="text-xs font-medium tracking-tight text-zinc-600">
              Click here to go to the setup guide
            </span>
          </span>
          <ArrowUpRight
            size={30}
            strokeWidth={1.5}
            className="shrink-0 text-black"
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          data-click-sound="heavy"
          onClick={onContinue}
          className="smooth app-region-no-drag mt-7 h-10 w-[7.5rem] cursor-pointer rounded-[14px] bg-black text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default SetupGuide;
