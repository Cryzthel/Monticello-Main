import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { FilePlus2, Loader2, Send, ShieldAlert, X } from 'lucide-react'
import Select from '@shared/components/Select'
import AddressSelect from '@/components/AddressSelect'
import ResidentLocationPicker from '@/components/ResidentLocationPicker'
import AttachFileField from '@/components/AttachFileField'
import { usePropertyDirectory } from '@/hooks/usePropertyDirectory'
import { useResidentAddresses } from '@shared/hooks/useResidentAddresses'
import { useAuth } from '@shared/auth/AuthContext'
import { db } from '@shared/lib/firebase'
import { computePriorityScore } from '@shared/lib/wpda'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * What an officer-filed report is categorised as, now that the picker is gone.
 *
 * ── WHY A NAMED CONSTANT AND NOT THE OLD DEFAULT ──────────────────────────
 * The form defaulted to `Object.keys(CATEGORY_WEIGHTS)[0]`, which is `fire` —
 * the HIGHEST weight in the table at 10. Deleting the selector and leaving
 * that in place would have filed every guard report as a fire at maximum
 * dispatch weight: silently, with nothing on screen to contradict it, and
 * poisoning both the WPDA queue order and the Overview category breakdown.
 *
 * `security` (weight 7) is the honest answer for a report an officer files
 * from the guardhouse. It is also what makes the strict separation legible —
 * these records now live in their own view, and the one category they carry
 * says which view that is.
 */
const FILED_CATEGORY = 'security'

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Emergency' },
]

const TITLE_MAX = 90
const DESCRIPTION_MAX = 1200

const INITIAL_FORM = {
  title: '',
  priority: 'medium',
  phase: '',
  block: '',
  lot: '',
  description: '',
}

function Field({ label, htmlFor, hint, counter, children }) {
  // A <label> with no `for` is a label for nothing — Priority and Location are
  // a Select trigger and a group of three controls respectively, not single
  // form elements, so those render a plain <span> and name themselves via
  // aria-label instead. Same rule as the announcement composer's Field.
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">
          {label}
        </Label>
        {counter ? <span className="text-2xs tabular-nums text-text-muted">{counter}</span> : null}
      </div>
      {children}
      {hint ? <p className="mt-1.5 text-2xs leading-snug text-text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * The dialog shell.
 *
 * Deliberately the same object the Admin announcement composer sits in — scrim,
 * Escape, a bottom sheet below `sm:` and a centred card above it — so a modal in
 * the Guardhouse and a modal in the Admin console are one pattern rather than
 * two.
 *
 * `busy` disables every dismissal route at once (scrim, Escape, ×, Cancel).
 * The alternative, closing anyway, silently orphans an in-flight upload in
 * Storage: AttachFileField cancels a resumable task on `remove`, but NOT on
 * unmount, so a dismissed dialog leaves the bytes flowing. The alternative to
 * THAT — cancelling on close — throws away a transfer the guard has already
 * waited for, on the one console where that transfer is evidence. Refusing for
 * the few seconds it takes is the only option that loses nothing.
 *
 * Children render ONLY while open, which is load-bearing rather than tidy: the
 * composer below opens the resident directory and the property directory
 * listeners, and mounting it behind a closed dialog would hold both for the
 * whole shift to serve a form nobody has asked for yet. It also means the draft
 * resets on every open without a remount key.
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
  useDialogFocus({ open: open, containerRef: panelRef })

  if (!open) return null

  return (
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onClose()
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="File an incident report"
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none bg-base-900 shadow-modal sm:h-auto sm:max-h-[46rem] sm:rounded-b-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The report form itself.
 *
 * ── THREE BANDS, NOT ONE SCROLLING COLUMN ─────────────────────────────────
 * This was a single scrolling Card in the page's left rail with "Submit report"
 * as the last thing in the scroll. Inside a dialog that shape fails: the
 * resident picker, the Phase/Block/Lot cascade and the media grid push the
 * commit button below the fold, so the primary action of the dialog is
 * reachable only by scrolling to the end of a form you may not have finished
 * reading.
 *
 * Header / scrolling body / pinned footer instead. Only the middle band
 * scrolls, so the dialog's title and the button that commits it are both always
 * on screen — which is the whole reason to put this in a modal rather than
 * leaving it in a rail.
 *
 * Field order still follows the report itself: what happened, then who and
 * where, then evidence, then the guard's own account of it.
 */
function ReportComposer({ onClose, onFiled, onBusyChange }) {
  const { user } = useAuth()
  const directory = usePropertyDirectory()
  const {
    residents: residentDirectory,
    loading: residentsLoading,
    error: residentsError,
  } = useResidentAddresses()

  const [form, setForm] = useState(INITIAL_FORM)
  // The resident a report is filed ABOUT. Holding the whole record rather than
  // a uid keeps the confirmation card and the submitted document reading from
  // one object, so what the guard saw is what gets written.
  const [resident, setResident] = useState(null)
  // True only while the three location fields still hold exactly what the
  // profile supplied. Any manual edit drops it — see updateLocation.
  const [addressSynced, setAddressSynced] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Populated by AttachFileField as uploads land, already split into the
  // arrays the incident document expects.
  const [attachments, setAttachments] = useState({ photoUrls: [], videoUrls: [], attachmentUrls: [] })

  // One busy signal for the shell: a write in flight and a transfer in flight
  // both have to hold the dialog open, and the shell should not have to know
  // which of the two it is waiting on.
  const busy = submitting || uploading
  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Selecting a resident is the whole point of the picker: it fills Phase,
  // Block and Lot from what they registered on the phone, so the guard is
  // confirming an address rather than recalling one.
  //
  // A resident with no verified property fills nothing and leaves the fields
  // open. Blanking them would be worse than leaving them: a guard who picked
  // the person AFTER typing the location would silently lose their own input.
  function selectResident(next) {
    setResident(next)
    if (!next) return

    // FIELD BY FIELD, not all-or-nothing. This used to bail on
    // `if (!next.hasAddress) return`, and `hasAddress` is
    // `Boolean(phase && block && lot)` — so a resident who had registered a
    // phase and a block but no lot filled NOTHING, including the two fields
    // that were known. From the guard's side that is indistinguishable from a
    // picker that does not work, which is exactly how it was reported.
    //
    // A field the resident has no answer for keeps whatever is already in the
    // form rather than being blanked: a guard who typed the location first and
    // picked the person second must not lose their own input.
    setForm((prev) => ({
      ...prev,
      phase: next.phase || prev.phase,
      block: next.block || prev.block,
      lot: next.lot || prev.lot,
    }))

    // The badge claims "synced from profile", so it is true when ANY part of
    // the address came from there — and false for a resident with none, whose
    // fields are still entirely the guard's own.
    setAddressSynced(Boolean(next.phase || next.block || next.lot))
  }

  function clearResident() {
    setResident(null)
    setAddressSynced(false)
  }

  // Any hand edit to a location field means it is no longer the profile's
  // answer, so the 'synced' claim has to go with it. The resident stays
  // selected — the report is still ABOUT them, it just happened elsewhere.
  function updateLocation(patch) {
    setAddressSynced(false)
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const locationLabel = [
    form.phase && `Phase ${form.phase}`,
    form.block && `Block ${form.block}`,
    form.lot && `Lot ${form.lot}`,
  ]
    .filter(Boolean)
    .join(' • ')

  const complete = Boolean(form.phase && form.block && form.lot && form.description.trim())

  // Same scorer the dispatch queue sorts by, run on the draft — the guard sees
  // the urgency their choices produce rather than a number invented for display.
  const previewScore = useMemo(
    () =>
      Math.round(
        computePriorityScore({
          category: FILED_CATEGORY,
          severity: form.priority,
          reportedAt: new Date(),
        }),
      ),
    [form.priority],
  )

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await addDoc(collection(db, 'incidents'), {
        title: form.title.trim() || 'Security report',
        category: FILED_CATEGORY,
        phase: form.phase,
        block: form.block,
        lot: form.lot,
        propertyLabel: locationLabel,
        // The resident the report concerns. Stored alongside the address so a
        // reviewer can tell 'Phase 2 Block 7 Lot 14' apart from 'the lot Ana
        // Cruz registered', and so a later profile correction is traceable to
        // the reports filed against the old value.
        subjectUid: resident?.uid ?? '',
        subjectName: resident?.name ?? '',
        // Whether the three location fields came from that profile untouched.
        // Written rather than inferred: once the report is saved, an address
        // that matches the profile is indistinguishable from one a guard typed
        // to be identical, and only one of those is a verified lookup.
        locationFromProfile: addressSynced,
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
        wpdaScore: 0,
      })
      // The dialog closes on success and the page reports it above the feed.
      // Leaving it open over a blank form reads as "that did not work" — the
      // directory behind it has already taken the new row, and that row is the
      // one thing that would confirm the filing worked.
      onFiled()
    } catch (err) {
      setError(err.message ?? 'Unable to submit the report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-6 py-3.5">
        <FilePlus2 className="h-4 w-4 shrink-0 text-brand-500" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
          File incident report
        </h2>
        <button
          type="button"
          onClick={onClose}
          // Disabled rather than hidden while work is in flight: the control
          // staying put and refusing is clearer than a close button that
          // vanishes, and it keeps the header from reflowing mid-upload.
          disabled={busy}
          aria-label="Close report composer"
          title={busy ? 'Wait for the upload to finish' : 'Close'}
          className="icon-btn icon-btn-sm -mr-1.5"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* ── Body (the only band that scrolls) ── */}
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pb-8">
        <Field
          label="Title"
          htmlFor="report-title"
          counter={`${form.title.length}/${TITLE_MAX}`}
          hint={'Left blank, the ticket is titled "Security report".'}
        >
          <input
            id="report-title"
            type="text"
            maxLength={TITLE_MAX}
            className="field"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="Short summary of what happened"
          />
        </Field>

        {/* Rectangular dropdown, not pills: priority is an ordered scale and
            equal-weight chips flatten that ordering. */}
        <Field
          label="Priority"
          hint={`Drives dispatch ordering. This draft scores WPDA ${previewScore}.`}
        >
          <Select
            ariaLabel="Priority"
            value={form.priority}
            onChange={(next) => update('priority', next)}
            options={PRIORITY_OPTIONS}
            variant="field"
            className="w-full"
          />
        </Field>

        {/* ══ WHO AND WHERE ══
            One bordered group, not five loose fields. Resident and location
            are a single decision — picking the person answers the address —
            so they are framed together and the visual hierarchy says so: the
            picker first, the cascade indented under it as the result. */}
        <fieldset className="rounded-xl border border-hairline p-4">
          <legend className="px-1.5 text-xs font-semibold text-text-primary">
            Resident &amp; location
          </legend>

          <div className="flex flex-col gap-4">
            <Field
              label="Resident"
              hint="Optional. Choosing one fills the address below from their registered profile."
            >
              <ResidentLocationPicker
                residents={residentDirectory}
                loading={residentsLoading}
                error={residentsError}
                selected={resident}
                onSelect={selectResident}
                onClear={clearResident}
                disabled={submitting}
              />
            </Field>

            <div>
              {/* No "Synced from profile" tag. Picking a resident fills the
                  cascade below, and the filled fields ARE the confirmation —
                  a badge announcing that the thing you can see happened is a
                  second copy of the same message. `addressSynced` still
                  travels to the document as `locationFromProfile`, since the
                  provenance of an address is an audit fact. */}
              <div className="mb-1.5">
                <span className="text-xs font-medium text-text-secondary">Location</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <AddressSelect
                  id="report-phase"
                  label="Phase"
                  value={form.phase}
                  onChange={(next) => updateLocation({ phase: next, block: '', lot: '' })}
                  options={directory.phases}
                  placeholder="Phase"
                />
                <AddressSelect
                  id="report-block"
                  label="Block"
                  value={form.block}
                  onChange={(next) => updateLocation({ block: next, lot: '' })}
                  options={form.phase ? directory.blocksFor(form.phase) : []}
                  disabled={!form.phase}
                  disabledHint="Pick a phase"
                  placeholder="Block"
                />
                <AddressSelect
                  id="report-lot"
                  label="Lot"
                  value={form.lot}
                  onChange={(next) => updateLocation({ lot: next })}
                  options={form.phase && form.block ? directory.lotsFor(form.phase, form.block) : []}
                  disabled={!form.block}
                  disabledHint="Pick a block"
                  placeholder="Lot"
                />
              </div>

              {resident && !resident.hasAddress ? (
                <p className="mt-2 text-2xs leading-snug text-text-muted">
                  {resident.name} has not verified a property yet — enter the location manually.
                </p>
              ) : null}
            </div>
          </div>
        </fieldset>

        {/* No outer Field. The attachment control draws its own heading and
            hint, so a label over a heading over a hint restating both was three
            names for one control. The wrapper keeps the field and its
            "uploads finish in the background" note in one flex item. */}
        <div>
          <AttachFileField
            heading="Attachments"
            onChange={setAttachments}
            onBusyChange={setUploading}
            disabled={submitting}
          />
        </div>

        <Field
          label="Guard notes"
          htmlFor="report-description"
          counter={`${form.description.length}/${DESCRIPTION_MAX}`}
        >
          <textarea
            id="report-description"
            rows={6}
            required
            maxLength={DESCRIPTION_MAX}
            className="field-textarea resize-none leading-relaxed"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="What did you observe on arrival? Who was spoken to? Actions taken."
          />
        </Field>

        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>

      {/* ── Footer: pinned, never scrolled past ── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-6 py-3">
        {/* The gate, stated in words beside the button rather than left to the
            disabled look alone: a control that goes grey with no reason given
            reads as broken. Hidden below `sm:`, where the two buttons already
            take the whole row. */}
        <p className="hidden min-w-0 flex-1 truncate text-2xs text-text-muted sm:block">
          {uploading
            ? 'Waiting for the attachments to finish uploading'
            : complete
              ? 'Ready to file'
              : 'Location and notes are required'}
        </p>
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-sm btn-outline">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !complete}
          title={uploading ? 'Waiting for every attachment to finish uploading' : undefined}
          className="btn btn-sm btn-brand min-w-[8.5rem] flex-1 sm:flex-none"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {uploading ? 'Uploading…' : submitting ? 'Filing…' : 'Submit report'}
        </button>
      </div>
    </form>
  )
}

/**
 * "File Incident Report", as a dialog over the report directory.
 *
 * ── WHY THIS IS NO LONGER HALF THE PAGE ────────────────────────────────────
 * It used to be a fixed 27rem authoring rail beside the filed-reports table, on
 * the reasoning that composing and reviewing are two jobs at two tempos and each
 * deserved a column. The tempos were right; the conclusion was not. Filing takes
 * a minute at the end of a call; checking what has been filed is what the page
 * is open for the rest of the shift. A permanent split gave half the screen to
 * the rare task and cramped the frequent one — the directory never got the width
 * to show Location and Status without truncating, and the form never got the
 * room to lay its own fields out either.
 *
 * One primary action plus a dialog gives each task the whole width at the moment
 * it is being done, which is the trade the split was trying and failing to make.
 * It is also the shape the Admin announcements page already has, so a supervisor
 * moving between the two consoles meets one workflow rather than two.
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
