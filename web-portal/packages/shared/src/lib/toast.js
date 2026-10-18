import { toast as sonner } from 'sonner'

/**
 * Action feedback: "Announcement updated", "Could not delete the account".
 *
 * ── TWO STACKS, ON PURPOSE ─────────────────────────────────────────────────
 * ToastProvider's top-right cards are INCIDENT alerts: priority chip,
 * category glyph, a lot and a map pin, and critical ones never auto-hide.
 * Pushing "Account created" through that card dressed a CRUD result as an
 * emergency (see the note in SecurityAccountsPage). This is the other kind:
 * one line, a tone, gone in four seconds, bottom-right so it never covers an
 * incident card. Rendered by <ActionToaster>, which ToastProvider mounts.
 *
 * ── HOW TO USE IT ──────────────────────────────────────────────────────────
 *   toast.success('Announcement updated')
 *   toast.error('Could not delete the announcement', { description: err.message })
 *   await toast.run(() => archiveIncidents(ids), { success: 'Report archived', error: 'Could not archive' })
 *
 * `run` is the one to reach for around a write: it awaits the promise, toasts
 * the outcome, NEVER rethrows (an unhandled rejection was what kept several
 * success messages from ever showing), and resolves true/false so the caller
 * can close its modal only on success.
 *
 * Pass `id` to collapse a burst into one toast — settings auto-save does, so
 * flipping five switches is one "Settings saved", not a stack of five.
 */

const DURATION = { success: 4000, info: 4000, warning: 6000, error: 7000 }

function show(kind, message, options = {}) {
  return sonner[kind](message, { duration: DURATION[kind], ...options })
}

/** A human sentence for a failed write: the Firebase code, translated. */
export function describeError(err) {
  const code = err?.code ?? ''
  if (code.endsWith('permission-denied')) return 'This account is not allowed to make that change.'
  if (code.endsWith('unavailable') || code.endsWith('network-request-failed'))
    return 'The server could not be reached. Check the connection and try again.'
  if (code.endsWith('not-found')) return 'It no longer exists — someone may have removed it.'
  if (code.endsWith('deadline-exceeded')) return 'The request timed out. Try again.'
  if (code.endsWith('unauthenticated')) return 'Your session has expired. Sign in again.'
  const message = err?.message?.replace(/^Firebase:\s*/, '').replace(/\s*\(.*\)\.?$/, '')
  return message || 'Something went wrong. Try again.'
}

export const toast = {
  success: (message, options) => show('success', message, options),
  info: (message, options) => show('info', message, options),
  warning: (message, options) => show('warning', message, options),
  error: (message, options) => show('error', message, options),
  dismiss: (id) => sonner.dismiss(id),

  /**
   * Await a write and report it. Resolves `true` on success, `false` on
   * failure; never throws.
   *
   * @param {() => Promise<any>} action
   * @param {{ success?: string | ((result: any) => string), error?: string,
   *           id?: string, quiet?: boolean }} messages
   *   `quiet: true` skips the success toast (for writes whose result is
   *   already visible in place) but still reports a failure.
   */
  async run(action, { success, error = 'That did not go through', id, quiet = false } = {}) {
    try {
      const result = await action()
      if (success && !quiet) {
        show('success', typeof success === 'function' ? success(result) : success, id ? { id } : undefined)
      }
      return true
    } catch (err) {
      console.error(error, err)
      show('error', error, { description: describeError(err), ...(id ? { id } : {}) })
      return false
    }
  },
}

export default toast
