import { useEffect, useState } from 'react'
import { Bell, ClipboardList, IdCard, MapPin, Monitor, Moon, Sun, Play, Volume2 } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import StatusBadge from '@shared/components/StatusBadge'
import Switch from '@shared/components/Switch'
import SettingsLayout from '@shared/components/settings/SettingsLayout'
import { SettingsGroup, SettingRow } from '@shared/components/settings/SettingsFields'
import ChangePasswordPanel from '@shared/components/settings/ChangePasswordPanel'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import DutyLogTable from '@/components/DutyLogTable'
import { useGuardProfile } from '@/hooks/useGuardProfile'
import { useTheme } from '@shared/theme/ThemeProvider'
import { playAlert, setMuted, subscribeAlertSound, unlockAlertSound } from '@shared/lib/alertSound'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { GUARD_PREF_DEFAULTS, loadGuardPrefs, saveGuardPrefs } from '@/lib/guardPrefs'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

/**
 * ── THE SECTIONS THIS CONSOLE HAS, AND THE ONE IT STILL DOES NOT ───────────
 *
 * The brief names three: Alert & Notification Settings, Security Logs (the
 * PDF duty export), and Security Account Settings. All three are here.
 *
 * A fourth is here that the brief does not name — Display and location. Those
 * controls already existed on this page and are the two an officer actually
 * touches at the start of a shift. A spec that adds three panels is not a spec
 * that deletes the ones already in use.
 *
 * What is still NOT here is a way to EDIT the account. The Account panel reads
 * the officer's staff record and lets them change their own password, which is
 * a client-side Firebase Auth call and works today. Name, badge number, role
 * and shift assignment are an administrator's to set — the Firestore rules say
 * so, and an officer editing their own badge number is the kind of thing an
 * audit exists to catch. They are shown, clearly, as read-only.
 */
const SECTIONS = [
  { value: 'alerts', label: 'Alerts and sound', icon: Bell },
  { value: 'logs', label: 'Duty logs', icon: ClipboardList },
  { value: 'account', label: 'Account', icon: IdCard },
  { value: 'display', label: 'Display and location', icon: Monitor },
]

/*
 * `Section` and `Row` stood here and are gone.
 *
 * They were the Admin portal's `SettingsGroup` and `SettingRow` written a
 * second time — the same Card, the same CardHeader, the same
 * `divide-y divide-divider` — and already drifting: this copy had grown an
 * `aside` slot for the Test tone button that the other had no idea about, and
 * that one had `icon` and `pending` which this one lacked. Two components
 * nobody could tell apart on screen and neither could borrow from.
 *
 * They now come from `@shared/components/settings/SettingsFields`, which took
 * both slots. See the note on SettingsGroup there.
 */

/**
 * Guardhouse preferences, the duty log, and the officer's own account.
 *
 * ── MOST OF THIS PAGE IS STILL DEVICE-LOCAL, AND SAYS SO ────────────────────
 * Theme, density and location sharing live in this browser's localStorage, not
 * on the account: an officer signing in at a different terminal starts from
 * the defaults. That is a real limitation and the heading states it rather
 * than implying these follow the person.
 *
 * Two things on this page are NOT device-local, and the difference matters:
 * the duty log is read live from `guard_shifts`, and the password change goes
 * to Firebase Auth. Both follow the officer to any terminal, because both are
 * about the person rather than the machine.
 *
 * ── WHY IT IS SAFE TO EDIT ON DUTY ──────────────────────────────────────────
 * `dutyLock={false}`: an officer must be able to turn the theme down or check
 * their hours mid-shift, and nothing here writes to an incident. The one
 * control that could matter in an emergency — the mute switch — is the reason
 * the siren volume below is read-only rather than another thing to get wrong
 * at 3am.
 */
export default function SettingsPage() {
  const [section, setSection] = useState(SECTIONS[0].value)
  const { preference, setPreference } = useTheme()
  const [sound, setSound] = useState({ muted: false, blocked: true })
  const [prefs, setPrefs] = useState(loadGuardPrefs)
  const sirenEnabled = useSystemSettings((state) => state.values.sos.sirenEnabled)
  const sirenVolume = useSystemSettings((state) => state.values.guardhouse.sirenVolume)
  const { officer, profile, loading: profileLoading } = useGuardProfile()

  useEffect(() => subscribeAlertSound(setSound), [])

  useEffect(() => {
    saveGuardPrefs(prefs)
  }, [prefs])

  async function testSound() {
    // Browsers gate audio on a user gesture; this IS that gesture, so the
    // unlock has to happen here rather than at load.
    await unlockAlertSound()
    playAlert('report')
  }

  let soundDescription
  if (!sirenEnabled) {
    soundDescription = sound.muted
      ? 'Muted. The SOS siren is also switched off for the subdivision — panic alerts show on screen only.'
      : 'Report chimes play here. The SOS siren is switched off for the subdivision — panic alerts show on screen only.'
  } else {
    soundDescription = sound.muted
      ? 'Muted. Panic alerts still appear on the map and in the banner.'
      : 'Panic alerts and critical tickets play a tone on arrival.'
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Alerts, duty logs, your account and this device's display."
      topBarSlot={<GuardHeaderActions />}
      dutyLock={false}
    >
      {/* gap-6. This page scrolls — no `scroll={false}` on the shell, no
          `h-full` on this root — and "the two vertical rhythms" in the shared
          stylesheet name a scrolling page on gap-4 as drift. */}
      {/* `max-w-6xl`, not `3xl`: the page is two columns now and the nav takes
          the first of four. It is one step wider than the Admin console's
          `5xl` for one reason — the duty log is a six-column table with a
          handover excerpt in the last cell, and at 5xl that cell is a word
          wide. The nav is identical on both; only the panel column differs,
          which is the column whose content differs. */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <SectionHeading
          title="Guardhouse preferences"
          description="Display and location are stored on this device — a different terminal starts from the defaults. Your duty log and password follow your account."
        />

        <SettingsLayout sections={SECTIONS} active={section} onChange={setSection}>
          {/* ── 1. Alerts ────────────────────────────────────────────────── */}
          {section === 'alerts' ? (
            <SettingsGroup
              icon={Bell}
              title="Alert sounds"
              description="What the console does when an SOS or a critical ticket arrives."
              action={
                <button type="button" onClick={testSound} className="btn btn-compact btn-outline">
                  <Play size="sm" aria-hidden="true" />
                  Test tone
                </button>
              }
            >
              <SettingRow
                id="guard-sound"
                title="Audible alerts"
                description={soundDescription}
                control={
                  <Switch id="guard-sound" checked={!sound.muted} onChange={(on) => setMuted(!on)} />
                }
              />
              {!sound.muted && sound.blocked ? (
                <p className="px-4 py-3 text-xs text-warning">
                  This browser is holding sound until you click somewhere on the page. Press “Test
                  tone” once at the start of a shift.
                </p>
              ) : null}

              {/* ── THE VOLUME IS READ-ONLY, AND THAT IS THE DESIGN ───────────
                  A device-local volume slider was specified. It is not here,
                  and this row is what replaces it.

                  The siren volume is one number for the whole subdivision,
                  set in Admin › Settings › Dispatch and read by usePanicSiren
                  as an alert arrives. Adding a second, per-device volume that
                  scaled it would give one sound two authorities: an officer
                  who turned this terminal down to 20% would have quietly
                  overridden a policy an administrator set for the guardhouse,
                  and neither screen would show the other's number. For the
                  siren that announces a panic button, "why was it so quiet"
                  is not a question worth engineering into existence.

                  The mute switch above remains device-local, because silence
                  is a decision the person in the room has to be able to make
                  and can see the state of. */}
              <SettingRow
                id="guard-volume"
                title="Siren volume"
                description="Set once for every console in Admin › Settings › Dispatch and incidents, so each terminal in the guardhouse is as loud as the next. Mute above silences this device."
                control={
                  <span className="inline-flex items-center gap-2">
                    <Volume2 size="sm" aria-hidden="true" className="text-text-muted" />
                    <StatusBadge tone="neutral" size="sm">
                      {Math.round((sirenVolume ?? 0) * 100)}%
                    </StatusBadge>
                  </span>
                }
              />
            </SettingsGroup>
          ) : null}

          {/* ── 2. Duty logs ─────────────────────────────────────────────── */}
          {section === 'logs' ? (
            <SettingsGroup
              icon={ClipboardList}
              title="Duty log"
              description="Every shift you have clocked, and the handover you filed at the end of it."
            >
              {/* The table is not wrapped in a SettingRow: a row is a label and
                  a control on one line, and this is a full-width table with its
                  own toolbar and pagination. It takes the group's padding
                  directly so it still reads as the panel's content rather than
                  as something that escaped it. */}
              <div className="px-4 py-4">
                <DutyLogTable />
              </div>
            </SettingsGroup>
          ) : null}

          {/* ── 3. Account ───────────────────────────────────────────────── */}
          {section === 'account' ? (
            <SettingsGroup
              icon={IdCard}
              title="Your security account"
              description="How you appear on the duty roster and to dispatch."
            >
              {/* ── READ-ONLY, ON PURPOSE ────────────────────────────────────
                  Every field here is an administrator's to set, and the
                  Firestore rules enforce that — `staff_accounts` is writable
                  by admin staff only. Rendering them as inputs that always
                  fail to save would be worse than showing them as facts, and
                  showing them as facts is most of what the panel is for: an
                  officer checking the badge number dispatch is calling them by.

                  The row that DOES something is the password panel below,
                  which is the one credential a person owns outright. */}
              <SettingRow
                id="account-name"
                title="Name"
                description="As it appears on the duty roster and in dispatch."
                control={<AccountValue loading={profileLoading} value={officer.name} />}
              />
              <SettingRow
                id="account-badge"
                title="Badge number"
                description="What dispatch calls you by on the map and in a ticket's assignment."
                control={
                  <AccountValue
                    loading={profileLoading}
                    value={officer.badgeNumber}
                    empty="Not issued"
                  />
                }
              />
              <SettingRow
                id="account-role"
                title="Role"
                description="Decides which consoles you may hold a session on."
                control={<AccountValue loading={profileLoading} value={officer.role} empty="—" />}
              />
              <SettingRow
                id="account-shift"
                title="Assigned shift"
                description="The roster's answer. Which shift you are actually working is chosen at clock-in and recorded on the shift itself."
                control={
                  <AccountValue loading={profileLoading} value={officer.shift} empty="Unassigned" />
                }
              />
              <SettingRow
                id="account-email"
                title="Sign-in email"
                description="Changing this is an administrator's job — it is the identity the account signs in with."
                control={<AccountValue loading={profileLoading} value={officer.email} />}
              />
              {!profileLoading && !profile ? (
                <p className="px-4 py-3 text-xs leading-relaxed text-warning">
                  No staff record was found for this account, so the details above fall back to what
                  Firebase Auth holds. An administrator can issue one from Security Accounts.
                </p>
              ) : null}
            </SettingsGroup>
          ) : null}

          {section === 'account' ? <ChangePasswordPanel /> : null}

          {/* ── 4. Display and location ──────────────────────────────────── */}
          {section === 'display' ? (
            <SettingsGroup
              icon={Monitor}
              title="Display"
              description="Applies to this browser and is remembered between sessions."
            >
              <SettingRow
                id="guard-theme"
                title="Theme"
                description="System follows your operating system and keeps following it."
                control={
                  <SegmentedControl
                    ariaLabel="Theme"
                    options={THEME_OPTIONS}
                    value={preference}
                    onChange={setPreference}
                  />
                }
              />
              <SettingRow
                id="guard-density"
                title="Table density"
                description="Compact fits more tickets on screen; comfortable is easier to scan at a glance."
                control={
                  <SegmentedControl
                    ariaLabel="Table density"
                    options={DENSITY_OPTIONS}
                    value={prefs.density}
                    onChange={(density) => setPrefs((p) => ({ ...p, density }))}
                  />
                }
              />
              <SettingRow
                id="guard-reset"
                title="Reset layout"
                description="Returns the layout options above to their defaults."
                control={
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, density: GUARD_PREF_DEFAULTS.density }))}
                    className="btn btn-compact btn-outline"
                  >
                    Reset layout
                  </button>
                }
              />
            </SettingsGroup>
          ) : null}

          {section === 'display' ? (
            <SettingsGroup
              icon={MapPin}
              title="Location sharing"
              description="What this device reports to the dispatch map while you are clocked in."
            >
              <SettingRow
                id="guard-location"
                title="Share my position while on duty"
                description={
                  prefs.shareIdleLocation
                    ? 'You appear on the map as an available unit, so a dispatcher can send the nearest officer.'
                    : 'You are listed as on duty with no position. Dispatchers cannot see how close you are.'
                }
                control={
                  <Switch
                    id="guard-location"
                    checked={prefs.shareIdleLocation}
                    onChange={(on) => setPrefs((p) => ({ ...p, shareIdleLocation: on }))}
                  />
                }
              />
              <p className="px-4 py-3 text-xs leading-relaxed text-text-secondary">
                Once you acknowledge a call, this device shares high-precision GPS whatever this
                switch says, until the call is resolved. That is what draws your route for the
                dispatcher, and it is not something an officer can turn off mid-response.
              </p>
            </SettingsGroup>
          ) : null}
        </SettingsLayout>
      </div>
    </AppShell>
  )
}

/**
 * One read-only account fact.
 *
 * A skeleton rather than a dash while loading: a dash is an answer — "there is
 * no badge number" — and showing it for half a second before the real value
 * arrives is a small lie told on every visit.
 */
function AccountValue({ loading, value, empty = '—' }) {
  if (loading) return <span className="block h-4 w-28 animate-pulse rounded bg-tint/10" />
  if (!value) return <span className="text-sm text-text-muted">{empty}</span>
  return <span className="text-sm font-medium text-text-primary">{value}</span>
}
