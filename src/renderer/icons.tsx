import {
  forwardRef,
  useId,
  type ComponentProps,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowRightDoubleIcon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Bookmark01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CookieIcon,
  Copy01Icon,
  DashboardSpeed02Icon,
  Delete02Icon,
  DragDropIcon,
  FileValidationIcon,
  FilterHorizontalIcon,
  Globe02Icon,
  HardDriveIcon,
  HistoryIcon,
  InformationCircleIcon,
  Location01Icon,
  Logout05Icon,
  Mail01Icon,
  MessageMultiple01Icon,
  Mic01Icon,
  MinusSignIcon,
  MoreVerticalIcon,
  Notification01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Refresh01Icon,
  Search01Icon,
  Settings01Icon,
  SlidersHorizontalIcon,
  SquareIcon,
  SquareLock01Icon,
  SquareLock02Icon,
  SquareUnlock01Icon,
  SquareUnlock02Icon,
  Tick02Icon,
  Undo02Icon,
  Video01Icon,
  ViewIcon,
  ViewOffSlashIcon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from '@hugeicons/core-free-icons';

// Browsie's icons: Hugeicons, Stroke Rounded (the free set). Each export keeps the name the app used
// before (when it was on Lucide), so call sites read the same; the Hugeicons icon it draws is beside it.

type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, 'icon' | 'ref'>;
export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

// Hugeicons ship at a 1.5 stroke, which reads too thin in Browsie. Icons keep the weights the app used
// with Lucide instead: 2 when a call site gives none, and its own width when it does.
// Raise STROKE_SCALE above 1 to thicken every icon at once.
const STROKE_SCALE = 1.15;
const DEFAULT_STROKE = 2;

const icon = (data: IconSvgElement, name: string): IconComponent => {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ strokeWidth = DEFAULT_STROKE, ...props }, ref) => (
    <HugeiconsIcon ref={ref} icon={data} strokeWidth={Number(strokeWidth) * STROKE_SCALE} {...props} />
  ));
  Icon.displayName = name;
  return Icon;
};

// The app's lock (SquareLock01) with its body filled, for "Lockdown is on". Hugeicons' free set has no
// solid style, so this is built from the same paths: the shackle stays a line and the keyhole is cut out.
const lockPath = (key: string) => String(SquareLock01Icon.find(([, attrs]) => attrs.key === key)?.[1].d ?? '');
const LOCK_KEYHOLE = lockPath('0');
const LOCK_SHACKLE = lockPath('1');
const LOCK_BODY = lockPath('2');

type FilledIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number };

export const LockFilled = forwardRef<SVGSVGElement, FilledIconProps>(
  ({ size = 24, strokeWidth = DEFAULT_STROKE, ...props }, ref) => {
    const maskId = `lock-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const width = Number(strokeWidth) * STROKE_SCALE;

    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
        <defs>
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" />
            <path d={LOCK_KEYHOLE} stroke="black" strokeWidth={width} strokeLinecap="round" />
          </mask>
        </defs>
        <path d={LOCK_SHACKLE} stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={LOCK_BODY}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={width}
          strokeLinejoin="round"
          mask={`url(#${maskId})`}
        />
      </svg>
    );
  },
);
LockFilled.displayName = 'LockFilled';

export const AlertCircle = icon(AlertCircleIcon, 'AlertCircle');
export const ArrowDown = icon(ArrowDown02Icon, 'ArrowDown');
export const ArrowLeft = icon(ArrowLeft02Icon, 'ArrowLeft');
export const ArrowRight = icon(ArrowRight02Icon, 'ArrowRight');
export const ArrowRightLeft = icon(ArrowDataTransferHorizontalIcon, 'ArrowRightLeft');
export const ArrowUp = icon(ArrowUp02Icon, 'ArrowUp');
export const ArrowUpRight = icon(ArrowUpRight01Icon, 'ArrowUpRight');
export const Bell = icon(Notification01Icon, 'Bell');
export const Bookmark = icon(Bookmark01Icon, 'Bookmark');
export const Calendar = icon(Calendar03Icon, 'Calendar');
export const Check = icon(Tick02Icon, 'Check');
export const ChevronDown = icon(ArrowDown01Icon, 'ChevronDown');
export const ChevronRight = icon(ArrowRight01Icon, 'ChevronRight');
export const ChevronsRight = icon(ArrowRightDoubleIcon, 'ChevronsRight');
export const Cookie = icon(CookieIcon, 'Cookie');
export const Copy = icon(Copy01Icon, 'Copy');
export const EllipsisVertical = icon(MoreVerticalIcon, 'EllipsisVertical');
export const Eye = icon(ViewIcon, 'Eye');
export const EyeOff = icon(ViewOffSlashIcon, 'EyeOff');
export const FileCheck = icon(FileValidationIcon, 'FileCheck');
export const Gauge = icon(DashboardSpeed02Icon, 'Gauge');
export const Globe = icon(Globe02Icon, 'Globe');
export const Grip = icon(DragDropIcon, 'Grip');
export const HardDrive = icon(HardDriveIcon, 'HardDrive');
export const History = icon(HistoryIcon, 'History');
export const Info = icon(InformationCircleIcon, 'Info');
export const Lock = icon(SquareLock01Icon, 'Lock');
export const LockKeyhole = icon(SquareLock02Icon, 'LockKeyhole');
export const LockKeyholeOpen = icon(SquareUnlock02Icon, 'LockKeyholeOpen');
export const LockOpen = icon(SquareUnlock01Icon, 'LockOpen');
export const LogOut = icon(Logout05Icon, 'LogOut');
export const Mail = icon(Mail01Icon, 'Mail');
export const MapPin = icon(Location01Icon, 'MapPin');
export const MessagesSquare = icon(MessageMultiple01Icon, 'MessagesSquare');
export const Mic = icon(Mic01Icon, 'Mic');
export const Minus = icon(MinusSignIcon, 'Minus');
export const Pencil = icon(PencilEdit01Icon, 'Pencil');
export const Plus = icon(PlusSignIcon, 'Plus');
export const RotateCcw = icon(Undo02Icon, 'RotateCcw');
export const RotateCw = icon(Refresh01Icon, 'RotateCw');
export const Search = icon(Search01Icon, 'Search');
export const Settings = icon(Settings01Icon, 'Settings');
export const Settings2 = icon(FilterHorizontalIcon, 'Settings2');
export const SlidersHorizontal = icon(SlidersHorizontalIcon, 'SlidersHorizontal');
export const Square = icon(SquareIcon, 'Square');
export const Trash2 = icon(Delete02Icon, 'Trash2');
export const Video = icon(Video01Icon, 'Video');
export const Volume2 = icon(VolumeHighIcon, 'Volume2');
export const VolumeX = icon(VolumeMute02Icon, 'VolumeX');
export const X = icon(Cancel01Icon, 'X');
