import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '@/layouts/AppShell'
import IncidentsTable from '@shared/components/IncidentsTable'
import IncidentTicketDetailsModal from '@/components/IncidentTicketDetailsModal'
import { useIncidentStreams } from '@shared/hooks/useIncidentStreams'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'

export default function TicketsPage() {
  const [selectedId, setSelectedId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep link target for a real-time toast's "View Incident" action
  // (see useIncidentAlerts). The param is consumed immediately so a later
  // manual close can't be undone by the URL re-opening the same modal.
  const deepLinkId = searchParams.get('incident')
  useEffect(() => {
    if (!deepLinkId) return
    setSelectedId(deepLinkId)
    setSearchParams({}, { replace: true })
  }, [deepLinkId, setSearchParams])

  // ── RESIDENT REPORTS ONLY ────────────────────────────────────────────────
  //
  // Officer-filed reports are no longer part of this queue. They are the
  // guardhouse's own record of what it did, not a request the guardhouse owes
  // a response to, and mixing the two made every ticket count book the team's
  // paperwork as community demand. They live in Reports (/reports),
  // which already showed exactly this population.
  //
  // Soft-deleted reports are excluded by the feed itself; they are reachable
  // from Audit History -> Deleted Reports, the sole surface that can restore
  // or purge them.
  // See the same note on the guardhouse queue — live surfaces use the working
  // set; deep links still resolve against everything.
  const { residentActive: resident, incidents, loading } = useIncidentStreams()

  useEvidencePrefetch(resident)

  // Resolved against BOTH streams, not just the visible one. A toast's "View
  // incident" deep link carries an id and cannot know which queue it belongs
  // to, so resolving against `resident` alone would make a notification about
  // an officer-filed report open nothing — a dead link with no error.
  //
  // Re-derived every render rather than stored, so the open modal reflects a
  // status change the instant Firestore's onSnapshot pushes it back.
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null

  return (
    <AppShell
      title="Incident tickets"
      // "Status is set by the Guardhouse" says where the authority went, not
      // just that it is gone. Without it, the static pills read as a broken
      // dropdown rather than a deliberate boundary.
      scroll={false}
    >
      {/* ── FULL WIDTH, NO SIDE RAIL ──────────────────────────────────────
          The 22rem ActionFeed column is gone. It was a second, narrower view of
          the SAME `resident` array the table beside it already showed — the
          feed's rows and the table's rows were the same incidents, so the page
          spent a third of its width restating its own contents in a shape that
          held less.

          What that cost was column readability. The table carries eight columns
          (select, ticket, category, location, resident, status, reported,
          actions), and at ~62% of the viewport the Location and Resident cells
          truncated on any realistic name. Reclaiming the rail gives those cells
          the room to render in full, which is the whole point of the removal.

          The chronological view the feed provided is not lost: Audit History is
          the full record, and the table's own Reported column sorts by time. */}
      <div className="flex min-h-0 flex-col lg:h-full">
        <IncidentsTable
          loading={loading}
          incidents={resident}
          onSelect={(incident) => setSelectedId(incident.id)}
        />
      </div>

      <IncidentTicketDetailsModal report={selected} onClose={() => setSelectedId(null)} />
    </AppShell>
  )
}
