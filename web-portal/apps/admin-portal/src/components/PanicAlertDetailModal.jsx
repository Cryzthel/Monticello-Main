import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  MapPin,
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

/** The same short code the SOS log prints, so an alert is quoted one way. */
const alertCode = (id) => `SOS-${String(id ?? '').slice(-6).toUpperCase()}`

const when = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : formatDateTime(date)
}

function SectionTitle({ icon: Icon, action = null, children }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-muted">
        <Icon size={14} aria-hidden="true" />
        {children}
      </h3>
      {action}
    </div>
  )
}

/** Label/value rows on a fixed label column. Empty values print a muted em-dash. */
function Facts({ rows, labelWidth = '120px' }) {
  return (
    <dl className="grid gap-x-4 gap-y-4 text-sm" style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}>
      {rows.map(({ label, value, mono = false }) => (
        <div key={label} className="contents">
          <dt className="pt-0.5 text-text-muted">{label}</dt>
          <dd
            className={`min-w-0 break-words font-medium leading-relaxed ${mono ? 'font-mono tracking-wide' : ''} ${
              value ? 'text-text-primary' : 'text-text-muted/70'
            }`}
          >
            {value || '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One panic alert, opened from its circle on the Hazard Map.
 *
 *   ┌ [((siren))] Panic alert                                         [×] ┐ sticky
 *   │             Lian Nicole Jabagat                                     │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ ALERT     code · signal pill · received · acknowledged · resolved  │
 *   │           (escalation note while unanswered, or its history)       │
 *   │ RESIDENT  name · phone (Call)                                      │
 *   │ LOCATION  ┌ address · unit · coordinates ┐                         │
 *   │           ├╌ GPS / boundary banner ╌╌╌╌╌╌┤                         │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │                                   (Close) (Open SOS log →)         │ sticky
 *   │ Read-only on this console …                                        │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `alert` is resolved by id from the Hazard Map's live `panic_alerts`
 * listener (usePanicAlerts), which keeps resolved alerts too — so an
 * acknowledgement or resolution from the Guardhouse lands in the open modal,
 * and the escalation note re-evaluates on every tick of `useNow`.
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
  const hasFix = typeof alert.lat === 'number' && typeof alert.lng === 'number'
  const coordinates = hasFix ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}` : ''

  // The GPS banner. Boundary checks follow the admin setting; a MISSING fix is
  // stated whether or not that setting is on, because "we could not place this
  // alert" is a fact about the record, not a geofence opinion.
  const geofence = geofenceAlert ? describeGeofence(geofenceState(alert)) : null
  const gpsNotice =
    geofence ??
    (hasFix
      ? null
      : { tone: 'neutral', label: 'No location', detail: 'The alert arrived without a usable GPS fix, so it cannot be placed on the map.' })

  const openLog = () => {
    onClose?.()
    navigate(`${ROUTES.sos}?alert=${encodeURIComponent(alertCode(alert.id))}`)
  }

  return createPortal(
    // Portalled to <body>: the map frame is an `isolate` stacking context.
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panic-detail-title"
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl dark:bg-base-950"
      >
        {/* ── STICKY HEADER: the pulsing siren, the title, whose alert ── */}
        <header className="sticky top-0 z-30 flex shrink-0 items-start justify-between border-b border-hairline bg-base-900/80 px-6 py-5 backdrop-blur-xl dark:bg-base-950/80">
          <div className="flex min-w-0 items-center gap-4">
            <span className="relative flex shrink-0 items-center justify-center rounded-lg bg-danger/10 p-2.5">
              <Siren size="md" className="relative z-10 text-danger" />
              {/* The ping only while the alert is live; a resolved alert's
                  siren sits still. Reduced motion stills it everywhere. */}
              {signal.live ? (
                <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-lg bg-danger/20 opacity-75 motion-reduce:hidden" />
              ) : null}
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 id="panic-detail-title" className="text-base font-semibold leading-tight tracking-tight text-danger">
                Panic alert
              </h2>
              <p className="mt-0.5 truncate text-sm text-text-secondary">{alert.residentName || 'Unknown resident'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <X size="md" />
          </button>
        </header>

        {/* ── BODY ── */}
        <div className="hide-scrollbar relative z-10 min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain p-6">
          <section>
            <SectionTitle icon={BellRing}>Alert</SectionTitle>
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-4 text-sm">
              <dt className="text-text-muted">Alert</dt>
              <dd className="font-mono font-medium tracking-wide text-text-primary">{alertCode(alert.id)}</dd>
              <dt className="pt-0.5 text-text-muted">Signal</dt>
              <dd>
                <Pill tone={signal.tone} icon={panicSignalIcon(alert.status)}>
                  {signal.label}
                </Pill>
              </dd>
            </dl>
            <div className="mt-4">
              <Facts
                rows={[
                  { label: 'Received', value: when(alert.createdAt) },
                  {
                    label: 'Acknowledged',
                    value: alert.acknowledgedAt
                      ? `${acknowledgedByLabel(alert.acknowledgedByName)} · ${when(alert.acknowledgedAt)}`
                      : '',
                  },
                  { label: 'Resolved', value: when(alert.resolvedAt) },
                ]}
              />
            </div>
            {escalation || escalationHistory ? (
              <p
                role={escalation ? 'status' : undefined}
                className={`mt-5 flex items-start gap-3 rounded-xl border p-4 text-xs leading-relaxed ${
                  escalation
                    ? 'border-warning/20 bg-warning/10 text-warning'
                    : 'border-hairline bg-base-800/60 text-text-secondary dark:bg-base-900/40'
                }`}
              >
                <AlertTriangle size="sm" className="mt-px shrink-0 opacity-80" aria-hidden="true" />
                <span>{escalation ?? escalationHistory}</span>
              </p>
            ) : null}
          </section>

          <section>
            <SectionTitle
              icon={User}
              action={
                alert.residentPhone ? (
                  <a
                    href={`tel:${alert.residentPhone}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-xs font-semibold text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary"
                  >
                    <Phone size={14} aria-hidden="true" />
                    Call
                  </a>
                ) : null
              }
            >
              Resident
            </SectionTitle>
            <Facts
              rows={[
                { label: 'Resident', value: alert.residentName },
                { label: 'Phone', value: alert.residentPhone },
              ]}
            />
          </section>

          <section>
            <SectionTitle icon={MapPin}>Location</SectionTitle>
            <div className="overflow-hidden rounded-xl border border-hairline bg-base-800/60 dark:bg-base-900/40">
              <div className="p-5">
                <Facts
                  labelWidth="100px"
                  rows={[
                    { label: 'Address', value: alert.address || unit },
                    // Only when the free-text address does not already say it.
                    ...(alert.address && unit && alert.address !== unit ? [{ label: 'Unit', value: unit }] : []),
                    { label: 'Coordinates', value: coordinates, mono: true },
                  ]}
                />
              </div>
              {gpsNotice ? (
                <div className="flex items-start gap-3 border-t border-dashed border-hairline px-5 py-4">
                  {gpsNotice.tone === 'warning' ? (
                    <AlertTriangle size="sm" className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  ) : (
                    <Satellite size="sm" className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                  )}
                  <p className="text-sm leading-relaxed text-text-secondary">
                    <span className={`font-medium ${gpsNotice.tone === 'warning' ? 'text-warning' : 'text-text-primary'}`}>
                      {gpsNotice.label}.
                    </span>{' '}
                    {gpsNotice.detail}
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* ── STICKY FOOTER ── */}
        <footer className="sticky bottom-0 z-30 shrink-0 border-t border-hairline bg-base-900/80 px-6 py-5 backdrop-blur-xl dark:bg-base-950/80">
          <div className="mb-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={openLog}
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-6 py-2.5 text-sm font-semibold text-[var(--color-cta-fg)] shadow-[0_0_20px_-5px_color-mix(in_oklab,var(--color-cta)_30%,transparent)] transition-colors hover:bg-[var(--color-cta-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-[0.97]"
            >
              Open SOS log
              <ArrowRight size="sm" className="transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true" />
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-text-muted">
            Read-only on this console. The Guardhouse acknowledges and resolves alerts; the admin portal
            watches the stream.
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
