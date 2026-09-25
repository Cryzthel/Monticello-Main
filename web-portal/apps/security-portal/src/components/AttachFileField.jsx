import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ACCEPT_ATTRIBUTE,
  bucketFor,
  describeUploadError,
  formatBytes,
  isAcceptedType,
  uploadIncidentAttachment,
} from '@shared/lib/attachments'
import MediaAttachmentField from '@shared/components/MediaAttachmentField'
import {
  MAX_SOURCE_IMAGE_BYTES,
  compressImage,
  describeCompression,
  isCompressibleImage,
} from '@shared/lib/imageCompression'
import { getSettings } from '@shared/lib/systemSettingsStore'
import { attachmentLimitBytes } from '@shared/lib/attachments'

/**
 * Multi-file attachment field for a guard's report.
 *
 * Uploads start the moment a file is chosen rather than on submit. A guard
 * filing from a phone in a guardhouse is the slow-connection case: deferring a
 * 20 MB clip to submit-time turns "Submit report" into a thirty-second stall
 * with no feedback, and any failure surfaces after the form has already been
 * cleared. Uploading eagerly means the progress is visible while they are
 * still typing the notes, and submit only ever writes URLs that already exist.
 *
 * Each chip owns its resumable task, so "remove" during an upload CANCELS it
 * rather than merely hiding the row — otherwise the bytes keep flowing and the
 * file lands in Storage orphaned, paid for and referenced by nothing.
 *
 * `onChange` receives `{ photoUrls, videoUrls, attachmentUrls }`, already split
 * into the arrays the incident document expects — images and video must stay
 * in the fields the Flutter app reads. See lib/attachments.js.
 *
 * `onBusyChange` reports whether any tile is still compressing or transferring.
 * It exists because this field now lives inside a dialog: unmounting mid-upload
 * does NOT cancel the resumable tasks (only `remove` does), so a guard who
 * dismissed the composer while a clip was in flight would leave the bytes
 * flowing into Storage, paid for and referenced by nothing. The dialog reads
 * this to refuse every dismissal route for the few seconds a transfer takes —
 * see FileReportModal, which makes the same trade the announcement composer does.
 */
let seq = 0

export default function AttachFileField({ onChange, onBusyChange, disabled = false, heading = 'Media' }) {
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState('')

  // Report only the files that actually landed. A chip mid-upload or in error
  // must not contribute a URL — the report would reference nothing.
  useEffect(() => {
    const buckets = { photoUrls: [], videoUrls: [], attachmentUrls: [] }
    items
      .filter((item) => item.status === 'done' && item.url)
      .forEach((item) => buckets[bucketFor(item.type)].push(item.url))
    onChange?.(buckets)
  }, [items, onChange])

  /**
   * Blob previews are held by the document until revoked, and the release has
   * to be tied to this COMPONENT's lifetime rather than to `items`.
   *
   * This used to be `useEffect(() => () => revokeAll(items), [items])`, which
   * is wrong: React runs the previous cleanup before every re-run, so an effect
   * keyed on `items` revokes every preview on every state change — during an
   * upload, on every progress tick. The thumbnails survived only because React
   * reuses the same `<img>` node and the browser never re-reads an
   * already-decoded src. A revoked blob: URL is genuinely dead for any NEW
   * element, so a tile that remounted for any reason lost its picture.
   *
   * A ref of the URLs we created, released on unmount, has neither problem.
   * Individual previews are revoked in `remove`, where the tile is finished.
   */
  const previewUrls = useRef(new Set())
  useEffect(
    () => () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
      previewUrls.current.clear()
    },
    [],
  )

  const update = useCallback((id, patch) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const accept = useCallback(
    (fileList) => {
      const files = [...fileList]
      if (!files.length) return

      const problems = []
      const admitted = []

      files.forEach((file) => {
        if (!isAcceptedType(file.type)) {
          problems.push(`${file.name} — unsupported type`)
        } else if (isCompressibleImage(file.type)) {
          // Images are NOT size-checked here. They are downscaled below, and a
          // 20 MP phone photo compresses to well under a megabyte — rejecting
          // it up front against the 25 MB video limit would refuse a file we
          // are about to make small. The post-compression check is the real
          // gate, and it sits after the work that decides the answer.
          if (file.size > MAX_SOURCE_IMAGE_BYTES) {
            problems.push(`${file.name} — ${formatBytes(file.size)} is too large to process`)
          } else {
            admitted.push(file)
          }
        } else if (file.size > attachmentLimitBytes(getSettings())) {
          problems.push(`${file.name} — ${formatBytes(file.size)}, over the 25 MB limit`)
        } else {
          admitted.push(file)
        }
      })

      setRejected(problems.join(' · '))

      admitted.forEach(async (source) => {
        const id = `f${(seq += 1)}`
        const compressible = isCompressibleImage(source.type)

        setItems((prev) => [
          ...prev,
          {
            id,
            name: source.name,
            size: source.size,
            type: source.type,
            preview: null,
            // Video, PDF and GIF go straight to 'uploading' — there is nothing
            // to optimise, and showing "Optimising…" for a file we are not
            // touching would be a lie about where the time is going.
            status: compressible ? 'compressing' : 'uploading',
            progress: 0,
          },
        ])

        let file = source
        let note = null
        if (compressible) {
          try {
            const { file: compressed, meta } = await compressImage(source)
            file = compressed
            note = describeCompression(meta)
          } catch {
            // Compression is an optimisation, never a gate. On failure we
            // upload the original and let the size check below decide — a
            // guard's evidence must not be dropped because a canvas call threw.
          }
        }

        if (file.size > attachmentLimitBytes(getSettings())) {
          update(id, {
            status: 'error',
            error: `${formatBytes(file.size)} — over the ${Math.round(
              attachmentLimitBytes(getSettings()) / 1048576,
            )} MB limit`,
            task: null,
          })
          return
        }

        // Preview the bytes that will actually be uploaded, so the tile is an
        // honest picture of what the report will carry.
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        if (preview) previewUrls.current.add(preview)
        update(id, { preview, type: file.type, size: file.size, status: 'uploading', progress: 0, note })

        const { task, done } = uploadIncidentAttachment(file, (progress) => update(id, { progress }))
        update(id, { task })
        done
          .then((url) => update(id, { status: 'done', url, progress: 100, task: null }))
          .catch((err) => {
            if (err?.code === 'storage/canceled') return
            update(id, { status: 'error', error: describeUploadError(err), task: null })
          })
      })
    },
    [update],
  )

  function remove(item) {
    // Cancel first — an in-flight task keeps uploading otherwise.
    item.task?.cancel?.()
    if (item.preview) {
      URL.revokeObjectURL(item.preview)
      previewUrls.current.delete(item.preview)
    }
    setItems((prev) => prev.filter((entry) => entry.id !== item.id))
  }

  const uploading = items.some(
    (item) => item.status === 'uploading' || item.status === 'compressing',
  )

  // Raised through an effect rather than called from the render body:
  // `onBusyChange` sets state in the parent, and a parent state update issued
  // during a child's render is React's "Cannot update a component while
  // rendering a different component" warning.
  useEffect(() => {
    onBusyChange?.(uploading)
  }, [uploading, onBusyChange])

  // Shape the upload state into the tiles the shared field renders. `src` is
  // the local blob for images and absent for everything else — the grid draws a
  // type glyph in that case, so a PDF is a cell in the same grid rather than a
  // different kind of row.
  const tiles = items.map((item) => ({
    id: item.id,
    // Once landed, the caption carries what compression saved ("IMG_4821.webp
    // · 88% smaller"). A guard who just watched a 9 MB photo become 700 KB
    // should be told that happened, not left wondering whether the portal
    // quietly degraded their evidence.
    name: item.note && item.status === 'done' ? `${item.name} · ${item.note}` : item.name,
    type: item.type,
    src: item.preview,
    status: item.status,
    progress: item.progress,
    error: item.error,
  }))

  return (
    <>
      <MediaAttachmentField
        heading={heading}
        hint={`Images, video, PDF or .txt — photos are resized automatically, other files up to ${Math.round(
          attachmentLimitBytes(getSettings()) / 1048576,
        )} MB`}
        items={tiles}
        error={rejected || undefined}
        disabled={disabled}
        dragging={dragging}
        onPick={() => inputRef.current?.click()}
        onRemove={remove}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!disabled) accept(event.dataTransfer.files)
        }}
      />

      {/* sr-only, NOT hidden: a display:none input is not reliably clickable
          via .click() across browsers and drops out of the a11y tree. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        aria-label="Attach files to this report"
        onChange={(event) => {
          accept(event.target.files)
          event.target.value = '' // re-picking the same file must re-fire
        }}
      />

      {uploading ? (
        <p className="mt-2 text-2xs text-text-muted">
          Uploads finish in the background — you can keep writing your notes.
        </p>
      ) : null}
    </>
  )
}
