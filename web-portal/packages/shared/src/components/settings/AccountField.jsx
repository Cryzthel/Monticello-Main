import { useState } from 'react'
import { Eye, EyeOff } from '@shared/icons'
import FloatingField from '@shared/auth/FloatingField'

/**
 * The fields inside the Settings account dialogs — the sign-in page's own
 * FloatingField (capsule, floating label, brand focus ring), on the themed
 * surface (2026-10-19, by request: "match the Login page").
 *
 *   <AccountField id="new-email" label="New email address" value={v} onChange={setV} hint="…" />
 *   <PasswordField id="current-password" label="Current password" value={v} onChange={setV} />
 *
 * `invalid` + `hint` renders the hint as the field's error (red, announced
 * with the field); a hint alone is a quiet note.
 */
export function AccountField({ id, label, value, onChange, invalid = false, hint = '', inputRef, trailing, ...rest }) {
  return (
    <FloatingField
      surface="theme"
      id={id}
      label={label}
      value={value}
      filled={Boolean(value)}
      // React 19: `ref` is a plain prop, and FloatingField spreads it onto the <input>.
      ref={inputRef}
      error={invalid ? hint || 'Check this field.' : ''}
      hint={invalid ? '' : hint}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      trailing={trailing}
      {...rest}
    />
  )
}

/**
 * A password field with its OWN eye. Each field reveals only itself: showing
 * the new password to check a typo should not also put the current one on
 * screen. The toggle is the sign-in form's, exactly — 44px on touch, 32px on
 * a pointer — and the field starts masked every time the dialog opens.
 */
export function PasswordField({ id, label, ...rest }) {
  const [shown, setShown] = useState(false)
  return (
    <AccountField
      id={id}
      label={label}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShown((on) => !on)}
          className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:h-8 sm:w-8"
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          aria-controls={id}
        >
          {shown ? <EyeOff size="sm" /> : <Eye size="sm" />}
        </button>
      }
      {...rest}
    />
  )
}
