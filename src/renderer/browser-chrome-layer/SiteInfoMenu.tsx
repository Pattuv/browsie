import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  Cookie,
  FileCheck,
  LockKeyhole,
  LockKeyholeOpen,
  Settings,
  Settings2,
  Trash2,
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

/** The smaller panel that opens beside a row, lined up with its top. */
function SidePanel({ children }: { children: ReactNode }) {
  return (
    <div
      role="menu"
      className="enter-blur-fast smooth absolute top-0 left-full ml-5 flex w-72 flex-col gap-1.5 rounded-[28px] border border-zinc-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)]"
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
  const row = (id: Section, item: Omit<Parameters<typeof MenuItem>[0], 'expanded' | 'onClick'>, panel: ReactNode) => (
    <div className="relative">
      <MenuItem {...item} expanded={section === id} onClick={toggle(id)} />
      {section === id && <SidePanel>{panel}</SidePanel>}
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
          <>
            {info.permissions.map(({ label, allowed }) => (
              <div key={label} className="flex h-9 items-center px-3.5 text-[15px] font-[460] tracking-tight">
                <span className="flex-1">{label}</span>
                <span className={`text-[13px] ${allowed ? 'text-emerald-700' : 'text-zinc-500'}`}>
                  {allowed ? 'Allowed' : 'Blocked'}
                </span>
              </div>
            ))}
            <MenuDivider />
            <Note>Browsie blocks these on every website to keep you safe.</Note>
          </>,
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
