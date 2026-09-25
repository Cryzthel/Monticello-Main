import { useEffect } from 'react'

/**
 * Focus behaviour for a modal surface: move in, stay in, go back.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Thirteen surfaces in these two portals declared `role="dialog"`, most of
 * them with `aria-modal="true"`, and exactly one moved focus. The attribute is
 * a PROMISE to assistive technology — it says "the rest of the page is inert
 * now" — and nothing was keeping it. In practice a keyboard user opening the
 * dispatch drawer from the map kept focus behind the panel: Tab walked the
 * Mapbox canvas and the route badge before it ever reached the stage actions,
 * and closing the drawer dropped focus at the document root, with no way back
 * to the call that was just being worked. On the guardhouse console, where the
 * whole product promise is speed to the right officer, that is the difference
 * between a keyboard officer working a call and hunting for it.
 *
 * Three behaviours, which is all a dialog owes:
 *
 *   IN       On open, focus `initialRef` if one is named, else the panel
 *            itself. The panel gets `tabindex="-1"` so it can receive focus
 *            without entering the tab order.
 *   STAY     Tab and Shift+Tab cycle within the container instead of escaping
 *            behind it.
 *   BACK     On close, focus returns to whatever opened the dialog — but only
 *            if that element is still in the document, since the action that
 *            closed the dialog may well have removed the row that opened it.
 *
 * Escape is deliberately NOT handled here. Every one of these surfaces already
 * has its own Escape handler, several of which must refuse to close while a
 * write is in flight, and that is a decision only the dialog can make.
 *
 * Visibility is filtered with `offsetParent`, so a control inside a collapsed
 * section does not become a dead stop in the cycle.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus({ open, containerRef, initialRef }) {
  useEffect(() => {
    if (!open) return undefined
    const container = containerRef?.current
    if (!container) return undefined

    // Captured before anything moves, so "back" means the real opener.
    const opener = document.activeElement

    const target = initialRef?.current ?? container
    if (target === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1')
    }
    // `preventScroll` — focusing a tall panel should not also jump it.
    target?.focus?.({ preventScroll: true })

    function onKeyDown(event) {
      if (event.key !== 'Tab') return

      const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      // An empty dialog still must not leak focus backwards.
      if (items.length === 0) {
        event.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      if (opener instanceof HTMLElement && document.contains(opener)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [open, containerRef, initialRef])
}

export default useDialogFocus
