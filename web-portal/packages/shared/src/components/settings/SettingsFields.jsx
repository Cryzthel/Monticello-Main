import { Info, Plus, Trash2 } from '@shared/icons'
import Card from '@shared/components/Card'
import CardHeader from '@shared/components/CardHeader'
import Select from '@shared/components/Select'
import Switch from '@shared/components/Switch'
import StatusBadge from '@shared/components/StatusBadge'
import { MAX_HOTLINES } from '@shared/lib/systemSettingsStore'

/**
 * A setting whose value is long enough to need its own block.
 *
 * ── WHY THIS BREAKS THE ONE-ROW SHAPE ON PURPOSE ────────────────────────────
 * Every other control here sits right-aligned on the row's first line, which
 * is what gives the page its single right edge. Terms of Service is eight
 * pages of prose, and there is no version of "right-aligned on the first line"
 * that works for it: squeezed into the control column it is a four-character
 * window onto a legal document.
 *
 * So the label keeps the row and the field takes the full width beneath it.
 * The rule above and below still comes from the group's `divide-y`, so it
 * reads as one of the rows rather than as a panel that wandered in.
 */
export function TextAreaSetting({
  id,
  title,
  description,
  value,
  placeholder,
  rows = 12,
  max,
  disabled,
  onChange,
  pending,
}) {
  const used = typeof value === 'string' ? value.length : 0
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium leading-snug text-text-primary">
            {title}
          </label>
          {description ? (
            <p id={`${id}-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
              {description}
            </p>
          ) : null}
          {pending ? <PendingNote>{pending}</PendingNote> : null}
        </div>
        {/* The counter only appears once it is worth knowing. A "0 / 20,000"
            on an empty field is a demand to fill it. */}
        {max && used > max * 0.75 ? (
          <StatusBadge tone={used >= max ? 'danger' : 'neutral'} size="sm">
            {used.toLocaleString()} / {max.toLocaleString()}
          </StatusBadge>
        ) : null}
      </div>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-description`}
        /* `font-mono` and a relaxed leading: this is a document being edited,
           not a form field being filled, and the monospace is what makes a
           pasted clause's indentation survive long enough to be noticed. */
        className="field mt-3 w-full resize-y p-3 font-mono text-xs leading-relaxed"
      />
    </div>
  )
}

/**
 * A list of short free-text rules — today, the IP allowlist.
 *
 * Deliberately NOT a reuse of `HotlineEditor`: that one edits a list of
 * `{ label, number }` pairs with its own copy and its own cap, and
 * generalising it into "an editor for lists of things" to take one more caller
 * would make both harder to read than two clear editors. If a third list
 * arrives, that is the moment to find the shape they share.
 */
export function RuleListEditor({
  title,
  description,
  value,
  max,
  placeholder,
  addLabel,
  emptyNote,
  disabled,
  onChange,
  pending,
}) {
  const rows = Array.isArray(value) ? value : []
  const full = rows.length >= max

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-text-primary">{title}</p>
          {description ? (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">{description}</p>
          ) : null}
          {pending ? <PendingNote>{pending}</PendingNote> : null}
        </div>
        <StatusBadge tone="neutral" size="sm">
          {rows.length} of {max}
        </StatusBadge>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-text-muted">
          {emptyNote}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((rule, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                aria-label={`${title} entry ${index + 1}`}
                value={rule}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) =>
                  onChange(rows.map((r, i) => (i === index ? event.target.value : r)))
                }
                className="field h-9 min-w-0 flex-1 font-mono text-xs"
              />
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${rule || `entry ${index + 1}`}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="icon-btn icon-btn-sm shrink-0 border border-hairline text-text-muted hover:text-danger"
              >
                <Trash2 size="sm" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={disabled || full}
        onClick={() => onChange([...rows, ''])}
        className="btn btn-sm btn-outline mt-3"
        title={full ? `The list is capped at ${max}` : undefined}
      >
        <Plus size="sm" aria-hidden="true" />
        {addLabel}
      </button>
    </div>
  )
}

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
      <Info size="sm" aria-hidden="true" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The shared row. `control` sits on the first line, right-aligned.
 *
 * ── THE SAME ROW THE GUARDHOUSE SETTINGS PAGE DRAWS ───────────────────
 * `px-4 py-3.5`, a 14px MEDIUM label over a 12px secondary line. Three details
 * moved to get there, and each was a real difference rather than a rounding:
 *
 *   • The label was `font-semibold`, the same weight as the card header above
 *     it. Two semibold 14px lines in one panel, one of them naming the panel
 *     and the other naming a row inside it, is a hierarchy with no step in it.
 *     The header keeps semibold; rows take medium.
 *
 *   • The rule between rows was `border-b` on each row. It is now `divide-y`
 *     on the group, which is what stops a doubled rule where a group's last
 *     row meets the next thing — the old version needed `last:border-0` to
 *     paper over exactly that.
 *
 *   • The row had no horizontal padding of its own; the group supplied it with
 *     `px-5`. That is why the rules ran edge to edge inside the card while the
 *     guardhouse's stop short of it. Padding belongs to the row, so the rule
 *     can be the full width of the surface and the content inset from it.
 *
 * `items-start` is NOT aligned to the guardhouse's `items-center`, and that is
 * the one deliberate difference. Its rows are a label and a switch; these carry
 * a two-line description and sometimes a pending note under it, and centring a
 * switch against a three-line block floats it in the middle of nothing. The
 * control lines up with the title it belongs to.
 */
export function SettingRow({ id, title, description, control, children, pending = null }) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium leading-snug text-text-primary">
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
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-text-primary">Emergency contacts</p>
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
                <Trash2 size="sm" aria-hidden="true" />
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
        <Plus size="sm" aria-hidden="true" />
        Add hotline
      </button>
    </div>
  )
}

/**
 * A titled group of rows — `Card` + `CardHeader`, the pair the guardhouse
 * settings page is built from.
 *
 * ── IT USED TO HAND-ROLL THIS HEADER, AND THE RANK WAS WRONG ──────────
 * `text-base` (16px) semibold over a 12px line. CardHeader's docstring sets
 * out why that is a level too loud: 16px-over-14px is SectionHeading's rank,
 * for a heading that sits ABOVE a panel and names it, and a header INSIDE a
 * card is one step down because the card is already the named thing. Reaching
 * for the bigger rank made every group on this page shout one notch louder
 * than the identical groups next door.
 *
 * The icon tile survived the move: it is genuinely useful on a page of six
 * near-identical panels, so rather than keep a private header to hold it, the
 * tile became an optional `icon` prop on CardHeader. Nothing else had to
 * change to adopt it, and the guardhouse page can take one whenever it wants.
 *
 * `divide-y divide-divider` on the body, not a border per row: `--color-divider`
 * is documented as the token "for the rules between table rows, which should
 * separate without striping", and a settings list is that. (The guardhouse page
 * reached for `divide-slate-100` — the CARD edge token, one step darker — and
 * was the only use of it in either console. It has been moved onto this one.)
 */
/**
 * One titled panel of settings rows.
 *
 * ── IT WAS WRITTEN TWICE ───────────────────────────────────────────────────
 * The Security portal had its own `Section`, local to its settings page and
 * byte-for-byte this one apart from the slot it offered: this took an `icon`,
 * that took an `aside` for a "Test tone" button. Two copies of one component,
 * already diverging in the only way that mattered — so neither page could use
 * the other's feature without a third copy.
 *
 * Merged here with both. `action` is the former `aside`; `icon` is unchanged.
 * The Security page's local pair is deleted, which is what makes the two
 * consoles render the same panel rather than two panels that look alike.
 */
export function SettingsGroup({ title, description, icon, action, children }) {
  return (
    <Card as="section" className="overflow-hidden p-0">
      <CardHeader icon={icon} title={title} description={description} action={action} />
      <div className="divide-y divide-divider">{children}</div>
    </Card>
  )
}
