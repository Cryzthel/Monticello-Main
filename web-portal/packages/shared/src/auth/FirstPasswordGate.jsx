import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { Eye, EyeOff, Loader2 } from '@shared/icons'
import { auth, db } from '@shared/lib/firebase'
import { useAuth } from '@shared/auth/AuthContext'
import { STAFF_COLLECTION } from '@shared/auth/roles'
import LoginSplitLayout from '@shared/auth/LoginSplitLayout'
import FloatingField from '@shared/auth/FloatingField'
import NewPasswordFields from '@shared/auth/NewPasswordFields'
import { CTA, SECONDARY } from '@shared/auth/authStyles'
import { passwordReady } from '@shared/auth/passwordPolicy'
import { reconcilePasswordResetFlags } from '@shared/lib/passwordFlags'
import { toast } from '@shared/lib/toast'

/**
 * ── FIRST SIGN-IN: SET YOUR OWN PASSWORD ──────────────────────────────────
 * The standard onboarding for an account an administrator creates (or resets):
 * the admin issues a TEMPORARY password, and the officer must replace it the
 * first time they sign in, before the console opens. Until 2026-10-18 the
 * `mustChangePassword` flag was set but nothing enforced it, so a temporary
 * password read aloud at a handover stayed valid forever.
 *
 * Route-level, inside RequireAuth: it watches the officer's OWN staff record
 * live, and while the flag is set it renders this screen instead of the
 * console. The change is:
 *   1. re-authenticate with the temporary password (Firebase requires a
 *      recent sign-in to change a password, and it proves the person at the
 *      keyboard holds it);
 *   2. `updatePassword` — the current session keeps working; Firebase revokes
 *      only OTHER sessions;
 *   3. ask the server to clear the flag (reconcilePasswordResetFlags checks
 *      Auth's own record of the change — the browser cannot just claim it).
 * The live record then flips and the console opens. No sign-out, no second
 * sign-in, no broken session.
 *
 * @param {{ illustration?: React.ReactNode }} props  The portal's login art.
 */
export default function FirstPasswordGate({ illustration = null }) {
  const { user } = useAuth()
  const [state, setState] = useState({ uid: null, mustChange: null })

  useEffect(() => {
    if (!user?.uid) return undefined
    return onSnapshot(
      doc(db, STAFF_COLLECTION, user.uid),
      (snap) => setState({ uid: user.uid, mustChange: Boolean(snap.data()?.mustChangePassword) }),
      // A failed read must not lock an officer out of an emergency console;
      // the flag is enforced again on the next successful read.
      () => setState({ uid: user.uid, mustChange: false }),
    )
  }, [user?.uid])

  const known = state.uid === user?.uid && state.mustChange !== null
  if (!known) return null
  if (!state.mustChange) return <Outlet />
  return <SetPasswordScreen illustration={illustration} />
}

function SetPasswordScreen({ illustration }) {
  const { user, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Set once the password itself has changed, so a failed flag-clear retries
  // only that step instead of asking for the (now old) temporary password.
  const [changed, setChanged] = useState(false)

  const ready = changed || (Boolean(current) && passwordReady(next, confirmation) && next !== current)

  async function confirmWithServer() {
    const cleared = await reconcilePasswordResetFlags()
    if (!cleared.includes(user.uid)) {
      throw Object.assign(new Error('not-cleared'), { code: 'not-cleared' })
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      if (!changed) {
        const firebaseUser = auth.currentUser
        await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, current))
        await updatePassword(firebaseUser, next)
        setChanged(true)
      }
      await confirmWithServer()
      toast.success('Password set', { description: 'Use it from now on. Your temporary password no longer works.' })
      // Nothing else to do: the live staff record flips and the console opens.
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <LoginSplitLayout
      title="Set your password"
      description="Your account was created with a temporary password. Choose your own to open the console."
      illustration={illustration}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-auth-recovery>
        {changed ? (
          <p role="status" className="rounded-2xl border border-success/25 bg-success/10 p-3.5 text-sm text-success">
            Your new password is saved. Finishing setup…
          </p>
        ) : (
          <>
            <FloatingField
              id="temporary-password"
              label="Temporary password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              required
              filled={current.length > 0}
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
              trailing={
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
                  className="shrink-0 text-text-muted transition-colors hover:text-text-primary"
                >
                  {reveal ? <EyeOff size="sm" /> : <Eye size="sm" />}
                </button>
              }
            />
            <NewPasswordFields
              password={next}
              confirmation={confirmation}
              reveal={reveal}
              onPasswordChange={setNext}
              onConfirmationChange={setConfirmation}
              onToggleReveal={() => setReveal((v) => !v)}
              disabled={busy}
            />
            {next && current && next === current ? (
              <p className="-mt-3 px-6 text-xs font-medium text-danger">Choose a password different from the temporary one.</p>
            ) : null}
          </>
        )}

        {error ? (
          <p role="alert" className="rounded-2xl border border-danger/25 bg-danger/10 p-3.5 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy || !ready} className={CTA}>
          {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : null}
          {changed ? 'Try again' : busy ? 'Saving…' : 'Set password and continue'}
        </button>
        <button type="button" onClick={() => logout()} disabled={busy} className={SECONDARY}>
          Sign out
        </button>
      </form>
    </LoginSplitLayout>
  )
}

function messageFor(err) {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That is not the temporary password for this account.'
    case 'auth/weak-password':
      return 'That password was rejected as too weak. Try a longer one.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.'
    case 'auth/network-request-failed':
      return 'The server could not be reached. Check the connection and try again.'
    case 'not-cleared':
      return 'Your new password is saved, but the console could not confirm it yet. Try again in a moment.'
    default:
      return 'Your password could not be set. Try again.'
  }
}
