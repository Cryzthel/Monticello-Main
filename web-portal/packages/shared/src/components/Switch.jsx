/**
 * On/off toggle — a capsule track with a round knob.
 *
 * A real `role="switch"` rather than a styled checkbox: it announces its state
 * to a screen reader without the label having to say "on"/"off", which is what
 * a settings page full of these needs. Pair it with a `<label htmlFor={id}>`;
 * a label is allowed to activate a button, so clicking the row's text flips
 * the switch too.
 *
 * All styling is `.switch` / `.switch-knob` in the shared stylesheet, keyed on
 * `aria-checked`, so what is drawn and what is announced cannot disagree.
 *
 * Moved here from the Admin portal so both consoles' settings pages use one
 * control. The old track was `rounded-lg` around a round knob; under the
 * oblong rule the track is a capsule too.
 */
export default function Switch({
  checked,
  onChange,
  disabled = false,
  id,
  describedBy,
  ariaLabel,
  className = '',
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked ? 'true' : 'false'}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`switch ${className}`}
    >
      <span className="switch-knob" />
    </button>
  )
}
