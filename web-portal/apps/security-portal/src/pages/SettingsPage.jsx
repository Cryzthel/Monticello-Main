import { Link, Navigate, useParams } from 'react-router-dom'
import Card from '@shared/components/Card'
import { ROUTES } from '@/config/portal'
import { useEffect, useState } from 'react'
import { ArrowLeft, Bell, ChevronRight, IdCard, Lock, Monitor, Moon, Sun } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import StatusBadge from '@shared/components/StatusBadge'
import Switch from '@shared/components/Switch'
import { SettingsGroup, SettingRow } from '@shared/components/settings/SettingsFields'
import ChangePasswordPanel from '@shared/components/settings/ChangePasswordPanel'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import DutyLogTable from '@/components/DutyLogTable'
import { useGuardProfile } from '@/hooks/useGuardProfile'
import { useTheme } from '@shared/theme/ThemeProvider'
import { playAlert, setMuted, subscribeAlertSound, unlockAlertSound } from '@shared/lib/alertSound'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { loadGuardPrefs, saveGuardPrefs } from '@/lib/guardPrefs'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
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
/**
 * The settings directory.
 *
 * ── A MENU, NOT A PAGE ─────────────────────────────────────
 * This page has been a tab strip, a sidebar, a scrolling tab row and one
 * continuous scroll. Each of those put every control on screen at once and
 * differed only in how you got around them. A directory is the first version
 * that does not: opening Settings now answers "what can I change" in four
 * lines instead of two screens of forms, and the forms themselves are one tap
 * away in a view with nothing else in it.
 *
 * ── FOUR, WHERE THE BRIEF NAMED THREE ──────────────────────────
 * Account & profile, Security & permissions, Alerts & sound — and `device`,
 * which the brief does not mention and which holds the theme and the
 * on-duty location switch. Both are live, and the location one decides
 * whether a dispatcher can see where this officer is. Dropping a category
 * because a spec listed three rather than four would delete them.
 *
 * `slug` is the URL segment. It is part of the address, so renaming one
 * breaks a bookmark — cheap to change today, not later.
 */
const CATEGORIES = [
  {
    slug: 'account',
    label: 'Account & profile',
    icon: IdCard,
    description: 'Your name, badge number and role, and every shift you have clocked.',
  },
  {
    slug: 'security',
    label: 'Security & permissions',
    icon: Lock,
    description: 'The password you sign in with.',
  },
  {
    slug: 'alerts',
    label: 'Alerts & sound',
    icon: Bell,
    description: 'What this console does when an SOS or a critical ticket arrives.',
  },
  {
    slug: 'device',
    label: 'Display & location',
    icon: Monitor,
    description: 'Theme, and what this device reports to the dispatch map.',
  },
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

  /**
   * ── THE VIEW IS THE URL, NOT STATE ───────────────────────────
   * A `useState` would have been fewer lines and would have broken the three
   * things people actually do with a sub-page: press the browser's back
   * button, reload, and send someone a link to the thing they are looking
   * at. Routing all four costs one param.
   *
   * An unknown slug redirects to the hub rather than rendering an empty
   * shell — a typo'd or renamed URL should land somewhere real.
   */
  const { category } = useParams()
  const active = category ? CATEGORIES.find((c) => c.slug === category) : null

  if (category && !active) return <Navigate to={ROUTES.settings} replace />

  return (
    <AppShell
      title={active ? active.label : 'Settings'}
      subtitle={active ? active.description : 'Your account, alerts, duty logs and this device.'}
      topBarSlot={<GuardHeaderActions />}
      dutyLock={false}
    >
      {/* gap-6. This page scrolls — no `scroll={false}` on the shell, no
          `h-full` on this root — and "the two vertical rhythms" in the shared
          stylesheet name a scrolling page on gap-4 as drift. */}
      {/* `max-w-6xl`, and now the SAME width the Admin console uses.
          It was one step wider than Admin's `5xl` because the nav was a
          sidebar eating a quarter of the page and the duty log — six columns
          with a handover excerpt in the last cell — had a word-wide cell at
          `5xl`. With the nav moved to a tab row across the top, the panels
          get the whole width on both consoles, so the two pages can finally
          be the same object at the same size rather than differing by the
          column one of them needed back. */}
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {active ? (
          <>
            {/* ── SUB-PAGE HEADER ─────────────────────────────────
                A real <Link>, not a button that calls navigate(-1). Back here
                means "up to the hub", which is a fixed destination; history
                back means "wherever you came from", and those differ the
                moment someone arrives on a sub-page from a deep link or
                reloads the tab. A link also gets the browser's own
                affordances free — middle-click, copy address, and a status
                bar that says where it goes. */}
            <div>
              {/* ── NO TITLE HERE. THE SHELL ALREADY DREW IT ───────────────
                  This block used to render an `<h1>` of the category name and
                  its description, while `AppShell` above was being handed the
                  SAME two strings as its title and subtitle. Every sub-page
                  opened with the category name twice and the sentence under it
                  twice — two stacked banners saying one thing.

                  The shell wins, because it is the page header every other
                  screen in the console uses and it stays put. What is left
                  here is the one thing the shell cannot provide: the way
                  back. */}
              <Link
                to={ROUTES.settings}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-base-800 px-4 py-2 text-sm font-medium text-text-secondary shadow-sm transition-[background-color,color,border-color] duration-200 hover:border-slate-300 hover:bg-base-800/60 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <ArrowLeft size="sm" aria-hidden="true" />
                Back to Settings
              </Link>
            </div>

            <div className="flex flex-col gap-4">
              {active.slug === 'account' ? (
                <>
            <SettingsGroup
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
            <SettingsGroup
              title="Duty log"
              description="The handover you filed at the end of each one travels with the export."
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
                </>
              ) : null}

              {active.slug === 'security' ? <ChangePasswordPanel /> : null}

              {active.slug === 'alerts' ? (
            <SettingsGroup
              title="Alert sounds"
              action={
                <button type="button" onClick={testSound} className="btn btn-compact btn-outline">
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
                    <StatusBadge tone="neutral" size="sm">
                      {Math.round((sirenVolume ?? 0) * 100)}%
                    </StatusBadge>
                  </span>
                }
              />
            </SettingsGroup>
              ) : null}

              {active.slug === 'device' ? (
                <>
            <SettingsGroup
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
            </SettingsGroup>
            <SettingsGroup
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
                </>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <SectionHeading
              title="Guardhouse preferences"
              description="Your account and duty log follow you to any terminal. Alerts, display and location are stored on this device."
            />

            {/* ── THE CATEGORY HUB ────────────────────────────────
                One card, one row per category, divided rather than spaced — a
                list of four separate cards reads as four unrelated things,
                and these are four parts of one menu.

                Each row is a LINK and the whole row is the target. A chevron
                you have to hit is a 16px target for a decision the entire
                56px row is about, and on a guardhouse touchscreen that is the
                difference between one tap and three. */}
            <Card className="overflow-hidden p-0">
              <ul className="divide-y divide-divider">
                {CATEGORIES.map((category) => {
                  const Icon = category.icon
                  return (
                    <li key={category.slug}>
                      <Link
                        to={`${ROUTES.settings}/${category.slug}`}
                        className="flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-tint/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                      >
                        <span className="icon-tile icon-tile-sm shrink-0" aria-hidden="true">
                          <Icon size="sm" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-text-primary">
                            {category.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                            {category.description}
                          </span>
                        </span>
                        <ChevronRight
                          size="sm"
                          aria-hidden="true"
                          className="shrink-0 text-text-muted"
                        />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </>
        )}
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
