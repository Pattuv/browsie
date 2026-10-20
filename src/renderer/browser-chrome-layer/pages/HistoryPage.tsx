import { useEffect, useRef, useState } from 'react';
import { Globe, Search, X } from 'lucide-react';
import { prettyUrl } from '../prettyUrl';
import { useLockdownStore } from '../../stores/browserStore';

const browser = window.browsie?.browser;
const library = window.browsie?.library;

// Visits loaded at a time; "Show more" loads the next lot.
const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 200;

const dayKey = (iso: string) => new Date(iso).toDateString();

// "Today", "Yesterday", "Monday 13 October", with the year only when it isn't this year.
const dayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
};

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// Consecutive visits on the same day, newest first.
const groupByDay = (visits: Visit[]) => {
  const groups: { key: string; label: string; visits: Visit[] }[] = [];

  for (const visit of visits) {
    const key = dayKey(visit.visitedAt);
    const last = groups.at(-1);

    if (last?.key === key) {
      last.visits.push(visit);
    } else {
      groups.push({ key, label: dayLabel(visit.visitedAt), visits: [visit] });
    }
  }

  return groups;
};

function VisitRow({ visit, onRemove }: { visit: Visit; onRemove: () => void }) {
  return (
    <li className="group smooth flex items-center gap-3 rounded-[16px] px-3 py-2 transition-colors duration-150 hover:bg-zinc-100">
      <span className="w-16 shrink-0 text-[13px] tabular-nums tracking-tight text-zinc-500">
        {timeLabel(visit.visitedAt)}
      </span>
      <Globe size={16} strokeWidth={1.75} className="shrink-0 text-zinc-400" aria-hidden="true" />
      <button
        type="button"
        role="link"
        title={`${visit.title}\n${visit.url}`}
        onClick={() => void browser?.navigate(visit.url)}
        onAuxClick={(event) => event.button === 1 && void browser?.newTab(visit.url)}
        className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left"
      >
        <span className="min-w-0 truncate text-[15px] font-[460] tracking-tight text-zinc-900 group-hover:underline">
          {visit.title}
        </span>
        <span className="min-w-0 max-w-[45%] shrink-[3] truncate text-[13px] tracking-tight text-zinc-500">
          {prettyUrl(new URL(visit.url).origin)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${visit.title} from history`}
        title="Remove from history"
        onClick={onRemove}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 opacity-60 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-zinc-200 hover:text-zinc-900 focus-visible:opacity-100"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/** browsie://history: everything visited in the last 90 days, by day, with search. */
function HistoryPage() {
  const locked = useLockdownStore((state) => state.enabled);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  // Undefined while the first load is on its way.
  const [visits, setVisits] = useState<Visit[] | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const loadedOnce = useRef(false);
  const searching = query.trim().length > 0;

  // Screen readers land on the page's title when it opens.
  useEffect(() => headingRef.current?.focus(), []);

  // The newest visits, or the search results. Kept fresh as visits happen in other tabs. Older visits
  // already loaded with "Show more" stay below the refreshed newest ones.
  useEffect(() => {
    let live = true;

    const refresh = () => {
      const request = searching ? library?.searchHistory(query) : library?.listHistory({ limit: PAGE_SIZE });

      void request
        ?.then((fresh) => {
          if (!live) {
            return;
          }

          if (searching) {
            setVisits(fresh);
            setHasMore(false);
            return;
          }

          setVisits((previous) => {
            const oldest = fresh.at(-1)?.visitedAt;

            if (!previous || !oldest || fresh.length < PAGE_SIZE) {
              return fresh;
            }

            return [...fresh, ...previous.filter((visit) => visit.visitedAt < oldest)];
          });

          // A short first page means that's everything. Otherwise keep what "Show more" last found out.
          if (fresh.length < PAGE_SIZE) {
            setHasMore(false);
          } else if (!loadedOnce.current) {
            setHasMore(true);
          }

          loadedOnce.current = true;
        })
        .catch(() => live && setVisits([]));
    };

    const timer = window.setTimeout(refresh, searching ? SEARCH_DELAY_MS : 0);
    const unsubscribe = library?.onHistoryChanged(refresh);

    return () => {
      live = false;
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [query, searching]);

  const showMore = () => {
    const before = visits?.at(-1)?.visitedAt;

    void library?.listHistory({ before, limit: PAGE_SIZE }).then((older) => {
      setVisits((previous) => [...(previous ?? []), ...older]);
      setHasMore(older.length === PAGE_SIZE);
    });
  };

  const remove = (visit: Visit) => {
    setVisits((previous) => previous?.filter((entry) => entry.id !== visit.id));
    void library?.removeVisit(visit.id);
  };

  const groups = groupByDay(visits ?? []);

  return (
    <div className={`absolute inset-0 overflow-y-auto ${locked ? 'pointer-events-none' : ''}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pt-10 pb-16">
        <header className="flex items-end justify-between gap-4">
          <h1 ref={headingRef} tabIndex={-1} className="bric text-[2.4rem] tracking-tighter text-black outline-none">
            History
          </h1>
          {!confirmingClear ? (
            <button
              type="button"
              disabled={!visits?.length}
              onClick={() => setConfirmingClear(true)}
              className="h-9 shrink-0 cursor-pointer rounded-full border border-[#9572FF]/50 px-4 text-[14px] font-[500] tracking-tight text-(--chrome-link) transition-[background-color,transform] duration-150 ease-out enabled:hover:bg-[#9572FF]/10 enabled:active:scale-95 disabled:cursor-default disabled:opacity-40"
            >
              Clear all history
            </button>
          ) : (
            <div role="group" aria-label="Clear all history?" className="flex shrink-0 items-center gap-2">
              <span className="text-[14px] tracking-tight text-zinc-600">Clear everything? This can&rsquo;t be undone.</span>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmingClear(false)}
                className="h-9 cursor-pointer rounded-full bg-zinc-100 px-4 text-[14px] tracking-tight text-zinc-800 transition-colors hover:bg-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClear(false);
                  setVisits([]);
                  setHasMore(false);
                  void library?.clearHistory();
                  headingRef.current?.focus();
                }}
                className="h-9 cursor-pointer rounded-full bg-black px-4 text-[14px] tracking-tight text-white transition-transform active:scale-95"
              >
                Clear history
              </button>
            </div>
          )}
        </header>

        <label className="smooth flex h-11 items-center gap-2.5 rounded-[16px] border border-zinc-200 bg-white px-3.5 transition-colors focus-within:border-[#9572FF]/60 focus-within:shadow-[0_0_0_4px_rgba(149,114,255,0.12)]">
          <Search size={17} className="shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="sr-only">Search history</span>
          <input
            type="search"
            value={query}
            spellCheck={false}
            placeholder="Search history"
            onChange={(event) => setQuery(event.target.value)}
            className="h-full flex-1 bg-transparent text-[15px] tracking-tight text-zinc-900 outline-none placeholder:text-zinc-400"
          />
        </label>

        <p role="status" className="sr-only">
          {visits && searching ? `${visits.length} ${visits.length === 1 ? 'result' : 'results'}` : ''}
        </p>

        {visits === undefined ? (
          <div className="h-20" aria-busy="true" />
        ) : visits.length === 0 ? (
          <p className="py-10 text-center text-[15px] tracking-tight text-zinc-500">
            {searching ? 'Nothing in your history matches that.' : 'Pages you visit will show up here.'}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col gap-1">
              <h2 className="px-3 text-[15px] font-[560] tracking-tight text-zinc-900">{group.label}</h2>
              <ul className="flex flex-col">
                {group.visits.map((visit) => (
                  <VisitRow key={visit.id} visit={visit} onRemove={() => remove(visit)} />
                ))}
              </ul>
            </section>
          ))
        )}

        {hasMore && !searching && (
          <button
            type="button"
            onClick={showMore}
            className="mx-auto h-10 cursor-pointer rounded-full bg-zinc-100 px-5 text-[14px] tracking-tight text-zinc-800 transition-colors hover:bg-zinc-200"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  );
}

export default HistoryPage;
