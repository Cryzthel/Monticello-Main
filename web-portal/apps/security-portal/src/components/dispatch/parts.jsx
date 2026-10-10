import { Check } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { categoryColor, categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'
import { DISPATCH_STAGES, STAGE_LABELS, deriveDispatchStage, stageIndex } from '@shared/lib/dispatchStage'
import { categoryIcon } from '@shared/theme/categoryIcons'

/**
 * Small pieces of the dispatch drawer, kept apart from it so the drawer file
 * reads as layout and the unit picker can reuse the telemetry badges.
 */

/**
 * Stage → badge tone, now that there are three of them.
 *
 *   dispatched  amber   — assigned, nobody has answered yet
 *   responding  blue    — a guard owns it and is working it
 *   resolved    emerald — closed
 *
 * ── RESPONDING TOOK ON-SITE'S BLUE, AND THAT IS THE POINT ────────────────
 * It was `high` (orange) while on-site held blue and investigating held
 * violet — four warm-to-cool steps for a reader to learn, when the only
 * question a dispatcher scanning a list asks is "has anyone got this". Three
 * stages make that a three-colour answer: amber is waiting, blue is handled,
 * green is done. Blue also matches the responding unit's own marker on the
 * map, so a row in the queue and a dot on the canvas finally agree.
 *
 * The legacy pair map onto responding's blue for the same reason their
 * labels do — see STAGE_LABELS.
 */
export const STAGE_TONES = {
  none: 'neutral',
  dispatched: 'warning',
  responding: 'info',
  resolved: 'success',
  on_site: 'info',
  investigating: 'info',
}

export function StageBadge({ stage, size = 'sm' }) {
  return (
    <StatusBadge tone={STAGE_TONES[stage] ?? 'neutral'} size={size} dot>
      {STAGE_LABELS[stage] ?? STAGE_LABELS.none}
    </StatusBadge>
  )
}

/**
 * The category as an icon tile, in the category's own colour — the same
 * colour the category charts use, so a medical call reads rose in both
 * places.
 */
export function CategoryIconBadge({ category, className = '' }) {
  const key = normalizeCategory(category)
  const Icon = categoryIcon(key)
  const color = categoryColor(key)
  return (
    <span
      title={categoryLabel(key)}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${className}`}
      style={{ backgroundColor: `${color}1f`, color, '--tw-ring-color': `${color}55` }}
    >
      <Icon size="md" aria-hidden="true" />
    </span>
  )
}

/**
 * One bordered block of the drawer.
 *
 * A null `title` drops the header row entirely rather than rendering an
 * empty one. Most blocks need naming; the unit picker does not — it sits
 * directly above a footer that says "Dispatch" and a button that says
 * "Dispatch Officer Reyes", so a third heading saying "Dispatch a unit" was
 * the same word three times in 120px of rail.
 */
export function Section({ icon: Icon, title, meta, children, tone = '' }) {
  return (
    <section className={`rounded-xl border border-hairline bg-slate-50 ${tone}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-2">
          <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-secondary">
            <Icon size="sm" className="shrink-0 text-brand-400" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </h3>
          {meta ? <span className="shrink-0 text-2xs text-text-muted">{meta}</span> : null}
        </header>
      ) : null}
      <div className="p-3.5">{children}</div>
    </section>
  )
}

const STAGE_STAMPS = {
  dispatched: 'dispatchedAt',
  responding: 'respondingAt',
  on_site: 'onSceneAt',
  investigating: 'investigatingAt',
  resolved: 'resolvedAt',
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }

/**
 * DISPATCHED → RESPONDING → ON-SITE → INVESTIGATING → RESOLVED, with the time
 * each step was reached. Done steps are filled, the current one is ringed,
 * the rest are muted. An ordered list, so a screen reader reads it as steps.
 */
export function StageStepper({ report, stage }) {
  /**
   * The stage is PASSED IN, with a derivation only as a fallback.
   *
   * It derived its own, which was correct and was half of a bug: the drawer
   * around it read the raw `dispatchStage` field, so on a call stored at a
   * retired stage the bar lit Responding while the controls below matched
   * nothing. Two readers of one fact will eventually disagree; the caller
   * owns it now and this renders what it is given.
   */
  const current = stageIndex(stage ?? deriveDispatchStage(report))
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
      className="mx-auto flex w-full max-w-sm items-start justify-center"
      aria-label="Dispatch stage"
    >
      {DISPATCH_STAGES.map((stage, i) => {
        const step = i + 1
        const done = step < current || (step === current && stage === 'resolved')
        const active = step === current && !done
        const at = report[STAGE_STAMPS[stage]]
        return (
          <li
            key={stage}
            aria-current={active ? 'step' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-2.5 h-0.5 w-full -translate-y-1/2 ${
                  step <= current ? 'bg-brand-500' : 'bg-tint/10'
                }`}
              />
            ) : null}
            <span
              className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold ${
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
              className={`mt-1.5 w-full truncate px-1 text-2xs font-semibold ${
                active ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
              }`}
            >
              {STAGE_LABELS[stage]}
            </span>
            <span className="font-mono text-2xs tabular-nums text-text-muted">
              {at ? new Date(at).toLocaleTimeString('en-GB', CLOCK) : '—'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
