/**
 * The one table frame every data table in both portals renders through.
 *
 *   <DataTable columns={COLUMNS} minWidth="56rem">
 *     {loading ? <SkeletonTableRows … /> : rows.length === 0 ? <DataTableEmpty … /> : rows.map(…)}
 *   </DataTable>
 *
 * ── WHAT IT OWNS ───────────────────────────────────────────────────────────
 * The things fourteen tables each did slightly differently, and got wrong in
 * different ways (2026-10-17):
 *
 *   the scroller     both axes, inside the table's own frame, so a narrow
 *                    window scrolls the TABLE rather than clipping it
 *   a minimum width  the sum the columns need; five tables had none, so their
 *                    columns squeezed and the headers wrapped
 *   the header       sticky, on the card's own surface (`base-900`) in both
 *                    themes — `bg-slate-50` was a different shade from the
 *                    card in dark mode — with its bottom edge drawn as an
 *                    INSET SHADOW. A border on a sticky row stays behind with
 *                    the table's border model, so scrolled rows showed through
 *                    the gap. Header labels never wrap.
 *   alignment        `align: 'right' | 'center'` per column, so numbers and
 *                    actions line up the same way everywhere
 *
 * The header lives in the same <table> as the body, so columns cannot drift
 * out of alignment on either scroll axis.
 *
 * ── WHAT IT LEAVES TO EACH TABLE ───────────────────────────────────────────
 * The <tbody> contents. Rows across the portals carry different behaviour —
 * selection, open-on-click, keyboard activation, overflow menus — and each
 * table keeps writing its own <tr>. Loading and empty states have shared
 * pieces (SkeletonTableRows, DataTableEmpty) so those look the same too.
 *
 * @param {Array<{ header?: React.ReactNode, className?: string, minWidth?: string,
 *   align?: 'left'|'right'|'center', key?: string, ariaSort?: string,
 *   hidden?: boolean }>} columns
 *   `ariaSort` marks the column the rows are sorted by; `hidden` drops a
 *   column that only exists in some modes (the body must drop its cell too).
 * @param {string} [minWidth]  CSS width the table never shrinks below.
 * @param {string} [scrollClassName]  Extra classes for the scroll container.
 * @param {string} [tableClassName]  Extra classes for the <table>.
 * @param {'both'|'x'} [scroll]  'x' for a table that does not scroll inside its
 *   own card (it pages instead): the frame then scrolls sideways only.
 * @param {boolean} [sticky]  Off where the table has no vertical scroller of
 *   its own — a sticky header would pin to the PAGE's scroller instead and
 *   float over the toolbar above the table (see OnDutyHistoryTable).
 * @param {React.ReactNode} [colgroup]  Proportional width hints, kept as-is.
 * @param {'default'|'compact'} [density]  'compact' for tables inside drawers.
 *   Header padding is the component's, so a table changes density with this
 *   prop rather than by out-ranking the default classes (Tailwind resolves
 *   conflicting utilities by stylesheet order, not by class order).
 */
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

export default function DataTable({
  columns,
  minWidth = '48rem',
  scroll = 'both',
  sticky = true,
  colgroup = null,
  density = 'default',
  scrollClassName = '',
  tableClassName = '',
  children,
}) {
  const frame = scroll === 'x' ? 'overflow-x-auto' : 'custom-scrollbar min-h-0 flex-1 overflow-auto'
  return (
    <div className={`${frame} ${scrollClassName}`}>
      <table className={`w-full text-left text-sm ${tableClassName}`} style={{ minWidth }}>
        {colgroup}
        <thead
          className={`bg-base-900 shadow-[inset_0_-1px_0_var(--color-hairline)] ${sticky ? 'sticky top-0 z-10' : ''}`}
        >
          <tr className="table-head">
            {columns.map((col, i) => col.hidden ? null : (
              <th
                key={col.key ?? i}
                scope="col"
                aria-sort={col.ariaSort}
                className={`whitespace-nowrap font-medium ${density === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3'} ${ALIGN[col.align] ?? ''} ${col.className ?? ''}`}
                style={col.minWidth ? { minWidth: col.minWidth } : undefined}
              >
                {col.header ?? null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * The empty state, as one full-width row: an optional icon, the message, and
 * optional detail. Every table had its own; several said only "No data", which
 * reads as broken when the real reason is a filter.
 */
export function DataTableEmpty({ colSpan, icon: Icon = null, children, detail = null }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        {Icon ? <Icon size="lg" className="mx-auto mb-2 text-text-muted" aria-hidden="true" /> : null}
        <p className="text-sm text-text-secondary">{children}</p>
        {detail ? <p className="mt-1 text-xs text-text-muted">{detail}</p> : null}
      </td>
    </tr>
  )
}
