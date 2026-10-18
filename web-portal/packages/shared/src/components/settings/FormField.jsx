/**
 * The one text field the account forms on Settings use (password, email).
 *
 * Label above, quiet; a 40px field; and a focus state that is unmistakable —
 * a brand border plus a soft 4px ring — because these are credential forms
 * and a keyboard user must always know which field they are typing into.
 * `trailing` (a reveal toggle) sits inside the field so every field in a
 * column shares one right edge.
 */
export default function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  disabled,
  invalid,
  hint,
  trailing,
  inputRef,
  inputMode,
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          autoComplete={autoComplete}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`h-10 w-full rounded-xl border bg-base-950 px-3.5 text-sm text-text-primary shadow-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-muted disabled:opacity-60 ${
            trailing ? 'pr-11' : ''
          } ${
            invalid
              ? 'border-danger/70 focus:border-danger focus:ring-4 focus:ring-danger/15'
              : 'border-hairline hover:border-brand-500/30 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15'
          }`}
        />
        {trailing ? <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className={`text-2xs leading-snug ${invalid ? 'text-danger' : 'text-text-muted'}`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
