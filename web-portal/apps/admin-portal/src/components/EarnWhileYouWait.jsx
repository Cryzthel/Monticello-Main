import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, X } from '@shared/icons'
import { portalKey } from '@shared/config/portal'
import { useCurrentWait } from '@/lib/waitState'
import { DWELL_MS, getSponsorFeed } from '@/lib/sponsorFeed'

/** A sync shorter than this never shows the card — it would only flash. */
const ENTER_DELAY_MS = 800
/** Grace after a wait ends, so back-to-back syncs do not make the card blink. */
const EXIT_DELAY_MS = 600

const DISMISS_KEY = portalKey('sponsor-slot-dismissed')

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * "Earn while you wait" — a sponsored line that appears in the sidebar while
 * the console is waiting on the server, and leaves when the wait does.
 *
 * ── HOW IT STAYS OUT OF THE WAY ───────────────────────────────────────────
 *   off unless configured   no feed URL, no card, no request (sponsorFeed.js)
 *   only while waiting      appears once a wait has run ENTER_DELAY_MS, folds
 *                           away EXIT_DELAY_MS after it ends
 *   never in the rail       a collapsed 80px rail has no room for a sentence,
 *                           and a sponsor glyph there would read as navigation
 *   one press to dismiss    for the rest of the browser session
 *   Admin only              the Guardhouse never mounts it — see AppShell
 *
 * The top half is the wait itself — what the console is doing, over an
 * indeterminate bar — so the card answers "why is this still loading" before
 * it says anything sponsored.
 *
 * `feed` is injectable for tests and design review; production reads the
 * environment.
 */
export default function EarnWhileYouWait({ collapsed = false, feed: injectedFeed }) {
  const feed = useMemo(() => injectedFeed ?? getSponsorFeed(), [injectedFeed])
  const wait = useCurrentWait()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [shown, setShown] = useState(false)
  const [label, setLabel] = useState('')
  const [placement, setPlacement] = useState(null)
  const reported = useRef(new Set())

  const waitId = wait?.id ?? null
  const waitLabel = wait?.label ?? ''
  const active = Boolean(feed) && !dismissed

  // Presence: enter late, leave late. Once shown, a new wait only relabels.
  useEffect(() => {
    if (!active) return undefined
    const timer = waitId
      ? setTimeout(
          () => {
            setLabel(waitLabel)
            setShown(true)
          },
          shown ? 0 : ENTER_DELAY_MS,
        )
      : setTimeout(() => setShown(false), EXIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active, waitId, waitLabel, shown])

  // One placement request per wait; a wait that ends first aborts it.
  useEffect(() => {
    if (!active || !waitId) return undefined
    const controller = new AbortController()
    feed
      .fetchPlacement({ context: waitLabel, signal: controller.signal })
      .then((next) => {
        if (next) setPlacement(next)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [active, feed, waitId, waitLabel])

  const open = active && shown && Boolean(placement) && !collapsed
  const placementId = placement?.id

  // An impression is DWELL_MS of continuous, visible time. Hiding the tab
  // restarts the count, and each placement is reported once.
  useEffect(() => {
    if (!open || !placementId || reported.current.has(placementId)) return undefined
    let timer
    const arm = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        reported.current.add(placementId)
        feed.reportImpression({ id: placementId, context: label, dwellMs: DWELL_MS })
      }, DWELL_MS)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', arm)
    }
  }, [open, placementId, feed, label])

  function dismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Storage blocked: the dismissal still holds for this page's lifetime.
    }
  }

  if (!active || !placement) return null

  return (
    // Folds with grid-template-rows (0fr → 1fr), so the nav above gives up
    // exactly the card's height as it moves — no measured max-height, and no
    // jump when the sponsor line wraps to a second row.
    <div
      className={`grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out-strong)] ${
        open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
      }`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <section
          aria-label="Earn while you wait, sponsored"
          className="rounded-xl border border-hairline bg-base-950 p-3"
        >
          <p className="truncate text-caption font-medium text-text-secondary">{label}…</p>
          <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-tint/10" aria-hidden="true">
            <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-brand-500" />
          </div>

          <div className="mt-3 border-t border-hairline pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs font-medium text-text-muted">Sponsored</span>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Hide sponsored messages for this session"
                className="icon-btn -mr-1.5 h-6 w-6"
              >
                <X size="sm" />
              </button>
            </div>
            <a
              href={placement.href}
              target="_blank"
              rel="sponsored noopener noreferrer"
              className="group mt-0.5 block rounded"
            >
              <span className="line-clamp-2 text-label font-medium leading-snug text-text-primary decoration-slate-300 underline-offset-2 group-hover:underline">
                {placement.text}
              </span>
              <span className="mt-1 flex items-center gap-1 text-caption text-text-muted">
                <span className="truncate">{placement.advertiser}</span>
                <ArrowUpRight size="sm" className="shrink-0 transition-transform duration-150 ease-[var(--ease-out-strong)] group-hover:-translate-y-px group-hover:translate-x-px" />
              </span>
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
