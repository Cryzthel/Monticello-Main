import { useEffect, useRef, useState } from 'react'
import { X, Siren, ShieldCheck, MapPin, MapPinOff, Clock } from 'lucide-react'
import { minutesWaiting } from '@shared/lib/wpda'
import { acknowledgePanicAlert, acknowledgedByLabel } from '@shared/lib/panicAlerts'
import { useAuth } from '@shared/auth/AuthContext'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { isOutsideBoundary } from '@shared/lib/panicGeofence'

function formatAgo(createdAt) {
  const minutes = minutesWaiting(createdAt)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.round(minutes)}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

/**
 * The controls for one panic alert, opened by its node on the dispatch map.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Acknowledge, Resolve and Call lived on the banner above the map. Removing
 * that banner without rehoming them would not have been a cleanup — it would
 * have left the guardhouse able to SEE an SOS and unable to do anything about
 * it, with `acknowledgePanicAlert` and `resolvePanicAlert` still exported and
 * called from nowhere.
 *
 * A modal rather than an in-map card, because the brief for removing the
 * banner was an unobstructed map: an overlay pinned to a corner is a smaller
 * version of the same problem, permanently covering whatever it sits on. This
 * covers the map only while a guard is deliberately acting on an alert, and
 * one click on a node that is now impossible to miss is what opens it.
 */
export default function PanicAlertModal({ alert, onClose }) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)

  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // An SOS interrupt takes focus: it is raised over whatever the officer was
  // doing, so the keyboard has to arrive with it rather than stay behind it.
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(alert), containerRef: panelRef })

  useEffect(() => {
    setError('')
  }, [alert?.id])

  useEffect(() => {
    if (!alert) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [alert, onClose])

  if (!alert) return null

  // Read from the LIVE alert, not from local state. The document updates itself
  // through the same query that opened this popup, so the button settles into
  // its acknowledged state because the alert did — not because this component
  // remembered a click that may not have landed.
  const isActive = alert.status === 'active'

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      // The modal STAYS OPEN. It used to close on success, which meant the
      // guard's only confirmation was the popup vanishing — indistinguishable
      // from a mis-tap on the scrim, on the one action where "did that go
      // through?" matters most. The button now settles into its acknowledged
      // state and the guard closes the modal themselves.
    } catch (err) {
      console.error('Panic alert action failed', err)
      setError(err.message ?? 'Could not update the alert. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Panic alert from ${alert.residentName}`}
        className="card dialog-panel w-full max-w-md overflow-hidden bg-base-900 shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────────
            Centred column, not a left-aligned row with the close button
            opposite it. Everything on this popup is one statement about one
            alert — the siren, the word, the age, the state — and a row layout
            split that statement across two edges with the resident's name
            starting somewhere else again below. The close button lifts out to
            the corner so it is not part of the reading order at all. */}
        <div className="relative flex flex-col items-center gap-3 border-b border-danger/30 bg-danger/10 p-6 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panic alert"
            className="btn btn-icon-sm absolute right-3 top-3 text-text-secondary hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-danger/20">
            {/* Kept pulsing here too — the alert is still live while this is
                open, and a static icon would read as a record of one. */}
            <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-danger/50" />
            <Siren className="relative h-6 w-6 text-danger" />
          </span>

          <div>
            <p className="text-sm font-bold text-danger">Panic alert</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-text-secondary">
              <Clock className="h-3 w-3 shrink-0" />
              {formatAgo(alert.createdAt)}
            </p>
          </div>

          <span className="inline-flex h-6 items-center rounded-full bg-danger/15 px-2.5 text-caption font-semibold text-danger ring-1 ring-inset ring-danger/30">
            {alert.status}
          </span>
        </div>

        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div>
            <p className="text-base font-semibold text-text-primary">{alert.residentName}</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-text-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-danger" />
              {alert.address}
            </p>
          </div>

          {/*
            OUTSIDE THE BOUNDARY, and nothing else.

            This deliberately does NOT restore the "No GPS fix" notice removed
            below: that was taken out by request, and an alert with no fix is
            still an alert a responder acts on from the address line. What is
            new here is a different claim — the phone reported a position and
            it is not on the premises — which changes what the responder should
            do before they roll.
          */}
          {geofenceAlert && isOutsideBoundary(alert) ? (
            <p className="flex w-full items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-left text-xs leading-relaxed text-text-primary">
              <MapPinOff aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                <span className="font-semibold text-warning">Outside the subdivision.</span> This SOS
                reported a position beyond the registered boundary — confirm the location before
                dispatching.
              </span>
            </p>
          ) : null}

          {/* The amber "No GPS fix" panel that sat here is gone by request.
              The address line above is what a responder acts on either way,
              and the marker still carries an amber ring when its position is
              the premises anchor rather than a fix. Worth knowing that this
              was the only place that distinction was stated in WORDS. */}

          {alert.acknowledgedByName ? (
            <p className="w-full rounded-xl border border-hairline bg-base-800 p-3 text-xs text-text-secondary">
              Acknowledged by{' '}
              <span className="text-text-primary">
                {acknowledgedByLabel(alert.acknowledgedByName)}
              </span>
            </p>
          ) : null}

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          {/* ── ONE ACTION ────────────────────────────────────────────────
              Acknowledge only. Resolve and Call have moved off this popup.

              The map is where a guard decides to GO; closing a case and
              phoning a resident are follow-up, and both still exist on the
              Panic Alerts page — Resolve in the row menu, the number as a
              tel: link in the resident cell. Nothing became unreachable.

              An acknowledged alert now shows a DISABLED button reading
              "Acknowledged" rather than no button at all. Hiding it was the
              earlier call, on the reasoning that a greyed control invites a
              second press on an emergency — but it also meant the popup a
              guard was looking at when they pressed simply lost its only
              control, with nothing confirming the press had registered. A
              disabled control cannot be pressed twice, and it says what
              happened. */}
          <button
            type="button"
            disabled={busy || !isActive}
            onClick={() =>
              run(() => acknowledgePanicAlert(alert.id, user?.displayName))
            }
            className={
              isActive
                ? 'btn btn-sm btn-warning w-full'
                : 'btn btn-sm w-full cursor-not-allowed border border-slate-200 bg-base-800 text-text-muted opacity-100'
            }
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {isActive ? (busy ? 'Acknowledging…' : 'Acknowledge report') : 'Acknowledged'}
          </button>
        </div>
      </div>
    </div>
  )
}
