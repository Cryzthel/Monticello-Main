/**
 * Do the console and the sweep agree, on every input?
 *
 *   npm run test:agreement            (from functions/)
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 * `functions/sweepRules.js` restates four numeric ranges that really live in
 * `web-portal/packages/shared/src/lib/systemSettingsStore.js`, because the
 * functions are CommonJS in a separately uploaded package and the consoles'
 * copy is an ES module inside the Vite workspace — there is no import across
 * that line without adding a build step to the functions.
 *
 * The unit suite guards the ranges by reading the web file as text. This goes
 * further and RUNS both sanitizers over the same matrix of hostile inputs,
 * which is the only way to catch the disagreements that are not visible in the
 * numbers: `Number(null)` is 0, so a stored null clamps to the minimum rather
 * than falling back — behaviour neither file states and both must share.
 *
 * Why that matters: an administrator reading "72 hours" in Settings while the
 * sweep archives on a one-hour window is a worse failure than any single
 * reading of a null, because nothing on either surface would look wrong.
 *
 * ── NOT PART OF `npm test` ──────────────────────────────────────────────────
 * It imports the console module, which imports react, so it needs the
 * web-portal workspace installed. `npm test` stays dependency-free and always
 * runnable; this is the deeper check to run when either sanitizer is touched.
 */

import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
// `fileURLToPath`, not `new URL(...).pathname`: on Windows the latter hands
// back "/C:/Users/..." with the separators still percent-encoded, and
// path.resolve then prepends the drive again.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const web = await import(
  pathToFileURL(
    path.join(root, 'web-portal', 'packages', 'shared', 'src', 'lib', 'systemSettingsStore.js'),
  ).href
)
const sweep = require(path.join(root, 'functions', 'sweepRules.js'))

// Plain ESM with no react import, so this one loads without the workspace.
const targets = await import(
  pathToFileURL(
    path.join(root, 'web-portal', 'packages', 'shared', 'src', 'lib', 'operationsTargets.js'),
  ).href
)

/** Legal values, illegal values, and the shapes a hand-edited document has. */
const VALUES = [
  undefined, null, 0, -1, -9999, 1, 3, 5, 24, 72, 90, 336, 720, 9999,
  '', '5', '72', 'soon', {}, [], true, false, NaN, Infinity, 1.5, 2.7,
]

const FIELDS = [
  ['sos', 'escalateAfterMinutes'],
  ['incidents', 'hazardTtlHours'],
  ['incidents', 'ackTargetMinutes'],
  ['incidents', 'resolveTargetHours'],
  ['organisation', 'auditRetentionDays'],
]

let checked = 0
const disagree = []

for (const [group, field] of FIELDS) {
  for (const value of VALUES) {
    const raw = { [group]: { [field]: value } }
    const a = web.sanitizeSettings(raw)[group][field]
    const b = sweep.sweepSettings(raw)[field]
    checked += 1
    if (!Object.is(a, b)) {
      disagree.push(`${group}.${field} = ${JSON.stringify(value)} -> web ${a}, sweep ${b}`)
    }
  }
}

// The empty document, which is what actually ships until someone saves.
for (const [group, field] of FIELDS) {
  const a = web.sanitizeSettings({})[group][field]
  const b = sweep.sweepSettings({})[field]
  checked += 1
  if (!Object.is(a, b)) disagree.push(`EMPTY ${group}.${field} -> web ${a}, sweep ${b}`)
}

// ── 2. Would the sweep escalate this alert? ────────────────────────────────
//
// `escalationDue` in the console is a mirror of `shouldEscalateAlert` in the
// sweep. It has to be: the console derives "Unattended" live so the badge works
// before the sweep can deploy, and the sweep stamps the same state durably. The
// two disagreeing means the console and the server arguing about an emergency.
const NOW = Date.parse('2026-09-24T12:00:00.000Z')
const MIN = 60 * 1000

const CREATED = [
  undefined, null, 0, NaN, 'not a date',
  new Date(NOW), new Date(NOW - MIN), new Date(NOW - 3 * MIN), new Date(NOW - 10 * MIN),
  new Date(NOW + 5 * MIN),
  NOW - 4 * MIN,
  '2026-09-24T11:54:00.000Z',
  { toMillis: () => NOW - 6 * MIN },
  { _seconds: (NOW - 7 * MIN) / 1000 },
]

for (const status of ['active', 'Active', ' ACTIVE ', 'acknowledged', 'resolved', '', undefined]) {
  for (const createdAt of CREATED) {
    for (const escalatedAt of [undefined, new Date(NOW - MIN)]) {
      for (const minutes of [1, 3, 10]) {
        const alert = { status, createdAt, escalatedAt }
        const a = sweep.shouldEscalateAlert(alert, NOW, minutes)
        const b = targets.escalationDue(alert, NOW, minutes)
        checked += 1
        if (a !== b) {
          disagree.push(
            `escalate status=${status} created=${String(createdAt)} esc=${Boolean(escalatedAt)} ` +
              `m=${minutes} -> sweep ${a}, console ${b}`,
          )
        }
      }
    }
  }
}

// ── 3. Has this report missed its targets? ─────────────────────────────────
const STAMPS = [undefined, null, new Date(NOW - 9 * MIN), new Date(NOW - 25 * 60 * MIN)]

for (const reportedAt of [undefined, new Date(NOW - MIN), new Date(NOW - 10 * MIN),
  new Date(NOW - 30 * 60 * MIN), new Date(NOW + 60 * MIN)]) {
  for (const dispatchedAt of STAMPS) {
    for (const resolvedAt of STAMPS) {
      for (const t of [
        { ackTargetMinutes: 5, resolveTargetHours: 24 },
        { ackTargetMinutes: 1, resolveTargetHours: 1 },
        { ackTargetMinutes: 120, resolveTargetHours: 336 },
      ]) {
        const incident = { reportedAt, dispatchedAt, resolvedAt }
        const a = sweep.slaBreach(incident, NOW, t)
        const b = targets.slaBreachState(incident, NOW, t)
        checked += 1
        if (a.ack !== b.ack || a.resolve !== b.resolve) {
          disagree.push(
            `sla reported=${String(reportedAt)} disp=${String(dispatchedAt)} ` +
              `res=${String(resolvedAt)} t=${t.ackTargetMinutes}/${t.resolveTargetHours} -> ` +
              `sweep ${JSON.stringify(a)}, console ${JSON.stringify(b)}`,
          )
        }
      }
    }
  }
}

// ── 4. And the two asMillis implementations ────────────────────────────────
for (const value of [...CREATED, true, {}, [], Infinity, { seconds: 100 }]) {
  const a = sweep.asMillis(value)
  const b = targets.asMillis(value)
  checked += 1
  const same = Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))
  if (!same) disagree.push(`asMillis ${String(value)} -> sweep ${a}, console ${b}`)
}

console.log(`${checked} input(s) compared, ${disagree.length} disagreement(s)`)
disagree.forEach((line) => console.log(`  DIFF  ${line}`))
process.exit(disagree.length === 0 ? 0 : 1)
