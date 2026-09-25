import { ChevronLeft, ChevronRight } from 'lucide-react'
import Select from '@shared/components/Select'
import { pageItems, ROWS_PER_PAGE_OPTIONS } from '@shared/lib/pagination'

/**
 * The table's pagination footer.
 *
 * ── PINNED, NOT SCROLLED ──────────────────────────────────────────────────
 * `shrink-0` on a flex sibling of the scroll region, not `sticky bottom-0`
 * inside it. Sticky would keep the controls visible but leave them overlapping
 * the last row, and on a short viewport a sticky footer inside an
 * `overflow-y-auto` box can end up scrolling with its own container. As a
 * sibling it is simply always the last 57px of the panel, at every resolution.
 *
 * ── COUNTS ARE OF THE FILTERED SET ────────────────────────────────────────
 * [totalItems] is what the search and status filter left, not what the query
 * returned. "Showing 1–10 of 48" alongside a search box has to describe the 48
 * rows the operator can actually reach, or the two disagree and the number
 * looks broken.
 */
export default function TablePagination({
  page,
  rowsPerPage,
  totalItems,
  onPageChange,
  onRowsPerPageChange,
  /** Singular noun for the range indicator: "48 incident tickets". */
  itemLabel = 'item',
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage))
  const safePage = Math.min(page, totalPages)

  // 1-indexed and inclusive, which is what a human reads. Guarded so an empty
  // set says "0–0 of 0" rather than "1–0 of 0".
  const firstItem = totalItems === 0 ? 0 : (safePage - 1) * rowsPerPage + 1
  const lastItem = Math.min(safePage * rowsPerPage, totalItems)

  const plural = totalItems === 1 ? itemLabel : `${itemLabel}s`

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
      {/* Range indicator. `tabular-nums` so the figures do not jitter as the
          page changes and the digit widths differ. */}
      <p className="text-xs text-text-secondary tabular-nums">
        Showing <span className="font-medium text-text-primary">{firstItem}</span>–
        <span className="font-medium text-text-primary">{lastItem}</span> of{' '}
        <span className="font-medium text-text-primary">{totalItems}</span> {plural}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-text-secondary">Rows</span>
          <Select
            ariaLabel="Rows per page"
            size="sm"
            value={rowsPerPage}
            onChange={onRowsPerPageChange}
            options={ROWS_PER_PAGE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>

        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            aria-label="Previous page"
            className="icon-btn icon-btn-sm border border-slate-200 bg-base-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {pageItems(safePage, totalPages).map((item, index) =>
            item === 'gap' ? (
              // `aria-hidden`: a screen reader announcing "ellipsis" between
              // page numbers is noise, and the surrounding buttons already
              // carry their own labels.
              <span
                key={`gap-${index}`}
                aria-hidden="true"
                className="px-1 text-xs text-text-muted"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                aria-label={`Page ${item}`}
                aria-current={item === safePage ? 'page' : undefined}
                className={`h-9 min-w-9 rounded-lg px-2.5 text-xs font-semibold tabular-nums transition-colors duration-150 ${
                  item === safePage
                    ? 'surface-brand'
                    : 'border border-slate-200 bg-base-800 text-text-secondary hover:border-slate-300 hover:text-brand-400'
                }`}
              >
                {item}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            aria-label="Next page"
            className="icon-btn icon-btn-sm border border-slate-200 bg-base-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      </div>
    </div>
  )
}
