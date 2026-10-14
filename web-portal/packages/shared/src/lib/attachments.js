import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { auth, storage } from '@shared/lib/firebase'

/**
 * Attachment uploads for a guard-filed incident report.
 *
 * Storage path is `incidents/{uid}/…`, which is what storage.rules gates on:
 * an officer may write only into their own folder, and only the content types
 * on the allowlist there (images, video, PDF, plain text). Keep this list and
 * that rule in step — a type permitted here but not there fails at upload with
 * `storage/unauthorized`, which reads to the operator as a broken button.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * The cap actually applied to a file, which is the configured limit — never
 * above the hard ceiling above.
 *
 * The constant stays as the ceiling rather than becoming the setting: it is
 * what the upload path and the Storage bucket are sized for, and an
 * administrator should not be able to raise a client limit past what the
 * backend was built to accept. The setting can only ever tighten it.
 */
export function attachmentLimitBytes(settings) {
  const mb = Number(settings?.residentApp?.maxUploadMb)
  if (!Number.isFinite(mb) || mb <= 0) return MAX_ATTACHMENT_BYTES
  return Math.min(MAX_ATTACHMENT_BYTES, mb * 1024 * 1024)
}

export const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'text/plain',
]

/** For the file input's `accept`, which takes extensions and MIME types. */
export const ACCEPT_ATTRIBUTE = 'image/*,video/mp4,video/quicktime,application/pdf,.txt,text/plain'

/**
 * Which array on the incident document a file belongs in.
 *
 * `photoUrls` and `videoUrls` are read directly by the Flutter app (see
 * Incident.fromFirestore), so images and video MUST keep going there or the
 * resident-facing timeline loses them. Everything else goes to `attachmentUrls`,
 * a web-portal addition — Flutter ignores unknown fields, so adding it is safe
 * in both directions, and a PDF has nowhere sensible to render on mobile anyway.
 */
export function bucketFor(contentType = '') {
  if (contentType.startsWith('image/')) return 'photoUrls'
  if (contentType.startsWith('video/')) return 'videoUrls'
  return 'attachmentUrls'
}

export function isAcceptedType(contentType = '') {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType === 'application/pdf' ||
    contentType.startsWith('text/plain')
  )
}

/** Human file size for the preview chip. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Uploads one file, reporting progress, and resolves with its download URL.
 *
 * Returns the resumable task alongside the promise so a caller can cancel an
 * in-flight upload — a 20 MB body-cam still on a guardhouse connection is long
 * enough that "remove" has to actually stop it, not just hide the chip.
 */
export function uploadIncidentAttachment(file, onProgress) {
  const uid = auth.currentUser?.uid ?? 'unknown'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `incidents/${uid}/${Date.now()}-${safeName}`
  const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type })

  const done = new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject),
    )
  })

  return { task, done }
}

/** Turns a Storage error into something an operator can act on. */
export function describeUploadError(err) {
  if (err?.code === 'storage/unauthorized') {
    return 'Upload denied by Storage rules — run "firebase deploy --only storage".'
  }
  if (err?.code === 'storage/canceled') return 'Upload cancelled.'
  if (err?.code === 'storage/retry-limit-exceeded') {
    return 'Upload timed out. Check the connection and try again.'
  }
  /**
   * THE ONE ERROR HERE THAT TRYING AGAIN CANNOT FIX.
   *
   * Every other case above is a condition that may have passed by the next
   * attempt — a dropped connection, a rule not yet deployed. This one is the
   * project's Firebase plan being out of Storage, so the retry a guard
   * reasonably infers from "Upload failed. Please try again." will fail
   * identically, every time, for as long as the quota is exhausted.
   *
   * Firebase's own message is worse than unhelpful on a guardhouse console: it
   * names the bucket and links a pricing page, which reads to the officer at
   * the gate as something they have done wrong. Say who can actually clear it.
   */
  if (err?.code === 'storage/quota-exceeded') {
    return 'Storage is full on this project’s Firebase plan. Trying again will not help — an administrator has to free space or upgrade the plan before photos can be attached.'
  }
  return err?.message || 'Upload failed. Please try again.'
}
