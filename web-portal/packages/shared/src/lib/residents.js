// Resident account verification. Mirrors the mobile app's
// lib/features/settings/services/account_approval_service.dart — same
// `residents/{uid}` docs, same `verificationStatus` wire values — so an
// account created on mobile is the exact record staff act on here.
import { doc, runTransaction, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'

export const RESIDENT_STATUS = {
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
}

// Where a row in the Residents table came from. Visibility never depends on
// this — an account shows up the moment it registers either way — but staff
// need to be able to tell "registered, awaiting review" apart from "signed up
// but their verification write never landed", because only the latter is a
// symptom worth chasing.
export const RESIDENT_SOURCE = {
  verification: 'verification', // residents/{uid} exists
  profile: 'profile', // users/{uid} only — no verification record yet
}

export const RESIDENT_STATUS_LABELS = {
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
}

// Tolerant status parsing. A doc is only useful to staff if it lands in one
// of the three tabs, so anything unrecognised falls back to `pending` rather
// than vanishing from every filter. Accepts both the canonical
// `verificationStatus` the mobile app writes and a plain `status` key, and
// normalizes label-style values ("Pending Verification", "Approved").
export function normalizeResidentStatus(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase()
  if (!value) return RESIDENT_STATUS.pending

  // ── DECIDED STATES ARE TESTED FIRST ─────────────────────────────────────
  //
  // `pending` used to be checked before the other two, so any value that
  // merely STARTS with it — "pending rejection", "pending re-review" — landed
  // in Pending, and the account never reached the tab matching its actual
  // outcome. A decided state is the more specific claim, so it wins.
  //
  // The extra spellings are the other half of the same problem. This parser
  // exists to be tolerant of what the collection actually HOLDS rather than
  // what today's write path produces: an unrecognised value does not error, it
  // falls silently through to Pending — and a rejected account then simply
  // never appears under Rejected.
  if (/(reject|declin|denie|deny|refus|flag)/.test(value)) {
    return RESIDENT_STATUS.rejected
  }
  // Between the two on purpose. 'Pending Verification' contains the verify
  // stem and means the opposite, so the pending test has to run before that
  // branch — and after the reject one, so 'pending rejection' still resolves
  // to the decision rather than to the queue it was in.
  if (value.startsWith('pending')) return RESIDENT_STATUS.pending

  if (/(verif|approv|accept)/.test(value)) {
    // "unverified" / "not approved" contain the same stems and mean the
    // opposite, so they fall back rather than reading as a pass.
    if (/(^|[^a-z])(un|not|non|never)\s*-?\s*(verif|approv)/.test(value)) {
      return RESIDENT_STATUS.pending
    }
    return RESIDENT_STATUS.verified
  }
  return RESIDENT_STATUS.pending
}

export function mapResidentDoc(d) {
  const createdAt = d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt
  const reviewedAt = d.reviewedAt?.toDate ? d.reviewedAt.toDate() : d.reviewedAt

  return {
    id: d.id,
    uid: d.uid ?? d.id,
    name: d.name || d.fullName || 'Unnamed resident',
    email: d.email ?? '',
    phone: d.phone ?? '',
    // Two mobile paths write property details onto this doc under DIFFERENT
    // key names: AccountApprovalService.markPending writes phase/block/lot,
    // while PropertyStorage.saveVerifiedProperty writes propertyPhase/
    // propertyBlock/propertyLot. Reading only one set silently blanked the
    // address for residents whose signup-time write failed but who later
    // completed property verification.
    phase: d.phase || d.propertyPhase || '',
    block: d.block || d.propertyBlock || '',
    lot: d.lot || d.propertyLot || '',
    // Normalized so an unset/legacy doc still lands in the Pending bucket
    // rather than silently disappearing from every tab.
    status: normalizeResidentStatus(d.verificationStatus ?? d.status),
    // Captured at registration by the mobile signup form's verification step.
    residentType: (d.residentType ?? '').toString().toLowerCase(),
    rejectionReason: d.rejectionReason ?? '',
    reviewedByName: d.reviewedByName ?? '',
    // Verification documents/IDs, if the signup flow captured any. The
    // mobile registration form does not upload these yet (see the note in
    // ResidentDetailsDrawer) — this reads whichever field a future uploader
    // writes without needing a schema change here.
    documentUrls: d.documentUrls ?? d.idPhotoUrls ?? [],
    createdAt,
    reviewedAt,
    source: RESIDENT_SOURCE.verification,
  }
}

// Projects a `users/{uid}` profile into the exact same shape mapResidentDoc
// returns, so the table can render both without branching per row.
//
// This is what removes the acceptance gate: an account used to be invisible
// until someone clicked "Import to queue", which meant a resident could
// register on mobile and simply not exist to the admin until a human noticed.
// Now the profile itself is enough to appear; the verification record is
// created lazily, on the first approve/reject (see writeReview).
//
// Status is `pending` rather than a fourth value because that IS this
// account's verification state — nothing has reviewed it yet. `source` is
// what tells the two apart.
export function mapProfileDoc(u) {
  const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : u.createdAt

  return {
    id: u.id,
    uid: u.id,
    name: u.fullName || u.name || 'Unnamed resident',
    email: u.email ?? '',
    phone: u.phone ?? '',
    // PropertyStorage.saveVerifiedProperty mirrors phase/block/lot onto the
    // users doc, so a profile-only row still shows a real address.
    phase: u.phase ?? '',
    block: u.block ?? '',
    lot: u.lot ?? '',
    status: RESIDENT_STATUS.pending,
    residentType: (u.residentType ?? '').toString().toLowerCase(),
    rejectionReason: '',
    reviewedByName: '',
    documentUrls: [],
    createdAt,
    reviewedAt: null,
    source: RESIDENT_SOURCE.profile,
  }
}

/**
 * "Phase 1, Block 4, Lot 12" — or as much of it as the record actually has.
 *
 * Parts are omitted rather than rendered as placeholders: an address reading
 * "Phase 1, Block —, Lot —" claims three fields and delivers one.
 */
export function residentAddress(resident) {
  const parts = [
    resident?.phase ? `Phase ${resident.phase}` : null,
    resident?.block ? `Block ${resident.block}` : null,
    resident?.lot ? `Lot ${resident.lot}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : '—'
}

/**
 * The wire value the mobile signup writes, as a label.
 *
 * `homeowner` / `tenant` are the two ResidentType constants the Flutter app
 * defines; anything else is shown capitalised rather than dropped, so a value
 * added on the mobile side appears here before this table knows about it.
 */
export const RESIDENT_TYPE_LABELS = {
  homeowner: 'Homeowner',
  tenant: 'Tenant',
}

export function residentTypeLabel(value) {
  const key = (value ?? '').toString().trim().toLowerCase()
  if (!key) return ''
  return RESIDENT_TYPE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

// The identity fields a verification record needs when one is being created
// from a profile-only row, so the new doc is not an id with a status on it.
function identitySeed(resident) {
  return {
    uid: resident.uid ?? resident.id,
    name: resident.name ?? '',
    email: resident.email ?? '',
    phone: resident.phone ?? '',
    phase: resident.phase ?? '',
    block: resident.block ?? '',
    lot: resident.lot ?? '',
    source: 'admin_review_backfill',
    createdAt: serverTimestamp(),
  }
}

// ── REJECTED IS FINAL ──────────────────────────────────────────────────────
//
// A rejected application is locked for good (2026-10-19, by request): it can
// never be approved — by a stale row, a second tab, or a mis-click — and a
// later review needs a fresh registration. Enforced three times over:
//   • the UI never offers Approve on a rejected row (isReviewLocked);
//   • writeReview re-reads the document inside a transaction and refuses to
//     move a rejected record, so a row that went stale under another admin's
//     decision cannot overwrite it;
//   • firestore.rules refuses any write that takes a residents doc out of
//     `rejected`, whatever client sends it.
// Verified → Rejected stays allowed: revoking a verification is legitimate.

export const REVIEW_LOCKED_HINT =
  'Rejected applications are locked. The resident must register again to be reviewed.'

/** True once a resident row (or a raw status) can no longer be decided. */
export function isReviewLocked(residentOrStatus) {
  const status = typeof residentOrStatus === 'string' ? residentOrStatus : residentOrStatus?.status
  return normalizeResidentStatus(status) === RESIDENT_STATUS.rejected
}

/** Thrown when a decision would move a locked record; describeError prints its message. */
export class ReviewLockedError extends Error {
  constructor() {
    super('This application was rejected and is locked. The resident must register again.')
    this.name = 'ReviewLockedError'
    this.code = 'resident/review-locked'
  }
}

// Both review actions take the resident ROW, not just an id, so they can
// merge-create for an account that has no residents/{uid} doc yet. A merge
// write rather than an update is the whole point: an update rejects a missing
// document, which is what previously forced the separate "import to queue"
// step before anyone could be approved.
//
// It runs in a transaction so the lock is checked against the SERVER's copy:
// the row passed in may be a snapshot old enough to predate a rejection.
function writeReview(resident, fields) {
  const id = resident.id ?? resident.uid
  const ref = doc(db, 'residents', id)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const stored = snap.exists() ? snap.data() : null
    // Nothing moves a rejected record — not an approval, and not a second
    // rejection that would overwrite the first reviewer, time and reason.
    if (stored && isReviewLocked(stored.verificationStatus ?? stored.status)) {
      throw new ReviewLockedError()
    }
    const reviewer = {
      reviewedBy: auth.currentUser?.uid ?? '',
      reviewedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    // Seed identity only when the record does not exist yet.
    const seed = !stored ? identitySeed(resident) : {}
    tx.set(ref, { ...seed, ...fields, ...reviewer }, { merge: true })
  })
}

export async function approveResident(resident) {
  if (isReviewLocked(resident)) throw new ReviewLockedError()
  await writeReview(resident, {
    verificationStatus: RESIDENT_STATUS.verified,
    rejectionReason: '',
  })
}

export async function rejectResident(resident, reason) {
  if (isReviewLocked(resident)) throw new ReviewLockedError()
  await writeReview(resident, {
    verificationStatus: RESIDENT_STATUS.rejected,
    // Surfaced verbatim on the resident's locked screen, so a blank reason
    // is better than a fabricated one.
    rejectionReason: (reason ?? '').trim(),
  })
}

/**
 * Creates the verification record for a profile-only account, without deciding
 * it.
 *
 * The row is already visible either way — this only writes the `residents/{uid}`
 * document so the account has one, leaving it Pending for a human to review.
 */
export async function importResidentFromUser(resident) {
  const id = resident.id ?? resident.uid
  return setDoc(
    doc(db, 'residents', id),
    {
      ...identitySeed(resident),
      verificationStatus: RESIDENT_STATUS.pending,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
