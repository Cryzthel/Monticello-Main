import { useAuth } from '@shared/auth/AuthContext'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import PanicAlertsTable from '@shared/components/PanicAlertsTable'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { acknowledgePanicAlert, resolvePanicAlert } from '@shared/lib/panicAlerts'

/**
 * The guardhouse's emergency log.
 *
 * Separate from the dispatch map on purpose. The map answers "where do I go
 * now" and drops an alert the moment it is resolved; this keeps every SOS ever
 * raised, which is what makes it answerable after the fact.
 */
export default function PanicAlertsPage() {
  const { user } = useAuth()
  const { alerts, liveCount, loading, error } = usePanicAlerts()

  return (
    <AppShell
      title="Panic alerts (SOS)"
      subtitle={
        liveCount > 0
          ? `${liveCount} still live — every SOS ever raised, newest first.`
          : 'Every SOS ever raised, newest first.'
      }
      topBarSlot={<GuardHeaderActions />}
      scroll={false}
    >
      <div className="min-h-0 lg:h-full">
        <PanicAlertsTable
          alerts={alerts}
          loading={loading}
          error={error}
          // Dispatch writes `acknowledged`, which the resident's phone hears
          // about through onPanicAlertDispatched — the push is a server
          // trigger on the document, not something this click sends, so it
          // fires whichever console did the dispatching.
          onDispatch={(alert) => acknowledgePanicAlert(alert.id, user?.displayName)}
          onResolve={(alert) => resolvePanicAlert(alert.id)}
        />
      </div>
    </AppShell>
  )
}
