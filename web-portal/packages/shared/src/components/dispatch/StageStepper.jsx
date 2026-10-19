import { Check } from '@shared/icons'
import { STAGE_LABELS, deriveDispatchStage, stageIndex } from '@shared/lib/dispatchStage'
import { formatTime } from '@shared/lib/dates'

/**
 * DISPATCHED → RESPONDING → RESOLVED, with the time each step was reached.
 * Done steps are filled, the current one is ringed, the rest are muted. An
 * ordered list, so a screen reader reads it as steps.
 *
 * ── ONE PIPELINE, DRAWN ONCE, FOR BOTH CONSOLES ────────────────────────────
 * This lived in the Guardhouse's `components/dispatch/parts.jsx`, and the
 * Admin console's inspection rail carried its own private copy called
 * `StageReadout`. The two drifted, in the two ways a duplicated component
 * always does:
 *
 *   • GEOMETRY. The Guardhouse's was corrected to a centred flex row when the
 *     machine lost its two middle stages; the Admin copy was left at
 *     `grid grid-cols-5`, so three stages were strung across five columns'
 *     worth of rail, left-weighted, with the connectors reaching over the
 *     empty columns. One console drew a pipeline, the other drew the ghost of
 *     the five-stage machine.
 *
 *   • SOURCE OF TRUTH. The Guardhouse's takes the stage from its caller, which
 *     derives it once with `deriveDispatchStage`. The Admin copy fed
 *     `report.dispatchStage` — the stored field — straight to `stageIndex`,
 *     which answers `-1 + 1 = 0` for the retired `on_site` and
 *     `investigating`, i.e. draws an in-flight emergency as not yet
 *     dispatched. It did not actually misdraw, and it is worth being exact
 *     about why rather than claiming a bug that was not there: its one caller
 *     feeds it `mapIncidentDoc` output, which has already replaced that field
 *     with `deriveDispatchStage(raw)`. The readout was correct by virtue of
 *     who called it, which is the kind of correctness that survives exactly
 *     until someone passes a raw document.
 *
 * Both are fixed by there being one of these. The stage is PASSED IN, with a
 * derivation only as a fallback — two readers of one fact will eventually
 * disagree, so the caller owns it and this renders what it is given. The
 * fallback is idempotent on an already-derived stage, so it is safe either
 * way round.
 */

/** Step names where the stage vocabulary has none of its own. */
const STEP_LABELS = { on_site: 'Arrived on scene' }

const STAGE_STAMPS = {
  dispatched: 'dispatchedAt',
  responding: 'respondingAt',
  on_site: 'onSceneAt',
  investigating: 'investigatingAt',
  resolved: 'resolvedAt',
}

/**
 * When a step happened, with fallbacks for calls that went through the older
 * five-stage machine. Those never wrote `respondingAt` — they wrote
 * `acknowledgedAt`, then `onSceneAt` — so a call that was plainly responding
 * showed "—" under Responding. The first stamp that exists is the moment the
 * step began.
 */
const stampFor = (report, key) => {
  if (key === 'responding') return report.respondingAt ?? report.acknowledgedAt
  return report[STAGE_STAMPS[key]]
}

/**
 * The four steps both consoles draw (2026-10-19, by request): Acknowledged →
 * En route → Arrived on scene → Resolved. ARRIVAL IS NOT A STORED STAGE — the
 * machine keeps three (dispatchStage.js), and arriving stamps `onSceneAt`
 * without moving it — so the third step is read off that stamp. No document
 * changes shape, and the resident app is untouched.
 */
const STEPS = ['dispatched', 'responding', 'on_site', 'resolved']

/** 0 before acknowledgement, then 1–4. */
function stepIndex(stage, report) {
  if (stage === 'resolved') return 4
  if (stage === 'responding') return report?.onSceneAt ? 3 : 2
  return stageIndex(stage)
}

/**
 * `labels` overrides the step names per console (the Guardhouse names its own
 * steps); anything it leaves out falls back to STAGE_LABELS.
 */
export default function StageStepper({ report, stage, labels = null }) {
  const current = stepIndex(stage ?? deriveDispatchStage(report), report)
  return (
    /* ── CENTRED, AND NOT A FIVE-COLUMN GRID ─────────────────────────────
       It was `grid grid-cols-5`, one column per stage, stretched across the
       full width of the drawer. Two of those stages have gone, which left
       three labels strung out over five columns' worth of rail with the
       connectors reaching across the gaps — the layout was describing a
       machine that no longer exists.

       A centred flex row instead: the three nodes size to their content and
       sit in the middle of the card, with the connectors taking only the
       space between them. `max-w-sm` stops the row spreading to the full
       416px of the rail, where three items read as three unrelated columns
       rather than one pipeline. */
    <ol
      className="mx-auto flex w-full max-w-md items-start justify-center"
      aria-label="Dispatch stage"
    >
      {STEPS.map((key, i) => {
        const step = i + 1
        const done = step < current || (step === current && key === 'resolved')
        const active = step === current && !done
        const at = stampFor(report, key)
        return (
          <li
            key={key}
            aria-current={active ? 'step' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${
                  step <= current ? 'bg-brand-500' : 'bg-tint/10'
                }`}
              />
            ) : null}
            {/* The step in progress pulses, so "where the call is now" reads
                at a glance; done steps carry a check, later ones stay muted. */}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 z-[1] h-6 w-6 -translate-x-1/2 animate-ping rounded-full bg-brand-500/40 motion-reduce:hidden"
              />
            ) : null}
            <span
              className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold transition-colors duration-200 ${
                done
                  ? 'bg-brand-500 text-base-900'
                  : active
                    ? 'bg-base-800 text-brand-400 ring-2 ring-brand-500'
                    : 'bg-base-800 text-text-muted ring-1 ring-tint/15'
              }`}
            >
              {done ? <Check size="sm" strokeWidth={3} aria-hidden="true" /> : step}
            </span>
            <span
              className={`mt-1.5 line-clamp-2 w-full px-1 text-2xs font-semibold leading-tight ${
                active ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
              }`}
            >
              {labels?.[key] ?? STEP_LABELS[key] ?? STAGE_LABELS[key]}
            </span>
            <span className={`text-2xs tabular-nums ${at ? 'text-text-secondary' : 'text-text-muted/60'}`}>
              {formatTime(at)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
