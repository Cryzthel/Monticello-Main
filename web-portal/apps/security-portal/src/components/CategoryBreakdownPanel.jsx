import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import Card from '@shared/components/Card'
import SectionHeading from '@shared/components/SectionHeading'
import TimeframePills from '@shared/components/TimeframePills'
import { Skeleton } from '@shared/components/Skeleton'
import { computeCategoryResolutionTimes, formatMinutes, selectInRange } from '@shared/lib/incidents'
import { categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'

/**
 * Response time by incident category, over a selectable window.
 *
 * The question this answers is "which KIND of call takes us longest to close",
 * which is different from the volume breakdown the donut already shows — a
 * category can be rare and still be the one eating the shift.
 *
 * Bars are scaled against the SLOWEST category in the current window, not
 * against a fixed ceiling: the useful comparison is relative, and a fixed
 * scale would flatten every bar to a sliver on a quiet week.
 *
 * Only resolved incidents can contribute — an open ticket has no resolution
 * time — so the count shown is "resolved in this window", and a category with
 * nothing closed yet is listed as such rather than silently dropped, which
 * would otherwise read as "we have no maintenance calls".
 */
export default function CategoryBreakdownPanel({
  incidents = [],
  rangeDays,
  onRangeChange,
  loading = false,
}) {
  const { rows, slowest, totalResolved, unresolvedCategories } = useMemo(() => {
    // `selectInRange`, not a local cutoff. This was the third hand-rolled
    // windowing filter in the codebase; consolidating them is what makes "the
    // charts and the KPIs describe the same period" true by construction rather
    // than by three implementations happening to agree.
    //
    // One behavioural difference, and it is a fix: the local version was
    // open-ended at the top (`>= cutoff` with no upper bound), so a report with
    // a future timestamp — clock skew on a phone, or a resident setting the
    // incident time forward — counted in every window. The shared helper is
    // bounded at both ends.
    const inWindow = selectInRange(incidents, rangeDays)

    const resolved = computeCategoryResolutionTimes(inWindow)
    const resolvedKeys = new Set(resolved.map((r) => r.category))

    // Categories present in the window but with nothing closed yet.
    // Normalised through the shared taxonomy so this list names the same
    // buckets the bars above it do — un-normalised, a window containing one
    // 'Security' and one 'security' could list a category as having nothing
    // closed while the bar directly above showed its resolution time.
    const pending = [...new Set(inWindow.map((i) => normalizeCategory(i.category)))]
      .filter((key) => !resolvedKeys.has(key))

    return {
      rows: resolved,
      slowest: resolved[0]?.avgMinutes ?? 0,
      totalResolved: resolved.reduce((sum, r) => sum + r.count, 0),
      unresolvedCategories: pending,
    }
  }, [incidents, rangeDays])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <SectionHeading
        title="Response time by category"
        description={
          totalResolved > 0
            ? `${totalResolved} incident${totalResolved === 1 ? '' : 's'} resolved in this window`
            : 'Mean time from report to resolution'
        }
        action={<TimeframePills value={rangeDays} onChange={onRangeChange} />}
      />

      <Card className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? (
          /* The real row is a label over a full-width bar, so the placeholder
             is too. Migrated off the hand-rolled `bg-tint/10` + `bg-tint/[0.06]`
             pair to the shared fill, which is what stops this panel pulsing at
             a different grey from the chart directly above it. */
          <ul className="space-y-4" aria-busy="true" aria-label="Loading breakdown">
            {[0, 1, 2, 3].map((n) => (
              <li key={n} className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton variant="muted" className="h-2 w-full rounded-full" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Layers className="h-6 w-6 text-text-muted" />
            <p className="text-sm text-text-secondary">
              Nothing resolved in this window yet.
            </p>
            <p className="max-w-xs text-xs text-text-muted">
              Resolution time needs both a report and a resolution timestamp, so a category
              only appears here once at least one of its incidents has been closed out.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {rows.map(({ category, avgMinutes, count }) => {
              const share = slowest > 0 ? Math.max((avgMinutes / slowest) * 100, 3) : 0
              return (
                <li key={category}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-text-primary">
                      {categoryLabel(category)}
                    </p>
                    <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-text-primary">
                      {formatMinutes(avgMinutes)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-tint/[0.06]">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-spring"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
                      {count} closed
                    </span>
                  </div>
                </li>
              )
            })}

            {/* Named rather than omitted — a missing row reads as "no calls of
                that kind", which is a different and wrong conclusion. */}
            {unresolvedCategories.length > 0 ? (
              <li className="border-t border-hairline pt-3.5">
                <p className="text-xs leading-relaxed text-text-muted">
                  No resolution time yet for{' '}
                  <span className="text-text-secondary">
                    {unresolvedCategories.map(categoryLabel).join(', ')}
                  </span>{' '}
                  — reported in this window but still open.
                </p>
              </li>
            ) : null}
          </ul>
        )}
      </Card>
    </div>
  )
}
