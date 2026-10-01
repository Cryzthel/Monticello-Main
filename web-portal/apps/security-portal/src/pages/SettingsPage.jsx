import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun, Play } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import Card from '@shared/components/Card'
import CardHeader from '@shared/components/CardHeader'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import Switch from '@shared/components/Switch'
import GuardHeaderActions from '@/components/GuardHeaderActions'
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

function Section({ title, description, aside, children }) {
  return (
    /* `.card` (16px), not `rounded-xl` (12px): 12px is the NESTED tier, for a
       row or a well inside a surface. This is a top-level panel on a page, so
       it takes the surface tier and the panel shadow with it. */
    <Card as="section" className="overflow-hidden p-0">
      <CardHeader title={title} description={description} action={aside} />
      <div className="divide-y divide-slate-100">{children}</div>
    </Card>
  )
}

function Row({ label, description, htmlFor, children }) {
  const LabelTag = htmlFor ? 'label' : 'p'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0 max-w-md">
        <LabelTag htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
          {label}
        </LabelTag>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * Guardhouse display preferences.
 *
 * ── EVERY CONTROL HERE DOES SOMETHING ──────────────────────────────────────
 * The temptation on a settings page is to ship the full grid of toggles a
 * design implies and wire them later. Theme runs through ThemeProvider and the
 * mute switch is the same one the SOS siren reads (see alertSound). Anything
 * that could not be wired was left off rather than added dead — which is why
 * "Activity feed window" is no longer here: the feed it configured came off the
 * Incident Tickets page in the full-width refit.
 *
 * KNOWN GAP, PRE-DATING THAT: "Table density" is stored but not yet consumed.
 * `IncidentsTable`'s `compact` prop is a widget mode (it drops columns, the
 * toolbar and pagination), not a row density, so wiring the preference to it
 * would be wrong; the table needs a real density option first. Called out
 * rather than quietly deleted because the control is wanted, not the stub.
 *
 * ── THE ONE THING A GUARD CANNOT CHANGE ────────────────────────────────────
 * Whether the SOS siren sounds at all is the subdivision's call (Admin ›
 * Settings › Emergency sound alerts). The mute switch here still works for
 * this terminal; when the siren is off for everyone, the copy says so rather
 * than implying this switch is what silenced it.
 *
 * `dutyLock={false}` — a guard has to be able to unmute the console or fix the
 * theme before clocking in, and nothing here writes to an incident.
 */
export default function SettingsPage() {
  const { preference, setPreference } = useTheme()
  const [sound, setSound] = useState({ muted: false, blocked: true })
  const [prefs, setPrefs] = useState(loadGuardPrefs)
  const sirenEnabled = useSystemSettings((state) => state.values.sos.sirenEnabled)

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
      subtitle="Display, alert sounds, location sharing and layout — for this device."
      topBarSlot={<GuardHeaderActions />}
      dutyLock={false}
    >
      {/* gap-6. This page scrolls — no `scroll={false}` on the shell, no
          `h-full` on this root — and "the two vertical rhythms" in the shared
          stylesheet name a scrolling page on gap-4 as drift. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <SectionHeading
          title="Guardhouse preferences"
          description="Stored on this device, not on your account — a different terminal starts from the defaults."
        />

        <Card className="space-y-4 p-4">
          <Section title="Display" description="Applies to this browser and is remembered between sessions.">
            <Row label="Theme" description="System follows your operating system and keeps following it.">
              <SegmentedControl
                ariaLabel="Theme"
                options={THEME_OPTIONS}
                value={preference}
                onChange={setPreference}
              />
            </Row>
          </Section>

          <Section
            title="Alert sounds"
            description="What the console does when an SOS or a critical ticket arrives."
            aside={
              <button type="button" onClick={testSound} className="btn btn-compact btn-outline">
                <Play size="sm" aria-hidden="true" />
                Test tone
              </button>
            }
          >
            <Row label="Audible alerts" htmlFor="guard-sound" description={soundDescription}>
              <Switch id="guard-sound" checked={!sound.muted} onChange={(on) => setMuted(!on)} />
            </Row>
            {!sound.muted && sound.blocked ? (
              <p className="px-4 py-3 text-xs text-warning">
                This browser is holding sound until you click somewhere on the page. Press “Test tone” once at the
                start of a shift.
              </p>
            ) : null}
          </Section>

          <Section
            title="Location sharing"
            description="What this device reports to the dispatch map while you are clocked in."
          >
            <Row
              label="Share my position while on duty"
              htmlFor="guard-location"
              description={
                prefs.shareIdleLocation
                  ? 'You appear on the map as an available unit, so a dispatcher can send the nearest officer.'
                  : 'You are listed as on duty with no position. Dispatchers cannot see how close you are.'
              }
            >
              <Switch
                id="guard-location"
                checked={prefs.shareIdleLocation}
                onChange={(on) => setPrefs((p) => ({ ...p, shareIdleLocation: on }))}
              />
            </Row>
            <p className="px-4 py-3 text-xs leading-relaxed text-text-secondary">
              Once you acknowledge a call, this device shares high-precision GPS whatever this switch says, until
              the call is resolved. That is what draws your route for the dispatcher and the resident. Off duty,
              nothing is shared.
            </p>
          </Section>

          <Section title="Layout" description="How much the working surfaces show at once.">
            {/* "Activity feed window" was here. It set how far back the ticket
                queue's side feed reached, and that feed has been removed — the
                queue is full width now, on the Admin console's layout. A pill
                group configuring a panel that no longer renders is the dead
                switch guardPrefs.js exists to forbid, so it went with it. */}
            <Row
              label="Table density"
              description="Compact fits more tickets on screen; comfortable is easier to scan at a glance."
            >
              <SegmentedControl
                ariaLabel="Table density"
                options={DENSITY_OPTIONS}
                value={prefs.density}
                onChange={(density) => setPrefs((p) => ({ ...p, density }))}
              />
            </Row>
            <Row label="Reset" description="Returns the layout options above to their defaults.">
              <button
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, density: GUARD_PREF_DEFAULTS.density }))}
                className="btn btn-compact btn-outline"
              >
                Reset layout
              </button>
            </Row>
          </Section>
        </Card>
      </div>
    </AppShell>
  )
}
