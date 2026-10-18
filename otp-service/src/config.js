/**
 * The numbers that make this flow safe. Ported verbatim from
 * functions/index.js — if you change one here, change it there too, because
 * both implementations may run against the SAME Firestore collection during a
 * migration and they must agree on what a stored record means.
 */

export const COLLECTION = 'password_reset_otps'
export const OTP_TTL_MINUTES = 10
export const MAX_ATTEMPTS = 5

/**
 * Four digits (2026-10-16, the estate's decision), and this is half of a pair.
 *
 * `kOtpLength` in lib/features/auth/widgets/otp_pin_input.dart is the other
 * half, and OtpInput.jsx's LENGTH is a third. `verifyOtp` rejects a code of the
 * wrong length before it ever reaches the hash comparison, so a client sending
 * 6 against a service expecting 4 fails every reset in the estate at the same
 * step with a message that describes none of it.
 *
 * Six rather than four is a search-space decision: 10,000 possibilities becomes
 * a million, against the same 5-attempt budget and the same 10-minute window.
 */
export const OTP_LENGTH = 4
export const OTP_MAX_EXCLUSIVE = 10 ** OTP_LENGTH

/**
 * A resend inside this window is answered with success, but sends nothing and
 * reissues nothing. The code already in the caller's inbox stays live, so the
 * legitimate flow is unaffected — the user types the code they were sent.
 */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000

/**
 * Guesses are counted per ADDRESS over this window, not per issued code.
 *
 * MAX_ATTEMPTS caps guesses at five, which is a sound cap only if five is all a
 * caller ever gets. An earlier version overwrote the record with `attempts: 0`
 * on every send, so five wrong guesses followed by another send returned a full
 * budget; the endpoint is unauthenticated, so that was a walkable keyspace. The
 * window makes the cap cumulative and the cooldown bounds the email flood that
 * refilling it required.
 *
 * The width of the code and the width of this window are both load-bearing and
 * neither is redundant: the window is what makes the cap real, and the length is
 * what keeps a future regression of the window from being immediately
 * catastrophic — which is not hypothetical, because it happened here once.
 */
export const OTP_ATTEMPT_WINDOW_MS = 30 * 60 * 1000

/**
 * Browser origins allowed to call this service, comma-separated.
 *
 * CORS is not an authorisation boundary — anything that is not a browser
 * ignores it entirely, and these endpoints are deliberately unauthenticated
 * because a person who has forgotten their password cannot present a token. It
 * is here for the one thing it does do: stop an unrelated page the resident is
 * visiting from driving this service with their browser in the background.
 *
 * The real protections are the per-address cooldown, the cumulative attempt
 * window, and the fact that the response never varies by whether the account
 * exists.
 */
export const allowedOrigins = () =>
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
