import { onSnapshot } from 'firebase/firestore'

/** Back-off between re-subscribe attempts: 2 s, 4 s, 8 s … capped at 30 s. */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 30_000

/**
 * `onSnapshot` that comes back after an error.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Firestore ENDS a listener when it reports an error; nothing re-attaches it.
 * A console whose incident query was refused once — a permission-denied in
 * the moment between sign-in and the staff role resolving, a dropped token
 * refresh, a transient `unavailable` — kept its last snapshot (often empty)
 * for the rest of the session, so a resident's report filed from the mobile
 * app never reached the guard's map until someone reloaded the page.
 *
 * Now an error is reported to `onError` and the same query is subscribed
 * again after a back-off; the first good snapshot resets the delay. A refusal
 * that is permanent (a non-staff account) costs one cheap retry every 30 s.
 *
 * Takes any Query or DocumentReference. Returns the unsubscribe function.
 */
export function subscribeWithRetry(target, onNext, onError, options) {
  let unsubscribe = () => {}
  let timer = null
  let attempt = 0
  let stopped = false

  const attach = () => {
    if (stopped) return
    const listen = (snapshot) => {
      attempt = 0
      onNext(snapshot)
    }
    const fail = (error) => {
      onError?.(error)
      if (stopped) return
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
      attempt += 1
      timer = setTimeout(attach, delay)
    }
    unsubscribe = options ? onSnapshot(target, options, listen, fail) : onSnapshot(target, listen, fail)
  }

  attach()
  return () => {
    stopped = true
    clearTimeout(timer)
    unsubscribe()
  }
}
