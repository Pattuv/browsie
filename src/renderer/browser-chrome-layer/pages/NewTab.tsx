import { useState, type CSSProperties } from 'react';
import { Grip, HeartHandshake } from 'lucide-react';
import mascot from '../../assets/mascot.svg';

const GUIDE_URL = 'https://browsiedocs.super.site/browsie-help-center';
const GOOGLE_APPS_URL = 'https://about.google/products/';
// The one-line "what's new" next to the version in the footer.
const RELEASE_NOTE = 'added agentic security';

type NewTabProps = {
  /** Base delay for the staggered entrance, in ms. Null shows the page instantly (switching back to a tab). */
  entranceDelay: number | null;
};

/** Browsie's own New Tab page. Drawn by the chrome itself, so no website process is involved. */
function NewTab({ entranceDelay: initialDelay }: NewTabProps) {
  // Decided once, on mount: a re-render must never cut off (or restart) an entrance mid-play.
  const [entranceDelay] = useState(initialDelay);
  const browser = window.browsie?.browser;
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${(entranceDelay ?? 0) + ms}ms` });

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center overflow-y-auto px-6 ${
        entranceDelay === null ? 'no-entrance' : ''
      }`}
    >
      <button
        type="button"
        role="link"
        onClick={() => browser?.navigate(GUIDE_URL)}
        className="chrome-item absolute left-4 top-4 text-xs text-zinc-500 underline underline-offset-2 transition-colors duration-150 hover:text-zinc-900"
        style={delay(0)}
      >
        Need help?
      </button>

      <div className="chrome-item absolute right-4 top-3 flex items-center gap-1" style={delay(40)}>
        <button
          type="button"
          aria-label="Go to Google"
          title="Google"
          onClick={() => browser?.navigate('google.com')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-900 transition-[background-color,transform] duration-150 hover:bg-zinc-100 active:scale-90"
        >
          <i className="bi bi-google text-[1.05rem]" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Google apps"
          title="Google apps"
          onClick={() => browser?.navigate(GOOGLE_APPS_URL)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-900 transition-[background-color,transform] duration-150 hover:bg-zinc-100 active:scale-90"
        >
          <Grip size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(0.5rem,1vh,1rem)] pb-16">
        <img
          src={mascot}
          alt=""
          className="chrome-item mb-3 h-28 transition-transform duration-500 ease-out hover:-rotate-3 hover:scale-105"
          style={delay(80)}
        />
        <h1 className="chrome-item bric text-center text-[2.6rem] tracking-tighter text-black" style={delay(160)}>
          Where to today?
        </h1>
        <p className="chrome-item text-[1.0625rem] tracking-tight text-zinc-600" style={delay(240)}>
          Hold spacebar to talk to Browsie
        </p>
        <div
          className="chrome-item mt-[clamp(1.5rem,3vh,2.5rem)] flex h-[7.5rem] w-full max-w-[22.5rem] items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50/60 text-sm tracking-tight text-zinc-400"
          style={delay(320)}
        >
          No recent activity
        </div>
      </div>

      <p
        className="chrome-item absolute bottom-6 left-1/2 -translate-x-1/2 text-[0.6875rem] tracking-tight text-zinc-500"
        style={delay(400)}
      >
        v.{__APP_VERSION__}
        <span className="mx-2 text-zinc-300">|</span>
        {RELEASE_NOTE}
      </p>

      {/* The tutorial lands later; the button is here so the layout is final. */}
      <button
        type="button"
        className="chrome-item absolute bottom-3 right-3 flex h-10 items-center gap-2 rounded-xl bg-[#F1EDFF] px-4 text-[0.9375rem] tracking-tight text-[#9572FF] transition-[background-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:bg-[#E9E2FF] hover:shadow-[0_6px_16px_rgba(149,114,255,0.18)] active:translate-y-0 active:scale-[0.98]"
        style={delay(440)}
      >
        <HeartHandshake size={17} aria-hidden="true" />
        Interactive Tutorial
      </button>
    </div>
  );
}

export default NewTab;
