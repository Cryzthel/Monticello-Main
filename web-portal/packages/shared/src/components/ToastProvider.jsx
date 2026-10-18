import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IncidentNotificationToast from '@shared/components/IncidentNotificationToast'
import ActionToaster from '@shared/components/ActionToaster'

const ToastContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a <ToastProvider>')
  return context
}

// Critical alerts stay until dismissed — auto-hiding an emergency is the one
// behaviour a dispatch console must never have.
const DEFAULT_TTL_MS = 8000
const MAX_VISIBLE = 4

/**
 * Top-right notification stack for both portals.
 *
 * Rendered through a portal into document.body for the same reason
 * NotificationBell and StatusSelect are: the shell's main column is an
 * `overflow-y-auto` scroll container, so an inline overlay would scroll away
 * with the page instead of staying pinned to the viewport.
 *
 * Positioned top-right and offset below the header so a card never covers the
 * notification bell or the account menu it is telling the operator about.
 */
export default function ToastProvider({ children }) {
  const [alerts, setAlerts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  /**
   * Takes a notification built by `lib/notifications.js` — the same object the
   * bell panel renders — plus the two fields only a transient card needs.
   * Nothing here composes its own copy, which is what keeps a toast and the
   * bell row it becomes a moment later saying the same thing.
   *
   * @param {object} alert
   * @param {'incident'|'announcement'} alert.kind
   * @param {string}  alert.tone                  error|warning|success|info.
   * @param {string}  alert.title                 Headline.
   * @param {string} [alert.detail]               Supporting line.
   * @param {string}  alert.propertyLabel         Resident tag (Phase/Block/Lot).
   * @param {Date}    alert.at                    Event time.
   * @param {string} [alert.categoryLabel]        Category badge label.
   * @param {string} [alert.categoryTone]         Category badge tone key.
   * @param {string} [alert.priority]             Drives the colour-coded border.
   * @param {string} [alert.actionLabel]          Label on the action button.
   * @param {Function} [alert.onView]             Action handler.
   * @param {string} [alert.dedupeKey]            Replaces an existing card.
   * @param {number} [alert.ttl]                  Override the auto-dismiss.
   */
  const notify = useCallback(
    (alert) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const next = { ...alert, id }

      setAlerts((prev) => {
        // A burst of writes to the same incident (status change + the
        // wpdaScore backfill from onIncidentWrite) would otherwise stack
        // near-identical cards. Replacing by key keeps the newest.
        const deduped = alert.dedupeKey ? prev.filter((a) => a.dedupeKey !== alert.dedupeKey) : prev
        // Newest first: the stack renders top-down from the header, so the
        // most recent alert must be the one nearest the top edge.
        return [next, ...deduped].slice(0, MAX_VISIBLE)
      })

      const lifetime = alert.ttl ?? (alert.priority === 'critical' ? null : DEFAULT_TTL_MS)
      if (lifetime) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), lifetime),
        )
      }
      return id
    },
    [dismiss],
  )

  // Clear every pending timer on unmount so a dismissal can't fire against an
  // unmounted tree during a route/portal teardown.
  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    },
    [],
  )

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Action feedback (toast.success / toast.error) — a separate stack.
          See lib/toast.js for why it is not these incident cards. */}
      <ActionToaster />
      {createPortal(
        <div className="pointer-events-none fixed right-4 top-20 z-[var(--z-toast)] flex flex-col gap-2.5">
          {alerts.map((alert) => (
            <IncidentNotificationToast
              key={alert.id}
              alert={alert}
              onDismiss={() => dismiss(alert.id)}
              onView={
                alert.onView
                  ? () => {
                      alert.onView()
                      dismiss(alert.id)
                    }
                  : undefined
              }
            />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
