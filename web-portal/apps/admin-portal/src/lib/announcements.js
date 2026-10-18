// Data layer for the HOA broadcast module, mirroring the split already used by
// shared/lib/incidents.js: the component renders, this file owns the Firestore
// wire shape and every write.
//
// WIRE-SHAPE CONTRACT — the mobile app reads these documents directly (see
// Announcement.fromFirestore in lib/features/incidents/models/incident.dart),
// so the following fields may not be renamed or dropped:
//
//   title, body, publishedAt, authorName, isPinned, type, isArchived, imageUrl
//
// `state`, `priority`, `scheduledFor`, `updatedAt` and `viewCount` are
// web-portal additions. Flutter ignores unknown fields, so adding them is safe
// in both directions.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { auth, db, storage } from '@shared/lib/firebase'

const COLLECTION = 'announcements'

/**
 * Category tags. The VALUES here are written to `type` — the field the mobile
 * app reads — and they may not change.
 *
 * ── WHY THE PLAIN-ENGLISH RENAME IS A LABEL MAP, NOT NEW VALUES ─────────────
 * `announcementCategoryKey` in
 * lib/features/announcements/widgets/announcement_detail_sheet.dart switches on
 * these exact strings, lowercased, to pick a resident's colour and glyph:
 * 'security' → red shield, 'maintenance' → amber wrench, 'event' → green, and
 * ANYTHING ELSE falls through to a blue "General" megaphone.
 *
 * So storing 'Alert' instead of 'Security' would not rename a category — it
 * would silently demote every security notice to a blue General on every
 * resident's phone, and 'Notice', 'Update' and 'Alert' would all collapse into
 * the same identity. The phone would still render; it would just be wrong, and
 * nothing would report it.
 *
 * The friendly words are therefore a DISPLAY layer over unchanged values.
 * Admins see Notice / Alert / Update / Event; Firestore and the resident app
 * keep General / Security / Maintenance / Event, with their colours intact.
 * Changing the stored vocabulary is a Flutter change plus a backfill of every
 * existing document, and it buys nothing an operator can see.
 */
export const ANNOUNCEMENT_CATEGORIES = ['General', 'Security', 'Maintenance', 'Event']

/**
 * Stored value → the word staff actually read.
 *
 * Chosen so the existing tone stays semantically right rather than merely
 * unchanged: Alert keeps Security's danger red, Update keeps Maintenance's
 * amber, Notice keeps General's blue. A rename that left "Alert" rendering in
 * routine blue would be a worse label than the one it replaced.
 */
export const CATEGORY_LABELS = {
  General: 'Notice',
  Security: 'Alert',
  Maintenance: 'Update',
  Event: 'Event',
}

/** Friendly label for a stored category value. */
export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category ?? CATEGORY_LABELS.General
}

/** `{ value, label }` pairs for the shared Select, which accepts either form. */
export const CATEGORY_OPTIONS = ANNOUNCEMENT_CATEGORIES.map((value) => ({
  value,
  label: categoryLabel(value),
}))

/**
 * Priority is a separate DATA axis from category — "Security / Emergency" and
 * "Maintenance / Emergency" are both meaningful — even though the two are now
 * presented as one taxonomy badge. See taxonomyLabel below for why the merge
 * is presentational and the storage is not.
 *
 * The VALUES are unchanged and must stay that way: they are written to
 * Firestore and read by the mobile app. Only the display labels moved, so a
 * merged pill reads "Maintenance • Normal" rather than the redundant
 * "General • General" the old labels produced.
 *
 * Tone keys map straight onto shared/components/StatusBadge.jsx's vocabulary.
 */
export const ANNOUNCEMENT_PRIORITIES = [
  { value: 'general', label: 'Normal', tone: 'info', hint: 'Routine notice' },
  { value: 'urgent', label: 'High priority', tone: 'warning', hint: 'Needs attention today' },
  { value: 'emergency', label: 'Emergency', tone: 'danger', hint: 'Immediate, safety-critical' },
]

export const CATEGORY_TONES = {
  General: 'info',
  Security: 'danger',
  Maintenance: 'warning',
  Event: 'brand',
}

export const STATE_META = {
  published: { label: 'Published', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export function priorityMeta(priority) {
  return ANNOUNCEMENT_PRIORITIES.find((p) => p.value === priority) ?? ANNOUNCEMENT_PRIORITIES[0]
}

/**
 * THE UNIFIED TAXONOMY BADGE.
 *
 * One pill carrying both axes — "Security • High Priority", "Maintenance •
 * Normal" — replacing the two or three separate pills a card used to stack.
 *
 * ── WHY THE MERGE IS PRESENTATIONAL ONLY ─────────────────────────────────
 * Category and priority remain two fields in Firestore, and they have to:
 * `type` is what the mobile app reads to group a resident's feed, and it does
 * not know about priority at all. Collapsing them into one stored value would
 * have meant either inventing twelve new `type` strings the phone cannot
 * interpret, or dropping an axis outright. So the merge happens at the badge,
 * which is where the duplication actually was.
 *
 * ── WHY THE TONE FOLLOWS PRIORITY, NOT CATEGORY ──────────────────────────
 * A pill carries one colour and the two axes disagree about which. Priority
 * wins because it is the axis that changes what a reader must DO: an
 * emergency has to read as an emergency whether it is filed under Security or
 * Maintenance, and a routine notice must not borrow Security's red merely for
 * being about security. The category stays legible as the first half of the
 * label, which is the half a colour could never have carried anyway.
 */
// The baseline priority is OMITTED, not rendered.
//
// The composer no longer offers a priority control at all, so every notice
// written from now on carries 'general'. Appending '• Normal' to all of them
// would be a word that never varies — noise on every card in the feed.
//
// Legacy documents DO vary: announcements written while the picker existed
// still hold 'urgent' or 'emergency', and those keep their second half. So the
// badge says something precisely when there is something to say, and the feed
// cleans itself up as the old notices age out.
export function taxonomyLabel(category, priority) {
  const base = categoryLabel(category)
  return priority && priority !== 'general' ? base + ' • ' + priorityMeta(priority).label : base
}

export function taxonomyTone(priority) {
  return priorityMeta(priority).tone
}

// ── State ───────────────────────────────────────────────────────────────────
//
// The mobile listener is `where('isArchived', '==', false)` with NO
// publishedAt <= now filter (see LocalDataStore._announcementsSub). A future
// `publishedAt` alone would therefore surface a scheduled post on residents'
// phones immediately, pinned to the top of the feed by the sort.
//
// So `isArchived: true` is the only lever that actually hides a document from
// residents, and a scheduled announcement carries it. `state` is what the
// portal reads, and it disambiguates the two reasons a document can be
// hidden — scheduled vs. archived — which `isArchived` alone cannot.
export function announcementState(a) {
  if (a?.state === 'scheduled' || a?.state === 'archived' || a?.state === 'published') return a.state
  // Documents written before `state` existed.
  return a?.isArchived ? 'archived' : 'published'
}

export function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The moment this announcement is/was visible to residents. */
export function goLiveDate(a) {
  return toDate(a?.scheduledFor) ?? toDate(a?.publishedAt)
}

/**
 * Engagement, or `null` when the field has never been written.
 *
 * Nothing increments this yet — the mobile app has no read-receipt path — so
 * returning null (rather than 0) lets the feed render an honest "—" instead of
 * claiming every broadcast was seen by nobody.
 */
export function announcementViews(a) {
  const value = a?.viewCount ?? a?.readCount
  return typeof value === 'number' ? value : null
}

// ── Writes ──────────────────────────────────────────────────────────────────

function actor() {
  return {
    authorName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
    authorUid: auth.currentUser?.uid ?? '',
  }
}

/**
 * ── THE DUAL-WRITE, AND WHY IT IS NOT REDUNDANCY ────────────────────────────
 *
 * Every write below sets BOTH `imageUrls` (the array) and `imageUrl` (the
 * first element).
 *
 * `imageUrl` is a hard contract: `Announcement.fromFirestore` in
 * lib/features/incidents/models/incident.dart declares `final String? imageUrl`
 * and knows nothing about arrays. A resident on a phone that has not been
 * updated — which is every phone, the day this ships — reads that field and
 * only that field. Writing only `imageUrls` would silently blank the picture on
 * every notice in the mobile feed, and nothing would error.
 *
 * So the array is additive: Flutter ignores unknown fields (the same property
 * that let `state`, `priority` and `scheduledFor` be added), the phone keeps
 * rendering the lead image, and the portals render the full set. When the
 * mobile app learns to read `imageUrls`, `imageUrl` becomes dead weight and can
 * be dropped from the write — but not before, and not by accident.
 */
export async function createAnnouncement({
  title,
  body,
  category,
  priority = 'general',
  isPinned = false,
  imageUrls = [],
  scheduledFor = null,
}) {
  const scheduled = scheduledFor instanceof Date && scheduledFor.getTime() > Date.now()
  const goLive = scheduled ? Timestamp.fromDate(scheduledFor) : serverTimestamp()
  const images = imageUrls.filter(Boolean)

  await addDoc(collection(db, COLLECTION), {
    ...actor(),
    title: title.trim(),
    body: body.trim(),
    type: category,
    priority,
    isPinned,
    imageUrls: images,
    // The lead image, for the mobile reader. See the note above.
    imageUrl: images[0] ?? '',
    publishedAt: goLive,
    scheduledFor: scheduled ? Timestamp.fromDate(scheduledFor) : null,
    state: scheduled ? 'scheduled' : 'published',
    // Hidden from the resident feed until release — see announcementState.
    isArchived: scheduled,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Content edit. Never touches state/publishedAt — those have their own paths. */
export async function updateAnnouncement(id, { title, body, category, priority, imageUrls = [] }) {
  const images = imageUrls.filter(Boolean)
  await updateDoc(doc(db, COLLECTION, id), {
    title: title.trim(),
    body: body.trim(),
    type: category,
    priority,
    imageUrls: images,
    imageUrl: images[0] ?? '',
    editedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
    updatedAt: serverTimestamp(),
  })
}

export function setPinned(id, isPinned) {
  return updateDoc(doc(db, COLLECTION, id), { isPinned, updatedAt: serverTimestamp() })
}

/** Archiving is a flag, never a delete — a broadcast is a record of what residents were told. */
export function setArchived(id, isArchived) {
  return updateDoc(doc(db, COLLECTION, id), {
    isArchived,
    state: isArchived ? 'archived' : 'published',
    updatedAt: serverTimestamp(),
  })
}

/** Releases a scheduled announcement early, or the moment it falls due. */
export function publishNow(id) {
  return updateDoc(doc(db, COLLECTION, id), {
    state: 'published',
    isArchived: false,
    scheduledFor: null,
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Hard delete — the document is gone.
 *
 * Deliberately the only destructive operation here, and the feed puts it
 * behind a ConfirmDialog. Archive is the reversible default for anything that
 * was actually broadcast; delete exists for drafts published in error, where
 * keeping the record would be misleading rather than useful.
 */
export function deleteAnnouncement(id) {
  return deleteDoc(doc(db, COLLECTION, id))
}

/**
 * Flips scheduled announcements whose time has come.
 *
 * NOTE: this runs in the admin's browser, so release happens whenever an admin
 * has the Announcements page open (and immediately, via "Publish now", from
 * the scheduled card). A Cloud Scheduler job calling the same `publishNow`
 * server-side is the production-grade release mechanism; until one exists, a
 * scheduled post will not go live on an unattended portal. See the module
 * comment in functions/index.js for where that would go.
 */
export async function releaseDueAnnouncements(announcements) {
  const now = Date.now()
  const due = announcements.filter((a) => {
    if (announcementState(a) !== 'scheduled') return false
    const at = toDate(a.scheduledFor)
    return at != null && at.getTime() <= now
  })
  await Promise.all(due.map((a) => publishNow(a.id)))
  return due.length
}

// ── Media ───────────────────────────────────────────────────────────────────

/**
 * Hard ceiling on what may be UPLOADED, matching the 5 MB bound in
 * storage.rules. Enforced against the COMPRESSED payload, not the file the
 * admin picked: everything is downscaled to ~1.5 MB by
 * shared/lib/imageCompression.js before it gets here, so this is now a
 * backstop against a pathological image rather than the gate an operator meets.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * How many images one announcement may carry.
 *
 * Six is a grid of two rows of three in the composer and a readable gallery on
 * a phone. The cap is a product decision rather than a technical one — the
 * array field itself is unbounded — and it exists so a notice stays a notice
 * rather than becoming an album nobody scrolls to the end of.
 */
export const MAX_ANNOUNCEMENT_IMAGES = 6

/**
 * Uploads one image, reporting progress.
 *
 * Returns the resumable task alongside the promise so a caller can CANCEL an
 * in-flight upload. That matters now that the composer takes several images at
 * once: removing a tile mid-upload has to stop the transfer, not merely hide
 * the thumbnail, or the bytes keep flowing and the file lands in Storage
 * orphaned — paid for, and referenced by no announcement. This mirrors
 * uploadIncidentAttachment in shared/lib/attachments.js, which solved the same
 * problem first.
 *
 * Requires the `announcements/{uid}/{file}` rule in storage.rules; without it
 * this rejects with storage/unauthorized.
 */
export function uploadAnnouncementImage(file, onProgress) {
  const uid = auth.currentUser?.uid ?? 'unknown'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  // Random suffix, not just the timestamp: several images from one picker land
  // in the same millisecond, and two files of the same name would then collide
  // on one path — the second silently overwriting the first.
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const path = `announcements/${uid}/${unique}-${safeName}`
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

/**
 * The image URLs on an announcement, oldest field shape included.
 *
 * Documents written before multi-image support have only `imageUrl`; ones
 * written since have `imageUrls` AND `imageUrl`. Reading through this helper
 * means the feed, the composer and the edit loader all see one shape and no
 * caller has to remember the migration.
 */
export function announcementImages(a) {
  if (Array.isArray(a?.imageUrls) && a.imageUrls.length > 0) return a.imageUrls.filter(Boolean)
  return a?.imageUrl ? [a.imageUrl] : []
}

// ── Formatting ──────────────────────────────────────────────────────────────

const TIME = { hour: 'numeric', minute: '2-digit' }

/**
 * "Today, 3:24 PM" / "Yesterday, 3:24 PM" / "12 Jul, 3:24 PM" / with the year
 * once it is no longer the current one. Operators scan this column; an
 * unqualified "7/12/2025, 3:24:07 PM" makes them do the date arithmetic.
 */
export function formatTimestamp(value) {
  const date = toDate(value)
  if (!date) return '—'

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayDelta = Math.round((startOfToday - new Date(date).setHours(0, 0, 0, 0)) / 86400000)

  const time = date.toLocaleTimeString('en-US', TIME)
  if (dayDelta === 0) return `Today, ${time}`
  if (dayDelta === 1) return `Yesterday, ${time}`
  if (dayDelta === -1) return `Tomorrow, ${time}`

  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `${day}, ${time}`
}

/** Countdown copy for a scheduled card: "in 2h 15m". */
export function timeUntil(value) {
  const date = toDate(value)
  if (!date) return null
  const minutes = Math.round((date.getTime() - Date.now()) / 60000)
  if (minutes <= 0) return 'due now'
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}

/** Local `datetime-local` value for a Date — the input rejects an ISO string. */
export function toDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
