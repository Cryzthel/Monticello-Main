import { useEffect, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { toast } from '@shared/lib/toast'
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  Mail,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  Volume2,
} from '@shared/icons'
import Pill from '@shared/components/Pill'
import SegmentedControl from '@shared/components/SegmentedControl'
import Switch from '@shared/components/Switch'
import SettingsLayout from '@shared/components/settings/SettingsLayout'
import SettingsSection from '@shared/components/settings/SettingsSection'
import SettingsItem from '@shared/components/settings/SettingsItem'
import SecuritySettingsCard from '@shared/components/settings/SecuritySettingsCard'
import { ROLE_LABELS } from '@shared/auth/roles'
import { useAuth } from '@shared/auth/AuthContext'
import { useTheme } from '@shared/theme/ThemeProvider'
import { playAlert, setMuted, subscribeAlertSound, unlockAlertSound } from '@shared/lib/alertSound'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import AppShell from '@/layouts/AppShell'
import DutyLogTable from '@/components/DutyLogTable'
import { ROUTES } from '@/config/portal'
import { useGuardProfile } from '@/hooks/useGuardProfile'
import { loadGuardPrefs, saveGuardPrefs, subscribeGuardPrefs } from '@/lib/guardPrefs'
import { Skeleton } from '@shared/components/Skeleton'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/*
 * ── THE ADMIN LAYOUT, FOR THE GUARDHOUSE (2026-10-19) ───────────────────────
 * One scrolling page of enclosed cards — Profile, Security, Notifications,
 * System — built from the SAME components as Admin › Settings
 * (@shared/components/settings), so the two consoles are one object. The
 * four-category hub with a sub-page per category is gone: it put a tap and a
 * Back between an officer and every switch.
 *
 * What is left is only what an officer acts on:
 *   • Profile    — who dispatch thinks you are. Read-only: name, badge, role
 *                  and sign-in email are an administrator's to set, and the
 *                  rules enforce it (`staff_accounts` is admin-writable).
 *   • Security   — your password (Firebase Auth, the shared dialog).
 *   • Notifications — audible alerts, and the siren level Admin set.
 *   • System     — theme (this device) and on-duty location sharing.
 *   • Duty log   — your shifts and the PDF export, kept because it is the
 *                  officer's own record and has no other home.
 *
 * ── NOTHING TO SAVE ─────────────────────────────────────────────────────────
 * Unlike Admin's draft of the subdivision's settings, every control here is
 * the officer's own and applies on the spot. Alerts and location sharing are
 * also written to the account (GuardPrefsSync, mounted in the shell), so they
 * reach every console this officer has open. The siren volume is read live
 * from `system_settings/operations`, and the profile live from
 * `staff_accounts/{uid}`.
 */
const SECTIONS = ['profile', 'security', 'notifications', 'system', 'duty-log']

/** The old /settings/<category> sub-pages, sent to the card that holds them now. */
const LEGACY_SLUGS = {
  account: 'profile',
  security: 'security',
  alerts: 'notifications',
  device: 'system',
}

export default function SettingsPage() {
  const location = useLocation()
  const { category } = useParams()

  // An old link lands as /settings#<section>; scroll to the card that holds it.
  useEffect(() => {
    const id = location.hash.slice(1)
    if (SECTIONS.includes(id)) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  if (category) {
    const target = LEGACY_SLUGS[category]
    return <Navigate to={{ pathname: ROUTES.settings, hash: target ? `#${target}` : '' }} replace />
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your account, alerts, and this console."
      stickyHeader
      dutyLock={false}
    >
      <SettingsLayout>
        <ProfileCard />
        <SecuritySettingsCard />
        <NotificationsCard />
        <SystemCard />
        <SettingsSection id="duty-log" icon={ClipboardList} title="Duty log">
          {/* A full-width table with its own toolbar, not a label-and-control
              row, so it sits in the card directly. */}
          <div className="pt-5">
            <DutyLogTable />
          </div>
        </SettingsSection>
      </SettingsLayout>
    </AppShell>
  )
}

/** The officer as dispatch sees them, live from `staff_accounts/{uid}`. */
function ProfileCard() {
  const { officer, profile, loading } = useGuardProfile()
  // The staff record's role, or the one the session was admitted with.
  const { role } = useAuth()
  return (
    <SettingsSection id="profile" icon={UserRound} title="Profile">
      <SettingsItem title="Name" description="As it appears on the duty roster and in dispatch.">
        <AccountValue loading={loading} value={officer.name} />
      </SettingsItem>
      <SettingsItem title="Badge number" description="What dispatch calls you by on the map and in assignments.">
        <AccountValue loading={loading} value={officer.badgeNumber} empty="Not issued" />
      </SettingsItem>
      <SettingsItem title="Role" description="Decides which consoles you may sign in to.">
        {loading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <Pill tone="neutral" icon={ShieldCheck}>
            {ROLE_LABELS[officer.role || role] ?? 'Security staff'}
          </Pill>
        )}
      </SettingsItem>
      <SettingsItem
        title="Sign-in email"
        description="Your administrator manages this address. Ask them to change it."
        align="start"
      >
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-hairline bg-base-900/40 p-3">
          <Mail size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
          {loading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <span className="min-w-0 truncate text-sm font-medium text-text-secondary">{officer.email || '—'}</span>
          )}
        </div>
      </SettingsItem>
      {!loading && !profile ? (
        <p
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs leading-relaxed text-text-primary"
        >
          <AlertTriangle size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
          No staff record was found for this account, so these details come from the sign-in account. An
          administrator can issue one from Security Accounts.
        </p>
      ) : null}
    </SettingsSection>
  )
}

/**
 * Audible alerts (synced to the account) and the siren level, which is one
 * number for every console, set in Admin › Settings and only shown here — a
 * per-device volume would give one alarm two authorities.
 */
function NotificationsCard() {
  const [sound, setSound] = useState({ muted: false, blocked: true })
  const sirenEnabled = useSystemSettings((state) => state.values.sos.sirenEnabled)
  const sirenVolume = useSystemSettings((state) => state.values.guardhouse.sirenVolume)
  const percent = Math.round((sirenVolume ?? 0) * 100)

  useEffect(() => subscribeAlertSound(setSound), [])

  async function testTone() {
    try {
      // Browsers hold audio until a gesture; this press is that gesture.
      await unlockAlertSound()
      playAlert('panic', { volume: sirenVolume })
    } catch (err) {
      console.warn('[settings] test tone failed', err)
      toast.error('Could not play the test tone', { description: 'The browser blocked audio. Click the page and try again.' })
    }
  }

  let description
  if (sound.muted) description = 'Muted on every console you are signed in to. Panic alerts still show on the map.'
  else if (!sirenEnabled) description = 'Report chimes play. The SOS siren is switched off by your administrator.'
  else description = 'Panic alerts and critical tickets play a tone on arrival, on every console you are signed in to.'

  return (
    <SettingsSection id="notifications" icon={Bell} title="Notifications">
      <SettingsItem title="Audible alerts" description={description} labelFor="guard-sound">
        <Switch id="guard-sound" checked={!sound.muted} onChange={(on) => setMuted(!on)} />
      </SettingsItem>
      <SettingsItem
        title="Siren volume"
        description="Set by your administrator for every guardhouse console, so each terminal is as loud as the next."
        align="start"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Volume2 size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
            <div
              role="meter"
              aria-label="Siren volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint/10"
            >
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-text-secondary">
              {percent}%
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={testTone} disabled={sound.muted} className="btn btn-sm btn-outline">
              Test tone
            </button>
            {sound.muted ? (
              <p className="text-xs text-text-muted">Turn on audible alerts to test.</p>
            ) : sound.blocked ? (
              <p className="text-xs text-warning">Sound is held until you press Test tone once this shift.</p>
            ) : null}
          </div>
        </div>
      </SettingsItem>
    </SettingsSection>
  )
}

/** Theme (this device) and on-duty location sharing (synced to the account). */
function SystemCard() {
  const { preference, setPreference } = useTheme()
  const [shareIdle, setShareIdle] = useState(() => loadGuardPrefs().shareIdleLocation)

  useEffect(() => subscribeGuardPrefs((prefs) => setShareIdle(prefs.shareIdleLocation)), [])

  return (
    <SettingsSection id="system" icon={Settings} title="System">
      <SettingsItem title="Theme" description="Applies to this device. System follows your operating system.">
        <SegmentedControl ariaLabel="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
      </SettingsItem>
      <SettingsItem
        title="Share my location on duty"
        labelFor="guard-location"
        description={
          shareIdle
            ? 'You appear on the dispatch map as an available unit, so the nearest officer can be sent. During a call your position is always shared.'
            : 'You are listed as on duty with no position, so dispatch cannot see how close you are. During a call your position is always shared.'
        }
      >
        <Switch
          id="guard-location"
          checked={shareIdle}
          onChange={(on) => saveGuardPrefs({ ...loadGuardPrefs(), shareIdleLocation: on })}
        />
      </SettingsItem>
    </SettingsSection>
  )
}

/**
 * One read-only account fact. A skeleton while loading rather than a dash: a
 * dash is an answer ("no badge number"), and it would be wrong for a moment
 * on every visit.
 */
function AccountValue({ loading, value, empty = '—' }) {
  if (loading) return <Skeleton className="h-4 w-32" />
  if (!value) return <span className="text-sm text-text-muted">{empty}</span>
  return <span className="block truncate text-sm font-medium text-text-primary">{value}</span>
}
