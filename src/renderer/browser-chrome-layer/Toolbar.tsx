import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, MessagesSquare, RotateCw, X } from 'lucide-react';
import IconButton from './IconButton';

// "https://www.example.com/" → "example.com". The full URL comes back when the bar is focused.
const prettyUrl = (url: string) =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

function AddressBar({ tab, style }: { tab: BrowserTab | null; style?: CSSProperties }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  // The whole address is selected (as it is right after clicking in).
  const [allSelected, setAllSelected] = useState(false);
  const url = tab?.url ?? '';
  const value = editing ? draft : url ? prettyUrl(url) : '';

  const trackSelection = (input: HTMLInputElement) => {
    setAllSelected(input.value.length > 0 && input.selectionStart === 0 && input.selectionEnd === input.value.length);
  };

  // Ctrl+L / F6 / Alt+D arrive from main, wherever focus was.
  useEffect(
    () =>
      window.browsie?.browser.onFocusAddress(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [],
  );

  return (
    <div className="chrome-item flex min-w-0 flex-1 justify-center px-6" style={style}>
      <div className="relative h-8 w-full max-w-[31rem] rounded-lg border border-transparent bg-zinc-100 transition-[max-width,background-color,border-color,box-shadow] duration-300 ease-out hover:bg-zinc-200/60 focus-within:max-w-[34rem] focus-within:border-[#9572FF]/40 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(149,114,255,0.12)] hover:focus-within:bg-white">
        {/* A native text selection can't have padding or rounded corners, so when the whole
            address is selected we hide it and draw this purple pill behind the text instead.
            It holds an invisible copy of the text, so it's always exactly the text's width. */}
        {allSelected && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 inset-x-4 flex items-center justify-center">
            <span className="max-w-full overflow-hidden whitespace-pre rounded-md bg-[#9572FF]/20 px-1.5 py-0.5 text-[0.8125rem] tracking-tight text-transparent">
              {value}
            </span>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          aria-label="Search or enter address"
          placeholder="Search for something or type a URL"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          onSelect={(event) => trackSelection(event.currentTarget)}
          onFocus={(event) => {
            setDraft(url);
            setEditing(true);
            // Select after React has swapped in the full URL.
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onBlur={() => {
            setEditing(false);
            setAllSelected(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              void window.browsie?.browser.navigate(draft);
              event.currentTarget.blur();
            }

            if (event.key === 'Escape') {
              setDraft(url);
              event.currentTarget.blur();
            }
          }}
          className={`relative h-full w-full select-text bg-transparent px-4 text-center text-[0.8125rem] tracking-tight text-zinc-700 outline-none placeholder:text-zinc-400 focus:text-zinc-900 ${
            allSelected ? 'selection:bg-transparent' : 'selection:bg-[#9572FF]/25'
          }`}
        />
      </div>
    </div>
  );
}

function ReloadButton() {
  // Bumped on each click to replay the one-turn spin.
  const [spins, setSpins] = useState(0);

  return (
    <IconButton
      label="Reload"
      onClick={() => {
        setSpins((count) => count + 1);
        void window.browsie?.browser.reload();
      }}
    >
      <RotateCw key={spins} size={16} aria-hidden="true" className={spins ? 'spin-once' : ''} />
    </IconButton>
  );
}

type ToolbarProps = {
  tab: BrowserTab | null;
  /** Base delay for the launch entrance, in ms. */
  entranceDelay: number;
};

/** The bar at the top of the page card: navigation, address bar, Sessions. */
function Toolbar({ tab, entranceDelay }: ToolbarProps) {
  const browser = window.browsie?.browser;
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${entranceDelay + ms}ms` });

  return (
    <div className="relative flex h-12 shrink-0 items-center border-b border-zinc-200/80 px-2.5">
      <div className="chrome-item flex items-center gap-0.5" style={delay(0)}>
        <IconButton
          label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => browser?.back()}
          className="hover:[&_svg]:-translate-x-0.5"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => browser?.forward()}
          className="hover:[&_svg]:translate-x-0.5"
        >
          <ArrowRight size={17} aria-hidden="true" />
        </IconButton>
        {tab?.loading ? (
          <IconButton label="Stop loading" onClick={() => browser?.stop()}>
            <X size={17} aria-hidden="true" />
          </IconButton>
        ) : (
          <ReloadButton />
        )}
      </div>

      <AddressBar tab={tab} style={delay(60)} />

      {/* The Sessions panel arrives with the agent; the button is here so the layout is final. */}
      <button
        type="button"
        className="chrome-item flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-[0.8125rem] tracking-tight text-zinc-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-zinc-200/70 hover:text-zinc-800 active:scale-95"
        style={delay(120)}
      >
        <MessagesSquare size={15} aria-hidden="true" />
        Sessions
      </button>

      {tab?.loading && <div className="loading-bar absolute inset-x-0 -bottom-px h-0.5" aria-hidden="true" />}
    </div>
  );
}

export default Toolbar;
