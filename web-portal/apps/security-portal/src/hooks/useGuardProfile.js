import { useEffect, useState } from 'react'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { doc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { useAuth } from '@shared/auth/AuthContext'

/**
 * The signed-in officer's own staff account.
 *
 * ── WHY THIS IS NOT ON `useAuth` ────────────────────────────────────────────
 * `useAuth` resolves the Firebase user and the ROLE, because those two decide
 * whether a session may exist at all — every route in the portal waits on
 * them, so they are kept as small and as fast as possible. Badge number, shift
 * assignment and employment details decide nothing about access; they are
 * content for one panel. Loading them in the auth context would put a
 * Firestore read on the critical path of every sign-in to save a read on a
 * settings page almost nobody opens.
 *
 * ── LIVE, NOT A ONE-SHOT `getDoc` ───────────────────────────────────────────
 * `useGuardTelemetry` reads the badge once with `getDoc`, which is right for
 * it: it needs a value to stamp onto a telemetry document and never shows it
 * again. This one is rendered on screen while the officer looks at it, and an
 * administrator reassigning their shift mid-session should not leave the panel
 * stating yesterday's answer until a reload.
 *
 * ── A MISSING DOCUMENT IS NOT AN ERROR ──────────────────────────────────────
 * It is the ordinary state of an account provisioned through Firebase Auth
 * without a staff record, and of one whose record an administrator has just
 * deleted. `profile` is null and the panel says what it does not know, rather
 * than rendering an error over something nobody needs to act on.
 */
export function useGuardProfile() {
  const { user } = useAuth()
  const uid = user?.uid
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(Boolean(uid))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!uid) {
      setProfile(null)
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const unsubscribe = subscribeWithRetry(
      doc(db, 'staff_accounts', uid),
      (snap) => {
        setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setLoading(false)
      },
      (snapshotError) => {
        setError(snapshotError)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [uid])

  return {
    profile,
    loading,
    error,
    /**
     * The officer as every consumer here wants them: display name, email and
     * badge, with the Auth record and the staff document already reconciled.
     *
     * The staff document wins on name. It is what an administrator typed into
     * Security Accounts, which is the name on the duty roster; `displayName`
     * is whatever Firebase Auth was given at provisioning and is frequently
     * blank. Falling back through both and then to the email means the export
     * header is never the word "undefined".
     */
    officer: {
      name: profile?.name || user?.displayName || user?.email || 'Security officer',
      email: profile?.email || user?.email || '',
      badgeNumber: profile?.badgeNumber ? String(profile.badgeNumber) : '',
      role: profile?.role || '',
      shift: profile?.shift || '',
    },
  }
}

export default useGuardProfile
