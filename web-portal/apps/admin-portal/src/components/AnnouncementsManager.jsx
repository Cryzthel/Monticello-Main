import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, orderBy, query } from 'firebase/firestore'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  Loader2,
  Megaphone,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  UserRound,
  X,
  Zap,
} from '@shared/icons'
import Card from '@shared/components/Card'
import TablePagination from '@shared/components/TablePagination'
import MediaAttachmentField from '@shared/components/MediaAttachmentField'
import SectionHeading from '@shared/components/SectionHeading'
import StatusBadge from '@shared/components/StatusBadge'
import Select from '@shared/components/Select'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { SkeletonCardGrid } from '@shared/components/Skeleton'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useWaitWhile } from '@/lib/waitState'
import { db } from '@shared/lib/firebase'
import {
  MAX_EDGE_PX,
  MAX_SOURCE_IMAGE_BYTES,
  compressImage,
  describeCompression,
} from '@shared/lib/imageCompression'
import { formatBytes } from '@shared/lib/attachments'
import {
  ANNOUNCEMENT_CATEGORIES,
  CATEGORY_OPTIONS,
  CATEGORY_TONES,
  MAX_ANNOUNCEMENT_IMAGES,
  MAX_IMAGE_BYTES,
  STATE_META,
  announcementImages,
  categoryLabel,
  announcementState,
  announcementViews,
  createAnnouncement,
  deleteAnnouncement,
  formatTimestamp,
  goLiveDate,
  publishNow,
  releaseDueAnnouncements,
  setArchived,
  setPinned,
  taxonomyLabel,
  taxonomyTone,
  timeUntil,
  updateAnnouncement,
  uploadAnnouncementImage,
} from '@/lib/announcements'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { announcementCategoryIcon } from '@shared/theme/categoryIcons'
import SearchField from '@shared/components/SearchField'

/**
 * The Announcements workspace — one feed, with composing on top of it.
 *
 *   Broadcast feed  ·  N active · N archived   [ + Create Announcement ]
 *   ┌─ toolbar: tabs · search · category ──────────────────────────┐
 *   ├─ card ── avatar/author/time · actions ───────────────────────┤
 *   │          title · body · gallery · pills/reach                │
 *   └──────────────────────────────────────────────────────────────┘
 *                     ↓ Create / Edit          ComposerModal (dialog)
 *
 * ── WHY THIS IS NO LONGER TWO PANELS ────────────────────────────────────────
 * It used to be a fixed 27rem composer rail beside the feed, on the reasoning
 * that composing and managing are two jobs at two tempos and each deserved its
 * own column. The tempos were right; the conclusion was not. One of those jobs
 * happens for thirty seconds a day and the other is continuous, so a permanent
 * split gave half the screen to the rare task and cramped the frequent one —
 * the feed never got the width to show a card at a readable measure, and the
 * form never got the room to lay its fields out properly either.
 *
 * One primary action plus a dialog gives each task the whole width at the moment
 * it is being done, which is the trade the split was trying and failing to make.
 *
 * The intermediate step — a Facebook-style compose bar with an avatar and three
 * quick actions — is gone too. It spent a full card saying what a button says,
 * and its three doors into one dialog were three decisions where the operator
 * had one.
 *
 * Every pill in here (category, state, tab counts) is the shared StatusBadge,
 * so a tag in the composer and the same tag in the feed are literally one
 * object. Category WORDS are a display layer — Notice / Alert / Update / Event
 * over stored General / Security / Maintenance / Event, which the mobile app
 * reads. See CATEGORY_LABELS in lib/announcements.js for why that indirection
 * is load-bearing rather than decorative.
 */

const TITLE_MAX = 90
const BODY_MAX = 1200

// 'scheduled' is CONDITIONAL — see visibleTabs below. Nothing can enter that
// bucket any more, so the tab exists only while a pre-existing backlog does.
const TABS = [
  // 'all' is a VIEW over the other three rather than a bucket of its own —
  // see `buckets` below, where it is assembled from them. The feed opens here
  // now: an operator arriving at the page wants "what have we broadcast", and
  // making them pick a lifecycle state first is a filter they did not ask for.
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'archived', label: 'Archived' },
]

const EMPTY_DRAFT = {
  title: '',
  body: '',
  category: ANNOUNCEMENT_CATEGORIES[0],
  priority: 'general',
  isPinned: false,
  // Committed download URLs, in the order they will appear to residents.
  // ONLY urls that have finished uploading ever reach this array — a tile that
  // is still compressing or transferring contributes nothing, so the draft can
  // never reference storage that does not exist yet. The composer owns the
  // richer per-tile state (progress, task handle, errors) locally.
  imageUrls: [],
}


/*
 * ── THE SCHEDULE CONTROL IS GONE; THE SCHEDULING MACHINERY IS NOT ──────────
 * `scheduledAt` no longer exists on the draft and there is no date field in
 * the composer: every announcement an admin writes now publishes immediately.
 *
 * What deliberately SURVIVED, and why removing it would have been a data loss
 * rather than a simplification:
 *
 *   the `scheduled` tab      Announcements queued before this change are still
 *                            in Firestore with `state: 'scheduled'` and
 *                            `isArchived: true`. `isArchived` is the only
 *                            thing that hides a document from residents (see
 *                            announcementState), so dropping the tab would
 *                            have left them invisible to BOTH audiences —
 *                            hidden from residents, unreachable by staff.
 *   releaseDueAnnouncements  The sweep that flips a due one to published. Kept
 *                            for the same reason: without it those documents
 *                            never surface again on their own.
 *   the "Publish now" action The manual override on a scheduled card, so an
 *                            admin can release one without waiting.
 *
 * The set therefore drains on its own — nothing new can enter it, and what is
 * in it either reaches its time or gets published by hand. Once the tab has
 * been empty for a release cycle, the sweep and the tab can go together.
 */
// ── Form primitives ─────────────────────────────────────────────────────────

function Field({ label, htmlFor, hint, counter, children }) {
  // A <label> with no `for` is a label for nothing — the picker fields below
  // are button groups, not form controls, so those render a plain <span> and
  // name themselves via aria-label instead.
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
      {hint ? <p className="mt-1.5 text-caption leading-snug text-text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * Category tags — the same oblong pill the feed renders, made selectable.
 *
 * The pill shows the friendly label (Notice / Alert / Update / Event) while
 * `onChange` still emits the stored value (General / Security / …). Keeping
 * those two apart here is what lets the wording change without touching a
 * single Firestore document — see CATEGORY_LABELS in lib/announcements.js.
 */
function TagPicker({ value, onChange }) {
  return (
    <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
      {ANNOUNCEMENT_CATEGORIES.map((category) => {
        const active = category === value
        return (
          <StatusBadge
            key={category}
            as="button"
            type="button"
            aria-pressed={active}
            onClick={() => onChange(category)}
            icon={announcementCategoryIcon(category)}
            tone={active ? CATEGORY_TONES[category] : 'neutral'}
            // The selected pill takes its category's own solid fill and a ring
            // drawn INSIDE the capsule, so the row does not shift by 2px as the
            // selection moves along it.
            //
            // The unselected pill is a full-strength neutral, not a dimmed one.
            // It carried `opacity-70`, which is a contrast reduction wearing a
            // state's clothing: #475569 on #F1F5F9 measures 6.92:1 at full
            // strength and lands near 4.3:1 once 30% of it is thrown away —
            // borderline at the very moment the control is asking to be read.
            // Unselected now reads clearly; SELECTED is what changes.
            className={`transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97] ${
              active ? 'ring-2 ring-inset' : 'hover:bg-base-700'
            }`}
          >
            {categoryLabel(category)}
          </StatusBadge>
        )
      })}
    </div>
  )
}


// ── Composer modal ──────────────────────────────────────────────────────────

/**
 * Scrim + panel. Deliberately the same object IncidentDetailModal is — bottom
 * sheet on a phone, centred dialog from `sm` up — so the two dialogs in this
 * console are one pattern rather than two.
 *
 * `busy` disables every dismissal route at once (scrim, Escape, ×, Cancel).
 * The alternative, closing anyway, silently orphans an in-flight upload in
 * Storage; the alternative to THAT, cancelling the uploads on close, throws
 * away work the operator has already waited for. Refusing for the few seconds
 * a transfer takes is the only option that loses nothing.
 */
function ComposerModal({ open, busy, onClose, children }) {
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef })
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

  if (!open) return null

  return (
    <div
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create announcement"
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none bg-base-900 shadow-modal sm:h-auto sm:max-h-[46rem] sm:rounded-b-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ── Composer ────────────────────────────────────────────────────────────────

let imageSeq = 0

function Composer({
  draft,
  setDraft,
  editing,
  onSubmit,
  onClose,
  onBusyChange,
  submitting,
  feedback,
  /** 'media' opens the file picker as soon as the dialog appears. */
  intent,
}) {
  const fileRef = useRef(null)
  const [uploadError, setUploadError] = useState('')

  /**
   * One entry per attached image:
   * `{ id, name, src, status, progress, url, task, error, note }`
   * where status is 'compressing' | 'uploading' | 'done' | 'error'.
   *
   * Seeded ONCE from the draft, which is correct rather than lazy: the parent
   * remounts this component (via `formKey`) on both reset and startEdit, so
   * "initial state" and "the notice being edited" are the same moment. A
   * `useEffect` syncing draft→items would instead fight the effect below that
   * syncs items→draft.
   */
  const [items, setItems] = useState(() =>
    (draft.imageUrls ?? []).map((url) => ({
      id: `existing-${(imageSeq += 1)}`,
      name: 'Current attachment',
      src: url,
      status: 'done',
      progress: 100,
      url,
    })),
  )

  const update = useCallback((id, patch) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  // Publish only what actually landed. The equality check matters: this effect
  // writes to the parent's draft, and returning `prev` unchanged when the URL
  // list is identical is what stops that write from re-rendering us into a loop.
  useEffect(() => {
    const urls = items.filter((item) => item.status === 'done' && item.url).map((item) => item.url)
    setDraft((prev) => {
      const same =
        prev.imageUrls.length === urls.length && prev.imageUrls.every((url, i) => url === urls[i])
      return same ? prev : { ...prev, imageUrls: urls }
    })
  }, [items, setDraft])

  /**
   * Blob previews are held by the document until revoked, so they have to be
   * released — but the release must be tied to the COMPONENT's lifetime, not to
   * `items`.
   *
   * The obvious version, `useEffect(() => () => revokeAll(items), [items])`, is
   * wrong and was wrong here before this change. React runs the previous
   * cleanup before every re-run, so an effect keyed on `items` revokes every
   * preview on every state change — which, during an upload, is on every
   * progress tick. The thumbnails survive only because React reuses the same
   * `<img>` DOM node and the browser never re-reads an already-decoded src; a
   * revoked blob: URL is genuinely dead for any NEW element, so the moment
   * anything remounts a tile the picture is gone.
   *
   * A ref holding the URLs we created, released on unmount, has neither
   * problem: nothing is revoked while it is still on screen, and nothing leaks
   * when the composer goes away. Individual previews are revoked eagerly in
   * removeImage, where the tile is genuinely finished with.
   */
  const previewUrls = useRef(new Set())
  useEffect(
    () => () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
      previewUrls.current.clear()
    },
    [],
  )

  function updateField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  function removeImage(item) {
    // Cancel first. Without this the transfer continues after the tile is gone
    // and the file lands in Storage referenced by nothing.
    item.task?.cancel?.()
    if (item.src?.startsWith('blob:')) {
      URL.revokeObjectURL(item.src)
      previewUrls.current.delete(item.src)
    }
    setUploadError('')
    setItems((prev) => prev.filter((entry) => entry.id !== item.id))
  }

  /**
   * Accept, downscale, then upload — in that order, and eagerly.
   *
   * COMPRESSION COMES FIRST because it is what makes the size limit humane. A
   * 12 MB photo off a phone used to be rejected outright against a 5 MB
   * ceiling, leaving the admin to go and resize it somewhere else. Now the
   * ceiling applies to the COMPRESSED payload, which a 24 MP photo clears
   * comfortably, so the common case simply works and the limit is only ever
   * met by something genuinely pathological.
   *
   * Each file walks its own pipeline independently, so one slow upload does not
   * hold up the rest and one failure does not discard the others.
   */
  async function handleFiles(event) {
    const picked = [...(event.target.files ?? [])]
    // Reset so re-picking the SAME file still fires onChange. Safe: the File
    // references above outlive the input's value.
    event.target.value = ''
    if (!picked.length) return

    setUploadError('')

    const room = MAX_ANNOUNCEMENT_IMAGES - items.length
    const problems = []
    const admitted = []

    picked.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        problems.push(`${file.name} — not an image`)
      } else if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        problems.push(`${file.name} — ${formatBytes(file.size)} is too large to process`)
      } else if (admitted.length >= room) {
        problems.push(`${file.name} — limit is ${MAX_ANNOUNCEMENT_IMAGES} images`)
      } else {
        admitted.push(file)
      }
    })

    if (problems.length) setUploadError(problems.join(' · '))

    admitted.forEach(async (source) => {
      const id = `img-${(imageSeq += 1)}`
      setItems((prev) => [
        ...prev,
        {
          id,
          name: source.name,
          src: null,
          status: 'compressing',
          progress: 0,
          originalBytes: source.size,
        },
      ])

      let file = source
      let note = null
      try {
        const { file: compressed, meta } = await compressImage(source)
        file = compressed
        note = describeCompression(meta)
      } catch {
        // Compression is an optimisation, never a gate. If canvas fails we
        // upload the original and let the size check below have the final say.
      }

      if (file.size > MAX_IMAGE_BYTES) {
        update(id, {
          status: 'error',
          error: `Still ${formatBytes(file.size)} after optimising — over the ${Math.round(
            MAX_IMAGE_BYTES / 1048576,
          )} MB limit.`,
          task: null,
        })
        return
      }

      // Preview the COMPRESSED bytes, not the original: what the admin sees is
      // then exactly what residents get, including any quality loss.
      const preview = URL.createObjectURL(file)
      previewUrls.current.add(preview)
      update(id, { src: preview, status: 'uploading', progress: 0, note })

      const { task, done } = uploadAnnouncementImage(file, (progress) => update(id, { progress }))
      update(id, { task })

      try {
        const url = await done
        update(id, { status: 'done', url, progress: 100, task: null })
      } catch (err) {
        if (err?.code === 'storage/canceled') return
        update(id, {
          status: 'error',
          task: null,
          error:
            err?.code === 'storage/unauthorized'
              ? 'Denied by Storage rules — run "firebase deploy --only storage".'
              : err?.code === 'storage/retry-limit-exceeded'
                ? 'Upload timed out. Check your connection.'
                : err?.message || 'Upload failed.',
        })
      }
    })
  }

  // No schedule branch any more: the composer publishes, full stop. See the
  // note above EMPTY_DRAFT for what happened to the scheduling control and
  // what deliberately survived it.
  /*
   * THE UPLOAD COMPLETION GUARD — now counting, not toggling.
   *
   * A tile is "pending" while it is compressing OR uploading. Both states mean
   * the same thing to this guard: there is no committed download URL yet, so
   * the draft's `imageUrls` does not contain it, so publishing now would write
   * an announcement missing that image.
   *
   * WHY THE STATUS IS THE TEST, NOT A PERCENTAGE. `uploadAnnouncementImage`
   * resolves only after `getDownloadURL` comes back, and 'done' is set there —
   * so 100% of the bytes sent is deliberately NOT enough to clear the guard.
   * The URL existing is.
   *
   * WHAT THIS FIXES, and it was a real one: publish used to be gated on
   * `submitting` alone. An admin who hit it mid-upload wrote the announcement
   * with an empty `imageUrl`, the transfer then finished into a draft that had
   * already been submitted and cleared, and the notice went out to every
   * resident with its image silently missing. Nothing errored, so nobody would
   * look. With several images per notice there are now several chances for that
   * race, which is exactly why the guard counts them.
   */
  const pending = items.filter(
    (item) => item.status === 'compressing' || item.status === 'uploading',
  )
  const uploadIncomplete = pending.length > 0
  const compressingCount = pending.filter((item) => item.status === 'compressing').length
  // Mean progress across live transfers, so the button reads as one job rather
  // than jumping between individual files' percentages.
  const aggregatePct = pending.length
    ? Math.round(pending.reduce((sum, item) => sum + (item.progress ?? 0), 0) / pending.length)
    : 0
  const submitLabel = editing ? 'Save changes' : 'Publish announcement'

  /**
   * Work in flight — an upload, a compression pass, or the write itself.
   *
   * Reported upward because the DIALOG has to know: dismissing the composer
   * mid-upload would leave the transfer running against a form that no longer
   * exists, landing an orphaned file in Storage that no announcement
   * references. The scrim, Escape, the × and Cancel all consult this.
   */
  const busy = submitting || uploadIncomplete
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  /**
   * "Photo" on the compose bar should land the operator in the file picker,
   * not merely in a dialog with a picker somewhere inside it — that is the
   * whole point of a quick action.
   *
   * Runs once on mount (the dialog is remounted per open via `formKey`), and
   * only when that was the intent.
   */
  useEffect(() => {
    if (intent === 'media') fileRef.current?.click()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, [])

  const tiles = items.map((item) => ({
    id: item.id,
    name: item.note && item.status === 'done' ? `${item.name} · ${item.note}` : item.name,
    type: 'image/*',
    src: item.src,
    status: item.status,
    progress: item.progress,
    error: item.error,
  }))

  /*
   * THREE BANDS, NOT ONE SCROLLING COLUMN.
   *
   * The composer used to be a single scrolling Card in the page's left rail,
   * with the Publish button as the last thing in the scroll. Inside a modal
   * that shape fails: on a laptop the media grid pushes Publish below the fold,
   * so the primary action of the dialog is reachable only by scrolling to the
   * end of a form you may not have finished reading.
   *
   * The form is now header / scrolling body / pinned footer. Only the middle
   * band scrolls, so the title of the dialog and the button that commits it are
   * both always on screen — which is the whole reason to put this in a modal
   * rather than leaving it in the rail.
   */
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-6 py-3.5">
        <Megaphone size="sm" className="shrink-0 text-brand-500" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
          {editing ? 'Edit announcement' : 'Create announcement'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          // Disabled rather than hidden while work is in flight: the control
          // staying put and refusing is clearer than a close button that
          // vanishes, and it keeps the header from reflowing mid-upload.
          disabled={busy}
          aria-label="Close composer"
          title={busy ? 'Wait for the upload to finish' : 'Close'}
          className="icon-btn icon-btn-sm -mr-1.5"
        >
          <X size="sm" />
        </button>
      </header>

      {/* ── Body (the only band that scrolls) ── */}
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pb-8">
        {editing ? (
          <div className="flex items-center gap-2 rounded-xl border border-info/25 bg-info/10 px-3 py-2.5">
            <Pencil size="sm" className="shrink-0 text-info" />
            <p className="min-w-0 flex-1 truncate text-xs text-info">Editing a published notice</p>
          </div>
        ) : null}

        <Field
          label="Title"
          htmlFor="announcement-title"
          counter={`${draft.title.length}/${TITLE_MAX}`}
        >
          <input
            id="announcement-title"
            type="text"
            required
            maxLength={TITLE_MAX}
            className="field"
            value={draft.title}
            onChange={(event) => updateField('title', event.target.value)}
            placeholder="Scheduled water interruption — Phase 2"
          />
        </Field>

        <Field
          label="Message"
          htmlFor="announcement-body"
          counter={`${draft.body.length}/${BODY_MAX}`}
        >
          <textarea
            id="announcement-body"
            rows={4}
            required
            maxLength={BODY_MAX}
            className="field-textarea resize-none leading-relaxed"
            value={draft.body}
            onChange={(event) => updateField('body', event.target.value)}
            placeholder="Details residents and guards need to know…"
          />
        </Field>

        {/* ══ TAXONOMY ══
            One field, one resulting badge. Category and priority used to be
            two separate Fields stacked above each other, which read as two
            unrelated decisions and produced two unrelated pills on the card.

            They are still two DATA axes (the phone reads `type` and knows
            nothing of priority — see lib/announcements.js), so this is not a
            twelve-option cartesian picker: it is the two choices framed as
            one, with the pill they combine into shown live underneath. The
            preview is the point — it is the only place the author sees what a
            resident will actually see before publishing. */}
        {/* ── "Appears as" and its preview badge are GONE ──────────────────
            The row underneath this picker used to read `Appears as [ Alert ]`,
            restating the selection the operator had just made, in the same pill,
            two inches below itself.

            It existed when category and priority were separate controls that
            combined into one badge — the preview was the only place you could
            see what the combination produced. The composer no longer offers a
            priority control (every new notice is 'general'), so the badge was
            showing the category back verbatim. The TagPicker below already
            renders each option AS its pill, in its real colour, with the
            selected one ringed: the answer to "what will residents see" is the
            control itself.

            The field label is now "Category" rather than "Taxonomy" for the
            same reason the values got plain-English labels — nobody filing a
            notice about a water outage is thinking about taxonomy. */}
        <Field label="Category" hint="What the notice is about. Residents see this on the card.">
          <TagPicker value={draft.category} onChange={(value) => updateField('category', value)} />
        </Field>

        {/* ── Media ──
            `MediaAttachmentField` is shared with the Guardhouse report
            composer, so attaching a file looks and behaves identically in both
            consoles. It is a port of the mobile app's `_MediaStep` /
            `PhotoEvidenceDropzone`; progress, the remove badge and the error
            line all live inside it, which is why the separate bar and error
            paragraph that used to sit here are gone.

            `capacity` is the announcement-specific part. It used to be 1,
            because the document held a single `imageUrl`; it is now
            MAX_ANNOUNCEMENT_IMAGES, because the document holds an `imageUrls`
            array (with `imageUrl` still written as the lead image for the
            mobile reader — see lib/announcements.js). The grid, the per-tile
            progress bar and the remove badge all come free: this is the same
            component, rendering more of the same tiles. */}
        <MediaAttachmentField
          heading="Media"
          hint={`Up to ${MAX_ANNOUNCEMENT_IMAGES} images — large photos are resized automatically`}
          capacity={MAX_ANNOUNCEMENT_IMAGES}
          items={tiles}
          error={uploadError}
          onPick={() => fileRef.current?.click()}
          onRemove={removeImage}
        />

        {/* `sr-only`, NOT `hidden`. A `display:none` input is not reliably
            clickable via `.click()` across browsers — Safari in particular
            refuses to open the picker for one — and it drops out of the
            accessibility tree entirely. sr-only keeps it rendered and
            focusable while staying invisible.

            `multiple` is the whole feature at the markup level; everything else
            is what happens to the files afterwards. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          aria-label="Attach images"
          onChange={handleFiles}
        />

        {compressingCount > 0 ? (
          <p className="-mt-2 text-caption text-text-muted">
            Optimising {compressingCount} image{compressingCount === 1 ? '' : 's'} for the web —
            large photos are downscaled to {MAX_EDGE_PX}px before upload.
          </p>
        ) : null}


        <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={draft.isPinned}
            onChange={(event) => updateField('isPinned', event.target.checked)}
            className="h-4 w-4 rounded border-tint/20 bg-tint/5 accent-brand-500"
          />
          <Pin size="sm" className="text-text-muted" />
          Pin to the top of the resident feed
        </label>

        {feedback ? (
          <p
            className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
              feedback.tone === 'danger'
                ? 'border-danger/30 bg-danger/10 text-danger'
                : 'border-success/30 bg-success/10 text-success'
            }`}
          >
            {feedback.tone === 'danger' ? (
              <ShieldAlert size="sm" className="mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 size="sm" className="mt-0.5 shrink-0" />
            )}
            {feedback.message}
          </p>
        ) : null}

      </div>

      {/* ── Footer: pinned, never scrolled past ── */}
      <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-6 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-sm btn-outline">
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-sm btn-brand min-w-[9rem]"
            disabled={submitting || uploadIncomplete}
            // Stated on the control, not left to the disabled look alone: a
            // button that goes grey with no reason given reads as broken.
            title={
              uploadIncomplete
                ? 'Waiting for every attachment to finish uploading'
                : undefined
            }
          >
            {submitting || uploadIncomplete ? (
              <Loader2 size="sm" className="animate-spin" />
            ) : (
              <Send size="sm" />
            )}
            {compressingCount > 0
              ? 'Optimising images…'
              : uploadIncomplete
                ? `Uploading ${pending.length > 1 ? `${pending.length} images ` : ''}${aggregatePct}%…`
                : submitting
                  ? 'Working…'
                  : submitLabel}
        </button>
      </div>
    </form>
  )
}

// ── Feed ────────────────────────────────────────────────────────────────────

function IconAction({ icon: Icon, label, onClick, active = false, tone = 'default' }) {
  const tones = {
    default: 'text-text-secondary hover:bg-tint/[0.06] hover:text-text-primary',
    danger: 'text-text-secondary hover:bg-danger/15 hover:text-danger',
    brand: 'text-brand-400 bg-brand-50 hover:bg-brand-100',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[color,background-color,transform] duration-150 active:scale-[0.94] ${
        active ? tones.brand : tones[tone]
      }`}
    >
      <Icon size="sm" />
    </button>
  )
}

/**
 * The media gallery, now used by the DETAIL dialog rather than the feed card.
 *
 * The card shows one square thumbnail with a "+N" count, on the reference's
 * shape; the full set lives here, one click away. That split is what makes the
 * card's clamped body and single thumbnail honest rather than lossy — nothing
 * is hidden, it is one press behind a button that says so.
 *
 * ── THE LAYOUT IS CHOSEN BY COUNT, NOT ONE GRID FOR EVERY CASE ─────────────
 * A single photo is the SUBJECT of the notice — a burst pipe, a gate notice —
 * so it runs full width at its own aspect ratio, uncropped. Cropping the only
 * image to a tile would hide the thing the announcement is about.
 *
 * Two or more are a set, and a set reads as a grid: there, square tiles are
 * right, because an even edge is what makes several images scan as one group
 * rather than a ragged stack.
 */
function AnnouncementGallery({ images, title }) {
  if (images.length === 0) return null

  if (images.length === 1) {
    return (
      <img
        src={images[0]}
        alt=""
        loading="lazy"
        // `h-auto`, no crop, no max-height: the card grows to the picture.
        className="w-full rounded-lg border border-slate-200 object-cover"
      />
    )
  }

  // Two side by side at 4:3; three or more in threes at 1:1. Six is the cap
  // the composer enforces, so this is at most two tidy rows.
  const columns = images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
  const ratio = images.length === 2 ? 'aspect-[4/3]' : 'aspect-square'

  return (
    <div className={`grid gap-1.5 ${columns}`}>
      {images.map((src, index) => (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          title={`${title || 'Announcement'} — image ${index + 1} of ${images.length}`}
          className={`w-full rounded-lg border border-slate-200 object-cover ${ratio}`}
        />
      ))}
    </div>
  )
}

/**
 * One broadcast, as a feed post.
 *
 * ── CONTENT-FIT, AND WHAT THAT COST ────────────────────────────────────────
 * Nothing in here has a fixed height and the body is no longer `line-clamp-2`.
 * A clamped body is a card that lies about its contents: two lines of a
 * six-line water-outage notice look complete, so an operator scanning the feed
 * to check what residents were told has to open every card to find out.
 *
 * `whitespace-pre-line` is part of the same fix — the composer's textarea
 * accepts paragraphs and the feed used to collapse every line break into one
 * run-on block.
 *
 * The trade is that a long notice makes a tall card. That is the correct
 * shape: the feed is a record of what was broadcast, and its cards should be
 * as big as what was said.
 *
 * ── BANDS, ON ONE RHYTHM ───────────────────────────────────────────────────
 * header → content → gallery → footer, each separated by the same `gap-3.5`,
 * with the footer divided by a hairline because it is metadata about the post
 * rather than part of it. Every band starts at the same left edge — the old
 * card indented its text past a 64px thumbnail, so the title and the body
 * began at a different x than the pills below them.
 */
/**
 * Read-only detail view — the destination "View Details" needs to exist.
 *
 * The feed card is a ROW now: one thumbnail, a two-line summary. That is the
 * right density for scanning a list, but only because the full notice is
 * reachable. Without this dialog the clamp would simply be lost information,
 * and the reference's own "View Details" button would be pointing at nothing.
 *
 * Deliberately read-only, and deliberately separate from the composer. Opening
 * the editor to READ a notice risks an accidental edit to something residents
 * have already been sent; the pencil beside this button is the way in when a
 * change is actually intended.
 */
function AnnouncementDetailModal({ announcement: a, onClose, onEdit }) {
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(a), containerRef: panelRef })
  useEffect(() => {
    if (!a) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [a, onClose])

  useEffect(() => {
    if (!a) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [a])

  if (!a) return null

  const state = announcementState(a)
  const stateMeta = STATE_META[state]
  const goLive = goLiveDate(a)
  const images = announcementImages(a)
  const views = announcementViews(a)

  return (
    <div
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={a.title || 'Announcement'}
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-b-none bg-base-900 shadow-modal sm:h-auto sm:max-h-[46rem] sm:rounded-b-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-6 py-3.5">
          <Megaphone size="sm" className="shrink-0 text-brand-500" />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
            Announcement details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="icon-btn icon-btn-sm -mr-1.5"
          >
            <X size="sm" />
          </button>
        </header>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 pb-8">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge tone={stateMeta.tone} size="sm" dot>
              {stateMeta.label}
            </StatusBadge>
            <StatusBadge tone={taxonomyTone(a.priority)} size="sm">
              {taxonomyLabel(a.type, a.priority)}
            </StatusBadge>
            {a.isPinned ? (
              <StatusBadge tone="brand" size="sm" icon={Pin}>
                Pinned
              </StatusBadge>
            ) : null}
            <span className="text-caption text-text-muted">
              · {goLive ? formatTimestamp(goLive) : 'not yet published'}
            </span>
          </div>

          <h3 className="text-lg font-semibold leading-snug tracking-tight text-text-primary">
            {a.title}
          </h3>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-secondary">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserRound size="sm" className="shrink-0 text-text-muted" />
              <span className="truncate">{a.authorName || 'Admin'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums text-text-muted">
              <Eye size="sm" className="shrink-0" />
              {views == null ? '—' : views.toLocaleString()}
            </span>
          </div>

          {/* The whole notice, line breaks intact — this is the surface the
              card's two-line clamp defers to, so nothing here may be trimmed. */}
          {a.body ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
              {a.body}
            </p>
          ) : null}

          <AnnouncementGallery images={images} title={a.title} />
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-6 py-3">
          <button type="button" onClick={onClose} className="btn btn-sm btn-outline">
            Close
          </button>
          <button
            type="button"
            onClick={() => onEdit(a)}
            className="btn btn-sm btn-brand min-w-[9rem]"
          >
            <Pencil size="sm" />
            Edit announcement
          </button>
        </div>
      </div>
    </div>
  )
}

function AnnouncementCard({ announcement: a, onView, onEdit, onDelete }) {
  const state = announcementState(a)
  const stateMeta = STATE_META[state]
  const views = announcementViews(a)
  const goLive = goLiveDate(a)
  const countdown = state === 'scheduled' ? timeUntil(a.scheduledFor) : null
  const images = announcementImages(a)
  const author = a.authorName || 'Admin'

  return (
    /* ── HORIZONTAL CARD, ON THE REFERENCE'S SHAPE ──────────────────────────
       Square thumbnail left, content right, actions along the bottom of the
       content column. `items-stretch` + `self-stretch` on the media is what
       makes the thumbnail track the card's height instead of the card padding
       out to a fixed thumbnail — the card is still content-fit, the image just
       fills whatever height the text asks for.

       `sm:` guards the horizontal split: below that the thumbnail goes
       full-width above the text, because a 160px image beside a 160px column
       is two cramped things rather than one card. */
    <li className="card card-interactive flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
      {images.length > 0 ? (
        /* A SQUARE thumbnail, per the reference — not one stretched to the
           card's height. Stretching made the crop a function of how much text
           happened to sit beside it, so the same photo was a letterbox on a
           short notice and a portrait on a long one; two cards in one list
           then cropped their images differently for no reason a reader could
           see. A fixed 1:1 makes the media column a straight edge down the
           feed, which is what the reference's alignment depends on. */
        <div className="relative aspect-square w-full shrink-0 self-start sm:w-36 lg:w-40">
          <img
            src={images[0]}
            alt=""
            loading="lazy"
            className="h-full w-full rounded-lg border border-slate-200 object-cover"
          />
          {/* The count, only when there IS more than one. The reference has a
              single image and no badge; this appears solely to answer "is
              there more media here", which View Details then shows in full. */}
          {images.length > 1 ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-2xs font-bold tabular-nums text-white">
              +{images.length - 1}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* ── Status pill inline with the timestamp ── */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <StatusBadge tone={stateMeta.tone} dot>
            {stateMeta.label}
          </StatusBadge>
          <span className="text-caption text-text-muted">
            · {goLive ? formatTimestamp(goLive) : 'not yet published'}
            {countdown ? ` · ${countdown}` : ''}
          </span>
        </div>

        {/* ── Title, at the reference's weight ── */}
        <div className="flex items-start gap-2">
          {a.isPinned ? <Pin size="sm" className="mt-1 shrink-0 text-brand-400" /> : null}
          <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug tracking-tight text-text-primary">
            {a.title}
          </h3>
        </div>

        {/* ── Metadata line ──
            The reference puts a pin glyph and a barangay here. An announcement
            has no location — it goes to everyone — so the equivalent facts are
            who broadcast it, what it was filed under, and how far it reached.
            Same row, same rank, same glyph-plus-label rhythm. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-secondary">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UserRound size="sm" className="shrink-0 text-text-muted" />
            <span className="truncate">{author}</span>
          </span>
          <StatusBadge tone={taxonomyTone(a.priority)}>
            {taxonomyLabel(a.type, a.priority)}
          </StatusBadge>
          {/* Honest by omission: nothing increments viewCount yet, so an
              untracked notice shows "—" rather than a confident zero. */}
          <span
            className="inline-flex items-center gap-1.5 tabular-nums text-text-muted"
            title={views == null ? 'View tracking not enabled yet' : `${views} resident views`}
          >
            <Eye size="sm" className="shrink-0" />
            {views == null ? '—' : views.toLocaleString()}
          </span>
        </div>

        {/* A two-line summary, not the whole notice. The card is now a row in a
            list rather than a post in a feed, and "View Details" is the
            reference's own answer to where the rest lives — so clamping here is
            honest: there is a place to read the full text, and it is one click
            away. */}
        {a.body ? (
          <p className="line-clamp-2 text-label leading-relaxed text-text-secondary">{a.body}</p>
        ) : null}

        {/* ── Actions, bottom-left, above a hairline ── */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <button type="button" onClick={() => onView(a)} className="btn btn-compact btn-outline h-8 py-0">
            View details
          </button>
          {state === 'scheduled' ? (
            <IconAction icon={Zap} label="Publish now" onClick={() => publishNow(a.id)} />
          ) : null}
          <IconAction icon={Pencil} label="Edit" onClick={() => onEdit(a)} />
          <IconAction
            icon={a.isPinned ? PinOff : Pin}
            label={a.isPinned ? 'Unpin' : 'Pin to top'}
            active={Boolean(a.isPinned)}
            onClick={() => setPinned(a.id, !a.isPinned)}
          />
          {state === 'scheduled' ? null : (
            <IconAction
              icon={state === 'archived' ? ArchiveRestore : Archive}
              label={state === 'archived' ? 'Restore' : 'Archive'}
              onClick={() => setArchived(a.id, state !== 'archived')}
            />
          )}
          <IconAction icon={Trash2} label="Delete" tone="danger" onClick={() => onDelete(a)} />
        </div>
      </div>
    </li>
  )
}

// ── Workspace ───────────────────────────────────────────────────────────────

export default function AnnouncementsManager() {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState(null)
  // Remount token for the composer — see resetComposer.
  const [formKey, setFormKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null)

  // ── Composer dialog ───────────────────────────────────────────────────────
  const [composerOpen, setComposerOpen] = useState(false)
  // 'media' → open the file picker on mount; 'pin' → arrive pre-pinned.
  const [composerIntent, setComposerIntent] = useState(null)
  // Mirrors the composer's in-flight state so the dialog can refuse to close
  // over a live upload. Lifted rather than inferred: only the composer knows
  // whether a transfer is running.
  const [composerBusy, setComposerBusy] = useState(false)

  const openComposer = useCallback((intent) => {
    setFeedback(null)
    setEditingId(null)
    setDraft(intent === 'pin' ? { ...EMPTY_DRAFT, isPinned: true } : EMPTY_DRAFT)
    setComposerIntent(intent ?? null)
    // Remount, so every open starts from a clean composer — see resetComposer
    // for why local state has to be cleared by construction rather than by
    // remembering to reset each piece.
    setFormKey((n) => n + 1)
    setComposerOpen(true)
  }, [])

  // The top bar's "Create announcement" lands here as `?compose=1` from any
  // page. The param is consumed once so a reload does not reopen the dialog.
  const [searchParams, setSearchParams] = useSearchParams()
  const composeRequested = searchParams.get('compose') === '1'
  useEffect(() => {
    if (!composeRequested) return
    openComposer()
    setSearchParams({}, { replace: true })
  }, [composeRequested, openComposer, setSearchParams])

  const closeComposer = useCallback(() => {
    if (composerBusy) return
    setComposerOpen(false)
    setComposerIntent(null)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFeedback(null)
  }, [composerBusy])

  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  // The category dropdown no longer offers "All", so the feed is ALWAYS scoped
  // to exactly one category and defaults to the first defined one. Note the
  // consequence: there is no longer any way to view every category at once —
  // re-adding 'All' to the options array below (and restoring the `!== 'All'`
  // guard) is the whole revert if that turns out to matter.
  const [categoryFilter, setCategoryFilter] = useState(ANNOUNCEMENT_CATEGORIES[0])
  // The announcement open in the read-only detail dialog, or null.
  const [viewing, setViewing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const announcementsQuery = useMemo(
    () => query(collection(db, 'announcements'), orderBy('publishedAt', 'desc')),
    [],
  )
  const { data: announcements, loading } = useLiveCollection(announcementsQuery)
  useWaitWhile(loading, 'Syncing the broadcast feed')

  // Drives both the scheduled-card countdowns and the release sweep below.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Releases anything that has fallen due. Re-entrancy guarded because the
  // write itself pushes a new snapshot straight back into this effect.
  const releasing = useRef(false)
  useEffect(() => {
    if (releasing.current || announcements.length === 0) return
    releasing.current = true
    releaseDueAnnouncements(announcements)
      .catch((err) => console.error('Failed to release scheduled announcements', err))
      .finally(() => {
        releasing.current = false
      })
  }, [announcements])

  const buckets = useMemo(() => {
    const result = { published: [], scheduled: [], archived: [] }
    announcements.forEach((a) => result[announcementState(a)].push(a))
    // Pinned first in the live list — the order the mobile app renders, so the
    // admin sees the priority they actually published.
    result.published.sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)))
    // Scheduled reads as a countdown queue: soonest first, not newest first.
    result.scheduled.sort((a, b) => (goLiveDate(a)?.getTime() ?? 0) - (goLiveDate(b)?.getTime() ?? 0))
    // Live first, then the queue, then the archive — the order they matter in,
    // not the order the object literal happens to list them.
    result.all = [...result.published, ...result.scheduled, ...result.archived]
    return result
  }, [announcements])


  /*
   * The Scheduled tab is shown only while something is actually in it.
   *
   * The composer can no longer queue an announcement, so for any deployment
   * with an empty backlog this tab is simply absent — which is what the brief
   * asked for. Where a backlog DOES exist, hiding the tab would be worse than
   * leaving it: those documents carry `isArchived: true`, so they are already
   * invisible to residents, and removing their only staff-side route would
   * strand them permanently instead of retiring them.
   *
   * The bucket drains on its own (releaseDueAnnouncements, plus the manual
   * "Publish now" on each card), and the tab retires itself with it.
   */
  const visibleTabs = useMemo(
    () => TABS.filter((t) => t.key !== 'scheduled' || buckets.scheduled.length > 0),
    [buckets.scheduled.length],
  )

  // If the last scheduled item publishes while that tab is open, the filter
  // above would leave `tab` pointing at a tab that no longer renders — an
  // empty feed with no selected control. Fall back to the live list.
  useEffect(() => {
    if (tab === 'scheduled' && buckets.scheduled.length === 0) setTab('published')
  }, [tab, buckets.scheduled.length])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return buckets[tab].filter((a) => {
      if ((a.type ?? ANNOUNCEMENT_CATEGORIES[0]) !== categoryFilter) return false
      if (!term) return true
      return `${a.title ?? ''} ${a.body ?? ''} ${a.authorName ?? ''}`.toLowerCase().includes(term)
    })
  }, [buckets, tab, search, categoryFilter])

  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const totalPages = Math.max(1, Math.ceil(visible.length / rowsPerPage))

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  // Switching tab, searching or changing category is a new list, not a new
  // page of the old one.
  useEffect(() => {
    setPage(1)
  }, [tab, search, categoryFilter, rowsPerPage])

  const pageVisible = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return visible.slice(start, start + rowsPerPage)
  }, [visible, page, totalPages, rowsPerPage])

  /**
   * Return the composer to a blank slate.
   *
   * Clearing `draft` alone was not enough, and this was the bug: the image
   * attachment has TWO pieces of state. `draft.imageUrl` is the uploaded
   * URL and lives up here, but the local `URL.createObjectURL` preview lives
   * inside Composer, where the parent cannot reach it. After a successful
   * publish the draft went blank while the preview thumbnail stayed on screen
   * — and because the attachment slot renders `draft.imageUrl || preview`, the
   * cleared URL simply fell through to the stale blob. The next announcement
   * then looked like it already had an image attached when it did not.
   *
   * Bumping `formKey` remounts Composer, which resets every piece of its local
   * state at once — preview, upload progress, upload error — and fires the
   * effect cleanup that revokes the blob URL, so nothing leaks either. It also
   * means any local state added to Composer later is cleared by construction
   * rather than by someone remembering to add a line here.
   */
  function resetComposer() {
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setFormKey((n) => n + 1)
    // The dialog closes on success. Leaving it open over a blank form after a
    // publish reads as "that did not work" — the feed behind it has already
    // updated, but the operator cannot see it.
    setComposerOpen(false)
    setComposerIntent(null)
  }

  function startEdit(a) {
    setEditingId(a.id)
    setFeedback(null)
    setComposerIntent(null)
    setComposerOpen(true)
    // Remount for the same reason a publish does: loading a notice that has no
    // image must not inherit a preview left over from the previous draft.
    setFormKey((n) => n + 1)
    setDraft({
      ...EMPTY_DRAFT,
      title: a.title ?? '',
      body: a.body ?? '',
      category: a.type ?? ANNOUNCEMENT_CATEGORIES[0],
      priority: a.priority ?? 'general',
      isPinned: Boolean(a.isPinned),
      imageUrls: announcementImages(a),
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFeedback(null)

    setSubmitting(true)
    try {
      if (editingId) {
        await updateAnnouncement(editingId, draft)
        await setPinned(editingId, draft.isPinned)
        setFeedback({ tone: 'success', message: 'Changes saved — residents see the update immediately.' })
      } else {
        await createAnnouncement({ ...draft, scheduledFor: null })
        setFeedback({
          tone: 'success',
          message: 'Published — residents and guards see it immediately.',
        })
      }
      resetComposer()
    } catch (err) {
      setFeedback({ tone: 'danger', message: err?.message ?? 'Unable to save. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!confirming) return
    setDeleting(true)
    try {
      await deleteAnnouncement(confirming.id)
      if (editingId === confirming.id) resetComposer()
      setConfirming(null)
    } catch (err) {
      console.error('Failed to delete announcement', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    /* ══ ONE COLUMN, THE FEED ══
       The page is the broadcast feed now; composing is a dialog on top of it.
       `max-w-3xl` centred is the readable measure for stacked cards — the old
       two-up grid at 2xl put two unrelated notices side by side, which reads as
       a comparison rather than a chronology. */
    <div className="custom-scrollbar h-full min-h-0 overflow-y-auto pb-6">
      <div className="flex w-full flex-col gap-5 pb-8">
        {/* ── Feed header: identity on the left, the one primary action right ──
            The compose bar that used to sit here — avatar, "Share an
            announcement…", three quick-action buttons — is gone. It cost a
            whole card to say what a button says, and its quick actions
            (Photos / Announcement / Pin) were three doors into one dialog,
            which is three decisions where the operator had one. A single
            high-contrast control states the action once and leaves the column
            to the feed. */}
        <SectionHeading
          title="Broadcast feed"
          description={[
            buckets.published.length + ' active',
            buckets.scheduled.length ? buckets.scheduled.length + ' scheduled' : null,
            buckets.archived.length + ' archived',
          ]
            .filter(Boolean)
            .join(' · ')}
          action={
            <button type="button" onClick={() => openComposer()} className="btn btn-sm btn-brand">
              <Plus size="sm" />
              Create announcement
            </button>
          }
        />

        <section className="flex flex-col gap-4">
          {/* ── UTILITY TOOLBAR: search left, filter pills right ─────────────
              One row, on the reference's shape: the search field takes the
              slack and the lifecycle filters sit at the far right as discrete
              pills rather than a segmented control in a bordered tray.

              Pills rather than a tray because there are four of them now and a
              tray of four reads as one wide object you have to parse; separate
              pills read as four choices, one of which is on. The count rides
              inside each pill so the filter states its own size — "Archived 12"
              answers "is it worth looking?" before the click.

              The category Select stays a dropdown. It has four options that are
              a different QUESTION (what the notice is about, not where it is in
              its life), and flattening it into the same pill row would put two
              unrelated axes in one undifferentiated strip. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, message, or author"
              className="min-w-0 flex-1"
            />

            <div className="flex flex-wrap items-center gap-2">
              {/* `.chip` — the shared filter capsule. h-9 keeps these on the
                  search field's baseline, which is the one deliberate
                  departure from the chip's standard 28px. */}
              {visibleTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-pressed={tab === t.key}
                  className={`chip h-9 ${tab === t.key ? 'chip-active' : 'chip-idle'}`}
                >
                  {t.label}
                  <span className="count-pill">{buckets[t.key].length}</span>
                </button>
              ))}

              <Select
                ariaLabel="Filter by category"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={CATEGORY_OPTIONS}
                className="min-w-[9.5rem]"
              />
            </div>
          </div>

        {loading ? (
          /* Was three bare `h-44` grey boxes. A featureless slab is a loading
             GRAPHIC — it tells the reader something is coming but nothing about
             its shape, so the swap still reads as a pop. The structured version
             draws the announcement card's actual anatomy (author avatar, title,
             timestamp, three lines of body), which is what makes the arrival a
             fill-in rather than a replacement. */
          <SkeletonCardGrid count={3} height="h-44" className="flex flex-col gap-4" />
        ) : visible.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-20 text-center">
            <Megaphone size={28} className="text-text-muted" />
            <p className="text-sm text-text-secondary">
              {search
                ? 'No announcements match those filters.'
                : tab === 'scheduled'
                  ? `Nothing scheduled under ${categoryLabel(categoryFilter)}.`
                  : tab === 'archived'
                    ? `Nothing archived under ${categoryLabel(categoryFilter)}.`
                    : tab === 'all'
                      ? // The 'all' tab needed its own line. Without it the new
                        // default view fell through to the 'published' wording
                        // and told an operator looking at EVERY state that
                        // nothing was "published" — which is a different, and
                        // wrong, claim.
                        `No announcements under ${categoryLabel(categoryFilter)} yet.`
                      : `Nothing published under ${categoryLabel(categoryFilter)}.`}
            </p>
          </Card>
        ) : (
          /* A stacked list, not the 12-column page grid. Cards are a
             chronology read top to bottom; the old `2xl:col-span-6` put two
             unrelated notices shoulder to shoulder, which reads as a comparison
             and breaks the reading order. `gap-4` matches every other gap in
             this column, so header, toolbar and cards sit on one vertical
             grid. */
          <ul className="flex flex-col gap-4">
            {pageVisible.map((a) => (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                onView={setViewing}
                onEdit={startEdit}
                onDelete={setConfirming}
              />
            ))}
          </ul>
        )}

        <TablePagination
          page={page}
          rowsPerPage={rowsPerPage}
          totalItems={visible.length}
          onPageChange={setPage}
          onRowsPerPageChange={setRowsPerPage}
          itemLabel="announcement"
        />
        </section>
      </div>

      {/* Editing from the detail view closes it first, so the two dialogs are
          never stacked — the composer must be the only thing on top. */}
      <AnnouncementDetailModal
        announcement={viewing}
        onClose={() => setViewing(null)}
        onEdit={(a) => {
          setViewing(null)
          startEdit(a)
        }}
      />

      <ComposerModal open={composerOpen} busy={composerBusy} onClose={closeComposer}>
        <Composer
          key={formKey}
          draft={draft}
          setDraft={setDraft}
          editing={Boolean(editingId)}
          submitting={submitting}
          feedback={feedback}
          intent={composerIntent}
          onSubmit={handleSubmit}
          onClose={closeComposer}
          onBusyChange={setComposerBusy}
        />
      </ComposerModal>

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={deleting}
        tone="danger"
        title="Delete this announcement?"
        message={`"${confirming?.title ?? ''}" will be removed permanently — there is no trash for broadcasts. Archive it instead if you only want it off the resident feed.`}
        confirmLabel="Delete permanently"
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
