/**
 * Every decision the scheduled sweep makes, under bare node.
 *
 *   node scripts/sweepRules.test.cjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The sweep escalates live emergencies, archives reports and deletes audit
 * rows, and it cannot be deployed or run against the emulator while this
 * project is on the Spark plan. Untestable destructive code is not something
 * to ship on the strength of having read it carefully, so the decisions were
 * pulled into a pure module and the module is pinned here.
 *
 * The cases that matter most are the ones asserting the sweep does NOTHING:
 * a pending `serverTimestamp()` must not read as "old", an open report must
 * never be archived, and a retention window of 0 must not delete everything.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rules = require(path.join(__dirname, "..", "sweepRules.js"));
const {
  MINUTE,
  HOUR,
  DAY,
  LIMITS,
  AUDIT_RETENTION_DAYS,
  asMillis,
  sweepSettings,
  shouldEscalateAlert,
  shouldArchiveResolved,
  retentionCutoff,
  slaBreach,
  breachChanged,
  isDue,
} = rules;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms);

// ── asMillis ────────────────────────────────────────────────────────────────

check("asMillis reads a Firestore Timestamp", () => {
  assert.strictEqual(asMillis({ toMillis: () => 1234 }), 1234);
});
check("asMillis reads a Date", () => {
  assert.strictEqual(asMillis(new Date(NOW)), NOW);
});
check("asMillis reads a number and an ISO string", () => {
  assert.strictEqual(asMillis(NOW), NOW);
  assert.strictEqual(asMillis("2026-09-24T12:00:00.000Z"), NOW);
});
check("asMillis reads the serialised Timestamp shapes", () => {
  assert.strictEqual(asMillis({ _seconds: 100, _nanoseconds: 0 }), 100000);
  assert.strictEqual(asMillis({ seconds: 100, nanoseconds: 0 }), 100000);
});
check("asMillis returns NaN for anything unusable", () => {
  [null, undefined, {}, "not a date", NaN, Infinity, true].forEach((value) => {
    assert.ok(Number.isNaN(asMillis(value)), `expected NaN for ${JSON.stringify(value)}`);
  });
});

// ── sweepSettings ───────────────────────────────────────────────────────────

check("sweepSettings falls back to current behaviour on an empty document", () => {
  const s = sweepSettings({});
  assert.strictEqual(s.escalateAfterMinutes, 3);
  assert.strictEqual(s.hazardTtlHours, 72);
  assert.strictEqual(s.ackTargetMinutes, 5);
  assert.strictEqual(s.resolveTargetHours, 24);
  assert.strictEqual(s.auditRetentionDays, 90);
});
check("sweepSettings survives null and a document with no groups", () => {
  assert.strictEqual(sweepSettings(null).escalateAfterMinutes, 3);
  assert.strictEqual(sweepSettings(undefined).hazardTtlHours, 72);
});
check("sweepSettings clamps values above and below the range", () => {
  const high = sweepSettings({
    sos: { escalateAfterMinutes: 9000 },
    incidents: { hazardTtlHours: 100000, ackTargetMinutes: 999, resolveTargetHours: 99999 },
  });
  assert.strictEqual(high.escalateAfterMinutes, 10);
  assert.strictEqual(high.hazardTtlHours, 720);
  assert.strictEqual(high.ackTargetMinutes, 120);
  assert.strictEqual(high.resolveTargetHours, 336);

  const low = sweepSettings({
    sos: { escalateAfterMinutes: -5 },
    incidents: { hazardTtlHours: 0, ackTargetMinutes: -1, resolveTargetHours: 0 },
  });
  assert.strictEqual(low.escalateAfterMinutes, 1);
  assert.strictEqual(low.hazardTtlHours, 1);
  assert.strictEqual(low.ackTargetMinutes, 1);
  assert.strictEqual(low.resolveTargetHours, 1);
});
check("sweepSettings rejects unparseable values", () => {
  const s = sweepSettings({
    sos: { escalateAfterMinutes: "soon" },
    incidents: { hazardTtlHours: {}, ackTargetMinutes: undefined },
  });
  assert.strictEqual(s.escalateAfterMinutes, 3);
  assert.strictEqual(s.hazardTtlHours, 72);
  assert.strictEqual(s.ackTargetMinutes, 5);
});
check("a stored null clamps to the minimum, matching the web sanitizer", () => {
  // Not the fallback: `Number(null)` is 0, which is a finite number, so it
  // clamps. The web sanitizer's `num()` does exactly the same thing, and the
  // two agreeing matters more than either being the nicer answer — a console
  // showing a 72-hour window while the sweep archives on a 1-hour one would be
  // a far worse failure than both reading a null the same blunt way.
  const s = sweepSettings({
    sos: { escalateAfterMinutes: null },
    incidents: { hazardTtlHours: null },
  });
  assert.strictEqual(s.escalateAfterMinutes, LIMITS.escalateAfterMinutes.min);
  assert.strictEqual(s.hazardTtlHours, LIMITS.hazardTtlHours.min);
});
check("sweepSettings accepts only offered retention windows", () => {
  assert.strictEqual(sweepSettings({ organisation: { auditRetentionDays: 30 } }).auditRetentionDays, 30);
  assert.strictEqual(sweepSettings({ organisation: { auditRetentionDays: 0 } }).auditRetentionDays, 0);
  assert.strictEqual(sweepSettings({ organisation: { auditRetentionDays: 45 } }).auditRetentionDays, 90);
  assert.strictEqual(sweepSettings({ organisation: { auditRetentionDays: -1 } }).auditRetentionDays, 90);
});

// ── 1. SOS escalation ───────────────────────────────────────────────────────

const activeAlert = (extra) => Object.assign({ status: "active", createdAt: ago(4 * MINUTE) }, extra);

check("escalates an active alert past the window", () => {
  assert.strictEqual(shouldEscalateAlert(activeAlert(), NOW, 3), true);
});
check("does not escalate before the window", () => {
  assert.strictEqual(shouldEscalateAlert(activeAlert({ createdAt: ago(2 * MINUTE) }), NOW, 3), false);
});
check("escalates exactly at the window", () => {
  assert.strictEqual(shouldEscalateAlert(activeAlert({ createdAt: ago(3 * MINUTE) }), NOW, 3), true);
});
check("escalation is one-shot", () => {
  assert.strictEqual(shouldEscalateAlert(activeAlert({ escalatedAt: ago(MINUTE) }), NOW, 3), false);
});
check("only an active alert escalates", () => {
  ["acknowledged", "resolved", "", "cancelled"].forEach((status) => {
    assert.strictEqual(shouldEscalateAlert(activeAlert({ status }), NOW, 3), false, status);
  });
});
check("status is read case-insensitively", () => {
  assert.strictEqual(shouldEscalateAlert(activeAlert({ status: "Active" }), NOW, 3), true);
  assert.strictEqual(shouldEscalateAlert(activeAlert({ status: " ACTIVE " }), NOW, 3), true);
});
check("a pending serverTimestamp does not escalate", () => {
  // The window between a client's create landing and the server resolving the
  // timestamp. Treating null as epoch would escalate every SOS on arrival.
  assert.strictEqual(shouldEscalateAlert({ status: "active", createdAt: null }, NOW, 3), false);
  assert.strictEqual(shouldEscalateAlert({ status: "active" }, NOW, 3), false);
});
check("a future createdAt does not escalate", () => {
  assert.strictEqual(
    shouldEscalateAlert({ status: "active", createdAt: new Date(NOW + 5 * MINUTE) }, NOW, 3),
    false,
  );
});
check("a missing alert does not escalate", () => {
  assert.strictEqual(shouldEscalateAlert(null, NOW, 3), false);
});

// ── 2. Hazard archiving ─────────────────────────────────────────────────────

const resolved = (extra) =>
  Object.assign({ status: "Resolved", resolvedAt: ago(100 * HOUR) }, extra);

check("archives a report resolved longer ago than the window", () => {
  assert.strictEqual(shouldArchiveResolved(resolved(), NOW, 72), true);
});
check("does not archive a recently resolved report", () => {
  assert.strictEqual(shouldArchiveResolved(resolved({ resolvedAt: ago(10 * HOUR) }), NOW, 72), false);
});
check("NEVER archives an open report, however old", () => {
  // The whole reason the sweep archives only the resolved half: an unfixed
  // hazard that ages out of the queue is one nobody is coming to fix.
  ["Pending", "Dispatched", "On-Site"].forEach((status) => {
    const incident = {
      status,
      reportedAt: ago(5000 * HOUR),
      resolvedAt: ago(5000 * HOUR),
    };
    assert.strictEqual(shouldArchiveResolved(incident, NOW, 1), false, status);
  });
});
check("does not re-archive", () => {
  assert.strictEqual(shouldArchiveResolved(resolved({ archivedAt: ago(HOUR) }), NOW, 72), false);
});
check("a resolved report with no resolvedAt is left alone", () => {
  assert.strictEqual(shouldArchiveResolved({ status: "Resolved" }, NOW, 72), false);
  assert.strictEqual(shouldArchiveResolved({ status: "Resolved", resolvedAt: null }, NOW, 72), false);
});
check("archiving respects a changed window", () => {
  const incident = resolved({ resolvedAt: ago(48 * HOUR) });
  assert.strictEqual(shouldArchiveResolved(incident, NOW, 72), false);
  assert.strictEqual(shouldArchiveResolved(incident, NOW, 24), true);
});

// ── 3. Audit retention ──────────────────────────────────────────────────────

check("retention cutoff is the keep-window back from now", () => {
  assert.strictEqual(retentionCutoff(NOW, 90), NOW - 90 * DAY);
  assert.strictEqual(retentionCutoff(NOW, 30), NOW - 30 * DAY);
});
check("ZERO DAYS DELETES NOTHING", () => {
  // 0 is "keep indefinitely" in the schema. A cutoff of `now` would delete the
  // entire audit log, so the null makes that unrepresentable rather than just
  // unlikely.
  assert.strictEqual(retentionCutoff(NOW, 0), null);
});
check("a nonsense window deletes nothing", () => {
  [-1, undefined, null, NaN, "ninety", {}].forEach((days) => {
    assert.strictEqual(retentionCutoff(NOW, days), null, String(days));
  });
});

// ── 4. SLA targets ──────────────────────────────────────────────────────────

const TARGETS = { ackTargetMinutes: 5, resolveTargetHours: 24 };

check("an undispatched report past the ack target breaches", () => {
  const b = slaBreach({ reportedAt: ago(10 * MINUTE) }, NOW, TARGETS);
  assert.strictEqual(b.ack, true);
  assert.strictEqual(b.resolve, false);
});
check("a report dispatched inside the target does not breach", () => {
  const b = slaBreach({ reportedAt: ago(10 * MINUTE), dispatchedAt: ago(7 * MINUTE) }, NOW, TARGETS);
  assert.strictEqual(b.ack, false);
});
check("a late dispatch still breaches after the fact", () => {
  const b = slaBreach({ reportedAt: ago(60 * MINUTE), dispatchedAt: ago(20 * MINUTE) }, NOW, TARGETS);
  assert.strictEqual(b.ack, true);
});
check("a fresh report breaches nothing", () => {
  const b = slaBreach({ reportedAt: ago(MINUTE) }, NOW, TARGETS);
  assert.deepStrictEqual(b, { ack: false, resolve: false });
});
check("an unresolved report past the resolve target breaches", () => {
  const b = slaBreach({ reportedAt: ago(30 * HOUR), dispatchedAt: ago(30 * HOUR) }, NOW, TARGETS);
  assert.strictEqual(b.resolve, true);
  assert.strictEqual(b.ack, false);
});
check("a report resolved inside the target does not breach", () => {
  const b = slaBreach(
    { reportedAt: ago(30 * HOUR), dispatchedAt: ago(30 * HOUR), resolvedAt: ago(8 * HOUR) },
    NOW,
    TARGETS,
  );
  assert.strictEqual(b.resolve, false);
});
check("a report with no reportedAt breaches nothing", () => {
  assert.deepStrictEqual(slaBreach({}, NOW, TARGETS), { ack: false, resolve: false });
  assert.deepStrictEqual(slaBreach({ reportedAt: null }, NOW, TARGETS), { ack: false, resolve: false });
});
check("clock skew into the future breaches nothing", () => {
  const b = slaBreach({ reportedAt: new Date(NOW + HOUR) }, NOW, TARGETS);
  assert.deepStrictEqual(b, { ack: false, resolve: false });
});

check("breachChanged only asks for a write when the flags move", () => {
  assert.strictEqual(breachChanged({}, { ack: false, resolve: false }), false);
  assert.strictEqual(breachChanged({}, { ack: true, resolve: false }), true);
  assert.strictEqual(
    breachChanged({ slaBreach: { ack: true, resolve: false } }, { ack: true, resolve: false }),
    false,
  );
  assert.strictEqual(
    breachChanged({ slaBreach: { ack: true, resolve: false } }, { ack: true, resolve: true }),
    true,
  );
  // Flags clearing is also a change — a badge has to be able to come off.
  assert.strictEqual(
    breachChanged({ slaBreach: { ack: true, resolve: false } }, { ack: false, resolve: false }),
    true,
  );
});

// ── Cadence ─────────────────────────────────────────────────────────────────

check("a pass that has never run is due", () => {
  assert.strictEqual(isDue(undefined, NOW, 55 * MINUTE), true);
  assert.strictEqual(isDue(null, NOW, 55 * MINUTE), true);
  assert.strictEqual(isDue("corrupt", NOW, 55 * MINUTE), true);
});
check("a pass that ran recently is not due", () => {
  assert.strictEqual(isDue(ago(10 * MINUTE), NOW, 55 * MINUTE), false);
});
check("a pass past its interval is due", () => {
  assert.strictEqual(isDue(ago(56 * MINUTE), NOW, 55 * MINUTE), true);
  assert.strictEqual(isDue(ago(21 * HOUR), NOW, 20 * HOUR), true);
  assert.strictEqual(isDue(ago(19 * HOUR), NOW, 20 * HOUR), false);
});

// ── Drift guard against the web sanitizer ───────────────────────────────────

/**
 * The ranges in sweepRules are a copy — CommonJS functions cannot import the
 * ES module the consoles use. A copy that is never checked is a copy that
 * silently disagrees, so this reads the real file and fails on any difference.
 */
const WEB_SANITIZER = path.join(
  __dirname,
  "..",
  "..",
  "web-portal",
  "packages",
  "shared",
  "src",
  "lib",
  "systemSettingsStore.js",
);

check("the copied ranges still match the web sanitizer", () => {
  const src = fs.readFileSync(WEB_SANITIZER, "utf8");
  const fields = {
    escalateAfterMinutes: "sos",
    hazardTtlHours: "incidents",
    ackTargetMinutes: "incidents",
    resolveTargetHours: "incidents",
  };
  Object.entries(fields).forEach(([field, group]) => {
    const pattern = new RegExp(
      `num\\(\\s*raw\\.${group}\\?\\.${field},\\s*[^,]+,\\s*(\\d+),\\s*(\\d+),?\\s*\\)`,
    );
    const match = src.match(pattern);
    assert.ok(match, `could not find the ${group}.${field} range in the web sanitizer`);
    const [min, max] = [Number(match[1]), Number(match[2])];
    assert.strictEqual(min, LIMITS[field].min, `${field} min drifted (web ${min})`);
    assert.strictEqual(max, LIMITS[field].max, `${field} max drifted (web ${max})`);
  });
});

check("the retention windows still match the web sanitizer", () => {
  const src = fs.readFileSync(WEB_SANITIZER, "utf8");
  const match = src.match(/AUDIT_RETENTION_DAYS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/);
  assert.ok(match, "could not find AUDIT_RETENTION_DAYS in the web sanitizer");
  const web = match[1].split(",").map((part) => Number(part.trim()));
  assert.deepStrictEqual(web, Array.from(AUDIT_RETENTION_DAYS));
});

check("the status literals the sweep filters on exist on the web side", () => {
  const dir = path.join(__dirname, "..", "..", "web-portal", "packages", "shared", "src", "lib");
  const src = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
  ["Pending", "Dispatched", "On-Site", "Resolved"].forEach((status) => {
    assert.ok(src.includes(`'${status}'`), `no web code uses the status '${status}'`);
  });
});

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach((line) => console.error(`  FAIL  ${line}`));
  process.exit(1);
}
