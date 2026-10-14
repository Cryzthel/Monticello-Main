import { useCallback, useState } from 'react'
import { Siren, Volume2, MapPin, ChevronDown } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { relativeTime } from '@shared/lib/notifications'
import { acknowledgePanicAlert } from '@shared/lib/panicAlerts'
import { useAuth } from '@shared/auth/AuthContext'
import { distanceMeters, formatDistance } from '@/lib/directions'

/**
 * Every unresolved SOS, in a column beside the map.
 *
 * ── WHY THIS REPLACES A FLOATING BANNER ────────────────────────────────────
 * The banner was a red capsule pinned over the top of the viewport. It had one
 * real virtue — impossible to miss — and three faults that got worse the more
 * alerts there were.
 *
 * It showed ONE alert and a count. "14 panic alerts" told a guard the size of
 * the problem and nothing about its shape: not which addresses, not which were
 * already acknowledged, not which had been waiting longest. The one thing a
 * dispatcher does with a queue is triage it, and a count cannot be triaged.
 *
 * It covered the console it was warning you about. Pinned at the top of the
 * viewport it sat across the duty row, so during the exact minutes an alert
 * was live the Clock out control and the notification bell were behind it.
 *
 * And it flashed. A pulsing red plate over a map is readable for about two
 * seconds and tiring for the rest of a shift, which is the opposite of what an
 * alert that may stay up for twenty minutes needs.
 *
 * A rail fixes all three by being a LIST in its own column: it holds as many
 * alerts as exist, it takes space from the map rather than covering it, and
 * nothing on it moves except the clock.
 *
 * ── IT IS NOT A SECOND SOURCE OF TRUTH ─────────────────────────────────────
 * It reads `useLivePanicAlerts`, the one subscription the provider owns, which
 * is the same array the map draws its nodes from and the siren counts. The
 * query filters `status in ('active','acknowledged')`, so an alert stays here
 * across reloads, tab switches and sign-outs until somebody resolves the
 * document — persistence is a property of the data, not of this component, and
 * there is deliberately no local copy that could outlive it.
 */

/**
 * One alert, in three zones: who and where, what the console knows, what to do.
 *
 * ── IT IS NO LONGER ONE BIG BUTTON ─────────────────────────────────────────
 * The whole card used to be a single `<button>` that opened the alert. Adding
 * Acknowledge and Resolve to it is not a styling change — a `<button>` inside
 * a `<button>` is invalid HTML, and browsers resolve it by dropping the inner
 * one from the accessibility tree and firing both handlers on a click. A guard
 * pressing Resolve would have resolved the alert AND opened it.
 *
 * So the card is a container. The identity block stays clickable, because
 * "open the thing I am reading" is the obvious gesture; the actions are
 * siblings beside it, each with its own target.
 */
function AlertCard({ alert, origin, onOpen, onAcknowledge, busy }) {
  const waiting = alert.status === 'active'
  const canNavigate = Number.isFinite(alert.lat) && Number.isFinite(alert.lng)
  const metres =
    canNavigate && origin ? distanceMeters([alert.lng, alert.lat], [origin.lng, origin.lat]) : null

  return (
    <li className="rounded-2xl border border-hairline bg-base-900 transition-[border-color,background-color] duration-200 hover:border-danger/40 hover:bg-tint/[0.03]">
      {/* ── ZONE 1 · WHO, WHERE, HOW LONG ─────────────────────────────── */}
      <button
        type="button"
        onClick={() => onOpen(alert)}
        className="flex w-full min-h-[44px] items-start gap-2.5 rounded-2xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {/* ── THE ONLY MOVING THING ON THE RAIL ────────────────────────
            One pulse ring, on the alert's own glyph, and only while it is
            still unattended. An acknowledged alert is being dealt with by a
            named officer, so it stops asking for attention and keeps its
            place in the list. `animate-ping` is covered by the global
            reduced-motion rule, and nothing that carries meaning depends on
            it — the tone, the glyph and the label are all static. */}
        <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          {waiting ? (
            <span className="absolute inline-flex h-full w-full rounded-full bg-danger/25 animate-ping" />
          ) : null}
          <Siren size="sm" className="relative" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-label font-semibold leading-tight text-text-primary">
              {alert.residentName}
            </span>
            {/* The age leads the row rather than the wall clock: "how long has
                this person been waiting" is the triage question, and it is the
                only number on the card that changes by itself. */}
            <span className="shrink-0 text-2xs tabular-nums leading-none text-text-muted">
              {relativeTime(alert.createdAt)}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption leading-none text-text-secondary">
            <MapPin size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate">{alert.address}</span>
          </span>
        </span>
      </button>

      {/* ── ZONE 2 · WHAT THE CONSOLE KNOWS ───────────────────────────────
          A status badge, and the distance when both ends of it are known.

          There is deliberately NO GPS-accuracy badge, which the brief asks
          for. The mobile SOS payload writes `location: {lat, lng}` and nothing
          else (see sos_payload.dart) — there is no accuracy radius on a panic
          alert to report, and a badge inventing one would be asserting a
          precision nobody measured, on the record a response is judged by.
          What IS knowable is whether the alert carries a position at all, and
          that changes what a responder can do, so it says that instead. */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        <StatusBadge tone={waiting ? 'danger' : 'warning'} size="sm">
          {waiting ? 'Active SOS' : 'Responding'}
        </StatusBadge>
        {!waiting && alert.acknowledgedByName ? (
          <span className="truncate text-2xs text-text-muted">{alert.acknowledgedByName}</span>
        ) : null}
        {canNavigate ? (
          metres != null ? (
            <span className="text-2xs tabular-nums text-text-secondary">
              {formatDistance(metres)} away
            </span>
          ) : null
        ) : (
          <StatusBadge tone="neutral" size="sm">
            No GPS fix
          </StatusBadge>
        )}
      </div>

      {/* ── ZONE 3 · WHAT TO DO ───────────────────────────────────────────
          Oblong, 44px, and never more than two at once. Acknowledge is the
          only thing to do with an unattended alert and Resolve is the only
          thing to do with one being handled, so the bar states the next step
          rather than offering a menu of every step. Respond — plotting a route
          and driving there — lives behind the card itself, because it takes
          over the whole console and should not share a row with a press that
          closes a call. */}
      <div className="flex items-center gap-2 border-t border-hairline p-2.5">
        {waiting ? (
          <button
            type="button"
            onClick={() => onAcknowledge(alert)}
            disabled={busy}
            className="btn btn-sm btn-brand min-h-[44px] flex-1 lg:min-h-0"
          >
            Acknowledge
          </button>
        ) : null}

        {/* ── ONE TRIGGER, AND THE MODAL IS THE CONFIRMATION ─────────────
            This was a two-press arm-then-confirm that resolved the alert in
            place, plus a four-second timer to disarm it. All of that is gone,
            because the popup it now opens does the same job better: it cannot
            be pressed by accident, it does not expire while somebody reads it,
            and it collects the notes and photo proof that closing an emergency
            on a record ought to carry.

            So the rail asks, and the modal is where the officer answers. One
            label, one meaning, and no state on this card that a stray tap can
            leave armed. */}
        <button
          type="button"
          onClick={() => onOpen(alert)}
          disabled={busy}
          aria-label={`Confirm resolve the alert from ${alert.residentName}`}
          className="btn btn-sm btn-outline min-h-[44px] flex-1 lg:min-h-0"
        >
          Confirm resolve
        </button>
      </div>
    </li>
  )
}

export default function PanicAlertRail({ onOpenAlert, muted, onToggleMute, origin = null }) {
  const { alerts } = useLivePanicAlerts()
  const { user } = useAuth()
  /**
   * The id currently being written, so one card's buttons go inert while its
   * update is in flight. Scoped to the ALERT rather than the rail: a guard
   * acknowledging one alert must not have the other thirteen freeze under
   * their thumb.
   */
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async (alert, action) => {
    setBusyId(alert.id)
    try {
      await action()
    } catch (err) {
      // The alert stays on screen and stays unresolved, which is the safe
      // failure: the console has not lost the emergency, it has only failed to
      // record a change to it.
      console.warn('Panic alert update failed', err)
    } finally {
      setBusyId(null)
    }
  }, [])
  /**
   * Shut on a phone until asked. The summary bar still states the count and
   * how many are unattended, which is the part a guard needs at a glance; the
   * list is the part that costs a screen.
   */
  const [open, setOpen] = useState(false)

  // No emergencies: the rail takes NO width at all rather than standing as an
  // empty column. A permanent panel whose resting state is "nothing here" is a
  // permanent tax on the map for a condition that is, almost always, false.
  if (!alerts.length) return null

  const unattended = alerts.filter((alert) => alert.status === 'active').length

  return (
    <aside
      aria-label="Active panic alerts"
      /* `shrink-0` with a fixed width so the map keeps `flex-1 min-w-0` beside
         it and this never collapses under a long address. Below `lg` it spans
         the full width and the map sits under it — a 320px rail next to a
         320px map would leave neither usable. */
      /* ── A CAP BELOW `lg`, AND WHY IT IS NOT OPTIONAL ─────────────────
         Stacked above the map on a phone, this takes its CONTENT height, and
         fourteen alerts measure 1837px against an 812px screen — the map is
         pushed entirely off the bottom and the guard scrolls past a wall of
         cards to reach the thing they dispatch from. Measured, not guessed.

         `max-h-[45vh]` hands the overflow to the scroller already inside this
         panel, so the list stays as long as it needs to be while the map keeps
         the larger half of the screen. Switched off from `lg`, where the rail
         is a column beside the map and `h-full` is exactly right. */
      className={`flex w-full shrink-0 flex-col border-b border-hairline bg-base-950 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-l xl:w-96 ${
        open ? 'max-h-[45vh]' : 'max-h-none'
      }`}
    >
      {/* ── COLLAPSED ON A PHONE, A COLUMN ON A CONSOLE ──────────────────
          Stacked above the map and expanded, this took the screen: the map is
          what a guard dispatches from, and burying it under a list is the one
          thing a dispatch console must not do. Collapsed, the rail is this
          56px bar and the map keeps everything else — which is the brief's
          "map canvas the primary full-screen view" without a second bottom
          sheet fighting the route panel for the same edge, or an overlay
          fighting the guidance banner for the same corner.

          `lg:` keeps the side column exactly as it was: there the rail has its
          own width and nothing is competing for it, so a disclosure would be a
          control that only ever hides something useful. */}
      <div className="flex min-h-[44px] shrink-0 items-center gap-2 border-b border-hairline px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          <Siren size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label font-semibold leading-tight text-text-primary">
            {alerts.length === 1 ? 'Panic alert' : `${alerts.length} panic alerts`}
          </p>
          <p className="mt-0.5 text-2xs leading-none text-text-secondary">
            {unattended
              ? `${unattended} still unattended`
              : 'All acknowledged — none resolved yet'}
          </p>
        </div>

        {/* ── MUTE SILENCES THE ROOM, NOT THE EMERGENCY ────────────────────
            It stops the siren and changes nothing else: every alert keeps its
            place, its status and its pulse ring. That distinction is the whole
            reason this is a separate control rather than a dismiss — a guard
            on a radio call needs the room quiet for thirty seconds, and the
            only way to get that before was to resolve an alert that was not
            resolved. */}
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute the SOS siren' : 'Mute the SOS siren'}
          /* ── THE WORD, NOT JUST THE GLYPH ───────────────────────────
              A speaker icon alone is two states that look nearly identical at
              20px, on a control whose meaning is "is this console making a
              noise right now" — the question a guard asks fastest and can
              least afford to get wrong. The label says which press they are
              about to make; the icon's opacity carries the current state.

              `min-h-[44px]` on touch, the console's own height above `lg`. It
              widens from a square to a labelled pill, which is why the fixed
              `w-11` is gone. */
          className="btn btn-sm btn-outline min-h-[44px] shrink-0 gap-1.5 lg:min-h-0"
          title={muted ? 'The siren is silenced — turn it back on' : 'Silence the siren'}
        >
          {/* ── ONE GLYPH, TWO STATES ──────────────────────────────────
              The icon registry is GENERATED from one Phosphor set, matched to
              the mobile app's, and it has no muted-speaker glyph. Hand-adding
              a `VolumeX` would put a drawing in the registry that
              `build-icons.mjs` does not know about and the phone does not
              have, and the next regeneration would silently drop it.

              So the state is carried the way the rest of this console carries
              it — by the button's tone and its accessible name — which is the
              same decision the old VoiceControl documented. */}
          <Volume2 size="sm" className={muted ? 'opacity-40' : ''} />
          {/* The visible label is the verb alone, which is all a sighted
              reader needs beside the glyph. The button's `aria-label` names
              what it acts on, because a screen-reader user meets this control
              out of its context — "Mute" on its own could be anything. */}
          <span>{muted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Below `lg` only: on a console the list is always open. */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="panic-queue"
          className="btn btn-outline h-11 w-11 shrink-0 px-0 lg:hidden"
        >
          <ChevronDown
            size="sm"
            className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
          <span className="sr-only">{open ? 'Hide the panic queue' : 'Show the panic queue'}</span>
        </button>
      </div>

      {muted ? (
        <p className="shrink-0 border-b border-hairline bg-warning/10 px-4 py-2 text-2xs leading-snug text-warning">
          Siren muted. These alerts are still open and still unresolved.
        </p>
      ) : null}

      <div
        id="panic-queue"
        className={`custom-scrollbar min-h-0 flex-1 flex-col overflow-y-auto p-3 lg:flex ${
          open ? 'flex' : 'hidden'
        }`}
      >
        <ul className="flex flex-col gap-2.5">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              origin={origin}
              busy={busyId === alert.id}
              onOpen={onOpenAlert}
              onAcknowledge={(a) => run(a, () => acknowledgePanicAlert(a.id, user?.displayName))}
            />
          ))}
        </ul>
      </div>
    </aside>
  )
}
