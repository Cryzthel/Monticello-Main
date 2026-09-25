import { useState } from 'react'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import IncidentsTable from '@shared/components/IncidentsTable'
import IncidentDetailModal from '@shared/components/IncidentDetailModal'
import { useIncidentStreams } from '@shared/hooks/useIncidentStreams'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'

/**
 * The guard's ticket queue.
 *
 * Split out of Response Metrics, where it had been embedded beneath the
 * priority chart. That page had two jobs — "how are we doing" and "what do I
 * work on next" — read at different moments and at different tempos, and the
 * table's own 38rem scroll container inside a scrolling page meant a guard
 * triaging a call was scrolling past analytics to reach it.
 *
 * Deliberately the SAME `IncidentsTable` the Admin queue uses, so search,
 * sorting, bulk soft-delete and the row menu behave identically for both
 * roles; the two portals differ in what surrounds the table, not in it.
 *
 * ── THIS PAGE NO LONGER CHANGES STATUS ────────────────────────────────────
 * The per-row status dropdown and the row menu's Mark Dispatched / Mark
 * Resolved entries are gone. Status is read here — a static capsule in the
 * Status column — and driven from the Live Dispatch map, where the pin, the
 * street and the resident's contact details are on screen beside the button
 * that messages them. See IncidentsTable's header note.
 *
 * The subtitle says so out loud, because a guard who has been setting status
 * from this table for months needs to be told where the control went, not left
 * to conclude the page is broken.
 */
export default function TicketsPage() {
  const [selectedId, setSelectedId] = useState(null)

  // Resident-filed only — the calls this shift owes a response to. Reports an
  // officer filed are their own record and live under File a Report; see
  // useIncidentStreams for why they are separated rather than flagged.
  //
  // Soft-deleted reports are excluded by the feed; Audit History in the Admin
  // portal is the sole surface that can restore or purge them.
  // `residentActive`, not `resident`: a live queue drops reports resolved more
  // than a day ago. `incidents` still resolves deep links against everything,
  // so a notification about an older report still opens it.
  const { residentActive: resident, incidents, loading } = useIncidentStreams()

  // Rows open the detail modal, so the same prefetch applies here.
  useEvidencePrefetch(resident)

  // Both streams, so a deep-linked notification still resolves — see the same
  // note on the Admin queue. Re-derived every render rather than stored, so
  // the open modal reflects a status change the instant onSnapshot pushes it.
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null

  return (
    <AppShell
      title="Incident tickets"
      subtitle="Resident-filed calls, newest first. Open a ticket to read it; update status from the Live dispatch map."
      topBarSlot={<GuardHeaderActions />}
      scroll={false}
    >
      {/* ── FULL WIDTH, NO SIDE RAIL ──────────────────────────────────────
          The 22rem ActionFeed column is gone, matching the same removal on the
          Admin queue — the two consoles now render this page identically, which
          was the point of sharing `IncidentsTable` in the first place.

          The feed was a second, narrower view of the SAME `resident` array the
          table beside it already showed. Its rows and the table's rows were the
          same incidents, so the page spent a third of its width restating its
          own contents in a shape that held less of each one.

          What that cost was column readability. The table carries eight columns
          (select, ticket, category, location, resident, status, reported,
          actions), and at ~62% of the viewport the Location and Resident cells
          truncated on any realistic name — on the console whose whole job is
          reading an address off a live call. Reclaiming the rail gives those
          cells the room to render in full.

          The chronological view the feed provided is not lost: Incident History
          is the guardhouse's full record, and the table's own Reported column
          sorts by time. */}
      <div className="flex min-h-0 flex-col lg:h-full">
        {/* No status props left to pass. The table is the same read-only
            queue on both consoles now — see its header note. */}
        <IncidentsTable
          loading={loading}
          incidents={resident}
          onSelect={(incident) => setSelectedId(incident.id)}
        />
      </div>

      <IncidentDetailModal report={selected} onClose={() => setSelectedId(null)} />
    </AppShell>
  )
}
