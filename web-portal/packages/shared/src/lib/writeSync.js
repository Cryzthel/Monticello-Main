import { isOffline } from '@shared/lib/connectivity'
import { reconnectFirestore } from '@shared/lib/firebase'

/** Unconfirmed this long: offline → queued; online → restart the stream. */
export const KICK_AFTER_MS = 2500
/** Still unconfirmed this long: stop holding the button; it is queued. */
export const RELEASE_AFTER_MS = 10_000

/**
 * Wait for a Firestore write the way a button should — never forever.
 *
 * A Firestore write promise settles on the SERVER's answer. Offline, or on a
 * stream that died with a laptop's Wi-Fi hop, that can be never — and a
 * button awaiting it sits on "Acknowledging…" while the write itself has
 * long since been applied to the local cache and queued.
 *
 * Resolves 'synced' when the server accepts. Resolves 'queued' when the
 * console is offline at KICK_AFTER_MS, or at RELEASE_AFTER_MS whatever the
 * connection says (the stream is restarted at KICK_AFTER_MS when online, which
 * usually lands it first). Rejects only if the server REFUSES before then. A
 * refusal after 'queued' goes to `onLateError`, so it is never unhandled.
 */
export function settleWrite(write, { onLateError } = {}) {
  let released = false
  return new Promise((resolve, reject) => {
    const release = () => {
      if (released) return
      released = true
      clearTimeout(kick)
      clearTimeout(cap)
      resolve('queued')
    }
    const kick = setTimeout(() => {
      if (isOffline()) release()
      else void reconnectFirestore('unconfirmed-write')
    }, KICK_AFTER_MS)
    const cap = setTimeout(release, RELEASE_AFTER_MS)
    Promise.resolve(write).then(
      () => {
        clearTimeout(kick)
        clearTimeout(cap)
        if (!released) {
          released = true
          resolve('synced')
        }
      },
      (err) => {
        clearTimeout(kick)
        clearTimeout(cap)
        if (!released) {
          released = true
          reject(err)
        } else {
          console.error('A queued write was refused by the server', err)
          onLateError?.(err)
        }
      },
    )
  })
}
