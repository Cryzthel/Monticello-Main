/*
 * THE ICON REGISTRY — every glyph either portal is allowed to draw.
 *
 * One file, two consoles. An icon that is not exported here does not exist as
 * far as the admin and guardhouse apps are concerned, and that is the point:
 * before this, each screen imported straight from the icon package, and
 * "shield with a warning" arrived as three different glyphs on three pages
 * because three people picked one.
 *
 * ── HOW TO READ A LINE ────────────────────────────────────────────────────
 *
 *   export const ShieldAlert = createIcon('ShieldAlert', ShieldAlertGlyph)
 *                 ^^^^^^^^^^                             ^^^^^^^^^^^^^^^^
 *                 what the app calls it                  path data, generated
 *
 * The left name is the codebase's own vocabulary and is deliberately stable.
 * It has now survived three icon-set migrations — Lucide to Hugeicons,
 * Hugeicons to Material Symbols, Material Symbols to Phosphor — without a
 * single one of the ~190 call sites across both portals changing. That is what
 * the registry is FOR: the set underneath is an implementation detail, and
 * swapping it is this file plus a codegen mapping, not a sweep of the
 * codebase. The third migration also changed the GRID the glyphs are drawn on,
 * and still touched no call site.
 *
 * ── WHERE THE GLYPHS COME FROM ────────────────────────────────────────────
 *
 * `./glyphs.js` is GENERATED — path data pulled from @phosphor-icons/core
 * (regular weight) by scripts/build-icons.mjs, which also holds the curated
 * name mapping and the reasoning behind the pairs that are easy to get wrong.
 *
 * Phosphor is the family the MOBILE app draws with, at the same major version,
 * so a glyph means the same thing on a resident's phone and an
 * administrator's screen. The weight differs on purpose — see tokens.js.
 *
 * To change which Phosphor icon a name draws, edit MAPPING in that script
 * and run `npm run build:icons`. Do not hand-edit glyphs.js, and do not add an
 * icon by pasting a path here — a glyph that bypasses the generator also
 * bypasses its viewBox and single-path assertions.
 *
 * ── ADDING AN ICON ────────────────────────────────────────────────────────
 *
 * One line in MAPPING, one line here. Keep both alphabetical. The generator
 * fails loudly if the Material name does not exist, so a typo cannot reach a
 * bundle as an invisible glyph.
 *
 * Deliberate overlaps, of which there is exactly one: AlertTriangle and
 * TriangleAlert are the old and new spellings of one icon and share `warning`.
 * Both are kept because both are still imported.
 */

import { createIcon } from './createIcon'

import {
  Activity as ActivityGlyph,
  ActivitySquare as ActivitySquareGlyph,
  AlertOctagon as AlertOctagonGlyph,
  AlertTriangle as AlertTriangleGlyph,
  AlignLeft as AlignLeftGlyph,
  Archive as ArchiveGlyph,
  ArchiveRestore as ArchiveRestoreGlyph,
  ArrowDownWideNarrow as ArrowDownWideNarrowGlyph,
  ArrowLeft as ArrowLeftGlyph,
  ArrowRight as ArrowRightGlyph,
  ArrowUp as ArrowUpGlyph,
  ArrowUpLeft as ArrowUpLeftGlyph,
  ArrowUpRight as ArrowUpRightGlyph,
  BadgeAlert as BadgeAlertGlyph,
  BadgeCheck as BadgeCheckGlyph,
  BarChart3 as BarChart3Glyph,
  Battery as BatteryGlyph,
  BatteryCharging as BatteryChargingGlyph,
  BatteryFull as BatteryFullGlyph,
  BatteryLow as BatteryLowGlyph,
  BatteryMedium as BatteryMediumGlyph,
  BatteryWarning as BatteryWarningGlyph,
  Bell as BellGlyph,
  BellRinging as BellRingingGlyph,
  BellOff as BellOffGlyph,
  Bike as BikeGlyph,
  Briefcase as BriefcaseGlyph,
  Building2 as Building2Glyph,
  Calendar as CalendarGlyph,
  Camera as CameraGlyph,
  Check as CheckGlyph,
  CheckCheck as CheckCheckGlyph,
  CheckCircle2 as CheckCircle2Glyph,
  ChevronDown as ChevronDownGlyph,
  ChevronLeft as ChevronLeftGlyph,
  ChevronRight as ChevronRightGlyph,
  Circle as CircleGlyph,
  CircleAlert as CircleAlertGlyph,
  ClipboardCheck as ClipboardCheckGlyph,
  ClipboardList as ClipboardListGlyph,
  Clock as ClockGlyph,
  CloudUpload as CloudUploadGlyph,
  Copy as CopyGlyph,
  CornerUpLeft as CornerUpLeftGlyph,
  CornerUpRight as CornerUpRightGlyph,
  Crosshair as CrosshairGlyph,
  Eye as EyeGlyph,
  EyeOff as EyeOffGlyph,
  FileClock as FileClockGlyph,
  FilePlus2 as FilePlus2Glyph,
  FileText as FileTextGlyph,
  FileType as FileTypeGlyph,
  Film as FilmGlyph,
  Flag as FlagGlyph,
  Flame as FlameGlyph,
  FlaskConical as FlaskConicalGlyph,
  Footprints as FootprintsGlyph,
  Gauge as GaugeGlyph,
  Hash as HashGlyph,
  HeartPulse as HeartPulseGlyph,
  History as HistoryGlyph,
  Home as HomeGlyph,
  IdCard as IdCardGlyph,
  ImageOff as ImageOffGlyph,
  ImagePlus as ImagePlusGlyph,
  Images as ImagesGlyph,
  Info as InfoGlyph,
  KeyRound as KeyRoundGlyph,
  Layers as LayersGlyph,
  LayoutDashboard as LayoutDashboardGlyph,
  Loader2 as Loader2Glyph,
  LocateFixed as LocateFixedGlyph,
  LocateOff as LocateOffGlyph,
  Lock as LockGlyph,
  LogIn as LogInGlyph,
  LogOut as LogOutGlyph,
  Mail as MailGlyph,
  MailCheck as MailCheckGlyph,
  Map as MapGlyph,
  MapPin as MapPinGlyph,
  MapPinCheck as MapPinCheckGlyph,
  MapPinOff as MapPinOffGlyph,
  Maximize2 as Maximize2Glyph,
  Megaphone as MegaphoneGlyph,
  Menu as MenuGlyph,
  Minimize2 as Minimize2Glyph,
  Minus as MinusGlyph,
  Monitor as MonitorGlyph,
  Moon as MoonGlyph,
  MoreHorizontal as MoreHorizontalGlyph,
  MoreVertical as MoreVerticalGlyph,
  MoveRight as MoveRightGlyph,
  Navigation as NavigationGlyph,
  PanelLeftClose as PanelLeftCloseGlyph,
  PanelLeftOpen as PanelLeftOpenGlyph,
  Pause as PauseGlyph,
  PauseCircle as PauseCircleGlyph,
  Pencil as PencilGlyph,
  Phone as PhoneGlyph,
  PhoneOff as PhoneOffGlyph,
  Pin as PinGlyph,
  PinOff as PinOffGlyph,
  Play as PlayGlyph,
  PlayCircle as PlayCircleGlyph,
  Plug as PlugGlyph,
  Plus as PlusGlyph,
  Printer as PrinterGlyph,
  Radio as RadioGlyph,
  RefreshCw as RefreshCwGlyph,
  RotateCcw as RotateCcwGlyph,
  RotateCw as RotateCwGlyph,
  Satellite as SatelliteGlyph,
  Save as SaveGlyph,
  Search as SearchGlyph,
  Send as SendGlyph,
  Settings as SettingsGlyph,
  ShieldAlert as ShieldAlertGlyph,
  ShieldCheck as ShieldCheckGlyph,
  ShieldOff as ShieldOffGlyph,
  ShieldQuestion as ShieldQuestionGlyph,
  ShieldX as ShieldXGlyph,
  Siren as SirenGlyph,
  SlidersHorizontal as SlidersHorizontalGlyph,
  Smartphone as SmartphoneGlyph,
  SquarePen as SquarePenGlyph,
  Sun as SunGlyph,
  Tags as TagsGlyph,
  Ticket as TicketGlyph,
  Timer as TimerGlyph,
  Trash as TrashGlyph,
  Trash2 as Trash2Glyph,
  TrendingDown as TrendingDownGlyph,
  TrendingUp as TrendingUpGlyph,
  TriangleAlert as TriangleAlertGlyph,
  User as UserGlyph,
  UserCheck as UserCheckGlyph,
  UserPlus as UserPlusGlyph,
  UserRound as UserRoundGlyph,
  UserRoundCheck as UserRoundCheckGlyph,
  UserRoundCog as UserRoundCogGlyph,
  UserX as UserXGlyph,
  Users as UsersGlyph,
  Volume2 as Volume2Glyph,
  Waves as WavesGlyph,
  Wrench as WrenchGlyph,
  X as XGlyph,
  Zap as ZapGlyph,
} from './glyphs'

export const Activity = /* @__PURE__ */ createIcon('Activity', ActivityGlyph)
export const ActivitySquare = /* @__PURE__ */ createIcon('ActivitySquare', ActivitySquareGlyph)
export const AlertOctagon = /* @__PURE__ */ createIcon('AlertOctagon', AlertOctagonGlyph)
export const AlertTriangle = /* @__PURE__ */ createIcon('AlertTriangle', AlertTriangleGlyph)
export const AlignLeft = /* @__PURE__ */ createIcon('AlignLeft', AlignLeftGlyph)
export const Archive = /* @__PURE__ */ createIcon('Archive', ArchiveGlyph)
export const ArchiveRestore = /* @__PURE__ */ createIcon('ArchiveRestore', ArchiveRestoreGlyph)
export const ArrowDownWideNarrow = /* @__PURE__ */ createIcon('ArrowDownWideNarrow', ArrowDownWideNarrowGlyph)
export const ArrowLeft = /* @__PURE__ */ createIcon('ArrowLeft', ArrowLeftGlyph)
export const ArrowRight = /* @__PURE__ */ createIcon('ArrowRight', ArrowRightGlyph)
export const ArrowUp = /* @__PURE__ */ createIcon('ArrowUp', ArrowUpGlyph)
export const ArrowUpLeft = /* @__PURE__ */ createIcon('ArrowUpLeft', ArrowUpLeftGlyph)
export const ArrowUpRight = /* @__PURE__ */ createIcon('ArrowUpRight', ArrowUpRightGlyph)
export const BadgeAlert = /* @__PURE__ */ createIcon('BadgeAlert', BadgeAlertGlyph)
export const BadgeCheck = /* @__PURE__ */ createIcon('BadgeCheck', BadgeCheckGlyph)
export const BarChart3 = /* @__PURE__ */ createIcon('BarChart3', BarChart3Glyph)
export const Battery = /* @__PURE__ */ createIcon('Battery', BatteryGlyph)
export const BatteryCharging = /* @__PURE__ */ createIcon('BatteryCharging', BatteryChargingGlyph)
export const BatteryFull = /* @__PURE__ */ createIcon('BatteryFull', BatteryFullGlyph)
export const BatteryLow = /* @__PURE__ */ createIcon('BatteryLow', BatteryLowGlyph)
export const BatteryMedium = /* @__PURE__ */ createIcon('BatteryMedium', BatteryMediumGlyph)
export const BatteryWarning = /* @__PURE__ */ createIcon('BatteryWarning', BatteryWarningGlyph)
export const Bell = /* @__PURE__ */ createIcon('Bell', BellGlyph)
export const BellRinging = /* @__PURE__ */ createIcon('BellRinging', BellRingingGlyph)
export const BellOff = /* @__PURE__ */ createIcon('BellOff', BellOffGlyph)
export const Bike = /* @__PURE__ */ createIcon('Bike', BikeGlyph)
export const Briefcase = /* @__PURE__ */ createIcon('Briefcase', BriefcaseGlyph)
export const Building2 = /* @__PURE__ */ createIcon('Building2', Building2Glyph)
export const Calendar = /* @__PURE__ */ createIcon('Calendar', CalendarGlyph)
export const Camera = /* @__PURE__ */ createIcon('Camera', CameraGlyph)
export const Check = /* @__PURE__ */ createIcon('Check', CheckGlyph)
export const CheckCheck = /* @__PURE__ */ createIcon('CheckCheck', CheckCheckGlyph)
export const CheckCircle2 = /* @__PURE__ */ createIcon('CheckCircle2', CheckCircle2Glyph)
export const ChevronDown = /* @__PURE__ */ createIcon('ChevronDown', ChevronDownGlyph)
export const ChevronLeft = /* @__PURE__ */ createIcon('ChevronLeft', ChevronLeftGlyph)
export const ChevronRight = /* @__PURE__ */ createIcon('ChevronRight', ChevronRightGlyph)
export const Circle = /* @__PURE__ */ createIcon('Circle', CircleGlyph)
export const CircleAlert = /* @__PURE__ */ createIcon('CircleAlert', CircleAlertGlyph)
export const ClipboardCheck = /* @__PURE__ */ createIcon('ClipboardCheck', ClipboardCheckGlyph)
export const ClipboardList = /* @__PURE__ */ createIcon('ClipboardList', ClipboardListGlyph)
export const Clock = /* @__PURE__ */ createIcon('Clock', ClockGlyph)
export const CloudUpload = /* @__PURE__ */ createIcon('CloudUpload', CloudUploadGlyph)
export const Copy = /* @__PURE__ */ createIcon('Copy', CopyGlyph)
export const CornerUpLeft = /* @__PURE__ */ createIcon('CornerUpLeft', CornerUpLeftGlyph)
export const CornerUpRight = /* @__PURE__ */ createIcon('CornerUpRight', CornerUpRightGlyph)
export const Crosshair = /* @__PURE__ */ createIcon('Crosshair', CrosshairGlyph)
export const Eye = /* @__PURE__ */ createIcon('Eye', EyeGlyph)
export const EyeOff = /* @__PURE__ */ createIcon('EyeOff', EyeOffGlyph)
export const FileClock = /* @__PURE__ */ createIcon('FileClock', FileClockGlyph)
export const FilePlus2 = /* @__PURE__ */ createIcon('FilePlus2', FilePlus2Glyph)
export const FileText = /* @__PURE__ */ createIcon('FileText', FileTextGlyph)
export const FileType = /* @__PURE__ */ createIcon('FileType', FileTypeGlyph)
export const Film = /* @__PURE__ */ createIcon('Film', FilmGlyph)
export const Flag = /* @__PURE__ */ createIcon('Flag', FlagGlyph)
export const Flame = /* @__PURE__ */ createIcon('Flame', FlameGlyph)
export const FlaskConical = /* @__PURE__ */ createIcon('FlaskConical', FlaskConicalGlyph)
export const Footprints = /* @__PURE__ */ createIcon('Footprints', FootprintsGlyph)
export const Gauge = /* @__PURE__ */ createIcon('Gauge', GaugeGlyph)
export const Hash = /* @__PURE__ */ createIcon('Hash', HashGlyph)
export const HeartPulse = /* @__PURE__ */ createIcon('HeartPulse', HeartPulseGlyph)
export const History = /* @__PURE__ */ createIcon('History', HistoryGlyph)
export const Home = /* @__PURE__ */ createIcon('Home', HomeGlyph)
export const IdCard = /* @__PURE__ */ createIcon('IdCard', IdCardGlyph)
export const ImageOff = /* @__PURE__ */ createIcon('ImageOff', ImageOffGlyph)
export const ImagePlus = /* @__PURE__ */ createIcon('ImagePlus', ImagePlusGlyph)
export const Images = /* @__PURE__ */ createIcon('Images', ImagesGlyph)
export const Info = /* @__PURE__ */ createIcon('Info', InfoGlyph)
export const KeyRound = /* @__PURE__ */ createIcon('KeyRound', KeyRoundGlyph)
export const Layers = /* @__PURE__ */ createIcon('Layers', LayersGlyph)
export const LayoutDashboard = /* @__PURE__ */ createIcon('LayoutDashboard', LayoutDashboardGlyph)
export const Loader2 = /* @__PURE__ */ createIcon('Loader2', Loader2Glyph)
export const LocateFixed = /* @__PURE__ */ createIcon('LocateFixed', LocateFixedGlyph)
export const LocateOff = /* @__PURE__ */ createIcon('LocateOff', LocateOffGlyph)
export const Lock = /* @__PURE__ */ createIcon('Lock', LockGlyph)
export const LogIn = /* @__PURE__ */ createIcon('LogIn', LogInGlyph)
export const LogOut = /* @__PURE__ */ createIcon('LogOut', LogOutGlyph)
export const Mail = /* @__PURE__ */ createIcon('Mail', MailGlyph)
export const MailCheck = /* @__PURE__ */ createIcon('MailCheck', MailCheckGlyph)
export const Map = /* @__PURE__ */ createIcon('Map', MapGlyph)
export const MapPin = /* @__PURE__ */ createIcon('MapPin', MapPinGlyph)
export const MapPinCheck = /* @__PURE__ */ createIcon('MapPinCheck', MapPinCheckGlyph)
export const MapPinOff = /* @__PURE__ */ createIcon('MapPinOff', MapPinOffGlyph)
export const Maximize2 = /* @__PURE__ */ createIcon('Maximize2', Maximize2Glyph)
export const Megaphone = /* @__PURE__ */ createIcon('Megaphone', MegaphoneGlyph)
export const Menu = /* @__PURE__ */ createIcon('Menu', MenuGlyph)
export const Minimize2 = /* @__PURE__ */ createIcon('Minimize2', Minimize2Glyph)
export const Minus = /* @__PURE__ */ createIcon('Minus', MinusGlyph)
export const Monitor = /* @__PURE__ */ createIcon('Monitor', MonitorGlyph)
export const Moon = /* @__PURE__ */ createIcon('Moon', MoonGlyph)
export const MoreHorizontal = /* @__PURE__ */ createIcon('MoreHorizontal', MoreHorizontalGlyph)
export const MoreVertical = /* @__PURE__ */ createIcon('MoreVertical', MoreVerticalGlyph)
export const MoveRight = /* @__PURE__ */ createIcon('MoveRight', MoveRightGlyph)
export const Navigation = /* @__PURE__ */ createIcon('Navigation', NavigationGlyph)
export const PanelLeftClose = /* @__PURE__ */ createIcon('PanelLeftClose', PanelLeftCloseGlyph)
export const PanelLeftOpen = /* @__PURE__ */ createIcon('PanelLeftOpen', PanelLeftOpenGlyph)
export const Pause = /* @__PURE__ */ createIcon('Pause', PauseGlyph)
export const PauseCircle = /* @__PURE__ */ createIcon('PauseCircle', PauseCircleGlyph)
export const Pencil = /* @__PURE__ */ createIcon('Pencil', PencilGlyph)
export const Phone = /* @__PURE__ */ createIcon('Phone', PhoneGlyph)
export const PhoneOff = /* @__PURE__ */ createIcon('PhoneOff', PhoneOffGlyph)
export const Pin = /* @__PURE__ */ createIcon('Pin', PinGlyph)
export const PinOff = /* @__PURE__ */ createIcon('PinOff', PinOffGlyph)
export const Play = /* @__PURE__ */ createIcon('Play', PlayGlyph)
export const PlayCircle = /* @__PURE__ */ createIcon('PlayCircle', PlayCircleGlyph)
export const Plug = /* @__PURE__ */ createIcon('Plug', PlugGlyph)
export const Plus = /* @__PURE__ */ createIcon('Plus', PlusGlyph)
export const Printer = /* @__PURE__ */ createIcon('Printer', PrinterGlyph)
export const Radio = /* @__PURE__ */ createIcon('Radio', RadioGlyph)
export const RefreshCw = /* @__PURE__ */ createIcon('RefreshCw', RefreshCwGlyph)
export const RotateCcw = /* @__PURE__ */ createIcon('RotateCcw', RotateCcwGlyph)
export const RotateCw = /* @__PURE__ */ createIcon('RotateCw', RotateCwGlyph)
export const Satellite = /* @__PURE__ */ createIcon('Satellite', SatelliteGlyph)
export const Save = /* @__PURE__ */ createIcon('Save', SaveGlyph)
export const Search = /* @__PURE__ */ createIcon('Search', SearchGlyph)
export const Send = /* @__PURE__ */ createIcon('Send', SendGlyph)
export const Settings = /* @__PURE__ */ createIcon('Settings', SettingsGlyph)
export const ShieldAlert = /* @__PURE__ */ createIcon('ShieldAlert', ShieldAlertGlyph)
export const ShieldCheck = /* @__PURE__ */ createIcon('ShieldCheck', ShieldCheckGlyph)
export const ShieldOff = /* @__PURE__ */ createIcon('ShieldOff', ShieldOffGlyph)
export const ShieldQuestion = /* @__PURE__ */ createIcon('ShieldQuestion', ShieldQuestionGlyph)
export const ShieldX = /* @__PURE__ */ createIcon('ShieldX', ShieldXGlyph)
export const Siren = /* @__PURE__ */ createIcon('Siren', SirenGlyph)
export const SlidersHorizontal = /* @__PURE__ */ createIcon('SlidersHorizontal', SlidersHorizontalGlyph)
export const Smartphone = /* @__PURE__ */ createIcon('Smartphone', SmartphoneGlyph)
export const SquarePen = /* @__PURE__ */ createIcon('SquarePen', SquarePenGlyph)
export const Sun = /* @__PURE__ */ createIcon('Sun', SunGlyph)
export const Tags = /* @__PURE__ */ createIcon('Tags', TagsGlyph)
export const Ticket = /* @__PURE__ */ createIcon('Ticket', TicketGlyph)
export const Timer = /* @__PURE__ */ createIcon('Timer', TimerGlyph)
export const Trash = /* @__PURE__ */ createIcon('Trash', TrashGlyph)
export const Trash2 = /* @__PURE__ */ createIcon('Trash2', Trash2Glyph)
export const TrendingDown = /* @__PURE__ */ createIcon('TrendingDown', TrendingDownGlyph)
export const TrendingUp = /* @__PURE__ */ createIcon('TrendingUp', TrendingUpGlyph)
export const TriangleAlert = /* @__PURE__ */ createIcon('TriangleAlert', TriangleAlertGlyph)
export const User = /* @__PURE__ */ createIcon('User', UserGlyph)
export const UserCheck = /* @__PURE__ */ createIcon('UserCheck', UserCheckGlyph)
export const UserPlus = /* @__PURE__ */ createIcon('UserPlus', UserPlusGlyph)
export const UserRound = /* @__PURE__ */ createIcon('UserRound', UserRoundGlyph)
export const UserRoundCheck = /* @__PURE__ */ createIcon('UserRoundCheck', UserRoundCheckGlyph)
export const UserRoundCog = /* @__PURE__ */ createIcon('UserRoundCog', UserRoundCogGlyph)
export const UserX = /* @__PURE__ */ createIcon('UserX', UserXGlyph)
export const Users = /* @__PURE__ */ createIcon('Users', UsersGlyph)
export const Volume2 = /* @__PURE__ */ createIcon('Volume2', Volume2Glyph)
export const Waves = /* @__PURE__ */ createIcon('Waves', WavesGlyph)
export const Wrench = /* @__PURE__ */ createIcon('Wrench', WrenchGlyph)
export const X = /* @__PURE__ */ createIcon('X', XGlyph)
export const Zap = /* @__PURE__ */ createIcon('Zap', ZapGlyph)
