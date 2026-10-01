import { X, ArrowRight, MapPin } from '@shared/icons'
import { ToneGlyph } from '@shared/components/NotificationRow'
import StatusBadge from '@shared/components/StatusBadge'
import { clockTime, relativeTime } from '@shared/lib/notifications'

// A critical card is outlined in danger all the way round. The stack is read
// from peripheral vision in a control room, and a critical alert has to be
// separable from the others before any of its words are. Every other card
// takes the standard popover edge — the tone glyph and severity badge say the
// rest, and a card with no priority (an announcement) states none.
function edgeFor(priority) {
  return priority === 'critical' ? 'border-danger/45' : 'border-hairline'
}

/**
 * Floating incident notification card — the instant, transient counterpart to
 * the bell panel.
 *
 * -- ONE NOTIFICATION, TWO SURFACES, ONE GRAMMAR ---------------------------
 * Same ToneGlyph, same badge row, same headline/detail/place stack, same
 * timestamp column as NotificationRow, and both read the same fields off the
 * same builder in lib/notifications.js. A toast and the row it becomes a
 * moment later in the bell are the same notification, so they must not be two
 * independently drifting designs — that was the state before this pass, where
 * the toast tinted a category icon the bell did not draw and the bell showed a
 * relative time the toast rendered in a different place.
 *
 * What the toast adds on top is the critical-alert edge, the dismiss
 * control, and the action button: the three things that only matter while the
 * event is still live.
 *
 * The category icons this file used to keep are gone. They duplicated the
 * category badge sitting directly beside them, in a card whose whole problem
 * was that it covered the map it was reporting on.
 */
export default function IncidentNotificationToast({ alert, onDismiss, onView }) {
  const edge = edgeFor(alert.priority)

  return (
    <div
      role={alert.priority === 'critical' ? 'alert' : 'status'}
      // 20rem: wide enough for the headline to break at a readable measure and
      // no wider. A stack of four of these at 23rem reached most of the way
      // down a laptop viewport and covered the top-right quarter of the
      // dispatch map — over the pins the alerts were about.
      className={`pointer-events-auto w-[20rem] max-w-[calc(100vw-2rem)] animate-[toastIn_220ms_cubic-bezier(0.23,1,0.32,1)] overflow-hidden rounded-xl border bg-base-850 shadow-overlay ${edge}`}
    >
      {/* The bell panel's column track, minus the timestamp column — a toast
          is one card rather than a list, so there is nothing for a time column
          to align against and the space is better spent on the measure. */}
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 p-3">
        <div className="pt-px">
          <ToneGlyph tone={alert.tone} />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {alert.categoryLabel ? (
            <StatusBadge tone={alert.categoryTone} size="sm">
              {alert.categoryLabel}
            </StatusBadge>
          ) : null}
          {alert.priority === 'critical' || alert.priority === 'high' ? (
            <StatusBadge severity={alert.priority} size="sm" />
          ) : null}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:bg-tint/5 hover:text-text-primary"
        >
          <X size="sm" />
        </button>

        <div className="col-start-2 col-end-4 min-w-0">
          <p className="text-label font-semibold leading-snug text-text-primary">{alert.title}</p>
          {alert.detail ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-text-secondary">
              {alert.detail}
            </p>
          ) : null}
          <p className="mt-1 flex min-w-0 items-center gap-1 text-caption leading-none text-text-muted">
            <MapPin size="sm" className="shrink-0 text-brand-400" />
            <span className="truncate">{alert.propertyLabel}</span>
            <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
            <span className="shrink-0 font-mono tabular-nums">{clockTime(alert.at)}</span>
            <span className="sr-only">{relativeTime(alert.at)}</span>
          </p>
        </div>

        {onView ? (
          <div className="col-start-2 col-end-4">
            <button
              type="button"
              onClick={onView}
              className="btn btn-sm w-full bg-tint/[0.06] text-brand-400 hover:bg-tint/[0.12] hover:text-brand-300"
            >
              {alert.actionLabel ?? 'View incident'}
              <ArrowRight size="sm" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
