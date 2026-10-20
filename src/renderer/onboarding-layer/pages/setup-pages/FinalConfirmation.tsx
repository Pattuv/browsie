import { useState } from "react";

// Last setup step. "Go to Browsie" is what finishes setup: main checks the steps' results (the keys are
// stored), records the account, saves the sign-in, and pushes the session; the gate swaps setup for the
// Dashboard, and Setup unmounting fades the soundtrack out.
function FinalConfirmation() {
  const [finishing, setFinishing] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleFinish = async () => {
    if (finishing) {
      return;
    }

    setFinishing(true);
    setFailed(false);

    try {
      await window.browsie?.auth.completeSetup();
    } catch {
      setFailed(true);
      setFinishing(false);
    }
  };

  return (
    <div className="relative z-10 h-full min-h-full">
      <div className="enter-blur flex h-full flex-col items-center justify-center px-6">
        <h1 className="bric text-center text-5xl font-medium tracking-tighter">
          You’re all set!
        </h1>

        <button
          type="button"
          data-click-sound="heavy"
          disabled={finishing}
          onClick={() => void handleFinish()}
          className="smooth app-region-no-drag mt-6 h-10 cursor-pointer rounded-[14px] bg-black px-5 text-sm font-medium tracking-tight text-white transition-transform duration-300 ease-out enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:opacity-60"
        >
          Go to Browsie →
        </button>

        {/* Reserved height so the layout doesn't jump when an error appears. */}
        <p
          role="alert"
          className="mt-4 h-5 text-center text-sm tracking-tight text-zinc-600"
        >
          {failed && "Something went wrong finishing setup. Please try again."}
        </p>
      </div>
    </div>
  );
}

export default FinalConfirmation;
