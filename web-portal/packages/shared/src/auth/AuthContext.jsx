import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
import { STAFF_COLLECTION, APPROVED_STATUS } from '@shared/auth/roles'
import { resolveWithTotp, secondFactorChallenge } from '@shared/lib/twoFactor'

/**
 * Portal-scoped authentication.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
 * An app may only ever hold a session for a role on ITS OWN allowlist. A
 * credential that belongs to the other portal is not "signed in but blocked" —
 * it is signed straight back out, here, at the auth boundary.
 *
 * WHY THAT CHANGED. Previously any approved staff account became
 * `isAuthenticated` in either console, and the ROUTE GUARD was the only thing
 * standing between a guard's credentials and the admin dashboard. That is a
 * real session leak, not a theoretical one: a guard who typed their password
 * into the admin login got a live Firebase session persisted in the ADMIN
 * origin's IndexedDB — refresh tokens and all — and saw only a red error
 * message. The tokens outlived the error. Anything that later mistook
 * `user != null` for "authorised", or any future route registered without a
 * guard, would have found a usable session sitting there.
 *
 * Rejecting at the provider makes the failure mode structural instead of
 * conventional: the admin app cannot hold a guardhouse session, so no route it
 * ever grows can accidentally honour one.
 *
 * `allowedRoles` is supplied by the app from its own src/config/portal.js —
 * shared code deliberately does not know the other portal's allowlist.
 */
// Exported only as a test seam: a throwaway harness can hand a page a fixture
// session through `<AuthContext.Provider value={…}>` without signing in.
// Application code uses AuthProvider and useAuth.
// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext(null)

// Firebase's raw error codes (e.g. "auth/user-not-found" vs "auth/wrong-password")
// would let a caller enumerate which emails are registered — collapse the
// credential-related ones into one generic message.
const INVALID_CREDENTIAL_CODES = new Set([
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-email',
])

const GENERIC_CREDENTIAL_ERROR = 'Invalid email or password.'

/**
 * Firestore codes that mean "ask again later", not "no".
 *
 * The role read fails for two completely different reasons, and they must not
 * produce the same message. A denial, or no staff document, means the account
 * is not authorised for this portal. A dropped connection means we do not KNOW
 * yet — and telling an officer mid-shift that their account is unauthorised
 * because Firestore blipped is both false and alarming.
 */
const TRANSIENT_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'internal',
  'resource-exhausted',
  'cancelled',
  'aborted',
])

const VERIFY_FAILED =
  'Could not reach the server to verify this account. Check the connection and try again.'

function isTransient(error) {
  const code = String(error?.code ?? '').replace(/^firestore\//, '')
  return TRANSIENT_CODES.has(code) || code === 'auth/network-request-failed'
}

/** The read, plus two quick retries, before a flaky connection is reported. */
const ROLE_READ_ATTEMPTS = 3

/**
 * Resolves the caller's role from their staff document, or `null` when there
 * is no document, it is not approved, or the role is not one this portal
 * accepts. All three collapse to the same answer on purpose: telling a
 * rejected caller *which* of the three it was tells them whether the account
 * exists and what it is for.
 *
 * THROWS when the answer is not knowable — the caller distinguishes that from
 * `null`, which is an answer. A denial stops immediately; only a transient
 * failure is retried, with a short backoff.
 */
async function resolvePortalRole(uid, allowedRoles) {
  let lastError = null

  for (let attempt = 0; attempt < ROLE_READ_ATTEMPTS; attempt += 1) {
    try {
      const staffSnap = await getDoc(doc(db, STAFF_COLLECTION, uid))
      if (!staffSnap.exists()) return null

      const staff = staffSnap.data()
      if (staff?.status !== APPROVED_STATUS) return null
      return allowedRoles.includes(staff.role) ? staff.role : null
    } catch (error) {
      lastError = error
      if (!isTransient(error)) break
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt))
    }
  }

  throw lastError ?? new Error('The account could not be verified.')
}

export function AuthProvider({
  children,
  allowedRoles,
  unauthorizedMessage = 'This account is not authorised for this portal.',
}) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [initializing, setInitializing] = useState(true)

  // Survives the sign-out that a rejection triggers. Without it the message is
  // wiped by the `onAuthStateChanged(null)` that our own signOut fires a beat
  // later, and the user is returned to a blank login screen with no
  // explanation of why they bounced.
  const [rejection, setRejection] = useState('')

  // `allowedRoles` is a literal array in the app config, so a naive dependency
  // on it would re-subscribe on every render. The ref pins the identity while
  // keeping the value current.
  const allowedRolesRef = useRef(allowedRoles)
  allowedRolesRef.current = allowedRoles

  const unauthorizedMessageRef = useRef(unauthorizedMessage)
  unauthorizedMessageRef.current = unauthorizedMessage

  useEffect(() => {
    // Guards against a slow staff-document read resolving after the user has
    // already signed out or signed in as somebody else — without it, a stale
    // response can install the previous account's role over the current one.
    let generation = 0

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const current = ++generation

      if (!firebaseUser) {
        setUser(null)
        setRole(null)
        setInitializing(false)
        return
      }

      let approvedRole = null
      let unreachable = false
      try {
        approvedRole = await resolvePortalRole(firebaseUser.uid, allowedRolesRef.current)
      } catch (error) {
        // Neither a denial nor a dropped connection may be read as "allowed" —
        // but they are reported differently, because one is the account's
        // answer and the other is the network's.
        approvedRole = null
        unreachable = isTransient(error)
      }

      if (current !== generation) return

      if (!approvedRole) {
        // Restoring a persisted session that this portal does not accept —
        // e.g. tokens left behind by an earlier build that shared one origin.
        // Clear it rather than sitting on it.
        setRejection(unreachable ? VERIFY_FAILED : unauthorizedMessageRef.current)
        setUser(null)
        setRole(null)
        setInitializing(false)
        await firebaseSignOut(auth).catch(() => {})
        return
      }

      setUser(firebaseUser)
      setRole(approvedRole)
      setInitializing(false)
    })

    return () => {
      generation += 1
      unsubscribe()
    }
  }, [])

  // The half of sign-in that runs once Firebase has a credential, shared by
  // the password step and the two-factor step.
  const finishSignIn = useCallback(async (credential) => {
    let approvedRole = null
    let unreachable = false
    try {
      approvedRole = await resolvePortalRole(credential.user.uid, allowedRolesRef.current)
    } catch (error) {
      approvedRole = null
      unreachable = isTransient(error)
    }

    if (!approvedRole) {
      // The session dies here, before this app ever reports itself as
      // authenticated. Awaited, so the tokens are gone before the caller
      // renders the error.
      await firebaseSignOut(auth).catch(() => {})
      // The sign-in form prints this verbatim, so it has to say which of the
      // two failures happened.
      throw new Error(unreachable ? VERIFY_FAILED : unauthorizedMessageRef.current)
    }

    return approvedRole
  }, [])

  const login = useCallback(
    async (email, password) => {
      setRejection('')

      let credential
      try {
        credential = await signInWithEmailAndPassword(auth, email, password)
      } catch (err) {
        // Right password, second factor due. Not a failure: the form moves to
        // its code step with the resolver this error carries. No session
        // exists yet — Firebase issues none until the factor is verified.
        const challenge = secondFactorChallenge(err)
        if (challenge) throw challenge
        if (INVALID_CREDENTIAL_CODES.has(err.code)) {
          throw new Error(GENERIC_CREDENTIAL_ERROR)
        }
        throw err
      }

      return finishSignIn(credential)
    },
    [finishSignIn],
  )

  /** The code step of a two-factor sign-in. */
  const completeSecondFactor = useCallback(
    async (resolver, code) => {
      const credential = await resolveWithTotp(resolver, code)
      return finishSignIn(credential)
    },
    [finishSignIn],
  )

  const logout = useCallback(async () => {
    setRejection('')
    await firebaseSignOut(auth)
  }, [])

  const value = useMemo(
    () => ({
      user,
      role,
      initializing,
      rejection,
      setRejection,
      isAuthenticated: Boolean(user && role),
      login,
      completeSecondFactor,
      logout,
    }),
    [user, role, initializing, rejection, login, completeSecondFactor, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
