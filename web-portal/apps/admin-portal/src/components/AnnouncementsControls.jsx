import { Plus } from '@shared/icons'
import SearchField from '@shared/components/SearchField'
import SegmentedControl from '@shared/components/SegmentedControl'

/**
 * Search on the left; lifecycle tabs and the Create button on the right.
 *
 * There is no page heading above this row: the shell's top bar already says
 * "Announcements", and the tab counts carry the active/archived totals the
 * heading used to repeat.
 *
 * The tabs are the shared SegmentedControl, so they slide, take arrow keys and
 * carry their counts the way every other view switcher in the console does.
 * `tabs` arrives already filtered: Scheduled only appears while a legacy
 * backlog exists (see AnnouncementsManager).
 *
 * There is no category filter. The table has a Category column, and search
 * matches the category name, so "security" finds security notices without a
 * second control that used to pin the list to ONE category at a time.
 */
export default function AnnouncementsControls({ search, onSearchChange, tabs, tab, onTabChange, counts, onCreate }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <SearchField
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onClear={() => onSearchChange('')}
        placeholder="Search announcements"
        aria-label="Search announcements"
        className="w-full md:max-w-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Filter announcements by status"
          options={tabs.map((t) => ({ value: t.key, label: t.label, count: counts[t.key] }))}
          value={tab}
          onChange={onTabChange}
        />
        <button type="button" onClick={onCreate} className="btn btn-sm btn-brand">
          <Plus size="sm" />
          Create announcement
        </button>
      </div>
    </div>
  )
}
