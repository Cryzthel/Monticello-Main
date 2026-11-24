import { onDisconnect, onValue, push, ref, remove, serverTimestamp, set } from 'firebase/database'
import { rtdb } from '@shared/lib/firebase'

/**
 * Officer presence — "is this guard's console open right now?"
 *
 * ── THE SHAPE: presence/{uid} in the Realtime Database ──────────────────────
 *
 *   connections/{pushId}  true      one per open tab or device; each removes
 *                                   ITSELF on disconnect, so a second tab
 *                                   closing never marks a guard offline while
 *                                   the first is still open
 *   lastSeenAt            number    server ms, stamped on every disconnect and
 *                                   on sign-out
 *
 * Online means "at least one connection". The disconnect writes are queued on
 * the SERVER the moment the socket connects, so they run when the tab closes,
 * the laptop sleeps or the signal drops — none of which a client can report
 * itself. database.rules.json lets each user write only their own node.
 *
 * ── WHY THE ADMIN DOES NOT READ THIS DIRECTLY ───────────────────────────────
 * RTDB rules cannot see the Firestore staff record that says who is an admin.
 * The `onPresenceWrite` function mirrors each node into Firestore
 * `staff_presence/{uid}`, where firestore.rules can gate the read on
 * isAdminStaff(), and the roster listens to that.
 *
 * ── SIGNING OUT IS NOT A DISCONNECT ─────────────────────────────────────────
 * `signOut` re-authenticates the socket as anonymous; it does not close it, so
 * the queued disconnect writes would not fire until the tab closed. Sign-out
 * therefore calls the stop function first, which removes the connection and
 * stamps lastSeenAt while the session can still write.
 */

/**
 * Publishes `uid` as online for as long as this tab is connected. Returns an
 * async stop function that marks this connection offline. A no-op (and a no-op
 * stop) when the Realtime Database is not configured.
 */
export function startPresence(uid) {
  if (!rtdb || !uid) return async () => {}

  const lastSeenRef = ref(rtdb, `presence/${uid}/lastSeenAt`)
  let connectionRef = null
  let stopped = false

  const unsubscribe = onValue(ref(rtdb, '.info/connected'), (snap) => {
    if (snap.val() !== true || stopped) return
    // A fresh connection id on every (re)connect: the server already ran the
    // previous one's disconnect handler, which removed it.
    const next = push(ref(rtdb, `presence/${uid}/connections`))
    connectionRef = next
    // Queue the disconnect writes BEFORE announcing the connection, so there is
    // no instant at which this tab is online with nothing to take it offline.
    onDisconnect(lastSeenRef)
      .set(serverTimestamp())
      .then(() => onDisconnect(next).remove())
      .then(() => {
        if (!stopped && connectionRef === next) return set(next, true)
        return undefined
      })
      .catch((err) => console.warn('[presence] could not publish', err?.code ?? err))
  })

  return async function stopPresence() {
    if (stopped) return
    stopped = true
    unsubscribe()
    const current = connectionRef
    connectionRef = null
    if (!current) return
    try {
      await Promise.all([onDisconnect(current).cancel(), onDisconnect(lastSeenRef).cancel()])
      await remove(current)
      await set(lastSeenRef, serverTimestamp())
    } catch (err) {
      // Never block a sign-out on this. The server-side disconnect handler is
      // still queued if the writes above did not land, and closes it later.
      console.warn('[presence] could not mark offline', err?.code ?? err)
    }
  }
}
