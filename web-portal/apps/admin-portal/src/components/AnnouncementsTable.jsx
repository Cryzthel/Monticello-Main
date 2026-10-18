import {
  Archive,
  ArchiveRestore,
  Eye,
  Megaphone,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Zap,
} from '@shared/icons'
import Card from '@shared/components/Card'
import DataTable, { DataTableEmpty } from '@shared/components/DataTable'
import OverflowMenu from '@shared/components/OverflowMenu'
import StatusBadge from '@shared/components/StatusBadge'
import Tooltip from '@shared/components/Tooltip'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { formatDate, formatDateTime } from '@shared/lib/dates'
import {
  CATEGORY_TONES,
  STATE_META,
  announcementImages,
  announcementState,
  announcementViews,
  categoryLabel,
  goLiveDate,
  timeUntil,
} from '@/lib/announcements'

const COLUMNS = [
  { header: 'Announcement', minWidth: '18rem' },
  { header: 'Status' },
  { header: 'Category' },
  { header: 'Analytics', align: 'right' },
  { header: 'Date' },
  { header: <span className="sr-only">Actions</span>, align: 'right' },
]

function IconButton({ icon: Icon, label, onClick, tone = 'default' }) {
  return (
    <Tooltip side="top" label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-[color,background-color] duration-150 ${
          tone === 'danger'
            ? 'hover:bg-danger/15 hover:text-danger'
            : 'hover:bg-tint/[0.06] hover:text-text-primary'
        }`}
      >
        <Icon size="sm" />
      </button>
    </Tooltip>
  )
}

function AnnouncementRow({ announcement: a, onView, onEdit, onDelete, onPin, onArchive, onPublishNow }) {
  const state = announcementState(a)
  const meta = STATE_META[state]
  const views = announcementViews(a)
  const goLive = goLiveDate(a)
  const thumb = announcementImages(a)[0]
  const category = a.type ?? 'General'
  const title = a.title || 'Untitled announcement'

  const menu = [
    { label: 'View details', icon: Eye, onSelect: () => onView(a) },
    state === 'scheduled' ? { label: 'Publish now', icon: Zap, onSelect: () => onPublishNow(a) } : null,
    {
      label: a.isPinned ? 'Unpin' : 'Pin to top',
      icon: a.isPinned ? PinOff : Pin,
      onSelect: () => onPin(a, !a.isPinned),
    },
    state === 'scheduled'
      ? null
      : {
          label: state === 'archived' ? 'Restore' : 'Archive',
          icon: state === 'archived' ? ArchiveRestore : Archive,
          onSelect: () => onArchive(a, state !== 'archived'),
        },
  ].filter(Boolean)

  return (
    <tr
      onClick={() => onView(a)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onView(a)
        }
      }}
      tabIndex={0}
      aria-label={`${title}, ${meta.label}`}
      className={`data-row h-[4.5rem] cursor-pointer border-t border-divider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
        state === 'archived' ? 'opacity-70' : ''
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-lg border border-hairline object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tint/[0.05] text-text-muted">
              <Megaphone size="sm" />
            </span>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-text-primary">
              {a.isPinned ? (
                <Pin size="sm" className="shrink-0 text-brand-400" aria-label="Pinned" />
              ) : null}
              <span className="truncate">{title}</span>
            </p>
            {a.body ? <p className="line-clamp-1 text-xs text-text-secondary">{a.body}</p> : null}
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        <StatusBadge tone={meta.tone} dot>
          {meta.label}
        </StatusBadge>
      </td>

      <td className="px-4 py-3">
        <StatusBadge tone={CATEGORY_TONES[category] ?? 'neutral'}>{categoryLabel(category)}</StatusBadge>
      </td>

      <td className="px-4 py-3 text-right">
        {/* "—", not 0, while nothing tracks views: an untracked notice has not
            been ignored by every resident. */}
        <span
          className="inline-flex items-center gap-1.5 tabular-nums text-text-secondary"
          title={views == null ? 'View tracking not enabled yet' : `${views.toLocaleString()} resident views`}
        >
          <Eye size="sm" className="shrink-0 text-text-muted" />
          {views == null ? '—' : views.toLocaleString()}
        </span>
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        {goLive ? (
          <span className="text-xs text-text-secondary" title={formatDateTime(goLive)}>
            {formatDate(goLive)}
          </span>
        ) : (
          <span className="text-xs text-text-muted">Not published</span>
        )}
        {state === 'scheduled' ? (
          <span className="block text-2xs text-text-muted">{timeUntil(a.scheduledFor)}</span>
        ) : null}
      </td>

      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(a)} />
          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => onDelete(a)} />
          <OverflowMenu ariaLabel={`More actions for ${title}`} items={menu} />
        </div>
      </td>
    </tr>
  )
}

/**
 * The announcements list as a table, on the shared DataTable frame: sticky
 * header, the table's own scroller, and a minimum width below which it
 * scrolls sideways instead of squeezing the columns.
 *
 * Rows come straight from the page's onSnapshot listener, so a publish,
 * archive, delete or view-count change elsewhere re-renders the affected row
 * with no refresh.
 */
export default function AnnouncementsTable({ rows, loading, emptyMessage, footer, ...handlers }) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <DataTable
        columns={COLUMNS}
        minWidth="56rem"
        colgroup={
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
        }
      >
        {loading ? (
          <SkeletonTableRows
            rows={6}
            columns={[
              { identity: true },
              { variant: 'pill' },
              { variant: 'pill' },
              { width: 'w-10', className: 'text-right' },
              { width: 'w-20' },
              { empty: true },
            ]}
          />
        ) : rows.length === 0 ? (
          <DataTableEmpty colSpan={COLUMNS.length} icon={Megaphone}>
            {emptyMessage}
          </DataTableEmpty>
        ) : (
          rows.map((a) => <AnnouncementRow key={a.id} announcement={a} {...handlers} />)
        )}
      </DataTable>
      {footer ? <div className="border-t border-hairline px-4 py-2">{footer}</div> : null}
    </Card>
  )
}
