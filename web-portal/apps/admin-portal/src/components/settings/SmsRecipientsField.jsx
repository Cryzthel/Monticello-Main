import { Plus, Trash2 } from '@shared/icons'
import { SMS_RECIPIENTS_MAX } from '@shared/lib/systemSettingsStore'

// A Philippine mobile or landline as people type it: digits, spaces, dashes,
// brackets and an optional leading +, 7 to 13 digits in all.
const PHONE = /^\+?[\d\s()-]+$/
const isPhoneNumber = (value) => PHONE.test(value) && /^\d{7,13}$/.test(value.replace(/\D/g, ''))

/**
 * The guardhouse numbers the resident app texts when an SOS cannot reach the
 * server — `sos.hotlines`, first SMS_RECIPIENTS_MAX entries. Each row is a name
 * the resident sees in their SMS app's recipient list and the number itself.
 *
 * Edits the page's draft like every other control; Save mirrors the list to
 * `system_settings/resident_sos` (see saveSettings). A row missing either
 * field is dropped by the sanitizer on save, so a half-typed row never
 * reaches a phone.
 */
export default function SmsRecipientsField({ value = [], disabled, onChange }) {
  const rows = value.slice(0, SMS_RECIPIENTS_MAX)
  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const remove = (index) => onChange(rows.filter((_, i) => i !== index))
  const add = () => onChange([...rows, { id: `hotline-${Date.now()}`, label: '', number: '' }])

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3 text-small text-text-secondary">
          No numbers saved. Until one is, the app texts the guard roster built into it.
        </p>
      ) : null}
      {rows.map((row, index) => {
        const badNumber = row.number.trim() !== '' && !isPhoneNumber(row.number.trim())
        return (
          <div key={row.id ?? index} className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <input
                type="text"
                aria-label={`Recipient ${index + 1} name`}
                placeholder="Main gate"
                maxLength={60}
                value={row.label}
                disabled={disabled}
                onChange={(event) => update(index, { label: event.target.value })}
                className="field h-10 min-w-0 flex-1 py-0"
              />
              <input
                type="tel"
                inputMode="tel"
                aria-label={`Recipient ${index + 1} number`}
                aria-invalid={badNumber || undefined}
                placeholder="0951 280 1347"
                maxLength={40}
                value={row.number}
                disabled={disabled}
                onChange={(event) => update(index, { number: event.target.value })}
                className="field h-10 min-w-0 flex-1 py-0 tabular-nums"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={`Remove recipient ${index + 1}`}
                className="icon-btn icon-btn-md shrink-0"
              >
                <Trash2 size="sm" />
              </button>
            </div>
            {badNumber ? <p className="text-small text-danger">Enter a phone number, e.g. 0951 280 1347.</p> : null}
          </div>
        )
      })}
      {rows.length < SMS_RECIPIENTS_MAX ? (
        <div>
          <button type="button" onClick={add} disabled={disabled} className="btn btn-sm btn-outline">
            <Plus size="sm" />
            Add number
          </button>
        </div>
      ) : null}
    </div>
  )
}
