import { useSyncExternalStore } from 'react'

/**
 * Organisation settings: schema, defaults and the in-memory store every
 * consumer reads from.
 *
 * One Firestore document, `system_settings/operations`, read by both consoles
 * and by the resident mobile app. The Firestore half is `systemSettings.js`.
 *
 * ── DEFAULTS ARE THE CURRENT BEHAVIOUR ──────────────────────────────────────
 * Until an administrator saves, the document does not exist and every value
 * below is what the system already did. A denied or failed read lands on the
 * same defaults, so a rules problem degrades to "as before", never to "off".
 *
 * ── CLAMPING LIVES HERE, NOT IN THE FORM ────────────────────────────────────
 * `sanitizeSettings` is the only place a stored value becomes a usable one.
 * The Settings page is one consumer; the guardhouse console, the siren and the
 * resident app are others, and a document edited in the Firebase console — or
 * written by an older build — must not be able to hand any of them a 9000
 * minute escalation or a negative upload limit. Every numeric field is clamped
 * to its own range and every enum falls back to its default.
 *
 * ── WHERE EACH SETTING IS ENFORCED ──────────────────────────────────────────
 * Storing a preference and honouring it are different jobs, and this project
 * cannot currently do the second one everywhere: Cloud Functions are on the
 * Spark plan and cannot deploy, so anything needing a server-side timer or a
 * write trigger is stored but not yet acted on. Each group below says which of
 * the following it is, and the Settings page states it on the surface too,
 * because a setting that does nothing is worse than no setting.
 *
 *   ENFORCED  the consoles or the app honour it as they run.
 *   SWEEP     `functions/operationsSweep.js` honours it on a timer. WRITTEN
 *             AND TESTED, NOT YET RUNNING — a scheduled function needs the
 *             Blaze plan, so these take effect on the first deploy after
 *             billing is enabled and do nothing before it.
 *   STORED    saved, and nothing reads it yet.
 *   ADVISORY  the client can honour it but cannot be made to.
 */

export const SETTINGS_COLLECTION = 'system_settings'
export const SETTINGS_DOC = 'operations'

/** Options offered by the form, and the only values the sanitizer accepts. */
export const TELEMETRY_INTERVALS = Object.freeze([5, 10, 30])
export const UPLOAD_LIMITS_MB = Object.freeze([5, 10, 25])
/** 0 means "keep indefinitely". */
export const AUDIT_RETENTION_DAYS = Object.freeze([30, 60, 90, 0])
/**
 * Idle minutes before an ADMIN console signs itself out. 0 means never.
 *
 * Deliberately coarse. A timeout is a policy an officer of the HOA sets once,
 * not a figure to tune, and an open list invites "7 minutes" — which reads as
 * precision about something nobody measured.
 */
export const SESSION_TIMEOUTS_MINUTES = Object.freeze([15, 30, 60, 120, 0])

export const DEFAULTS = Object.freeze({
  /** Resident push, read by the Cloud Functions before they send. */
  push: Object.freeze({ enabled: true }),

  /**
   * sirenEnabled   ENFORCED — usePanicSiren reads it as an alert arrives.
   * escalateAfter  SWEEP — the sweep stamps `escalatedAt` on an active alert
   *                nobody acknowledged in time. The rules file asks for exactly
   *                this: update access is security-only, so an SOS raised while
   *                the guardhouse is unattended cannot be cleared from any
   *                console, and it names the fix as "a server-side escalation".
   * geofenceAlert  ENFORCED — panicGeofence compares the fix to the
   *                boundary ring on every alert surface.
   * hotlines       STORED — the resident app does not read them yet.
   */
  sos: Object.freeze({
    sirenEnabled: true,
    escalateAfterMinutes: 3,
    geofenceAlert: true,
    hotlines: Object.freeze([]),
  }),

  /**
   * autoAssign     STORED — routing on shift needs a write trigger.
   * ackTarget      SWEEP — the sweep writes `slaBreach` on open reports past
   *                the target. The report drawer's own overdue marker still
   *                uses its built-in threshold.
   * resolveTarget  SWEEP — same pass, and the totals go on the sweep's state
   *                document so a dashboard need not read every incident.
   * hazardTtl      SWEEP — archives reports RESOLVED longer ago than this.
   *                It hides NOTHING. The hazard map briefly held stale pins
   *                back behind a notice; that was removed by request, so an
   *                open report is drawn whatever its age. `isHazardStale` is
   *                still exported and is what the sweep measures with.
   */
  incidents: Object.freeze({
    autoAssign: false,
    ackTargetMinutes: 5,
    resolveTargetHours: 24,
    hazardTtlHours: 72,
  }),

  /**
   * sirenVolume       ENFORCED — alertSound reads it.
   * requireHandover   ENFORCED — the clock-out gate reads it; the log is
   *                    written onto the shift row by ShiftHandoverDialog.
   * telemetryInterval ENFORCED — useGuardTelemetry uses it as its cadence.
   */
  guardhouse: Object.freeze({
    sirenVolume: 0.8,
    requireHandover: false,
    telemetryIntervalSeconds: 10,
  }),

  /**
   * reportsPerHour   ADVISORY — the client can refuse, but only a server can
   *                  enforce a rate limit. Stated as advisory in the form.
   * maxUploadMb      ENFORCED in the guardhouse uploader; Storage rules
   *                  would make it unbypassable.
   * requireVerified  STORED — the mobile app does not read it yet.
   */
  residentApp: Object.freeze({
    reportsPerHour: 5,
    maxUploadMb: 10,
    requireVerificationForSos: false,
  }),

  /**
   * contactEmail / officeHours  ENFORCED — the sidebar office block.
   * logoUrl                     ENFORCED — the sidebar brand tile, with an
   *                             onError fallback to the MV mark.
   * auditRetentionDays          SWEEP — prunes `provisioning_logs`, which is
   *                             genuinely append-only, and NOTHING ELSE. The
   *                             Audit History page is built from the incident
   *                             and announcement documents themselves, so a
   *                             retention policy there would delete the
   *                             records rather than trim a log. 0 means keep
   *                             indefinitely and cannot produce a cutoff.
   */
  organisation: Object.freeze({
    contactEmail: '',
    officeHours: '',
    logoUrl: '',
    auditRetentionDays: 90,
  }),

  /**
   * sessionTimeoutMinutes  ENFORCED — `IdleSignOut` watches for activity in
   *                        the ADMIN console and signs the session out after
   *                        this long without any. 0 disables it.
   *
   * ── WHY THE DEFAULT IS 0 AND NOT A NUMBER ─────────────────────────
   * Every other default in this file is "what the system already did", so
   * saving nothing changes nothing (see the note at the top). Nothing signed
   * anyone out before this existed, so the honest default is off. An
   * administrator turns it on; it does not arrive switched on and log somebody
   * out of a console they left open on purpose.
   *
   * ── AND WHY IT IS ADMIN-ONLY ─────────────────────────────────
   * The guardhouse console is a shared terminal that is meant to be staring at
   * a map all night with nobody touching it. Signing it out for being idle is
   * the definition of idle for that room, and it would take the SOS siren off
   * the air. The risk this setting answers — an unattended session with write
   * access to policy, accounts and resident records — is the admin console's
   * risk, so the control is the admin console's too.
   */
  security: Object.freeze({
    sessionTimeoutMinutes: 0,
  }),
})

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** Clamped to [min, max]; anything unparseable falls back. */
function num(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Only a value the form offers is accepted; anything else falls back. */
function oneOf(value, fallback, allowed) {
  const n = Number(value)
  return allowed.includes(n) ? n : fallback
}

function text(value, fallback, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

/**
 * Emergency hotlines.
 *
 * Capped at eight and trimmed, because this list is dispatched to a phone mid
 * emergency: a resident scrolling a list of forty numbers while something is
 * happening is worse served than one reading four. Entries missing a number
 * are dropped rather than rendered as a dead button.
 */
export const MAX_HOTLINES = 8

function hotlines(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: text(entry.id, `hotline-${index}`, 60),
      label: text(entry.label, '', 60).trim(),
      number: text(entry.number, '', 40).trim(),
    }))
    .filter((entry) => entry.label && entry.number)
    .slice(0, MAX_HOTLINES)
}

/** Whatever is stored, consumers get a complete, valid shape. */
export function sanitizeSettings(raw = {}) {
  const d = DEFAULTS
  return {
    push: { enabled: bool(raw.push?.enabled, d.push.enabled) },

    sos: {
      sirenEnabled: bool(raw.sos?.sirenEnabled, d.sos.sirenEnabled),
      escalateAfterMinutes: num(raw.sos?.escalateAfterMinutes, d.sos.escalateAfterMinutes, 1, 10),
      geofenceAlert: bool(raw.sos?.geofenceAlert, d.sos.geofenceAlert),
      hotlines: hotlines(raw.sos?.hotlines),
    },

    incidents: {
      autoAssign: bool(raw.incidents?.autoAssign, d.incidents.autoAssign),
      ackTargetMinutes: num(raw.incidents?.ackTargetMinutes, d.incidents.ackTargetMinutes, 1, 120),
      resolveTargetHours: num(raw.incidents?.resolveTargetHours, d.incidents.resolveTargetHours, 1, 336),
      hazardTtlHours: num(raw.incidents?.hazardTtlHours, d.incidents.hazardTtlHours, 1, 720),
    },

    guardhouse: {
      sirenVolume: num(raw.guardhouse?.sirenVolume, d.guardhouse.sirenVolume, 0, 1),
      requireHandover: bool(raw.guardhouse?.requireHandover, d.guardhouse.requireHandover),
      telemetryIntervalSeconds: oneOf(
        raw.guardhouse?.telemetryIntervalSeconds,
        d.guardhouse.telemetryIntervalSeconds,
        TELEMETRY_INTERVALS,
      ),
    },

    residentApp: {
      reportsPerHour: num(raw.residentApp?.reportsPerHour, d.residentApp.reportsPerHour, 1, 50),
      maxUploadMb: oneOf(raw.residentApp?.maxUploadMb, d.residentApp.maxUploadMb, UPLOAD_LIMITS_MB),
      requireVerificationForSos: bool(
        raw.residentApp?.requireVerificationForSos,
        d.residentApp.requireVerificationForSos,
      ),
    },

    organisation: {
      contactEmail: text(raw.organisation?.contactEmail, d.organisation.contactEmail, 120),
      officeHours: text(raw.organisation?.officeHours, d.organisation.officeHours, 120),
      logoUrl: text(raw.organisation?.logoUrl, d.organisation.logoUrl, 500),
      auditRetentionDays: oneOf(
        raw.organisation?.auditRetentionDays,
        d.organisation.auditRetentionDays,
        AUDIT_RETENTION_DAYS,
      ),
    },

    security: {
      sessionTimeoutMinutes: oneOf(
        raw.security?.sessionTimeoutMinutes,
        d.security.sessionTimeoutMinutes,
        SESSION_TIMEOUTS_MINUTES,
      ),
    },
  }
}

/** `{ updatedAt: Date|null, updatedBy: {uid, name}|null }` from a stored document. */
export function readMeta(raw) {
  if (!raw) return null
  const at = raw.updatedAt
  return {
    updatedAt: typeof at?.toDate === 'function' ? at.toDate() : at instanceof Date ? at : null,
    updatedBy: raw.updatedBy && typeof raw.updatedBy === 'object' ? raw.updatedBy : null,
  }
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * status:
 *   idle     not subscribed (signed out)
 *   loading  subscribed, no answer yet
 *   live     the document exists and its values are applied
 *   default  the document does not exist yet — defaults apply
 *   error    the read was refused or failed — defaults apply
 */
let snapshot = {
  values: DEFAULTS,
  status: 'idle',
  meta: null,
  error: null,
}

const listeners = new Set()

export function getSettings() {
  return snapshot.values
}

export function getSettingsSnapshot() {
  return snapshot
}

export function subscribeSettings(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Internal: the Firestore sync writes through this. */
export function commitSettings({ values, status, meta = null, error = null }) {
  snapshot = { values: values ?? snapshot.values, status, meta, error }
  listeners.forEach((listener) => listener())
}

/** Internal: forget everything (on sign-out). */
export function resetSettings() {
  if (snapshot.status === 'idle' && snapshot.values === DEFAULTS) return
  commitSettings({ values: DEFAULTS, status: 'idle' })
}

/**
 * React binding over the whole snapshot (`{ values, status, meta, error }`).
 * With a selector, re-renders only when the selected slice changes identity.
 */
export function useSystemSettings(selector = identity) {
  return useSyncExternalStore(
    subscribeSettings,
    () => selector(snapshot),
    () => selector(snapshot),
  )
}

function identity(value) {
  return value
}
