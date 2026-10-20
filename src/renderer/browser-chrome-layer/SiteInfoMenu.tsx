import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Cookie,
  FileCheck,
  LockKeyhole,
  LockKeyholeOpen,
  MapPin,
  Mic,
  Settings,
  Settings2,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import DropdownMenu, { MenuDivider, MenuGroup, MenuItem } from '../components/DropdownMenu';
import { trackChromeMenu } from '../stores/browserStore';

const browser = window.browsie?.browser;

// Module-level so it's the same function every render (see TabStrip).
const handleOpenChange = trackChromeMenu('site-info');

type Section = 'certificate' | 'cookies' | 'settings';

const chevron = <ChevronRight size={16} strokeWidth={1.75} className="text-zinc-500" aria-hidden="true" />;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const Note = ({ children }: { children: ReactNode }) => (
  <p className="px-3.5 text-[13px] leading-snug tracking-tight text-zinc-500">{children}</p>
);

const PERMISSION_ROWS: Record<SitePermissionKind, { label: string; icon: LucideIcon }> = {
  geolocation: { label: 'Location', icon: MapPin },
  camera: { label: 'Camera', icon: Video },
  microphone: { label: 'Microphone', icon: Mic },
  notifications: { label: 'Notifications', icon: Bell },
};

const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  return `${power === 0 ? bytes : (bytes / 1024 ** power).toFixed(1)} ${units[power]}`;
};

/** The smaller panel that opens beside a row, lined up with its top. */
function SidePanel({ children, widthClassName = 'w-72' }: { children: ReactNode; widthClassName?: string }) {
  return (
    <div
      role="menu"
      className={`enter-blur-fast smooth absolute top-0 left-full ml-5 flex ${widthClassName} flex-col gap-1.5 rounded-[28px] border border-zinc-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)]`}
    >
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col px-3.5 py-1">
      <span className="text-[13px] tracking-tight text-zinc-500">{label}</span>
      <span className="text-[15px] font-[460] tracking-tight break-words text-zinc-900">{value}</span>
    </div>
  );
}

function OutlineButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 shrink-0 cursor-pointer rounded-full border border-[#9572FF]/50 px-3.5 text-[13px] font-[500] tracking-tight text-(--chrome-link) transition-[background-color,transform] duration-150 ease-out enabled:hover:bg-[#9572FF]/10 enabled:active:scale-95 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-[13px] font-[500] tracking-tight text-zinc-500">{children}</h3>
);

/** Like a browser's site settings page: what the site stores, and what it's allowed to use. */
function SiteSettings({ info, close }: { info: SiteInfo; close: () => void }) {
  const [permissions, setPermissions] = useState(info.permissions);
  // A page keeps what it was already given until it reloads, so offer a reload after any change.
  const [changed, setChanged] = useState(false);

  const apply = (request: Promise<SitePermission[]> | undefined) => {
    void request
      ?.then((next) => {
        setPermissions(next);
        setChanged(true);
      })
      .catch((error: unknown) => console.error('Could not change site permissions:', error));
  };

  const usage = [
    info.storageBytes !== null && formatBytes(info.storageBytes),
    `${info.cookieCount} ${info.cookieCount === 1 ? 'cookie' : 'cookies'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3 px-2 py-1">
      <h2 className="text-[17px] font-[560] tracking-tight break-words text-zinc-900">{info.host}</h2>

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Usage</SectionHeading>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[15px] font-[460] tracking-tight text-zinc-900">{usage}</span>
          <OutlineButton
            onClick={() => {
              close();
              void browser?.clearSiteData();
            }}
          >
            Delete data
          </OutlineButton>
        </div>
      </section>

      <MenuDivider />

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <SectionHeading>Permissions</SectionHeading>
          </span>
          <OutlineButton
            disabled={permissions.every(({ setting }) => setting === 'block')}
            onClick={() => apply(browser?.resetSitePermissions())}
          >
            Reset permissions
          </OutlineButton>
        </div>

        {permissions.map(({ kind, setting }) => {
          const { label, icon: Icon } = PERMISSION_ROWS[kind];

          return (
            <label key={kind} className="flex h-10 items-center gap-2.5 text-[15px] font-[460] tracking-tight">
              <Icon size={18} strokeWidth={1.75} className="text-zinc-500" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              <span className="relative">
                <select
                  value={setting}
                  onChange={(event) =>
                    apply(browser?.setSitePermission(kind, event.target.value as SitePermission['setting']))
                  }
                  className="smooth h-9 w-36 cursor-pointer appearance-none rounded-[12px] border border-zinc-200 bg-white pr-8 pl-3 text-[14px] text-zinc-800 transition-colors hover:border-zinc-300 focus:border-[#9572FF]/60 focus:outline-none"
                >
                  <option value="block">Block (default)</option>
                  <option value="allow">Allow</option>
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500"
                  aria-hidden="true"
                />
              </span>
            </label>
          );
        })}

        {changed && (
          <div className="mt-1 flex items-center gap-3">
            <p className="flex-1 text-[13px] leading-snug tracking-tight text-zinc-500">
              Reload the page to apply your changes.
            </p>
            <OutlineButton
              onClick={() => {
                close();
                void browser?.reload();
              }}
            >
              Reload
            </OutlineButton>
          </div>
        )}
      </section>
    </div>
  );
}

function ConnectionBanner({ info }: { info: SiteInfo }) {
  if (info.secure) {
    return (
      <div className="smooth flex h-10 items-center gap-2 rounded-[16px] bg-emerald-50 px-3.5 text-[15px] font-[460] tracking-tight text-emerald-700">
        <LockKeyhole size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">Connection is secure</span>
        <Check size={18} strokeWidth={2} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="smooth flex flex-col gap-1 rounded-[16px] bg-red-50 px-3.5 py-2.5 text-red-700">
      <div className="flex items-center gap-2 text-[15px] font-[460] tracking-tight">
        <LockKeyholeOpen size={20} strokeWidth={1.75} aria-hidden="true" />
        Connection is not secure
      </div>
      <p className="text-[13px] leading-snug tracking-tight">
        Don't type passwords or card numbers on {info.host}.
      </p>
    </div>
  );
}

function SiteInfoPanel({ close }: { close: () => void }) {
  // Undefined while loading; null when there's no website to describe.
  const [info, setInfo] = useState<SiteInfo | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState<Section | null>(null);

  useEffect(() => {
    let live = true;

    browser
      ?.getSiteInfo()
      .then((result) => live && setInfo(result))
      .catch((error: unknown) => {
        console.error('Could not load site information:', error);

        if (live) {
          setFailed(true);
        }
      });

    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return <Note>Couldn't load information about this site. Try reloading the page.</Note>;
  }

  if (info === undefined) {
    return <div className="h-10" aria-busy="true" />;
  }

  if (info === null) {
    return <Note>There's no website open in this tab.</Note>;
  }

  const toggle = (next: Section) => () => setSection((current) => (current === next ? null : next));

  // One row of the panel; its side panel opens beside it.
  const row = (
    id: Section,
    item: Omit<Parameters<typeof MenuItem>[0], 'expanded' | 'onClick'>,
    panel: ReactNode,
    panelWidth?: string,
  ) => (
    <div className="relative">
      <MenuItem {...item} expanded={section === id} onClick={toggle(id)} />
      {section === id && <SidePanel widthClassName={panelWidth}>{panel}</SidePanel>}
    </div>
  );

  return (
    <>
      <ConnectionBanner info={info} />
      <MenuDivider />
      <MenuGroup>
        {info.secure ? (
          row(
            'certificate',
            { icon: FileCheck, label: 'Certificate is valid', trailing: chevron },
            info.certificate ? (
              <>
                <Detail label="Issued to" value={info.certificate.issuedTo} />
                <Detail label="Issued by" value={info.certificate.issuedBy} />
                <Detail label="Valid until" value={formatDate(info.certificate.validUntil)} />
              </>
            ) : (
              <Note>The certificate was checked, but its details aren't available right now.</Note>
            ),
          )
        ) : (
          <MenuItem icon={FileCheck} label="No valid certificate" disabled />
        )}

        {row(
          'cookies',
          {
            icon: Cookie,
            label: 'Cookies and site data',
            trailing: (
              <>
                <span className="text-[13px] text-zinc-500">{info.cookieCount}</span>
                {chevron}
              </>
            ),
          },
          <>
            <Detail
              label={info.host}
              value={`${info.cookieCount} ${info.cookieCount === 1 ? 'cookie' : 'cookies'} in use`}
            />
            <Note>Sites use cookies to keep you signed in and remember your choices.</Note>
            <MenuDivider />
            <MenuItem
              icon={Trash2}
              label="Delete site data"
              danger
              onClick={() => {
                close();
                void browser?.clearSiteData();
              }}
            />
            <Note>You'll be signed out of this site.</Note>
          </>,
        )}

        {row(
          'settings',
          { icon: Settings, label: 'Site settings', trailing: chevron },
          <SiteSettings info={info} close={close} />,
          'w-[23rem]',
        )}
      </MenuGroup>
    </>
  );
}

/** The button at the left of the address bar and its panel: connection, certificate, cookies, permissions. */
function SiteInfoMenu({
  visible,
  armed,
  onMouseDown,
}: {
  visible: boolean;
  /** Hit target stays active while the icon is faded, so the field underneath never receives the press. */
  armed: boolean;
  onMouseDown: () => void;
}) {
  return (
    <DropdownMenu
      align="left"
      widthClassName="w-80"
      onOpenChange={handleOpenChange}
      className={`absolute inset-y-0 left-0 z-10 flex w-9 ${armed ? '' : 'pointer-events-none'}`}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label="Site information"
          title="Site information"
          aria-haspopup="menu"
          aria-expanded={open}
          tabIndex={visible ? 0 : -1}
          aria-hidden={!visible}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMouseDown();
          }}
          onClick={toggle}
          className={`group flex h-full w-full items-center justify-center text-zinc-500 transition-opacity duration-200 ease-out ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-[background-color,color,transform] duration-200 ease-out group-hover:bg-zinc-200/80 group-hover:text-zinc-900 group-active:scale-90 ${
              open ? 'bg-zinc-200/80 text-zinc-900' : ''
            }`}
          >
            <Settings2 size={15} aria-hidden="true" />
          </span>
        </button>
      )}
    >
      {(close) => <SiteInfoPanel close={close} />}
    </DropdownMenu>
  );
}

export default SiteInfoMenu;
