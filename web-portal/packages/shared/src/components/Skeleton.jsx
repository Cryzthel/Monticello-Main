/**
 * THE SKELETON PRIMITIVES.
 *
 * Both portals hand-rolled their placeholders before this file existed. The
 * string `animate-pulse rounded bg-tint/10` appeared at roughly forty call
 * sites across nine components, alongside `bg-tint/5`, `bg-tint/[0.03]` and
 * `bg-tint/[0.06]` doing the same job — so two panels loading side by side on
 * the Admin overview pulsed at visibly different greys, and a third had no
 * placeholder at all and simply popped in.
 *
 * ── WHAT THESE ARE FOR ─────────────────────────────────────────────────────
 * A skeleton here is a RESERVATION, not a spinner substitute. Its job is to
 * occupy the exact footprint the real content will occupy, so the data is
 * swapped in place rather than pushed in. Everything below follows from that:
 *
 *   1. HEIGHT TRACKS LINE HEIGHT. A bar standing in for a 12px caption is
 *      `h-3`; a 14px body line is `h-4`; a 24px KPI figure is `h-7`. The
 *      `lines` helpers below encode this so a call site does not have to.
 *   2. THE CONTAINER KEEPS THE REAL PADDING AND GAP. A skeleton row inside a
 *      table uses the table's own `px-4 py-3`, not a convenient round number.
 *      This is why the composites in this file are shaped like the components
 *      they replace instead of being one generic <SkeletonBox/>.
 *   3. WIDTHS VARY, HEIGHTS DO NOT. Real text is ragged. A column of bars all
 *      set to `w-full` reads as a loading graphic; the same column at 90/70/80%
 *      reads as the paragraph that is coming. The variance is deterministic
 *      (a fixed cycle, not Math.random) so a skeleton does not reshuffle on
 *      every render while the fetch is still in flight.
 *
 * ── ACCESSIBILITY ──────────────────────────────────────────────────────────
 * Every skeleton is `aria-hidden`, and the regions that use them carry
 * `aria-busy` on the container instead. A screen reader should hear "loading"
 * once from the region, not a list of forty unlabelled boxes. The pulse is
 * Tailwind's `animate-pulse`, which the global `prefers-reduced-motion` rule
 * in styles/index.css already stops — a reduced-motion user gets the same
 * correctly-sized static layout without the breathing.
 *
 * The fill itself is `--color-skeleton` / `--color-skeleton-muted`, declared
 * per theme so dark mode gets white at a higher alpha rather than an inverted
 * slate that reads as a solid light bar. See the token block for why.
 */

/**
 * The base bar. Everything else in this file composes it.
 *
 * @param {'block'|'muted'|'circle'|'surface'} [props.variant]
 *   `block` — substantive content (a heading, a value, an avatar).
 *   `muted`  — the secondary line beneath it. Pairing the two is what gives a
 *              placeholder its hierarchy.
 *   `circle` — avatars, status dots.
 *   `surface`— a panel-sized region (chart body, map, image tile); takes the
 *              card's 12px radius rather than the 4px text radius.
 */
export function Skeleton({ variant = 'block', className = '', style }) {
  const base =
    variant === 'circle'
      ? 'skeleton-circle'
      : variant === 'surface'
        ? 'skeleton-block'
        : variant === 'muted'
          ? 'skeleton-muted'
          : 'skeleton'

  return <div className={`${base} ${className}`} style={style} aria-hidden="true" />
}

/**
 * A bar that RESERVES A TEXT LINE BOX.
 *
 * ── THE MISTAKE THIS EXISTS TO PREVENT ─────────────────────────────────────
 * The obvious way to write a text placeholder is `<div class="h-3 w-24">`, and
 * it is wrong in a way that only shows up when you measure it. A bar sized to
 * look like text is sized to the GLYPHS; the text it replaces occupies a LINE
 * BOX, which is taller. Stacking three such bars under-reserves by the
 * difference three times over.
 *
 * Measured on the KPI card, which is where this was caught: the real card is
 * 124px and the first version of the skeleton was 110px, so every dashboard
 * this was added to would have shifted 14px per card row on load — the skeleton
 * would have CAUSED a layout shift while advertising that it prevented one.
 *
 * So the outer element is the line box (`box`) and the visible bar sits
 * centred inside it (`bar`). The bar still looks like text; the footprint is
 * the text's real one.
 *
 * The `box` values are Tailwind's own line-heights for each size, which is the
 * table to check against if a call site's type scale changes:
 *
 *   text-2xs → h-3.5 (14px)     text-sm  → h-5 (20px)
 *   text-xs     → h-4  (16px)      text-base→ h-6 (24px)
 *   text-2xl    → h-8  (32px)      text-xl  → h-7 (28px)
 */
export function SkeletonTextLine({
  box = 'h-4',
  bar = 'h-3',
  width = 'w-24',
  variant = 'block',
  className = '',
}) {
  return (
    <div className={`flex items-center ${box} ${className}`} aria-hidden="true">
      <Skeleton variant={variant} className={`${bar} ${width}`} />
    </div>
  )
}

/**
 * A ragged paragraph of `count` lines.
 *
 * The width cycle is the point. It is a fixed sequence rather than a random
 * one so that React re-rendering the parent mid-fetch — which happens on every
 * keystroke in a filter field above a loading table — does not make the
 * placeholder twitch. The last line is always the short one, which is what
 * real wrapped text does.
 */
const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-full', 'w-10/12']

export function SkeletonLines({ count = 3, className = '', lineClassName = 'h-3' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          variant={i === 0 ? 'block' : 'muted'}
          className={`${lineClassName} ${
            i === count - 1 ? 'w-7/12' : LINE_WIDTHS[i % LINE_WIDTHS.length]
          }`}
        />
      ))}
    </div>
  )
}

/**
 * The two-line "identity" block — a name over a supporting detail — that every
 * table in both portals puts in its first column beside an avatar.
 *
 * Extracted because it was the single most duplicated placeholder shape in the
 * codebase: SecurityDirectoryTable, ResidentsPage, SecurityAuditLog and
 * FiledReportsTable each had their own copy, at three different bar widths.
 */
export function SkeletonIdentity({ avatar = true, avatarClassName = 'h-9 w-9', className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden="true">
      {avatar ? <Skeleton variant="circle" className={`shrink-0 ${avatarClassName}`} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton variant="muted" className="h-2.5 w-40" />
      </div>
    </div>
  )
}

/**
 * A KPI card placeholder, matched to KpiCard's own box so the strip does not
 * change height when the numbers arrive (it sits at the top of both
 * dashboards, and every pixel it moves pushes the page below it).
 *
 * Line boxes mirror KpiCard's classes: the shell's 4px frame, the face's
 * label (text-sm → h-5, text-xs compact → h-4) and value (text-3xl leading-9
 * → h-9, text-xl leading-7 compact → h-7), and the footnote strip (py-2
 * around a 20px trend pill → h-5), which compact density drops.
 */
export function SkeletonKpiCard({ density = 'default', className = '' }) {
  const compact = density === 'compact'
  return (
    <div className={`kpi-shell ${className}`} aria-hidden="true">
      <div className={`kpi-face ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
        <SkeletonTextLine
          box={compact ? 'h-4' : 'h-5'}
          bar={compact ? 'h-2.5' : 'h-3'}
          width="w-24"
          variant="muted"
        />
        <SkeletonTextLine
          box={compact ? 'h-7' : 'h-9'}
          bar={compact ? 'h-4' : 'h-6'}
          width={compact ? 'w-14' : 'w-20'}
          className={compact ? 'mt-1' : 'mt-1.5'}
        />
      </div>
      {!compact ? (
        <div className="flex min-h-9 items-center gap-2 px-3 py-2">
          <Skeleton variant="muted" className="h-5 w-12 rounded-full" />
          <SkeletonTextLine box="h-5" bar="h-2.5" width="w-28" variant="muted" />
        </div>
      ) : null}
    </div>
  )
}

/**
 * A full KPI strip. `count` defaults to four, which is what both dashboards,
 * the Metrics page and the Performance page all show.
 *
 * Takes the grid class from the caller for the same reason KpiCard takes its
 * `className`: layout is the page's business. `kpi-grid` is the shared class
 * both dashboards use.
 */
export function SkeletonKpiRow({ count = 4, density = 'default', className = 'kpi-grid' }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading metrics">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonKpiCard key={i} density={density} />
      ))}
    </div>
  )
}

/**
 * Table body placeholder rows, rendered as real `<tr>/<td>` so they inherit the
 * table's own column widths.
 *
 * THIS IS WHY IT TAKES `columns` RATHER THAN A COUNT. A skeleton drawn as a
 * stack of divs over a table cannot know where the columns fall, so the bars
 * land in the wrong places and the whole grid jumps sideways when the real rows
 * arrive. Passing the column descriptors means each placeholder cell is in the
 * cell it is standing in for.
 *
 * Each entry is `{ width, variant, identity }`:
 *   width    — a Tailwind width class for the bar (`w-24`), so a "Status"
 *              column gets a short pill and a "Description" column gets a long
 *              bar, matching the real content's rag.
 *   identity — render the avatar + two-line block instead of a single bar.
 *   variant  — `pill` for anything that renders as a badge in the real row.
 *   empty    — reserve the column's width but draw nothing, for the checkbox
 *              and row-action gutters. A bar there would promise a control
 *              that the loaded row does not put in that cell.
 */
export function SkeletonTableRows({
  columns,
  rows = 5,
  cellClassName = 'px-4 py-3.5',
  rowClassName = 'border-t border-divider',
}) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={`skeleton-${r}`} className={rowClassName} aria-hidden="true">
      {columns.map((col, c) => (
        <td key={c} className={`${cellClassName} ${col.className ?? ''}`}>
          {col.empty ? null : col.identity ? (
            <SkeletonIdentity avatar={col.avatar !== false} />
          ) : col.variant === 'pill' ? (
            <Skeleton className={`h-5 rounded-full ${col.width ?? 'w-16'}`} />
          ) : (
            <Skeleton
              variant={col.variant === 'muted' ? 'muted' : 'block'}
              className={`h-3 ${col.width ?? 'w-24'}`}
            />
          )}
        </td>
      ))}
    </tr>
  ))
}

/**
 * A chart placeholder: the axis furniture plus a body region.
 *
 * Deliberately NOT a set of fake bars or a fake sparkline. A placeholder that
 * mimics data is read as data for the half-second before it is replaced, and on
 * an analytics page — where the reader's whole purpose is to judge a shape —
 * that is actively misleading. A flat surface block says "a chart is coming"
 * without asserting anything about what it will show.
 *
 * `height` should be the real chart's height so the panel does not resize.
 */
export function SkeletonChart({ height = 'h-64', className = '', showLegend = true }) {
  return (
    <div className={`flex flex-col gap-3 ${className}`} aria-busy="true" aria-label="Loading chart">
      {showLegend ? (
        <div className="flex items-center gap-4" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <Skeleton variant="circle" className="h-2 w-2" />
            <Skeleton variant="muted" className="h-2.5 w-16" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton variant="circle" className="h-2 w-2" />
            <Skeleton variant="muted" className="h-2.5 w-20" />
          </div>
        </div>
      ) : null}
      <Skeleton variant="surface" className={`w-full ${height}`} />
      {/* The x-axis tick row. Four evenly spaced stubs — enough to read as an
          axis, not so many that it implies a bucket count the data may not
          have. */}
      <div className="flex items-center justify-between px-1" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} variant="muted" className="h-2 w-8" />
        ))}
      </div>
    </div>
  )
}

/**
 * A donut/pie placeholder — a ring plus its legend rows.
 *
 * The ring is drawn as a bordered circle rather than a filled one so it reads
 * as the same hollow shape the real donut has; a solid disc would be a pie, and
 * the swap would visibly change the figure.
 */
export function SkeletonDonut({ size = 'h-40 w-40', legendRows = 4, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6 ${className}`}
      aria-busy="true"
      aria-label="Loading breakdown"
    >
      <div
        className={`skeleton-circle shrink-0 border-[12px] border-[var(--color-skeleton)] bg-transparent ${size}`}
        aria-hidden="true"
      />
      <div className="flex w-full min-w-0 flex-col gap-2.5" aria-hidden="true">
        {Array.from({ length: legendRows }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton variant="circle" className="h-2.5 w-2.5 shrink-0" />
            <Skeleton variant="muted" className="h-2.5 flex-1" />
            <Skeleton className="h-2.5 w-8 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A vertical feed of timestamped entries — the activity log, the audit trail,
 * the notification list. One shape, because all three render as
 * `icon + (title / meta)`.
 */
export function SkeletonFeed({ rows = 6, className = '', divided = true }) {
  return (
    <div className={`flex flex-col ${className}`} aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 px-4 py-3 ${
            divided && i > 0 ? 'border-t border-hairline' : ''
          }`}
          aria-hidden="true"
        >
          <Skeleton variant="circle" className="mt-0.5 h-8 w-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3 ${LINE_WIDTHS[i % LINE_WIDTHS.length]}`} />
            <Skeleton variant="muted" className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A grid or stack of card-shaped placeholders — the announcement feed, the
 * broadcast list, any page whose content is cards rather than rows.
 *
 * `height` is the real card's height. The announcements feed uses h-44, which
 * is what its own hand-rolled placeholder used before this component existed.
 */
export function SkeletonCardGrid({ count = 3, height = 'h-44', className = '' }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`card flex flex-col gap-3 p-4 ${height}`} aria-hidden="true">
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" className="h-8 w-8 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton variant="muted" className="h-2.5 w-24" />
            </div>
          </div>
          <SkeletonLines count={3} className="flex-1" />
        </div>
      ))}
    </div>
  )
}

export default Skeleton
