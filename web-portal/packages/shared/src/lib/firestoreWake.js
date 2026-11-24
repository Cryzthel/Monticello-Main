import { disableNetwork, enableNetwork } from 'firebase/firestore'

/** A tab hidden at least this long reconnects when it comes back. */
export const WAKE_AFTER_HIDDEN_MS = 20_000

/**
 * Reconnects Firestore's live stream when a laptop console wakes up.
 *
 * ── WHY (2026-10-19) ────────────────────────────────────────────────────────
 * "Reports appear instantly on the phone but a laptop needs a refresh." A
 * laptop's browser sleeps with the lid, freezes background tabs (Energy and
 * Memory Saver), and drops Wi-Fi on wake. The Firestore watch stream can die
 * in any of those without an error reaching the SDK for tens of seconds, and
 * a dispatch map shows nothing new until it notices. A phone in a hand is
 * none of those things.
 *
 * So the stream is restarted ONCE — `disableNetwork` then `enableNetwork` —
 * when the page:
 *   • becomes visible after being hidden ≥ WAKE_AFTER_HIDDEN_MS,
 *   • is resumed from a frozen state (Page Lifecycle `resume`),
 *   • is restored from the back/forward cache (`pageshow` persisted), or
 *   • the browser reports the network back (`online`).
 * Every listener re-runs against the server at once; pending writes are kept
 * (they live in the write queue, not the stream). A quick tab switch does
 * nothing.
 *
 * Returns an uninstall function, which also carries `reconnect(reason)` —
 * the same single-flight restart, for a caller with its own evidence that the
 * stream is stuck (useStageAction: a write the server has not confirmed
 * while the console is online). `deps` is for tests.
 */
export function installFirestoreWake(db, deps = {}) {
  const {
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null,
    now = () => Date.now(),
    disable = disableNetwork,
    enable = enableNetwork,
  } = deps
  if (!db || !doc || !win) return () => {}

  let hiddenSince = doc.visibilityState === 'hidden' ? now() : null
  let running = null

  const reconnect = (reason) => {
    if (running) return running
    // Never rejects: nothing awaits it from an event handler, and a failure
    // here must neither surface as an unhandled rejection nor leave the
    // console offline — so enable runs whatever disable did.
    running = (async () => {
      try {
        await disable(db)
      } catch (err) {
        console.warn('Firestore disconnect failed', reason, err?.code ?? err)
      }
      try {
        await enable(db)
      } catch (err) {
        console.warn('Firestore reconnect failed', reason, err?.code ?? err)
      }
      running = null
    })()
    return running
  }

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      hiddenSince = now()
      return
    }
    const away = hiddenSince == null ? 0 : now() - hiddenSince
    hiddenSince = null
    if (away >= WAKE_AFTER_HIDDEN_MS) reconnect('visible')
  }
  const onResume = () => reconnect('resume')
  const onPageShow = (event) => {
    if (event?.persisted) reconnect('pageshow')
  }
  const onOnline = () => reconnect('online')

  doc.addEventListener('visibilitychange', onVisibility)
  doc.addEventListener('resume', onResume)
  win.addEventListener('pageshow', onPageShow)
  win.addEventListener('online', onOnline)

  const uninstall = () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    doc.removeEventListener('resume', onResume)
    win.removeEventListener('pageshow', onPageShow)
    win.removeEventListener('online', onOnline)
  }
  uninstall.reconnect = reconnect
  return uninstall
}
