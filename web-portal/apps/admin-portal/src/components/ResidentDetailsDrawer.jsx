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
 * The resident review drawer: who they are, the lot they claim, the ID they
 * uploaded, and the Approve / Reject decision pinned underneath.
 *
 *   <ResidentDetailsDrawer isOpen={Boolean(selected)} resident={selected} onClose={…} />
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `resident` comes from the page's residents/ listener, and the users/ and
 * properties/ halves of the profile from useResidentProfile's own listeners.
 * A status change from another admin, or a phone number fixed in the mobile
 * app, lands in the open drawer without a reload.
 *
 * ── ENTER AND EXIT ─────────────────────────────────────────────────────────
 * The panel slides (`translate-x-full` → `translate-x-0`) and the scrim fades,
 * both 300 ms on the house ease. Mounting is decoupled from showing so the
 * EXIT plays too: closing flips `shown` first and unmounts when the panel's
 * transition ends. The last resident is held during the exit so the panel
 * does not empty while it is still sliding out. A timer backs up
 * `transitionend`, which never fires under reduced motion.
 *
 * ── THE REFERENCE, ON TOKENS ───────────────────────────────────────────────
 * The brief's `#09090b` and zinc borders are this palette's dark `base-950`
 * and `hairline` exactly, so the drawer matches the reference in dark mode
 * and stays correct in light mode instead of being a black panel on a light
 * console.
 */

// The header status is the shared oblong Pill, in these tones.
const STATUS_TONE = { pending: 'warning', verified: 'success', rejected: 'danger' }
const EXIT_MS = 300

/** A Storage download URL keeps the object path URL-encoded under `/o/`. */
function isPdfUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

function SectionHeading({ children, className = 'mb-4' }) {
  return (
    <h3 className={`text-[11px] font-bold uppercase tracking-widest text-text-muted ${className}`}>
      {children}
    </h3>
  )
}

function Detail({ label, value, wide = false }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-[13px] text-text-muted">{label}</span>
      <span className="break-words text-sm font-medium text-text-primary">{value || '—'}</span>
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
        className="h-14 w-14 shrink-0 rounded-full border border-hairline object-cover"
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-brand-500/25 bg-brand-500/15 text-xl font-medium text-brand-400"
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  )
}

/** Neutral note for a section with nothing captured yet. */
function NotCaptured({ children }) {
  return (
    <p className="flex items-start gap-3 rounded-xl border border-dashed border-hairline p-4 text-[13px] leading-relaxed text-text-secondary">
      <Info size="sm" className="mt-0.5 shrink-0 text-text-muted" />
      {children}
    </p>
  )
}

/** The amber dashed banner for a missing ID: a reviewer should act on it. */
function MissingIdBanner({ children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-warning/30 bg-warning/5 p-4">
      <Info size="sm" className="mt-0.5 shrink-0 text-warning/80" />
      <p className="text-[13px] leading-relaxed text-text-secondary dark:text-zinc-300">{children}</p>
    </div>
  )
}

/** One image document: dims at rest, lifts and offers "View image" on hover/focus. */
function DocumentTile({ url, onOpen, large }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View verification document"
      className={`group relative block w-full overflow-hidden rounded-xl border border-hairline bg-base-900/50 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        large ? 'aspect-[4/3]' : 'aspect-square'
      }`}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover opacity-80 transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.02] group-hover:opacity-100 group-focus-visible:opacity-100"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/90 px-4 py-2 text-sm font-medium text-zinc-100 shadow-lg">
          <ZoomIn size="sm" />
          {large ? 'View image' : 'View'}
        </span>
      </span>
    </button>
  )
}

export default function ResidentDetailsDrawer({ isOpen, resident, onClose }) {
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

  // Once the panel is in the DOM at `translate-x-full`, force a style flush
  // and THEN flip it, so the browser has a "from" state to transition out of.
  // Not requestAnimationFrame: rAF is paused in a background tab, and a drawer
  // opened there stayed off-screen until the tab was looked at.
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

  const close = useCallback(() => onClose?.(), [onClose])

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
      close()
    } catch (err) {
      // Inline, beside the buttons that retry it; the drawer stays open.
      setError(describeError(err))
      toast.error(kind === 'approve' ? 'Could not approve the resident' : 'Could not reject the application')
    } finally {
      setBusy(null)
    }
  }

  const approved = status === RESIDENT_STATUS.verified
  const rejected = status === RESIDENT_STATUS.rejected

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      {/* Scrim */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-drawer-title"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !shown) setMounted(false)
        }}
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-hairline bg-base-900 shadow-2xl outline-none transition-transform duration-300 ease-[var(--ease-out-strong)] will-change-transform dark:bg-base-950 ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ── Header ── */}
        <header className="relative shrink-0 px-7 pb-6 pt-8">
          <button
            type="button"
            onClick={close}
            aria-label="Close resident details"
            className="absolute right-5 top-5 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <X size="md" />
          </button>
          <div className="flex items-center gap-4 pr-8">
            <Avatar name={name} photoUrl={photoUrl} />
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              {/* The status sits INLINE with the name now. `flex-wrap` so a
                  long name pushes the badge to its own line instead of
                  truncating the name to make room for it. */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 id="resident-drawer-title" className="min-w-0 text-lg font-semibold tracking-tight text-text-primary">
                  {name}
                </h2>
                <Pill tone={STATUS_TONE[status] ?? 'warning'} icon={StatusIcon}>
                  {RESIDENT_STATUS_LABELS[status] ?? status}
                </Pill>
              </div>
              <p className="mt-0.5 truncate text-[13px] text-text-secondary">{email || 'No email on file'}</p>
            </div>
          </div>
        </header>

        <hr className="mx-7 border-hairline" />

        {/* ── Body ── */}
        <div className="custom-scrollbar drawer-scroll min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-7 py-7">
          <section>
            <SectionHeading>Personal details</SectionHeading>
            {/* Resident type and Registered, side by side, per the reference.
                Contact number joins them only when there is one: most
                applicants never enter it, and an always-empty "—" cell was
                the noise this layout dropped. */}
            <div className="grid grid-cols-2 gap-4">
              <Detail
                label="Resident type"
                value={current.residentType ? residentTypeLabel(current.residentType) : ''}
              />
              <Detail label="Registered" value={formatDateTime(current.createdAt, '')} />
              {phone ? <Detail label="Contact number" value={phone} /> : null}
              {profile?.bio ? <Detail label="Bio" value={profile.bio} wide /> : null}
            </div>
          </section>

          <hr className="border-hairline" />

          <section>
            <SectionHeading>Property &amp; location</SectionHeading>
            {!phase && !block && !lot && !loading ? (
              <NotCaptured>
                No property on file yet. They may not have finished property verification in the
                mobile app.
              </NotCaptured>
            ) : (
              /* Three metric cards rather than one divided strip. */
              <dl className="grid grid-cols-3 gap-3">
                {[
                  ['Phase', phase],
                  ['Block', block],
                  ['Lot', lot],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl bg-base-800 p-4 dark:bg-base-900/40"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{label}</dt>
                    <dd className="text-lg font-medium tabular-nums text-text-primary dark:text-white">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <hr className="border-hairline" />

          <section>
            <SectionHeading>Verification documents</SectionHeading>
            {documents.length === 0 ? (
              <MissingIdBanner>
                No ID uploaded. This is an older application or one whose upload failed. Check the
                claimed property above, or reject and ask for a valid ID.
              </MissingIdBanner>
            ) : (
              <div className="space-y-3">
                {images[0] ? <DocumentTile url={images[0].url} large onOpen={() => setLightboxIndex(0)} /> : null}
                {images.length > 1 || pdfs.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {images.slice(1).map((d, i) => (
                      <DocumentTile key={d.url} url={d.url} onOpen={() => setLightboxIndex(i + 1)} />
                    ))}
                    {pdfs.map((d) => (
                      <a
                        key={d.url}
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-hairline bg-base-800/40 text-text-secondary transition-colors hover:border-brand-500/30 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                      >
                        <FileText size="md" />
                        <span className="text-xs font-medium">Open PDF</span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {rejected && current.rejectionReason ? (
              <div className="mt-6 rounded-xl border border-danger/25 bg-danger/10 p-3">
                <p className="text-xs font-semibold text-danger">Rejection reason</p>
                <p className="mt-1 text-sm text-text-primary">{current.rejectionReason}</p>
              </div>
            ) : null}

            {current.reviewedByName ? (
              <p className="mt-6 text-xs text-text-muted">
                Reviewed by {current.reviewedByName}
                {current.reviewedAt ? ` · ${formatDateTime(current.reviewedAt)}` : ''}
              </p>
            ) : null}
          </section>
        </div>

        {/* ── Sticky decision footer ── */}
        <footer className="z-10 shrink-0 border-t border-hairline bg-base-900/80 p-5 backdrop-blur-md dark:bg-base-950/80">
          {error ? (
            <p role="alert" className="mb-4 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
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
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setRejecting(false)}
                  className="btn btn-decision btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => decide('reject')}
                  className="btn btn-decision btn-reject"
                >
                  {busy === 'reject' ? <Loader2 size="sm" className="animate-spin" /> : <X size="sm" />}
                  Confirm rejection
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                disabled={Boolean(busy) || rejected}
                onClick={() => setRejecting(true)}
                className="btn btn-decision btn-reject"
              >
                <X size="sm" />
                {rejected ? 'Rejected' : 'Reject'}
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || approved}
                onClick={() => decide('approve')}
                aria-busy={busy === 'approve'}
                className="btn btn-decision btn-approve"
              >
                {busy === 'approve' ? <Loader2 size="sm" className="animate-spin" /> : <Check size="sm" />}
                {approved ? 'Approved' : busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
        </footer>
      </aside>

      {lightboxIndex !== null ? (
        <Lightbox media={images} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>,
    document.body,
  )
}
