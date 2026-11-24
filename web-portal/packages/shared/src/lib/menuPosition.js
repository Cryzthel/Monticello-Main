/**
 * Where a row menu opens: under its trigger, or ABOVE it when there is no
 * room below.
 *
 * Row menus are portalled with `position: fixed`, which already stops the
 * table frame clipping them. What it did not stop is the last rows on a page:
 * the menu opened downward past the bottom of the window, with its last
 * action (usually Delete) off-screen. Measured after render (see callers'
 * layout effects), so the decision uses the menu's real height.
 */
const GAP = 6
const MARGIN = 8

/** The initial, below-the-trigger placement. */
export function belowTrigger(rect) {
  return { top: rect.bottom + GAP, right: window.innerWidth - rect.right, origin: 'top right' }
}

/**
 * Re-places a rendered menu above its trigger if it would overflow the
 * viewport bottom and fits above. Returns null when nothing needs to change.
 */
export function flipIfOverflowing(triggerRect, menuRect) {
  const overflowsBelow = menuRect.bottom > window.innerHeight - MARGIN
  const fitsAbove = triggerRect.top - GAP - menuRect.height >= MARGIN
  if (!overflowsBelow || !fitsAbove) return null
  return {
    bottom: window.innerHeight - triggerRect.top + GAP,
    right: window.innerWidth - triggerRect.right,
    origin: 'bottom right',
  }
}
