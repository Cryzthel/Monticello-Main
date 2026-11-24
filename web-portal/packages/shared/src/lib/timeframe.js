export const TIMEFRAME_PRESETS = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: 'all', label: 'All', days: null },
  { key: 'custom', label: 'Custom', days: null },
]

/**
 * Resolves a timeframe selection to `{ from, to }` Dates, or nulls for "any".
 *
 * Exported separately from the control so a caller can filter without
 * rendering, and so the boundary arithmetic — which is the part that is easy to
 * get subtly wrong — lives in one testable place.
 *
 * The custom `to` is pushed to the END of its day. A date input yields midnight,
 * so a range ending "today" would otherwise exclude everything that happened
 * today, which reads as the filter being broken rather than exclusive.
 */
export function resolveTimeframe({ preset, from, to }) {
  if (preset === 'custom') {
    const start = from ? new Date(`${from}T00:00:00`) : null
    const end = to ? new Date(`${to}T23:59:59.999`) : null
    return { from: start, to: end }
  }
  const days = TIMEFRAME_PRESETS.find((p) => p.key === preset)?.days ?? null
  if (days == null) return { from: null, to: null }
  return { from: new Date(Date.now() - days * 24 * 60 * 60 * 1000), to: null }
}

export function withinTimeframe(value, range) {
  if (!range.from && !range.to) return true
  if (!value) return false
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return false
  if (range.from && at < range.from.getTime()) return false
  if (range.to && at > range.to.getTime()) return false
  return true
}
