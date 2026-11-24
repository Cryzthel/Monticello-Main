/**
 * Pagination arithmetic, kept out of the component.
 *
 * Lives in `lib` rather than beside TablePagination for the reason the badge
 * and status tables already document: a `.jsx` file that exports BOTH a
 * component and plain constants breaks Fast Refresh, so the constants and the
 * component have to be importable independently.
 */

export const ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50]

export const DEFAULT_ROWS_PER_PAGE = 10

/**
 * Page numbers to render, with gaps collapsed.
 *
 * Always shows the first and last page, the current page, and one neighbour
 * either side — with an ellipsis wherever that skips something. A naive `1..n`
 * row of pills is fine at 5 pages and unusable at 40: it wraps to three lines
 * and pushes the table up.
 *
 * Returns numbers and the string `'gap'`. `'gap'` rather than `'…'` so the
 * marker is data and the caller decides how to render it — which is also what
 * lets the ellipsis be `aria-hidden` without the logic knowing about ARIA.
 *
 * The 7-page threshold is not arbitrary: below it, first + last + current + two
 * neighbours + two gaps is already 7 slots, so collapsing saves nothing and
 * only costs the reader a jump in the numbering.
 */
export function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const items = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(total - 1, current + 1)

  if (from > 2) items.push('gap')
  for (let page = from; page <= to; page += 1) items.push(page)
  if (to < total - 1) items.push('gap')
  items.push(total)

  return items
}
