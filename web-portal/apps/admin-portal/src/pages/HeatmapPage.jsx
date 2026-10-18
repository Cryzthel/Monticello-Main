import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, query } from 'firebase/firestore'
import AppShell from '@/layouts/AppShell'
import IncidentMap from '@shared/components/IncidentMap'
import HazardMapReportDetailsModal from '@/components/HazardMapReportDetailsModal'
import PanicAlertDetailModal from '@/components/PanicAlertDetailModal'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { db } from '@shared/lib/firebase'
import { mapIncidentDoc, isResolvedExpired } from '@shared/lib/incidents'
import { isPanicLive } from '@shared/lib/panicStatus'


export default function HeatmapPage() {
  // ── INCIDENTS ONLY (2026-10-19) ──────────────────────────────────────────
  // Guard positions and their published routes are no longer drawn here, by
  // request: this map shows resident reports and the pulse rings of live SOS
  // alerts, nothing else. Officer movement is the Guardhouse dispatch map's
  // job. Leaving `units` and `route` off IncidentMap also drops its
  // "Units and routes" legend, and `guard_telemetry` is no longer read here.

  const [selectedId, setSelectedId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const incidentsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  const { data: rawIncidents } = useLiveCollection(incidentsQuery)
  // ── RESOLVED PINS CLEAR THEMSELVES ────────────────────────────────────
  // A hazard map is a picture of what is happening now. Every resolved report
  // stayed on it forever, so the longer the estate ran the more of the map was
  // history — and the dense clusters a heat map exists to show were mostly
  // closed calls. Resolved pins now drop a day after they close; the record
  // itself is untouched and still in History and the archive.
  const live = useMemo(
    () => rawIncidents.map(mapIncidentDoc).filter((incident) => !isResolvedExpired(incident)),
    [rawIncidents],
  )

  // ── STALE HAZARDS ARE HELD BACK, NOT DROPPED ────────────────────────────
  //
  // Admin › Settings sets how long a hazard pin stays current before it wants
  // re-verifying. Past that it comes off the map by default, for the same
  // reason resolved pins do: a map is a picture of now, and a three-day-old
  // ── EVERY PIN, ALWAYS ─────────────────────────────────────────────────────
  //
  // This map used to hold back reports older than `hazardTtlHours` behind a
  // "hidden pending re-verification" notice with a toggle. That is gone by
  // request: the hazard map now draws every live report it is given, whatever
  // its age.
  //
  // The argument for hiding was that a months-old pothole pin misinforms
  // whoever reads the cluster. The argument against, which won, is that an
  // open report is a thing nobody has dealt with — and a console that hides
  // those makes the backlog look smaller than it is. `isHazardStale` is still
  // exported and still what the scheduled sweep archives RESOLVED reports on;
  // it simply no longer decides what an administrator can see.
  const incidents = live
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null

  // ── PANIC ALERTS ON THE ADMIN MAP ─────────────────────────────────────────
  //
  // This map had no panic layer at all — SOS markers were a guardhouse-only
  // feature. The Panic Alerts page's Locate action sends an administrator here,
  // so without the layer that button would have flown the camera to an empty
  // patch of roofs with nothing marking the spot.
  //
  // Read-only. `firestore.rules` lets an admin READ panic_alerts but restricts
  // UPDATE to security staff, so no acknowledge/resolve handler is wired here.
  // Clicking a node opens PanicAlertDetailModal — the record, with no write
  // controls. (It used to do nothing at all, which on an emergency marker read
  // as a broken pin.)
  const { alerts } = usePanicAlerts()
  const [selectedPanicId, setSelectedPanicId] = useState(null)
  // Resolved from the live list by id, so an alert the Guardhouse acknowledges
  // while this is open updates in place.
  const selectedPanic = alerts.find((alert) => alert.id === selectedPanicId) ?? null

  // The LAYER gets live alerts only; a resolved emergency is not a place anyone
  // needs to go. The FOCUS target is resolved from the full list, so Locate
  // still works on a closed alert — it flies to where it happened, and simply
  // finds no node there.
  const livePanicAlerts = useMemo(
    () => alerts.filter((alert) => isPanicLive(alert.status)),
    [alerts],
  )

  const focusId = searchParams.get('panic')
  // `?incident=<id>` — from a ticket's "Track on Hazard Map". Selects the
  // report (opening its drawer) and flies the camera to it.
  const incidentFocusId = searchParams.get('incident')
  const focus = useMemo(() => {
    if (focusId) {
      const alert = alerts.find((a) => a.id === focusId)
      if (!alert || typeof alert.lat !== 'number' || typeof alert.lng !== 'number') return null
      return { id: alert.id, lat: alert.lat, lng: alert.lng }
    }
    if (incidentFocusId) {
      const incident = incidents.find((i) => i.id === incidentFocusId)
      if (!incident || typeof incident.lat !== 'number' || typeof incident.lng !== 'number') return null
      return { id: `incident:${incident.id}`, lat: incident.lat, lng: incident.lng }
    }
    return null
  }, [focusId, incidentFocusId, alerts, incidents])

  useEffect(() => {
    if (!incidentFocusId) return
    if (incidents.some((i) => i.id === incidentFocusId)) setSelectedId(incidentFocusId)
  }, [incidentFocusId, incidents])

  // Consumed once the flight has been requested, so panning away and back does
  // not snap the camera again — same contract as the `?incident=` deep link.
  useEffect(() => {
    if (focus || (incidentFocusId && selectedId === incidentFocusId)) setSearchParams({}, { replace: true })
  }, [focus, incidentFocusId, selectedId, setSearchParams])

  return (
    <AppShell
      title="Hazard map"
      subtitle="Live resident reports and active SOS alerts."
      scroll={false}
      bleed
      inlineTitle
    >
      {/* A map cannot be auto-height: in a box with no height it collapses
          to zero. So this gets an explicit phone floor rather than just
          dropping `h-full` -- below `lg` the shell scrolls and the map
          occupies 28rem of it, and at `lg` and up it fills the workspace
          as before. The guardhouse map next door already did this with a
          20rem floor; a full-page hazard map earns a little more. */}
      {/* ── FILLS THE VIEWPORT ────────────────────────────────────────────
          `h-full` at every width, paired with `bleed` on the shell so this is
          edge-to-edge below `lg`.

          `h-full` resolves here because the shell's content box is a flex item
          with a height the flex algorithm has already settled — measured, not
          assumed: 700px at 375x812 before the padding came off. What it cannot
          resolve against is a parent whose height is `auto`, which is what
          `min-h-[28rem] lg:h-full` left below `lg` and why this rendered a
          0px canvas inside a correctly-sized empty box on every phone and
          tablet.

          The floor stays for a very short landscape window, where it is better
          to overflow and scroll than to show a letterbox. */}
      <div className="h-full min-h-[28rem]">
        {/* `centerOnSelect`: the clicked pin is centred behind the report
            modal, so it is where the eye lands when the modal closes. No
            `focusInset` — the modal is centred over a scrim (2026-10-19), not a
            rail covering one edge. */}
        <IncidentMap
          variant="full"
          incidents={incidents}
          selectedIncidentId={selectedId}
          onSelectIncident={(incident) => setSelectedId(incident.id)}
          panicAlerts={livePanicAlerts}
          onSelectPanicAlert={(alert) => setSelectedPanicId(alert.id)}
          focus={focus}
          centerOnSelect
        />
      </div>

      <HazardMapReportDetailsModal report={selected} onClose={() => setSelectedId(null)} />
      <PanicAlertDetailModal alert={selectedPanic} onClose={() => setSelectedPanicId(null)} />
    </AppShell>
  )
}
