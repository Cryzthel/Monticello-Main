import { Settings } from '@shared/icons'
import Select from '@shared/components/Select'
import { AUDIT_RETENTION_DAYS } from '@shared/lib/systemSettingsStore'
import TimeZoneSelect from '@/components/TimeZoneSelect'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

/**
 * System: the organisation's time zone and audit retention. Edits the page's
 * draft only; the sticky header's Save commits them. Retention prunes only
 * `provisioning_logs`, and only once the operations sweep is deployed — the
 * row says so rather than implying enforcement it does not have.
 */
export default function SystemSettingsCard({ draft, disabled, setGroup, action }) {
  return (
    <SettingsSection id="system" icon={Settings} title="System" action={action}>
      <SettingsItem
        title="Time zone"
        description="Every date and time in both consoles is shown in this zone, on every open console once saved."
      >
        <TimeZoneSelect
          id="time-zone"
          value={draft.organisation.timeZone}
          disabled={disabled}
          onChange={(timeZone) => setGroup('organisation', { timeZone })}
        />
      </SettingsItem>
      <SettingsItem
        title="Audit history retention"
        description="How long account provisioning records are kept. Applied by the scheduled operations sweep once it is deployed."
      >
        <Select
          ariaLabel="Audit history retention"
          value={String(draft.organisation.auditRetentionDays)}
          disabled={disabled}
          onChange={(next) => setGroup('organisation', { auditRetentionDays: Number(next) })}
          options={AUDIT_RETENTION_DAYS.map((d) => ({
            value: String(d),
            label: d === 0 ? 'Keep indefinitely' : `${d} days`,
          }))}
        />
      </SettingsItem>
    </SettingsSection>
  )
}
