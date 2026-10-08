import { useState } from 'react'
import AppShell from '@/layouts/AppShell'
import MetricsPanel from '@/components/MetricsPanel'
import TimeframePills from '@shared/components/TimeframePills'
import { usePortalMetrics } from '@/hooks/usePortalMetrics'

export default function MetricsPage() {
  const [rangeDays, setRangeDays] = useState(30)

  // -- THE SAME HOOK THE OVERVIEW READS ------------------------------------
  //
  // Not merely the same feed — the same computed figures. This page restates
  // Total Incidents, Resolution Rate and the average response time, and it used
  // to derive all three itself from its own subscription with its own windowing
  // helper. Two pages computing one metric off two arrays is how an admin ends
  // up with two answers to "how many incidents were there", and they had
  // genuinely drifted: the local `withinLast` counted future-dated reports that
  // `selectInRange` excludes.
  //
  // The panel below now receives finished numbers and derives only what is
  // unique to it — the weekly trend, the per-category durations, the phase
  // hot-spots. Nothing shown on both pages is calculated twice.
  const {
    incidents,
    inRange,
    loading,
    totalIncidents,
    resolutionRate,
    avgResponseTime,
    evidenceRate,
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
          totalIncidents={totalIncidents}
          resolutionRate={resolutionRate}
          avgResponseTime={avgResponseTime}
          evidenceRate={evidenceRate}
          activeIncidents={operations.activeIncidents}
          loading={loading}
        />
      </div>
    </AppShell>
  )
}
