import { TotpMultiFactorGenerator, getMultiFactorResolver } from 'firebase/auth'
import { auth } from '@shared/lib/firebase'

/**
 * The authenticator-code step of sign-in.
 *
 * Neither console offers two-factor ENROLMENT — a factor can only be added
 * through Firebase itself (the Admin SDK or the console, once the project runs
 * on Identity Platform with the TOTP provider enabled). But an account that
 * has one enrolled is refused by `signInWithEmailAndPassword` with
 * `auth/multi-factor-auth-required`, and without this step such an account
 * could not sign in to either portal at all. So the login form answers that
 * challenge instead of showing it as an error.
 */

export const TOTP_FACTOR_ID = TotpMultiFactorGenerator.FACTOR_ID

/**
 * Thrown by sign-in when the password was right and a second factor is due.
 * Carries the resolver the code step needs.
 */
export class SecondFactorRequiredError extends Error {
  constructor(resolver) {
    super('Enter the 6-digit code from your authenticator app.')
    this.name = 'SecondFactorRequiredError'
    this.resolver = resolver
  }
}

/** Wrap Firebase's multi-factor sign-in challenge, or return null. */
export function secondFactorChallenge(error) {
  if (error?.code !== 'auth/multi-factor-auth-required') return null
  return new SecondFactorRequiredError(getMultiFactorResolver(auth, error))
}

/** Finish a sign-in with an authenticator code. */
export function resolveWithTotp(resolver, code) {
  const hint = resolver.hints.find((candidate) => candidate.factorId === TOTP_FACTOR_ID)
  if (!hint) {
    const error = new Error('This account’s second factor is not an authenticator app, which this console cannot verify.')
    error.code = 'mv/unsupported-second-factor'
    throw error
  }
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, normaliseCode(code))
  return resolver.resolveSignIn(assertion)
}

/** "123 456" → "123456". */
export function normaliseCode(code) {
  return String(code ?? '').replace(/\D/g, '').slice(0, 6)
}

/** A readable sentence for a failed code step. */
export function describeTwoFactorError(error) {
  switch (error?.code) {
    case 'auth/invalid-verification-code':
    case 'auth/invalid-credential':
      return 'That code did not match. Codes change every 30 seconds — enter the one showing now.'
    case 'auth/missing-code':
      return 'Enter the 6-digit code from your authenticator app.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes before trying again.'
    case 'auth/multi-factor-session-expired':
    case 'auth/code-expired':
      return 'This sign-in timed out. Enter your password again.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check this console’s connection.'
    default:
      return error?.message ?? 'Something went wrong. Try again.'
  }
}
