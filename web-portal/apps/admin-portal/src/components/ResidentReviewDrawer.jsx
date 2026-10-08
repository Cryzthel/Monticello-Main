import { useEffect, useState } from 'react'
import {
  X,
  User,
  Phone,
  Mail,
  Clock,
  BadgeCheck,
  CheckCircle2,
  ShieldX,
  Info,
  Hash,
} from '@shared/icons'
import Lightbox from '@shared/components/Lightbox'
import ResidentAvatar from '@/components/ResidentAvatar'
import StatusBadge from '@shared/components/StatusBadge'
import { useResidentProfile } from '@/hooks/useResidentProfile'
import {
  RESIDENT_STATUS,
  RESIDENT_STATUS_LABELS,
  residentTypeLabel,
  approveResident,
  rejectResident,
} from '@shared/lib/residents'
import { residentStatusIcon } from '@shared/theme/categoryIcons'

// Review state -> StatusBadge tone. Keys are the stored values; the badge owns
// the fill/ring/text treatment, same as every other pill in the portal.
const STATUS_TONE = {
  pending: 'warning',
  verified: 'success',
  rejected: 'danger',
}

function Section({ title, children }) {
  return (
    <div>
      <p className="mb-2 text-2xs font-semibold text-text-muted">{title}</p>
      {children}
    </div>
  )
}

function Field({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-hairline bg-base-800 p-3">
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-text-secondary">
        <Icon size="sm" />
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-text-primary">{value || '—'}</p>
    </div>
  )
}

/// Explicit, honest empty state for a section the mobile app has no input
/// for — better than rendering a blank panel that reads like a data bug.
function NotCaptured({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-200 p-3">
      <Info size="sm" className="mt-0.5 shrink-0 text-text-muted" />
      <p className="text-xs text-text-secondary">{children}</p>
    </div>
  )
}

export default function ResidentReviewDrawer({ resident, onClose }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const { profile, property, loading } = useResidentProfile(resident?.uid)

  useEffect(() => {
    setRejecting(false)
    setReason('')
    setError('')
    setLightboxIndex(null)
  }, [resident?.id])

  if (!resident) return null

  const docs = (resident.documentUrls ?? []).map((url) => ({ url, type: 'image' }))

  // Prefer whichever collection actually has the value — the residents record
  // and the users/properties profile are written by different mobile flows.
  const name = profile?.fullName || profile?.name || resident.name
  const email = resident.email || profile?.email || ''
  const phone = resident.phone || profile?.phone || ''
  const photoUrl = resident.photoUrl || profile?.photoUrl || ''
  const phase = resident.phase || property?.phase || ''
  const block = resident.block || property?.block || ''
  const lot = resident.lot || property?.lot || ''

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      onClose?.()
    } catch (err) {
      setError(err.message ?? 'Could not update this application.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-scrim fixed inset-0 z-50 flex justify-end bg-scrim" onClick={onClose}>
      <div
        className="card flex h-full w-full max-w-lg animate-[drawerInRight_260ms_var(--ease-out-strong)] flex-col overflow-hidden rounded-none border-y-0 border-r-0 bg-base-900 shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline p-5">
          <div className="flex min-w-0 items-center gap-3">
            <ResidentAvatar name={name} photoUrl={photoUrl} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-text-primary">{name}</h2>
              <p className="mt-0.5 truncate text-xs text-text-secondary">{email || 'No email on file'}</p>
              {/* The one shared pill, not a fourth local copy of it. */}
              <StatusBadge
                size="sm"
                tone={STATUS_TONE[resident.status] ?? STATUS_TONE.pending}
                icon={residentStatusIcon(resident.status)}
                className="mt-1.5"
              >
                {RESIDENT_STATUS_LABELS[resident.status] ?? resident.status}
              </StatusBadge>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn icon-btn-sm shrink-0">
            <X size="sm" />
          </button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {loading ? <p className="text-xs text-text-secondary">Loading full profile…</p> : null}

          <Section title="Personal details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field icon={User} label="Full name" value={name} />
              <Field icon={Phone} label="Contact number" value={phone} />
              <Field icon={Mail} label="Email address" value={email} />
              <Field
                icon={BadgeCheck}
                label="Resident type"
                value={resident.residentType ? residentTypeLabel(resident.residentType) : ''}
              />
              <Field
                icon={Clock}
                label="Registered"
                value={resident.createdAt ? new Date(resident.createdAt).toLocaleString() : ''}
              />
            </div>
            {profile?.bio ? (
              <div className="mt-3 rounded-xl border border-hairline bg-base-800 p-3">
                <p className="text-2xs font-semibold text-text-secondary">Bio</p>
                <p className="mt-1 text-sm text-text-primary">{profile.bio}</p>
              </div>
            ) : null}
          </Section>

          <Section title="Property & location">
            <div className="grid grid-cols-3 gap-3">
              <Field icon={Hash} label="Phase" value={phase} />
              <Field icon={Hash} label="Block" value={block} />
              <Field icon={Hash} label="Lot" value={lot} />
            </div>
            {/* STREET ADDRESS AND UNIT WERE HERE, AND THEY WERE NOISE.
                Phase / Block / Lot is the address in this subdivision — it is
                what the boundary GeoJSON, the dispatch map and the resident's
                own property verification all key on. `street` and `unit` were
                free text the mobile form happened to collect: usually blank,
                and when filled, a restatement of the three numbers above in
                prose. Two empty rows under a populated grid read as missing
                data rather than as absent fields, which is worse than not
                asking. The values are still on the document if they are ever
                wanted — nothing was deleted from Firestore. */}
            {!phase && !block && !lot ? (
              <div className="mt-3">
                <NotCaptured>
                  This applicant has no property on file yet — they may not have completed property
                  verification in the mobile app.
                </NotCaptured>
              </div>
            ) : null}
          </Section>

          <Section title="Verification documents">
            {docs.length === 0 ? (
              <NotCaptured>
                No ID uploaded. The upload is optional at registration, so verify this application
                against the claimed property details above, or reject asking for a valid ID.
              </NotCaptured>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {docs.map((docItem, index) => (
                  <button
                    key={docItem.url}
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    className="aspect-[4/3] overflow-hidden rounded-lg border border-hairline"
                  >
                    <img src={docItem.url} alt="Submitted ID" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {resident.status === RESIDENT_STATUS.rejected && resident.rejectionReason ? (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-3">
              <p className="text-2xs font-semibold text-danger">Rejection reason</p>
              <p className="mt-1 text-sm text-text-primary">{resident.rejectionReason}</p>
            </div>
          ) : null}

          {resident.reviewedByName ? (
            <p className="text-xs text-text-secondary">
              Reviewed by {resident.reviewedByName}
              {resident.reviewedAt ? ` • ${new Date(resident.reviewedAt).toLocaleString()}` : ''}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-hairline p-5">
          {/* Same banner treatment as the audit table and the composer, rather
              than bare red text floating above the buttons. */}
          {error ? (
            <p className="mb-3 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
              <ShieldX size="sm" className="mt-px shrink-0" />
              {error}
            </p>
          ) : null}

          {/* Both decision buttons are the shared .btn scale — one shape class,
              one size class, one colour variant — so "Reject" here is the same
              object as "Delete" on the tickets queue and "Restore" in the
              recycle bin. They were hand-built before: a hardcoded #7F1D1D
              oxblood with its own rgba glow, and a solid `bg-success` where
              every other success action in the app is a tint. Neither could
              follow the theme, and neither matched anything beside it. */}
          {rejecting ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="reject-reason" className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Rejection reason (optional — shown to the resident)
                </label>
                <textarea
                  id="reject-reason"
                  rows={3}
                  className="field-textarea resize-none"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Block/Lot does not match HOA records, or ID photo unclear"
                />
              </div>
              {/* Cancel first, destructive second — the same ordering (and the
                  same reasoning) as ConfirmDialog: the safe option is the one
                  a stray Enter or a mis-aimed click lands on. */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                  className="btn btn-md btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => rejectResident(resident, reason))}
                  className="btn btn-md btn-danger flex-1"
                >
                  <ShieldX size="sm" />
                  Confirm rejection
                </button>
              </div>
            </div>
          ) : (
            /* Equal weight is deliberate: this is a genuine binary review, and
               a filled primary beside a quiet secondary would be the interface
               nudging an approval. */
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || resident.status === RESIDENT_STATUS.verified}
                onClick={() => run(() => approveResident(resident))}
                className="btn btn-md btn-success flex-1"
              >
                <CheckCircle2 size="sm" />
                {resident.status === RESIDENT_STATUS.verified ? 'Already approved' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busy || resident.status === RESIDENT_STATUS.rejected}
                onClick={() => setRejecting(true)}
                className="btn btn-md btn-danger flex-1"
              >
                <ShieldX size="sm" />
                Reject
              </button>
            </div>
          )}
        </div>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={docs} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>
  )
}
