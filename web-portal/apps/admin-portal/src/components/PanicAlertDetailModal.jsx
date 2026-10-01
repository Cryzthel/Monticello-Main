import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MapPin, Phone, Siren, UserRound, X } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { MetaItem, MetaList, MetaSection } from '@shared/components/MetaList'
import { panicSignal } from '@shared/lib/panicStatus'
import { acknowledgedByLabel } from '@shared/lib/panicAlerts'
import { ROUTES } from '@/config/portal'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { panicSignalIcon } from '@shared/theme/categoryIcons'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { describeGeofence, geofenceState } from '@shared/lib/panicGeofence'
import { useNow } from '@shared/hooks/useNow'
import {
  describeEscalation,
  describeEscalationHistory,
  escalationState,
  unansweredMinutes,
} from '@shared/lib/operationsTargets'

/** The same short code the SOS log prints, so an alert is quoted one way. */
const alertCode = (id) => `SOS-${String(id ?? '').slice(-6).toUpperCase()}`

const when = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * One panic alert, opened from its circle on the Hazard Map.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * The map has always drawn live SOS alerts and has always made their circles
 * clickable — `panic-hit` is the widest target on the canvas. But the admin
 * Hazard Map never passed `onSelectPanicAlert`, so on this console the click
 * landed and nothing happened. An administrator looking at an emergency on the
 * map had to leave the map to find out whose it was.
 *
 * ── READ-ONLY, BY RULE ─────────────────────────────────────────────────────
 * firestore.rules lets administrators READ `panic_alerts` and not write them:
 * the Guardhouse acknowledges and resolves, the admin console watches. So this
 * shows the record and offers the full log, and has no Acknowledge or Resolve
 * — a button here would only ever fail.
 *
 * The four fields the SOS log names as columns — Alert, Resident, Received,
 * Signal — are the first facts here, under the same labels, so the two views of
 * one alert read the same.
 */
export default function PanicAlertDetailModal({ alert, onClose }) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)
  const geofence = geofenceAlert ? describeGeofence(geofenceState(alert)) : null

  const escalateAfterMinutes = useSystemSettings((state) => state.values.sos.escalateAfterMinutes)
  const now = useNow()
  const escalation = describeEscalation(escalationState(alert, now, escalateAfterMinutes), {
    minutes: escalateAfterMinutes,
    elapsedMinutes: unansweredMinutes(alert, now),
  })
  // The stamp outlives the state it describes, and on this surface that is the
  // point: `escalation` is null once an officer acknowledges, but "this alert
  // went six minutes unanswered" is exactly what an admin console is for.
  const escalationHistory = describeEscalationHistory(alert, escalateAfterMinutes)

  const navigate = useNavigate()

  useEffect(() => {
    if (!alert) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [alert, onClose])

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(alert), containerRef: panelRef })

  if (!alert) return null

  const signal = panicSignal(alert.status)
  const unit = [
    alert.phase ? `Phase ${alert.phase}` : null,
    alert.block ? `Block ${alert.block}` : null,
    alert.lot ? `Lot ${alert.lot}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const coordinates =
    typeof alert.lat === 'number' && typeof alert.lng === 'number'
      ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`
      : ''

  return createPortal(
    // Portalled to <body>. The map frame is an `isolate` stacking context, and
    // a dialog rendered anywhere inside that subtree could never rise above it.
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panic-detail-title"
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-hairline bg-base-850 shadow-modal sm:rounded-xl"
      >
        <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-danger ring-1 ring-inset ring-danger/25">
            <Siren size="md" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="panic-detail-title" className="text-base font-semibold text-text-primary">
              Panic alert
            </h2>
            <p className="mt-0.5 truncate text-sm text-text-secondary">{alert.residentName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="icon-btn h-11 w-11 shrink-0 sm:h-8 sm:w-8"
          >
            <X size="sm" />
          </button>
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
          <MetaSection icon={Siren} title="Alert">
            <MetaList>
              <MetaItem label="Alert" mono>{alertCode(alert.id)}</MetaItem>
              <MetaItem label="Signal">
                <StatusBadge tone={signal.tone} size="sm" icon={panicSignalIcon(alert.status)}>{signal.label}</StatusBadge>
              </MetaItem>
              <MetaItem label="Received">{when(alert.createdAt)}</MetaItem>
              <MetaItem label="Acknowledged">
                {alert.acknowledgedAt
                  ? `${acknowledgedByLabel(alert.acknowledgedByName)} · ${when(alert.acknowledgedAt)}`
                  : ''}
              </MetaItem>
              <MetaItem label="Resolved">{when(alert.resolvedAt)}</MetaItem>
            </MetaList>
            {escalation ? (
              <p className="mt-2 text-2xs leading-relaxed text-text-muted">{escalation}</p>
            ) : escalationHistory ? (
              <p className="mt-2 text-2xs leading-relaxed text-text-muted">{escalationHistory}</p>
            ) : null}
          </MetaSection>

          <MetaSection
            icon={UserRound}
            title="Resident"
            action={
              alert.residentPhone ? (
                <a href={`tel:${alert.residentPhone}`} className="btn btn-sm btn-outline">
                  <Phone size="sm" />
                  Call
                </a>
              ) : null
            }
          >
            <MetaList>
              <MetaItem label="Resident">{alert.residentName}</MetaItem>
              <MetaItem label="Phone">{alert.residentPhone}</MetaItem>
            </MetaList>
          </MetaSection>

          <MetaSection icon={MapPin} title="Location">
            <MetaList>
              <MetaItem label="Address">{alert.address}</MetaItem>
              <MetaItem label="Unit">{unit}</MetaItem>
              <MetaItem label="Coordinates" mono>{coordinates}</MetaItem>
              {/* Unlike the guardhouse interrupt, this surface states the
                  unknown case too. Nobody is being dispatched from here — the
                  useful question on an admin console is "which alerts could we
                  not place", which is exactly the set a responder-facing badge
                  would be wrong to shout about. */}
              {geofence ? <MetaItem label="Boundary">{geofence.label}</MetaItem> : null}
            </MetaList>
            {geofence ? (
              <p className="mt-2 text-2xs leading-relaxed text-text-muted">{geofence.detail}</p>
            ) : null}
          </MetaSection>

          <p className="text-xs leading-relaxed text-text-muted">
            Read-only on this console. The Guardhouse acknowledges and resolves alerts; the admin
            portal watches the stream.
          </p>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-hairline px-5 py-3.5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn btn-sm btn-outline">
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.()
              navigate(ROUTES.sos)
            }}
            className="btn btn-sm btn-brand"
          >
            Open SOS log
            <ArrowRight size="sm" />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
