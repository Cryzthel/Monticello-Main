import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { toast } from '@shared/lib/toast'
import {
  AlertTriangle,
  Bell,
  Camera,
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
import SaveActions from '@shared/components/settings/SaveActions'
import { ROLE_LABELS } from '@shared/auth/roles'
import { useAuth } from '@shared/auth/AuthContext'
import { useTheme } from '@shared/theme/ThemeProvider'
import { playAlert, setMuted, subscribeAlertSound, unlockAlertSound } from '@shared/lib/alertSound'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import AppShell from '@/layouts/AppShell'
import DutyLogTable from '@/components/DutyLogTable'
import { ROUTES } from '@/config/portal'
import { useGuardProfile } from '@/hooks/useGuardProfile'
import { effectiveSirenVolume, loadGuardPrefs, saveGuardPrefs, subscribeGuardPrefs } from '@/lib/guardPrefs'
import { avatarProblem, uploadAvatar, useStaffAvatar } from '@shared/lib/staffAvatar'
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
 * (@shared/components/settings), so the two consoles are one object.
 *
 *   • Profile    — your photo (editable), and who dispatch thinks you are:
 *                  name, badge, role and sign-in email are an administrator's
 *                  to set, and the rules enforce it.
 *   • Security   — your password (Firebase Auth, the shared dialog).
 *   • Notifications — audible alerts and YOUR siren volume.
 *   • System     — theme and on-duty location sharing.
 *   • Duty log   — your shifts and the PDF export.
 *
 * ── DISCARD AND SAVE, LIKE ADMIN (2026-10-19, by request) ──────────────────
 * Every control edits a DRAFT; the sticky header's Discard / Save changes
 * (the shared SaveActions) commit it or throw it away, and an "Unsaved" pill
 * marks the cards with edits. Saving writes the account at once: the photo to
 * Storage + `users/{uid}.photoUrl`, alerts, volume and location sharing to
 * `users/{uid}.guardPreferences` (GuardPrefsSync), so every console this
 * officer has open follows. The theme PREVIEWS as soon as it is picked, so it
 * can be judged; Discard, or leaving without saving, puts the saved one back.
 */
const SECTIONS = ['profile', 'security', 'notifications', 'system', 'duty-log']

/** Shortest gap between two preview chimes while the volume slider is dragged. */
const PREVIEW_GAP_MS = 180

/** The old /settings/<category> sub-pages, sent to the card that holds them now. */
const LEGACY_SLUGS = {
  account: 'profile',
  security: 'security',
  alerts: 'notifications',
  device: 'system',
}

/**
 * The officer's settings as saved, and the draft over them.
 *
 * `saved` reads the live sources — the alert-sound module, the guard prefs
 * (kept in step with the account by GuardPrefsSync), the theme and the photo
 * listener — so a change made on another console lands here too. `draft`
 * holds only the fields edited on this page, so an untouched field keeps
 * following its live value.
 */
function useGuardSettingsDraft(uid) {
  const { preference, setPreference } = useTheme()
  const adminVolume = useSystemSettings((state) => state.values.guardhouse.sirenVolume)
  const sirenEnabled = useSystemSettings((state) => state.values.sos.sirenEnabled)
  const photoUrl = useStaffAvatar(uid)

  const [sound, setSound] = useState({ muted: false, blocked: true })
  const [prefs, setPrefs] = useState(loadGuardPrefs)
  const [savedTheme, setSavedTheme] = useState(preference)
  const [draft, setDraft] = useState({})
  const [photo, setPhoto] = useState(null) // { file, preview } awaiting Save
  const [saving, setSaving] = useState(false)

  useEffect(() => subscribeAlertSound(setSound), [])
  useEffect(() => subscribeGuardPrefs(setPrefs), [])

  const saved = {
    alertsMuted: sound.muted,
    sirenVolume: prefs.sirenVolume ?? null,
    shareIdleLocation: prefs.shareIdleLocation,
    theme: savedTheme,
  }
  const value = { ...saved, ...draft }
  const changed = (key) => key in draft && draft[key] !== saved[key]
  const dirtyBy = {
    profile: Boolean(photo),
    notifications: changed('alertsMuted') || changed('sirenVolume'),
    system: changed('shareIdleLocation') || changed('theme'),
  }
  const dirty = dirtyBy.profile || dirtyBy.notifications || dirtyBy.system

  // The preview is a blob URL; release it when it is replaced or dropped.
  useEffect(() => () => photo && URL.revokeObjectURL(photo.preview), [photo])

  // Leaving with an unsaved theme preview puts the saved theme back.
  const themeRef = useRef({ previewing: false, savedTheme })
  themeRef.current = { previewing: changed('theme'), savedTheme }
  useEffect(
    () => () => {
      if (themeRef.current.previewing) setPreference(themeRef.current.savedTheme)
    },
    [setPreference],
  )

  // Like Admin: the browser asks before a reload or close drops unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function set(key, next) {
    if (key === 'theme') setPreference(next) // preview at once
    setDraft((prev) => ({ ...prev, [key]: next }))
  }

  function pickPhoto(file) {
    const problem = avatarProblem(file)
    if (problem) {
      toast.error('That photo cannot be used', { description: problem })
      return
    }
    setPhoto({ file, preview: URL.createObjectURL(file) })
  }

  function discard() {
    if (changed('theme')) setPreference(savedTheme)
    setDraft({})
    setPhoto(null)
  }

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    try {
      if (photo && uid) await uploadAvatar(uid, photo.file)
      if (changed('alertsMuted')) setMuted(value.alertsMuted)
      if (changed('sirenVolume') || changed('shareIdleLocation')) {
        saveGuardPrefs({ ...loadGuardPrefs(), sirenVolume: value.sirenVolume, shareIdleLocation: value.shareIdleLocation })
      }
      if (changed('theme')) setSavedTheme(value.theme)
      setDraft({})
      setPhoto(null)
      toast.success('Settings saved', { description: 'Applied on every console you are signed in to.' })
    } catch (err) {
      console.error('[settings] save failed', err)
      toast.error('Could not save your settings', { description: err?.message || 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return {
    value,
    set,
    saving,
    dirty,
    dirtyBy,
    discard,
    save,
    sound,
    sirenEnabled,
    adminVolume,
    effectiveVolume: effectiveSirenVolume({ sirenVolume: value.sirenVolume }, adminVolume),
    photoUrl: photo?.preview ?? photoUrl,
    photoPending: Boolean(photo),
    pickPhoto,
  }
}

const unsavedPill = (on) =>
  on ? (
    <Pill tone="warning" size="sm">
      Unsaved
    </Pill>
  ) : null

export default function SettingsPage() {
  const location = useLocation()
  const { category } = useParams()
  const { user } = useAuth()
  const settings = useGuardSettingsDraft(user?.uid ?? null)

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
      headerActions={
        <SaveActions
          dirty={settings.dirty}
          saving={settings.saving}
          canSave={settings.dirty && !settings.saving}
          onDiscard={settings.discard}
          onSave={settings.save}
        />
      }
    >
      <SettingsLayout>
        <ProfileCard settings={settings} />
        <SecuritySettingsCard />
        <NotificationsCard settings={settings} />
        <SystemCard settings={settings} />
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

/** The officer as dispatch sees them, live from `staff_accounts/{uid}`, plus their photo. */
function ProfileCard({ settings }) {
  const { officer, profile, loading } = useGuardProfile()
  // The staff record's role, or the one the session was admitted with.
  const { role } = useAuth()
  const fileRef = useRef(null)
  const initial = (officer.name || officer.email || '?').trim().charAt(0).toUpperCase()

  return (
    <SettingsSection id="profile" icon={UserRound} title="Profile" action={unsavedPill(settings.dirtyBy.profile)}>
      <SettingsItem
        title="Profile photo"
        description="Shown beside your name in the console. JPG, PNG, WebP or GIF, up to 5 MB."
      >
        <div className="flex items-center gap-4">
          {settings.photoUrl ? (
            <img
              src={settings.photoUrl}
              alt="Your profile photo"
              className={`size-14 shrink-0 rounded-full border object-cover ${settings.photoPending ? 'border-warning' : 'border-hairline'}`}
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-[#047857]"
            >
              {initial}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) settings.pickPhoto(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={settings.saving}
            className="btn btn-sm btn-outline"
          >
            <Camera size="sm" aria-hidden="true" />
            {settings.photoUrl ? 'Change photo' : 'Upload photo'}
          </button>
        </div>
      </SettingsItem>
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
 * Audible alerts and this officer's siren volume, both saved to the account.
 * The volume starts at the console-wide level an administrator set; moving
 * the slider makes it this officer's own, and "Use console level" hands it
 * back.
 */
function NotificationsCard({ settings }) {
  const { value, sound, sirenEnabled, adminVolume, effectiveVolume } = settings
  const percent = Math.round((effectiveVolume ?? 0) * 100)
  const adminPercent = Math.round((adminVolume ?? 0) * 100)
  const muted = value.alertsMuted

  /**
   * ── HEAR THE LEVEL WHILE CHOOSING IT (2026-10-19, by request) ──────────
   * Dragging plays a short chime at the level under the thumb, through the
   * same Web Audio synth the alarms use (lib/alertSound), so what is heard is
   * what will ring. Throttled to one chime per PREVIEW_GAP_MS so a drag does
   * not stack tones, and always once more at the value it lands on. The first
   * press on the slider is the user gesture that unlocks audio.
   */
  const lastPreview = useRef(0)
  const previewAt = (level, force = false) => {
    const now = Date.now()
    if (!force && now - lastPreview.current < PREVIEW_GAP_MS) return
    lastPreview.current = now
    playAlert('report', { volume: level })
  }

  async function testTone() {
    try {
      // Browsers hold audio until a gesture; this press is that gesture.
      await unlockAlertSound()
      playAlert('panic', { volume: effectiveVolume })
    } catch (err) {
      console.warn('[settings] test tone failed', err)
      toast.error('Could not play the test tone', { description: 'The browser blocked audio. Click the page and try again.' })
    }
  }

  let description
  if (muted) description = 'Muted on every console you are signed in to. Panic alerts still show on the map.'
  else if (!sirenEnabled) description = 'Report chimes play. The SOS siren is switched off by your administrator.'
  else description = 'Panic alerts and critical tickets play a tone on arrival, on every console you are signed in to.'

  return (
    <SettingsSection
      id="notifications"
      icon={Bell}
      title="Notifications"
      action={unsavedPill(settings.dirtyBy.notifications)}
    >
      <SettingsItem title="Audible alerts" description={description} labelFor="guard-sound">
        <Switch id="guard-sound" checked={!muted} onChange={(on) => settings.set('alertsMuted', !on)} />
      </SettingsItem>
      <SettingsItem
        title="Alarm volume"
        description={
          value.sirenVolume == null
            ? `Following the console level your administrator set (${adminPercent}%). Move the slider to set your own.`
            : `Your own level, on every console you are signed in to. The console level is ${adminPercent}%.`
        }
        align="start"
      >
        <div className="flex flex-col gap-4">
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
              disabled={muted || settings.saving}
              onPointerDown={() => unlockAlertSound()}
              onKeyDown={() => unlockAlertSound()}
              onChange={(event) => {
                const level = Number(event.target.value) / 100
                settings.set('sirenVolume', level)
                previewAt(level)
              }}
              onPointerUp={(event) => previewAt(Number(event.currentTarget.value) / 100, true)}
              className="h-1.5 flex-1 cursor-pointer accent-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-text-secondary">
              {percent}%
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={testTone} disabled={muted} className="btn btn-sm btn-outline">
              Test tone
            </button>
            {value.sirenVolume != null ? (
              <button
                type="button"
                onClick={() => settings.set('sirenVolume', null)}
                disabled={settings.saving}
                className="text-xs font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                Use console level
              </button>
            ) : null}
            {muted ? (
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

/** Theme (previewed at once) and on-duty location sharing (synced to the account). */
function SystemCard({ settings }) {
  const { value } = settings
  return (
    <SettingsSection id="system" icon={Settings} title="System" action={unsavedPill(settings.dirtyBy.system)}>
      <SettingsItem title="Theme" description="Previews as you pick. Save keeps it on this device; System follows your operating system.">
        <SegmentedControl
          ariaLabel="Theme"
          options={THEME_OPTIONS}
          value={value.theme}
          onChange={(next) => settings.set('theme', next)}
        />
      </SettingsItem>
      <SettingsItem
        title="Share my location on duty"
        labelFor="guard-location"
        description={
          value.shareIdleLocation
            ? 'You appear on the dispatch map as an available unit, so the nearest officer can be sent. During a call your position is always shared.'
            : 'You are listed as on duty with no position, so dispatch cannot see how close you are. During a call your position is always shared.'
        }
      >
        <Switch
          id="guard-location"
          checked={value.shareIdleLocation}
          onChange={(on) => settings.set('shareIdleLocation', on)}
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
