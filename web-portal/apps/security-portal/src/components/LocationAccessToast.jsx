import { useEffect, useRef } from 'react'
import { useToast } from '@shared/components/ToastProvider'
import { useLocationAccess } from '@/hooks/useLocationAccess'

/**
 * Asks the officer to turn their GPS on, in the one place on this console that
 * is guaranteed to be looked at.
 *
 * ── WHY A TOAST WHEN THERE IS ALREADY A BANNER ──────────────────────────────
 * The banner sits at the top of the shell, above a full-height map. An officer
 * driving to a call is looking at the route panel at the bottom of their phone,
 * and what that panel says when there is no position is a paragraph explaining
 * that no route can be plotted — accurate, unmissable, and not actionable. The
 * control that could fix it in one press was four hundred pixels away at the
 * other end of the screen, and (until `useLocationAccess`) was often hiding
 * itself in exactly this case.
 *
 * A toast is the console's existing answer to "this needs you now": it is
 * portalled above the map, it carries one action button, and it is already
 * where this officer's eyes go when a call arrives, because that is how they
 * find out a call arrived.
 *
 * ── IT ASKS ONCE, AND IT IS NOT AN EMERGENCY ───────────────────────────────
 * `dedupeKey` means the stack never holds two of these, and the ref below
 * means a dismissed toast stays dismissed for the session rather than
 * reappearing on the next render that still has no position. An officer who
 * has decided not to share their location has made a decision, and a console
 * that re-asked every eight seconds would be arguing with them.
 *
 * It is deliberately NOT `priority: 'critical'`, which on this console means a
 * sticky red-edged card reserved for emergencies. This is a configuration
 * problem with real consequences, not an emergency — so it takes a long but
 * finite life and lets the banner be the thing that persists.
 */

/**
 * Twenty-five seconds, against the stack's 8s default.
 *
 * Long enough to read two sentences, decide, and press a button while also
 * reading an incident card that may have arrived at the same moment — the
 * situation this exists for. Short enough that it clears itself off a map an
 * officer is trying to drive by.
 */
const TOAST_TTL_MS = 25_000

export default function LocationAccessToast({ mode, locationError, fix }) {
  const { notify, dismiss } = useToast()
  const { state, request } = useLocationAccess({ mode, locationError, fix })

  /**
   * Which state we have already raised a card for, and the card's id.
   *
   * Keyed by STATE, not a boolean: an officer who dismissed "allow location"
   * and then actively blocked it in their browser settings has reached a
   * different problem with different advice, and deserves to be told once
   * about that one too.
   */
  const raised = useRef({ state: null, id: null })

  useEffect(() => {
    // A position is flowing, or there is nothing we could usefully say. Clear
    // any card still on screen — a toast telling somebody to enable a thing
    // they have just enabled is the console failing to notice it worked.
    if (state === 'ok' || state === 'off') {
      if (raised.current.id) dismiss(raised.current.id)
      raised.current = { state: null, id: null }
      return
    }

    // 'waiting' is the device trying with permission already granted. There is
    // no button that helps, so this says nothing and leaves it to the banner.
    if (state === 'waiting') return

    if (raised.current.state === state) return

    const id = notify({
      kind: 'incident',
      tone: 'warning',
      at: new Date(),
      dedupeKey: 'location-access',
      ttl: TOAST_TTL_MS,
      propertyLabel: 'This device',
      title:
        state === 'denied'
          ? 'Location is blocked — dispatch cannot see you'
          : 'Turn on GPS so dispatch can route to you',
      detail:
        state === 'denied'
          ? 'Your browser is refusing location for this site, so you are not on the dispatch map and no route can start from you. Only the browser’s own site settings can undo it.'
          : 'Allow location and your position goes live straight away — the map picks you up, and a route to your call plots itself.',
      // Nothing to press once the browser has been told no: the sheet will not
      // come back, so offering a button would be offering a press that does
      // nothing. The copy points at the only thing that can change it.
      ...(state === 'denied'
        ? {}
        : { actionLabel: 'Allow location', onView: request }),
    })

    raised.current = { state, id }
  }, [state, notify, dismiss, request])

  return null
}
