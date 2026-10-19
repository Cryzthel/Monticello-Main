import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  History,
  Home,
  IdCard,
  Info,
  Loader2,
  ShieldCheck,
  User,
  X,
  ZoomIn,
} from '@shared/icons'
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
import { formatAddress } from '@shared/lib/addressQuery'
import { describeError, toast } from '@shared/lib/toast'
import Pill from '@shared/components/Pill'
import { DetailCard, DetailField, DetailTimeline } from '@shared/components/detail/DetailCard'

/**
 * Resident verification — who they are, the lot they claim, the ID they
 * uploaded, and the Approve / Reject decision pinned underneath.
 *
 *   <ResidentVerificationModal isOpen={Boolean(selected)} resident={selected} onClose={…} />
 *
 *   ┌ (photo) Razel Roldan (Phase 1 • Block 3 • Lot 12)                (×) ┐ fixed
 *   │         roldanrazel2004@gmail.com                                       │
 *   │         (✓ Verified) (• Homeowner)                                      │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ PERSONAL DETAILS        name · email · resident type · contact · bio    │
 *   │ PROPERTY & LOCATION     phase · block · lot                             │
 *   │ VERIFICATION DOCUMENTS  ID preview · thumbnails · PDFs     (n files)    │
 *   │ VERIFICATION HISTORY    ● Submitted ● Approved / ○ Awaiting review      │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ The resident sees the decision in the app          (✕ Reject) (✓ Approve) │ fixed
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * ── ONE DESIGN WITH THE INCIDENT DETAILS (2026-10-19) ──────────────────────
 * Re-cut from the max-w-xl verification modal onto the shared
 * IncidentDetailModal shell — max-w-3xl, header with a mono code pill and a
 * pill row, one column of DetailCards on a base-950/40 body, a base-950 footer
 * — with DetailField labels and the DetailTimeline, so a resident record reads
 * like every other record in the console.
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
const SECONDARY_BTN =
  'inline-flex items-center gap-2 rounded-full border border-hairline bg-tint/[0.06] px-5 py-2 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-tint/[0.1] hover:text-text-primary disabled:pointer-events-none disabled:opacity-50'
const DANGER_BTN =
  'inline-flex items-center gap-2 rounded-full border border-danger/20 bg-danger/10 px-5 py-2 text-xs font-semibold text-danger transition-[background-color,transform] hover:bg-danger/20 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:pointer-events-none disabled:opacity-50'

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
      className={`group relative block overflow-hidden border bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        lead ? 'h-64 w-full rounded-lg border-hairline sm:h-80' : 'h-12 w-12 shrink-0 rounded border-hairline opacity-70 transition-opacity hover:opacity-100'
      }`}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        className={`h-full w-full opacity-90 transition-transform ${lead ? 'object-contain' : 'object-cover'} duration-500 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100`}
      />
      {lead ? <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" /> : null}
      {lead && name ? (
        <span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md border border-white/10 bg-black/60 px-2.5 py-1 font-mono text-xs font-medium text-zinc-200 backdrop-blur-md">
          {name}
        </span>
      ) : null}
      {lead ? (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn size={14} aria-hidden="true" />
          View
        </span>
      ) : null}
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

  // Registered → reviewed, in the Incident details' timeline.
  const timeline = [
    {
      key: 'submitted',
      label: 'Application submitted',
      stamp: formatDateTime(current.createdAt, ''),
      tone: 'done',
    },
    approved || rejected
      ? {
          key: 'reviewed',
          label: approved ? 'Approved' : 'Rejected',
          detail: current.reviewedByName ? `By ${current.reviewedByName}` : undefined,
          stamp: formatDateTime(current.reviewedAt, ''),
          tone: approved ? 'done' : 'warning',
        }
      : { key: 'reviewed', label: 'Awaiting review', detail: 'An admin approves or rejects below', tone: 'pending' },
  ]

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 md:p-6" role="presentation">
      {/* Scrim */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel — the Incident details' shell. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-modal-title"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !shown) setMounted(false)
        }}
        className={`relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none sm:max-h-[90vh] sm:rounded-2xl ${
          shown ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0'
        }`}
      >
        {/* ═══ HEADER ═══ */}
        <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14 sm:px-8 sm:pr-16">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={name} photoUrl={photoUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 id="resident-modal-title" className="min-w-0 break-words text-xl font-bold tracking-tight text-text-primary">
                  {name}
                </h2>
                {phase || block || lot ? (
                  <Pill className="font-mono tracking-wider">
                    {formatAddress({ phase, block, lot })}
                  </Pill>
                ) : null}
              </div>
              <p className="mt-0.5 break-all text-xs text-text-muted">{email || 'No email on file'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE[status] ?? 'warning'} icon={StatusIcon}>
                  {RESIDENT_STATUS_LABELS[status] ?? status}
                </Pill>
                {current.residentType ? (
                  <Pill tone="neutral">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {residentTypeLabel(current.residentType)}
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={Boolean(busy)}
            aria-label="Close resident details"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40 sm:right-6 sm:top-5"
          >
            <X size={20} />
          </button>
        </header>

        {/* ═══ BODY: ONE COLUMN OF CARDS ═══ */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <DetailCard icon={User} title="Personal details">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <DetailField label="Full name">{name}</DetailField>
                <DetailField label="Email address" empty={!email}>
                  <span className="break-all">{email || 'No email on file'}</span>
                </DetailField>
                <DetailField label="Resident type" empty={!current.residentType}>
                  {current.residentType ? residentTypeLabel(current.residentType) : 'Not set'}
                </DetailField>
                {/* Most applicants never enter a number; say so rather than
                    leave a dash. */}
                <DetailField label="Contact number" mono={Boolean(phone)} empty={!phone}>
                  {phone || 'Not provided'}
                </DetailField>
                {profile?.bio ? (
                  <DetailField label="Bio" className="sm:col-span-2">
                    {profile.bio}
                  </DetailField>
                ) : null}
              </div>
            </DetailCard>

            <DetailCard icon={Home} title="Property & location">
              {!phase && !block && !lot && !loading ? (
                <Note>No property on file yet. They may not have finished property verification in the mobile app.</Note>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  <DetailField label="Phase" empty={!phase}>
                    <span className="tabular-nums">{phase || '—'}</span>
                  </DetailField>
                  <DetailField label="Block" empty={!block}>
                    <span className="tabular-nums">{block || '—'}</span>
                  </DetailField>
                  <DetailField label="Lot" empty={!lot}>
                    <span className="tabular-nums">{lot || '—'}</span>
                  </DetailField>
                </div>
              )}
            </DetailCard>

            <DetailCard
              icon={IdCard}
              title="Verification documents"
              bodyClassName="space-y-4"
              action={
                documents.length ? (
                  <Pill tone="success" icon={CheckCircle2}>
                    {documents.length} attachment{documents.length === 1 ? '' : 's'}
                  </Pill>
                ) : (
                  <Pill tone="warning" icon={AlertTriangle}>
                    No ID
                  </Pill>
                )
              }
            >
              {documents.length === 0 ? (
                <Note warn>
                  No ID uploaded. This is an older application or one whose upload failed. Check the claimed property
                  above, or reject and ask for a valid ID.
                </Note>
              ) : (
                <>
                  {images[0] ? <DocumentTile url={images[0].url} lead onOpen={() => setLightboxIndex(0)} /> : null}
                  {images.length > 1 || pdfs.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {images.slice(1).map((d, i) => (
                        <DocumentTile key={`${i}:${d.url}`} url={d.url} onOpen={() => setLightboxIndex(i + 1)} />
                      ))}
                      {pdfs.map((d, i) => (
                        <a
                          key={`${i}:${d.url}`}
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={fileNameOf(d.url) || 'Open PDF'}
                          aria-label={fileNameOf(d.url) ? `Open ${fileNameOf(d.url)}` : 'Open PDF'}
                          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-hairline bg-base-950 text-text-secondary transition-colors hover:border-brand-500/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        >
                          <FileText size="sm" aria-hidden="true" />
                          <span className="text-[9px] font-semibold uppercase tracking-wider">PDF</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </DetailCard>

            <DetailCard aria-label="Verification history" icon={History} title="Verification history" bodyClassName="">
              <DetailTimeline items={timeline} />
              {rejected && current.rejectionReason ? (
                <div className="mt-6 border-t border-hairline pt-6">
                  <span className="mb-1.5 block text-[11px] text-text-muted">Rejection reason</span>
                  <p className="whitespace-pre-wrap break-words rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm font-medium leading-relaxed text-text-secondary">
                    {current.rejectionReason}
                  </p>
                </div>
              ) : null}
            </DetailCard>
          </div>
        </div>

        {/* ═══ FOOTER ═══ the decision, pinned. */}
        <footer className="shrink-0 border-t border-hairline bg-base-950 px-6 py-3 sm:px-8">
          {error ? (
            <p role="alert" className="mb-3 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
              {error}
            </p>
          ) : null}

          {rejecting ? (
            <div className="space-y-3 py-1">
              <label htmlFor="resident-reject-reason" className="block text-[11px] font-medium text-text-muted">
                Reason (optional, shown to the resident)
              </label>
              <textarea
                id="resident-reject-reason"
                rows={3}
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Block/Lot does not match HOA records, or the ID photo is unclear"
                className="w-full resize-none rounded-lg border border-hairline bg-base-950 p-3 text-sm text-text-primary shadow-inner outline-none transition-[border-color,box-shadow] placeholder:text-text-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={() => setRejecting(false)} className={SECONDARY_BTN}>
                  Cancel
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => decide('reject')} className={DANGER_BTN}>
                  {busy === 'reject' ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <X size="sm" aria-hidden="true" />}
                  Confirm rejection
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-text-muted">
                <ShieldCheck size={14} className="text-success/70" aria-hidden="true" />
                <span>The resident sees the decision in the app</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy) || rejected}
                  onClick={() => setRejecting(true)}
                  className={DANGER_BTN}
                >
                  <X size="sm" aria-hidden="true" />
                  {rejected ? 'Rejected' : 'Reject'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || approved}
                  onClick={() => decide('approve')}
                  aria-busy={busy === 'approve'}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2 text-xs font-semibold text-[var(--color-cta-fg)] shadow-md transition-[background-color,transform] hover:bg-[var(--color-cta-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
                >
                  {busy === 'approve' ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <Check size="sm" aria-hidden="true" />}
                  {approved ? 'Approved' : busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
              </div>
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
