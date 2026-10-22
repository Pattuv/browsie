import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Check, Gauge, Info, Lock, LogOut, Settings, Users } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useLockdownStore } from '../stores/browserStore';
import { playClick } from '../sounds';
import DropdownMenu, { MenuDivider, MenuGroup, MenuItem } from './DropdownMenu';
import PrimaryButton from './PrimaryButton';
import SignOutDialog from './SignOutDialog';

const changeMode = (close: () => void) => {
  close();
  window.browsie?.openModePicker();
};

const OPENROUTER_BILLING_URL = 'https://openrouter.ai/settings/credits';
// Where the user edits their key's spending cap.
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';

// The Google profile photo main downloaded at sign-in (a data: URL), or a grey placeholder.
function Avatar({
  pictureDataUrl,
  className,
}: {
  pictureDataUrl?: string;
  className: string;
}) {
  if (pictureDataUrl) {
    return (
      <img
        src={pictureDataUrl}
        alt=""
        className={`${className} rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`${className} flex items-end justify-center overflow-hidden rounded-full bg-zinc-300`}
    >
      <i
        className="bi bi-person-fill -mb-1.5 text-2xl leading-none text-white"
        aria-hidden="true"
      />
    </span>
  );
}

type InfoTipProps = {
  /** left: opens beside the icon, out past the panel's edge. top: opens above it. */
  side: 'left' | 'top';
  iconSize: number;
  children: ReactNode;
  action: { label: string; onClick?: () => void };
};

// An (i) that opens a small black card on hover or focus. The card's padding bridges the gap to the
// icon, so the pointer can travel into it and press its button.
function InfoTip({ side, iconSize, children, action }: InfoTipProps) {
  return (
    <span tabIndex={0} aria-label="More info" className="group/tip relative flex cursor-default outline-none">
      <Info size={iconSize} aria-hidden="true" />
      <span
        role="tooltip"
        className={`invisible absolute z-50 opacity-0 transition-[opacity,visibility] delay-100 duration-150 ease-out group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 ${
          side === 'left'
            ? 'right-full top-1/2 -translate-y-1/2 pr-3'
            : 'bottom-full left-1/2 -translate-x-1/2 pb-2.5'
        }`}
      >
        <span className="smooth flex w-60 flex-col gap-2.5 rounded-[20px] bg-black p-3.5 text-left text-xs font-normal leading-snug tracking-tight text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
          <span>{children}</span>
          <button
            type="button"
            onClick={action.onClick}
            className="smooth h-8 w-full cursor-pointer rounded-[13px] bg-white text-xs font-medium text-black transition-transform duration-200 ease-out active:scale-[0.98]"
          >
            {action.label}
          </button>
        </span>
      </span>
    </span>
  );
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
// The big amount has its own "$", so just the number.
const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const USAGE_MESSAGES = {
  'no-key': 'No AI key on this device.',
  'invalid-key': 'Your OpenRouter key isn’t working. Check it on OpenRouter.',
  offline: 'Couldn’t reach OpenRouter.',
};

const BADGES = {
  plenty: { label: 'Plenty left', Icon: Check, className: 'bg-[#DDF0E2] text-[#1F8A3B]' },
  low: { label: 'Running low', Icon: AlertCircle, className: 'bg-[#FDF0D5] text-[#A15C00]' },
  out: { label: 'Used up', Icon: AlertCircle, className: 'bg-[#FBE0DE] text-[#C2352B]' },
};

// While the card is open it refreshes on this beat, and straight away when the window regains focus (say,
// back from raising the cap or adding credits on OpenRouter).
const USAGE_REFRESH_MS = 15_000;

// Main asks OpenRouter with the account's management key (at most every 10 seconds) and sends back only the
// figures. Undefined while the first read is on its way: the layout stays the same with dashes, so nothing
// jumps. Later refreshes keep showing the last figures until new ones arrive.
function UsageCard() {
  const [usage, setUsage] = useState<AiUsage>();

  useEffect(() => {
    let current = true;

    const refresh = () => {
      const request = window.browsie?.getAiUsage() ?? Promise.resolve<AiUsage>({ state: 'offline' });

      request
        .catch((): AiUsage => ({ state: 'offline' }))
        .then((result) => {
          if (current) {
            setUsage(result);
          }
        });
    };

    refresh();
    const timer = window.setInterval(refresh, USAGE_REFRESH_MS);
    window.addEventListener('focus', refresh);

    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const ok = usage?.state === 'ok' ? usage : null;
  // Whichever runs out first sets the scale: the cap if what's left under it is the smaller, else the credits.
  const capIsTighter = ok !== null && ok.capRemaining !== null && ok.capRemaining <= ok.balance;
  const scale = ok ? (capIsTighter ? (ok.limit ?? 0) : ok.totalCredits) : 0;
  const percentUsed = ok ? (scale > 0 ? Math.min(100, (1 - ok.available / scale) * 100) : 100) : 0;
  const badge = !ok
    ? null
    : ok.available <= 0
      ? BADGES.out
      : ok.available <= scale * 0.25
        ? BADGES.low
        : BADGES.plenty;

  let headline: ReactNode;
  if (usage && usage.state !== 'ok') {
    headline = <span className="text-sm font-medium leading-7 tracking-tight">{USAGE_MESSAGES[usage.state]}</span>;
  } else {
    headline = (
      <>
        <span className="text-lg text-zinc-600">$</span>
        <span className="bric text-[28px] font-semibold leading-none tracking-tight">
          {ok ? amount.format(ok.available) : '—'}
        </span>
        {/* Reset note sits under "available now", so the cap row below stays on one line. */}
        <span className="flex flex-col gap-0.5 self-center">
          <span className="text-sm font-medium leading-none tracking-tight">available now</span>
          {ok?.limit !== null && ok?.resets && (
            <span className="text-[11px] leading-none tracking-tight text-zinc-400">
              Spending cap resets {ok.resets}
            </span>
          )}
        </span>
      </>
    );
  }

  let capText = '—';
  if (ok && ok.limit !== null) {
    capText = `${dollars.format(ok.usedThisPeriod)} of ${dollars.format(ok.limit)} used`;
  } else if (ok) {
    capText = 'No cap';
  }

  return (
    <div className="smooth rounded-[22px] bg-zinc-100 px-3.5 pb-3 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm tracking-tight text-zinc-600">AI usage</p>
        {badge && (
          <span className={`smooth flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
            <badge.Icon size={10} strokeWidth={2.5} aria-hidden="true" />
            {badge.label}
          </span>
        )}
      </div>

      {/* Equal space above (to AI usage) and below (to the bar), so the amount sits centered between them. */}
      <p className="mt-2.5 flex items-baseline gap-1 leading-none">{headline}</p>

      <div className="mx-0.5 mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-300">
        <div className="h-full rounded-full bg-[#9572FF]" style={{ width: `${percentUsed}%` }} />
      </div>

      <dl className="mt-2.5 flex flex-col gap-1.5 text-sm tracking-tight">
        {/* The label never wraps; a long amount wraps inside its own column instead of pushing the card wider. */}
        <div className="flex items-center justify-between gap-2">
          <dt className="flex shrink-0 items-center gap-1 whitespace-nowrap text-zinc-400">
            {/* The cap lives on the Browsie key in their OpenRouter dashboard. */}
            <InfoTip
              side="left"
              iconSize={13}
              action={{
                label: 'Configure spending cap',
                onClick: () => window.browsie?.openExternal(OPENROUTER_KEYS_URL),
              }}
            >
              Your spending cap is the most Browsie&rsquo;s AI can spend from your OpenRouter credit balance. Once
              it&rsquo;s used up, the AI stops until you raise it, or until it resets if you&rsquo;ve set it to
              reset on a schedule.
            </InfoTip>
            Spending cap
          </dt>
          <dd className="min-w-0 text-right text-zinc-800">{capText}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-zinc-400">Credit balance</dt>
          <dd className="text-zinc-800">{ok ? dollars.format(ok.balance) : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

function LockdownRow() {
  const enabled = useLockdownStore((state) => state.enabled);
  const toggle = useLockdownStore((state) => state.toggle);

  const handleToggle = () => {
    playClick('heavy');
    toggle();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  // Stop the (i) from toggling: its tooltip and button live in this wrapper.
  const ignoreTip = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <div
      role="switch"
      tabIndex={0}
      aria-checked={enabled}
      aria-label="Lockdown Mode"
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      className="smooth flex w-full cursor-pointer items-center gap-3 rounded-[16px] px-3.5 py-1 text-left outline-none transition-colors duration-200 ease-out hover:bg-zinc-100"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-[460] tracking-tight">
          <Lock size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="flex items-center gap-1.5">
            Lockdown Mode
            {/* Settings panel lands later. */}
            <span
              className="flex cursor-default text-zinc-600"
              onClick={ignoreTip}
              onPointerDown={ignoreTip}
              onKeyDown={ignoreTip}
            >
              <InfoTip side="top" iconSize={14} action={{ label: 'Change this in settings' }}>
                When Lockdown Mode is on, the browser is only usable by the agent. The agent only works when
                Lockdown Mode is on.
              </InfoTip>
            </span>
          </span>
        </p>
        <p className="mt-1 text-xs tracking-tight text-zinc-600">
          {enabled ? 'Browser is locked, agent-control only.' : 'Full browser control'}
        </p>
      </div>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out ${
          enabled ? 'bg-[#9572FF]' : 'bg-zinc-300'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </div>
  );
}

type ProfileMenuProps = {
  /** Sizing/hover for the avatar button in the chrome (dashboard keeps the default). */
  triggerClassName?: string;
  /** Called while the menu is mounted, including the blur-out, so a browser overlay can stay up. */
  onOpenChange?: (open: boolean) => void;
  /** Browser chrome variant: adds Lockdown Mode and replaces Log out with Quit (back to the dashboard). */
  quit?: { label?: string; onClick: () => void };
  /** CSS selector for a chrome card. The panel is portaled there, inset evenly from its top-right corner. */
  panelTarget?: string;
  /** Dashboard: opens its Settings popup. */
  onOpenSettings?: () => void;
};

function ProfileMenu({ triggerClassName = 'h-7 w-7', onOpenChange, quit, panelTarget, onOpenSettings }: ProfileMenuProps) {
  const firstName = useAuthStore((state) => state.firstName);
  const email = useAuthStore((state) => state.email);
  const pictureDataUrl = useAuthStore((state) => state.pictureDataUrl);
  // Lockdown only exists in the chrome; there it locks billing, Change mode and Quit.
  const locked = useLockdownStore((state) => state.enabled) && Boolean(quit);
  // Outside the menu, so the dialog stays up after the menu closes.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  return (
    <>
      <SignOutDialog open={confirmingSignOut} onClose={() => setConfirmingSignOut(false)} />
      <DropdownMenu
        panelTarget={panelTarget}
        onOpenChange={onOpenChange}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            title="Profile"
            aria-label="Account"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
            className={`app-region-no-drag flex cursor-pointer items-center justify-center rounded-full transition-[background-color,transform] duration-150 ease-out active:scale-85 ${triggerClassName}`}
          >
            <Avatar pictureDataUrl={pictureDataUrl} className="h-full w-full" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="flex items-center gap-3 px-2 py-1">
              <Avatar
                pictureDataUrl={pictureDataUrl}
                className="h-10 w-10 shrink-0"
              />
              <div className="min-w-0">
                <p className="bric truncate text-xl font-medium leading-tight tracking-tight">
                  {firstName}
                </p>
                <p className="truncate text-sm tracking-tight text-zinc-600">
                  {email}
                </p>
              </div>
            </div>

            <UsageCard />
            <MenuItem
              icon={Gauge}
              label="Check OpenRouter billing"
              disabled={locked}
              onClick={() => {
                close();
                window.browsie?.openExternal(OPENROUTER_BILLING_URL);
              }}
              trailing={<ArrowUpRight size={16} strokeWidth={1.75} className="text-zinc-600" aria-hidden="true" />}
            />
            <MenuDivider />

            {quit ? (
              <>
                <LockdownRow />
                <MenuDivider />
                <MenuGroup>
                  <MenuItem icon={Users} label="Change mode" disabled={locked} onClick={() => changeMode(close)} />
                  <MenuItem
                    icon={LogOut}
                    label={quit.label ?? 'Quit'}
                    disabled={locked}
                    danger
                    onClick={() => {
                      close();
                      quit.onClick();
                    }}
                  />
                </MenuGroup>
              </>
            ) : (
              <>
                <MenuGroup>
                  <MenuItem icon={Users} label="Change mode" onClick={() => changeMode(close)} />
                  <MenuItem
                    icon={Settings}
                    label="Settings"
                    onClick={() => {
                      close();
                      onOpenSettings?.();
                    }}
                  />
                </MenuGroup>
                {/* Asks first; the dialog does the actual sign-out. */}
                <PrimaryButton
                  onClick={() => {
                    close();
                    setConfirmingSignOut(true);
                  }}
                  className="smooth h-10! w-full rounded-[18px]!"
                >
                  Log out
                </PrimaryButton>
              </>
            )}
          </>
        )}
      </DropdownMenu>
    </>
  );
}

export default ProfileMenu;
