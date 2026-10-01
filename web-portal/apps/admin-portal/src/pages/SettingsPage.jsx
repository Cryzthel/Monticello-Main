import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Lock,
  Plug,
  Radio,
  ShieldAlert,
  Siren,
  Smartphone,
  Ticket,
  Volume2,
} from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { playAlert, unlockAlertSound } from '@shared/lib/alertSound'
import { saveSettings } from '@shared/lib/systemSettings'
import {
  AUDIT_RETENTION_DAYS,
  TELEMETRY_INTERVALS,
  UPLOAD_LIMITS_MB,
  sanitizeSettings,
  useSystemSettings,
} from '@shared/lib/systemSettingsStore'
import { useSettingsDraft } from '@/hooks/useSettingsDraft'
import {
  ChoiceSetting,
  HotlineEditor,
  NumberSetting,
  PendingNote,
  SettingRow,
  SettingsGroup,
  SwitchSetting,
  TextSetting,
  VolumeSetting,
} from '@/components/settings/SettingsFields'

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

  async function testSiren() {
    await unlockAlertSound()
    playAlert('panic', { volume: draft.guardhouse.sirenVolume })
  }

  return (
    <AppShell title="Settings" subtitle="How the subdivision is alerted, dispatched and governed.">
      <form onSubmit={submit} aria-busy={!settled} className="flex w-full max-w-3xl flex-col gap-4">
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

        {/* ── 1. SOS ───────────────────────────────────────────────────── */}
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

        {/* ── 2. Incidents ─────────────────────────────────────────────── */}
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

        {/* ── 3. Guardhouse ────────────────────────────────────────────── */}
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

          <SwitchSetting
            id="guard-handover"
            title="Shift handover required"
            description="Officers must file a duty log before they can clock out of a shift. With this off, clocking out is a single confirmation."
            checked={draft.guardhouse.requireHandover}
            disabled={disabled}
            onChange={(requireHandover) => setGroup('guardhouse', { requireHandover })}
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

        {/* ── 4. Resident app ──────────────────────────────────────────── */}
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

        {/* ── 5. Organisation ──────────────────────────────────────────── */}
        <SettingsGroup
          icon={Building2}
          title="Subdivision profile"
          description="Who residents reach, and how long the record is kept."
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

          <ChoiceSetting
            id="org-retention"
            title="Audit history retention"
            description="How far back the audit history goes."
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

        {/* ── Integrations ─────────────────────────────────────────────── */}
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

        {/* ── Notifications + save ─────────────────────────────────────── */}
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

        <SaveFooter form={form} settled={settled} meta={meta} status={status} />
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
