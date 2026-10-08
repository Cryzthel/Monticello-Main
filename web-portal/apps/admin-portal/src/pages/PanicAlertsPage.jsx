import AppShell from '@/layouts/AppShell'
import PanicAlertsTable from '@shared/components/PanicAlertsTable'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'

/**
 * The administrator's READ-ONLY view of the emergency log.
 *
 * ── THIS REVERSES AN EARLIER, DELIBERATE WIDENING ───────────────────────────
 * Dispatch and Resolve used to be here. They were added on purpose, with the
 * reasoning recorded in this docblock and in firestore.rules: an SOS raised
 * while the guardhouse is unattended should not wait for a guard to sign in
 * before anyone can respond to it.
 *
 * That capability is now withdrawn by request, in favour of a single line of
 * operational authority: the people who physically respond to an emergency are
 * the only ones who record what happened to it. An administrator acknowledging
 * an alert they are not attending puts a name and a timestamp on the record
 * that does not correspond to anyone going anywhere — which is worse than an
 * unacknowledged alert, because it stops looking like it needs a response.
 *
 * THE COST IS REAL AND UNCHANGED. An SOS raised with no guard signed in now
 * has no one who can clear it from any console. That was the exact failure the
 * widening existed to prevent, so if unattended-guardhouse hours are a
 * possibility, the answer is guardhouse coverage or a server-side escalation —
 * not this page.
 *
 * No handlers are passed to PanicAlertsTable, so it drops its actions column
 * entirely rather than showing disabled controls.
 */
export default function PanicAlertsPage() {
  const { alerts, loading, error } = usePanicAlerts()

  return (
    <AppShell
      title="Panic alerts (SOS)"
      scroll={false}
    >
      <div className="min-h-0 lg:h-full">
        <PanicAlertsTable alerts={alerts} loading={loading} error={error} />
      </div>
    </AppShell>
  )
}
