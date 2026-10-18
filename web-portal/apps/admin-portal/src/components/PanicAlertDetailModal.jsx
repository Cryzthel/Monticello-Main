import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Crosshair,
  Phone,
  Satellite,
  Siren,
  User,
  X,
} from '@shared/icons'
import { panicSignal } from '@shared/lib/panicStatus'
import { acknowledgedByLabel } from '@shared/lib/panicAlerts'
import { ROUTES } from '@/config/portal'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { panicSignalIcon } from '@shared/theme/categoryIcons'
import Pill from '@shared/components/Pill'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { describeGeofence, geofenceState } from '@shared/lib/panicGeofence'
import { useNow } from '@shared/hooks/useNow'
import {
  describeEscalation,
  describeEscalationHistory,
  escalationState,
  unansweredMinutes,
} from '@shared/lib/operationsTargets'
import { formatDateTime } from '@shared/lib/dates'
import { toast } from '@shared/lib/toast'
import { DetailCard, DetailField } from '@shared/components/detail/DetailCard'

/** The same short code the SOS log prints, so an alert is quoted one way. */
const alertCode = (id) => `SOS-${String(id ?? '').slice(-6).toUpperCase()}`

const when = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : formatDateTime(date)
}

/** "4 min", "1 h 12 min" between two moments — how long a stage took. */
function took(from, to) {
  const minutes = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * The two compact cards and their facts are the shared DetailCard (compact)
 * and DetailField (2026-10-19), so this modal speaks the same card language as
 * the ticket, report and account details. `tone` colours the value.
 */
function Fact({ label, children, mono = false, tone = 'text-text-primary' }) {
  const empty = children == null || children === ''
  return (
    <DetailField label={label} mono={mono} empty={empty}>
      {empty ? '—' : <span className={`leading-snug ${tone}`}>{children}</span>}
    </DetailField>
  )
}

/**
 * One panic alert, opened from its circle on the Hazard Map.
 *
 *   ┌ [((siren))] Panic alert  SOS-4F2A9C   (● Active Emergency)          [×] ┐
 *   ├──────────────────────────────────┬────────────────────────────────────┤
 *   │ RESIDENT                         │ TIMELINE                           │
 *   │ Name · Contact number (Call)     │ Received · Responder · Resolved    │
 *   │ Property location                │                                    │
 *   ├──────────────────────────────────┴────────────────────────────────────┤
 *   │ LIVE GPS    10.76466, 122.51609  [Copy]   (boundary / no-fix note)    │
 *   │ (escalation note while unanswered, or its history)                    │
 *   ├────────────────────────────────────────────────────────────────────────┤
 *   │ Read-only on this console …                 (Close) (Open SOS log →)  │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * ── TIGHTENED (2026-10-19) ─────────────────────────────────────────────────
 * Resident and Received were three sections apart, `space-y-8` between them
 * and every value pushed off a 120px label column. They are now two compact
 * cards side by side, each label directly over its value, so the five facts
 * an operator needs — name, location, contact, received, GPS — read in one
 * glance. The resident's name is no longer repeated in the header.
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `alert` is resolved by id from the Hazard Map's live `panic_alerts`
 * listener (usePanicAlerts, onSnapshot), which keeps resolved alerts too — so
 * an acknowledgement, the responder, a resolution or a moved GPS fix from the
 * Guardhouse lands in the open modal in every admin console, and the
 * escalation note re-evaluates on every tick of `useNow`.
 *
 * ── READ-ONLY, BY RULE ─────────────────────────────────────────────────────
 * firestore.rules lets administrators READ `panic_alerts` and not write them.
 * So there is no Acknowledge or Resolve here; "Open SOS log" goes to the log
 * pre-filtered to this alert (`/sos?alert=SOS-XXXXXX`).
 */
export default function PanicAlertDetailModal({ alert, onClose }) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)
  const escalateAfterMinutes = useSystemSettings((state) => state.values.sos.escalateAfterMinutes)
  const now = useNow()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!alert) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [alert, onClose])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(alert), containerRef: panelRef })

  if (!alert) return null

  const signal = panicSignal(alert.status)
  const escalation = describeEscalation(escalationState(alert, now, escalateAfterMinutes), {
    minutes: escalateAfterMinutes,
    elapsedMinutes: unansweredMinutes(alert, now),
  })
  // Outlives the state it describes: "this went six minutes unanswered" is
  // exactly what an admin console is for, after the fact.
  const escalationHistory = describeEscalationHistory(alert, escalateAfterMinutes)

  const unit = [
    alert.phase ? `Phase ${alert.phase}` : null,
    alert.block ? `Block ${alert.block}` : null,
    alert.lot ? `Lot ${alert.lot}` : null,
  ]
    .filter(Boolean)
    .join(' • ')
  // mapPanicAlertDoc fills a missing label with this placeholder; it is not a
  // location, so the unit (or the em-dash) speaks instead.
  const address = alert.address && alert.address !== 'Address unavailable' ? alert.address : ''
  const location = address || unit
  const hasFix = typeof alert.lat === 'number' && typeof alert.lng === 'number'
  const coordinates = hasFix ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}` : ''

  // Boundary checks follow the admin setting; a MISSING fix is stated whether
  // or not that setting is on, because "we could not place this alert" is a
  // fact about the record, not a geofence opinion.
  const geofence = geofenceAlert ? describeGeofence(geofenceState(alert)) : null
  const gpsNotice =
    geofence ??
    (hasFix ? null : { tone: 'neutral', label: 'No location', detail: 'The alert arrived without a usable GPS fix, so it cannot be placed on the map.' })

  const responder = alert.acknowledgedAt ? acknowledgedByLabel(alert.acknowledgedByName) : ''

  async function copyCoordinates() {
    try {
      await navigator.clipboard.writeText(coordinates)
      setCopied(true)
    } catch {
      toast.error('Could not copy the coordinates', { description: 'Select them and copy by hand.' })
    }
  }

  const openLog = () => {
    onClose?.()
    navigate(`${ROUTES.sos}?alert=${encodeURIComponent(alertCode(alert.id))}`)
  }

  return createPortal(
    // Portalled to <body>: the map frame is an `isolate` stacking context.
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panic-detail-title"
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
      >
        {/* ── HEADER: siren, title and code, the live status ── */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="relative flex shrink-0 items-center justify-center rounded-lg bg-danger/10 p-2.5">
              <Siren size="md" className="relative z-10 text-danger" />
              {/* The ping only while the alert is live; a resolved alert's
                  siren sits still. Reduced motion stills it everywhere. */}
              {signal.live ? (
                <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-lg bg-danger/20 opacity-75 motion-reduce:hidden" />
              ) : null}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 id="panic-detail-title" className="text-lg font-bold tracking-tight text-danger">
                Panic alert
              </h2>
              <span className="font-mono text-xs tracking-wider text-text-muted">{alertCode(alert.id)}</span>
              <Pill tone={signal.tone} icon={panicSignalIcon(alert.status)} pulse={signal.live}>
                {signal.label}
              </Pill>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <X size={20} />
          </button>
        </header>

        {/* ── BODY ── */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-base-950/40 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailCard
              compact
              icon={User}
              title="Resident"
              action={
                alert.residentPhone ? (
                  <a
                    href={`tel:${alert.residentPhone}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-semibold text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  >
                    <Phone size={14} aria-hidden="true" />
                    Call
                  </a>
                ) : null
              }
            >
              <Fact label="Name">{alert.residentName}</Fact>
              <Fact label="Property location">{location}</Fact>
              {address && unit && address !== unit ? <Fact label="Unit">{unit}</Fact> : null}
              <Fact label="Contact number" mono>
                {alert.residentPhone}
              </Fact>
            </DetailCard>

            <DetailCard compact icon={Clock} title="Timeline">
              <Fact label="Received" mono>
                {when(alert.createdAt)}
              </Fact>
              <Fact label="Responder" tone={responder ? 'text-text-primary' : 'text-warning'}>
                {responder ? (
                  <>
                    {responder}
                    <span className="mt-0.5 block font-mono text-xs font-normal text-text-muted">
                      {when(alert.acknowledgedAt)}
                      {alert.createdAt ? ` · after ${took(alert.createdAt, alert.acknowledgedAt)}` : ''}
                    </span>
                  </>
                ) : signal.live ? (
                  'Awaiting acknowledgement'
                ) : null}
              </Fact>
              <Fact label="Resolved" mono tone="text-success">
                {when(alert.resolvedAt)}
              </Fact>
            </DetailCard>
          </div>

          <DetailCard
            compact
            icon={Crosshair}
            title="Live GPS"
            action={
              coordinates ? (
                <button
                  type="button"
                  onClick={copyCoordinates}
                  aria-label={copied ? 'Coordinates copied' : 'Copy coordinates'}
                  className="inline-flex items-center gap-1 rounded text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span className="text-[10px] font-medium uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
                </button>
              ) : null
            }
          >
            <Fact label="Coordinates" mono tone="text-brand-500">
              {coordinates ? <span className="select-all">{coordinates}</span> : null}
            </Fact>
            {gpsNotice ? (
              <p className="flex items-start gap-2 border-t border-dashed border-hairline pt-3 text-xs leading-relaxed text-text-secondary">
                {gpsNotice.tone === 'warning' ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                ) : (
                  <Satellite size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                )}
                <span>
                  <span className={`font-semibold ${gpsNotice.tone === 'warning' ? 'text-warning' : 'text-text-primary'}`}>
                    {gpsNotice.label}.
                  </span>{' '}
                  {gpsNotice.detail}
                </span>
              </p>
            ) : null}
          </DetailCard>

          {escalation || escalationHistory ? (
            <p
              role={escalation ? 'status' : undefined}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${
                escalation ? 'border-warning/20 bg-warning/10 text-warning' : 'border-hairline bg-base-900/40 text-text-secondary'
              }`}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0 opacity-80" aria-hidden="true" />
              <span>{escalation ?? escalationHistory}</span>
            </p>
          ) : null}
        </div>

        {/* ── FOOTER ── */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3.5">
          <p className="max-w-xs text-[11px] leading-snug text-text-muted">
            Read-only here. The Guardhouse acknowledges and resolves alerts.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={openLog}
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2 text-sm font-semibold text-[var(--color-cta-fg)] transition-colors hover:bg-[var(--color-cta-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-[0.97]"
            >
              Open SOS log
              <ArrowRight size="sm" className="transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
