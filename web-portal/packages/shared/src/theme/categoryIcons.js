import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Clock,
  Flame,
  HeartPulse,
  Megaphone,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Siren,
  Trash2,
  Volume2,

  Wrench,
} from '@shared/icons'
import { normalizeCategory } from '@shared/lib/incidentCategories'

/**
 * One icon per category, for every surface that shows one.
 *
 * This map lived in the guardhouse's dispatch/parts.jsx, where the drawer's
 * category tile used it. The admin tables needed the same glyphs, and a second
 * copy is how a medical call ends up as a heart in one console and a warning
 * triangle in the other — so it moved here, beside the tone and severity maps
 * it is read alongside.
 *
 * Keyed on the NORMALIZED category, so a legacy or retired key resolves the
 * same way it does everywhere else rather than falling through to the default.
 */
const INCIDENT_CATEGORY_ICONS = {
  security: ShieldAlert,
  maintenance: Wrench,
  medical: HeartPulse,
  fire: Flame,
  noise: Volume2,
  other: CircleAlert,
}

/** The icon component for an incident category. Never returns undefined. */
export function categoryIcon(category) {
  return INCIDENT_CATEGORY_ICONS[normalizeCategory(category)] ?? CircleAlert
}

/**
 * The audit log's "Category" column is a DIFFERENT vocabulary, and keeping the
 * two apart matters. An incident's category says what happened at a house —
 * fire, medical, noise. An audit event's category says what happened to a
 * RECORD — it was dispatched, resolved, published, deleted. They share a column
 * name and nothing else, so they get their own glyphs rather than a forced
 * mapping that would put a flame beside an announcement.
 *
 * The treatment is shared, which is what makes the two tables read as one
 * system: an icon of the same size, in the same badge, at the same rank.
 */
const AUDIT_EVENT_ICONS = {
  Dispatched: Siren,
  Resolved: CheckCircle2,
  Published: Megaphone,
  Deleted: Trash2,
  Settings: SlidersHorizontal,
}

/** The icon component for an audit event category. Never returns undefined. */
export function auditEventIcon(category) {
  return AUDIT_EVENT_ICONS[category] ?? CircleAlert
}

/**
 * The panic signal, as a glyph.
 *
 * Deliberately NOT in lib/panicStatus.js, whose header states it is "pure and
 * dependency-free so it can be exercised directly" — that file decides whether
 * a live emergency is presented as closed, and it stays testable without a
 * rendering dependency. The words live there; the picture lives here.
 *
 * The fallback is Siren, not a neutral glyph, and for the same reason
 * `panicSignal` falls back to `active`: an unrecognised status reads as a LIVE
 * emergency. The icon must not be the one place that quietly disagrees.
 */
const PANIC_SIGNAL_ICONS = {
  active: Siren,
  acknowledged: Radio,
  resolved: CheckCircle2,
}

/** The icon component for a panic alert's signal. Unknown reads as live. */
export function panicSignalIcon(status) {
  const key = String(status ?? '').trim().toLowerCase()
  return PANIC_SIGNAL_ICONS[key] ?? Siren
}

/** Resident verification state. */
const RESIDENT_STATUS_ICONS = {
  pending: Clock,
  verified: ShieldCheck,
  rejected: ShieldX,
}

export function residentStatusIcon(status) {
  return RESIDENT_STATUS_ICONS[String(status ?? '').trim().toLowerCase()] ?? Clock
}

/**
 * The glyph for a notification's category badge.
 *
 * Switches on `kind` rather than on the category string, because the three
 * kinds do not share a vocabulary: an incident's category is what happened at
 * a house, an announcement has none, and a panic alert is its own event. One
 * lookup table keyed on `category` would have had to hold all three and would
 * collide the moment an incident category was named "announcement".
 */
export function notificationIcon(notification) {
  if (!notification) return CircleAlert
  if (notification.kind === 'panic') return Siren
  if (notification.kind === 'announcement') return Megaphone
  return categoryIcon(notification.category)
}

/**
 * Announcement categories, keyed on the STORED value rather than the label.
 *
 * The two are deliberately different (lib/announcements.js): a document holds
 * `General`, a reader sees "Notice". Keying on the stored value is what lets
 * the wording change again without touching this map or a single document.
 *
 * Deliberately not Megaphone or Siren: those already mean "an announcement" and
 * "an SOS" elsewhere in the system, and a glyph that means two things is worse
 * than no glyph.
 */
const ANNOUNCEMENT_CATEGORY_ICONS = {
  General: Bell,
  Security: AlertTriangle,
  Maintenance: RefreshCw,
  Event: Calendar,
}

export function announcementCategoryIcon(category) {
  return ANNOUNCEMENT_CATEGORY_ICONS[category] ?? Bell
}
