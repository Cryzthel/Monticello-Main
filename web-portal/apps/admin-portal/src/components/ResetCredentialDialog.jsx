import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, RefreshCw, X } from '@shared/icons'
import CredentialHandoff from '@/components/CredentialHandoff'
import {
  describeCallableError,
  generateTempPassword,
  resetSecurityCredential,
} from '@/lib/securityAccounts'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * Issue a replacement password for an existing guardhouse account.
 *
 * ── WHY THIS IS NOT "SEND A RESET EMAIL" ────────────────────────────────────
 * The portal already has an emailed-link path — `sendPasswordOtp` for
 * residents, and `createStaffAccount`'s invite link — and it is the right
 * mechanism when the person owns the mailbox. A guardhouse account frequently
 * does not: the address on the roster is often a shared guardhouse mailbox, or
 * a personal one the officer cannot reach from the post, and the officer
 * standing in front of the admin needs to be on shift in the next five minutes.
 *
 * So this path issues the credential directly and hands it over in person,
 * which is what actually happens in a guardhouse. The safety property is not
 * "the admin never sees it" — it is that the password is single-use in
 * practice: `mustChangePassword` is set, the officer replaces it on first
 * sign-in, and the fact that a reset happened, who did it and when, is written
 * to `provisioning_logs` server-side, where neither party can edit it.
 *
 * The emailed path remains available and is not removed; it is simply not the
 * only one.
 */
export default function ResetCredentialDialog({ open, account, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState(null)

  const confirmRef = useRef(null)
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef, initialRef: confirmRef })

  useEffect(() => {
    if (!open) return
    setPassword(generateTempPassword())
    setRevealed(false)
    setError('')
    setIssued(null)
    confirmRef.current?.focus()
  }, [open, account])

  // Escape closes the confirm step, never the handoff — the password on that
  // screen is the only copy that exists. Same rule as ProvisionAccountModal.
  useEffect(() => {
    if (!open) return undefined
    function handleKeydown(event) {
      if (event.key === 'Escape' && !busy && !issued) onClose?.()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [open, busy, issued, onClose])

  if (!open || !account) return null

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await resetSecurityCredential({
        uid: account.uid,
        password,
        // Always, and no longer a switch. A replacement password the officer is
        // not required to change is a permanent credential that has been read
        // aloud at a handover — see the note in ProvisionAccountModal.
        forcePasswordReset: true,
      })
      setIssued({
        fullName: account.name || account.email,
        email: account.email,
        badgeNumber: account.badgeNumber,
        password,
        forcePasswordReset: true,
      })
      onDone?.({ name: account.name || account.email })
    } catch (err) {
      console.error('Credential reset failed', err)
      setError(describeCallableError(err, 'reset that password'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => !busy && !issued && onClose?.()}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Reset password for ${account.name || account.email}`}
        onClick={(event) => event.stopPropagation()}
        className="custom-scrollbar max-h-[80dvh] w-full max-w-lg dialog-panel overflow-y-auto rounded-xl rounded-b-none border border-hairline bg-base-850 shadow-modal sm:rounded-b-xl"
      >
        {issued ? (
          <CredentialHandoff mode="reset" credentials={issued} onDone={onClose} />
        ) : (
          <div className="p-6">
            <div className="flex items-start gap-4">
              <span className="icon-tile icon-tile-lg icon-tile-warning">
                <KeyRound size="lg" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-tight text-text-primary">
                  Reset password
                </h2>
                <p className="mt-1 text-sm leading-snug text-text-secondary">
                  A new password for{' '}
                  <strong className="font-semibold text-text-primary">
                    {account.name || account.email}
                  </strong>
                  . Their current one stops working immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                className="icon-btn icon-btn-sm -mr-1 shrink-0 text-text-secondary hover:text-text-primary"
              >
                <X size="sm" />
              </button>
            </div>

            <div className="mt-5">
              <label
                htmlFor="reset-password"
                className="mb-1.5 block text-xs font-semibold text-text-primary"
              >
                New temporary password
              </label>
              <div className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    id="reset-password"
                    type={revealed ? 'text' : 'password'}
                    value={password}
                    // Generated, never typed — the same rule as the
                    // provisioning form. Read-only rather than disabled so it
                    // stays in the tab order and stays readable to a screen
                    // reader, which matters for the one value on this dialog
                    // an admin has to read out loud.
                    readOnly
                    className="field cursor-default pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealed((v) => !v)}
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-text-primary"
                  >
                    {revealed ? <EyeOff size="sm" /> : <Eye size="sm" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPassword(generateTempPassword())}
                  className="btn btn-compact btn-outline shrink-0"
                >
                  <RefreshCw size="sm" />
                  New password
                </button>
              </div>
              <p className="mt-1 text-caption leading-tight text-text-muted">
                Made for you on this device. They will be asked to set their own the next time they
                sign in.
              </p>
            </div>

            {error ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle size="sm" className="mt-0.5 shrink-0" />
                <span className="min-w-0">{error}</span>
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="btn btn-sm btn-outline"
              >
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={submit}
                disabled={busy || password.length < 8}
                className="btn btn-sm btn-brand"
              >
                {busy ? <Loader2 size="sm" className="animate-spin" /> : null}
                Issue new password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
