import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import KpiCard from '@shared/components/KpiCard'
import Card from '@shared/components/Card'
import CardHeader from '@shared/components/CardHeader'
import SectionHeading from '@shared/components/SectionHeading'
import TimeframePills from '@shared/components/TimeframePills'
import AnalyticsPanel from '@/components/AnalyticsPanel'
import IncidentsTable from '@shared/components/IncidentsTable'
import IncidentDetailModal from '@shared/components/IncidentDetailModal'
import { SkeletonKpiRow } from '@shared/components/Skeleton'
import { usePortalMetrics } from '@/hooks/usePortalMetrics'
import { useWaitWhile } from '@/lib/waitState'
import { useStaffAccounts } from '@shared/hooks/useStaffAccounts'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { useAuth } from '@shared/auth/AuthContext'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState(null)
  const [rangeDays, setRangeDays] = useState(30)

  // -- ONE FEED, ONE WINDOW, ONE TAXONOMY ----------------------------------
  //
  // Every number on this page comes out of a single hook, the donut's slices
  // included — and it is the SAME hook the System
  // Metrics page reads, so a figure shown on both is computed once. The page
  // used to open its own `incidents` subscription and compute the KPIs inline
  // while AnalyticsPanel bucketed categories itself, which is how the cards and
  // the chart came to describe slightly different sets of reports; see
  // usePortalMetrics for the four specific disagreements that produced.
  //
  // It also means this page no longer counts soft-deleted reports. Deleting one
  // used to remove it from the tickets table and leave it sitting in Total
  // Incidents; the feed excludes them by default now.
  const {
    incidents,
    inRange,
    // The feed's own open-subscription flag. It was already returned by the
    // hook and simply never read here, which is why every number on this page
    // rendered as a confident 0 for the first paint and then jumped.
    loading,
    totalIncidents,
    totalDelta,
    resolutionRate,
    resolutionDelta,
    avgResponseTime,
    avgResponseDelta,
    activeSosCount,
    sosLoading,
    categoryBreakdown,
  } = usePortalMetrics(rangeDays)
  useWaitWhile(loading, 'Syncing incident metrics')

  // Identifies which reports an OFFICER filed, which is a join against
  // `staff_accounts` rather than a field on the incident — see
  // useStaffAccounts. Only the filings feed needs it.
  const { staffIds, loading: staffLoading } = useStaffAccounts()

  // -- THE TABLE IS RESIDENT-FILED ONLY ------------------------------------
  //
  // Matching the Incident Tickets queue this panel previews. Officer-filed
  // reports have their own page (Reports) and their own feed to the right of
  // this table; listing them here too would put the same record in both
  // columns of one screen under two different meanings.
  //
  // Withheld until `staff_accounts` has loaded, for the reason spelled out in
  // useIncidentStreams: against an empty id set every report reads as
  // resident-filed, so an eager split opens by showing exactly what the
  // separation exists to prevent.
  //
  // The KPI cards above are deliberately NOT filtered. "Total Incidents" means
  // every incident on the property; scoping it to one population would make the
  // headline number quietly answer a narrower question than it asks.
  const residentIncidents = useMemo(
    () => (staffLoading ? [] : incidents.filter((i) => !isOfficerFiled(i, staffIds))),
    [incidents, staffIds, staffLoading],
  )

  // Re-derived from the live collection every render (rather than storing the
  // selected report object) so the open modal reflects a status change the
  // instant Firestore's onSnapshot pushes it back.
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null
  const { user } = useAuth()

  /*
    THE H1 NAMES THE PAGE, not the reader. This carried
    `Welcome back, <name>!`: the largest type on the console's landing page
    spent on a greeting, while the page's own identity ("Overview") survived
    only in the sidebar. It was consumer register on a product whose stated
    presentation is calm and conventional (PRODUCT.md), and it named itself by
    a different rule from Security's `Live dispatch`. If the greeting is wanted
    back it belongs in the subtitle or the sidebar account footer —
    `greetingName` in @shared/lib/identity is still there for that.
  */
  return (
    <AppShell
      title="Overview"
      headerActions={<TimeframePills value={rangeDays} onChange={setRangeDays} />}
    >
      {/* -- THREE NAMED SECTIONS, NOT ONE RUN OF PANELS --------------------
          The page previously opened with an unlabelled row of four cards, then
          two charts, then two more panels, with nothing saying which of them
          moved when the timeframe pill changed. Each band now states what it
          is and what period it describes, so "Total Incidents" being windowed
          and "Open incidents" being live is legible from the headings rather
          than from four separate lines of help text. */}
      {/* gap-6: this page scrolls, and a scrolling page takes the rhythm that
          matches .page-grid and .kpi-grid — see "the two vertical rhythms" in
          the shared stylesheet. It was gap-8, a third value no rule names. */}
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <SectionHeading title="Analytics overview" />
          {/* The KPI strip is the page's worst layout-shift offender and the
              reason it is skeletoned first: it sits at the very top, so every
              pixel it changes height pushes the charts, the table and the feed
              below it. The placeholder is KpiCard's own box, so the swap is
              in-place and nothing under it moves. */}
          {loading ? (
            <SkeletonKpiRow count={4} />
          ) : (
          <div className="kpi-grid">
            <KpiCard
              label="Total incidents"
              value={totalIncidents}
              delta={totalDelta?.text}
              deltaDirection={totalDelta?.direction}
              deltaTone={totalDelta?.tone}
              helpText="Reports filed in this period"
            />
            {/* Live, and deliberately outside the timeframe: an SOS from last
                Tuesday that nobody closed is not a historical statistic, it is
                a person still waiting. The count is the guardhouse map's own
                definition of "live" (active or acknowledged, never resolved) —
                see panicStatus.js — so this card and the SOS page agree. */}
            <KpiCard
              label="Active SOS alerts"
              value={sosLoading ? '—' : activeSosCount}
              tone="danger"
              helpText="Open right now — ignores the timeframe"
            />
            <KpiCard
              label="Resolution rate"
              value={resolutionRate}
              delta={resolutionDelta?.text}
              deltaDirection={resolutionDelta?.direction}
              deltaTone={resolutionDelta?.tone}
              helpText="Share of this period's reports now closed"
            />
            {/* "Mean Time to Respond" in plain words. The figure is unchanged —
                report filed to security dispatched — but the card no longer
                asks a reader to know an acronym to read their own dashboard.
                Its delta is inverted against the others: faster is better, so a
                fall is the green number here. */}
            <KpiCard
              label="Avg response time"
              value={avgResponseTime}
              delta={avgResponseDelta?.text}
              deltaDirection={avgResponseDelta?.direction}
              deltaTone={avgResponseDelta?.tone}
              helpText="Report filed to security dispatched"
            />
          </div>
          )}
        </section>

        {/* System health lives on System Metrics only. It was a band here,
            between the KPI row and the charts, answering "is the platform up"
            on a page whose job is "what is happening on the property". The
            brief narrowed this page to three sections — analytics, where and
            when, latest activity — and the probe still reports in full one
            click away. */}

        <section className="flex flex-col gap-3">
          <SectionHeading title="Where and when" />
          {/* Receives the WINDOWED array for its volume chart and the
              already-computed breakdown for its donut. The panel derives no
              metric of its own, so there is nothing inside it that can
              disagree with the cards above. */}
          <AnalyticsPanel
            incidents={inRange}
            days={rangeDays}
            categoryBreakdown={categoryBreakdown}
            loading={loading}
          />
        </section>

        <section className="flex flex-col gap-3">
          {/* "View all" sits on the SECTION header, not inside the card.
              It used to be pinned to the card's own header so it read as
              belonging to the table it opens. That was true, and it is still
              where the link goes — but the section header is the only full
              -width row on this band, so the control now has a baseline to
              align to instead of floating inside a panel beside a caption.
              SectionHeading already owns the right-hand action slot; this is
              the rank it was built for. */}
          <SectionHeading
            title="Latest activity"
            action={
              <button type="button" onClick={() => navigate('/tickets')} className="btn btn-compact btn-outline">
                View all
                <ArrowRight size="sm" />
              </button>
            }
          />
          {/* The fixed height and the split move TOGETHER, at `xl`. The height
              exists so the table and the feed can share one row; left at `lg`
              while the split moved, it would cram both STACKED panels into a
              single 26rem box. See .page-grid for why the split waits for xl. */}
          <div className="page-grid xl:h-[26rem]">
            <Card className="col-span-12 flex h-full min-h-0 flex-col overflow-hidden p-0">
              {/* Title only. The "Resident-filed · newest first" caption is
                  gone with the rest of this page's descriptions, and "View all"
                  moved up to the section header — so this row is now the one
                  thing a header inside a card has to do: name the card. */}
              <CardHeader title="Recent incidents" />
              <div className="min-h-0 flex-1">
                <IncidentsTable
                  bare
                  // `staffLoading` counts as loading here even though the
                  // incident feed may already be open: `residentIncidents` is
                  // held at [] until the staff id set arrives (see its useMemo
                  // above), so without it the table would report an empty queue
                  // for exactly as long as that second subscription takes.
                  loading={loading || staffLoading}
                  incidents={residentIncidents}
                  onSelect={(incident) => setSelectedId(incident.id)}
                  compact
                  limit={6}
                />
              </div>
            </Card>
          </div>
        </section>
      </div>

      <IncidentDetailModal report={selected} onClose={() => setSelectedId(null)} />
    </AppShell>
  )
}
