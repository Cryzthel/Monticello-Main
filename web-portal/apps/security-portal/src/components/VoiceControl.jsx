import { Volume2 } from '@shared/icons'

/**
 * Turn spoken directions on and off, for a dispatcher who is NOT navigating.
 *
 * ── IT IS NOT A MUTE BUTTON, AND THAT DISTINCTION IS THE WHOLE CONTROL ─────
 * Spoken guidance during a navigation session is mandatory: the panel's Mute
 * control is gone and `navigating` overrides this toggle outright (see
 * `speaking` in DashboardPage). What is left is the case this was built for
 * and which protocol says nothing about — somebody at the guardhouse desk
 * watching a unit's route, who may or may not want the turns read out in a
 * room with other people in it.
 *
 * While a session IS running this reports that rather than offering a press
 * that would be overruled. A control that visibly does nothing is worse than
 * one that explains why: the first teaches an officer the console is broken,
 * the second teaches them the rule.
 *
 * ── ONE ICON, TWO STATES ────────────────────────────────────────────────────
 * The brief asks for Volume2 / VolumeX. The icon registry is GENERATED from
 * one Phosphor set, deliberately matched to the mobile app's, and it has no
 * muted-speaker glyph. Hand-adding one would put a glyph in the registry that
 * `build-icons.mjs` does not know about and that the phone does not have —
 * the next regeneration would silently drop it.
 *
 * So the state is carried the way FollowControl carries its own: by the
 * button's tone and its label.
 */
export default function VoiceControl({ enabled, supported, disabled, locked = false, onToggle }) {
  if (!supported) {
    return (
      <p className="text-2xs leading-relaxed text-text-secondary">
        This browser has no speech synthesis, so spoken directions are
        unavailable here. The written steps are unaffected.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs leading-relaxed text-text-secondary">
        {locked
          ? 'Spoken guidance stays on for the whole of a navigation session. Use Repeat on the route panel to hear the current turn again.'
          : disabled
            ? 'Available once a unit is routed to a call.'
            : enabled
              ? 'Speaks each turn as you approach it. Nothing is spoken while the unit is stationary.'
              : 'Reads the turns aloud, for driving to a call.'}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || locked}
        aria-pressed={enabled}
        className={`btn btn-sm w-full ${enabled ? 'btn-success' : 'btn-outline'}`}
      >
        <Volume2 size="sm" aria-hidden="true" />
        {locked ? 'Voice on — navigating' : enabled ? 'Voice on — mute' : 'Voice off'}
      </button>
    </div>
  )
}
