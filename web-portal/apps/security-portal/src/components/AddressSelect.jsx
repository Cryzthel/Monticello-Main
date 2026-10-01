import { useState } from 'react'
import { Pencil } from '@shared/icons'
import Select from '@shared/components/Select'

const OTHER = '__other__'

/**
 * One rung of the Phase / Block / Lot cascade.
 *
 * A dropdown over the addresses actually on file, with an explicit escape
 * hatch. The escape hatch is not a nicety: the directory is derived from
 * registered residents (see usePropertyDirectory), so a guard called to a lot
 * nobody has signed up from would otherwise be unable to file the report at
 * all. The dropdown's own "Enter manually…" option swaps to a text input;
 * a "Pick from list" control appears alongside the label to swap back.
 * There is no separate "Enter manually" BUTTON any more — the option in
 * the list already said it, and two controls for one action is one too many.
 *
 * When the directory has nothing for this rung yet — no phase picked, or no
 * blocks recorded under the one that is — it renders as a plain input rather
 * than an empty dropdown, which would look broken.
 */
export default function AddressSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  disabledHint,
}) {
  // Manual once the value is off-list, so re-opening a draft with a bespoke
  // address doesn't silently blank it.
  const [manual, setManual] = useState(false)
  const offList = value && options.length > 0 && !options.includes(value)
  const isManual = manual || offList || options.length === 0

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-text-secondary">
          {label}
        </label>
        {/* Only the way BACK. Going manual is offered by the dropdown's own
            "Enter manually…" option, so a second control beside the label said
            the same thing twice. Returning to the list has no such option —
            there is no list on screen to offer it — so that direction keeps
            its control. */}
        {options.length > 0 && !disabled && isManual ? (
          <button
            type="button"
            onClick={() => {
              setManual(false)
              onChange('')
            }}
            className="text-2xs font-medium text-brand-400 underline-offset-2 hover:underline"
          >
            Pick from list
          </button>
        ) : null}
      </div>

      {isManual ? (
        <div className="relative">
          <Pencil size="sm" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            id={id}
            type="text"
            required
            disabled={disabled}
            className="field pl-9 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={disabled ? disabledHint : placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : (
        <Select
          ariaLabel={label}
          value={value || undefined}
          disabled={disabled}
          placeholder={disabled ? disabledHint : placeholder}
          className="w-full"
          options={[...options, { value: OTHER, label: 'Enter manually…' }]}
          onChange={(next) => {
            if (next === OTHER) {
              setManual(true)
              onChange('')
            } else {
              onChange(next)
            }
          }}
        />
      )}
    </div>
  )
}
