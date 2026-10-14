import StatusBadge from '@shared/components/StatusBadge'
import { STAGE_LABELS } from '@shared/lib/dispatchStage'

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
 * ── THE STEPPER AND THE CATEGORY TILE LEFT THIS FILE ───────────────────────
 * Both are now drawn from `@shared/components/dispatch` — see
 * StageStepper.jsx there for why a second copy of the pipeline in the Admin
 * console was worth deleting rather than keeping in step by hand. Import them
 * from shared; `CategoryIconBadge` is a default export there.
 */

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

