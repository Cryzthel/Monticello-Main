import { useCallback, useEffect, useRef, useState } from 'react'
import { describeDelivery, describeStageError } from '@/lib/dispatch'

/**
 * How long to wait for the server before telling an officer their press was
 * saved on the device and will sync later. Online, a batch commits in well
 * under a second. Past this, the device is offline or on a signal too weak to
 * wait on in the street.
 */
const QUEUE_NOTICE_MS = 2500

const IDLE = { busy: null, feedback: null }

/**
 * Runs one dispatch command (lib/dispatchWorkflow.js) for a drawer, and turns
 * its outcome into one receipt.
 *
 *   busy       the key of the action in flight, so the spinner sits on the
 *              button that was pressed
 *   feedback   { tone, text } for the receipt, or null
 *
 * ── OFFLINE ────────────────────────────────────────────────────────────────
 * A batch is applied to the local cache at once, so the drawer moves to the
 * next stage straight away, online or not. If the server has not accepted it
 * within QUEUE_NOTICE_MS, the button is released and the receipt says the
 * action is queued. When it does land, the receipt updates and the resident
 * is pushed, provided the drawer is still on the same call. If the server
 * refuses it on arrival, the receipt says so, and the next snapshot rolls the
 * stage back.
 *
 * Keyed to `incidentId`. Opening another call clears the receipt: "Resident
 * notified" must never appear on a call it was not about.
 */
export function useStageAction(incidentId) {
  const [state, setState] = useState(IDLE)
  const currentRef = useRef(incidentId)
  currentRef.current = incidentId

  /**
   * Calls whose batch has not been answered yet, by incident id.
   *
   * `busy` is released after QUEUE_NOTICE_MS so an officer with no signal is
   * not left staring at a spinner — which also re-enables the button while the
   * write is still queued. Without this, three presses on a dead connection
   * queue three identical batches: the first lands, the rules refuse the rest,
   * and the officer gets a burst of red receipts for work that succeeded.
   *
   * Keyed by incident, so a queued write on one call never blocks another.
   */
  const pendingRef = useRef(new Map())

  useEffect(() => {
    setState(IDLE)
  }, [incidentId])

  const settle = useCallback((forId, patch) => {
    if (currentRef.current === forId) setState((prev) => ({ ...prev, ...patch }))
  }, [])

  /**
   * `key` names the button. `label` is what happened, e.g. "Unit dispatched".
   * `start` runs the command and returns its `{ committed, notify }`.
   * Resolves true once the server accepts, false if anything failed. A caller
   * that closes a modal on success should wait for this.
   */
  const run = useCallback(
    async (key, label, start) => {
      const forId = incidentId
      if (pendingRef.current.get(forId)) {
        settle(forId, {
          feedback: {
            tone: 'warning',
            text: 'The last action on this call is still saving. It will sync when the connection returns.',
          },
        })
        return false
      }
      pendingRef.current.set(forId, true)
      setState({ busy: key, feedback: null })

      try {
        let handle
        try {
          handle = await start()
        } catch (err) {
          console.error(`${label} failed before writing`, err)
          settle(forId, { busy: null, feedback: { tone: 'danger', text: describeStageError(err, label) } })
          return false
        }

        let queued = false
        const notice = setTimeout(() => {
          queued = true
          settle(forId, {
            busy: null,
            feedback: {
              tone: 'warning',
              text: `${label}: saved on this device. It will sync when the connection returns.`,
            },
          })
        }, QUEUE_NOTICE_MS)

        try {
          await handle.committed
        } catch (err) {
          clearTimeout(notice)
          console.error(`${label} was refused`, err)
          settle(forId, { busy: null, feedback: { tone: 'danger', text: describeStageError(err, label) } })
          return false
        }
        clearTimeout(notice)

        if (!handle.notify) {
          settle(forId, { busy: null, feedback: { tone: 'success', text: `${label}${queued ? ' (synced)' : ''}.` } })
          return true
        }
        settle(forId, { busy: queued ? null : key, feedback: queued ? { tone: 'warning', text: `${label}: synced. Notifying the resident…` } : null })
        const delivery = describeDelivery((await handle.notify())?.reason)
        settle(forId, { busy: null, feedback: { tone: delivery.tone, text: `${label}. ${delivery.text}` } })
        return true
      } finally {
        pendingRef.current.delete(forId)
      }
    },
    [incidentId, settle],
  )

  const dismiss = useCallback(() => setState((prev) => ({ ...prev, feedback: null })), [])

  return { ...state, run, dismiss }
}
