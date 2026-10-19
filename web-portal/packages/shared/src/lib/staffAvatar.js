import { useEffect, useState } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { updateProfile } from 'firebase/auth'
import { auth, db, storage } from '@shared/lib/firebase'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'

/** Largest photo accepted, before it is sent. storage.rules allows 10 MB. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

/**
 * A staff member's profile photo (2026-10-19).
 *
 * Stored where the resident app keeps its avatars — `profile_photos/<uid>.<ext>`
 * in Storage, which storage.rules already lets the signed-in owner write
 * (images only, under 10 MB) — and its URL on `users/{uid}.photoUrl`, the field
 * the mobile app's UserProfileService uses, which firestore.rules lets only the
 * owner write. The Auth profile's photoURL is set too, for anything reading the
 * account directly.
 *
 * Returns a message for a file that cannot be used, or null.
 */
export function avatarProblem(file) {
  if (!file) return 'Choose an image.'
  if (!EXTENSIONS[file.type]) return 'Use a JPG, PNG, WebP or GIF image.'
  if (file.size > AVATAR_MAX_BYTES) return 'That image is over 5 MB. Choose a smaller one.'
  return null
}

/** Uploads the photo and points the account at it. Resolves the new URL. */
export async function uploadAvatar(uid, file) {
  const problem = avatarProblem(file)
  if (problem) throw new Error(problem)
  const path = `profile_photos/${uid}.${EXTENSIONS[file.type]}`
  const stored = await uploadBytes(ref(storage, path), file, { contentType: file.type })
  // A cache-buster, so every console swaps to the new photo at once rather
  // than showing a cached copy of the old one at the same address.
  const url = `${await getDownloadURL(stored.ref)}&v=${Date.now()}`
  await setDoc(doc(db, 'users', uid), { photoUrl: url, photoUpdatedAt: serverTimestamp() }, { merge: true })
  if (auth.currentUser?.uid === uid) {
    await updateProfile(auth.currentUser, { photoURL: url }).catch(() => {})
  }
  return url
}

/** The account's photo URL, live from `users/{uid}`, so every console updates together. */
export function useStaffAvatar(uid) {
  const [url, setUrl] = useState(() => (auth.currentUser?.uid === uid ? auth.currentUser?.photoURL ?? null : null))
  useEffect(() => {
    if (!uid) return undefined
    return subscribeWithRetry(
      doc(db, 'users', uid),
      (snap) => setUrl(snap.data()?.photoUrl ?? null),
      (err) => console.warn('[avatar] profile photo unavailable', err?.code ?? err),
    )
  }, [uid])
  return url
}
