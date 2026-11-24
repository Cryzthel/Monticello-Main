import SegmentedControl from '@shared/components/SegmentedControl'

const TIME_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '6m', days: 180 },
  { label: '1yr', days: 365 },
]

const OPTIONS = TIME_RANGES.map((range) => ({
  value: range.days,
  label: range.label,
  title: range.days === 365 ? 'Last 12 months' : range.days === 180 ? 'Last 6 months' : `Last ${range.days} days`,
}))

/**
 * Timeframe selector for the metrics and overview dashboards.
 *
 * THE REFERENCE CONTROL. The 2026-09-17 oblong brief was drawn from this exact
 * switch — a dark capsule, `7d / 30d / 6m / 1yr`, and an emerald pill that
 * slides to the selected range — so it is the first thing built on the shared
 * SegmentedControl, and every other segmented group in both portals now
 * follows it rather than the other way round.
 *
 * Labels are set in JetBrains Mono: `7d`/`30d`/`6m`/`1yr` are a set of
 * figures, and mono tabular numerals keep the four capsules close to equal
 * width so the track does not visibly reflow as the selection moves.
 *
 * The selected pill takes the CTA pair (`--color-brand-cta` + its
 * foreground): emerald with a black label in dark, exactly the reference; the
 * deep forest with a white label in light, where the reference's bright
 * emerald would sit on a pale track at 2.3:1 and fail the 3:1 floor for a
 * state indicator.
 */
export const TIME_RANGES_EXPORT = TIME_RANGES
export default function TimeframePills({ value, onChange, className = '' }) {
  return (
    <SegmentedControl
      ariaLabel="Timeframe"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      mono
      className={`shrink-0 ${className}`}
    />
  )
}
