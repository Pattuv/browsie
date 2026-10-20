import { useEffect, useRef, useState } from "react";
import TitleBar from "../components/TitleBar";
import { useAuthStore } from "../stores/authStore";
import Dashboard from "./pages/Dashboard";
import Setup from "./pages/Setup";
import {
  clearSetupCompleted,
  hasCompletedSetup,
  markSetupCompleted,
} from "./setupGate";

// After the window regains focus, a beat before moving on, so the change happens in view.
const RETURN_SETTLE_MS = 400;

function OnboardingLayer() {
  const status = useAuthStore((state) => state.status);
  // Per account, worked out by main and pushed with the session.
  const setupComplete = useAuthStore((state) => state.setupComplete === true);
  // Sign-in finishes in the user's own browser. Until they're back in this window, keep routing as
  // signed out so Auth's "finish signing in" view stays put instead of changing behind their back.
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [prevStatus, setPrevStatus] = useState(status);
  // Null until the session is known. Once true for a setup visit, stays true until the Dashboard,
  // so the intro's soundtrack carries on through the setup steps.
  const playIntro = useRef<boolean | null>(null);

  if (status !== prevStatus) {
    setPrevStatus(status);
    setAwaitingReturn(
      prevStatus === "SIGNED_OUT" &&
        status === "SIGNED_IN" &&
        !document.hasFocus(),
    );
  }

  useEffect(() => {
    if (!awaitingReturn) {
      return undefined;
    }

    let settleTimer: number | undefined;
    const onFocus = () => {
      settleTimer = window.setTimeout(
        () => setAwaitingReturn(false),
        RETURN_SETTLE_MS,
      );
    };

    window.addEventListener("focus", onFocus);
    // Focus may have landed between the render and this effect.
    if (document.hasFocus()) {
      onFocus();
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(settleTimer);
    };
  }, [awaitingReturn]);

  const routedStatus = awaitingReturn ? "SIGNED_OUT" : status;
  const showDashboard = routedStatus === "SIGNED_IN" && setupComplete;

  if (showDashboard) {
    playIntro.current = false;
  } else if (routedStatus === "SIGNED_IN" && playIntro.current === null) {
    // Opened the app signed in but not set up: resume setup without the intro.
    playIntro.current = false;
  } else if (routedStatus === "SIGNED_OUT" && playIntro.current !== true) {
    // Re-read on every setup entry (logout, factory reset) until this visit commits to playing the intro.
    playIntro.current = !hasCompletedSetup();
  }

  // Remember whether this account got through setup, so the next signed-out visit knows whether to
  // play the intro. An account still in setup clears it: quit now and the next launch starts over.
  useEffect(() => {
    if (status !== "SIGNED_IN") {
      return;
    }

    if (setupComplete) {
      markSetupCompleted();
    } else {
      clearSetupCompleted();
    }
  }, [status, setupComplete]);

  // overflow-hidden: the window never scrolls as a page. Without it, anything poking past the edge (an open
  // menu on a short window) adds scrollbars, which narrow the viewport and reflow the whole Dashboard.
  return (
    <div className="relative h-screen min-h-full overflow-hidden">
      {/* Spans Dashboard's top-4 h-8 bar (48px); pt-4 keeps icons centered on that bar */}
      <TitleBar controlsClassName="h-12 *:pt-4" />
      <div className="h-full min-h-full">
        {/* LOADING renders nothing (setup also starts on white), so setup never flashes for a signed-in user. */}
        {showDashboard && <Dashboard />}
        {/* Signed out: Auth. Signed in but not set up: the setup steps. One element, so signing in keeps
            the same scene and soundtrack; Setup unmounting at the Dashboard is what fades the music out. */}
        {routedStatus !== "LOADING" && !showDashboard && (
          <Setup
            playIntro={playIntro.current === true}
            step={routedStatus === "SIGNED_IN" ? "setup" : "auth"}
          />
        )}
      </div>
    </div>
  );
}

export default OnboardingLayer;
