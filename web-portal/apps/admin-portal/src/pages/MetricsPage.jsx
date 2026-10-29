import { useState } from 'react'
import AppShell from '@/layouts/AppShell'
import MetricsPanel from '@/components/MetricsPanel'
import TimeframePills from '@shared/components/TimeframePills'
import { usePortalMetrics } from '@/hooks/usePortalMetrics'

export default function MetricsPage() {
  const [rangeDays, setRangeDays] = useState(30)

  // The headline counts are the Overview's alone (the Key numbers row that
  // restated them here was removed 2026-10-29). This page reads the same hook
  // for the feed and derives only what is unique to it — the weekly trend, the
  // per-category durations, the phase hot-spots.
  const {
    incidents,
    inRange,
    loading,
    operations,
  } = usePortalMetrics(rangeDays)

  return (
    <AppShell
      title="System metrics"
      headerActions={<TimeframePills value={rangeDays} onChange={setRangeDays} />}
    >
      {/* gap-6, as a scrolling page — see "the two vertical rhythms" in the
          shared stylesheet. Was gap-8, matching the Overview's same drift. */}
      <div className="flex flex-col gap-6">
        <MetricsPanel
          incidents={incidents}
          inRange={inRange}
          days={rangeDays}
          activeIncidents={operations.activeIncidents}
          loading={loading}
        />
      </div>
    </AppShell>
  )
}
