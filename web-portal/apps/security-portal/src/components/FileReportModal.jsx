import { describeError } from '@shared/lib/toast'
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import {
  FilePlus2,
  FileText,
  Home,
  ImagePlus,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
  Tags,
  User,
  X,
} from '@shared/icons'
import Select from '@shared/components/Select'
import { DetailCard, DetailField } from '@shared/components/detail/DetailCard'
import { DetailFormField, detailInputClass } from '@shared/components/detail/DetailFormField'
import ResidentLocationPicker from '@/components/ResidentLocationPicker'
import EvidenceUploader from '@shared/components/EvidenceUploader'
import { useEvidenceUploads } from '@shared/hooks/useEvidenceUploads'
import { useResidentAddresses } from '@shared/hooks/useResidentAddresses'
import { useAuth } from '@shared/auth/AuthContext'
import { db } from '@shared/lib/firebase'
import { computePriorityScore } from '@shared/lib/wpda'
import { INCIDENT_CATEGORIES, categoryLabel } from '@shared/lib/incidentCategories'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * ── THE CATEGORY IS CHOSEN AGAIN, AND HAS NO DEFAULT (2026-10-29) ──────────
 * Officer reports were pinned to `security` after the old picker defaulted to
 * `fire` — the highest WPDA weight — and filed every report as a fire with
 * nothing on screen to say so. The picker is back by request, and the lesson
 * is kept: it opens EMPTY and the form will not file until a guard picks one,
 * so no report can inherit a category nobody chose.
 *
 * Officer-filed reports are told apart by `reporterUid` against
 * `staff_accounts`, never by category, so a choice here does not move a report
 * between the officer and resident queues.
 */
const CATEGORY_OPTIONS = INCIDENT_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Emergency' },
]

const TITLE_MAX = 90
const DESCRIPTION_MIN = 10
const DESCRIPTION_MAX = 1200

const INITIAL_FORM = {
  title: '',
  category: '',
  priority: 'medium',
  description: '',
}

/** What blocks filing, field by field. Empty object = ready. */
function validate(form, resident) {
  const errors = {}
  if (!resident) errors.resident = 'Choose the verified resident this report concerns.'
  if (!form.category) errors.category = 'Choose a category.'
  const notes = form.description.trim()
  if (!notes) errors.description = 'Describe what happened.'
  else if (notes.length < DESCRIPTION_MIN) errors.description = `At least ${DESCRIPTION_MIN} characters.`
  return errors
}

/**
 * The dialog shell — the Admin Incident ticket details' own frame (2026-10-29,
 * by request): black scrim with blur, a 3xl rounded-2xl panel, a phone bottom
 * sheet with a grab handle, and a fixed header and footer around the one band
 * that scrolls.
 *
 * `busy` disables every dismissal route at once (scrim, Escape, ×, Cancel).
 * Closing anyway would cancel an in-flight upload (useEvidenceUploads cancels
 * on unmount), throwing away evidence the guard is already waiting for.
 *
 * Children render ONLY while open: the composer opens the resident directory
 * listeners, and mounting it behind a closed dialog would hold them for the
 * whole shift. It also resets the draft on every open without a remount key.
 */
function ModalShell({ open, busy, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  // The page behind a modal must not scroll under it.
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef })

  if (!open) return null

  return (
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 md:p-6"
      onClick={() => {
        if (!busy) onClose()
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-report-title"
        className="dialog-panel relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The report form, as four cards in the order a guard decides them: who it
 * concerns (and so where), what kind of incident, what happened, and the
 * evidence.
 *
 * ── ONE PICKER FOR WHO AND WHERE (2026-10-29, by request) ──────────────────
 * This had a resident search AND a Phase / Block / Lot cascade a guard could
 * type over. Both are now one decision: the picker lists VERIFIED residents
 * only, and the chosen resident's registered address is the report's address,
 * shown read-only beneath them. Nothing about the location is typed, so a
 * report can no longer carry an address that belongs to nobody. Residents who
 * are verified but have no complete address on file are left out — there is
 * nothing to bind — and the card says how many, so a missing name has a reason.
 */
function ReportComposer({ onClose, onFiled, onBusyChange }) {
  const { user } = useAuth()
  const { residents: directory, loading: residentsLoading, error: residentsError } = useResidentAddresses()

  const verified = useMemo(() => directory.filter((r) => r.verified && r.hasAddress), [directory])
  const verifiedWithoutAddress = useMemo(
    () => directory.filter((r) => r.verified && !r.hasAddress).length,
    [directory],
  )

  const [form, setForm] = useState(INITIAL_FORM)
  // Held whole, so the profile card and the written document read one object:
  // what the guard confirmed is what gets filed.
  const [resident, setResident] = useState(null)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Photos, video and documents; already split into the arrays the incident
  // document expects as they land.
  const attachments = useEvidenceUploads({ maxVideos: Infinity, documents: true })
  const uploading = attachments.busy

  // A resident who loses verification (or is removed) while selected is
  // dropped from the draft, not silently filed against.
  useEffect(() => {
    if (resident && !residentsLoading && !verified.some((r) => r.uid === resident.uid)) setResident(null)
  }, [resident, verified, residentsLoading])

  const busy = submitting || uploading
  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const errors = validate(form, resident)
  // Errors show once a submit has been tried, then update live as each is fixed.
  const shown = attempted ? errors : {}

  const previewScore = useMemo(
    () =>
      Math.round(
        computePriorityScore({
          category: form.category || 'other',
          severity: form.priority,
          reportedAt: new Date(),
        }),
      ),
    [form.category, form.priority],
  )

  async function handleSubmit(event) {
    event.preventDefault()
    setAttempted(true)
    setError('')
    if (Object.keys(errors).length || busy) return
    // A failed tile is evidence the guard meant to attach. Filing without it
    // would drop it silently, so it must be retried or removed first.
    if (attachments.failed) {
      setError('One file did not upload. Retry it or remove it, then submit again.')
      return
    }

    setSubmitting(true)
    try {
      // One addDoc: the document lands whole, and every console's incidents
      // listener (Admin tickets and Reports, this directory) receives it in
      // the same snapshot.
      await addDoc(collection(db, 'incidents'), {
        title: form.title.trim() || `${categoryLabel(form.category)} report`,
        category: form.category,
        phase: resident.phase,
        block: resident.block,
        lot: resident.lot,
        propertyLabel: resident.label,
        // The resident the report concerns, and that the address is theirs
        // as registered — always true now, since nothing else can supply one.
        subjectUid: resident.uid,
        subjectName: resident.name,
        locationFromProfile: true,
        description: form.description.trim(),
        reportedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        priority: form.priority,
        status: 'pending',
        reporterName: user?.displayName || user?.email || 'Guard',
        reporterUid: user?.uid ?? '',
        hasMedia:
          attachments.photoUrls.length + attachments.videoUrls.length + attachments.attachmentUrls.length > 0,
        // photoUrls/videoUrls are the fields the Flutter app reads;
        // attachmentUrls is a web addition for PDFs and text logs.
        photoUrls: attachments.photoUrls,
        videoUrls: attachments.videoUrls,
        attachmentUrls: attachments.attachmentUrls,
        // One record per video — poster, size before and after compression,
        // duration, format — in the same write as the URLs, so a viewer never
        // sees a clip without its details. Ignored by the Flutter app.
        videoMeta: attachments.videoMeta,
        wpdaScore: 0,
      })
      // Closes on success; the page reports it above the directory, which
      // has already taken the new row.
      onFiled()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const blockers = Object.values(errors)
  const footerHint = uploading
    ? 'Waiting for the attachments to finish uploading'
    : blockers.length
      ? attempted
        ? blockers[0]
        : 'Resident, category and description are required'
      : 'Ready to file'

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} noValidate>
      {/* Grab handle — phone sheet only. */}
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        aria-label="Close"
        className="flex h-6 shrink-0 items-center justify-center pt-2 sm:hidden"
      >
        <span className="h-1 w-9 rounded-full bg-tint/25" />
      </button>

      {/* ═══ HEADER ═══ */}
      <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14 sm:px-8 sm:pr-16">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500 shadow-inner">
            <FilePlus2 size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="file-report-title" className="type-h3 truncate text-text-primary">
              File incident report
            </h2>
            <p className="mt-0.5 text-small text-text-muted">
              Filed as {user?.displayName || user?.email || 'Guard'} · lands on the Admin console the moment it is
              submitted
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          // Disabled rather than hidden while work is in flight, so the header
          // never reflows mid-upload.
          disabled={busy}
          aria-label="Close report composer"
          title={busy ? 'Wait for the upload to finish' : 'Close'}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40 sm:right-6 sm:top-5"
        >
          <X size={20} />
        </button>
      </header>

      {/* ═══ BODY: ONE COLUMN OF STACKED CARDS (the only band that scrolls) ═══
          `relative` makes this band the containing block for anything
          absolutely positioned inside it (the attachment field's visually
          hidden file input). Without it they resolved against the `relative`
          panel, overflowed it, and the panel itself scrolled — header and
          all — the moment the browser scrolled a field into view. */}
      <div className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
        <div className="flex flex-col gap-6">
          <DetailCard icon={User} title="Resident profile">
            <DetailFormField
              label="Verified resident"
              htmlFor="report-resident"
              required
              error={shown.resident}
              hint={
                residentsError
                  ? undefined
                  : verifiedWithoutAddress
                    ? `${verifiedWithoutAddress} verified ${verifiedWithoutAddress === 1 ? 'resident has' : 'residents have'} no complete address yet and ${verifiedWithoutAddress === 1 ? 'is' : 'are'} not listed.`
                    : 'Only verified residents are listed. Their registered address is used for the report.'
              }
            >
              <ResidentLocationPicker
                inputId="report-resident"
                residents={verified}
                loading={residentsLoading}
                error={residentsError}
                selected={resident}
                onSelect={setResident}
                onClear={() => setResident(null)}
                disabled={submitting}
                invalid={Boolean(shown.resident)}
              />
            </DetailFormField>

            {resident ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <DetailField label="Full name">{resident.name}</DetailField>
                <DetailField label="Property address" accent="border-brand-500/60">
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <Home size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
                    {resident.label}
                  </span>
                </DetailField>
                {resident.phone || resident.email ? (
                  <DetailField label="Contact" className="sm:col-span-2">
                    {[resident.phone, resident.email].filter(Boolean).join(' · ')}
                  </DetailField>
                ) : null}
              </div>
            ) : null}
          </DetailCard>

          <DetailCard icon={Tags} title="Incident details" bodyClassName="space-y-1">
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              <DetailFormField label="Category" htmlFor="report-category" required error={shown.category}>
                <Select
                  ariaLabel="Category"
                  value={form.category}
                  onChange={(next) => update('category', next)}
                  options={CATEGORY_OPTIONS}
                  placeholder="Choose a category"
                  variant="field"
                  className="w-full"
                  disabled={submitting}
                />
              </DetailFormField>
              {/* Rectangular dropdown, not pills: priority is an ordered scale
                  and equal-weight chips flatten that ordering. */}
              <DetailFormField
                label="Priority"
                htmlFor="report-priority"
                hint={`Drives dispatch order · WPDA ${previewScore}`}
              >
                <Select
                  ariaLabel="Priority"
                  value={form.priority}
                  onChange={(next) => update('priority', next)}
                  options={PRIORITY_OPTIONS}
                  variant="field"
                  className="w-full"
                  disabled={submitting}
                />
              </DetailFormField>
            </div>
            <DetailFormField
              label="Title"
              htmlFor="report-title"
              hint={`Optional · ${form.title.length}/${TITLE_MAX}. Left blank, it is titled after the category.`}
            >
              <input
                id="report-title"
                type="text"
                maxLength={TITLE_MAX}
                className={detailInputClass()}
                value={form.title}
                onChange={(event) => update('title', event.target.value)}
                placeholder="Short summary of what happened"
                disabled={submitting}
              />
            </DetailFormField>
          </DetailCard>

          <DetailCard icon={FileText} title="Incident notes / description" bodyClassName="">
            <DetailFormField
              label="Guard notes"
              htmlFor="report-description"
              required
              error={shown.description}
              action={
                <span className="text-small tabular-nums text-text-muted">
                  {form.description.length}/{DESCRIPTION_MAX}
                </span>
              }
            >
              <textarea
                id="report-description"
                rows={6}
                maxLength={DESCRIPTION_MAX}
                aria-invalid={Boolean(shown.description)}
                aria-describedby={shown.description ? 'report-description-error' : undefined}
                className={`w-full resize-none rounded-lg border bg-base-950 p-4 text-body font-medium leading-relaxed text-text-primary shadow-inner outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-text-muted ${
                  shown.description
                    ? 'border-danger/70 focus:border-danger focus:ring-4 focus:ring-danger/15'
                    : 'border-hairline hover:border-brand-500/30 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15'
                }`}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="What did you observe on arrival? Who was spoken to? Actions taken."
                disabled={submitting}
              />
            </DetailFormField>
          </DetailCard>

          <DetailCard icon={ImagePlus} title="Evidence upload">
            <EvidenceUploader
              uploads={attachments}
              heading="Photos, video or documents"
              hint="Supports photos, videos and PDFs up to 25 MB"
              disabled={submitting}
              inputLabel="Attach files to this report"
            />
          </DetailCard>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-small text-danger"
            >
              <ShieldAlert size="sm" className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* ═══ FOOTER: pinned, never scrolled past ═══ */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-950 px-6 py-3 sm:px-8">
        {/* The gate in words: a button that refuses with no reason reads as
            broken. Hidden below `sm:`, where the buttons take the row. */}
        <p
          aria-live="polite"
          className={`hidden min-w-0 flex-1 items-center gap-2 truncate text-small sm:flex ${
            attempted && blockers.length ? 'text-danger' : 'text-text-muted'
          }`}
        >
          <ShieldCheck size={14} className="shrink-0 text-success/70" aria-hidden="true" />
          <span className="truncate">{footerHint}</span>
        </p>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-hairline px-5 py-2 text-small font-semibold text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary disabled:opacity-50 sm:flex-none"
          >
            Cancel
          </button>
          {/* Enabled while incomplete, on purpose: pressing it is how a guard
              finds out what is missing, with each field marked. Disabled only
              while something is in flight. */}
          <button
            type="submit"
            disabled={busy}
            title={uploading ? 'Waiting for every attachment to finish uploading' : undefined}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2 text-small font-semibold text-[var(--color-cta-fg)] shadow-md transition-colors hover:bg-[var(--color-cta-hover)] active:scale-[0.97] disabled:opacity-60 sm:flex-none sm:min-w-[9rem]"
          >
            {busy ? <Loader2 size="sm" className="animate-spin" /> : <Send size="sm" />}
            {uploading ? 'Uploading…' : submitting ? 'Filing…' : 'Submit report'}
          </button>
        </div>
      </footer>
    </form>
  )
}

/**
 * "File Incident Report", as a dialog over the report directory.
 *
 * A dialog rather than a permanent rail beside the directory: filing takes a
 * minute at the end of a call, while checking what has been filed is what the
 * page is open for the rest of the shift. One primary action plus a dialog
 * gives each task the whole width at the moment it is being done.
 */
export default function FileReportModal({ open, onClose, onFiled }) {
  const [busy, setBusy] = useState(false)

  // The composer unmounts with the dialog and takes its own busy state with it,
  // but this flag lives in the shell and would survive — leaving the NEXT open
  // refusing to close, with nothing in flight to explain why.
  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  return (
    <ModalShell open={open} busy={busy} onClose={onClose}>
      <ReportComposer onClose={onClose} onFiled={onFiled} onBusyChange={setBusy} />
    </ModalShell>
  )
}
