import { LocateFixed, LocateOff, Loader2 } from '@shared/icons'

import { fixQuality } from '@/lib/bestFix'

/**
 * How precisely the console knows where this officer is, stated on the map.
 *
 * ── WHY THE CONSOLE SHOULD SAY THIS OUT LOUD ───────────────────────────────
 * Everything else on this page reports a position only by DRAWING one. A dot
 * on the map is the same picture whether it came from a 6 m satellite lock or
 * a 120 m Wi-Fi scan. An officer comparing their laptop against their phone
 * had nothing to compare except two dots in different places. So the number
 * the browser itself reported is said in words.
 *
 * ── TWO VERDICTS, AND THE NUMBER (2026-10-17) ──────────────────────────────
 *   High precision · GPS ±8 m             green  — at or under PRECISE_FIX_M
 *   Low precision · Wi-Fi estimate ±122 m amber  — anything wider
 *
 * It used to be a quiet grey "GPS locked" for anything under 100 m, which
 * called a ±95 m Wi-Fi scan a lock. The line is now PRECISE_FIX_M (30 m), the
 * same one that decides which of an officer's devices owns their published
 * position, so the badge and that rule cannot disagree.
 *
 * ── WHERE THE FIX CAME FROM ────────────────────────────────────────────────
 * On a laptop the position may be the officer's PHONE's, picked over the
 * laptop's own estimate (pickBestFix) — the laptop has then stopped publishing
 * its own (shouldDeferPublish). "from your phone" says so, because otherwise a
 * laptop with no GPS chip would appear to claim GPS precision.
 *
 * The phone hint appears only when the coarse fix is THIS device's own and
 * this device is not a phone — telling someone already on their phone to open
 * the console on their phone is noise.
 */
export default function GpsLockBadge({ mode, locationError, fix, source = 'this-device', onMobile = false }) {
  // Off duty is not a fault and not a state worth a chip: telemetry is gated
  // on an open shift by design, so there is nothing here to report on.
  if (mode === 'off') return null

  /**
   * ── A FIX IN HAND OUTRANKS A STALE ERROR ────────────────────────────────
   * One failed reading must not label a device that is, at this moment,
   * delivering coordinates as "blocked".
   */
  const blocked = !fix && locationError === 'location-denied'
  const { tier, accuracy } = fixQuality(fix)
  const fromOther = Boolean(fix) && source === 'other-device'

  let Icon = Loader2
  let text = 'Finding your position…'
  let tone = 'text-text-secondary'
  let spin = true
  let hint = null

  if (blocked) {
    Icon = LocateOff
    text = 'Location blocked'
    tone = 'text-warning'
    spin = false
  } else if (fix) {
    Icon = LocateFixed
    spin = false
    if (tier === 'precise') {
      text = `High precision · GPS ±${accuracy} m${fromOther ? ' · from your phone' : ''}`
      tone = 'text-success'
    } else if (tier === 'coarse') {
      text = `Low precision · Wi-Fi estimate ±${accuracy} m`
      tone = 'text-warning'
      if (!fromOther && !onMobile) hint = 'For GPS precision, open this console on your phone too.'
    } else {
      // A fix with no stated radius: a position, but nothing honest to grade.
      text = 'Position found · accuracy not reported'
    }
  }

  return (
    <div className="pointer-events-none flex flex-col items-center gap-1" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-base-850/95 px-2.5 py-1 shadow-overlay">
        <Icon size="sm" aria-hidden="true" className={`shrink-0 ${tone} ${spin ? 'animate-spin' : ''}`} />
        <span className={`whitespace-nowrap text-2xs font-medium tabular-nums ${tone}`}>{text}</span>
      </div>
      {hint ? (
        <span className="rounded-full bg-base-850/90 px-2.5 py-0.5 text-2xs text-text-secondary shadow-overlay">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
