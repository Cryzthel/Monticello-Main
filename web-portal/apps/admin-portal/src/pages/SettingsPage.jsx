import { toast } from '@shared/lib/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import Pill from '@shared/components/Pill'
import { AlertTriangle, Save } from '@shared/icons'
import { diffSettings, logSettingsChange } from '@/lib/settingsChanges'
import AppShell from '@/layouts/AppShell'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useAuth } from '@shared/auth/AuthContext'
import { playAlert, unlockAlertSound } from '@shared/lib/alertSound'
import { saveSettings } from '@shared/lib/systemSettings'
import { sanitizeSettings, useSystemSettings } from '@shared/lib/systemSettingsStore'
import { ROUTES } from '@/config/portal'
import { useSettingsDraft } from '@/hooks/useSettingsDraft'
import SettingsLayout from '@shared/components/settings/SettingsLayout'
import ProfileSettingsCard from '@/components/settings/ProfileSettingsCard'
import SecuritySettingsCard from '@shared/components/settings/SecuritySettingsCard'
import NotificationsSettingsCard from '@/components/settings/NotificationsSettingsCard'
import SystemSettingsCard from '@/components/settings/SystemSettingsCard'
import SaveActions from '@shared/components/settings/SaveActions'

/*
 * ── FOUR CHUNKS (2026-10-19, template pass) ─────────────────────────────────
 * Profile, Security, Notifications, System — the provided design, in
 * components under components/settings/. The title and Save bar are the
 * shell's page header with `stickyHeader`, so they stay in reach down the page.
 *
 * Two kinds of change live here and they save differently, on purpose:
 *   • Notifications and System edit ONE draft of `system_settings/operations`.
 *     The header's Save commits it, after a confirmation listing each change
 *     (the user's explicit-save choice, 2026-10-18), and logs it to
 *     `settings_changes`.
 *   • Profile (email) and Security (password) are Firebase Auth actions on
 *     this account with their own buttons. They never enter the draft — a
 *     password must never reach a document every staff account can read.
 *
 * Still not on the page, by request: two-factor policy and idle sign-out.
 * Their stored values are untouched and IdleSignOut enforces the last saved
 * timeout (0 = off).
 *
 * `keys` are the draft paths a section edits, so it can say when it holds an
 * unsaved change.
 */
const SECTIONS = {
  profile: { keys: [] },
  security: { keys: [] },
  notifications: { keys: ['sos.sirenEnabled', 'push', 'guardhouse.sirenVolume'] },
  system: { keys: ['organisation.timeZone', 'organisation.auditRetentionDays'] },
}

/** Old tab, category and section URLs, sent to the section that holds them now. */
const LEGACY_SLUGS = {
  users: 'profile',
  roles: 'profile',
  staff: 'profile',
  account: 'profile',
  community: 'notifications',
  notifications: 'notifications',
  security: 'security',
  system: 'system',
  property: 'system',
}

/** Reads `'guardhouse.sirenVolume'`, or a bare `'push'`, off a settings object. */
const at = (settings, path) => path.split('.').reduce((node, key) => node?.[key], settings)

export default function SettingsPage() {
  const saved = useSystemSettings((state) => state.values)
  const status = useSystemSettings((state) => state.status)
  const loadError = useSystemSettings((state) => state.error)
  const { role } = useAuth()

  // The draft is the whole settings object, already sanitized — so what the
  // form holds is always a shape the document will accept.
  const value = useMemo(() => sanitizeSettings(saved), [saved])

  const onSave = useCallback((draft) => saveSettings(sanitizeSettings(draft)), [])
  const form = useSettingsDraft({ value, onSave })
  const { draft } = form

  const settled = status === 'live' || status === 'default' || status === 'error'
  const disabled = !settled || form.saving
  const [confirmingSave, setConfirmingSave] = useState(false)
  const location = useLocation()

  // ── THE HEADER CARRIES ACTIONS ONLY (2026-10-19) ─────────────────────────
  // "All changes saved", the unsaved count and the inline error were removed
  // from the header by request; what they reported is now a toast. A failed
  // write keeps the draft and says why…
  useEffect(() => {
    if (form.error) toast.error('Settings were not saved', { id: 'settings-saved', description: form.error })
  }, [form.error])
  // …and another administrator saving over an open draft offers their version.
  useEffect(() => {
    if (!form.remoteChanged) return
    toast.warning('Another administrator saved while you were editing', {
      id: 'settings-remote',
      description: 'Your unsaved changes are kept. Save to replace theirs, or discard to load them.',
      action: { label: 'Show theirs', onClick: form.reset },
    })
  }, [form.remoteChanged, form.reset])

  // Compared as JSON because a settings group is plain Firestore data.
  const dirty = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SECTIONS).map(([id, { keys }]) => [
          id,
          keys.some((k) => JSON.stringify(at(draft, k)) !== JSON.stringify(at(value, k))),
        ]),
      ),
    [draft, value],
  )

  /** Groups are replaced whole, so a patch never drops a sibling field. */
  const setGroup = useCallback(
    (group, patch) => form.update({ [group]: { ...form.draft[group], ...patch } }),
    [form],
  )

  const changes = useMemo(() => diffSettings(value, draft), [value, draft])
  const silencing = value.sos.sirenEnabled && !draft.sos.sirenEnabled

  async function confirmSave() {
    const pending = diffSettings(value, form.draft)
    const ok = await form.save()
    setConfirmingSave(false)
    if (!ok) return
    try {
      await logSettingsChange(pending)
      toast.success('Settings saved', {
        id: 'settings-saved',
        description: `${pending.length} ${pending.length === 1 ? 'change' : 'changes'} applied to every console and recorded in Audit History.`,
      })
    } catch (err) {
      console.warn('[settings] audit entry not written:', err?.code ?? err)
      toast.warning('Settings saved, but not logged', {
        id: 'settings-saved',
        description: 'The change is live. The audit trail entry could not be written.',
      })
    }
  }

  // An old URL lands here as /settings#<section>; a retired id is sent to the
  // one that replaced it.
  useEffect(() => {
    const raw = location.hash.slice(1)
    const id = SECTIONS[raw] ? raw : LEGACY_SLUGS[raw]
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  // A tab close or reload would discard the draft silently.
  useEffect(() => {
    if (!form.dirty) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [form.dirty])

  async function testSiren() {
    try {
      await unlockAlertSound()
      playAlert('panic', { volume: draft.guardhouse.sirenVolume })
    } catch (err) {
      console.warn('[settings] test siren failed', err)
      toast.error('Could not play the test sound', { description: 'The browser blocked audio. Click the page and try again.' })
    }
  }

  // The tabs were routes; any /settings/<slug> now opens the one page, at the
  // section that holds what the old tab did.
  const tail = useParams()['*'] || ''
  if (tail) {
    const target = LEGACY_SLUGS[tail]
    return <Navigate to={{ pathname: ROUTES.settings, hash: target ? `#${target}` : '' }} replace />
  }

  const unsaved = (id) =>
    dirty[id] ? (
      <Pill tone="warning">
        Unsaved
      </Pill>
    ) : null

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your account, alerts, and system preferences."
      stickyHeader
      headerActions={
        <SaveActions
          dirty={form.dirty}
          saving={form.saving}
          canSave={settled && !form.saving && form.dirty && changes.length > 0}
          onDiscard={form.reset}
          onSave={() => setConfirmingSave(true)}
        />
      }
    >
      <form onSubmit={(event) => event.preventDefault()} aria-busy={!settled}>
        <SettingsLayout>
          {status === 'error' ? (
            <p
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm leading-relaxed text-text-primary"
            >
              <AlertTriangle size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
              <span>
                <span className="font-semibold text-warning">Saved settings could not be loaded.</span> Every control
                is showing its default{loadError ? ` (Firestore: ${loadError})` : ''}.
              </span>
            </p>
          ) : null}

          <ProfileSettingsCard role={role} />
          <SecuritySettingsCard />
          <NotificationsSettingsCard
            draft={draft}
            disabled={disabled}
            setGroup={setGroup}
            onTestSiren={testSiren}
            action={unsaved('notifications')}
          />
          <SystemSettingsCard draft={draft} disabled={disabled} setGroup={setGroup} action={unsaved('system')} />
        </SettingsLayout>
      </form>

      <ConfirmDialog
        open={confirmingSave}
        tone={silencing ? 'danger' : 'success'}
        icon={silencing ? AlertTriangle : Save}
        title="Confirm settings update"
        message={`Apply ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}? They reach every active Admin and Guardhouse console at once and are recorded in Audit History under your name.`}
        confirmLabel="Confirm & save"
        cancelLabel="Cancel"
        busy={form.saving}
        onCancel={() => setConfirmingSave(false)}
        onConfirm={confirmSave}
      >
        <ul className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline bg-base-950/40">
          {changes.map((change) => (
            <li key={change.path} className="px-3.5 py-2.5 text-xs">
              <p className="font-semibold text-text-primary">{change.label}</p>
              <p className="mt-0.5 break-words text-text-secondary">
                <span className="line-through opacity-70">{change.from}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changes to </span>
                <span className="font-medium text-text-primary">{change.to}</span>
              </p>
            </li>
          ))}
        </ul>
        {silencing ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs leading-relaxed text-danger">
            <AlertTriangle size="sm" aria-hidden="true" className="mt-0.5 shrink-0" />
            This silences the SOS siren on every guardhouse console. Guards will only see a panic alert, not hear it.
          </p>
        ) : null}
      </ConfirmDialog>
    </AppShell>
  )
}
