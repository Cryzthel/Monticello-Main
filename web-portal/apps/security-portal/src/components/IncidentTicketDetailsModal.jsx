import { useNavigate } from 'react-router-dom'
import { Radio, UserCheck } from '@shared/icons'
import IncidentDetailModal from '@shared/components/IncidentDetailModal'
import { ROUTES } from '@/config/portal'

/**
 * The Guardhouse's ticket details: the shared modal plus the dispatch hand-off.
 *
 * "Acknowledge & assign officer" does not write from here. It opens this
 * incident in Live dispatch (`/dashboard?incident=<id>`), whose drawer runs the
 * real workflow — unit picker, stage-transition checks in firestore.rules, the
 * status log and the resident notification — so there is exactly one place a
 * call is dispatched from, and the audit trail it leaves is the same either way.
 *
 * Once a unit is on the call the button becomes "Open in live dispatch"; a
 * resolved call has nothing left to dispatch, so it has no primary action.
 */
export default function IncidentTicketDetailsModal({ report, onClose }) {
  const navigate = useNavigate()

  const openInDispatch = (current) => {
    onClose?.()
    navigate(`${ROUTES.dashboard}?incident=${current.id}`)
  }

  let primaryAction = null
  if (report && !report.resolvedAt) {
    primaryAction = report.dispatchedAt
      ? {
          label: 'Open in live dispatch',
          icon: Radio,
          hint: `On the call: ${report.assignedGuardName || 'an assigned officer'}.`,
          onClick: openInDispatch,
        }
      : {
          label: 'Acknowledge & assign officer',
          icon: UserCheck,
          tone: 'amber',
          hint: 'Guardhouse dispatch system • Monticello Villas',
          onClick: openInDispatch,
        }
  }

  return (
    <IncidentDetailModal
      report={report}
      onClose={onClose}
      footerNote="Monticello Villas Guardhouse · incident record"
      primaryAction={primaryAction}
    />
  )
}
