import { useMemo } from 'react'
import SegmentedControl from '@shared/components/SegmentedControl'
import { TIMEFRAME_PRESETS, resolveTimeframe } from '@shared/lib/timeframe'
import { formatDate } from '@shared/lib/dates'

/**
 * Quick retention filter — 7d / 30d / All, plus an explicit custom range.
 */
export default function TimeframeFilter({ value, onChange, className = '' }) {
  const custom = value.preset === 'custom'
  const range = useMemo(() => resolveTimeframe(value), [value])

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* The shared sliding capsule — the same control, and the same selected
          treatment, as every other "pick one" group in both portals. */}
      <SegmentedControl
        ariaLabel="Retention window"
        options={TIMEFRAME_PRESETS.map((preset) => ({ value: preset.key, label: preset.label }))}
        value={value.preset}
        onChange={(preset) => onChange({ ...value, preset })}
      />

      {custom ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="From date"
            value={value.from ?? ''}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="field h-9 w-auto py-1.5 text-xs"
          />
          <span className="text-xs text-text-muted">to</span>
          <input
            type="date"
            aria-label="To date"
            value={value.to ?? ''}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="field h-9 w-auto py-1.5 text-xs"
          />
        </div>
      ) : null}

      {range.from ? (
        <span className="text-caption text-text-muted">
          since {formatDate(range.from)}
        </span>
      ) : null}
    </div>
  )
}
