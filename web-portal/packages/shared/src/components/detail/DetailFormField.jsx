import Tooltip from '@shared/components/Tooltip'
import { Info } from '@shared/icons'

/**
 * The editable twin of DetailField, for forms that sit inside DetailCards (Add
 * and Edit security account) — so a form and a record view share one label
 * scale: an 11px label over a 40px, rounded-xl, base-950 well, the same well
 * the Incident details use for notes and coordinates.
 *
 *   <DetailFormField label="Badge ID" htmlFor="sa-badge" required error={…} hint="…">
 *     <input id="sa-badge" className={detailInputClass({ error })} … />
 *   </DetailFormField>
 *
 * The message slot is always present (min-h-4), so a field never jumps when an
 * error appears under it.
 */
export function DetailFormField({ label, htmlFor, required = false, tip = null, action = null, error, hint, className = '', children }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <label htmlFor={htmlFor} className="block text-[11px] font-medium text-text-muted">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-brand-500">
                *
              </span>
            ) : null}
          </label>
          {tip ? (
            <Tooltip label={label} hint={tip} side="top">
              <button
                type="button"
                aria-label={`About ${label.toLowerCase()}: ${tip}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <Info size={13} />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {action}
      </div>
      {children}
      <div className="min-h-4">
        {error ? (
          <p id={`${htmlFor}-error`} className="text-[11px] font-medium leading-snug text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={`${htmlFor}-hint`} className="text-[11px] leading-snug text-text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** The input well. `icon` reserves a leading glyph slot; `disabled` reads as locked. */
export function detailInputClass({ error = false, icon = false, mono = false, disabled = false, className = '' } = {}) {
  return [
    'h-10 w-full rounded-xl border bg-base-950 text-sm shadow-inner outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-muted',
    icon ? 'pl-9 pr-3.5' : 'px-3.5',
    mono ? 'font-mono tracking-wide' : '',
    disabled
      ? 'cursor-not-allowed border-hairline text-text-muted'
      : error
        ? 'border-danger/70 text-text-primary focus:border-danger focus:ring-4 focus:ring-danger/15'
        : 'border-hairline text-text-primary hover:border-brand-500/30 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15',
    className,
  ].join(' ')
}
