import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MapPin, Search, ShieldAlert, UserRound, X } from '@shared/icons'

/**
 * Pick the resident a report concerns, and bind the location fields to their
 * registered mobile profile.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 * Three free cascading dropdowns and nothing else. A guard filing about a
 * resident had to remember or ask for their Phase / Block / Lot and re-key it,
 * with no check that the combination was the one that resident actually
 * registered. Selecting the person instead makes the address a LOOKUP rather
 * than a recollection.
 *
 * ── THE OVERRIDE IS DELIBERATE, NOT A LOOPHOLE ────────────────────────────
 * Choosing a resident fills the three fields and marks them as synced; it does
 * NOT lock them. Incidents happen away from the reporter's own lot — a guard
 * called about a resident's car in someone else's driveway must be able to
 * name the person AND the real location. Editing a synced field clears the
 * synced flag (handled by the parent) so the card stops claiming the address
 * came from a profile once it no longer does.
 *
 * A resident whose profile carries no address is still listed and still
 * selectable, with the gap stated on the row. Excluding them would make the
 * picker quietly incomplete, and "this person has not verified a property" is
 * information a guard wants at exactly that moment.
 */
export default function ResidentLocationPicker({
  residents,
  loading,
  error,
  selected,
  onSelect,
  onClear,
  disabled = false,
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)
  const fieldRef = useRef(null)
  const [position, setPosition] = useState(null)

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase()
    const pool = q
      ? residents.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.label.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q),
        )
      : residents
    // Capped rather than virtualised: this list is one subdivision, and a
    // guard who cannot find someone in 40 rows should be typing, not scrolling.
    return pool.slice(0, 40)
  }, [residents, term])

  // Blur fires before the option's click, so committing the selection has to
  // outlive it by a frame. A ref rather than state — this never renders.
  //
  // The list ALSO cancels the blur itself (see `onMouseDown` on the <ul>), so
  // this timer is now only the fallback for a close that is genuinely a blur:
  // tabbing away, or clicking the page behind the list. It used to be the only
  // defence, and 120ms is a race — on a slow frame, or a tap where the click
  // trails the blur, the list closed before the option's `onClick` ever ran and
  // the guard's first click did nothing at all.
  function deferClose() {
    blurTimer.current = setTimeout(() => setOpen(false), 120)
  }
  function cancelClose() {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }

  /**
   * Measure the input and place the list against it, in viewport coordinates.
   *
   * ── WHY THIS LIST IS PORTALLED, LIKE EVERY OTHER MENU IN THE CODEBASE ─────
   * It was `absolute z-20`, and it was being CLIPPED. The composer it lives in
   * is `<Card className="… lg:overflow-y-auto">` (ReportPage) — a scroll
   * container — and per CSS an element with `overflow-y: auto` computes
   * `overflow-x: visible` to `auto`, so the card clips on both axes. The
   * resident list is the last control before the fold on a laptop, so its
   * options were cut off at the card edge no matter what z-index it carried.
   *
   * That is not a cosmetic problem here: this picker is the ONLY route to the
   * Phase/Block/Lot auto-fill. A guard who cannot see or reach the resident row
   * cannot trigger the sync, and the feature reads as "not working".
   *
   * Select, OverflowMenu, StatusControl, NotificationBell and Tooltip all
   * portal into `document.body` for exactly this reason and say so in their own
   * headers. This one was the outlier.
   */
  const place = useCallback(() => {
    const el = fieldRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 6
    const below = window.innerHeight - rect.bottom - gap
    const above = rect.top - gap
    // Flip upward when the room underneath cannot hold a usable list — the
    // composer sits low on a laptop viewport, which is precisely when a
    // downward list would open off-screen.
    const flip = below < 180 && above > below
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(flip
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
      maxHeight: Math.max(160, (flip ? above : below) - 8),
    })
  }, [])

  // Before paint, so the list never renders one frame at the wrong coordinates.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // A rect measured once goes stale the moment anything moves. The card
  // scrolls independently of the window, so both need watching — `capture`
  // catches the card's own scroll, which does not bubble to window.
  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  if (selected) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-brand-500/30 bg-brand-50 p-3">
        <span className="icon-tile icon-tile-sm mt-0.5">
          <UserRound size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{selected.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-secondary">
            <MapPin size="sm" className="shrink-0" />
            {selected.label || 'No address on their profile'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label="Clear selected resident"
          className="shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:bg-tint/10 hover:text-text-primary disabled:opacity-50"
        >
          <X size="sm" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={fieldRef}>
      <Search size="sm" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        type="text"
        className="field pl-9"
        placeholder={loading ? 'Loading residents…' : 'Search by name, address or email'}
        value={term}
        disabled={disabled || Boolean(error)}
        onChange={(event) => {
          setTerm(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={deferClose}
        /**
         * Escape closes the list, and ONLY the list.
         *
         * This picker now lives inside a dialog (FileReportModal), and that
         * dialog closes itself on a document-level Escape. Without stopping
         * the event here, dismissing a list of resident matches also threw
         * away the report being written behind it. `stopPropagation` on a
         * React handler calls through to the native event, and React's own
         * listener sits on the root container — below `document` in the
         * bubble path — so the dialog's handler never runs.
         *
         * Only while the list is open: Escape on a closed picker is the
         * guard asking to leave the dialog, and still does.
         *
         * Select solves the same problem in the capture phase because its
         * handler is a native document listener with no element to stop the
         * event at; this one has the input itself.
         */
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return
          event.stopPropagation()
          setOpen(false)
        }}
      />

      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-snug text-danger">
          <ShieldAlert size="sm" className="mt-px shrink-0" />
          Resident directory unavailable — enter the location manually below.
        </p>
      ) : null}

      {open && !error && position
        ? createPortal(
        <ul
          // `preventDefault` on mousedown is what actually fixes this: it stops
          // the press from moving focus, so the input never blurs, so no close
          // is ever scheduled. Cancelling the timer as well is belt-and-braces
          // for the case where focus moved by some other route.
          onMouseDown={(event) => {
            event.preventDefault()
            cancelClose()
          }}
          style={{ position: 'fixed', ...position }}
          className="custom-scrollbar z-[var(--z-popover)] overflow-y-auto overscroll-contain rounded-lg bg-base-850 p-1.5 shadow-overlay"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-text-muted">
              {loading ? 'Loading residents…' : 'No resident matches that search.'}
            </li>
          ) : (
            matches.map((resident) => (
              <li key={resident.uid}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(resident)
                    setTerm('')
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-nav-active"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-text-primary">{resident.name}</p>
                    <p className="truncate text-2xs text-text-muted">
                      {resident.label || 'No address registered'}
                    </p>
                  </div>
                  {resident.hasAddress ? (
                    <Check size="sm" className="shrink-0 text-brand-400" />
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>,
        document.body,
      )
        : null}
    </div>
  )
}
