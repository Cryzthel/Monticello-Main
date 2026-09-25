import { Circle, Send, Navigation, CheckCircle2, ShieldX, ShieldCheck, Clock } from 'lucide-react'

// One definition of what every incident/resident status LOOKS like, for both
// portals. Previously each surface styled its own: the tickets table printed
// plain grey text, the triage card used a bare <select>, and the residents
// table had its own local tone map — so "Dispatched" was a different colour
// depending on which screen you were on.
//
// Lives in shared/theme (next to severityColors.js) rather than beside the
// components so the constants and the components can be imported
// independently — a .jsx file that exports both breaks Fast Refresh.
//
// `dot` is the marker colour; `tone` is the semantic key StatusBadge resolves
// into the shared oblong pill treatment (see shared/components/StatusBadge.jsx
// — that file owns the fill/ring/text triplet now, so a status is described
// here by MEANING and rendered there by one rule).
//
// Keys are the display vocabulary (see STATUS_TO_DISPLAY in
// shared/lib/incidents.js), not the Firestore wire values.
export const STATUS_STYLES = {
  Pending: {
    icon: Clock,
    dot: 'bg-warning',
    tone: 'warning',
  },
  // `verifying` on the wire. Security has looked at the report and confirmed it
  // is real — the first thing an operator can assert about an incoming ticket,
  // and the first of the three actions the detail modal offers.
  Verified: {
    icon: ShieldCheck,
    dot: 'bg-info',
    tone: 'info',
  },
  Dispatched: {
    icon: Send,
    dot: 'bg-info',
    tone: 'info',
  },
  // `in_progress` on the wire. "On-Site" is the third name this state has
  // carried — On-Scene, then In Progress, now this — and the reason it moved
  // again is that the other two were describing different things. "In
  // Progress" is a workflow word: true of a report the moment anyone touches
  // it, and equally true of one sitting in a queue. "On-Site" is the fact a
  // dispatcher and a resident both actually care about, and it is what the
  // button that sets it now says.
  'On-Site': {
    icon: Navigation,
    dot: 'bg-brand-500',
    tone: 'brand',
  },
  Resolved: {
    icon: CheckCircle2,
    dot: 'bg-success',
    tone: 'success',
  },
  Rejected: {
    icon: ShieldX,
    dot: 'bg-danger',
    tone: 'danger',
  },
}

// ── EVERY NAME THIS STATE HAS EVER HAD, ALIASED ───────────────────────────
//
// `in_progress` is the wire value; "On-Site" above is the current display
// label. Both older spellings are kept pointing at the same style object,
// because a badge is fed a STRING and there are three places a stale one can
// still come from: a Firestore document written before the rename, a filter
// preference persisted in localStorage, and the Flutter app, which derives its
// own label independently (see incident.dart) and still says "In Progress".
//
// The cost of an alias is one line. The cost of missing one is a status pill
// that silently falls through to the neutral grey fallback — which does not
// look like a bug, it looks like a status nobody has set.
STATUS_STYLES['In Progress'] = STATUS_STYLES['On-Site']
STATUS_STYLES['On-Scene'] = STATUS_STYLES['On-Site']

// Anything unrecognised (e.g. the "All" entry a filter dropdown adds) reads as
// neutral rather than borrowing another status's colour.
const FALLBACK = {
  icon: Circle,
  dot: 'bg-text-muted',
  tone: 'neutral',
}

export function statusStyle(status) {
  return STATUS_STYLES[status] ?? FALLBACK
}

// ── TWO LISTS, AND THE DIFFERENCE MATTERS ──────────────────────────────────
//
// [INCIDENT_STATUSES] is every state a report can BE IN. It drives the filter
// dropdowns and the badges, so it has to include states an operator can no
// longer SET — `Pending` is where every report starts, and `Dispatched` is where
// thousands of existing records already sit. Dropping either would make those
// reports unfilterable and render their badge as the neutral fallback.
//
// [STATUS_ACTIONS] is what a detail surface may offer as buttons. Keeping the
// two lists separate is what lets the settable set shrink without erasing
// history — the filter dropdowns must go on offering states nobody can set.
export const INCIDENT_STATUSES = [
  'Pending',
  'Verified',
  'Dispatched',
  'On-Site',
  'Resolved',
]

// ── SETTABLE_STATUSES IS GONE ─────────────────────────────────────────────
//
// It existed to populate the per-row status dropdown in IncidentsTable, and
// that dropdown is deleted: status is now driven only from the Live Dispatch
// map's detail drawer, one dispatch stage at a time (see
// shared/lib/dispatchStage.js and security-portal/src/lib/dispatchWorkflow.js,
// which firestore.rules enforces — that is the authoritative "what an operator
// may set" now).
//
// Removing it rather than leaving it exported is the point: a constant named
// "what an operator may SET" with no consumer would describe an authority no
// screen in either portal still offers.

export const STATUS_ACTIONS = ['On-Site', 'Resolved']

// Everything that is not finished. Derived from INCIDENT_STATUSES rather than
// hand-listed, which is the whole point: the two pages that count "active
// incidents" each carried their own literal set, and when `On-Scene` was
// renamed to `In Progress` both silently stopped counting in-progress reports —
// a KPI that under-reports is worse than one that errors. Deriving means a
// future rename cannot desynchronise them.
export const ACTIVE_STATUSES = new Set(
  INCIDENT_STATUSES.filter((status) => status !== 'Resolved'),
)
