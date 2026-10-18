import IncidentDetailModal from '@shared/components/IncidentDetailModal'

/**
 * The Admin console's ticket details: the shared modal with Export summary
 * and Close, and no primary action.
 *
 * ── NO DISPATCH BUTTON, BY RULE ───────────────────────────────────────────
 * firestore.rules let admin staff update an incident only when no workflow
 * field changes (`isAdminStaff() && !touchesWorkflow()`). Assigning an officer
 * writes `assignedGuardUid`, `dispatchStage` and the rest, so a dispatch button
 * here would be refused by the server on every press. "Acknowledge & assign
 * officer" lives on the Guardhouse's copy of this modal, which hands off to its
 * dispatch drawer.
 *
 * The "Track on Hazard Map" action that stood here was removed at the user's
 * request (2026-10-18). The map still accepts `/heatmap?incident=<id>`.
 */
export default function IncidentTicketDetailsModal({ report, onClose }) {
  return (
    <IncidentDetailModal
      report={report}
      onClose={onClose}
      footerNote="Monticello Villas · Admin incident record"
    />
  )
}
