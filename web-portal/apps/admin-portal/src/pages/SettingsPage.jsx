import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  Building2,
  Check,
  Database,
  Download,
  FileText,
  Home,
  KeyRound,
  Loader2,
  Lock,
  Monitor,
  Plug,
  Radio,
  ShieldAlert,
  Siren,
  Smartphone,
  Ticket,
  Timer,
  Users,
  UserRoundCog,
  Volume2,
  Wrench,
} from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import SettingsLayout from '@shared/components/settings/SettingsLayout'
import { playAlert, unlockAlertSound } from '@shared/lib/alertSound'
import { saveSettings } from '@shared/lib/systemSettings'
import {
  AUDIT_RETENTION_DAYS,
  BACKUP_FREQUENCY_DAYS,
  BACKUP_RETAIN_COPIES,
  MAX_IP_RULES,
  MAX_POLICY_CHARS,
  SESSION_TIMEOUTS_MINUTES,
  TELEMETRY_INTERVALS,
  UPLOAD_LIMITS_MB,
  sanitizeSettings,
  useSystemSettings,
} from '@shared/lib/systemSettingsStore'
import { ROUTES } from '@/config/portal'
import { useSettingsDraft } from '@/hooks/useSettingsDraft'
import {
  ChoiceSetting,
  HotlineEditor,
  NumberSetting,
  PendingNote,
  RuleListEditor,
  SettingRow,
  SettingsGroup,
  SwitchSetting,
  TextAreaSetting,
  TextSetting,
  VolumeSetting,
} from '@shared/components/settings/SettingsFields'
import ChangePasswordPanel from '@shared/components/settings/ChangePasswordPanel'

/**
 * The configuration domains, and which settings this page owns under each.
 *
 * ── IT WAS FOUR, AND IS NOW NINE ──────────────────────────────────────
 * Four domains were right for the settings that existed. Seven more panels
 * were then specified — roles, notifications, security and login, backup and
 * maintenance, change password, display, terms and policies — and three of
 * them had no domain that would hold them without the domain becoming a bin
 * again, which is the exact failure the note below describes.
 *
 * Two things did NOT happen in the expansion, both deliberate:
 *
 *   • Nothing was reorganised out of existence. Every control the four tabs
 *     carried is still here; SOS moved under Notifications and the incident
 *     rules under Dispatch because that is where someone looks for them, and
 *     that is the whole of the churn.
 *
 *   • The brief's seven section names were not adopted as the whole list.
 *     Taken literally they leave the escalation window, the hazard pin
 *     lifetime, the guardhouse telemetry interval, the resident upload cap and
 *     the subdivision profile with nowhere to live. A spec naming the panels
 *     it wants added is not a spec deleting the ones it did not mention.
 *
 * Nine is a lot of nav. It is a sticky sidebar on a desktop and a segmented
 * control on a phone, both of which scale down a list far better than the
 * horizontal track this started as — which is what made the ninth entry
 * affordable at all.
 *
 * ── IT WAS SIX TABS, AND TWO OF THEM WERE NOT DOMAINS ─────────────────
 * "General", "Emergency", "Operations", "Residents", "Security",
 * "Integrations". The first was a bin for whatever did not fit the others, and
 * the last owned no settings at all — it existed to hold one paragraph
 * explaining why provider credentials are NOT stored in this document. A tab
 * is a promise that there is a body of configuration behind it; one paragraph
 * is a row, and it now sits as a row inside Security, where a reader looking
 * for "where do the API keys live" was going to look anyway.
 *
 * The four that remain are the questions an administrator actually arrives
 * with: how does the estate RESPOND, who may OPERATE it, what is the estate and
 * who lives in it, and who may hold a SESSION. Nothing was deleted to get here
 * — every control the six tabs carried is still on this page.
 *
 * ── `keys` IS A LIST OF PATHS, NOT OF GROUPS ───────────────────────
 * It used to be a list of document GROUP keys, which worked only while every
 * group lived on exactly one tab. Two no longer do: `guardhouse` holds both the
 * console's alarm volume (a dispatch mechanic) and whether a shift needs a
 * handover before clock-out (a personnel policy), and `organisation` holds both
 * the subdivision's contact details and how long provisioning records are kept.
 *
 * Splitting the DOCUMENT to match the tabs would have been the wrong half to
 * move — it is a stored schema that the rules, the sanitizer, the guardhouse
 * console and the resident app all read, and reshaping it so a form could draw
 * tabs is the form dictating terms to five consumers. So the paths got finer
 * instead. A dotted path reads one field; a bare one still reads a whole group.
 *
 * This matters because the dirty dot is load-bearing, not decoration: tabs can
 * hide an edit the old stacked page could not, and a dot on the wrong tab sends
 * an administrator hunting through a panel where nothing is actually changed.
 */
const TABS = [
  {
    value: 'roles',
    label: 'Roles & permissions',
    icon: UserRoundCog,
    keys: ['guardhouse.requireHandover'],
  },
  {
    value: 'notifications',
    label: 'Notifications',
    icon: Bell,
    keys: ['sos', 'push'],
  },
  {
    value: 'dispatch',
    label: 'Dispatch & incidents',
    icon: Radio,
    keys: ['incidents', 'guardhouse.sirenVolume', 'guardhouse.telemetryIntervalSeconds'],
  },
  {
    value: 'property',
    label: 'Property & residents',
    icon: Home,
    keys: [
      'organisation.contactEmail',
      'organisation.officeHours',
      'organisation.logoUrl',
      'residentApp',
    ],
  },
  {
    value: 'security',
    label: 'Security & login',
    icon: Lock,
    keys: ['security', 'organisation.auditRetentionDays'],
  },
  { value: 'backup', label: 'Backup & maintenance', icon: Database, keys: ['backup', 'maintenance'] },
  /*
   * NO `keys` — AND THAT IS NOT AN OVERSIGHT.
   *
   * The dirty dot marks a section holding an unsaved edit to the settings
   * DOCUMENT. Change Password edits no part of that document: it calls
   * Firebase Auth directly and commits on its own button, so there is never
   * anything here for the page's Save to carry. A dot that could never light
   * is better absent than permanently dark.
   */
  { value: 'password', label: 'Change password', icon: KeyRound, keys: [] },
  { value: 'display', label: 'Display', icon: Monitor, keys: ['display'] },
  { value: 'policies', label: 'Terms & policies', icon: FileText, keys: ['policies'] },
]

/** Reads `'guardhouse.requireHandover'`, or a bare `'sos'`, off a settings object. */
const at = (settings, path) => path.split('.').reduce((node, key) => node?.[key], settings)

/**
 * Admin settings — the subdivision's operating policy, in one document.
 *
 * ── THIS PAGE HAS BEEN BOTH SIZES ───────────────────────────────────────────
 * It once carried four tabs of configuration, was cut back by request to the
 * two switches that were actually wired to something, and has now been rebuilt
 * as a full suite. The lesson from the first round is kept: every control here
 * either does something today, or SAYS on its own row that it does not yet.
 * The page is not allowed to imply enforcement it does not have — PRODUCT.md's
 * fourth principle, and the reason the cut happened in the first place.
 *
 * ── WHAT "NOT YET" MEANS ────────────────────────────────────────────────────
 * Firebase is on the Spark plan, so Cloud Functions cannot deploy. Anything
 * needing a server-side timer, a write trigger or a scheduled sweep is stored
 * and read back faithfully, but nothing acts on it until billing is enabled
 * and the functions ship. `systemSettingsStore.js` records which is which per
 * field; `PendingNote` puts it on the screen.
 *
 * ── ONE DRAFT, ONE SAVE ─────────────────────────────────────────────────────
 * Every group edits one draft of the whole settings object and commits in a
 * single write. Nothing auto-saves: these values reach live guardhouse
 * consoles the moment they land, and a half-typed escalation window is not
 * something to broadcast.
 */
export default function SettingsPage() {
  const saved = useSystemSettings((state) => state.values)
  const status = useSystemSettings((state) => state.status)
  const loadError = useSystemSettings((state) => state.error)
  const meta = useSystemSettings((state) => state.meta)

  // The draft is the whole settings object, already sanitized — so what the
  // form holds is always a shape the document will accept.
  const value = useMemo(() => sanitizeSettings(saved), [saved])

  const onSave = useCallback((draft) => saveSettings(sanitizeSettings(draft)), [])
  const form = useSettingsDraft({ value, onSave })
  const { draft } = form

  const settled = status === 'live' || status === 'default' || status === 'error'
  const disabled = !settled || form.saving
  const [confirmingSilence, setConfirmingSilence] = useState(false)
  const [tab, setTab] = useState(TABS[0].value)

  // Compared as JSON because a settings group is plain Firestore data —
  // primitives and one array of hotlines — so a key-by-key Object.is would
  // report the hotline list as changed on every render.
  const tabOptions = useMemo(
    () =>
      TABS.map(({ value: id, label, icon, keys }) => ({
        value: id,
        label,
        icon,
        count: keys.some((k) => JSON.stringify(at(draft, k)) !== JSON.stringify(at(value, k)))
          ? '•'
          : undefined,
      })),
    [draft, value],
  )

  /** Groups are replaced whole, so a patch never drops a sibling field. */
  const setGroup = useCallback(
    (group, patch) => form.update({ [group]: { ...form.draft[group], ...patch } }),
    [form],
  )

  // Silencing the siren for every console is the one change here that can make
  // an emergency go unheard, so it is confirmed at save time.
  function submit(event) {
    event.preventDefault()
    if (!form.dirty || form.saving) return
    if (value.sos.sirenEnabled && !draft.sos.sirenEnabled) setConfirmingSilence(true)
    else form.save()
  }

  /**
   * The manual snapshot.
   *
   * Exports the SAVED document, not the draft — a backup of an unsaved form is
   * a backup of something that was never the system's state, and restoring it
   * later would reinstate a decision nobody made. The file is built from a
   * Blob and revoked immediately; nothing is uploaded.
   */
  function snapshotNow() {
    const payload = {
      exportedAt: new Date().toISOString(),
      source: 'system_settings/operations',
      note: 'Operating settings only. Incident, resident and shift records are not included — a full database export is a server-side job.',
      settings: value,
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    )
    const stamp = new Date().toISOString().slice(0, 10)
    const link = document.createElement('a')
    link.href = url
    link.download = `monticello-settings-${stamp}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function testSiren() {
    await unlockAlertSound()
    playAlert('panic', { volume: draft.guardhouse.sirenVolume })
  }

  return (
    <AppShell title="Settings" subtitle="How the subdivision is alerted, dispatched and governed.">
      <form onSubmit={submit} aria-busy={!settled} className="flex w-full max-w-5xl flex-col gap-6">
        {status === 'error' ? (
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm leading-relaxed text-text-primary"
          >
            <AlertTriangle size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
            <span>
              <span className="font-semibold text-warning">Saved settings could not be loaded.</span> Every control
              is showing its default{loadError ? ` (Firestore: ${loadError})` : ''}. If the settings rules were just
              changed, deploy them with{' '}
              <code className="code-pill">firebase deploy --only firestore:rules</code>.
            </span>
          </p>
        ) : null}
        {/* ── Section navigation ───────────────────────────────────────── */}
        {/* Seven groups down one scroll was the whole problem: the page was a
            list you read rather than a console you operate, and the two
            settings an administrator actually came for were never both on
            screen. The groups are unchanged — this only decides which are
            mounted.

            THE DIRTY DOT IS NOT DECORATION. Tabs can hide an edit the stacked
            page could not: change a field, switch section, and the save bar
            insists something is unsaved with nothing on screen to show for it.
            The dot marks which section holds it. One draft still spans every
            section, and Save still writes the whole document in one go —
            switching is not a commit and does not discard anything.

            The horizontal track became `SettingsLayout`, which is the same
            frame the Security console's settings now use: a sticky list beside
            the panels on a desktop, the same segmented control on a phone.
            `tabOptions` is unchanged and feeds it directly, dot included. */}
        <SettingsLayout
          sections={tabOptions}
          active={tab}
          onChange={setTab}
          aside={<SaveFooter form={form} settled={settled} meta={meta} status={status} />}
        >
        {/* ── 1. SOS ───────────────────────────────────────────────────── */}
        {tab === 'notifications' ? (
          <SettingsGroup
            icon={Siren}
            title="SOS and panic button"
            description="What happens between a resident pressing the button and an officer arriving."
          >
            <SwitchSetting
              id="sos-siren"
              title="Emergency sound alerts"
              description="The siren every guardhouse console sounds when a resident presses the panic button."
              checked={draft.sos.sirenEnabled}
              disabled={disabled}
              onChange={(sirenEnabled) => setGroup('sos', { sirenEnabled })}
            />

            <NumberSetting
              id="sos-escalate"
              title="Auto-escalation window"
              description="How long an unacknowledged SOS waits before escalating to secondary administrators."
              value={draft.sos.escalateAfterMinutes}
              min={1}
              max={10}
              unit="minutes"
              disabled={disabled}
              onChange={(next) => setGroup('sos', { escalateAfterMinutes: Number(next) })}
              pending="The scheduled sweep stamps an alert nobody has acknowledged within this window, so both consoles can show it went unattended. Written and tested, but it cannot deploy on the current plan."
            />

            <SwitchSetting
              id="sos-geofence"
              title="Geofence boundary alert"
              description="Flag an SOS whose reported position falls outside the registered subdivision boundary, on the guardhouse alert and in the SOS list."
              checked={draft.sos.geofenceAlert}
              disabled={disabled}
              onChange={(geofenceAlert) => setGroup('sos', { geofenceAlert })}
            />

            <HotlineEditor
              value={draft.sos.hotlines}
              disabled={disabled}
              onChange={(hotlines) => setGroup('sos', { hotlines })}
            />
          </SettingsGroup>
        ) : null}

        {/* ── 2. Incidents ─────────────────────────────────────────────── */}
        {tab === 'dispatch' ? (
          <SettingsGroup
            icon={Ticket}
            title="Incident and hazard rules"
            description="How reports are routed, how fast they are expected to move, and how long hazards stay on the map."
          >
            <SwitchSetting
              id="incident-autoassign"
              title="Automatic assignment"
              description="Route a new report to an on-duty officer from the shift roster instead of waiting for an admin to dispatch it."
              checked={draft.incidents.autoAssign}
              disabled={disabled}
              onChange={(autoAssign) => setGroup('incidents', { autoAssign })}
              pending="Stored, not yet acted on: assigning on arrival needs a Firestore write trigger."
            />

            <NumberSetting
              id="incident-ack"
              title="Acknowledgement target"
              description="How quickly a new report should be picked up. Drives the overdue marker on the dispatch drawer."
              value={draft.incidents.ackTargetMinutes}
              min={1}
              max={120}
              unit="minutes"
              disabled={disabled}
              onChange={(next) => setGroup('incidents', { ackTargetMinutes: Number(next) })}
              pending="The scheduled sweep flags reports that miss this target and publishes the totals. The report drawer's own overdue marker still uses its built-in threshold. The sweep cannot deploy on the current plan."
            />

            <NumberSetting
              id="incident-resolve"
              title="Resolution target"
              description="How long a report may stay open before it counts as breaching its target."
              value={draft.incidents.resolveTargetHours}
              min={1}
              max={336}
              unit="hours"
              disabled={disabled}
              onChange={(next) => setGroup('incidents', { resolveTargetHours: Number(next) })}
              pending="The scheduled sweep flags reports still open past this target and publishes the totals. It cannot deploy on the current plan."
            />

            <NumberSetting
              id="hazard-ttl"
              title="Hazard pin lifetime"
              description="How long an open hazard pin stays current before it needs re-verifying. Measured from when it was reported."
              value={draft.incidents.hazardTtlHours}
              min={1}
              max={720}
              unit="hours"
              disabled={disabled}
              onChange={(next) => setGroup('incidents', { hazardTtlHours: Number(next) })}
              pending="Used by the scheduled sweep to file away reports that have been RESOLVED for this long. It does NOT hide anything: the hazard map draws every open report whatever its age, because one that ages out of the queue is one nobody is coming to fix. Archiving cannot deploy on the current plan."
            />
          </SettingsGroup>
        ) : null}

        {/* ── 3. Guardhouse ────────────────────────────────────────────── */}
        {tab === 'dispatch' ? (
          <SettingsGroup
            icon={Radio}
            title="Guardhouse console"
            description="Defaults for the consoles officers work from."
          >
            <VolumeSetting
              id="guard-volume"
              title="Alarm volume"
              description="Default level for the SOS siren and alert tones on a guardhouse console."
              value={draft.guardhouse.sirenVolume}
              disabled={disabled}
              onChange={(sirenVolume) => setGroup('guardhouse', { sirenVolume })}
              footnote={
                <button type="button" onClick={testSiren} className="btn btn-sm btn-outline">
                  <Volume2 size="sm" aria-hidden="true" />
                  Test at this level
                </button>
              }
            />

            <ChoiceSetting
              id="guard-telemetry"
              title="Location ping interval"
              description="How often an on-duty officer's console reports its position to the dispatch map."
              value={draft.guardhouse.telemetryIntervalSeconds}
              options={TELEMETRY_INTERVALS.map((s) => ({ value: String(s), label: `Every ${s} seconds` }))}
              disabled={disabled}
              onChange={(next) => setGroup('guardhouse', { telemetryIntervalSeconds: Number(next) })}
            />
          </SettingsGroup>
        ) : null}

        {/* ── Personnel and access ───────────────────────────── */}
        {tab === 'roles' ? (
          <SettingsGroup
            icon={Users}
            title="Personnel and access"
            description="Policy that applies to every officer. Individual accounts are managed elsewhere."
          >
            {/* ── THIS TAB IS MOSTLY A SIGNPOST, ON PURPOSE ───────────────
                Role assignment, shift history and authorisation levels were
                asked for here, and they are already a whole page: Security
                accounts, with a provisioning flow, a credential handoff, an
                access-role filter and its own audit log. Rebuilding any of it
                on this page would make two write surfaces for one set of
                documents, which is how two screens end up disagreeing about
                who is suspended.

                What belongs HERE is what a settings page is for: the policy
                that applies to everyone, rather than the record of one person.
                Today that is one switch. A tab with one switch and a clear
                pointer is worth more than a tab that pretends to be the
                directory and is not. */}
            <SwitchSetting
              id="guard-handover"
              title="Shift handover required"
              description="Officers must file a duty log before they can clock out of a shift. With this off, clocking out is a single confirmation."
              checked={draft.guardhouse.requireHandover}
              disabled={disabled}
              onChange={(requireHandover) => setGroup('guardhouse', { requireHandover })}
            />

            <SettingRow
              id="accounts-link"
              title="Guard logins, roles and shift history"
              description="Who holds a credential, which access role it carries, whether it is active or suspended, and every shift that has been worked. Only a super admin may change them."
              control={
                <Link to={ROUTES.securityAccounts} className="btn btn-sm btn-outline">
                  <Users size="sm" aria-hidden="true" />
                  Security accounts
                </Link>
              }
            />

            <SettingRow
              id="credentials-link"
              title="Resetting a password"
              description="A guard credential is reset from the directory, which issues a one-time handoff. An administrator resets their own password from the sign-in page — neither console can read or set a password directly."
              control={<Lock size="sm" aria-hidden="true" className="text-text-muted" />}
            />
          </SettingsGroup>
        ) : null}

        {/* ── 4. Resident app ──────────────────────────────────────────── */}
        {tab === 'property' ? (
          <SettingsGroup
            icon={Smartphone}
            title="Resident app"
            description="Limits and gates on what residents can send."
          >
            <NumberSetting
              id="resident-rate"
              title="Reports per hour"
              description="How many non-emergency reports one resident may file in an hour."
              value={draft.residentApp.reportsPerHour}
              min={1}
              max={50}
              unit="per hour"
              disabled={disabled}
              onChange={(next) => setGroup('residentApp', { reportsPerHour: Number(next) })}
              pending="Advisory only: the app can refuse, but a limit that cannot be bypassed has to be counted on the server."
            />

            <ChoiceSetting
              id="resident-upload"
              title="Attachment size limit"
              description="Largest photo or video a resident may attach to a report."
              value={draft.residentApp.maxUploadMb}
              options={UPLOAD_LIMITS_MB.map((mb) => ({ value: String(mb), label: `${mb} MB` }))}
              disabled={disabled}
              onChange={(next) => setGroup('residentApp', { maxUploadMb: Number(next) })}
              pending="Enforced in the guardhouse uploader before a file is sent. Storage rules would make it unbypassable."
            />

            <SwitchSetting
              id="resident-verify"
              title="Verification required for SOS"
              description="A newly registered household must be approved by an administrator before the panic button unlocks."
              checked={draft.residentApp.requireVerificationForSos}
              disabled={disabled}
              onChange={(requireVerificationForSos) =>
                setGroup('residentApp', { requireVerificationForSos })
              }
              pending="Stored, not yet acted on: the mobile app does not read this gate yet."
            />
          </SettingsGroup>
        ) : null}

        {/* ── 5. Organisation ──────────────────────────────────────────── */}
        {tab === 'property' ? (
          <SettingsGroup
            icon={Building2}
            title="Subdivision profile"
            description="Who residents reach, and what both consoles are branded as."
          >
            <TextSetting
              id="org-email"
              title="Contact email"
              description="Shown in the sidebar of both consoles so staff on shift can reach the office."
              value={draft.organisation.contactEmail}
              placeholder="hoa@monticellovillas.ph"
              type="email"
              disabled={disabled}
              onChange={(contactEmail) => setGroup('organisation', { contactEmail })}
            />

            <TextSetting
              id="org-hours"
              title="Office hours"
              description="Shown beside the contact email in both consoles."
              value={draft.organisation.officeHours}
              placeholder="Mon–Fri, 8:00–17:00"
              disabled={disabled}
              onChange={(officeHours) => setGroup('organisation', { officeHours })}
            />

            <TextSetting
              id="org-logo"
              title="Broadcast header logo"
              description="Replaces the MV mark in both consoles’ sidebars. Falls back to MV if the image cannot load."
              value={draft.organisation.logoUrl}
              placeholder="https://…"
              type="url"
              disabled={disabled}
              onChange={(logoUrl) => setGroup('organisation', { logoUrl })}
            />

            {/* ── THE PHASE / BLOCK / LOT DIRECTORY IS NOT CONFIGURATION ────
                An editor for it was asked for on this page. It cannot be one
                yet, and the reason is worth stating on screen rather than
                leaving an administrator to conclude the feature is missing.

                The directory is not in Firestore. It is Dart source —
                `lib/features/property/data/` — compiled into the resident app,
                which is what reads it when somebody picks their address. A web
                form writing a Firestore copy would change what these consoles
                show and change NOTHING on a single resident's phone until the
                next app release, so the two would disagree about what Block 7
                is for however long that took. Moving the directory to Firestore
                and teaching the app to read it remotely is the real piece of
                work, and it is a mobile release, not a settings form.

                The BOUNDARY is already shared the right way round, which is
                what makes the above a choice rather than an oversight: one
                GeoJSON file at the repository root, read by the Flutter app as
                a bundled asset and by both consoles through the `@geo` alias.
                One file, two platforms. */}
            <SettingRow
              id="subdivision-directory"
              title="Phase, block and lot directory"
              description="Held in the resident app's own source and compiled into each release, not in this document — so it is changed by shipping an app build, not from here. Resident records that reference it are in Residents."
              control={
                <Link to={ROUTES.residents} className="btn btn-sm btn-outline">
                  <Home size="sm" aria-hidden="true" />
                  Residents
                </Link>
              }
            />
          </SettingsGroup>
        ) : null}

        {/* ── Integrations ─────────────────────────────────────────────── */}
        {/* ── 6. Security and authentication ──────────────────────── */}
        {tab === 'security' ? (
          <SettingsGroup
            icon={Lock}
            title="Security and authentication"
            description="Who may hold a session on this console, and for how long."
          >
            {/* ── THE ONE CONTROL ON THIS PAGE THAT NEEDS NO BACKEND ────────
                Almost everything else here wants a Cloud Function and carries a
                "stored, not yet acted on" note because Functions cannot deploy
                on the Spark plan. This one guards a BROWSER TAB, the browser is
                where that has to happen, and `signOut` is a client call — so it
                takes effect the moment it is saved. See IdleSignOut. */}
            <ChoiceSetting
              id="session-timeout"
              title="Sign out when idle"
              description="How long this console may sit untouched before it signs itself out. A minute's warning is given first, so an unsaved draft is not lost without being offered back."
              value={draft.security.sessionTimeoutMinutes}
              options={SESSION_TIMEOUTS_MINUTES.map((m) => ({
                value: String(m),
                label: m === 0 ? 'Never' : `After ${m} minutes`,
              }))}
              disabled={disabled}
              onChange={(next) => setGroup('security', { sessionTimeoutMinutes: Number(next) })}
            />

            <SettingRow
              id="session-scope"
              title="Guardhouse consoles are not signed out"
              description="A guardhouse terminal is meant to sit watching the map with nobody touching it, so idle is its normal state — and signing it out would take the SOS siren off the air. This policy covers administrator sessions only."
              control={<Timer size="sm" aria-hidden="true" className="text-text-muted" />}
            />

            {/* ── MFA IS STATED, NOT TOGGLED ─────────────────────────
                A "Require MFA" switch was asked for and is not here, because
                this console cannot enrol a factor: Firebase only adds one
                through the Admin SDK or the Firebase console, on a project
                running Identity Platform with the TOTP provider enabled (see
                shared/lib/twoFactor.js). A switch that cannot enrol, cannot
                un-enrol and cannot refuse a sign-in would be a claim about
                enforcement this page does not have — PRODUCT.md's fourth
                principle, and the reason this page was once cut in half.

                What IS true is worth saying: an account that already has a
                factor is challenged for its 6-digit code at sign-in on BOTH
                portals, and that path is built and live. */}
            <SettingRow
              id="mfa"
              title="Two-factor authentication"
              description="An account with an authenticator app enrolled is asked for its 6-digit code at sign-in, on both portals. Enrolment is done in Firebase, not here — nothing in either console can add or remove a factor."
              control={<ShieldAlert size="sm" aria-hidden="true" className="text-text-muted" />}
            />

            {/* ── THE POLICY, WHICH IS A DIFFERENT THING FROM THE GATE ──────
                The row above says what the system DOES. This one records what
                the HOA has DECIDED, and the two are deliberately separate
                controls rather than one switch pretending to be both.

                It is written as "expected of", not "required for", because the
                second would be a lie the moment someone without a factor signs
                in successfully — which they can, and will, until the enrolment
                path exists. Recording the policy is still worth doing: it is
                what an auditor asks for, and it is what the eventual blocking
                function will read instead of being invented then. */}
            <SwitchSetting
              id="mfa-policy"
              title="Expect two-factor on administrator accounts"
              description="Records the HOA's policy and nothing more. Accounts without a factor are not refused — no part of either console can refuse them."
              checked={draft.security.requireMfaForAdmins}
              disabled={disabled}
              onChange={(requireMfaForAdmins) => setGroup('security', { requireMfaForAdmins })}
              pending="Enforcement needs an Identity Platform blocking function, which cannot deploy on the Spark plan. Enrolment is done in the Firebase console either way."
            />

            {/* ── IP RESTRICTIONS, AND WHY THE NOTE IS BLUNTER THAN USUAL ───
                Most pending notes here say "stored, not yet acted on", which
                implies the backend is the only missing piece. For this one the
                browser is structurally the wrong place: a client cannot refuse
                itself entry by address, and a list of allowed IPs sitting in a
                document the client reads is a statement of intent, not a
                control. Saying so plainly is the point — an administrator who
                believes they have locked the console to the guardhouse's
                address has been actively misled, which is worse than a feature
                that is merely absent. */}
            <RuleListEditor
              title="IP access restrictions"
              description="Addresses or CIDR blocks the consoles are meant to be reachable from. One entry per line — 203.0.113.4, or 203.0.113.0/24."
              value={draft.security.ipAllowlist}
              max={MAX_IP_RULES}
              placeholder="203.0.113.0/24"
              addLabel="Add address"
              emptyNote="No restrictions. Both consoles are reachable from any address, which is what happens today regardless of this list."
              disabled={disabled}
              onChange={(ipAllowlist) => setGroup('security', { ipAllowlist })}
              pending="Not enforced, and not enforceable from a browser: a client cannot turn itself away by address. This takes effect only once App Check or a blocking function reads it, both of which need the Blaze plan."
            />

            {/* ── RETENTION IS A SECURITY CONTROL, NOT A PROFILE FIELD ─────
                It sat in "Subdivision profile" beside the contact email and the
                sidebar logo, which are the three things an administrator edits
                once and never thinks about again. How long a record of who was
                issued a credential is kept is not that: it is a governance
                decision with a legal shape, and it belongs beside the other
                questions about who may hold access to what. */}
            <ChoiceSetting
              id="org-retention"
              title="Audit history retention"
              description="How long Security Account provisioning records are kept."
              value={draft.organisation.auditRetentionDays}
              options={AUDIT_RETENTION_DAYS.map((d) => ({
                value: String(d),
                label: d === 0 ? 'Keep indefinitely' : `${d} days`,
              }))}
              disabled={disabled}
              onChange={(next) => setGroup('organisation', { auditRetentionDays: Number(next) })}
              pending="The scheduled sweep deletes Security Account provisioning records past this window. Audit History is not trimmed and never will be: it is built from the incident and announcement documents themselves, so a retention policy there would delete the records rather than a log. Deleting cannot deploy on the current plan."
            />
          </SettingsGroup>
        ) : null}

        {tab === 'notifications' ? (
          <SettingsGroup
            icon={Plug}
            title="Notification providers"
            description="Where the SMS and push credentials live."
          >
            <SettingRow
              id="integrations"
              title="Provider credentials are not stored here"
              description="Firebase Cloud Messaging, Twilio and Semaphore keys are held as Cloud Functions secrets and injected at run time."
            >
              {/*
                THIS IS A DELIBERATE OMISSION, NOT A MISSING FEATURE.

                The brief asked for API credential fields on this page. Putting
                them here would write third-party secrets into
                `system_settings/operations` — a document every approved staff
                account can READ, which is every guard on every console. A key
                that bills the HOA, or sends SMS in its name, would be one
                devtools panel away from anyone who has ever been issued a
                guardhouse login.

                The project already does this correctly elsewhere: the OTP mailer
                takes SMTP_USER and SMTP_PASS through
                `functions.runWith({ secrets: [...] })`, so the value never
                reaches a client. New providers belong in the same place.

                The Firestore rules were written to make the wrong version hard
                to reintroduce: `organisation` accepts four named string keys, so
                a future `smsApiKey` is refused by the database, not just absent
                from this form.
              */}
              <div className="mt-3 rounded-lg border border-hairline bg-base-800 p-4">
                <p className="text-xs leading-relaxed text-text-secondary">
                  Storing them in this document would put them in reach of every account that can read settings —
                  which is every guardhouse console. Set them where the OTP mailer already keeps its SMTP
                  credentials:
                </p>
                <p className="mt-2">
                  <code className="code-pill">firebase functions:secrets:set TWILIO_AUTH_TOKEN</code>
                </p>
                <PendingNote>
                  Secrets are read by Cloud Functions at run time, so a new provider also needs a functions deploy —
                  which is blocked until billing is enabled.
                </PendingNote>
              </div>
            </SettingRow>
          </SettingsGroup>
        ) : null}

        {/* ── Notifications + save ─────────────────────────────────────── */}
        {tab === 'notifications' ? (
          <SettingsGroup
            icon={ShieldAlert}
            title="Resident notifications"
            description="Phone alerts about a resident's own reports."
          >
            <SwitchSetting
              id="push-enabled"
              title="Push notifications"
              description="Told when a unit is dispatched, arrives on site, and when the report is closed."
              checked={draft.push.enabled}
              disabled={disabled}
              onChange={(enabled) => setGroup('push', { enabled })}
            />
            <SettingRow
              id="push-lock"
              title="SOS alarms always send"
              description="The alarm to on-duty officers is not covered by the switch above — it is the alarm itself."
              control={<Lock size="sm" aria-hidden="true" className="text-text-muted" />}
            />
          </SettingsGroup>
        ) : null}

        {/* ── 8. Backup ────────────────────────────────────────────────── */}
        {tab === 'backup' ? (
          <SettingsGroup
            icon={Database}
            title="Database backup"
            description="How often the subdivision's records are copied, and how many copies are kept."
          >
            <ChoiceSetting
              id="backup-frequency"
              title="Scheduled snapshot"
              description="How often the export runs without anyone asking."
              value={draft.backup.frequencyDays}
              options={BACKUP_FREQUENCY_DAYS.map((d) => ({
                value: String(d),
                label:
                  d === 0 ? 'Only when asked' : d === 1 ? 'Every day' : `Every ${d} days`,
              }))}
              disabled={disabled}
              onChange={(next) => setGroup('backup', { frequencyDays: Number(next) })}
              pending="The scheduled export is a Cloud Function writing to Cloud Storage and cannot deploy on the Spark plan. The manual snapshot below works today."
            />
            <ChoiceSetting
              id="backup-retain"
              title="Snapshots kept"
              description="Older exports past this count are deleted on the next run."
              value={draft.backup.retainCopies}
              options={BACKUP_RETAIN_COPIES.map((n) => ({ value: String(n), label: `${n} copies` }))}
              disabled={disabled}
              onChange={(next) => setGroup('backup', { retainCopies: Number(next) })}
              pending="Pruning happens on the same scheduled run."
            />

            {/* ── THE ONE CONTROL IN THIS PANEL THAT WORKS TODAY ────────────
                It exports what this administrator can ALREADY read, straight
                to their own machine — no function, no Storage bucket, no
                billing. That is also its limit, and the copy says so: it is a
                snapshot of the operating settings, not of the incident and
                resident collections, because walking those from a browser
                would be thousands of billed reads and a file the tab would
                struggle to hold. A real database export is a server's job. */}
            <SettingRow
              id="backup-now"
              title="Create a snapshot now"
              description="Downloads the current operating settings as a JSON file, from this browser. Nothing is uploaded and nothing leaves this machine."
              control={
                <button
                  type="button"
                  onClick={snapshotNow}
                  disabled={!settled}
                  className="btn btn-sm btn-outline"
                >
                  <Download size="sm" aria-hidden="true" />
                  Download
                </button>
              }
            />
          </SettingsGroup>
        ) : null}

        {tab === 'backup' ? (
          <SettingsGroup
            icon={Wrench}
            title="Maintenance mode"
            description="Tells everyone the system is being worked on."
          >
            <SwitchSetting
              id="maintenance-enabled"
              title="Maintenance mode"
              description="Intended to show a banner on both consoles and in the resident app. Reports, dispatch and the SOS button all keep working."
              checked={draft.maintenance.enabled}
              disabled={disabled}
              onChange={(enabled) => setGroup('maintenance', { enabled })}
              pending="Stored, and nothing renders the banner yet — turning this on changes nothing on screen today. The flag and its message are read back faithfully, so the banner can be added without this panel changing."
            />
            {/* ── IT ANNOUNCES, IT DOES NOT LOCK ────────────────────────────
                Refusing writes while this is on would mean a get() of the
                settings document inside the rules for every write to every
                collection — a billed read per write, and a database that stops
                working the moment one document cannot be read. And the one
                thing that must never be locked out is the SOS button. So this
                is a notice, and the row above says which it is rather than
                leaving a reader to assume the stronger meaning. */}
            <TextSetting
              id="maintenance-message"
              title="Banner message"
              description="What the banner says. Left empty, it reads “The system is under maintenance.”"
              value={draft.maintenance.message}
              placeholder="Back by 6pm — gate records are being migrated."
              disabled={disabled || !draft.maintenance.enabled}
              onChange={(message) => setGroup('maintenance', { message })}
            />
          </SettingsGroup>
        ) : null}

        {/* ── 9. Change password ───────────────────────────────────────── */}
        {tab === 'password' ? <ChangePasswordPanel /> : null}

        {/* ── 10. Display ──────────────────────────────────────────────── */}
        {tab === 'display' ? (
          <SettingsGroup
            icon={Monitor}
            title="Display defaults"
            description="Where a console starts before its reader has chosen anything."
          >
            {/* ── DEFAULTS, NOT OVERRIDES, AND THE DISTINCTION IS THE WHOLE
                   POINT OF THE PANEL ───────────────────────────────────────
                The brief asked for "custom UI theme overrides". An override
                means an administrator in another office decides what contrast
                someone else reads at, and silently undoes the theme toggle
                sitting in that person's own header. For a console staffed
                overnight, in a guardhouse, that is an accessibility
                regression wearing a brand-consistency hat.

                These are fallbacks. ThemeProvider keeps a per-browser
                preference; this is only consulted when that preference is
                unset, which is a console nobody has configured yet — a new
                terminal, or a cleared browser. The reader always wins. */}
            <ChoiceSetting
              id="display-theme"
              title="Starting theme"
              description="What a console that has never been set shows. Anyone who picks a theme from the header keeps theirs."
              value={draft.display.defaultTheme}
              options={[
                { value: 'system', label: 'Follow the device' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              disabled={disabled}
              onChange={(defaultTheme) => setGroup('display', { defaultTheme })}
              pending="Stored. ThemeProvider still falls back to the device's own setting rather than reading this, so a console nobody has configured follows the operating system whatever is chosen here."
            />
            <ChoiceSetting
              id="display-density"
              title="Row density"
              description="How tightly tables and lists are packed. Compact fits roughly a third more rows on a guardhouse screen."
              value={draft.display.density}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              disabled={disabled}
              onChange={(density) => setGroup('display', { density })}
              pending="Stored. Each console reads its own density preference today — the guardhouse's is on its Settings page — so this sets the starting point for a console that has none, which nothing consults yet."
            />
          </SettingsGroup>
        ) : null}

        {/* ── 11. Terms & policies ─────────────────────────────────────── */}
        {tab === 'policies' ? (
          <SettingsGroup
            icon={FileText}
            title="Terms of Service"
            description="Shown to residents in the app, and on both consoles under this panel."
          >
            <TextAreaSetting
              id="policy-terms"
              title="Terms of Service"
              description="Plain text. Blank lines separate paragraphs; nothing here is rendered as HTML."
              value={draft.policies.termsOfService}
              max={MAX_POLICY_CHARS}
              placeholder="1. Access to the subdivision…"
              disabled={disabled}
              onChange={(termsOfService) => setGroup('policies', { termsOfService })}
              pending="Stored. No screen renders it yet — the resident app's About page and a policy viewer on both consoles are what will read it."
            />
          </SettingsGroup>
        ) : null}

        {tab === 'policies' ? (
          <SettingsGroup
            icon={Users}
            title="Community Guidelines"
            description="House rules, as residents see them."
          >
            <TextAreaSetting
              id="policy-guidelines"
              title="Community Guidelines"
              description="Plain text, same as above. Keep it shorter than the terms — this is the one residents actually read."
              value={draft.policies.communityGuidelines}
              max={MAX_POLICY_CHARS}
              placeholder="Quiet hours are 10pm to 6am…"
              disabled={disabled}
              onChange={(communityGuidelines) => setGroup('policies', { communityGuidelines })}
              pending="Stored, same as the terms above."
            />
          </SettingsGroup>
        ) : null}

        </SettingsLayout>
      </form>

      <ConfirmDialog
        open={confirmingSilence}
        tone="danger"
        title="Silence the SOS siren on every console?"
        message="Guards will only see a panic alert, not hear it. An alert raised while nobody is looking at a screen can go unnoticed."
        confirmLabel="Turn the siren off"
        cancelLabel="Keep it on"
        busy={form.saving}
        onCancel={() => setConfirmingSilence(false)}
        onConfirm={async () => {
          await form.save()
          setConfirmingSilence(false)
        }}
      />
    </AppShell>
  )
}

function SaveFooter({ form, settled, meta, status }) {
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!form.savedAt) return undefined
    setJustSaved(true)
    const timer = setTimeout(() => setJustSaved(false), 4000)
    return () => clearTimeout(timer)
  }, [form.savedAt])

  let message
  if (!settled) {
    message = 'Loading saved settings…'
  } else if (form.error) {
    message = <span className="text-danger">{form.error}</span>
  } else if (form.remoteChanged) {
    message = (
      <span className="text-warning">Another administrator saved while you were editing. Discard to see their choice.</span>
    )
  } else if (form.dirty) {
    message = (
      <span className="inline-flex items-center gap-2 text-text-secondary">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
        Unsaved changes
      </span>
    )
  } else if (justSaved) {
    message = (
      <span className="inline-flex items-center gap-1.5 text-success">
        <Check size="sm" aria-hidden="true" />
        Saved — every console has the change.
      </span>
    )
  } else if (meta?.updatedAt) {
    message = `Last changed ${meta.updatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${
      meta.updatedBy?.name ? ` by ${meta.updatedBy.name}` : ''
    }`
  } else {
    message = status === 'error' ? 'Showing the defaults.' : 'Never changed — every value is its default.'
  }

  return (
    <footer className="card flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-3.5">
      <p role="status" aria-live="polite" className="min-w-0 flex-1 basis-56 text-xs leading-snug text-text-muted">
        {message}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {form.dirty ? (
          <button type="button" onClick={form.reset} disabled={form.saving} className="btn btn-sm btn-outline">
            Discard
          </button>
        ) : null}
        <button type="submit" disabled={!settled || !form.dirty || form.saving} className="btn btn-sm btn-brand">
          {form.saving ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
          {form.saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </footer>
  )
}
