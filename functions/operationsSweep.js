/**
 * The scheduled operations sweep: one job, four passes.
 *
 * Four Admin › Settings values describe things that happen after a delay, and
 * nothing in a browser can do them. A console only acts while someone has it
 * open, and the case that matters most here — an SOS nobody has attended — is
 * by definition the case where nobody is looking. These need a clock on the
 * server.
 *
 *   sos.escalateAfterMinutes         stamp an unattended active SOS
 *   incidents.hazardTtlHours         archive reports resolved long enough ago
 *   incidents.ackTarget/resolveTarget flag open reports past their target
 *   organisation.auditRetentionDays  delete aged provisioning_logs rows
 *
 * ── ONE SCHEDULER JOB, THREE CADENCES ───────────────────────────────────────
 * Cloud Scheduler bills per job beyond three, so the four passes share one.
 * The tick is set by the most urgent of them: escalation can be configured as
 * low as one minute, and a five-minute tick would make a three-minute setting
 * fire somewhere between three and eight — useless for the emergency it exists
 * for. So the job ticks every minute and the slower passes gate themselves on
 * a stored "last ran" stamp (see `isDue` for why not on the wall clock).
 *
 * Every-minute sounds expensive and is not: ~43,200 invocations a month
 * against a 2,000,000 free allowance, each one two small indexed queries.
 *
 * ── NO COMPOSITE INDEXES ────────────────────────────────────────────────────
 * Every query below filters and orders on a SINGLE field, which Firestore
 * indexes automatically. That is a constraint the queries were written to,
 * not luck: an index that has to be deployed is an index that can be missing,
 * and a missing one fails the pass at runtime rather than at review.
 *
 * ── PASSES FAIL INDEPENDENTLY ───────────────────────────────────────────────
 * Each pass has its own try/catch and they run most-urgent-first. A permission
 * error while pruning the audit log must not be the reason a live emergency
 * went unescalated.
 *
 * ── DEPLOYMENT ──────────────────────────────────────────────────────────────
 * This cannot deploy while the project is on the Spark plan; scheduled
 * functions need Blaze. It is written, tested (`scripts/sweepRules.test.cjs`
 * covers every decision it makes) and inert until then. Enabling billing is
 * the account owner's call.
 */

"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");

const { loadSettings } = require("./systemSettings");
const {
  MINUTE,
  HOUR,
  OPEN_STATUSES,
  asMillis,
  sweepSettings,
  shouldEscalateAlert,
  shouldArchiveResolved,
  retentionCutoff,
  slaBreach,
  breachChanged,
  isDue,
} = require("./sweepRules");

const STATE_DOC = "operations_state/sweep";

/** How often each gated pass wants to run. */
const HAZARD_INTERVAL_MS = 55 * MINUTE; // hourly, minus a tick of slack
const RETENTION_INTERVAL_MS = 20 * HOUR; // daily, minus enough to never skip one

/**
 * Per-run ceilings.
 *
 * Bounds exist so one run cannot become a runaway: a sweep that tries to
 * process a year of backlog in a 120-second function times out, retries, and
 * times out again forever. Under a ceiling it makes steady progress instead,
 * and every pass below is written so that progress is monotonic — it never
 * re-reads the same documents on the next run.
 */
const MAX_ACTIVE_ALERTS = 200;
const MAX_OPEN_INCIDENTS = 300;
const MAX_ARCHIVE_PER_RUN = 200;
const MAX_DELETES_PER_BATCH = 400;
const MAX_DELETE_BATCHES = 5;

function db() {
  return admin.firestore();
}

function serverNow() {
  return admin.firestore.FieldValue.serverTimestamp();
}

// ── Pass 1: unattended SOS ──────────────────────────────────────────────────

/**
 * Stamp active alerts that have gone unacknowledged past the window.
 *
 * Queried on `status` alone and aged in memory. That is on purpose: an
 * `status == 'active'` + `createdAt <=` query needs a composite index, and the
 * live set is a handful of documents by nature — an alert is active only until
 * someone acknowledges it. The ceiling is there for the pathological case, not
 * the expected one.
 */
async function sweepEscalations(nowMs, settings) {
  const snap = await db()
    .collection("panic_alerts")
    .where("status", "==", "active")
    .limit(MAX_ACTIVE_ALERTS)
    .get();

  // Hitting the ceiling means alerts are being missed, and the ceiling is high
  // enough that reaching it is itself the emergency.
  if (snap.size === MAX_ACTIVE_ALERTS) {
    console.error(
      `[sweep] ${MAX_ACTIVE_ALERTS} active SOS alerts — at the per-run ceiling, ` +
        "so some may not have been examined",
    );
  }

  const due = snap.docs.filter((doc) =>
    shouldEscalateAlert(doc.data(), nowMs, settings.escalateAfterMinutes),
  );
  if (due.length === 0) return { escalated: 0 };

  const batch = db().batch();
  due.forEach((doc) => {
    batch.update(doc.ref, {
      escalatedAt: serverNow(),
      // The window in force at the time. Read back later, "escalated" alone
      // does not say whether the target was three minutes or ten, and the
      // setting will have been changed by then.
      escalatedAfterMinutes: settings.escalateAfterMinutes,
      escalationReason: "No acknowledgement within the configured window.",
    });
  });
  await batch.commit();

  console.warn(
    `[sweep] escalated ${due.length} unattended SOS alert(s) after ` +
      `${settings.escalateAfterMinutes}m: ${due.map((d) => d.id).join(", ")}`,
  );
  return { escalated: due.length };
}

// ── Pass 2: SLA targets ─────────────────────────────────────────────────────

/**
 * Flag open reports that have missed their acknowledgement or resolution
 * target, and publish the totals.
 *
 * `slaBreach` is written onto the incident so a console can badge the row, and
 * the counts go on the state document so the dashboard can show the figure
 * without reading every incident. Only documents whose flags actually change
 * are written — see `breachChanged`.
 */
async function sweepSla(nowMs, settings) {
  const snap = await db()
    .collection("incidents")
    .where("status", "in", OPEN_STATUSES)
    .limit(MAX_OPEN_INCIDENTS)
    .get();

  if (snap.size === MAX_OPEN_INCIDENTS) {
    console.warn(
      `[sweep] ${MAX_OPEN_INCIDENTS} open reports — at the per-run ceiling, so the ` +
        "breach totals below are a floor, not a count",
    );
  }

  const batch = db().batch();
  let writes = 0;
  let ackBreaches = 0;
  let resolveBreaches = 0;

  snap.docs.forEach((doc) => {
    const data = doc.data();
    const breach = slaBreach(data, nowMs, settings);
    if (breach.ack) ackBreaches += 1;
    if (breach.resolve) resolveBreaches += 1;

    if (!breachChanged(data, breach)) return;
    batch.update(doc.ref, {
      slaBreach: {
        ack: breach.ack,
        resolve: breach.resolve,
        ackTargetMinutes: settings.ackTargetMinutes,
        resolveTargetHours: settings.resolveTargetHours,
        at: serverNow(),
      },
    });
    writes += 1;
  });

  if (writes > 0) await batch.commit();

  return {
    open: snap.size,
    ackBreaches,
    resolveBreaches,
    slaWrites: writes,
  };
}

// ── Pass 3: archive resolved reports ────────────────────────────────────────

/**
 * File away reports that have been resolved for longer than the hazard window.
 *
 * ── THE WATERMARK IS WHAT MAKES THIS TERMINATE ──────────────────────────────
 * Archiving sets `archivedAt`, which does not remove the document from any
 * query that can be expressed here — Firestore cannot filter on "field
 * absent". So a plain "oldest resolved first" query would hand back the same
 * already-archived documents every run, forever, and never reach the ones
 * behind them.
 *
 * The cursor is the newest `resolvedAt` this pass has looked at. It is sound
 * because `resolvedAt` is a server timestamp written once when a report is
 * resolved, so it never moves backwards, and a report that is reopened and
 * resolved again gets a NEW, later one and re-enters above the cursor. It also
 * behaves correctly when the setting changes: shortening the window makes more
 * reports eligible, and those are all newer than the cursor.
 *
 * Skipped documents advance the cursor too. That is the point — a report that
 * was reopened, or was archived by hand, is passed over once rather than
 * re-examined on every run for the life of the system.
 */
async function sweepHazardArchive(nowMs, settings, state) {
  const cutoff = new Date(nowMs - settings.hazardTtlHours * HOUR);
  const watermarkMs = asMillis(state && state.hazardWatermark);
  const after = new Date(Number.isFinite(watermarkMs) ? watermarkMs : 0);

  const snap = await db()
    .collection("incidents")
    .where("resolvedAt", ">", after)
    .where("resolvedAt", "<=", cutoff)
    .orderBy("resolvedAt", "asc")
    .limit(MAX_ARCHIVE_PER_RUN)
    .get();

  if (snap.empty) return { archived: 0, examined: 0, hazardWatermark: null };

  const batch = db().batch();
  let archived = 0;
  let newest = null;

  snap.docs.forEach((doc) => {
    const data = doc.data();
    const resolvedMs = asMillis(data.resolvedAt);
    if (Number.isFinite(resolvedMs) && (newest === null || resolvedMs > newest)) {
      newest = resolvedMs;
    }
    if (!shouldArchiveResolved(data, nowMs, settings.hazardTtlHours)) return;

    batch.update(doc.ref, {
      archivedAt: serverNow(),
      archivedBy: "system",
      archivedByName: `Auto-archived after ${settings.hazardTtlHours}h`,
      updatedAt: serverNow(),
    });
    archived += 1;
  });

  if (archived > 0) await batch.commit();

  return {
    archived,
    examined: snap.size,
    hazardWatermark: newest === null ? null : new Date(newest),
  };
}

// ── Pass 4: audit retention ─────────────────────────────────────────────────

/**
 * Delete `provisioning_logs` rows older than the keep-window.
 *
 * ── THIS COLLECTION AND NOTHING ELSE ────────────────────────────────────────
 * `auditRetentionDays` sounds like it governs the Admin › Audit History page.
 * It must not. That page has no log collection behind it: it BUILDS its
 * timeline out of the `incidents`, `announcements` and `audit_dismissals`
 * documents themselves. Applying a retention policy there would not trim a
 * log, it would delete the reports and announcements the organisation runs
 * on — and the audit trail with them, since the trail is a view of them. The
 * codebase already argues this for `audit_dismissals`: dismissing an event
 * writes a row precisely so that deleting the incident is not the way an
 * entry leaves the audit log.
 *
 * `provisioning_logs` is the opposite case and the only one here. It is
 * genuinely append-only — the rules grant admins create and read but never
 * update or delete — it records security-account provisioning, it grows
 * without bound, and its own consumer says so: "The page is a recent-activity
 * view, not an archive."
 *
 * So: one collection, deletion only below a cutoff, and `0` days cannot
 * produce a cutoff at all (`retentionCutoff` returns null, not `now`).
 *
 * Deleting is what makes this pass terminate — every row removed is a row the
 * next query cannot return — so it needs no cursor, only a ceiling.
 */
async function sweepAuditRetention(nowMs, settings) {
  const cutoffMs = retentionCutoff(nowMs, settings.auditRetentionDays);
  // `auditRetentionDays` is on the heartbeat under `settings`, so a reader can
  // already see that 0 is why nothing was deleted. No extra field for it: a key
  // written on some runs and not others survives the merge and goes stale.
  if (cutoffMs === null) return { deleted: 0 };

  const cutoff = new Date(cutoffMs);
  let deleted = 0;

  for (let pass = 0; pass < MAX_DELETE_BATCHES; pass += 1) {
    const snap = await db()
      .collection("provisioning_logs")
      .where("at", "<=", cutoff)
      .orderBy("at", "asc")
      .limit(MAX_DELETES_PER_BATCH)
      .get();

    if (snap.empty) break;

    const batch = db().batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < MAX_DELETES_PER_BATCH) break;
  }

  if (deleted > 0) {
    console.log(
      `[sweep] deleted ${deleted} provisioning_logs row(s) older than ` +
        `${settings.auditRetentionDays} days`,
    );
  }
  return { deleted };
}

// ── The job ─────────────────────────────────────────────────────────────────

exports.operationsSweep = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every 1 minutes")
  .onRun(async () => {
    const nowMs = Date.now();
    const stateRef = db().doc(STATE_DOC);

    const [raw, stateSnap] = await Promise.all([loadSettings(), stateRef.get()]);
    const settings = sweepSettings(raw);
    const state = stateSnap.exists ? stateSnap.data() : {};

    /**
     * The heartbeat is written with `{ merge: true }`, and merge RECURSES into
     * maps while REPLACING arrays wholesale. Both facts shape this object:
     *
     *   - every counter is initialised, so a pass that did not run this tick
     *     reports 0 rather than leaving last run's figure in place to be read
     *     as current;
     *   - `errors` is an array, not a map. As a map, a retention failure would
     *     merge into the document and stay there for every later run that
     *     succeeded — a permanent red mark for a problem that fixed itself an
     *     hour ago. As an array it is replaced each time.
     */
    const result = {
      at: serverNow(),
      settings,
      escalated: 0,
      open: 0,
      ackBreaches: 0,
      resolveBreaches: 0,
      slaWrites: 0,
      archived: 0,
      archiveExamined: 0,
      deleted: 0,
      errors: [],
    };

    function failed(pass, err) {
      console.error(`[sweep] ${pass} pass failed`, err);
      result.errors.push(`${pass}: ${err && err.message ? err.message : err}`);
    }

    // Ordered by urgency. An error in a later pass is recorded and does not
    // prevent an earlier one from having run.
    try {
      Object.assign(result, await sweepEscalations(nowMs, settings));
    } catch (err) {
      failed("escalation", err);
    }

    try {
      Object.assign(result, await sweepSla(nowMs, settings));
    } catch (err) {
      failed("sla", err);
    }

    const patch = {};

    if (isDue(state.hazardRanAt, nowMs, HAZARD_INTERVAL_MS)) {
      try {
        const pass = await sweepHazardArchive(nowMs, settings, state);
        result.archived = pass.archived;
        result.archiveExamined = pass.examined;
        patch.hazardRanAt = serverNow();
        // Only move the cursor when the pass actually looked at something.
        if (pass.hazardWatermark) patch.hazardWatermark = pass.hazardWatermark;
      } catch (err) {
        failed("hazard", err);
      }
    }

    if (isDue(state.retentionRanAt, nowMs, RETENTION_INTERVAL_MS)) {
      try {
        Object.assign(result, await sweepAuditRetention(nowMs, settings));
        patch.retentionRanAt = serverNow();
      } catch (err) {
        failed("retention", err);
      }
    }

    // One state write per run, whatever ran. `lastRun` is what the Admin
    // console can read to show that the sweep is alive and what it last did —
    // a scheduled job with no visible heartbeat is indistinguishable from one
    // that has been failing for a month.
    await stateRef.set({ ...patch, lastRun: result, updatedAt: serverNow() }, { merge: true });

    return null;
  });
