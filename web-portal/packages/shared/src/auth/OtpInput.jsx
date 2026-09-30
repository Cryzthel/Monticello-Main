import { useEffect, useRef } from 'react'

/**
 * Six single-character boxes for a 6-digit code, with auto-advance.
 *
 * ── WHERE THIS IS USED, AND WHERE IT IS NOT ──────────────────────────────────
 * The two-factor step of the sign-in form. It is NOT part of password recovery,
 * because password recovery in this product has no 6-digit code to type — see
 * PasswordRecovery for what Firebase actually sends and why. A pin UI on a
 * screen with no pin would be a control that cannot be satisfied.
 *
 * ── WHY ONE INPUT PER DIGIT IS WORTH THE CODE ────────────────────────────────
 * It replaced a single text input with wide letter-spacing, which looked close
 * enough and behaved worse: no digit boundaries to aim a correction at, no
 * per-digit backspace, and a paste of "123 456" needing the user to notice the
 * space. Six boxes give the code a shape, and the handlers below give it the
 * behaviour people already expect from every authenticator prompt they have
 * used.
 *
 * WHAT IT HANDLES, all of which are the reasons this is not just six inputs:
 *   · TYPING advances to the next box, and the last box does not lose the digit
 *     it just received.
 *   · BACKSPACE in an empty box steps back and clears the previous one, so
 *     holding it deletes the code rather than stalling on the first empty box.
 *   · ARROWS move between boxes without editing.
 *   · PASTE of a whole code fills every box from wherever it was pasted,
 *     tolerating the spaces and dashes that authenticator apps and SMS put in.
 *   · AUTOFILL from an SMS or a password manager arrives as a multi-character
 *     change into one box, and is spread the same way a paste is.
 *
 * The value is owned by the caller and is always the joined string, so the
 * parent submits, validates and clears it exactly as it would a text field.
 */

const LENGTH = 6

/** Digits only. Authenticators and SMS pad codes with spaces and dashes. */
const digitsOf = (text) => text.replace(/\D/g, '')

export default function OtpInput({
  id,
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
}) {
  const boxes = useRef([])
  const digits = digitsOf(value).slice(0, LENGTH).split('')

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus()
  }, [autoFocus])

  const commit = (next) => {
    const code = next.slice(0, LENGTH)
    onChange(code)
    // Announced only on the transition INTO a full code, so a correction made
    // inside an already-complete code does not re-submit on every keystroke.
    if (code.length === LENGTH && digitsOf(value).length < LENGTH) onComplete?.(code)
    return code
  }

  const focusBox = (index) => {
    const box = boxes.current[Math.max(0, Math.min(LENGTH - 1, index))]
    box?.focus()
    box?.select()
  }

  /** Write `text` starting at `index`, then park the caret after what landed. */
  const spread = (index, text) => {
    const incoming = digitsOf(text)
    if (!incoming) return
    const next = digits.slice()
    for (let i = 0; i < incoming.length && index + i < LENGTH; i += 1) {
      next[index + i] = incoming[i]
    }
    const code = commit(next.join('').slice(0, LENGTH))
    focusBox(Math.min(index + incoming.length, LENGTH - 1))
    return code
  }

  const handleChange = (index) => (event) => {
    // A single keystroke replaces the box; anything longer is a paste or an
    // autofill and gets spread across the boxes from here.
    spread(index, event.target.value)
  }

  const handleKeyDown = (index) => (event) => {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const next = digits.slice()
      if (next[index]) {
        next[index] = ''
        commit(next.join(''))
        return
      }
      // Empty box: step back and clear the one before it, so a held backspace
      // walks the code instead of stopping here.
      next[index - 1] = ''
      commit(next.join(''))
      focusBox(index - 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusBox(index - 1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusBox(index + 1)
    }
  }

  const handlePaste = (index) => (event) => {
    event.preventDefault()
    spread(index, event.clipboardData.getData('text'))
  }

  return (
    <div className="flex items-center justify-between gap-2" role="group" aria-labelledby={`${id}-label`}>
      {Array.from({ length: LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            boxes.current[index] = node
          }}
          id={index === 0 ? id : undefined}
          type="text"
          // `numeric` rather than `tel`: it asks for the digit pad without the
          // phone keypad's letters, and it is what pairs with autocomplete.
          inputMode="numeric"
          pattern="[0-9]*"
          // The whole group carries this so the browser and iOS both offer a
          // code arriving by SMS. Only meaningful on the first box.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          // 2, not 1: a maxLength of 1 makes the box reject a pasted code
          // outright in some browsers, and this way the extra characters
          // arrive in `onChange` and get spread.
          maxLength={2}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
          value={digits[index] ?? ''}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste(index)}
          onFocus={(event) => event.target.select()}
          className={`h-14 w-full min-w-0 rounded-2xl border bg-field text-center font-mono text-lg font-semibold text-text-primary outline-none transition-[border-color,box-shadow] duration-200 ease-in-out disabled:opacity-60 ${
            invalid
              ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
              : 'border-slate-200/80 hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
          }`}
        />
      ))}
    </div>
  )
}
