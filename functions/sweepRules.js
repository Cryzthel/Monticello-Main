/**
 * Every decision the scheduled operations sweep makes, as pure functions.
 *
 * ── WHY THIS FILE IS SEPARATE ───────────────────────────────────────────────
 * The sweep escalates live emergencies, archives reports and DELETES audit
 * rows. Cloud Functions cannot deploy on this project's billing plan, so the
 * sweep itself cannot be exercised here — which is exactly the situation in
 * which destructive logic must not be the part you cannot test. Nothing in
 * this file touches firebase-admin, the network or the clock: every input is a
 * plain object and `nowMs` is a parameter. `scripts/sweepRules.test.cjs` runs
 * it under bare node.
 *
 * ── THE FOUR JOBS ───────────────────────────────────────────────────────────
 *   sos.escalateAfterMinutes      an active SOS nobody has acknowledged
 *   incidents.hazardTtlHours      a resolved report old enough to file away
 *   organisation.auditRetentionDays  provisioning_logs past their keep-window
 *   incidents.ackTarget/resolveTarget  open reports that missed their target
 *
 * ── "NO CLOCK" NEVER MEANS "ACT" ────────────────────────────────────────────
 * A `serverTimestamp()` reads back as null for the moment between the client's
 * write landing and the server resolving it, so a document with no usable
 * timestamp is a normal, transient state — not an old one. Every helper below
 * answers "no" when it cannot age a document. The failure mode of the opposite
 * choice is escalating every SOS the instant it is raised and archiving reports
 * the second they are filed.
 */

"use strict";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Ranges, duplicated from the web sanitizer on purpose.
 *
 * `systemSettingsStore.js` is an ES module inside the Vite workspace; this is
 * CommonJS in a separate npm package that is uploaded on its own. There is no
 * import that spans the two without a build step for the functions, so the
 * numbers are restated here — and `sweepRules.test.cjs` reads the web file and
 * fails if any range stops matching. Drift is the real risk with a copy, so
 * the copy is the thing under test.
 */
const LIMITS = Object.freeze({
  escalateAfterMinutes: { fallback: 3, min: 1, max: 10 },
  hazardTtlHours: { fallback: 72, min: 1, max: 720 },
  ackTargetMinutes: { fallback: 5, min: 1, max: 120 },
  resolveTargetHours: { fallback: 24, min: 1, max: 336 },
});

/** 0 means "keep indefinitely" — see `retentionCutoff`. */
const AUDIT_RETENTION_DAYS = Object.freeze([30, 60, 90, 0]);

const OPEN_STATUSES = Object.freeze(["Pending", "Dispatched", "On-Site"]);
const RESOLVED_STATUS = "Resolved";

/**
 * Milliseconds from whatever Firestore, a test or an older build stored.
 * Returns NaN for anything unusable, and every caller treats NaN as "cannot
 * age this document" rather than as zero.
 */
function asMillis(value) {
  if (value == null) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  // Firestore's REST shape, and what a Timestamp looks like after JSON.
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return NaN;
}

function clamp(value, { fallback, min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * The settings the sweep needs, clamped, from the raw stored document.
 *
 * Same contract as the web sanitizer: a document that does not exist, a field
 * an older build never wrote, and a value someone typed into the Firebase
 * console all resolve to the current behaviour rather than to an extreme.
 */
function sweepSettings(raw) {
  const sos = raw && raw.sos ? raw.sos : {};
  const incidents = raw && raw.incidents ? raw.incidents : {};
  const organisation = raw && raw.organisation ? raw.organisation : {};

  const retention = Number(organisation.auditRetentionDays);

  return {
    escalateAfterMinutes: clamp(sos.escalateAfterMinutes, LIMITS.escalateAfterMinutes),
    hazardTtlHours: clamp(incidents.hazardTtlHours, LIMITS.hazardTtlHours),
    ackTargetMinutes: clamp(incidents.ackTargetMinutes, LIMITS.ackTargetMinutes),
    resolveTargetHours: clamp(incidents.resolveTargetHours, LIMITS.resolveTargetHours),
    auditRetentionDays: AUDIT_RETENTION_DAYS.includes(retention) ? retention : 90,
  };
}

// ── 1. SOS escalation ───────────────────────────────────────────────────────

/**
 * Should this alert be escalated now?
 *
 * ── WHAT ESCALATION IS HERE ─────────────────────────────────────────────────
 * A stamp, not a phone call. The rules file already reasons about this exact
 * gap: update access to `panic_alerts` is security-only, so an SOS raised
 * while the guardhouse is unattended "can no longer be cleared from any
 * console", and it names the mitigation as "guardhouse coverage or a
 * server-side escalation — not a client with write access". This is that
 * escalation. It marks the alert so both consoles can show that nobody has
 * attended it, and it does not pretend to have reached anyone: no push token
 * is registered anywhere in this project yet, in either direction.
 *
 * Escalation is one-shot. `escalatedAt` already being present ends it, so a
 * sweep that runs every minute against an alert nobody clears writes once and
 * then does nothing — rather than rewriting the document 1,440 times a day.
 */
function shouldEscalateAlert(alert, nowMs, minutes) {
  if (!alert) return false;
  if (alert.escalatedAt) return false;
  if (String(alert.status || "").trim().toLowerCase() !== "active") return false;

  const created = asMillis(alert.createdAt);
  if (!Number.isFinite(created)) return false;

  return nowMs - created >= minutes * MINUTE;
}

// ── 2. Hazard archiving ─────────────────────────────────────────────────────

/**
 * Should this report be archived now?
 *
 * ── RESOLVED ONLY, AND THAT IS THE WHOLE POINT ──────────────────────────────
 * `hazardTtlHours` is described in Settings as how long a hazard pin lives.
 * The obvious reading — archive any report older than the window — would hide
 * OPEN reports, which is the one thing this system must never do: an unfixed
 * hazard that ages out of the queue is a hazard nobody is coming to fix, and
 * the report would look handled because it was ignored for long enough.
 *
 * `isHazardStale` on the web side already settled this: it flags an aged open
 * report and lets the map offer a "Show them" toggle, deciding nothing on the
 * operator's behalf. So the sweep takes the half that is genuinely
 * housekeeping — filing away reports that are DONE — and leaves open ones
 * visible and flagged.
 *
 * Archiving is also reversible (`archivedAt: null` unarchives, and the admin
 * console already does), which is the other reason this is the safe half.
 */
function shouldArchiveResolved(incident, nowMs, ttlHours) {
  if (!incident) return false;
  if (incident.archivedAt) return false;
  if (String(incident.status || "") !== RESOLVED_STATUS) return false;

  const resolved = asMillis(incident.resolvedAt);
  if (!Number.isFinite(resolved)) return false;

  return nowMs - resolved >= ttlHours * HOUR;
}

// ── 3. Audit retention ──────────────────────────────────────────────────────

/**
 * The timestamp below which `provisioning_logs` rows may be deleted, or null
 * when nothing may be.
 *
 * ── ZERO MEANS KEEP, NOT DELETE ─────────────────────────────────────────────
 * "Keep indefinitely" is stored as 0, and 0 days would compute a cutoff of
 * `now` — i.e. delete the entire audit log. Returning null instead of a
 * number is deliberate: the caller cannot accidentally use it as a date, and
 * the most destructive possible reading of the most innocent-looking setting
 * is unrepresentable rather than merely avoided.
 */
function retentionCutoff(nowMs, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return nowMs - n * DAY;
}

// ── 4. SLA breach ───────────────────────────────────────────────────────────

/**
 * Whether a report has missed either target.
 *
 * Elapsed time runs from `reportedAt` to the moment the clock stopped —
 * `dispatchedAt` for acknowledgement, `resolvedAt` for resolution — or to now
 * while it is still running. A report with no `reportedAt` has no measurable
 * elapsed time and breaches nothing; clock skew that puts `reportedAt` in the
 * future produces a negative elapsed time, which is also not a breach.
 */
function slaBreach(incident, nowMs, targets) {
  const none = { ack: false, resolve: false };
  if (!incident) return none;

  const reported = asMillis(incident.reportedAt);
  if (!Number.isFinite(reported)) return none;

  const dispatched = asMillis(incident.dispatchedAt);
  const resolved = asMillis(incident.resolvedAt);

  const ackElapsed = (Number.isFinite(dispatched) ? dispatched : nowMs) - reported;
  const resolveElapsed = (Number.isFinite(resolved) ? resolved : nowMs) - reported;

  return {
    ack: ackElapsed > targets.ackTargetMinutes * MINUTE,
    resolve: resolveElapsed > targets.resolveTargetHours * HOUR,
  };
}

/**
 * Is a write needed to bring the stored breach flags in line?
 *
 * The sweep runs every minute over every open report. Without this the same
 * documents would be rewritten 1,440 times a day, each write waking every
 * console listener watching the incident stream — a live-update system billing
 * itself for telling itself nothing changed.
 */
function breachChanged(incident, breach) {
  const stored = incident && incident.slaBreach ? incident.slaBreach : null;
  if (!stored) return breach.ack || breach.resolve;
  return Boolean(stored.ack) !== breach.ack || Boolean(stored.resolve) !== breach.resolve;
}

// ── Cadence ─────────────────────────────────────────────────────────────────

/**
 * Has `intervalMs` passed since a pass last ran?
 *
 * ── WHY NOT THE WALL CLOCK ──────────────────────────────────────────────────
 * The passes want three different cadences and there is only one Cloud
 * Scheduler job to spend, so the job ticks at the fastest one and the slower
 * passes gate themselves. Gating on the hour ("archive at 03:00") reads
 * plausibly and fails badly: the runtime's clock is UTC whatever timezone the
 * schedule was created in, and an instance that is cold, throttled or retried
 * across the boundary skips the day entirely with nothing to show that it did.
 *
 * A stored "last ran" stamp has neither problem. It needs no timezone, and a
 * pass that misses its window runs at the next tick instead of next year.
 */
function isDue(lastRanAt, nowMs, intervalMs) {
  const last = asMillis(lastRanAt);
  if (!Number.isFinite(last)) return true; // never run, or unreadable → run
  return nowMs - last >= intervalMs;
}

module.exports = {
  MINUTE,
  HOUR,
  DAY,
  LIMITS,
  AUDIT_RETENTION_DAYS,
  OPEN_STATUSES,
  RESOLVED_STATUS,
  asMillis,
  sweepSettings,
  shouldEscalateAlert,
  shouldArchiveResolved,
  retentionCutoff,
  slaBreach,
  breachChanged,
  isDue,
};
