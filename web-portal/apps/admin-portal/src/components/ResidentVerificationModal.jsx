import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileText, Info, Loader2, X, ZoomIn } from '@shared/icons'
import Lightbox from '@shared/components/Lightbox'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useResidentProfile } from '@/hooks/useResidentProfile'
import {
  RESIDENT_STATUS,
  RESIDENT_STATUS_LABELS,
  approveResident,
  rejectResident,
  residentTypeLabel,
} from '@shared/lib/residents'
import { residentStatusIcon } from '@shared/theme/categoryIcons'
import { formatDateTime } from '@shared/lib/dates'
import { describeError, toast } from '@shared/lib/toast'
import Pill from '@shared/components/Pill'

/**
 * Resident verification — who they are, the lot they claim, the ID they
 * uploaded, and the Approve / Reject decision pinned underneath.
 *
 *   <ResidentVerificationModal isOpen={Boolean(selected)} resident={selected} onClose={…} />
 *
 *   ┌ (photo) Razel Roldan (✓ Verified)                              (×) ┐ sticky
 *   │         roldanrazel2004@gmail.com                                  │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ PERSONAL DETAILS        [ resident type · registered · phone ]     │
 *   │ PROPERTY & LOCATION     [ PHASE | BLOCK | LOT ]                    │
 *   │ VERIFICATION DOCUMENTS  [ ID preview, filename badge ]  (n files)  │
 *   │ Reviewed by … • time                                               │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ (✕ Reject)                                      (✓ Approve)        │ sticky
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Rebuilt 2026-10-19 from the provided reference: a centred max-w-xl modal
 * (it was a right-hand drawer), chunked by Miller's law with hairlines between
 * sections. Colours are the console's tokens, so it follows both themes.
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `resident` comes from the page's residents/ onSnapshot listener, and the
 * users/ and properties/ halves of the profile from useResidentProfile's own
 * listeners. Another admin's decision, a lot corrected in the mobile app or a
 * newly uploaded ID lands in the open modal without a reload; if the resident
 * is deleted, the page closes the modal (its `isOpen` follows the live row).
 *
 * ── ENTER AND EXIT ─────────────────────────────────────────────────────────
 * The panel fades and settles from 96% scale over 200 ms, the scrim fades.
 * Mounting is decoupled from showing so the exit plays too; the last resident
 * is held during it so the panel does not empty while fading out. A timer
 * backs up `transitionend`, which never fires under reduced motion.
 *
 * Dismissed by the ✕, a backdrop click or Escape (the Lightbox owns Escape
 * while it is open; a decision in flight holds the modal open).
 */

const STATUS_TONE = { pending: 'warning', verified: 'success', rejected: 'danger' }
const EXIT_MS = 200
const CARD = 'rounded-xl border border-hairline bg-base-900/30 p-4'

/** A Storage download URL keeps the object path URL-encoded under `/o/`. */
function isPdfUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

/** "ID_Verification_Capture.jpg" from a Storage download URL, or '' when there is none. */
function fileNameOf(url) {
  try {
    const parsed = new URL(url)
    // Only a real web address has a path worth naming; a data: or blob: URL
    // would yield the tail of its payload.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return decodeURIComponent(parsed.pathname).split('/').pop() || ''
  } catch {
    return ''
  }
}

function Section({ title, action = null, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

const Divider = () => <div aria-hidden="true" className="border-t border-hairline" />

function Detail({ label, value, mono = false, wide = false }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`block break-words text-sm font-medium ${mono ? 'font-mono' : ''} ${value ? 'text-text-primary' : 'text-text-muted'}`}>
        {value || '—'}
      </span>
    </div>
  )
}

function Avatar({ name, photoUrl }) {
  const [broken, setBroken] = useState(false)
  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-12 w-12 shrink-0 rounded-full border border-hairline object-cover shadow-inner"
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand-500/25 bg-brand-500/15 text-lg font-semibold text-brand-500"
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  )
}

/** A note for a section with nothing captured yet; `warn` for one a reviewer should act on. */
function Note({ warn = false, children }) {
  return (
    <p
      className={`flex items-start gap-3 rounded-xl border border-dashed p-4 text-[13px] leading-relaxed text-text-secondary ${
        warn ? 'border-warning/30 bg-warning/5' : 'border-hairline'
      }`}
    >
      <Info size="sm" className={`mt-0.5 shrink-0 ${warn ? 'text-warning/80' : 'text-text-muted'}`} aria-hidden="true" />
      {children}
    </p>
  )
}

/** One image document, opening the lightbox; the lead one carries its filename. */
function DocumentTile({ url, onOpen, lead }) {
  const name = fileNameOf(url)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={name ? `View ${name}` : 'View verification document'}
      className={`group relative block w-full overflow-hidden rounded-lg border border-hairline bg-base-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        lead ? 'h-52' : 'aspect-square'
      }`}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover opacity-90 transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      {lead && name ? (
        <span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md border border-white/10 bg-black/60 px-2.5 py-1 font-mono text-xs font-medium text-zinc-200 backdrop-blur-md">
          {name}
        </span>
      ) : null}
      <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <ZoomIn size={14} aria-hidden="true" />
        View
      </span>
    </button>
  )
}

export default function ResidentVerificationModal({ isOpen, resident, onClose }) {
  // ── Mount / show split, so the exit animates ─────────────────────────────
  const [mounted, setMounted] = useState(isOpen)
  const [shown, setShown] = useState(false)
  const held = useRef(resident)
  if (resident) held.current = resident
  const current = resident ?? held.current

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      return undefined
    }
    setShown(false)
    const timer = setTimeout(() => setMounted(false), EXIT_MS + 50)
    return () => clearTimeout(timer)
  }, [isOpen])

  // Once the panel is in the DOM in its "from" state, force a style flush and
  // THEN flip it, so the browser has something to transition out of. Not
  // requestAnimationFrame: rAF is paused in a background tab.
  const panelRef = useRef(null)
  useLayoutEffect(() => {
    if (!isOpen || !mounted || shown || !panelRef.current) return
    void panelRef.current.offsetWidth
    setShown(true)
  }, [isOpen, mounted, shown])

  // ── Review state, reset per resident ─────────────────────────────────────
  const [busy, setBusy] = useState(null) // 'approve' | 'reject' | null
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState(null)

  useEffect(() => {
    setRejecting(false)
    setReason('')
    setError('')
    setLightboxIndex(null)
  }, [current?.id])

  const { profile, property, loading } = useResidentProfile(isOpen ? current?.uid : null)

  useDialogFocus({ open: shown, containerRef: panelRef })

  const close = useCallback(() => {
    if (!busy) onClose?.()
  }, [busy, onClose])

  // Escape closes — unless the lightbox is up, which owns Escape itself.
  useEffect(() => {
    if (!shown || lightboxIndex !== null) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, lightboxIndex, close])

  if (!mounted || !current) return null

  // Whichever collection actually holds the value — the residents record and
  // the users/properties profile are written by different mobile flows.
  const name = profile?.fullName || profile?.name || current.name || 'Unnamed resident'
  const email = current.email || profile?.email || ''
  const phone = current.phone || profile?.phone || ''
  const photoUrl = current.photoUrl || profile?.photoUrl || ''
  const phase = current.phase || property?.phase || ''
  const block = current.block || property?.block || ''
  const lot = current.lot || property?.lot || ''
  const status = current.status ?? RESIDENT_STATUS.pending
  const StatusIcon = residentStatusIcon(status)

  // A PDF cannot render as an image tile: images go to the lightbox, PDFs
  // open in a new tab.
  const documents = (current.documentUrls ?? []).map((url) => ({ url, type: isPdfUrl(url) ? 'pdf' : 'image' }))
  const images = documents.filter((d) => d.type === 'image')
  const pdfs = documents.filter((d) => d.type === 'pdf')

  async function decide(kind) {
    setBusy(kind)
    setError('')
    try {
      if (kind === 'approve') {
        await approveResident(current)
        toast.success(`${name} is approved`, { description: 'They can sign in to the resident app now.' })
      } else {
        await rejectResident(current, reason)
        toast.success(`${name} was rejected`, {
          description: reason.trim() ? 'They will see your reason in the app.' : undefined,
        })
      }
      setBusy(null)
      onClose?.()
    } catch (err) {
      // Inline, beside the buttons that retry it; the modal stays open.
      setError(describeError(err))
      toast.error(kind === 'approve' ? 'Could not approve the resident' : 'Could not reject the application')
      setBusy(null)
    }
  }

  const approved = status === RESIDENT_STATUS.verified
  const rejected = status === RESIDENT_STATUS.rejected

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      {/* Scrim */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-modal-title"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !shown) setMounted(false)
        }}
        className={`relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-hairline bg-base-950 shadow-2xl outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none ${
          shown ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0'
        }`}
      >
        {/* ── Sticky header ── */}
        <header className="z-20 flex shrink-0 items-start justify-between gap-4 border-b border-hairline bg-base-950/80 px-4 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={name} photoUrl={photoUrl} />
            <div className="min-w-0 space-y-1">
              {/* `flex-wrap` so a long name pushes the badge to its own line
                  instead of being truncated to make room for it. */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 id="resident-modal-title" className="min-w-0 break-words text-lg font-semibold tracking-tight text-text-primary">
                  {name}
                </h2>
                <Pill tone={STATUS_TONE[status] ?? 'warning'} icon={StatusIcon}>
                  {RESIDENT_STATUS_LABELS[status] ?? status}
                </Pill>
              </div>
              <p className="break-all font-mono text-xs text-text-muted">{email || 'No email on file'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={Boolean(busy)}
            aria-label="Close resident details"
            className="shrink-0 rounded-full bg-base-900/50 p-2 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </header>

        {/* ── Body ── */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <Section title="Personal details">
            {/* Contact number joins only when there is one: most applicants
                never enter it, and an always-empty cell is noise. */}
            <div className={`${CARD} grid grid-cols-2 gap-4`}>
              <Detail label="Resident type" value={current.residentType ? residentTypeLabel(current.residentType) : ''} />
              <Detail label="Registered" value={formatDateTime(current.createdAt, '')} mono />
              {phone ? <Detail label="Contact number" value={phone} mono /> : null}
              {profile?.bio ? <Detail label="Bio" value={profile.bio} wide /> : null}
            </div>
          </Section>

          <Divider />

          <Section title="Property & location">
            {!phase && !block && !lot && !loading ? (
              <Note>No property on file yet. They may not have finished property verification in the mobile app.</Note>
            ) : (
              <dl className="grid grid-cols-3 divide-x divide-hairline rounded-xl border border-hairline bg-base-950/80 py-4 text-center">
                {[
                  ['Phase', phase],
                  ['Block', block],
                  ['Lot', lot],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">{label}</dt>
                    <dd className="text-base font-semibold tabular-nums text-text-primary">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Divider />

          <Section
            title="Verification documents"
            action={
              documents.length ? (
                <Pill tone="neutral">
                  {documents.length} attachment{documents.length === 1 ? '' : 's'}
                </Pill>
              ) : null
            }
          >
            {documents.length === 0 ? (
              <Note warn>
                No ID uploaded. This is an older application or one whose upload failed. Check the claimed property
                above, or reject and ask for a valid ID.
              </Note>
            ) : (
              <div className={`${CARD} space-y-3 p-3`}>
                {images[0] ? <DocumentTile url={images[0].url} lead onOpen={() => setLightboxIndex(0)} /> : null}
                {images.length > 1 || pdfs.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {images.slice(1).map((d, i) => (
                      <DocumentTile key={`${i}:${d.url}`} url={d.url} onOpen={() => setLightboxIndex(i + 1)} />
                    ))}
                    {pdfs.map((d, i) => (
                      <a
                        key={`${i}:${d.url}`}
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={fileNameOf(d.url) || undefined}
                        className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-hairline bg-base-900 px-2 text-text-secondary transition-colors hover:border-brand-500/30 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                      >
                        <FileText size="md" aria-hidden="true" />
                        <span className="w-full truncate text-center font-mono text-[10px]">{fileNameOf(d.url) || 'Open PDF'}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {rejected && current.rejectionReason ? (
              <div className="rounded-xl border border-danger/25 bg-danger/10 p-3">
                <p className="text-xs font-semibold text-danger">Rejection reason</p>
                <p className="mt-1 text-sm text-text-primary">{current.rejectionReason}</p>
              </div>
            ) : null}
          </Section>

          {current.reviewedByName ? (
            <p className="pt-1 text-center font-mono text-xs text-text-muted">
              Reviewed by {current.reviewedByName}
              {current.reviewedAt ? ` • ${formatDateTime(current.reviewedAt)}` : ''}
            </p>
          ) : null}
        </div>

        {/* ── Sticky decision footer ── */}
        <footer className="z-20 shrink-0 border-t border-hairline bg-base-950/80 px-4 py-4 backdrop-blur-xl sm:px-6">
          {error ? (
            <p role="alert" className="mb-3 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
              {error}
            </p>
          ) : null}

          {rejecting ? (
            <div className="space-y-3">
              <label htmlFor="resident-reject-reason" className="block text-xs font-medium text-text-secondary">
                Reason (optional, shown to the resident)
              </label>
              <textarea
                id="resident-reject-reason"
                rows={3}
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Block/Lot does not match HOA records, or the ID photo is unclear"
                className="field-textarea resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setRejecting(false)}
                  className="flex w-1/2 items-center justify-center gap-2 rounded-full border border-hairline py-2.5 text-xs font-medium text-text-secondary transition-[background-color,transform] duration-150 hover:bg-tint/[0.06] active:scale-[0.97] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => decide('reject')}
                  className="flex w-1/2 items-center justify-center gap-2 rounded-full border border-danger/20 bg-danger/10 py-2.5 text-xs font-semibold text-danger transition-[background-color,transform] duration-150 hover:bg-danger/20 active:scale-[0.97] disabled:opacity-50"
                >
                  {busy === 'reject' ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <X size="sm" aria-hidden="true" />}
                  Confirm rejection
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                type="button"
                disabled={Boolean(busy) || rejected}
                onClick={() => setRejecting(true)}
                className="flex w-1/2 items-center justify-center gap-2 rounded-full border border-danger/20 bg-danger/10 py-2.5 text-xs font-medium text-danger transition-[background-color,transform] duration-150 hover:bg-danger/20 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:pointer-events-none disabled:opacity-50"
              >
                <X size="sm" aria-hidden="true" />
                {rejected ? 'Rejected' : 'Reject'}
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || approved}
                onClick={() => decide('approve')}
                aria-busy={busy === 'approve'}
                className="flex w-1/2 items-center justify-center gap-2 rounded-full bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-[0_0_20px_-5px_color-mix(in_oklab,var(--color-brand-500)_50%,transparent)] transition-[background-color,transform] duration-150 hover:bg-brand-500 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none"
              >
                {busy === 'approve' ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <Check size="sm" aria-hidden="true" />}
                {approved ? 'Approved' : busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
        </footer>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={images} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>,
    document.body,
  )
}
