import { useCallback, useEffect, useRef, useState } from 'react'
import { describeDelivery, describeStageError } from '@/lib/dispatch'
import { toast } from '@shared/lib/toast'
import { isOffline, primeConnectivity, subscribeConnectivity } from '@shared/lib/connectivity'
import { reconnectFirestore } from '@shared/lib/firebase'
import { KICK_AFTER_MS, RELEASE_AFTER_MS as RETRY_KICK_MS } from '@shared/lib/writeSync'

// Ready before the first press, so the first answer is not "unknown".
primeConnectivity()

const IDLE = { busy: null, feedback: null }

/**
 * Runs one dispatch command (lib/dispatchWorkflow.js) for a drawer, and turns
 * its outcome into one receipt.
 *
 *   busy       the key of the action in flight, so the spinner sits on the
 *              button that was pressed
 *   feedback   { tone, text } for the receipt, or null
 *   offline    live connectivity signal, for copy and button hints
 *
 * ── THE PRESS IS DONE WHEN THE DEVICE HAS IT (2026-10-19) ──────────────────
 * A batch is applied to the local cache the instant it is committed, so the
 * drawer, the map and navigation all move to the next stage at once. `run`
 * now resolves true at THAT point — the guard is never held on a spinner
 * waiting for a round trip — and the server's answer is followed in the
 * background:
 *
 *   accepted   a success toast (plus the resident's push, if any)
 *   refused    a danger receipt + toast; the next snapshot rolls the stage back
 *   offline    a warning that it is saved on the device and will sync
 *   online but unconfirmed after KICK_AFTER_MS
 *              the Firestore stream is restarted (disableNetwork/enableNetwork).
 *              This was the "still saving. The server has not confirmed it
 *              yet." receipt: a laptop's write stream can sit dead after sleep
 *              or a Wi-Fi hop with no error reaching the SDK, and the write
 *              waited for the next unrelated wake-up. Pending writes survive
 *              the restart and are re-sent on the fresh stream at once.
 *
 * Writes are sent in order, so pressing the NEXT step while the previous one
 * is still unconfirmed is safe — the rules see them in sequence. Only a
 * repeat of the SAME action on the same call is refused locally: three
 * presses on a dead connection would otherwise queue three identical batches,
 * the first lands, and the rules refuse the rest with red receipts for work
 * that succeeded.
 *
 * Keyed to `incidentId`. Opening another call clears the receipt: "Resident
 * notified" must never appear on a call it was not about.
 */
export function useStageAction(incidentId) {
  const [state, setState] = useState(IDLE)
  const [offline, setOffline] = useState(() => isOffline())
  const currentRef = useRef(incidentId)
  currentRef.current = incidentId

  /** `${incidentId}|${key}` for every batch the server has not answered yet. */
  const pendingRef = useRef(new Set())

  useEffect(() => subscribeConnectivity(setOffline), [])

  useEffect(() => {
    setState(IDLE)
  }, [incidentId])

  const settle = useCallback((forId, patch) => {
    if (currentRef.current === forId) setState((prev) => ({ ...prev, ...patch }))
  }, [])

  /**
   * `key` names the button. `label` is what happened, e.g. "Acknowledged".
   * `start` runs the command and returns its `{ committed, notify }`.
   * Resolves true once the write is applied on this device (and therefore
   * queued for the server), false if it could not be made at all.
   */
  const run = useCallback(
    async (key, label, start) => {
      const forId = incidentId
      const lock = `${forId}|${key}`
      if (pendingRef.current.has(lock)) {
        settle(forId, {
          feedback: {
            tone: 'warning',
            text: 'That action is already on its way to the server. It will sync when the connection returns.',
          },
        })
        return false
      }
      setState({ busy: key, feedback: null })

      let handle
      try {
        handle = await start()
      } catch (err) {
        console.error(`${label} failed before writing`, err)
        settle(forId, { busy: null, feedback: { tone: 'danger', text: describeStageError(err, label) } })
        return false
      }

      pendingRef.current.add(lock)
      const queuedOffline = isOffline()
      settle(forId, {
        busy: null,
        feedback: queuedOffline
          ? { tone: 'warning', text: `${label}: saved on this device. It will sync when the connection returns.` }
          : null,
      })
      void confirm({ handle, forId, lock, label, queuedOffline })
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidentId, settle],
  )

  /** Follows one write to the server. Never rejects. */
  async function confirm({ handle, forId, lock, label, queuedOffline }) {
    const kick = (reason) => {
      if (!isOffline()) void reconnectFirestore(reason)
    }
    // Online and unconfirmed at KICK_AFTER_MS: the stream is presumed wedged
    // and restarted; once more at RETRY_KICK_MS if still unconfirmed.
    const first = setTimeout(() => kick('unconfirmed-write'), KICK_AFTER_MS)
    const second = setTimeout(() => kick('unconfirmed-write-retry'), RETRY_KICK_MS)
    try {
      await handle.committed
    } catch (err) {
      console.error(`${label} was refused`, err)
      const text = describeStageError(err, label)
      settle(forId, { feedback: { tone: 'danger', text } })
      toast.error(text)
      return
    } finally {
      clearTimeout(first)
      clearTimeout(second)
      pendingRef.current.delete(lock)
    }

    // A clean success is a toast, not a receipt: the drawer often closes on
    // it, and toasts also reach an officer who has moved to another call.
    // Clear the "saved on this device" receipt it replaces.
    if (queuedOffline) settle(forId, { feedback: null })
    if (!handle.notify) {
      toast.success(`${label}${queuedOffline ? ' (synced)' : ''}`)
      return
    }
    try {
      const result = await handle.notify()
      const delivery = describeDelivery(result?.reason)
      if (delivery.tone === 'success') toast.success(label, { description: delivery.text })
      else settle(forId, { feedback: { tone: delivery.tone, text: `${label}. ${delivery.text}` } })
    } catch (err) {
      console.error(`${label}: resident notification failed`, err)
      settle(forId, { feedback: { tone: 'warning', text: `${label}. The resident could not be notified.` } })
    }
  }

  const dismiss = useCallback(() => setState((prev) => ({ ...prev, feedback: null })), [])

  return { ...state, offline, run, dismiss }
}
