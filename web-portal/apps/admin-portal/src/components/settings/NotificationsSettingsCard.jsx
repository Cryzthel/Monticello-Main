import { Bell, Volume2 } from '@shared/icons'
import Switch from '@shared/components/Switch'
import SettingsItem from '@shared/components/settings/SettingsItem'
import SettingsSection from '@shared/components/settings/SettingsSection'

/**
 * Notifications: the guardhouse siren, resident pushes and alarm volume.
 * Edits the page's draft only; the sticky header's Save commits them.
 */
export default function NotificationsSettingsCard({ draft, disabled, setGroup, onTestSiren, action }) {
  const percent = Math.round(draft.guardhouse.sirenVolume * 100)
  return (
    <SettingsSection id="notifications" icon={Bell} title="Notifications" action={action}>
      <SettingsItem title="Emergency siren" description="Every guardhouse console sounds a siren on a panic alert.">
        <Switch
          id="sos-siren"
          ariaLabel="Emergency siren"
          checked={draft.sos.sirenEnabled}
          disabled={disabled}
          onChange={(sirenEnabled) => setGroup('sos', { sirenEnabled })}
        />
      </SettingsItem>
      <SettingsItem
        title="Resident push notifications"
        description="Residents hear when a unit is dispatched, arrives, and closes their report."
      >
        <Switch
          id="push-enabled"
          ariaLabel="Resident push notifications"
          checked={draft.push.enabled}
          disabled={disabled}
          onChange={(enabled) => setGroup('push', { enabled })}
        />
      </SettingsItem>
      <SettingsItem
        title="Alarm volume"
        description="Level for the SOS siren and alert tones on guardhouse consoles."
        align="start"
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Volume2 size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
            <input
              id="guard-volume"
              type="range"
              aria-label="Alarm volume"
              min={0}
              max={100}
              step={5}
              value={percent}
              disabled={disabled}
              onChange={(event) => setGroup('guardhouse', { sirenVolume: Number(event.target.value) / 100 })}
              style={{ '--fill': `${percent}%` }}
              className="range-slider"
            />
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-text-secondary">{percent}%</span>
          </div>
          <div>
            <button type="button" onClick={onTestSiren} className="btn btn-sm btn-outline">
              Test at this level
            </button>
          </div>
        </div>
      </SettingsItem>
    </SettingsSection>
  )
}
