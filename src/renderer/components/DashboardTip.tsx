import { useEffect, useState } from "react";

const TIP_INTERVAL_MS = 7000;
const TIP_GAP_MS = 600;

// Starts on a random one each time the dashboard opens, then cycles. `highlight` renders as a pill.
type Tip = {
  before: string;
  highlight: string;
  after: string;
};

const TIPS: Tip[] = [
  { before: "Switch between user types anytime with", highlight: "Change mode", after: "in the profile menu" },
  { before: "Keep an eye on AI credits with", highlight: "Check Openrouter billing", after: "in the profile menu" },
  { before: "New to caretaking? The", highlight: "support guide", after: "walks you through helping with Browsie" },
  { before: "Your settings are backed up to", highlight: "Google Drive", after: "so they follow you to any computer" },
  { before: "Sharing this computer? Use", highlight: "Log out", after: "in the profile menu when you're done" },
];

function DashboardTip({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  // gap: the old tip has risen out and the line stays empty briefly before the next rises in.
  const [phase, setPhase] = useState<"shown" | "leaving" | "gap">("shown");
  const tip = TIPS[index];

  useEffect(() => {
    if (phase === "leaving") {
      return undefined;
    }

    const timer =
      phase === "shown"
        ? setTimeout(() => setPhase("leaving"), TIP_INTERVAL_MS)
        : setTimeout(() => {
            setIndex((current) => (current + 1) % TIPS.length);
            setPhase("shown");
          }, TIP_GAP_MS);

    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <p
      key={index}
      onAnimationEnd={() => {
        if (phase === "leaving") {
          setPhase("gap");
        }
      }}
      className={`text-center text-xs tracking-tight text-zinc-600 ${phase === "shown" ? "tip-in" : "tip-out"} ${className}`}
    >
      {tip.before}{" "}
      <span className="mx-0.5 rounded-md border border-zinc-300 bg-zinc-100 px-1 py-0.5 font-medium text-zinc-800">
        {tip.highlight}
      </span>{" "}
      {tip.after}
    </p>
  );
}

export default DashboardTip;
