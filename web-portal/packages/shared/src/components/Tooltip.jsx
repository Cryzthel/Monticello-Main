import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Floating label for a control that has no visible text.
 *
 * Two placements, `right` (default) and `left` — no more. It began right-only
 * for the collapsed sidebar rail; the map's control toolbar sits against the
 * right edge of the viewport, where a right-placed tooltip would be clipped,
 * so `left` earned its place. Top/bottom still have no caller and are still
 * not implemented.
 *
 * Portalled into document.body for the reason every floating layer in this
 * codebase is (StatusSelect, RowActionMenu, NotificationBell, ConfirmDialog):
 * the collapsed rail is only 80px wide and its nav is `overflow-y-auto`, so an
 * inline absolutely-positioned label is clipped by the rail's own scroll
 * container before it ever clears the edge.
 *
 * NOTE: this replaces the native `title` attribute, which means it is NOT an
 * accessible name. The caller must still label the trigger itself — see the
 * `aria-label` on every collapsed nav item in CollapsibleSidebar.
 */
// Hover intent. The first label of a scan waits, so sweeping the pointer
// across the rail does not strobe tooltips; once one has shown, its
// neighbours open instantly — no delay, no entrance — for WARM_WINDOW_MS
// after it closes, the way a native toolbar behaves.
const OPEN_DELAY_MS = 300
const WARM_WINDOW_MS = 500
let lastHiddenAt = 0

export default function Tooltip({ label, hint, disabled = false, side = 'right', children }) {
  const anchorRef = useRef(null)
  const [position, setPosition] = useState(null)
  const timerRef = useRef(null)

  function show(immediate = false) {
    if (disabled || !anchorRef.current) return
    clearTimeout(timerRef.current)
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS
    if (immediate || warm) place(warm)
    else timerRef.current = setTimeout(() => place(false), OPEN_DELAY_MS)
  }

  function place(instant) {
    if (disabled || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const top = rect.top + rect.height / 2

    if (side === 'left') {
      // Anchored by its RIGHT edge so the label grows leftward away from the
      // viewport edge; anchoring by `left` would need the width measured first.
      setPosition({ top, right: window.innerWidth - rect.left + 10, instant })
      return
    }

    // Clear the whole rail, not just the row. Sidebar rows sit inside the
    // aside's own horizontal padding, so anchoring to the row's right edge
    // puts the tooltip ~17px INSIDE the sidebar, overlapping its border.
    const rail = anchorRef.current.closest('aside')
    const right = Math.max(rect.right, rail?.getBoundingClientRect().right ?? rect.right)
    setPosition({ top, left: right + 10, instant })
  }

  function hide() {
    clearTimeout(timerRef.current)
    setPosition((current) => {
      if (current) lastHiddenAt = Date.now()
      return null
    })
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // Coordinates come from a bounding rect, so they go stale the moment
  // anything moves underneath — including the sidebar's own collapse
  // animation. Dismiss rather than float out of place.
  useEffect(() => {
    if (!position) return undefined
    const dismiss = () => setPosition(null)
    window.addEventListener('scroll', dismiss, { capture: true, once: true })
    window.addEventListener('resize', dismiss, { once: true })
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true })
      window.removeEventListener('resize', dismiss)
    }
  }, [position])

  // Collapsing the rail while a tooltip is open would leave it pointing at
  // where the icon used to be.
  useEffect(() => {
    if (disabled) {
      clearTimeout(timerRef.current)
      setPosition(null)
    }
  }, [disabled])

  return (
    <>
      <div
        ref={anchorRef}
        onMouseEnter={() => show()}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
      >
        {children}
      </div>

      {position
        ? createPortal(
            <div
              role="tooltip"
              style={{ position: 'fixed', top: position.top, left: position.left, right: position.right }}
              className={`pointer-events-none z-[var(--z-popover)] -translate-y-1/2 rounded-xl border border-hairline bg-base-850 px-2.5 py-1.5 shadow-overlay ${
                position.instant
                  ? ''
                  : side === 'left'
                    ? 'animate-[tooltipInLeft_140ms_cubic-bezier(0.23,1,0.32,1)]'
                    : 'animate-[tooltipIn_140ms_cubic-bezier(0.23,1,0.32,1)]'
              }`}
            >
              <p className="whitespace-nowrap text-xs font-medium leading-tight text-text-primary">{label}</p>
              {hint ? (
                <p className="mt-0.5 whitespace-nowrap text-2xs leading-tight text-text-secondary">{hint}</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
