import { STATUS_TO_DISPLAY } from '@shared/lib/incidents'
import { categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'
import { categoryTone } from '@shared/theme/badgeStyles'
import { panicSignal } from '@shared/lib/panicStatus'

// Notification tones, matching the four circular status glyphs. `error` is
// reserved for things demanding action now (a live high-severity incident),
// not merely for failures — in a dispatch console the red ring is the
// "someone must move" signal.
export const NOTIFICATION_TONES = {
  error: 'error',
  success: 'success',
  warning: 'warning',
  info: 'info',
}

const MINUTE = 60000
const HOUR = 3600000
const DAY = 86400000

function startOfDay(time) {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Relative timestamps ("12 minutes ago", "2 hours ago", "Yesterday").
 *
 * Day boundaries are compared on the calendar date, not on elapsed hours:
 * something logged at 23:50 should read "Yesterday" at 00:10, which a
 * `< 48h -> yesterday` rule gets wrong.
 */
export function relativeTime(date, now = Date.now()) {
  if (!date) return 'Unknown time'
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime()
  if (Number.isNaN(ms)) return 'Unknown time'

  const elapsed = now - ms
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  const todayStart = startOfDay(now)
  if (ms >= todayStart) {
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const dayDelta = Math.round((todayStart - startOfDay(ms)) / DAY)
  if (dayDelta <= 1) return 'Yesterday'
  if (dayDelta < 7) return `${dayDelta} days ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * Wall-clock time ("14:32") for the card's timestamp column.
 *
 * -- WHY BOTH THIS AND relativeTime -----------------------------------------
 * They answer different questions and the structured card needs both. "3 hours
 * ago" is how a reader judges urgency at a glance; "11:04" is what they write
 * on a dispatch log or read out over the radio, and it is the only one of the
 * two that stays true once the panel has been sitting open for a while.
 *
 * `hour12: false` is deliberate rather than locale-default: this is an
 * operational log, every other timestamp in both consoles is 24-hour, and a
 * column that mixes the two cannot be scanned.
 */
export function clockTime(date) {
  if (!date) return '--:--'
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (value.toDate) return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Server-authoritative time where available: a notification claims "this
// happened", which is a statement about when the server saw it, not when the
// reporting device thought it did.
function incidentTime(incident) {
  return toDate(incident.createdAt) ?? toDate(incident.reportedAt)
}

function propertyLabelOf(data) {
  if (data.propertyLabel) return data.propertyLabel
  const { phase, block, lot } = data
  if (!phase && !block && !lot) return 'No property details submitted'
  return `Phase ${phase || '—'} • Block ${block || '—'} • Lot ${lot || '—'}`
}

function incidentTone(incident, display) {
  if (display === 'Resolved') return NOTIFICATION_TONES.success
  if (incident.priority === 'critical' || incident.priority === 'high') return NOTIFICATION_TONES.error
  if (display === 'Dispatched' || display === 'On-Site') return NOTIFICATION_TONES.info
  return NOTIFICATION_TONES.warning
}

/**
 * The headline, one line, in the operator's own words.
 *
 * -- WHY THE STATUS IS THE TITLE AND THE CATEGORY IS A BADGE -----------------
 * The old card put the category in bold and ran the status into a sentence
 * ("**Security** report at Phase 2 ... is now dispatched"). That reads as
 * prose, which is exactly wrong for a feed: the category is the field a reader
 * filters and colour-codes by, which makes it a badge, while the thing that
 * CHANGED is what the row exists to announce, so it takes the headline slot.
 *
 * 'On-Site', not 'On-Scene'. The previous table matched a display value
 * STATUS_TO_DISPLAY never produces, so an officer arriving on site fell through
 * to the generic branch and to the wrong tone.
 */
const STATUS_HEADLINES = {
  Pending: 'New report awaiting dispatch',
  Verified: 'Report verified',
  Dispatched: 'Security dispatched',
  'On-Site': 'Officer on site',
  Resolved: 'Report resolved and closed',
}

/**
 * One notification, in the shape every surface renders.
 *
 * -- THE CARD IS A RECORD, NOT A SENTENCE -----------------------------------
 * Fields are split by ROLE — badge, headline, supporting detail, place, time,
 * action — so the bell panel and the floating toast lay the same notification
 * out on the same grid instead of each re-parsing one pre-composed string.
 * That split is what makes the two surfaces alignable at all: a component
 * cannot put a timestamp in its own column if the timestamp is spliced into
 * the middle of a paragraph.
 */
export function incidentNotification(incident) {
  const display = STATUS_TO_DISPLAY[incident.status] ?? incident.status
  const category = normalizeCategory(incident.category)
  const reporter = incident.reporterName || 'a resident'

  return {
    id: `incident-${incident.id}`,
    sourceId: incident.id,
    kind: 'incident',
    tone: incidentTone(incident, display),
    category,
    categoryLabel: categoryLabel(category),
    categoryTone: categoryTone(category),
    title: STATUS_HEADLINES[display] ?? `Report ${String(display ?? 'updated').toLowerCase()}`,
    detail: display === 'Resolved' ? `Filed by ${reporter} · now closed` : `Filed by ${reporter}`,
    at: incidentTime(incident),
    priority: incident.priority ?? 'medium',
    status: display,
    propertyLabel: propertyLabelOf(incident),
    reporterName: incident.reporterName || 'Unknown resident',
    actionLabel: 'View incident',
  }
}

export function announcementNotification(announcement) {
  return {
    id: `announcement-${announcement.id}`,
    sourceId: announcement.id,
    kind: 'announcement',
    tone: NOTIFICATION_TONES.info,
    category: 'announcement',
    categoryLabel: 'Announcement',
    // Brand rather than a category hue: an announcement is the estate speaking,
    // not an incident class, so it is deliberately outside the category palette
    // the incident badges are read against.
    categoryTone: 'brand',
    title: announcement.title || 'Announcement posted',
    detail: announcement.body || 'Posted to the resident bulletin.',
    at: toDate(announcement.publishedAt),
    propertyLabel: 'Subdivision-wide',
  }
}

/**
 * Merged, newest-first notification feed.
 *
 * The bell previously listed announcements ONLY, which meant the one surface
 * literally labelled "notifications" stayed silent for the events the console
 * exists to handle. Incidents are the primary feed now; announcements merge in
 * alongside them.
 */
/**
 * A panic alert, as a notification.
 *
 * `error` tone and no audience filter: see buildNotificationFeed for why an
 * SOS is the one thing neither console is allowed to filter out.
 */
export function panicNotification(alert) {
  const signal = panicSignal(alert.status)
  return {
    id: `panic-${alert.id}`,
    sourceId: alert.id,
    kind: 'panic',
    tone: signal.live ? NOTIFICATION_TONES.error : NOTIFICATION_TONES.success,
    category: 'panic',
    categoryLabel: 'SOS',
    categoryTone: 'danger',
    title: signal.live ? 'Panic SOS alert triggered' : 'SOS alert resolved',
    detail: `${alert.residentName || 'A resident'} · ${signal.label}`,
    at: alert.createdAt instanceof Date ? alert.createdAt : toDate(alert.createdAt),
    propertyLabel: alert.propertyLabel || 'Unknown address',
    actionLabel: 'Open alert',
  }
}

/**
 * Merged, newest-first notification feed.
 *
 * ── WHO GETS TOLD WHAT ──────────────────────────────────────────────────────
 * Both consoles used to render the identical feed, which meant an administrator
 * reviewing the estate at a desk and an officer working a queue at the gate were
 * handed the same list — so each of them read past most of it to find their own
 * half. `audience` splits it:
 *
 *   admin      what ESCALATED or MOBILISED someone. High-priority reports and
 *              anything that reached a guard. A routine filing that the
 *              guardhouse absorbed without incident is not an administrator's
 *              event; it is already on the tickets page if they want it.
 *   security   the WORK QUEUE. New filings and calls in progress. A report that
 *              is closed is not an action, so it drops off.
 *
 * ── THE ONE THING NEITHER SIDE MAY FILTER ───────────────────────────────────
 * Panic alerts go to both, unconditionally. The temptation is to read "admin
 * gets high-priority security events" as permission to route SOS to the admin
 * feed alone, and that would be exactly backwards: the guardhouse is who
 * RESPONDS. The siren and modal in PanicAlertProvider are the primary channel
 * there, and this is the record of it — a second channel for the one event
 * class where a missed notification is measured in someone's safety.
 *
 * ── SELF-BROADCAST ──────────────────────────────────────────────────────────
 * An administrator who posts an announcement is not notified of their own post.
 * They were looking at the composer a second ago; telling them it worked in the
 * same surface that tells them a resident is in trouble spends the bell's
 * credibility on an echo.
 */
export function buildNotificationFeed({
  incidents = [],
  announcements = [],
  panicAlerts = [],
  audience = null,
  viewerUid = null,
  limit = 30,
} = {}) {
  const incidentItems = incidents.map(incidentNotification).filter((item) => {
    if (audience === 'admin') {
      const urgent = item.priority === 'high' || item.priority === 'critical'
      return urgent || item.status === 'Dispatched' || item.status === 'On-Site'
    }
    if (audience === 'security') return item.status !== 'Resolved'
    return true
  })

  const announcementItems = announcements
    .filter((a) => !(viewerUid && a.authorUid && a.authorUid === viewerUid))
    .map(announcementNotification)

  return [...incidentItems, ...announcementItems, ...panicAlerts.map(panicNotification)]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, limit)
}

/**
 * The feed cut into day sections — "Today", "Yesterday", then dated groups.
 *
 * -- WHY GROUP AT ALL -------------------------------------------------------
 * A flat list of relative timestamps gives a reader no way to see where the
 * current shift ends. Every row says "N hours ago", so working out whether the
 * fifth one happened this morning or last week means doing that arithmetic
 * once per row. A day header answers it once per group.
 *
 * Undated entries — a server timestamp that has not resolved yet, which is the
 * state a report is in for the first second of its life — get their own
 * leading group rather than being dropped or sorted as epoch zero. The newest
 * and most urgent row on the page is precisely the one most likely to be
 * missing its stamp.
 */
export function groupNotificationsByDay(items, now = Date.now()) {
  const todayStart = startOfDay(now)
  const groups = new Map()

  items.forEach((item) => {
    const ms = item.at?.getTime?.()
    const dated = Boolean(ms) && !Number.isNaN(ms)
    const key = dated ? String(startOfDay(ms)) : 'undated'

    if (!groups.has(key)) {
      let label = 'Just received'
      if (dated) {
        const dayStart = startOfDay(ms)
        const delta = Math.round((todayStart - dayStart) / DAY)
        label =
          delta <= 0
            ? 'Today'
            : delta === 1
              ? 'Yesterday'
              : new Date(dayStart).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
      }
      groups.set(key, { key, label, items: [] })
    }
    groups.get(key).items.push(item)
  })

  const sections = [...groups.values()]
  return [
    ...sections.filter((s) => s.key === 'undated'),
    ...sections.filter((s) => s.key !== 'undated').sort((a, b) => Number(b.key) - Number(a.key)),
  ]
}
