import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, MapPin, MapPinOff, Navigation, ShieldCheck, Siren, X } from '@shared/icons'
import { toast, describeError } from '@shared/lib/toast'
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

/** How long the exit runs; matches `.dialog-panel-out` in the shared CSS. */
const EXIT_MS = 150

function formatAgo(createdAt) {
  const minutes = minutesWaiting(createdAt)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.round(minutes)}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

/**
 * THE SOS RESOLUTION MODAL, driven by the alert's state (2026-10-19, by
 * request; replaces PanicAlertModal, which showed Respond, Acknowledge and the
 * whole resolve form at once — so "Respond to SOS" and "Submit & confirm
 * resolve" sat on screen together for an alert nobody had answered yet).
 *
 * One state, one action — the machine in lib/panicAlerts:
 *
 *   active        "Awaiting acknowledgement". The ONLY action is Respond to
 *                 SOS (acknowledges and starts navigation), or Acknowledge for
 *                 an alert with no GPS fix, which cannot be navigated to.
 *                 No notes, no photos, no resolve.
 *   acknowledged  "Acknowledged by Security · Name". The account of what
 *                 happened, photo proof, and Submit & confirm resolve.
 *   resolved      The live list drops resolved alerts, so the modal closes
 *                 itself; it never offers an action on one.
 *
 * Read from the LIVE alert, never from a click this console remembers: the
 * state flips because the document did, so a second console sees the form
 * unlock the moment the first guard acknowledges.
 *
 * Layout from the "Panic Alert Resolution Modal — Pro Max" reference: a dark
 * glass panel in BOTH themes (`.dark` scopes every token inside), sticky
 * header and footer, and the form chunked into labelled sections.
 */
export default function ConditionalPanicResolutionModal({ alert, ...rest }) {
  // Held through the exit so the panel leaves rather than vanishes — the same
  // presence pattern as the report modal (DispatchDetailDrawer).
  const [held, setHeld] = useState(alert)
  const [closing, setClosing] = useState(false)
  if (alert && held !== alert) {
    setHeld(alert)
    setClosing(false)
  } else if (!alert && held && !closing) {
    setClosing(true)
  }
  useEffect(() => {
    if (!closing) return undefined
    const timer = setTimeout(() => {
      setHeld(null)
      setClosing(false)
    }, EXIT_MS)
    return () => clearTimeout(timer)
  }, [closing])

  if (!held) return null
  return <PanicResolutionPanel alert={held} closing={closing} {...rest} />
}

function PanicResolutionPanel({ alert, closing, onClose, onRespond, respondingId = null }) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)
  const { user } = useAuth()
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const [notes, setNotes] = useState('')
  const fileRef = useRef(null)
  const photos = usePhotoUploads({ max: RESOLUTION_PHOTOS_MAX })

  const panelRef = useRef(null)
  useDialogFocus({ open: !closing, containerRef: panelRef })

  // The form belongs to ONE alert: switching alerts clears the notes and
  // cancels uploads still in flight, so proof never lands on the wrong SOS.
  const { reset } = photos
  useEffect(() => {
    setNotes('')
    setNotice(null)
    reset()
  }, [alert.id, reset])

  useEffect(() => {
    if (closing) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closing, onClose])

  const acknowledged = alert.status === 'acknowledged'
  const canNavigate = Number.isFinite(alert.lat) && Number.isFinite(alert.lng)
  const outside = geofenceAlert && isOutsideBoundary(alert)
  const mine = acknowledged && alert.acknowledgedBy && alert.acknowledgedBy === user?.uid
  const responding = respondingId === alert.id

  const tiles = photos.items.map((item) => ({
    id: item.id,
    name: item.name,
    type: 'image',
    src: item.previewUrl,
    status: item.error ? 'error' : item.url ? 'done' : 'uploading',
    progress: item.progress,
    error: item.error,
  }))

  /**
   * One write, settled with `settleWrite` so a stalled connection releases
   * the button with "will sync". A lost race (another officer acted first) is
   * news, not an error: an info line naming who, and the live alert redraws.
   */
  async function run(key, write, success, after) {
    setBusy(key)
    setNotice(null)
    try {
      const outcome = await settleWrite(write(), { onLateError: (err) => toast.error(describeError(err)) })
      if (outcome === 'queued') toast.warning(success, { description: 'Saved on this device. It will sync when the connection returns.' })
      else toast.success(success)
      after?.()
    } catch (err) {
      if (err?.code === 'sos-conflict') setNotice({ tone: 'info', text: err.message })
      else {
        console.error('Panic alert action failed', err)
        setNotice({ tone: 'danger', text: describeError(err) })
      }
    } finally {
      setBusy(null)
    }
  }

  /**
   * Respond to SOS: acknowledge AND go. Navigation does not wait on the
   * write — getting to a person in trouble must not hang on a gate's signal —
   * but the acknowledgement is real and its outcome is reported: if another
   * officer got there first, this one is told they are responding as backup.
   */
  function respond() {
    acknowledgePanicAlert(alert.id, user?.displayName).catch((err) => {
      if (err?.code === 'sos-conflict') toast.info(`${err.message} You are responding as backup.`)
      else console.warn('Could not acknowledge before responding', err)
    })
    onRespond?.(alert)
  }

  const submitting = busy === 'resolve'

  return (
    <div className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 ${closing ? 'pointer-events-none' : ''}`}>
      <div
        className={`${closing ? 'dialog-scrim-out' : 'dialog-scrim'} absolute inset-0 bg-black/80 backdrop-blur-md`}
        onClick={onClose}
        role="presentation"
      />

      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Panic alert from ${alert.residentName}`}
        className={`dark ${closing ? 'dialog-panel-out' : 'dialog-panel'} relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-2xl`}
      >
        {/* ══ STICKY HEADER ══ */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-400">
              {/* Pulses only while nobody has answered — a live alarm, not a record. */}
              {!acknowledged ? (
                <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-xl bg-red-500/20 motion-reduce:hidden" />
              ) : null}
              <Siren size={20} className="relative" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-zinc-100">Panic alert</h2>
              <p className="flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                <Clock size={12} aria-hidden="true" />
                {formatAgo(alert.createdAt)} · {acknowledged ? 'Responding' : 'Active emergency'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panic alert"
            className="shrink-0 rounded-full bg-zinc-900/50 p-2 text-zinc-400 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            <X size={16} />
          </button>
        </header>

        {/* ══ SCROLLABLE BODY ══ */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-6">
          {/* STATUS & RESIDENT */}
          <div className="space-y-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
            {acknowledged ? (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                <ShieldCheck size={12} aria-hidden="true" />
                <span className="truncate">
                  Acknowledged by Security{alert.acknowledgedByName ? ` · ${alert.acknowledgedByName}` : ''}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-400">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
                Awaiting acknowledgement
              </span>
            )}
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">{alert.residentName}</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                <MapPin size={14} className="shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{alert.address}</span>
                {/* The acknowledging officer can still get directions after
                    acknowledging from the rail — a location tool, not a second
                    stage action. */}
                {mine && canNavigate && !responding ? (
                  <button
                    type="button"
                    onClick={() => onRespond?.(alert)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Navigation size={12} aria-hidden="true" />
                    Directions
                  </button>
                ) : null}
              </p>
            </div>
            {outside ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-zinc-200">
                <MapPinOff size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />
                <span>
                  <span className="font-semibold text-amber-300">Outside the subdivision.</span> This SOS reported a
                  position beyond the registered boundary — confirm the location before dispatching.
                </span>
              </p>
            ) : null}
          </div>

          {/* THE RESOLUTION FORM — only once Security has acknowledged. It
              arrives with the shared step entrance when the state flips. */}
          {acknowledged ? (
            <div className="step-enter space-y-5">
              <div className="border-t border-zinc-800/80" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="sos-resolution-notes" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
                    What happened?
                  </label>
                  <span className="text-[11px] text-zinc-500">Optional</span>
                </div>
                <textarea
                  id="sos-resolution-notes"
                  rows={3}
                  value={notes}
                  disabled={submitting}
                  onChange={(event) => setNotes(event.target.value.slice(0, RESOLUTION_NOTES_MAX))}
                  placeholder="What you found, and what you did about it…"
                  className="w-full resize-none rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 text-sm text-zinc-200 placeholder-zinc-500 transition-colors duration-150 focus:border-zinc-600 focus:outline-none disabled:opacity-60"
                />
              </div>

              <div className="border-t border-zinc-800/80" />
              <div>
                {/* Tagged, not burned in: the server's resolution time is the
                    stamp, rendered over the photo wherever it is shown. */}
                <MediaAttachmentField
                  items={tiles}
                  capacity={RESOLUTION_PHOTOS_MAX}
                  heading="Photo proof"
                  hint="PNG or JPG. Stamped with the server's resolution time, not this device's."
                  disabled={submitting}
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
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-zinc-500">
              {canNavigate
                ? 'Respond to acknowledge this SOS and start navigation. The resolution form unlocks once Security has acknowledged.'
                : 'This SOS has no GPS fix — go by the address above. Acknowledge it so every console knows it is being handled.'}
            </p>
          )}
        </div>

        {/* ══ STICKY FOOTER — the ONE action for this state ══ */}
        <footer className="flex shrink-0 flex-col gap-2.5 border-t border-zinc-800/80 bg-zinc-950/80 px-6 py-4 backdrop-blur-xl">
          {notice ? (
            <p
              role="status"
              className={`flex items-start gap-2 text-xs leading-snug ${notice.tone === 'danger' ? 'text-red-400' : 'text-zinc-300'}`}
            >
              {notice.tone === 'danger' ? (
                <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
              ) : (
                <ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" aria-hidden="true" />
              )}
              {notice.text}
            </p>
          ) : null}

          {acknowledged ? (
            <button
              type="button"
              disabled={Boolean(busy) || photos.uploading}
              onClick={() =>
                run('resolve', () => resolvePanicAlert(alert.id, { notes, photoUrls: photos.urls }), 'SOS alert resolved', () => onClose?.())
              }
              className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-950 shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting || photos.uploading ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 size={16} aria-hidden="true" />
              )}
              {submitting ? 'Submitting…' : photos.uploading ? 'Uploading photos…' : 'Submit & confirm resolve'}
            </button>
          ) : canNavigate ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={respond}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-red-500 py-2.5 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-red-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Navigation size={16} aria-hidden="true" />
              Respond to SOS
            </button>
          ) : (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run('ack', () => acknowledgePanicAlert(alert.id, user?.displayName), 'SOS acknowledged by Security')}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-red-500 py-2.5 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-red-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'ack' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
              {busy === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
