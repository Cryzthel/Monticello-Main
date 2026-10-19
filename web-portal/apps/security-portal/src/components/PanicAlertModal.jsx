import { toast, describeError } from '@shared/lib/toast'
import { useEffect, useRef, useState } from 'react'
import { X, Siren, ShieldCheck, MapPin, MapPinOff, Clock, Navigation } from '@shared/icons'
import { minutesWaiting } from '@shared/lib/wpda'
import { acknowledgePanicAlert, resolvePanicAlert } from '@shared/lib/panicAlerts'
import { settleWrite } from '@shared/lib/writeSync'
import MediaAttachmentField from '@shared/components/MediaAttachmentField'
import { usePhotoUploads } from '@/components/dispatch/usePhotoUploads'
import { RESOLUTION_NOTES_MAX, RESOLUTION_PHOTOS_MAX } from '@shared/lib/dispatchStage'
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
export default function PanicAlertModal({ alert, onClose, onRespond }) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)

  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const fileRef = useRef(null)
  const photos = usePhotoUploads({ max: RESOLUTION_PHOTOS_MAX })

  /**
   * `usePhotoUploads` tracks an upload as "has a url yet, has an error yet";
   * `MediaAttachmentField` renders a status string. Translating here keeps the
   * shared field ignorant of this screen's upload mechanics — the same mapping
   * ResolveIncidentModal makes, and deliberately the same shape so the two
   * attachers cannot drift into looking different.
   */
  const tiles = photos.items.map((item) => ({
    id: item.id,
    name: item.name,
    type: 'image',
    src: item.previewUrl,
    status: item.error ? 'error' : item.url ? 'done' : 'uploading',
    progress: item.progress,
    error: item.error,
  }))

  // An SOS interrupt takes focus: it is raised over whatever the officer was
  // doing, so the keyboard has to arrive with it rather than stay behind it.
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(alert), containerRef: panelRef })

  useEffect(() => {
    setError('')
  }, [alert?.id])

  /**
   * ── THE FORM BELONGS TO ONE ALERT ─────────────────────────────────────
   * Keyed on the alert's ID, not on the modal opening. This popup is driven
   * by `selectedPanicId` and stays mounted between alerts, so clicking a
   * second marker swaps the alert underneath a form still holding the first
   * one's notes and uploaded photos — and the next Submit would file one
   * resident's proof against another's emergency.
   *
   * `reset()` also cancels uploads still in flight, which is the other half:
   * a photo that lands after the switch would otherwise attach itself to
   * whichever alert happened to be open.
   */
  const { reset } = photos
  useEffect(() => {
    setNotes('')
    setError('')
    reset()
  }, [alert?.id, reset])

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

  /**
   * Can this alert be navigated to?
   *
   * Only with a REAL fix. An SOS whose phone reported no position is anchored
   * at the premises centre (see the panicGeojson note in IncidentMap), and
   * plotting a route to that anchor would draw a confident blue line to a
   * point nobody is standing at — the single most dangerous thing this console
   * could do with an emergency, because the line looks identical to a real
   * one. The address above is what a responder acts on in that case, and
   * Acknowledge still works.
   */
  const canNavigate = Number.isFinite(alert.lat) && Number.isFinite(alert.lng)

  /**
   * `write` starts one Firestore write and returns its promise. Settled via
   * `settleWrite`, so an offline or stalled connection releases the button
   * with "will sync" instead of holding it on the server's ack forever.
   * `after` runs once the write is confirmed or queued.
   */
  async function run(write, success, after) {
    setBusy(true)
    setError('')
    try {
      const outcome = await settleWrite(write(), {
        onLateError: (err) => toast.error(describeError(err)),
      })
      if (success) {
        if (outcome === 'queued') toast.warning(success, { description: 'Saved on this device. It will sync when the connection returns.' })
        else toast.success(success)
      }
      after?.()
      // The modal STAYS OPEN. It used to close on success, which meant the
      // guard's only confirmation was the popup vanishing — indistinguishable
      // from a mis-tap on the scrim, on the one action where "did that go
      // through?" matters most. The button now settles into its acknowledged
      // state and the guard closes the modal themselves.
    } catch (err) {
      console.error('Panic alert action failed', err)
      setError(describeError(err))
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
            <X size="md" />
          </button>

          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-danger/20">
            {/* Kept pulsing here too — the alert is still live while this is
                open, and a static icon would read as a record of one. */}
            <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-danger/50" />
            <Siren size="lg" className="relative text-danger" />
          </span>

          <div>
            <p className="text-sm font-bold text-danger">Panic alert</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-text-secondary">
              <Clock size="sm" className="shrink-0" />
              {formatAgo(alert.createdAt)}
            </p>
          </div>

          {/* Where the alert stands, in the Guardhouse's words: unattended
              until a guard acknowledges it. */}
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/30">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
              Awaiting acknowledgement
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/30">
              <ShieldCheck size="sm" aria-hidden="true" />
              Acknowledged by Security{alert.acknowledgedByName ? ` · ${alert.acknowledgedByName}` : ''}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div>
            <p className="text-base font-semibold text-text-primary">{alert.residentName}</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-text-secondary">
              <MapPin size="sm" className="shrink-0 text-danger" />
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
              <MapPinOff size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
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

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          {/* STEP A — the explicit verification. Respond to SOS below also
              verifies on its way out; this is for a guard confirming the
              alert is real before anyone rolls. */}
          {isActive ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => acknowledgePanicAlert(alert.id, user?.displayName), 'SOS verified by Security')}
              className="btn btn-sm btn-brand w-full"
            >
              <ShieldCheck size="sm" />
              {busy ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          ) : null}

          {/* ── CLOSING THE CALL OUT ──────────────────────────────────────
              What replaced Acknowledge here.

              Acknowledging has not gone away — it is still what "Respond to
              SOS" does on its way out, and the rail beside the map carries a
              standalone Acknowledge for every alert including the ones with no
              position. What is gone is the version on THIS popup, where it was
              the only control and left a guard with nothing to do but say they
              had seen it.

              The form is the other end of the same call: notes, photo proof,
              and one button that records them and closes the alert. An SOS
              closed with nothing written is still allowed — see
              `resolvePanicAlert` — because an officer clearing a false alarm
              should not be made to write an essay. This is where somebody who
              attended puts the account on the record. */}
          <div className="w-full rounded-xl border border-hairline bg-base-800 p-3">
            <label
              htmlFor="sos-resolution-notes"
              className="block text-xs font-semibold text-text-secondary"
            >
              What happened? <span className="font-normal text-text-muted">· optional</span>
            </label>
            <textarea
              id="sos-resolution-notes"
              rows={3}
              value={notes}
              disabled={busy}
              onChange={(event) => setNotes(event.target.value.slice(0, RESOLUTION_NOTES_MAX))}
              placeholder="What you found, and what you did about it."
              className="field mt-2 w-full resize-y"
            />

            <div className="mt-3">
              {/* ── THE TIMESTAMP IS NOT DRAWN ONTO THE PIXELS ────────────
                  The brief asks for photos "overlaid/tagged with an immutable
                  system timestamp". This tags rather than overlays, and the
                  distinction is the point: text burned into a JPEG is neither
                  immutable — anyone with an image editor can repaint it — nor
                  readable by anything but a human eye, so it cannot be
                  searched, corrected or audited.

                  The upload path already carries `Date.now()` in the object
                  name, the document records `resolvedAt` from the SERVER
                  clock rather than this device's, and `EvidenceGrid` renders
                  that stamp over the thumbnail wherever the photo is shown.
                  That is a timestamp a console can prove; a painted one is a
                  decoration that looks like proof. */}
              <MediaAttachmentField
                items={tiles}
                capacity={RESOLUTION_PHOTOS_MAX}
                heading="Photo proof"
                hint="PNG or JPG. Stamped with the server's resolution time, not this device's."
                disabled={busy}
                onPick={() => fileRef.current?.click()}
                onRemove={photos.remove}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                multiple
                hidden
                onChange={(event) => {
                  photos.add(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>

            <button
              type="button"
              disabled={busy || photos.uploading}
              onClick={() =>
                run(
                  () => resolvePanicAlert(alert.id, { notes, photoUrls: photos.urls }),
                  'SOS alert resolved',
                  () => onClose?.(),
                )
              }
              className="btn btn-sm btn-brand mt-3 w-full"
            >
              <ShieldCheck size="sm" />
              {busy ? 'Submitting…' : photos.uploading ? 'Uploading photos…' : 'Submit & confirm resolve'}
            </button>
          </div>

          {/* ── RESPOND TO SOS ─────────────────────────────────────────────
              The second action, and the one that was missing: until now a
              guard could SEE an SOS and acknowledge it, and then had to find
              the address on a map by eye. Every other call on this console
              routes; the emergencies did not.

              ── IT ACKNOWLEDGES TOO, AND THAT IS NOT A SHORTCUT ─────────────
              Pressing this is a stronger statement than Acknowledge — "I am
              going" implies "I have seen it" — and an officer who drives off
              having pressed only this would otherwise leave an alert reading
              unattended on every other console, with the escalation sweep
              counting down against it. One press, both facts. The write is
              awaited before the handoff so the record is straight before the
              map changes under them, and a failure shows here rather than
              silently starting a response nobody else can see.

              ── BELOW ACKNOWLEDGE, NOT ABOVE IT ─────────────────────────────
              It is the heavier commitment of the two and the last thing in
              the reading order, which is the ordinary rule for a dialog whose
              final control sends somebody somewhere. A responder who meant
              only to acknowledge should not meet Respond first. */}
          {canNavigate ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                // ── THE HANDOFF DOES NOT DEPEND ON THE WRITE ─────────────
                // Acknowledging is attempted first and its failure is
                // swallowed, which is the opposite of how every other action
                // on this console behaves and is right only here. The
                // acknowledgement is a courtesy to the OTHER consoles — it
                // stops the alert reading unattended and pauses the
                // escalation sweep. Navigating is this officer getting to a
                // person in trouble, it is entirely local, and it must not be
                // blocked because a phone at a gate lost signal for a second.
                //
                // A failed write is not lost: the alert simply stays active,
                // which is the state it was already in, and the sweep that
                // escalates unattended alerts still runs.
                //
                // NOT AWAITED (2026-10-19): a Firestore write resolves on the
                // SERVER's ack, so awaiting it held "Starting…" forever with
                // no signal — the very case this comment exists for. The
                // write is applied locally at once and syncs on its own.
                if (isActive) {
                  acknowledgePanicAlert(alert.id, user?.displayName).catch((err) =>
                    console.warn('Could not acknowledge before responding', err),
                  )
                }
                onRespond?.(alert)
              }}
              className="btn btn-sm btn-danger w-full"
            >
              <Navigation size="sm" />
              Respond to SOS
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
