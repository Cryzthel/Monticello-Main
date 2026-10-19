import { useCallback, useEffect, useRef, useState } from 'react'
import { describeDelivery, describeStageError } from '@/lib/dispatch'
import { toast } from '@shared/lib/toast'
import { isOffline, primeConnectivity } from '@shared/lib/connectivity'

// Ready before the first press, so the first answer is not "unknown".
primeConnectivity()

/**
 * How long to wait for the server before checking whether this console is
 * offline. If it is, the press is reported as saved on the device; if not,
 * the spinner stays — see the note in `run`.
 */
const QUEUE_NOTICE_MS = 2500

/** Online but still unconfirmed this long: release the button and say so. */
const SLOW_NOTICE_MS = 10_000

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
            // Reached only while the previous write is genuinely unconfirmed
            // (offline or the server not answering) — never because a push is
            // still on its way.
            text: 'The last action on this call has not reached the server yet. It will sync when the connection returns.',
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

        // ── "QUEUED" ONLY WHEN ACTUALLY OFFLINE (2026-10-19) ─────────────────
        // This used to say "saved on this device" for ANY confirmation slower
        // than QUEUE_NOTICE_MS, so dispatchers on a good connection were told
        // they were offline. Now the first check asks the connection
        // (lib/connectivity): offline → queued, as before; online → the
        // spinner stays, because the server is coming. Only past
        // SLOW_NOTICE_MS is the button released, with the honest version of
        // whichever is true then.
        let queued = false
        const queue = () => {
          queued = true
          settle(forId, {
            busy: null,
            feedback: {
              tone: 'warning',
              text: `${label}: saved on this device. It will sync when the connection returns.`,
            },
          })
        }
        let slow = null
        const notice = setTimeout(() => {
          if (isOffline()) {
            queue()
            return
          }
          slow = setTimeout(() => {
            if (isOffline()) {
              queue()
              return
            }
            queued = true
            settle(forId, {
              busy: null,
              feedback: { tone: 'info', text: `${label}: still saving. The server has not confirmed it yet.` },
            })
          }, SLOW_NOTICE_MS - QUEUE_NOTICE_MS)
        }, QUEUE_NOTICE_MS)
        const clearNotices = () => {
          clearTimeout(notice)
          clearTimeout(slow)
        }

        try {
          await handle.committed
        } catch (err) {
          clearNotices()
          console.error(`${label} was refused`, err)
          settle(forId, { busy: null, feedback: { tone: 'danger', text: describeStageError(err, label) } })
          return false
        } finally {
          // ── THE CALL IS FREE THE MOMENT THE SERVER HAS THE WRITE ──────────
          // The lock used to be held until the resident's push (a Cloud
          // Function round trip, seconds) had also finished, so pressing the
          // NEXT step straight away — Acknowledge, then Start navigation —
          // was refused with "The last action on this call is still saving",
          // on a perfect connection. The server has confirmed the stage here;
          // the push is a side effect and runs after, without holding the call.
          pendingRef.current.delete(forId)
        }
        clearNotices()

        // A clean success is a toast, not a receipt: the resolve dialog and
        // often the drawer close on it, and a receipt inside them would go
        // with them. Toasts also fire when the officer has already moved to
        // another call. Warnings and failures stay inline, where they persist.
        settle(forId, { busy: null, feedback: null })
        if (!handle.notify) {
          toast.success(`${label}${queued ? ' (synced)' : ''}`)
          return true
        }
        // The resident's push, in the background: the stage is already saved,
        // so the drawer moves on and the officer can press the next step.
        handle
          .notify()
          .then((result) => {
            const delivery = describeDelivery(result?.reason)
            if (delivery.tone === 'success') toast.success(label, { description: delivery.text })
            else settle(forId, { feedback: { tone: delivery.tone, text: `${label}. ${delivery.text}` } })
          })
          .catch((err) => {
            console.error(`${label}: resident notification failed`, err)
            settle(forId, { feedback: { tone: 'warning', text: `${label}. The resident could not be notified.` } })
          })
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
