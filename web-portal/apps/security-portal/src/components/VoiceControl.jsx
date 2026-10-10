import { Volume2 } from '@shared/icons'

/**
 * Turn spoken directions on and off.
 *
 * ── ONE ICON, TWO STATES ────────────────────────────────────────────────────
 * The brief asks for Volume2 / VolumeX. The icon registry is GENERATED from
 * one Phosphor set, deliberately matched to the mobile app's, and it has no
 * muted-speaker glyph. Hand-adding one would put a glyph in the registry that
 * `build-icons.mjs` does not know about and that the phone does not have —
 * the next regeneration would silently drop it.
 *
 * So the state is carried the way FollowControl carries its own: by the
 * button's tone and its label. "Voice on" filled, "Voice off" outlined, which
 * is legible at a glance and does not fork the icon system for one control.
 */
export default function VoiceControl({ enabled, supported, disabled, onToggle }) {
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
        {disabled
          ? 'Available once a unit is routed to a call.'
          : enabled
            ? 'Speaks each turn as you approach it. Nothing is spoken while the unit is stationary.'
            : 'Reads the turns aloud, for driving to a call.'}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={enabled}
        className={`btn btn-sm w-full ${enabled ? 'btn-success' : 'btn-outline'}`}
      >
        <Volume2 size="sm" aria-hidden="true" />
        {enabled ? 'Voice on — mute' : 'Voice off'}
      </button>
    </div>
  )
}
