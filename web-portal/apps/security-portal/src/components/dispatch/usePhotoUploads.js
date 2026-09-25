import { useCallback, useEffect, useRef, useState } from 'react'
import { compressImage } from '@shared/lib/imageCompression'
import { describeUploadError, uploadIncidentAttachment } from '@shared/lib/attachments'

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
 */
export function usePhotoUploads({ max }) {
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
      const files = [...(fileList ?? [])].filter((file) => file.type.startsWith('image/'))
      const room = Math.max(0, max - itemsRef.current.length)
      const accepted = files.slice(0, room).map((file) => ({
        id: `photo-${++seq}`,
        name: file.name,
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        url: null,
        error: null,
      }))
      if (!accepted.length) return
      itemsRef.current = [...itemsRef.current, ...accepted]
      setItems((prev) => [...prev, ...accepted])

      accepted.forEach(async (item) => {
        try {
          const { file } = await compressImage(item.file)
          const { task, done } = uploadIncidentAttachment(file, (progress) => patch(item.id, { progress }))
          tasksRef.current.set(item.id, task)
          const url = await done
          patch(item.id, { url, progress: 100 })
        } catch (err) {
          if (err?.code === 'storage/canceled') return
          console.error('Scene photo upload failed', err)
          patch(item.id, { error: describeUploadError(err) })
        } finally {
          tasksRef.current.delete(item.id)
        }
      })
    },
    [max, patch],
  )

  const remove = useCallback((id) => {
    tasksRef.current.get(id)?.cancel()
    setItems((prev) => {
      const gone = prev.find((item) => item.id === id)
      if (gone) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const reset = useCallback(() => {
    tasksRef.current.forEach((task) => task.cancel())
    tasksRef.current.clear()
    setItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }, [])

  // Only on unmount. Revoking on every change would break previews still on screen.
  useEffect(
    () => () => {
      tasksRef.current.forEach((task) => task.cancel())
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
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
    urls: items.filter((item) => item.url).map((item) => item.url),
    full: items.length >= max,
  }
}
