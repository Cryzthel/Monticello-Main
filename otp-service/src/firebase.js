import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

/**
 * Admin credentials, from an environment variable rather than the ambient
 * identity Cloud Functions used to supply for free.
 *
 * This is the one genuinely new risk in moving off Google's own runtime: a
 * service-account private key now lives in a third-party host's environment
 * rather than in Google's metadata server. Two consequences worth acting on:
 *
 *   · Give the key its own service account with ONLY the roles it needs here —
 *     Firebase Authentication Admin (to look up users and mint reset links) and
 *     Cloud Datastore User (for the one OTP collection). Do not reuse the
 *     project-wide owner key the Firebase console offers first.
 *   · Rotating it is a console action plus one env-var edit, and it is worth
 *     doing if the host account is ever shared.
 *
 * Base64 is accepted because the raw JSON contains literal newlines inside the
 * private key, which several dashboards mangle on paste.
 */
function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. See otp-service/README.md.'
    )
  }
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8')
  return JSON.parse(text)
}

/**
 * Serverless containers are reused between invocations, so initialising
 * unconditionally throws "app already exists" on the second warm request.
 */
function app() {
  return getApps().length ? getApps()[0] : initializeApp({ credential: cert(credentials()) })
}

export const db = () => getFirestore(app())
export const auth = () => getAuth(app())
