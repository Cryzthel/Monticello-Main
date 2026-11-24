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
  // `incidentsInRange`, not `inRange`: the window now holds report RECORDS
  // (incidents and SOS alerts in one shape), and this page's charts read fields
  // only an incident document has - `phase` for the hot-spots, `resolvedAt` for
  // the per-category durations. `incidentsInRange` is a projection of that same
  // window rather than a second query, so this page and the Overview still
  // describe one period measured once. See overviewMetrics.js.
  const {
    incidents,
    incidentsInRange,
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
          inRange={incidentsInRange}
          days={rangeDays}
          activeIncidents={operations.activeIncidents}
          loading={loading}
        />
      </div>
    </AppShell>
  )
}
