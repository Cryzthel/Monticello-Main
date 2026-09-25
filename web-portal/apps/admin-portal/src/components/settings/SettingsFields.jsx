import { Info, Plus, Trash2 } from 'lucide-react'
import Select from '@shared/components/Select'
import Switch from '@shared/components/Switch'
import StatusBadge from '@shared/components/StatusBadge'
import { MAX_HOTLINES } from '@shared/lib/systemSettingsStore'

/**
 * The field vocabulary for Admin › Settings.
 *
 * ── ONE ROW SHAPE, FIVE CONTROLS ────────────────────────────────────────────
 * Every setting on the page is the same row: a label that is also the
 * control's label, a sentence saying what it does, and the control itself
 * right-aligned on the first line. Keeping that shape in one place is what
 * stops a page of thirty settings reading as thirty small decisions about
 * layout — and it is why the switches, the numbers and the dropdowns all sit
 * on one right edge instead of three.
 */

/**
 * "Stored, not yet enforced."
 *
 * PRODUCT.md's fourth principle is that nothing is shown the data cannot
 * support, and a control that silently does nothing is the purest breach of
 * it. Several settings here need a Cloud Function — a scheduled sweep, a write
 * trigger, a server-side counter — and Functions cannot deploy while the
 * project is on the Spark plan. Rather than hide those settings or pretend
 * they work, each one says so on its own row. An administrator can still
 * record the intended policy; they simply are not misled about when it starts
 * applying.
 */
export function PendingNote({ children }) {
  return (
    <p className="mt-2 inline-flex items-start gap-1.5 text-2xs leading-snug text-text-muted">
      <Info aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** The shared row. `control` sits on the first line, right-aligned. */
export function SettingRow({ id, title, description, control, children, pending = null }) {
  return (
    <div className="border-b border-divider py-4 last:border-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-semibold leading-snug text-text-primary">
            {title}
          </label>
          {description ? (
            <p id={`${id}-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
              {description}
            </p>
          ) : null}
          {pending ? <PendingNote>{pending}</PendingNote> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function SwitchSetting({ id, title, description, checked, disabled, onChange, pending }) {
  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      pending={pending}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          describedBy={`${id}-description`}
        />
      }
    />
  )
}

/**
 * A bounded number.
 *
 * `min`/`max` are on the input as well as in the sanitizer, so the browser
 * refuses the obvious mistakes before a save is attempted — but the sanitizer
 * is still the authority, because a number typed here is not the only way a
 * value reaches the document.
 */
export function NumberSetting({
  id,
  title,
  description,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
  pending,
}) {
  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      pending={pending}
      control={
        <span className="inline-flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={`${id}-description`}
            className="field h-9 w-20 text-right tabular-nums"
          />
          {unit ? <span className="text-xs text-text-secondary">{unit}</span> : null}
        </span>
      }
    />
  )
}

/** A fixed set of values — the same list the rules and the sanitizer accept. */
export function ChoiceSetting({ id, title, description, value, options, disabled, onChange, pending }) {
  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      pending={pending}
      control={
        <Select
          ariaLabel={title}
          value={String(value)}
          disabled={disabled}
          options={options}
          onChange={(next) => onChange(next)}
          className="w-40"
        />
      }
    />
  )
}

export function TextSetting({ id, title, description, value, placeholder, type = 'text', disabled, onChange }) {
  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      control={
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-description`}
          className="field h-9 w-64"
        />
      }
    />
  )
}

/**
 * The siren volume.
 *
 * A range input rather than a number: the value is a feeling, not a figure,
 * and nobody knows what 0.65 sounds like. The percentage is shown beside it
 * because a slider with no readout cannot be set to the same place twice.
 */
export function VolumeSetting({ id, title, description, value, disabled, onChange, footnote }) {
  const percent = Math.round(value * 100)
  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      control={
        <span className="inline-flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value) / 100)}
            aria-describedby={`${id}-description`}
            className="h-9 w-40 accent-brand-500"
          />
          <span className="w-10 text-right text-xs tabular-nums text-text-secondary">{percent}%</span>
        </span>
      }
    >
      {footnote ? <div className="mt-3">{footnote}</div> : null}
    </SettingRow>
  )
}

/**
 * Emergency hotlines.
 *
 * ── WHY THIS IS A LIST AND NOT FOUR FIXED FIELDS ────────────────────────────
 * The brief names Police, Fire, Medical and the guardhouse landline, and a
 * form with exactly those four labels would be simpler to build. It would also
 * be wrong for the first subdivision that has two guardhouses, a barangay
 * hotline or a private ambulance contract. The label is data.
 *
 * Capped at MAX_HOTLINES, and the cap is in the rules too: this list is
 * dispatched to a phone mid-emergency, and a resident scrolling forty numbers
 * while something is happening is worse served than one reading four.
 */
export function HotlineEditor({ value, disabled, onChange }) {
  const rows = Array.isArray(value) ? value : []
  const full = rows.length >= MAX_HOTLINES

  function patch(index, field, next) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: next } : row)))
  }

  return (
    <div className="border-b border-divider py-4 last:border-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-text-primary">Emergency contacts</p>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
            Sent to the resident app during an active SOS. Shown in this order.
          </p>
        </div>
        <StatusBadge tone="neutral" size="sm">
          {rows.length} of {MAX_HOTLINES}
        </StatusBadge>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-text-muted">
          No hotlines yet. Residents raising an SOS will see the guardhouse only.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.id || index} className="flex items-center gap-2">
              <input
                aria-label={`Hotline ${index + 1} label`}
                value={row.label}
                disabled={disabled}
                placeholder="Local police"
                onChange={(event) => patch(index, 'label', event.target.value)}
                className="field h-9 min-w-0 flex-1"
              />
              <input
                aria-label={`Hotline ${index + 1} number`}
                value={row.number}
                disabled={disabled}
                placeholder="117"
                inputMode="tel"
                onChange={(event) => patch(index, 'number', event.target.value)}
                className="field h-9 w-36 shrink-0 tabular-nums"
              />
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${row.label || `hotline ${index + 1}`}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="icon-btn icon-btn-sm shrink-0 border border-slate-200 text-text-muted hover:text-danger"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={disabled || full}
        onClick={() =>
          onChange([...rows, { id: `hotline-${Date.now()}`, label: '', number: '' }])
        }
        className="btn btn-sm btn-outline mt-3"
        title={full ? `The list is capped at ${MAX_HOTLINES}` : undefined}
      >
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        Add hotline
      </button>
    </div>
  )
}

/** A titled group of rows. */
export function SettingsGroup({ title, description, icon: Icon, children }) {
  return (
    <section className="card p-0">
      <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        {Icon ? (
          <span className="icon-tile icon-tile-sm shrink-0" aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight text-text-primary">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="px-5">{children}</div>
    </section>
  )
}
