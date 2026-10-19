import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore'
import { getDatabase } from 'firebase/database'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { getMessaging, isSupported as isMessagingSupported } from 'firebase/messaging'
import { PORTAL } from '@shared/config/portal'
import { installFirestoreWake } from '@shared/lib/firestoreWake'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Fail at import rather than at the first query. A missing apiKey surfaces
// deep inside the SDK as an opaque `auth/invalid-api-key` on whatever screen
// happens to touch Firebase first, which is a long way from the actual cause
// (an unset .env.local at the monorepo root).
const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingConfig.length > 0) {
  throw new Error(
    `[firebase] Missing config: ${missingConfig.join(', ')}. ` +
      'Copy .env.example to .env.local at the web-portal root and fill it in — ' +
      'both apps read their Firebase credentials from that one file.',
  )
}

/**
 * The Firebase app is NAMED AFTER THE PORTAL, and that is load-bearing.
 *
 * Firebase Auth persists the signed-in user under
 *
 *     firebase:authUser:{apiKey}:{appName}
 *
 * in IndexedDB (`firebaseLocalStorageDb`) — one slot per app name per origin.
 * On the default app both consoles shared a single slot, so signing into the
 * Guardhouse overwrote the Admin session, and Firebase's cross-tab listener
 * pushed that eviction into every open tab: the admin's next render saw
 * `onAuthStateChanged(null)` and the route guard bounced them to login.
 *
 * The two apps now run on separate origins (ports 3000 and 3001), and THAT is
 * the primary isolation: a separate origin means a separate IndexedDB, so
 * neither console can read or evict the other's tokens even in principle.
 *
 * Naming the app after the portal anyway is defence in depth, for the day
 * someone puts both behind one hostname — a reverse proxy, a staging box, a
 * path-based deployment. On that shared origin the port no longer separates
 * them and this name is the only thing left that does.
 *
 * `PORTAL` is a build-time literal (see config/portal.js), so APP_NAME cannot
 * drift at runtime. There is deliberately no `[DEFAULT]` fallback any more:
 * the fallback WAS the collision.
 *
 * Firestore/Storage/Functions must come from this SAME app — each attaches the
 * ID token of the auth instance belonging to its app. Reading `db` from a
 * differently-named app would issue unauthenticated requests and every
 * firestore.rules check would deny.
 */
const APP_NAME = PORTAL

const existingApp = getApps().find((candidate) => candidate.name === APP_NAME)
export const app = existingApp ?? initializeApp(firebaseConfig, APP_NAME)

export const auth = getAuth(app)
/**
 * The Guardhouse keeps Firestore's cache in IndexedDB. A guard working a call
 * on the far side of the estate with no signal can still open it, see its
 * stage, and press the next action: the write is applied locally at once and
 * queued until the device reconnects. See lib/dispatchWorkflow.js in the
 * security portal.
 *
 * ── ONE TAB OWNS THE CACHE; EVERY TAB OWNS ITS STREAM (2026-10-19) ────────
 * This was `persistentMultipleTabManager`, under which only one "primary"
 * tab holds the network stream and every other tab is fed by it through
 * IndexedDB. On a laptop the primary is often a BACKGROUND console tab, and
 * the browser throttles and freezes background tabs — so the tab the guard
 * was looking at received new reports late, or not until a refresh made it
 * primary. That was "instant on the phone, needs a refresh on the laptop".
 *
 * Now the first tab takes the IndexedDB cache (`forceOwnership: false`), and
 * any other tab gets `failed-precondition`, which the SDK answers by falling
 * back to an in-memory cache with ITS OWN live stream. No tab waits on
 * another; only the first keeps the offline cache, which is the one a guard
 * opens in a dead zone.
 *
 * The Admin console keeps the default in-memory cache. It is a desk tool, and
 * persisting every resident's records in a shared office browser is a cost
 * with nothing to buy.
 *
 * `initializeFirestore` may be called once per app. A hot reload re-runs this
 * module against the SAME app (see existingApp above), so the second call
 * falls back to the instance already made. Where IndexedDB is unavailable
 * (some private windows), the SDK itself falls back to memory and logs why.
 */
function createFirestore() {
  if (PORTAL !== 'security') return getFirestore(app)
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: false }) }),
    })
  } catch {
    return getFirestore(app)
  }
}

export const db = createFirestore()
// Restart the live stream after sleep, a frozen tab or a dropped network,
// so a laptop console never sits on a dead stream (lib/firestoreWake.js).
installFirestoreWake(db)
export const storage = getStorage(app)

/**
 * The Realtime Database, used for ONE thing: officer presence (lib/presence.js).
 * Firestore cannot tell a server that a client vanished; RTDB's
 * `.info/connected` and `onDisconnect` can, which is what lets the admin
 * roster flip a guard to Offline when their tab closes or their signal drops.
 *
 * Optional. Without VITE_FIREBASE_DATABASE_URL this is null, presence is
 * simply not published, and the Security Accounts roster falls back to the
 * last time each officer was on post.
 */
export const rtdb = import.meta.env.VITE_FIREBASE_DATABASE_URL
  ? getDatabase(app, import.meta.env.VITE_FIREBASE_DATABASE_URL)
  : null
export const functions = getFunctions(app)

// FCM requires a secure context + browser support; guard the getter accordingly.
export async function getMessagingIfSupported() {
  if (await isMessagingSupported()) {
    return getMessaging(app)
  }
  return null
}
