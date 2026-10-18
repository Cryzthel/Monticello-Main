/**
 * Every date both consoles show, in one of five shapes.
 *
 *   formatDate             Oct 17, 2026
 *   formatDateTime         Oct 17, 2026, 2:05 PM
 *   formatDateTimeSeconds  Oct 17, 2026, 2:05:09 PM   (audit-grade logs)
 *   formatTime             2:05 PM
 *   formatChartTick        Sat, Oct 17                 (chart axes)
 *   formatShortDate        Oct 17                      (dense axes, ranges)
 *
 * ── WHY A FIXED LOCALE ──────────────────────────────────────────────────────
 * These used to be ~35 independent calls. The ones passing `undefined` as the
 * locale followed the BROWSER, so `toLocaleDateString()` printed 10/17/2026 on
 * one machine and 17/10/2026 on the next — an ambiguous date on a security log
 * is a wrong date half the time. Others pinned 'en-GB' and printed
 * "17 Oct 2026 14:05", day-first and 24-hour, beside "Oct 17" on the charts.
 * The same report showed three different-looking timestamps depending on
 * which screen it was on, and the guardhouse and the admin office disagreed.
 *
 * One locale, month-first with the month spelled out, so a date can never be
 * read two ways, and 12-hour time to match the mobile app the residents use.
 *
 * NOT FOR: `<input type="date">` / `datetime-local` values and file names,
 * which need ISO strings. Those keep their own formatting on purpose.
 */

const LOCALE = 'en-US'

/** The zone the subdivision ran on before it was a setting, and the fallback. */
export const DEFAULT_TIME_ZONE = 'Asia/Manila'

// Every TIMESTAMP is shown in the subdivision's own time zone, so a report time
// reads the same on any device — a laptop left on another zone no longer
// shifts it. The zone is an Admin setting (Settings › System, 2026-10-19):
// SystemSettingsSync calls setPortalTimeZone when it changes, every formatter
// below is rebuilt, and `PORTAL_TIME_ZONE` — a live binding — follows. The
// chart-axis formatters are deliberately NOT pinned: they label day buckets
// computed in local time, and pinning only the label could move it a day off
// its bucket.
export let PORTAL_TIME_ZONE = DEFAULT_TIME_ZONE

/** Whether `zone` is an IANA name this browser can format in. */
export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone) return false
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: zone })
    return true
  } catch {
    return false
  }
}

let DATE, DATE_TIME, DATE_TIME_SECONDS, TIME

function buildPinned(zone) {
  DATE = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: zone })
  DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  DATE_TIME_SECONDS = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
  TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: zone })
}
buildPinned(PORTAL_TIME_ZONE)

/**
 * Switch every pinned formatter to `zone`. Returns whether anything changed;
 * an unknown zone is ignored rather than allowed to throw inside a render.
 */
export function setPortalTimeZone(zone) {
  if (!isValidTimeZone(zone) || zone === PORTAL_TIME_ZONE) return false
  PORTAL_TIME_ZONE = zone
  buildPinned(zone)
  return true
}

/** "UTC+08:00" for `zone` at `at` — offsets move with daylight saving. */
export function timeZoneOffsetLabel(zone, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    return !part || part === 'GMT' ? 'UTC+00:00' : part.replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

/** Every zone this browser knows, for the Settings picker. */
export function listTimeZones() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [DEFAULT_TIME_ZONE]
  return zones.includes('UTC') ? zones : [...zones, 'UTC']
}

const CHART_TICK = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' })
const SHORT_DATE = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' })

const EMPTY = '—'

/** Date | epoch ms | ISO string | Firestore Timestamp → Date, or null. */
export function toDate(value) {
  if (value == null || value === '') return null
  const date =
    value instanceof Date
      ? value
      : typeof value?.toDate === 'function'
        ? value.toDate()
        : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// Takes a GETTER, not the formatter: the pinned formatters are replaced
// whenever the time zone setting changes.
const using = (format) => (value, fallback = EMPTY) => {
  const date = toDate(value)
  return date ? format().format(date) : fallback
}

export const formatDate = using(() => DATE)
export const formatDateTime = using(() => DATE_TIME)
export const formatDateTimeSeconds = using(() => DATE_TIME_SECONDS)
export const formatTime = using(() => TIME)
export const formatChartTick = using(() => CHART_TICK)
export const formatShortDate = using(() => SHORT_DATE)
