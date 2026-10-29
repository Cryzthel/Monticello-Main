import { useCallback, useEffect, useRef, useState } from 'react'
import { compressImage } from '@shared/lib/imageCompression'
import { describeUploadError, uploadIncidentAttachment } from '@shared/lib/attachments'
import { COMPRESS_ABOVE_BYTES, isVideoFile } from '@shared/lib/videoCompression'
import { uploadVideoEvidence } from '@shared/lib/videoEvidence'

let seq = 0

/**
 * Scene photos taken by the officer: compressed on the device, then uploaded
 * to `incidents/{officerUid}/…` (the folder the Storage rules let an officer
 * write to). Each photo carries its own progress and error so one failure does
 * not cost the others.
 *
 * Storage has no offline queue, unlike Firestore. A photo picked with no
 * signal fails its upload and says so, and can be removed and retried. The
 * stage write that references it cannot be sent until it has a URL.
 *
 * VIDEO TOO (2026-10-29). A clip goes through the shared pipeline
 * (lib/videoEvidence.js — compressed over 25 MB, poster frame, chunked
 * upload) and is counted against `maxVideos`, separately from `max` photos:
 * the resolve rules require at least one PHOTO as proof, and a video does not
 * stand in for it. `urls` stays photos-only for that reason; videos come back
 * as `videoUrls` + `videoMeta`.
 */
export function usePhotoUploads({ max, maxVideos = 0 }) {
  const [items, setItems] = useState([])
  const tasksRef = useRef(new Map())

  const patch = useCallback((id, next) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }, [])

  // Uploads start OUTSIDE the state updater. React may run an updater twice
  // in development, and a side effect in one would upload every photo twice.
  const itemsRef = useRef([])
  itemsRef.current = items

  const add = useCallback(
    (fileList) => {
      const picked = [...(fileList ?? [])]
      const photos = picked.filter((file) => file.type.startsWith('image/'))
      const videos = maxVideos ? picked.filter((file) => !file.type.startsWith('image/') && isVideoFile(file)) : []
      const current = itemsRef.current
      const photoRoom = Math.max(0, max - current.filter((item) => item.kind === 'image').length)
      const videoRoom = Math.max(0, maxVideos - current.filter((item) => item.kind === 'video').length)
      const accepted = [
        ...photos.slice(0, photoRoom).map((file) => ({
          id: `photo-${++seq}`,
          kind: 'image',
          name: file.name,
          type: file.type,
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'uploading',
          progress: 0,
          url: null,
          error: null,
        })),
        ...videos.slice(0, videoRoom).map((file) => ({
          id: `video-${++seq}`,
          kind: 'video',
          name: file.name,
          type: file.type || 'video/mp4',
          file,
          previewUrl: null,
          status: file.size > COMPRESS_ABOVE_BYTES ? 'compressing' : 'uploading',
          progress: 0,
          url: null,
          meta: null,
          error: null,
        })),
      ]
      if (!accepted.length) return
      itemsRef.current = [...itemsRef.current, ...accepted]
      setItems((prev) => [...prev, ...accepted])

      accepted.forEach(async (item) => {
        if (item.kind === 'video') {
          const job = uploadVideoEvidence(item.file, {
            onUpdate: ({ preview, ...next }) => patch(item.id, preview ? { ...next, previewUrl: preview } : next),
          })
          tasksRef.current.set(item.id, { cancel: job.cancel })
          try {
            const { url, meta } = await job.done
            patch(item.id, { url, meta, type: meta.contentType, progress: 100, status: 'done' })
          } catch (err) {
            if (err?.code === 'storage/canceled' || err?.name === 'ConversionCanceledError') return
            console.error('Scene video upload failed', err)
            patch(item.id, { error: describeUploadError(err), status: 'error' })
          } finally {
            tasksRef.current.delete(item.id)
          }
          return
        }
        try {
          const { file } = await compressImage(item.file)
          const { task, done } = uploadIncidentAttachment(file, (progress) => patch(item.id, { progress }))
          tasksRef.current.set(item.id, task)
          const url = await done
          patch(item.id, { url, progress: 100, status: 'done' })
        } catch (err) {
          if (err?.code === 'storage/canceled') return
          console.error('Scene photo upload failed', err)
          patch(item.id, { error: describeUploadError(err), status: 'error' })
        } finally {
          tasksRef.current.delete(item.id)
        }
      })
    },
    [max, maxVideos, patch],
  )

  const remove = useCallback((id) => {
    tasksRef.current.get(id)?.cancel()
    setItems((prev) => {
      const gone = prev.find((item) => item.id === id)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const reset = useCallback(() => {
    tasksRef.current.forEach((task) => task.cancel())
    tasksRef.current.clear()
    setItems((prev) => {
      prev.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }, [])

  // Only on unmount. Revoking on every change would break previews still on screen.
  useEffect(
    () => () => {
      tasksRef.current.forEach((task) => task.cancel())
      itemsRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    },
    [],
  )

  return {
    items,
    add,
    remove,
    reset,
    uploading: items.some((item) => !item.url && !item.error),
    failed: items.some((item) => item.error),
    urls: items.filter((item) => item.kind === 'image' && item.url).map((item) => item.url),
    videoUrls: items.filter((item) => item.kind === 'video' && item.url).map((item) => item.url),
    videoMeta: items.filter((item) => item.kind === 'video' && item.meta).map((item) => item.meta),
    full:
      items.filter((item) => item.kind === 'image').length >= max &&
      items.filter((item) => item.kind === 'video').length >= maxVideos,
  }
}
