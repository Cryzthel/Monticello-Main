import AppShell from '@/layouts/AppShell'
import AnnouncementsManager from '@/components/AnnouncementsManager'

/**
 * Route wrapper only. All composing, scheduling and feed management lives in
 * AnnouncementsManager — same split as AdminTicketsPage/IncidentsTable, so the
 * workspace can be dropped into another shell (or a modal) without dragging
 * the page chrome along with it.
 */
export default function AnnouncementsPage() {
  return (
    <AppShell
      title="Announcements"
      subtitle="Broadcast messages to every resident, guard, and the mobile app in real time."
      scroll={false}
    >
      <AnnouncementsManager />
    </AppShell>
  )
}
