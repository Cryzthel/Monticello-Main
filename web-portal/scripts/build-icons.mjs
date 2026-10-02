/*
 * ICON CODEGEN — turns the curated mapping below into src/icons/glyphs.js.
 *
 *   npm run build:icons
 *
 * ── WHY PHOSPHOR, AND WHY THE `regular` WEIGHT ────────────────────────────
 *
 * The mobile app draws its icons with phosphor_flutter 2.1.0, and the portals
 * now draw the same family from @phosphor-icons/core 2.1.1 — the same major
 * version of the same set, so a glyph means the same thing and looks the same
 * on a resident's phone and on an administrator's screen.
 *
 * Mobile leans on the FILL weight (356 of its 427 icon uses, with Bold at 61).
 * The portals use `regular`, deliberately. A filled glyph at 16px in a dense
 * table loses its counters and reads as a blob, and three successive briefs
 * have asked this codebase for outlined icons with zero filled variants. So
 * the LIBRARY is shared with mobile and the WEIGHT is chosen for the medium.
 * Changing that is one line — SVG_DIR below points at a weight directory, and
 * `bold`, `light`, `thin`, `fill` and `duotone` sit beside `regular`.
 *
 * ── WHY GENERATE, RATHER THAN IMPORT ──────────────────────────────────────
 *
 * @phosphor-icons/core ships 1,512 raw .svg FILES per weight, not React
 * components, so there is no `import { House }` to write. This reads the
 * handful we actually use at build time and emits their path data as a plain
 * module, which keeps the icon set a BUILD-time dependency: it is a
 * devDependency, no icon code ships from node_modules, and the glyphs we draw
 * cost a few kilobytes of path strings instead of a 1,512-file package.
 *
 * It is also what keeps `Icon.glyph` working. IncidentMap paints a transport
 * glyph onto a canvas for a Mapbox symbol layer and needs raw `d` data; a
 * plugin that hands back a React component cannot give it that.
 *
 * The generated file is COMMITTED. A clean checkout builds without running
 * this, and a reviewer sees the glyph data change when someone remaps an icon.
 *
 * ── WHY THE MAPPING IS CURATED, NOT GENERATED ─────────────────────────────
 *
 * Phosphor's names are not the codebase's names, and the obvious guesses
 * collide in ways that matter in a security console. The pairs that have to
 * stay DISTINCT, and did not under a naive mapping:
 *
 *   ShieldOff -> shield-slash   "disabled"   }  Phosphor has no shield-x, so
 *   ShieldX   -> x-circle       "rejected"   }  both wanted shield-slash
 *
 *   ArrowRight -> arrow-right        a plain arrow
 *   MoveRight  -> arrow-line-right   the long one that separates two values
 *
 *   ChevronLeft -> caret-left    a caret
 *   ArrowLeft   -> arrow-left    a true arrow with a shaft
 *
 * Two overlaps are deliberate and are the only ones:
 *
 *   warning   <- AlertTriangle, TriangleAlert
 *     The old and new spellings of one icon. Both are still imported.
 *
 *   gps-slash <- LocateOff, MapPinOff
 *     Phosphor ships no map-pin-slash. Both names mean "no location fix" —
 *     one is the dispatch rail's GPS status badge, the other the notice on a
 *     report that arrived without coordinates — so they share honestly rather
 *     than one of them wearing a glyph that does not say "off".
 *
 * Several names needed a second look because the obvious Phosphor name does
 * not exist: there is no `unarchive` (ArchiveRestore is `arrow-arc-left`, an
 * arc back), no `shield-question` (ShieldQuestion is `seal-question`, which
 * actually carries a question mark where `shield-chevron` carries nothing),
 * and no `settings` (it is `gear`).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SVG_DIR = join(here, '..', 'node_modules', '@phosphor-icons', 'core', 'assets', 'regular')
const OUT = join(here, '..', 'packages', 'shared', 'src', 'icons', 'glyphs.js')

/** The codebase's name -> the Phosphor file name (regular weight). */
const MAPPING = {
  Activity: "pulse",
  ActivitySquare: "chart-line",
  AlertOctagon: "warning-octagon",
  AlertTriangle: "warning",
  AlignLeft: "text-align-left",
  Archive: "archive",
  ArchiveRestore: "arrow-arc-left",
  ArrowDownWideNarrow: "sort-descending",
  ArrowLeft: "arrow-left",
  ArrowRight: "arrow-right",
  ArrowUp: "arrow-up",
  ArrowUpLeft: "arrow-up-left",
  ArrowUpRight: "arrow-up-right",
  BadgeAlert: "seal-warning",
  BadgeCheck: "seal-check",
  BarChart3: "chart-bar",
  Battery: "battery-warning",
  BatteryCharging: "battery-charging",
  BatteryFull: "battery-full",
  BatteryLow: "battery-low",
  BatteryMedium: "battery-medium",
  BatteryWarning: "battery-warning-vertical",
  Bell: "bell",
  BellRinging: "bell-ringing",
  BellOff: "bell-slash",
  Bike: "bicycle",
  Briefcase: "briefcase",
  Building2: "buildings",
  Calendar: "calendar-blank",
  Camera: "camera",
  Check: "check",
  CheckCheck: "checks",
  CheckCircle2: "check-circle",
  ChevronDown: "caret-down",
  ChevronLeft: "caret-left",
  ChevronRight: "caret-right",
  Circle: "circle",
  CircleAlert: "warning-circle",
  ClipboardCheck: "clipboard-text",
  ClipboardList: "clipboard",
  Clock: "clock",
  CloudUpload: "cloud-arrow-up",
  Copy: "copy",
  CornerUpLeft: "arrow-bend-up-left",
  CornerUpRight: "arrow-bend-up-right",
  Crosshair: "crosshair",
  Eye: "eye",
  EyeOff: "eye-slash",
  FileClock: "file-text",
  FilePlus2: "file-plus",
  FileText: "file",
  FileType: "file-txt",
  Film: "film-strip",
  Flag: "flag",
  Flame: "fire",
  FlaskConical: "flask",
  Footprints: "footprints",
  Gauge: "gauge",
  Hash: "hash",
  HeartPulse: "heartbeat",
  History: "clock-counter-clockwise",
  Home: "house",
  IdCard: "identification-card",
  ImageOff: "image-broken",
  ImagePlus: "image-square",
  Images: "images",
  Info: "info",
  KeyRound: "key",
  Layers: "stack",
  LayoutDashboard: "squares-four",
  Loader2: "spinner",
  LocateFixed: "gps-fix",
  LocateOff: "gps-slash",
  Lock: "lock",
  LogIn: "sign-in",
  LogOut: "sign-out",
  Mail: "envelope",
  MailCheck: "envelope-open",
  Map: "map-trifold",
  MapPin: "map-pin",
  MapPinCheck: "map-pin-area",
  MapPinOff: "gps-slash",
  Maximize2: "arrows-out-simple",
  Megaphone: "megaphone",
  Menu: "list",
  Minimize2: "arrows-in-simple",
  Minus: "minus",
  Monitor: "monitor",
  Moon: "moon",
  MoreHorizontal: "dots-three",
  MoreVertical: "dots-three-vertical",
  MoveRight: "arrow-line-right",
  Navigation: "navigation-arrow",
  PanelLeftClose: "sidebar-simple",
  PanelLeftOpen: "sidebar",
  Pause: "pause",
  PauseCircle: "pause-circle",
  Pencil: "pencil-simple",
  Phone: "phone",
  PhoneOff: "phone-slash",
  Pin: "push-pin",
  PinOff: "push-pin-slash",
  Play: "play",
  PlayCircle: "play-circle",
  Plug: "plug",
  Plus: "plus",
  Printer: "printer",
  Radio: "cell-tower",
  RefreshCw: "arrows-clockwise",
  RotateCcw: "arrow-counter-clockwise",
  RotateCw: "arrow-clockwise",
  Satellite: "globe-hemisphere-west",
  Save: "floppy-disk",
  Search: "magnifying-glass",
  Send: "paper-plane-tilt",
  Settings: "gear",
  ShieldAlert: "shield-warning",
  ShieldCheck: "shield-check",
  ShieldOff: "shield-slash",
  ShieldQuestion: "seal-question",
  ShieldX: "x-circle",
  Siren: "siren",
  SlidersHorizontal: "sliders-horizontal",
  Smartphone: "device-mobile",
  SquarePen: "note-pencil",
  Sun: "sun",
  Tags: "tag",
  Ticket: "ticket",
  Timer: "timer",
  Trash: "trash",
  Trash2: "trash-simple",
  TrendingDown: "trend-down",
  TrendingUp: "trend-up",
  TriangleAlert: "warning",
  User: "user",
  UserCheck: "user-check",
  UserPlus: "user-plus",
  UserRound: "user-circle",
  UserRoundCheck: "user-circle-check",
  UserRoundCog: "user-gear",
  UserX: "user-minus",
  Users: "users",
  Volume2: "speaker-high",
  Waves: "waves",
  Wrench: "wrench",
  X: "x",
  Zap: "lightning",
}

const missing = Object.entries(MAPPING).filter(([, file]) => !existsSync(join(SVG_DIR, `${file}.svg`)))
if (missing.length) {
  console.error('Missing Phosphor icons:')
  missing.forEach(([name, file]) => console.error(`  ${name} -> ${file}.svg`))
  process.exit(1)
}

/*
 * ── ONE WEIGHT, ENFORCED ──────────────────────────────────────────────────
 *
 * Phosphor separates weights by DIRECTORY, and within each one the files carry
 * a matching suffix: `house.svg` in `regular`, `house-bold.svg` in `bold`,
 * `house-fill.svg` in `fill`. SVG_DIR already pins the directory, so a mapping
 * entry cannot reach another weight by accident — but it can be written with a
 * suffix that silently does not exist, and `missing` above would then be the
 * only thing standing between a typo and a broken build.
 *
 * This says so explicitly instead: a mapping value naming a weight is wrong
 * even if a file by that name happens to exist, because the weight is SVG_DIR's
 * decision and not a per-icon one.
 */
const WEIGHTS = ['bold', 'fill', 'light', 'thin', 'duotone']
const weighted = Object.entries(MAPPING).filter(([, file]) =>
  WEIGHTS.some((w) => file.endsWith(`-${w}`)),
)
if (weighted.length) {
  console.error('Weight suffixes are not allowed — the weight is SVG_DIR, not the name:')
  weighted.forEach(([name, file]) => console.error(`  ${name} -> ${file}.svg`))
  process.exit(1)
}

/*
 * Phosphor draws every icon as a single <path> on a 256 grid with the origin
 * at the top-left — no baseline offset, unlike the set this replaced. The
 * check below ENFORCES both rather than assuming them, so a future release
 * that splits one of our glyphs into two paths fails loudly here instead of
 * rendering half an icon in production.
 */
const VIEW_BOX = '0 0 256 256'
const entries = Object.entries(MAPPING).map(([name, file]) => {
  const svg = readFileSync(join(SVG_DIR, `${file}.svg`), 'utf8')

  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  if (viewBox !== VIEW_BOX) throw new Error(`${name} (${file}): viewBox "${viewBox}" is not "${VIEW_BOX}"`)

  const paths = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1])
  if (paths.length !== 1) throw new Error(`${name} (${file}): expected 1 path, found ${paths.length}`)

  return [name, file, paths[0]]
})

const body = entries.map(([name, file, d]) => `/** Phosphor \`${file}\` */\nexport const ${name} = '${d}'`).join('\n\n')

writeFileSync(
  OUT,
  `/*
 * GENERATED by scripts/build-icons.mjs — do not edit by hand.
 *
 * Path data for the ${entries.length} Phosphor icons both portals draw, taken from
 * @phosphor-icons/core (regular weight) — the same family, at the same major
 * version, that the mobile app draws with phosphor_flutter.
 *
 * One named export per glyph so Rollup can drop the ones a given bundle never
 * references. Every path is on the ${VIEW_BOX} grid Phosphor uses — see
 * ICON_VIEW_BOX in shared/src/icons/tokens.js, which is what draws them.
 *
 * To change an icon, edit MAPPING in scripts/build-icons.mjs and re-run
 * \`npm run build:icons\`.
 */

${body}
`,
  'utf8',
)

console.log(`icons: wrote ${entries.length} glyphs to ${OUT}`)
