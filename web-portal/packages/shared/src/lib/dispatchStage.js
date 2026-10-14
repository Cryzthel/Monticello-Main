/**
 * The dispatch state machine — the vocabulary, and nothing that does I/O.
 *
 *   DISPATCHED ──► RESPONDING ──► RESOLVED
 *
 * ── IT WAS FIVE STAGES, AND THE TWO IN THE MIDDLE WERE FRICTION ───────────
 * ON-SITE and INVESTIGATING came out. They described real things — the guard
 * arriving, and then starting to work — and the cost of recording them was a
 * guard taking their phone out twice, at a scene, to tell a console something
 * it could have worked out. That is the wrong trade in the middle of an
 * emergency, and the stages after the first one were routinely pressed late
 * or in a batch at the end, which made the timestamps worse than no
 * timestamps.
 *
 * RESPONDING now covers en route, on scene and handling. What is NOT lost is
 * the arrival itself: `onSceneAt` is still stamped, automatically, when the
 * assigned unit's own telemetry comes within ARRIVAL_RADIUS_M of the pin (see
 * `autoArrival` in lib/dispatchWorkflow.js). The response-target metric still
 * has its endpoint and the resident still gets the On-Site notification; the
 * only thing that went is the button.
 *
 * ── LEGACY DOCUMENTS STILL READ ──────────────────────────────────────────
 * Calls already stored at `on_site` or `investigating` are mapped to
 * `responding` on read (see `deriveDispatchStage`), so nothing in flight when
 * this shipped becomes unrepresentable and no migration was needed. The rules
 * still accept those two as a starting point for a resolve, for the same
 * reason.
 *
 * ── A SECOND FIELD, NOT NEW STATUSES ───────────────────────────────────────
 * The stage lives in `dispatchStage`. `status` keeps the five wire values the
 * resident app already understands, and each stage writes the one it maps to
 * (STAGE_TO_WIRE_STATUS). The Flutter app reads an unknown status as
 * "Pending", so a new wire value like `responding` would have told a resident
 * whose guard was running towards them that nobody had looked at their report
 * yet. Two fields cost nothing, and a resident on an old build keeps reading
 * the truth.
 *
 * ── THE RULES ARE THE AUTHORITY ─────────────────────────────────────────────
 * firestore.rules enforces every edge below (see `validTransition` there). This
 * file mirrors those edges so the console can say which one comes next. It
 * cannot allow anything the rules refuse. A stage skipped here is still
 * rejected by the server. The two are edited together.
 *
 * Kept free of Firebase imports so it can be unit-run in Node and imported by
 * both portals without initialising anything.
 */

export const DISPATCH_STAGES = ['dispatched', 'responding', 'resolved']

/**
 * Stages this console no longer writes, but may still READ off a document
 * that was mid-flight when the machine was shortened.
 *
 * Deliberately not in `DISPATCH_STAGES`: the stepper, `nextStage` and
 * `stageIndex` must all behave as though there are three, or a legacy call
 * would render a two-step gap nobody can cross.
 */
export const LEGACY_STAGES = ['on_site', 'investigating']

/** Before the first dispatch. Not a stored value: an absent field reads as this. */
export const UNASSIGNED_STAGE = 'none'

export const STAGE_LABELS = {
  none: 'Awaiting dispatch',
  dispatched: 'Dispatched',
  responding: 'Responding',
  resolved: 'Resolved',
  // Read-only, for a document stored before the machine was shortened.
  on_site: 'Responding',
  investigating: 'Responding',
}

/**
 * Which `status` each stage writes. Two stages share a wire value twice over:
 * a resident sees "Dispatched" from the moment a guard is picked until they
 * arrive, and "On-Site" for as long as the guard is with them.
 */
/**
 * ── THE RESIDENT'S VIEW DID NOT COLLAPSE WITH THE STAGES ──────────────────
 * `responding` maps to `dispatched` here and the resident is moved on to
 * `in_progress` by the ARRIVAL stamp instead — which still happens, now
 * automatically (see `autoArrival`). Collapsing the wire status along with
 * the stage would have taken the "a guard is here now" signal off the
 * resident's phone, which is the one update in this whole machine they
 * actually feel, and nobody asked for that.
 */
export const STAGE_TO_WIRE_STATUS = {
  dispatched: 'dispatched',
  responding: 'dispatched',
  resolved: 'resolved',
  on_site: 'in_progress',
  investigating: 'in_progress',
}

/** The display status each stage maps to, for the resident notification call. */
export const STAGE_TO_DISPLAY_STATUS = {
  dispatched: 'Dispatched',
  responding: 'Dispatched',
  on_site: 'On-Site',
  investigating: 'On-Site',
  resolved: 'Resolved',
}

/**
 * For a document old enough to have no `dispatchStage` at all — only the wire
 * status the resident app has always read.
 *
 * `in_progress` maps to RESPONDING, not to the on-site stage it used to:
 * the value has to be one `DISPATCH_STAGES` contains, or the stepper renders
 * a stage that is not on it and `stageIndex` answers 0 for a call that is
 * plainly under way. The two legacy stage VALUES are handled a step earlier
 * in `deriveDispatchStage`; this is the older fallback beneath them.
 */
const LEGACY_WIRE_TO_STAGE = {
  dispatched: 'responding',
  in_progress: 'responding',
  resolved: 'resolved',
  closed: 'resolved',
  false_alarm: 'resolved',
}

/**
 * The stage a Firestore incident document is in.
 *
 * Takes the RAW document (wire `status`), not a mapped one. A report written
 * before this field existed has no `dispatchStage`, so it is read from the
 * old status exactly the way firestore.rules' `currentStage()` reads it:
 *
 *   dispatched   → responding. The old console booked the call to whoever
 *                  pressed Dispatch or Acknowledge & Respond, so that guard has
 *                  already accepted it.
 *   in_progress  → on_site.
 *
 * Anything else, including pending and verifying, has not been dispatched.
 */
export function deriveDispatchStage(raw) {
  const stored = raw?.dispatchStage
  if (DISPATCH_STAGES.includes(stored)) return stored
  // A call that was on scene or being investigated when the machine was
  // shortened is, in the new vocabulary, exactly "responding". Mapping it on
  // READ rather than migrating the documents means nothing had to be
  // rewritten under a live shift, and an old console still showing the
  // granular stage stays correct about the same call.
  if (LEGACY_STAGES.includes(stored)) return 'responding'
  return LEGACY_WIRE_TO_STAGE[raw?.status] ?? UNASSIGNED_STAGE
}

/** The one stage that may follow `stage`, or null at the end. */
export function nextStage(stage) {
  if (stage === UNASSIGNED_STAGE) return 'dispatched'
  const index = DISPATCH_STAGES.indexOf(stage)
  return index >= 0 && index < DISPATCH_STAGES.length - 1 ? DISPATCH_STAGES[index + 1] : null
}

/** 0 before dispatch, 1…3 through the machine. For steppers and sorting. */
export function stageIndex(stage) {
  return DISPATCH_STAGES.indexOf(stage) + 1
}

/**
 * A call a guard is committed to: picked, and not yet closed.
 *
 * The two legacy stages are still named here. This is asked about raw stored
 * values in places that have not been through `deriveDispatchStage` — the
 * telemetry hook's open-call query among them — and a document left at
 * `on_site` is every bit as active as one at `responding`.
 */
export function isActiveStage(stage) {
  return (
    stage === 'dispatched' ||
    stage === 'responding' ||
    stage === 'on_site' ||
    stage === 'investigating'
  )
}

/**
 * The dead-man switch. A guard who has not pressed Acknowledge & Respond this
 * long after being dispatched has either not seen it or cannot answer, and
 * the dispatcher is alerted to reassign.
 */
export const ACK_TIMEOUT_MS = 90_000

/**
 * How close, in metres, "I have arrived" must be to the pin to pass without an
 * override. The rules check the same number against the fix the guard submits.
 */
export const ARRIVAL_RADIUS_M = 30

/** Mirrors the list in firestore.rules — the rules refuse any other value. */
/**
 * ── THE LABELS ARE PLAIN ENGLISH; THE VALUES ARE NOT TOUCHED ─────────────
 *
 * "Referred to authorities", "Medical handover" and "Resolved on site" are
 * report-writing language. The person choosing from this list is a guard
 * standing at a gate at two in the morning deciding how a call ended, and
 * the words should be the ones they would use out loud.
 *
 * ONLY the `label` changed. Each `value` is enforced by firestore.rules
 * (`r.outcome in [...]`) and is already written into every resolved call in
 * the history, so renaming one would refuse new writes AND orphan the old
 * records. Labels are display; values are schema. Keeping that split is what
 * makes this a copy change rather than a migration.
 */
export const RESOLUTION_OUTCOMES = [
  { value: 'resolved_on_site', label: 'Handled on the spot' },
  // ── TWO ADDED 2026-10-14 ──────────────────────────────────────────────
  // Both describe calls that were genuinely ENDED by the officer, and both
  // were previously filed under "Handled on the spot" because there was
  // nowhere else for them to go — which made that one value mean "resolved,
  // somehow" and cost the history the distinction between a neighbour
  // argument talked down and an intruder seen off.
  //
  // The labels are the guard's own words, per the note above: a dispute is
  // SETTLED and a threat is STOPPED. "Mediated" and "neutralised" are the
  // report-writing register this list was deliberately taken out of.
  //
  // `threat_contained`, not `threat_neutralised`: a wire value that forces
  // a future reader to guess -ise or -ize is a wire value that will
  // eventually be written both ways.
  { value: 'dispute_mediated', label: 'Settled a dispute' },
  { value: 'threat_contained', label: 'Stopped a threat' },
  { value: 'referred_authorities', label: 'Passed to police / barangay' },
  { value: 'medical_handover', label: 'Medical assist' },
  { value: 'false_alarm', label: 'False alarm' },
  { value: 'no_issue_found', label: 'Nothing found' },
  { value: 'resident_unreachable', label: 'Could not reach resident' },
]

/** Mirrors the list in firestore.rules. */
/** Same rule as the outcomes above: labels are plain English, values are schema. */
export const INVESTIGATION_TAGS = [
  { value: 'area_secured', label: 'Checked and secured the area' },
  // ── TWO ADDED 2026-10-14 ──────────────────────────────────────────────
  // The two most common things an officer actually does on a call that the
  // list had no way to record. Speaking to the resident is the single most
  // frequent action in this whole machine and went unlogged entirely; a
  // warning is the usual outcome of a noise or parking call and was
  // previously only recoverable by reading the free-text notes.
  { value: 'resident_contacted', label: 'Spoke to the resident' },
  { value: 'medical_requested', label: 'Called an ambulance' },
  { value: 'police_requested', label: 'Called the police' },
  { value: 'fire_requested', label: 'Called the fire service' },
  { value: 'warning_issued', label: 'Gave a warning' },
  { value: 'suspect_detained', label: 'Detained someone' },
  { value: 'property_damage', label: 'Found property damage' },
]

export const RESOLUTION_NOTES_MIN = 10
export const RESOLUTION_NOTES_MAX = 1000
export const RESOLUTION_PHOTOS_MAX = 6
export const INVESTIGATION_PHOTOS_MAX = 12
export const OVERRIDE_REASON_MIN = 3
