/*
 * ICON CODEGEN — turns the curated mapping below into src/icons/glyphs.js.
 *
 *   npm run build:icons
 *
 * ── WHY GENERATE, RATHER THAN IMPORT ──────────────────────────────────────
 *
 * @material-symbols/svg-400 ships 7,854 raw .svg FILES, not React components —
 * there is no `import { Home } from '@material-symbols/...'` to write. The
 * three ways to get them into a bundle are a Vite SVG plugin, a runtime fetch,
 * or this: read the handful we actually use at build time and emit their path
 * data as a plain module.
 *
 * This one is chosen because it keeps the icon set a BUILD-time dependency and
 * nothing more. `@material-symbols/svg-400` is a devDependency; no icon code
 * ships from node_modules, there is no runtime library, and the 146 glyphs we
 * draw cost ~44KB of path strings instead of a 7,854-file package. It is also
 * what keeps `Icon.glyph` working — the Mapbox transport markers need raw `d`
 * data, and a plugin that hands back a React component cannot give them that.
 *
 * The generated file is COMMITTED. A clean checkout builds without running
 * this, and a reviewer sees the glyph data change in the diff when someone
 * remaps an icon.
 *
 * ── WHY THE MAPPING IS CURATED, NOT GENERATED ─────────────────────────────
 *
 * Material's names are not the codebase's names, and the obvious guesses
 * collide in ways that matter in a security console. The pairs that have to
 * stay DISTINCT, and did not under a naive mapping:
 *
 *   ShieldOff  -> remove_moderator   "disabled"  }  both are `gpp_bad`
 *   ShieldX    -> gpp_bad            "rejected"  }  if you let the names guess
 *
 *   UserCheck      -> how_to_reg     }  one is "approve this person",
 *   UserRoundCheck -> person_check   }  the other is "person, verified"
 *
 *   ChevronLeft -> keyboard_arrow_left   a caret
 *   ArrowLeft   -> arrow_back            a true arrow with a shaft
 *
 *   Phone      -> call     a handset
 *   Smartphone -> mobile   a device
 *
 * Exactly one overlap is deliberate: AlertTriangle and TriangleAlert are the
 * old and new spellings of one icon and share `warning`. Both are still
 * imported, so both are kept.
 *
 * Three names needed a second look because the obvious Material name does not
 * exist in this package: there is no `smartphone` (it is `mobile`), no
 * `push_pin` (it is `keep`, which pairs with the `keep_off` we already use for
 * PinOff), and no `battery_std`. `Battery` draws the UNKNOWN state in the
 * dispatch rail — "Battery n/a" — so it maps to `battery_unknown`, which says
 * the same thing the label does.
 *
 * ── THE BATTERY LADDER IS ONE FAMILY ──────────────────────────────────────
 *
 * BatteryLow / BatteryMedium / BatteryFull are `battery_2_bar`, `_4_bar` and
 * `_6_bar`, and the last one is deliberately NOT `battery_full`.
 *
 * `BatteryIndicator` in the Guardhouse swaps these three through a SINGLE slot
 * as a handset discharges, so they are read as one picture changing rather
 * than as three icons. Material draws `battery_N_bar` as an outline with N
 * segments and `battery_full` as a different, solid drawing — so the old
 * mapping stepped 2_bar → 4_bar → a shape from another family, and the glyph
 * visibly jumped at the top of the scale. Measured: `battery_full` inks 95% of
 * its box against a 37% median across this registry.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SVG_DIR = join(here, '..', 'node_modules', '@material-symbols', 'svg-400', 'rounded')
const OUT = join(here, '..', 'packages', 'shared', 'src', 'icons', 'glyphs.js')

/** The codebase's name -> the Material Symbols file name (rounded, FILL=0). */
const MAPPING = {
  Activity: "vital_signs",
  ActivitySquare: "monitor_heart",
  AlertOctagon: "report",
  AlertTriangle: "warning",
  AlignLeft: "format_align_left",
  Archive: "archive",
  ArchiveRestore: "unarchive",
  ArrowDownWideNarrow: "sort",
  ArrowLeft: "arrow_back",
  ArrowRight: "arrow_forward",
  ArrowUp: "arrow_upward",
  ArrowUpLeft: "north_west",
  ArrowUpRight: "north_east",
  BadgeAlert: "release_alert",
  BadgeCheck: "verified",
  BarChart3: "bar_chart",
  Battery: "battery_unknown",
  BatteryCharging: "battery_charging_full",
  BatteryFull: "battery_6_bar",
  BatteryLow: "battery_2_bar",
  BatteryMedium: "battery_4_bar",
  BatteryWarning: "battery_alert",
  Bell: "notifications",
  BellRinging: "notifications_active",
  BellOff: "notifications_off",
  Bike: "directions_bike",
  Briefcase: "work",
  Building2: "apartment",
  Calendar: "calendar_today",
  Camera: "photo_camera",
  Check: "check",
  CheckCheck: "done_all",
  CheckCircle2: "check_circle",
  ChevronDown: "keyboard_arrow_down",
  ChevronLeft: "keyboard_arrow_left",
  ChevronRight: "keyboard_arrow_right",
  Circle: "circle",
  CircleAlert: "error",
  ClipboardCheck: "assignment_turned_in",
  ClipboardList: "assignment",
  Clock: "schedule",
  CloudUpload: "cloud_upload",
  Copy: "content_copy",
  CornerUpLeft: "turn_left",
  CornerUpRight: "turn_right",
  Crosshair: "point_scan",
  Eye: "visibility",
  EyeOff: "visibility_off",
  FileClock: "pending_actions",
  FilePlus2: "note_add",
  FileText: "description",
  FileType: "text_snippet",
  Film: "movie",
  Flag: "flag",
  Flame: "local_fire_department",
  FlaskConical: "science",
  Footprints: "directions_walk",
  Gauge: "speed",
  Hash: "tag",
  HeartPulse: "ecg_heart",
  History: "history",
  Home: "home",
  IdCard: "badge",
  ImageOff: "hide_image",
  ImagePlus: "add_photo_alternate",
  Images: "photo_library",
  Info: "info",
  KeyRound: "key",
  Layers: "layers",
  LayoutDashboard: "space_dashboard",
  Loader2: "progress_activity",
  LocateFixed: "my_location",
  LocateOff: "location_disabled",
  Lock: "lock",
  LogIn: "login",
  LogOut: "logout",
  Mail: "mail",
  MailCheck: "mark_email_read",
  Map: "map",
  MapPin: "location_on",
  MapPinCheck: "where_to_vote",
  MapPinOff: "location_off",
  Maximize2: "open_in_full",
  Megaphone: "campaign",
  Menu: "menu",
  Minimize2: "close_fullscreen",
  Minus: "remove",
  Monitor: "computer",
  Moon: "dark_mode",
  MoreHorizontal: "more_horiz",
  MoreVertical: "more_vert",
  MoveRight: "arrow_right_alt",
  Navigation: "navigation",
  PanelLeftClose: "left_panel_close",
  PanelLeftOpen: "left_panel_open",
  Pause: "pause",
  PauseCircle: "pause_circle",
  Pencil: "edit",
  Phone: "call",
  PhoneOff: "phone_disabled",
  Pin: "keep",
  PinOff: "keep_off",
  Play: "play_arrow",
  PlayCircle: "play_circle",
  Plug: "power",
  Plus: "add",
  Printer: "print",
  Radio: "cell_tower",
  RefreshCw: "refresh",
  RotateCcw: "rotate_left",
  RotateCw: "rotate_right",
  Satellite: "satellite_alt",
  Save: "save",
  Search: "search",
  Send: "send",
  Settings: "settings",
  ShieldAlert: "privacy_tip",
  ShieldCheck: "verified_user",
  ShieldOff: "remove_moderator",
  ShieldQuestion: "gpp_maybe",
  ShieldX: "gpp_bad",
  Siren: "siren",
  SlidersHorizontal: "tune",
  Smartphone: "mobile",
  SquarePen: "edit_square",
  Sun: "light_mode",
  Tags: "sell",
  Ticket: "confirmation_number",
  Timer: "timer",
  Trash: "delete",
  Trash2: "delete_forever",
  TrendingDown: "trending_down",
  TrendingUp: "trending_up",
  TriangleAlert: "warning",
  User: "person",
  UserCheck: "how_to_reg",
  UserPlus: "person_add",
  UserRound: "account_circle",
  UserRoundCheck: "person_check",
  UserRoundCog: "manage_accounts",
  UserX: "person_remove",
  Users: "group",
  Volume2: "volume_up",
  Waves: "waves",
  Wrench: "build",
  X: "close",
  Zap: "bolt",}

const missing = Object.entries(MAPPING).filter(([, file]) => !existsSync(join(SVG_DIR, `${file}.svg`)))
if (missing.length) {
  console.error('Missing Material Symbols:')
  missing.forEach(([name, file]) => console.error(`  ${name} -> ${file}.svg`))
  process.exit(1)
}

/*
 * ── OUTLINED ONLY, ENFORCED ───────────────────────────────────────────────
 *
 * The house style is one icon style, and "one style" is a property that decays
 * silently: @material-symbols/svg-400 ships a `-fill` twin of nearly every
 * glyph in this very directory, so `notifications-fill` is a one-character
 * edit away from `notifications` and renders as a solid bell among 145
 * unfilled ones. Nothing downstream would complain — it is a valid file with
 * valid path data on the right grid.
 *
 * SVG_DIR already pins the STYLE axis (rounded) and the WEIGHT axis (svg-400).
 * This pins the FILL axis, which is the only one left that a mapping entry can
 * change on its own. Together they are `FILL=0, wght=400, opsz=24`, asserted
 * rather than assumed.
 */
const filled = Object.entries(MAPPING).filter(([, file]) => file.endsWith('-fill'))
if (filled.length) {
  console.error('Filled variants are not allowed — the icon set is Rounded, FILL=0:')
  filled.forEach(([name, file]) => console.error(`  ${name} -> ${file}.svg (use "${file.slice(0, -5)}")`))
  process.exit(1)
}

/*
 * Every icon in this set is a single <path> on the same viewBox, which the
 * check below ENFORCES rather than assumes. If Google ever ships one of our
 * 146 as two paths or on a different grid, this fails loudly here instead of
 * rendering a silently clipped glyph in production.
 */
const VIEW_BOX = '0 -960 960 960'
const entries = Object.entries(MAPPING).map(([name, file]) => {
  const svg = readFileSync(join(SVG_DIR, `${file}.svg`), 'utf8')

  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  if (viewBox !== VIEW_BOX) throw new Error(`${name} (${file}): viewBox "${viewBox}" is not "${VIEW_BOX}"`)

  const paths = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1])
  if (paths.length !== 1) throw new Error(`${name} (${file}): expected 1 path, found ${paths.length}`)

  return [name, file, paths[0]]
})

const body = entries.map(([name, file, d]) => `/** Material Symbols \`${file}\` */\nexport const ${name} = '${d}'`).join('\n\n')

writeFileSync(
  OUT,
  `/*
 * GENERATED by scripts/build-icons.mjs — do not edit by hand.
 *
 * Path data for the ${entries.length} Material Symbols both portals draw, taken from
 * @material-symbols/svg-400 (Rounded, FILL=0 wght=400 GRAD=0 opsz=24).
 *
 * One named export per glyph so Rollup can drop the ones a given bundle never
 * references. Every path is on the ${VIEW_BOX} grid Material Symbols use —
 * see VIEW_BOX in shared/src/icons/tokens.js, which is what draws them.
 *
 * To change an icon, edit MAPPING in scripts/build-icons.mjs and re-run
 * \`npm run build:icons\`.
 */

${body}
`,
  'utf8',
)

console.log(`icons: wrote ${entries.length} glyphs to ${OUT}`)
