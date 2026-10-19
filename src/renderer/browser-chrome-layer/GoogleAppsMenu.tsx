import DropdownMenu from '../components/DropdownMenu';
import { Grip } from 'lucide-react';
import searchIcon from '../assets/google-apps/search.png';
import gmailIcon from '../assets/google-apps/gmail.png';
import mapsIcon from '../assets/google-apps/maps.png';
import youtubeIcon from '../assets/google-apps/youtube.png';
import driveIcon from '../assets/google-apps/drive.png';
import calendarIcon from '../assets/google-apps/calendar.png';
import meetIcon from '../assets/google-apps/meet.png';
import chatIcon from '../assets/google-apps/chat.png';
import docsIcon from '../assets/google-apps/docs.png';
import sheetsIcon from '../assets/google-apps/sheets.png';
import slidesIcon from '../assets/google-apps/slides.png';
import photosIcon from '../assets/google-apps/photos.png';
import keepIcon from '../assets/google-apps/keep.png';
import formsIcon from '../assets/google-apps/forms.png';
import contactsIcon from '../assets/google-apps/contacts.png';
import translateIcon from '../assets/google-apps/translate.png';

const browser = window.browsie?.browser;

/** The main Google apps people jump to from a new tab — one flat grid, no favorites. */
const APPS: { label: string; url: string; icon: string }[] = [
  { label: 'Search', url: 'https://www.google.com', icon: searchIcon },
  { label: 'Gmail', url: 'https://mail.google.com', icon: gmailIcon },
  { label: 'Maps', url: 'https://maps.google.com', icon: mapsIcon },
  { label: 'YouTube', url: 'https://www.youtube.com', icon: youtubeIcon },
  { label: 'Drive', url: 'https://drive.google.com', icon: driveIcon },
  { label: 'Calendar', url: 'https://calendar.google.com', icon: calendarIcon },
  { label: 'Meet', url: 'https://meet.google.com', icon: meetIcon },
  { label: 'Chat', url: 'https://chat.google.com', icon: chatIcon },
  { label: 'Docs', url: 'https://docs.google.com', icon: docsIcon },
  { label: 'Sheets', url: 'https://sheets.google.com', icon: sheetsIcon },
  { label: 'Slides', url: 'https://slides.google.com', icon: slidesIcon },
  { label: 'Photos', url: 'https://photos.google.com', icon: photosIcon },
  { label: 'Keep', url: 'https://keep.google.com', icon: keepIcon },
  { label: 'Forms', url: 'https://forms.google.com', icon: formsIcon },
  { label: 'Contacts', url: 'https://contacts.google.com', icon: contactsIcon },
  { label: 'Translate', url: 'https://translate.google.com', icon: translateIcon },
];

/** The ⋮⋮⋮ waffle on the New Tab page: opens Google Workspace apps in a single slab. */
function GoogleAppsMenu() {
  return (
    <DropdownMenu
      widthClassName="w-[20.5rem]"
      align="right"
      label="Google apps"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label="Google apps"
          title="Google apps"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-900 transition-[background-color,transform] duration-150 hover:bg-zinc-100 active:scale-90 ${
            open ? 'bg-zinc-100' : ''
          }`}
        >
          <Grip size={20} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="grid max-h-[min(26rem,70vh)] grid-cols-3 gap-0.5 overflow-y-auto p-1">
          {APPS.map((app) => (
            <button
              key={app.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                void browser?.newTab(app.url);
              }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] px-2 py-3 text-zinc-800 transition-colors duration-150 hover:bg-zinc-100"
            >
              <img src={app.icon} alt="" className="h-10 w-10 object-contain" draggable={false} />
              <span className="text-center text-[12px] leading-tight tracking-tight">{app.label}</span>
            </button>
          ))}
        </div>
      )}
    </DropdownMenu>
  );
}

export default GoogleAppsMenu;
