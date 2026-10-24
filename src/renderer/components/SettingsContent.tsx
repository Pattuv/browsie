import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calendar, Check, HardDrive, Mail, RotateCcw } from "lucide-react";
import { SAFE_SEARCH_SETTING } from "../../shared/web/safeSearch";
import { useAuthStore } from "../stores/authStore";
import { useDataStore } from "../stores/dataStore";
import { APPEARANCE_SETTING, readAppearance, type Appearance } from "../theme";
import AppearancePicker from "./AppearancePicker";
import BillingSettings from "./BillingSettings";
import PrimaryButton from "./PrimaryButton";

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="bric text-xl font-medium tracking-tight text-black">{title}</h2>
        <p className="mt-0.5 text-sm tracking-tight text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "integrations", label: "Integrations" },
  { id: "billing", label: "Billing" },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-zinc-200 px-4 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium tracking-tight text-black">{label}</span>
        <span className="mt-0.5 block text-sm tracking-tight text-zinc-500">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out ${checked ? "bg-[#9572FF]" : "bg-zinc-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}

function FactoryResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [resetting, setResetting] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      setResetting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const factoryReset = async () => {
    setResetting(true);

    try {
      await window.browsie?.auth.signOut({ resetSetup: true });
    } finally {
      setResetting(false);
      onClose();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();

        if (!resetting) {
          onClose();
        }
      }}
      className="smooth m-auto w-[24rem] overflow-visible rounded-[34px] border border-zinc-200 bg-white p-5 text-zinc-900 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop:bg-black/25 backdrop:backdrop-blur-[2px]"
    >
      <h2 id={titleId} className="bric text-xl font-medium leading-tight tracking-tight">
        Are you sure?
      </h2>
      <p className="mt-3 text-sm leading-relaxed tracking-tight text-zinc-600">
        This signs you out and takes you back to the sign-in screen. It deletes the AI key saved here and
        forgets that you finished setup, so you&rsquo;ll set Browsie up again after you sign in. Your
        bookmarks, history, and the websites you&rsquo;re signed in to stay on this computer. Your Google
        account is not deleted.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          disabled={resetting}
          className="smooth h-10 flex-1 cursor-pointer rounded-[18px] bg-zinc-100 text-base tracking-tight text-zinc-800 transition-[background-color,transform] duration-200 ease-out hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
        >
          No
        </button>
        <PrimaryButton
          onClick={() => void factoryReset()}
          disabled={resetting}
          className="smooth h-10! flex-1 rounded-[18px]!"
        >
          {resetting ? "Resetting…" : "Yes, reset"}
        </PrimaryButton>
      </div>
    </dialog>,
    document.body,
  );
}

const WORKSPACE = [
  { id: "gmail", label: "Gmail", Icon: Mail },
  { id: "calendar", label: "Calendar", Icon: Calendar },
  { id: "drive", label: "Drive files", Icon: HardDrive },
] as const;

type ConnectStatus = "idle" | "waiting" | "partial" | "failed";

function ConnectButton({
  connected,
  waiting,
  disabled,
  onClick,
}: {
  connected: boolean;
  waiting: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  if (connected) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium tracking-tight text-[#6b4fd8]">
        <Check size={14} strokeWidth={2.5} aria-hidden="true" /> Connected
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={waiting || disabled}
      onClick={onClick}
      className="smooth h-9 shrink-0 cursor-pointer rounded-[14px] bg-black px-4 text-sm font-medium tracking-tight text-white transition-transform duration-150 ease-out enabled:hover:scale-[1.02] enabled:active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
    >
      {waiting ? "Waiting…" : "Connect"}
    </button>
  );
}

function Integrations() {
  const signedIn = useAuthStore((state) => state.status === "SIGNED_IN");
  const services = useAuthStore((state) => state.googleServices);
  const syncEnabled = useAuthStore((state) => state.syncEnabled === true);
  const workspaceConnected = Boolean(services) && Object.values(services ?? {}).every(Boolean);
  const [workspaceStatus, setWorkspaceStatus] = useState<ConnectStatus>("idle");
  const [driveStatus, setDriveStatus] = useState<ConnectStatus>("idle");

  const connectWorkspace = async () => {
    if (workspaceStatus === "waiting") return;
    setWorkspaceStatus("waiting");
    try {
      const result = await window.browsie?.auth.connectGoogle();
      setWorkspaceStatus(result && Object.values(result).every(Boolean) ? "idle" : "partial");
    } catch {
      setWorkspaceStatus("failed");
    }
  };

  const connectDrive = async () => {
    if (driveStatus === "waiting") return;
    setDriveStatus("waiting");
    try {
      const session = await window.browsie?.auth.signIn();
      setDriveStatus(session?.syncEnabled ? "idle" : "partial");
    } catch {
      setDriveStatus("failed");
    }
  };

  const workspaceNote =
    workspaceStatus === "waiting"
      ? "Finish on Google’s page in your browser, then come back here."
      : workspaceStatus === "partial"
        ? "Some boxes weren’t ticked. Connect again and tick Gmail, Calendar, and Drive."
        : workspaceStatus === "failed"
          ? "That didn’t work. Please try again."
          : "";

  const driveNote =
    driveStatus === "waiting"
      ? "Finish on Google’s page in your browser, then come back here."
      : driveStatus === "partial"
        ? "Drive wasn’t ticked, so backups stay off. Connect again and allow it."
        : driveStatus === "failed"
          ? "That didn’t work. Please try again."
          : "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm tracking-tight text-zinc-500">
        What Browsie can use from your Google account. Each one opens Google’s permission page in your browser.
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium tracking-tight text-black">Google Workspace</span>
              <span className="mt-0.5 block text-sm tracking-tight text-zinc-500">
                Mail, calendar, and files, so Browsie can use them without opening the websites.
              </span>
            </span>
            <ConnectButton
              connected={workspaceConnected}
              waiting={workspaceStatus === "waiting"}
              disabled={!signedIn}
              onClick={() => void connectWorkspace()}
            />
          </div>
          <ul className="flex flex-wrap gap-2">
            {WORKSPACE.map(({ id, label, Icon }) => {
              const on = services?.[id] ?? false;
              return (
                <li
                  key={id}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tracking-tight ${
                    on ? "border-[#9572FF]/40 text-[#6b4fd8]" : "border-zinc-200 text-zinc-500"
                  }`}
                >
                  <Icon size={13} strokeWidth={2} aria-hidden="true" />
                  {label}
                  {on ? "" : " off"}
                </li>
              );
            })}
          </ul>
          <p role="status" className="min-h-5 text-sm tracking-tight text-zinc-600">
            {!signedIn ? "Sign in to connect this." : workspaceNote}
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium tracking-tight text-black">Drive backup</span>
            <span className="mt-0.5 block text-sm tracking-tight text-zinc-500">
              A private folder in Google Drive for settings, bookmarks, and history. Separate from your files.
            </span>
            <span role="status" className="mt-1 block min-h-5 text-sm tracking-tight text-zinc-600">
              {!signedIn ? "Sign in to connect this." : driveNote}
            </span>
          </span>
          <ConnectButton
            connected={syncEnabled}
            waiting={driveStatus === "waiting"}
            disabled={!signedIn}
            onClick={() => void connectDrive()}
          />
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const appearance = readAppearance(useDataStore((state) => state.settings[APPEARANCE_SETTING]));
  const safeSearch = useDataStore((state) => state.settings[SAFE_SEARCH_SETTING] !== false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const saveSetting = (patch: Record<string, unknown>) => {
    setSaveFailed(false);
    window.browsie?.data.update({ settings: patch }).catch(() => setSaveFailed(true));
  };

  const changeAppearance = (next: Appearance) => {
    saveSetting({ [APPEARANCE_SETTING]: next });
  };

  return (
    <div className="flex flex-col gap-9">
      <Section title="Appearance" description="How Browsie and your Dashboard look.">
        <AppearancePicker value={appearance} onChange={changeAppearance} />
        <p className="text-xs tracking-tight text-zinc-500">
          High Contrast is designed to meet WCAG 2.2 AA visual criteria.
        </p>
      </Section>

      <Section
        title="SafeSearch"
        description="Filters explicit results on Google, Bing, and DuckDuckGo, and turns on YouTube Restricted Mode."
      >
        <Toggle
          checked={safeSearch}
          label="SafeSearch"
          description="A link or address that goes straight to a page still opens."
          onChange={(next) => saveSetting({ [SAFE_SEARCH_SETTING]: next })}
        />
      </Section>

      {/* Reserved height so the layout doesn't jump when an error appears. */}
      <p role="alert" className="-mt-6 h-5 text-sm tracking-tight text-zinc-600">
        {saveFailed && "Couldn’t save that. Please try again."}
      </p>

      <Section
        title="Factory reset"
        description="Signs you out and takes you back to the sign-in screen. You’ll set Browsie up again after you sign in."
      >
        <button
          type="button"
          onClick={() => setConfirmingReset(true)}
          className="smooth flex h-10 w-fit cursor-pointer items-center gap-2 rounded-[16px] border border-zinc-300 bg-white px-4 text-sm font-medium tracking-tight text-black transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-100 active:scale-[0.98]"
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
          Factory reset
        </button>
      </Section>
      <FactoryResetDialog open={confirmingReset} onClose={() => setConfirmingReset(false)} />
    </div>
  );
}

// What Settings shows, in the browser (browsie://settings) and in the Dashboard's popup alike.
// Changes save as soon as they're made; the appearance applies everywhere through the synced settings.
function SettingsContent() {
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Settings" className="flex w-fit gap-1 rounded-full bg-zinc-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`h-8 cursor-pointer rounded-full px-4 text-sm font-medium tracking-tight transition-colors duration-150 ${
              tab === item.id ? "bg-white text-black shadow-sm" : "text-zinc-500 hover:text-black"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "general" && <GeneralSettings />}
      {tab === "integrations" && <Integrations />}
      {tab === "billing" && <BillingSettings />}
    </div>
  );
}

export default SettingsContent;
