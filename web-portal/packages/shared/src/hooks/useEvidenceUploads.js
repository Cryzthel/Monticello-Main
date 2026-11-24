import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACCEPT_ATTRIBUTE,
  MEDIA_ACCEPT_ATTRIBUTE,
  STREAMABLE_MEDIA_ACCEPT_ATTRIBUTE,
  attachmentLimitBytes,
  bucketFor,
  contentTypeOf,
  describeUploadError,
  formatBytes,
  uploadIncidentAttachment,
} from '@shared/lib/attachments'
import { COMPRESS_ABOVE_BYTES, isBrowserPlayable, isVideoFile, videoContentType } from '@shared/lib/videoCompression'
import { uploadVideoEvidence } from '@shared/lib/videoEvidence'
import { MAX_SOURCE_IMAGE_BYTES, compressImage, isCompressibleImage } from '@shared/lib/imageCompression'
import { getSettings } from '@shared/lib/systemSettingsStore'

const IMAGE_ACCEPT_ATTRIBUTE = 'image/png,image/jpeg,image/webp,image/gif'

let seq = 0

function kindOf(file) {
  if (isVideoFile(file)) return 'video'
  if (contentTypeOf(file).startsWith('image/')) return 'image'
  const type = contentTypeOf(file)
  if (type === 'application/pdf' || type.startsWith('text/plain')) return 'document'
  return null
}

const isCanceled = (err) => err?.code === 'storage/canceled' || err?.name === 'ConversionCanceledError'

/**
 * THE ONE UPLOAD ENGINE behind every evidence picker (2026-10-29, by request):
 * File a Report, Resolve incident, Resolve SOS and the announcement composer.
 * Each used to carry its own copy — AttachFileField, usePhotoUploads and the
 * composer's inline pipeline — and the copies had drifted into different bugs.
 * What this one guarantees, everywhere at once:
 *
 *   - REMOVE MEANS STOPPED. A tile removed while its photo was still being
 *     resized used to carry on into the upload once the resize finished (no
 *     task existed yet to cancel), landing a file in Storage referenced by
 *     nothing. Every await now checks the job's own cancelled flag.
 *   - NO UNHANDLED REJECTIONS. Each file's pipeline is one try/catch, so a
 *     synchronous throw from the SDK becomes a failed tile, not a tile stuck
 *     on "Uploading" that holds its dialog open for good.
 *   - NOTHING SILENTLY DROPPED. A file over the limit, past the cap or of the
 *     wrong type is named in `rejected`; usePhotoUploads used to discard them.
 *   - RETRY. A failed tile keeps its source file and can be tried again
 *     without picking it twice.
 *   - Cancel on unmount and on `reset`, previews revoked with them.
 *
 * Images are resized on the device (a failure there uploads the original);
 * videos go through lib/videoEvidence.js; documents go up as they are.
 *
 * @param {object}   options
 * @param {number}   [options.maxPhotos]   Photo cap; omit for none.
 * @param {number}   [options.maxVideos]   0 refuses video.
 * @param {boolean}  [options.documents]   Accept PDF and plain text.
 * @param {number}   [options.maxFileBytes] Ceiling for a photo after resizing,
 *   and for a document. Defaults to the admin-set attachment limit.
 * @param {Function} [options.uploadFile]  `(file, onProgress, { contentType, name })
 *   → { task, done }`, for photos, videos and video posters alike; defaults to
 *   the incident evidence folder.
 * @param {string[]} [options.initialUrls] Photos already attached (editing).
 * @param {object[]} [options.initialVideos] `videoMeta` records already attached
 *   (editing): `{ url, posterUrl, contentType, … }`.
 * @param {boolean}  [options.streamableOnly] Refuse AVI — for media residents
 *   watch inline, where an AVI could only be downloaded.
 */
export function useEvidenceUploads({
  maxPhotos = Infinity,
  maxVideos = 0,
  documents = false,
  maxFileBytes,
  uploadFile = uploadIncidentAttachment,
  initialUrls = [],
  initialVideos = [],
  streamableOnly = false,
} = {}) {
  const [items, setItems] = useState(() => [
    ...initialUrls.map((url) => ({
      id: `e${(seq += 1)}`,
      kind: 'image',
      name: 'Current attachment',
      type: 'image/*',
      preview: url,
      status: 'done',
      progress: 100,
      url,
    })),
    ...initialVideos.map((meta) => ({
      id: `e${(seq += 1)}`,
      kind: 'video',
      name: 'Current video',
      type: meta.contentType || 'video/mp4',
      preview: meta.posterUrl ?? null,
      status: 'done',
      progress: 100,
      url: meta.url,
      meta,
    })),
  ])
  const [rejected, setRejected] = useState('')

  // Uploads start OUTSIDE state updaters (React may run an updater twice in
  // development), so the current list is read from this ref.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const jobs = useRef(new Map())
  const previews = useRef(new Set())

  const patch = useCallback((id, next) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }, [])

  const limit = () => maxFileBytes ?? attachmentLimitBytes(getSettings())

  const makePreview = (blob) => {
    const url = URL.createObjectURL(blob)
    previews.current.add(url)
    return url
  }
  const dropPreview = (url) => {
    if (url && previews.current.delete(url)) URL.revokeObjectURL(url)
  }

  const start = useCallback(
    async (item) => {
      const job = { canceled: false, cancel: () => {} }
      jobs.current.set(item.id, job)
      const stopped = () => job.canceled
      const source = item.file

      try {
        if (item.kind === 'video') {
          const video = uploadVideoEvidence(source, {
            upload: uploadFile,
            onUpdate: ({ preview, ...next }) => {
              if (stopped()) {
                if (preview) URL.revokeObjectURL(preview)
                return
              }
              if (preview) previews.current.add(preview)
              patch(item.id, preview ? { ...next, preview } : next)
            },
          })
          job.cancel = video.cancel
          const { url, meta } = await video.done
          if (stopped()) return
          patch(item.id, { status: 'done', progress: 100, url, meta, type: meta.contentType })
          return
        }

        let file = source
        if (item.kind === 'image' && isCompressibleImage(source.type)) {
          try {
            file = (await compressImage(source)).file
          } catch {
            // Resizing is an optimisation, never a gate: the original goes up
            // if it fits the limit below.
          }
          if (stopped()) return
        }

        if (file.size > limit()) {
          patch(item.id, {
            status: 'error',
            error: `Too large (${formatBytes(file.size)}). The limit is ${Math.round(limit() / 1048576)} MB.`,
          })
          return
        }

        const preview = item.kind === 'image' ? makePreview(file) : null
        patch(item.id, { status: 'uploading', progress: 0, ...(preview ? { preview } : {}) })
        const { task, done } = uploadFile(file, (progress) => {
          if (!stopped()) patch(item.id, { progress })
        })
        job.cancel = () => task.cancel()
        if (stopped()) task.cancel()
        const url = await done
        if (stopped()) return
        patch(item.id, { status: 'done', progress: 100, url })
      } catch (err) {
        if (stopped() || isCanceled(err)) return
        console.error('Evidence upload failed', err)
        patch(item.id, { status: 'error', error: describeUploadError(err) })
      } finally {
        if (jobs.current.get(item.id) === job) jobs.current.delete(item.id)
      }
    },
    // `limit` reads settings at call time; `uploadFile` and the cap are config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, uploadFile, maxFileBytes],
  )

  const add = useCallback(
    (fileList) => {
      const picked = [...(fileList ?? [])]
      if (!picked.length) return
      const counts = { image: 0, video: 0, document: 0 }
      itemsRef.current.forEach((item) => {
        counts[item.kind] += 1
      })
      const caps = { image: maxPhotos, video: maxVideos, document: documents ? Infinity : 0 }
      const problems = []
      const accepted = []

      picked.forEach((file) => {
        const kind = kindOf(file)
        if (!kind || caps[kind] === 0) {
          problems.push(`${file.name} is not a supported file type`)
        } else if (kind === 'video' && streamableOnly && !isBrowserPlayable(videoContentType(file))) {
          problems.push(`${file.name} can't play in the feed — use MP4, MOV or WebM`)
        } else if (counts[kind] >= caps[kind]) {
          problems.push(`${file.name} was not added — ${kind === 'video' ? 'video' : 'photo'} limit reached`)
        } else if (kind === 'image' && file.size > MAX_SOURCE_IMAGE_BYTES) {
          problems.push(`${file.name} is too large`)
        } else if (kind === 'document' && file.size > limit()) {
          problems.push(`${file.name} is over ${Math.round(limit() / 1048576)} MB`)
        } else {
          counts[kind] += 1
          const compressing =
            (kind === 'image' && isCompressibleImage(file.type)) ||
            (kind === 'video' && file.size > COMPRESS_ABOVE_BYTES)
          accepted.push({
            id: `e${(seq += 1)}`,
            kind,
            file,
            name: file.name,
            type: contentTypeOf(file),
            preview: null,
            status: compressing ? 'compressing' : 'uploading',
            progress: 0,
            url: null,
            meta: null,
            error: null,
          })
        }
      })

      setRejected(problems.join(' · '))
      if (!accepted.length) return
      itemsRef.current = [...itemsRef.current, ...accepted]
      setItems((prev) => [...prev, ...accepted])
      accepted.forEach(start)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxPhotos, maxVideos, documents, maxFileBytes, streamableOnly, start],
  )

  const remove = useCallback((target) => {
    const id = typeof target === 'string' ? target : target?.id
    const job = jobs.current.get(id)
    if (job) {
      job.canceled = true
      job.cancel()
      jobs.current.delete(id)
    }
    const gone = itemsRef.current.find((item) => item.id === id)
    dropPreview(gone?.preview)
    setRejected('')
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id)
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const retry = useCallback(
    (target) => {
      const id = typeof target === 'string' ? target : target?.id
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item?.file || item.status !== 'error') return
      dropPreview(item.preview)
      const compressing =
        (item.kind === 'image' && isCompressibleImage(item.file.type)) ||
        (item.kind === 'video' && item.file.size > COMPRESS_ABOVE_BYTES)
      const next = { ...item, status: compressing ? 'compressing' : 'uploading', progress: 0, error: null, preview: null }
      itemsRef.current = itemsRef.current.map((entry) => (entry.id === id ? next : entry))
      setItems((prev) => prev.map((entry) => (entry.id === id ? next : entry)))
      start(next)
    },
    [start],
  )

  const cancelAll = () => {
    jobs.current.forEach((job) => {
      job.canceled = true
      job.cancel()
    })
    jobs.current.clear()
    previews.current.forEach((url) => URL.revokeObjectURL(url))
    previews.current.clear()
  }

  const reset = useCallback(() => {
    cancelAll()
    itemsRef.current = []
    setItems([])
    setRejected('')
  }, [])

  // Unmount only: revoking on every change would kill previews still on screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => cancelAll, [])

  return useMemo(() => {
    const landed = items.filter((item) => item.status === 'done' && item.url)
    const buckets = { photoUrls: [], videoUrls: [], attachmentUrls: [], videoMeta: [] }
    landed.forEach((item) => {
      buckets[bucketFor(item.kind === 'image' ? 'image/' : item.type)].push(item.url)
      if (item.meta) buckets.videoMeta.push(item.meta)
    })
    const capacity = maxPhotos + maxVideos + (documents ? Infinity : 0)
    return {
      items,
      rejected,
      add,
      remove,
      retry,
      reset,
      busy: items.some((item) => item.status === 'compressing' || item.status === 'uploading'),
      failed: items.some((item) => item.status === 'error'),
      ...buckets,
      capacity: Number.isFinite(capacity) ? capacity : undefined,
      accept: documents
        ? ACCEPT_ATTRIBUTE
        : maxVideos
          ? streamableOnly
            ? STREAMABLE_MEDIA_ACCEPT_ATTRIBUTE
            : MEDIA_ACCEPT_ATTRIBUTE
          : IMAGE_ACCEPT_ATTRIBUTE,
    }
  }, [items, rejected, add, remove, retry, reset, maxPhotos, maxVideos, documents, streamableOnly])
}
