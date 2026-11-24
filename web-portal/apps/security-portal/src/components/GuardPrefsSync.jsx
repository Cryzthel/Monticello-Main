import { useEffect, useRef } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { db } from '@shared/lib/firebase'
import { useAuth } from '@shared/auth/AuthContext'
import { isMuted, setMuted, subscribeAlertSound } from '@shared/lib/alertSound'
import { loadGuardPrefs, saveGuardPrefs, subscribeGuardPrefs } from '@/lib/guardPrefs'

/**
 * Keeps the officer's console preferences on their ACCOUNT (2026-10-19).
 *
 * `users/{uid}.guardPreferences`:
 *
 *   alertsMuted        the device-wide alert mute (shared/lib/alertSound)
 *   shareIdleLocation  position on the dispatch map while idle (lib/guardPrefs)
 *
 * Both used to live in this browser only, so an officer moving between the
 * guardhouse terminal and their phone set them twice and the two disagreed.
 * Now a change on any console reaches every other console this officer has
 * open within a second, and the next terminal they sign in to starts from it.
 * `users/{uid}` because firestore.rules already lets an owner write their own
 * document — no rules change, no deploy (see useNotificationReads).
 *
 * ── TWO-WAY, WITHOUT ECHO ──────────────────────────────────────────────────
 * The local stores stay the source the console reads (playAlert, telemetry),
 * so this component only bridges them:
 *   • a snapshot that differs from the device is applied to the device;
 *   • a device change that differs from the last known account value is
 *     written up — whichever control made it (Settings, or the SOS rail's
 *     Unmute, which clears the device mute too). Without that, the next
 *     snapshot would put back a mute the officer had just lifted.
 * `remote` is that last known account value, so an applied snapshot never
 * writes itself back.
 *
 * Nothing is written until the first snapshot lands: before it, the device
 * holds whatever the last officer on this terminal chose, and pushing that up
 * would overwrite this officer's own choice. An account with no stored
 * preferences yet is seeded from the device.
 *
 * Offline or denied: the device keeps working on its local values, the
 * listener re-subscribes (subscribeWithRetry), writes are queued by Firestore
 * and failures only warn.
 */
export default function GuardPrefsSync() {
  const { user } = useAuth()
  const uid = user?.uid
  const remote = useRef(null)

  useEffect(() => {
    if (!uid) return undefined
    remote.current = null
    const ref = doc(db, 'users', uid)

    const write = (patch) => {
      remote.current = { ...remote.current, ...patch }
      setDoc(ref, { guardPreferences: { ...patch, updatedAt: serverTimestamp() } }, { merge: true }).catch((err) =>
        console.warn('[guard prefs] not saved to the account', err?.code ?? err),
      )
    }

    const local = () => {
      const prefs = loadGuardPrefs()
      return { alertsMuted: isMuted(), shareIdleLocation: prefs.shareIdleLocation, sirenVolume: prefs.sirenVolume ?? null }
    }

    const stopSnapshot = subscribeWithRetry(
      ref,
      (snap) => {
        const stored = snap.data()?.guardPreferences
        const device = local()
        if (!stored) {
          write(device)
          return
        }
        const next = {
          alertsMuted: typeof stored.alertsMuted === 'boolean' ? stored.alertsMuted : device.alertsMuted,
          shareIdleLocation:
            typeof stored.shareIdleLocation === 'boolean' ? stored.shareIdleLocation : device.shareIdleLocation,
          sirenVolume:
            stored.sirenVolume === null || typeof stored.sirenVolume === 'number' ? stored.sirenVolume : device.sirenVolume,
        }
        remote.current = next
        if (next.alertsMuted !== device.alertsMuted) setMuted(next.alertsMuted)
        if (next.shareIdleLocation !== device.shareIdleLocation || next.sirenVolume !== device.sirenVolume) {
          saveGuardPrefs({ ...loadGuardPrefs(), shareIdleLocation: next.shareIdleLocation, sirenVolume: next.sirenVolume })
        }
      },
      (err) => console.warn('[guard prefs] account preferences unavailable', err?.code ?? err),
    )

    const stopSound = subscribeAlertSound(({ muted }) => {
      if (remote.current && remote.current.alertsMuted !== muted) write({ alertsMuted: muted })
    })
    const stopPrefs = subscribeGuardPrefs(({ shareIdleLocation, sirenVolume = null }) => {
      if (!remote.current) return
      const patch = {}
      if (remote.current.shareIdleLocation !== shareIdleLocation) patch.shareIdleLocation = shareIdleLocation
      if ((remote.current.sirenVolume ?? null) !== sirenVolume) patch.sirenVolume = sirenVolume
      if (Object.keys(patch).length) write(patch)
    })

    return () => {
      stopSnapshot()
      stopSound()
      stopPrefs()
    }
  }, [uid])

  return null
}
