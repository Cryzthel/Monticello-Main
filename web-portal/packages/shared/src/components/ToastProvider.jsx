import ActionToaster from '@shared/components/ActionToaster'

/**
 * Mounts the action-feedback toaster (toast.success / toast.error, see
 * lib/toast.js) for both portals.
 *
 * ── THE INCIDENT CARD STACK IS GONE (2026-10-19) ───────────────────────────
 * This provider also drew a top-right stack of incident cards — "You have
 * been dispatched", "Acknowledge now", a card per new report — through a
 * `useToast().notify` API. Every one of them restated a row the notification
 * bell already shows live, so they were removed by request: real-time alerts
 * live in ONE place, the bell's feed (NotificationBell + lib/notifications),
 * and the alert sounds (lib/alertSound) are what call an officer to it.
 */
export default function ToastProvider({ children }) {
  return (
    <>
      {children}
      <ActionToaster />
    </>
  )
}
